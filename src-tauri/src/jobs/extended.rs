use crate::{
    audio_facts::{self, WavAssembly},
    catalog::GenerationCapabilities,
    error::{message, Error, Result},
    generation_limits::{supports_extended_duration, MAX_EXTENDED_DURATION},
};
use serde_json::{json, Value};
use std::{future::Future, time::Instant};
use tokio_util::sync::CancellationToken;

pub(super) fn duration(params: &Value, capabilities: &GenerationCapabilities) -> Option<f64> {
    audio_facts::requested_duration(params).filter(|&seconds| {
        params["ignore_recommended_duration"] == true
            && supports_extended_duration(capabilities)
            && seconds > f64::from(capabilities.max_duration)
            && seconds <= f64::from(MAX_EXTENDED_DURATION)
    })
}

/// Render a single queue item in balanced sections within the model's duration limit.
pub(super) async fn generate<F>(
    duration: f64,
    params: &Value,
    capabilities: &GenerationCapabilities,
    cancel: &CancellationToken,
    mut render: impl FnMut(Value, u32, u32) -> F,
) -> Result<(Vec<u8>, String, Value)>
where
    F: Future<Output = Result<(Vec<u8>, String, Value)>>,
{
    let started = Instant::now();
    let parts = (duration / f64::from(capabilities.max_duration)).ceil() as u32;
    let seed = params["seed"]
        .as_u64()
        .ok_or_else(|| message("Extended generation requires a resolved seed"))?;
    let seed_range = capabilities.max_seed.map_or(i64::MAX as u64, u64::from) + 1;
    let lyrics = params["lyrics"].as_str().unwrap_or_default();
    let sections: Vec<_> = lyrics
        .split("\n\n")
        .filter(|section| !section.trim().is_empty())
        .collect();
    // Timestamped lyrics refer to absolute positions, so render each whole input.
    let split_lyrics =
        sections.len() >= parts as usize && params["model_selection"]["provider"] != "diffrhythm2";
    let mut joined = WavAssembly::default();
    let mut metadata = Value::Null;
    let mut generated_lyrics = Vec::new();
    for index in 0..parts {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let mut part = params.clone();
        part["duration"] = json!(duration / f64::from(parts));
        if index > 0 {
            part["seed"] = json!((seed + u64::from(index) * 104_729) % seed_range);
        }
        if split_lyrics {
            let first = index as usize * sections.len() / parts as usize;
            let last = (index as usize + 1) * sections.len() / parts as usize;
            part["lyrics"] = json!(sections[first..last].join("\n\n"));
        }
        let (wav, ext, meta) = render(part, index + 1, parts).await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if ext != "wav" {
            return Err(message("Extended generation requires WAV output"));
        }
        joined.append(&wav)?;
        if lyrics.trim().is_empty() {
            if let Some(text) = meta["lyrics"]
                .as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
            {
                generated_lyrics.push(text.to_owned());
            }
        }
        if index == 0 {
            metadata = meta;
        }
    }
    let wav = joined.finish(duration)?;
    let measured = audio_facts::duration(&wav)?;
    // Audio codes and duration claims from an individual section cannot describe the whole song.
    if let Some(meta) = metadata.as_object_mut() {
        for key in [
            "audio_codes",
            "lm_duration",
            "lm_seed",
            "planning_seed",
            "duration_limit",
            "lyrics",
            "stream_metrics",
        ] {
            meta.remove(key);
        }
    }
    if !lyrics.trim().is_empty() {
        metadata["lyrics"] = json!(lyrics);
    } else if !generated_lyrics.is_empty() {
        metadata["lyrics"] = json!(generated_lyrics.join("\n\n"));
    }
    metadata["extended_duration_parts"] = json!(parts);
    metadata["runtime_seconds"] = json!(started.elapsed().as_secs_f64());
    audio_facts::record_duration(measured, params, &mut metadata);
    Ok((wav, "wav".into(), metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::ready;

    fn mono_pcm16(samples: u32, amplitude: i16) -> Vec<u8> {
        let mut wav = b"RIFF\0\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x40\x1f\0\0\x80\x3e\0\0\x02\0\x10\0data\0\0\0\0".to_vec();
        wav[4..8].copy_from_slice(&(36 + samples * 2).to_le_bytes());
        wav[40..44].copy_from_slice(&(samples * 2).to_le_bytes());
        for _ in 0..samples {
            wav.extend_from_slice(&amplitude.to_le_bytes());
        }
        wav
    }

    #[tokio::test]
    async fn renders_one_fifteen_minute_wav_from_bounded_sections() {
        let caps = GenerationCapabilities::ace_step();
        let params = json!({"duration":900, "ignore_recommended_duration":true, "seed":42,
            "lyrics":"[Verse]\nNight falls\n\n[Chorus]\nThe river calls"});
        let seconds = duration(&params, &caps).unwrap();
        let cancel = CancellationToken::new();
        let (wav, extension, meta) =
            generate(seconds, &params, &caps, &cancel, |part, step, total| {
                assert_eq!(part["duration"], 450.0);
                assert_eq!(total, 2);
                assert_eq!(part["seed"] == 42, step == 1);
                assert_eq!(
                    part["lyrics"],
                    if step == 1 {
                        "[Verse]\nNight falls"
                    } else {
                        "[Chorus]\nThe river calls"
                    }
                );
                ready(Ok((
                    mono_pcm16(450 * 8000 + 240, step as i16 * 1000),
                    "wav".into(),
                    json!({"audio_codes":"part only", "duration":450, "duration_source":"wav"}),
                )))
            })
            .await
            .unwrap();
        assert_eq!(extension, "wav");
        assert_eq!(audio_facts::duration(&wav).unwrap(), 900.0);
        assert_eq!(meta["extended_duration_parts"], 2);
        assert_eq!(meta["duration"], 900.0);
        assert_eq!(meta["lyrics"], params["lyrics"]);
        assert!(meta.get("audio_codes").is_none());
        let before = 44 + 450 * 8000 * 2;
        assert_eq!(
            i16::from_le_bytes(wav[before..before + 2].try_into().unwrap()),
            1004
        );
    }

    #[tokio::test]
    async fn cancellation_after_a_section_does_not_render_the_next_section() {
        let cancel = CancellationToken::new();
        let params = json!({"duration": 900, "seed":42, "ignore_recommended_duration":true});
        let result = generate(
            900.0,
            &params,
            &GenerationCapabilities::ace_step(),
            &cancel,
            |_, step, _| {
                assert_eq!(step, 1);
                cancel.cancel();
                ready(Ok((mono_pcm16(8000, 500), "wav".into(), json!({}))))
            },
        )
        .await;
        assert!(matches!(result, Err(Error::Cancelled)));
    }
}
