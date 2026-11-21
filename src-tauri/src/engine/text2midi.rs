use super::{native::NativeJob, progress::Progress};
use crate::{
    catalog::ProviderProfile,
    error::{message, Result},
};
use midly::{MetaMessage, MidiMessage, Smf, TrackEventKind};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub async fn generate(
    profile: &ProviderProfile,
    resources: &Path,
    model_folder: &Path,
    data_root: &Path,
    params: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(Progress),
) -> Result<(Vec<u8>, String, Value)> {
    let (runner, mut args) = match profile.runtime.packaged_plugin(resources) {
        Some(plugin) => (plugin, Vec::new()),
        None => {
            let python = profile
                .runtime
                .interpreter(data_root)
                .ok_or_else(|| message("Text2midi runtime interpreter is not configured"))?;
            let script = profile.runtime.executable(resources);
            (
                python,
                vec![
                    "-E".into(),
                    "-s".into(),
                    "-B".into(),
                    script.to_string_lossy().into_owned(),
                ],
            )
        }
    };
    let prompt = params["caption"]
        .as_str()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .ok_or_else(|| message("Enter a prompt for Text2midi"))?;
    let seed = params["seed"]
        .as_u64()
        .and_then(|seed| u32::try_from(seed).ok())
        .ok_or_else(|| message("Invalid Text2midi seed"))?;
    let platform = profile.platform(crate::hardware::inspect())?;
    let job = NativeJob {
        executable: &runner,
        model_folder,
        data_root,
        log_name: "text2midi.log",
        backend: &platform.backend,
        timeout: Duration::from_secs(20 * 60),
    };
    let (midi, mut meta) = job
        .run_file("mid", params, cancel, progress, |output| {
            args.extend([
                "--model-dir".into(),
                model_folder.to_string_lossy().into_owned(),
                format!("--prompt={prompt}"),
                "--output".into(),
                output.to_string_lossy().into_owned(),
                "--seed".into(),
                seed.to_string(),
            ]);
            args
        })
        .await?;
    meta["midi"] = inspect(&midi)?;
    Ok((midi, "mid".into(), meta))
}

fn inspect(bytes: &[u8]) -> Result<Value> {
    let midi =
        Smf::parse(bytes).map_err(|error| message(format!("Invalid MIDI output: {error}")))?;
    let mut note_tracks = 0;
    let mut note_count = 0;
    let mut tempo_events = 0;
    for track in midi.tracks {
        let mut track_notes = 0;
        for event in track {
            match event.kind {
                TrackEventKind::Midi {
                    message: MidiMessage::NoteOn { vel, .. },
                    ..
                } if vel.as_int() > 0 => track_notes += 1,
                TrackEventKind::Meta(MetaMessage::Tempo(tempo)) if tempo.as_int() > 0 => {
                    tempo_events += 1;
                }
                _ => {}
            }
        }
        note_count += track_notes;
        note_tracks += usize::from(track_notes > 0);
    }
    if note_count == 0 {
        return Err(message(
            "Text2midi produced no notes. Try another seed or prompt",
        ));
    }
    Ok(json!({
        "note_tracks": note_tracks,
        "notes": note_count,
        "tempo_events": tempo_events,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use midly::{Format, Header, Timing, TrackEvent};

    #[test]
    fn accepts_editable_notes_and_counts_tempo_metadata() {
        let tracks = vec![vec![
            TrackEvent {
                delta: 0.into(),
                kind: TrackEventKind::Meta(MetaMessage::Tempo(500_000.into())),
            },
            TrackEvent {
                delta: 0.into(),
                kind: TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::NoteOn {
                        key: 60.into(),
                        vel: 100.into(),
                    },
                },
            },
            TrackEvent {
                delta: 96.into(),
                kind: TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::NoteOn {
                        key: 60.into(),
                        vel: 0.into(),
                    },
                },
            },
            TrackEvent {
                delta: 0.into(),
                kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
            },
        ]];
        let score = Smf {
            header: Header::new(Format::SingleTrack, Timing::Metrical(96.into())),
            tracks,
        };
        let mut bytes = Vec::new();
        score.write_std(&mut bytes).unwrap();
        assert_eq!(
            inspect(&bytes).unwrap(),
            json!({ "note_tracks": 1, "notes": 1, "tempo_events": 1 })
        );
        assert!(inspect(&bytes[..14]).is_err());
        assert!(inspect(b"RIFF").is_err());
    }
}
