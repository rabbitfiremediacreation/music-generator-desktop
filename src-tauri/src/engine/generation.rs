use super::{
    client::{limit_audio_codes, EngineClient},
    diagnostics::SynthesisLog,
    progress::Progress,
    response::extract_generation,
};
use crate::error::{message, Error, Result};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

/// At 1.2 the language model drifted between languages and scripts while it
/// invented lyrics. Measured on the 4B model with an empty lyrics field, asking
/// for English: 10 of 20 runs were usable at 1.2, 17 of 20 at 0.85. Values in
/// between were not measured.
const INVENTED_LYRICS_TEMPERATURE: f64 = 0.85;

/// The engine logs `vocal_language` verbatim in the `language:` line of the
/// prompt it records, and the model does not appear to read every ISO code the
/// picker offers. Measured on the 4B model at 0.85 with an empty lyrics field,
/// `de` and `pt` never produced their language and `it` at most once, in
/// fragments; `German` then produced German in 18 of 20, the other two answers
/// carrying no lyrics at all. `en` and `fr` hit equally often either way, so
/// spelling the language out does not lower the hit rate where the code already
/// does its job.
fn language_name(code: &str) -> Option<&'static str> {
    Some(match code {
        "en" => "English",
        "de" => "German",
        "fr" => "French",
        "es" => "Spanish",
        "it" => "Italian",
        "pt" => "Portuguese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "zh" => "Chinese",
        "ru" => "Russian",
        _ => return None,
    })
}

/// Spell out the vocal language for the prompt, and cap the temperature when an
/// absent lyrics field leaves the language model to invent the words itself.
/// Returns the code the picker produced: only the prompt wants the long name, so
/// the caller puts the code back on the result.
fn normalize_vocal_request(request: &mut Value) -> Option<String> {
    let code = request["vocal_language"].as_str().map(str::to_owned);
    if let Some(name) = code.as_deref().and_then(language_name) {
        request["vocal_language"] = json!(name);
    }
    if request.get("lyrics").is_none() {
        let temperature = request["lm_temperature"]
            .as_f64()
            .unwrap_or(INVENTED_LYRICS_TEMPERATURE);
        request["lm_temperature"] = json!(temperature.min(INVENTED_LYRICS_TEMPERATURE));
    }
    code
}

impl EngineClient {
    pub async fn generate(
        &self,
        params: &Value,
        lm_file: &str,
        dit: &str,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
    ) -> Result<(Vec<u8>, String, Value)> {
        const FIELDS: &[&str] = &[
            "caption",
            "lyrics",
            "bpm",
            "duration",
            "keyscale",
            "timesignature",
            "vocal_language",
            "seed",
            "lm_temperature",
            "lm_cfg_scale",
            "inference_steps",
            "guidance_scale",
            "use_cot_caption",
        ];
        // Normalize to the actual peak instead of clipping percentile outliers.
        let mut request = json!({"output_format":"wav16", "peak_clip":0, "lm_model": lm_file, "synth_model": dit});
        for field in FIELDS {
            if let Some(value) = params
                .get(field)
                .filter(|v| !v.is_null() && v.as_str() != Some(""))
            {
                request[field] = value.clone();
            }
        }
        // The spelled-out name steers the language model's prompt; synthesis and the
        // saved song keep the code the picker produced.
        let language = normalize_vocal_request(&mut request);

        let steps =
            crate::generation_limits::effective_steps(params["inference_steps"].as_u64(), dit);
        request["inference_steps"] = json!(steps);
        let mut enriched = self
            .complete_codes(&request, params, cancel, &progress)
            .await?;
        if let Some(code) = &language {
            enriched["vocal_language"] = json!(code);
        }
        // The synthesis model supports at most 600 seconds (3000 codes).
        // Trim occasional LM overproduction only in this outgoing payload;
        // saved song parameters remain unchanged.
        limit_audio_codes(&mut enriched, params);
        if let Some(claimed) = enriched.get("duration").cloned() {
            enriched["lm_duration"] = claimed;
        }
        if let Some(requested) = crate::audio_facts::requested_duration(params) {
            enriched["duration"] = json!(requested);
        }
        // LM metadata cannot silently change the synthesis iteration contract.
        enriched["inference_steps"] = json!(steps);
        enriched
            .as_object_mut()
            .unwrap()
            .remove("effective_inference_steps");
        enriched
            .as_object_mut()
            .unwrap()
            .remove("inference_steps_limit");
        if let Some(seed) = request.get("seed") {
            enriched["seed"] = seed.clone();
        }
        enriched["output_format"] = json!("wav16");
        enriched["peak_clip"] = json!(0);
        enriched["synth_model"] = json!(dit);
        let log = self.synth_log.as_deref().map(SynthesisLog::capture);
        let result = self
            .operation(
                &self.synth,
                "synth",
                self.http
                    .post(format!("{}/synth", self.synth))
                    .json(&enriched),
                cancel,
                progress,
            )
            .await
            .and_then(|(ctype, body)| extract_generation(&ctype, &body));
        let (audio, extension, metadata) = result.map_err(|error| {
            if matches!(error, Error::Cancelled | Error::EngineTimeout { .. }) {
                return error;
            }
            log.as_ref()
                .and_then(|log| log.hint(&error.to_string()))
                .map(message)
                .unwrap_or(error)
        })?;
        record_iteration_evidence(steps, metadata.as_ref(), &mut enriched)?;
        let seconds = crate::audio_facts::duration(&audio)?;
        crate::audio_facts::record_duration(seconds, params, &mut enriched);
        Ok((audio, extension, enriched))
    }
}

/// Only the synthesis response can establish the updated runtime's actual execution contract.
fn record_iteration_evidence(
    requested: u32,
    metadata: Option<&Value>,
    result: &mut Value,
) -> Result<()> {
    use crate::generation_limits::{LEGACY_INFERENCE_STEPS_LIMIT, MAX_INFERENCE_STEPS};
    let supported = metadata.and_then(|meta| meta["inference_steps_limit"].as_u64())
        == Some(u64::from(MAX_INFERENCE_STEPS));
    let limit = if supported {
        MAX_INFERENCE_STEPS
    } else {
        LEGACY_INFERENCE_STEPS_LIMIT
    };
    let actual = metadata
        .and_then(|meta| meta["effective_inference_steps"].as_u64())
        .filter(|steps| (1..=u64::from(limit)).contains(steps));
    if supported && actual.is_none() {
        return Err(message(
            "Engine did not confirm its effective iteration count",
        ));
    }
    let actual = actual.unwrap_or_else(|| u64::from(requested.min(limit)));
    result["inference_steps"] = json!(actual);
    result["effective_inference_steps"] = json!(actual);
    if supported {
        result["inference_steps_limit"] = json!(limit);
    }
    Ok(())
}

/// The language model sometimes answers a request for vocals with `[Instrumental]`
/// and no words at all, while still producing codes for nearly the full duration.
/// With the language model seed pinned, silence clung to a few seeds: one stayed
/// silent in every series that reached it, another in every series at 0.85,
/// whatever the language.
/// The run one seed further sang in every case measured, so another roll is worth
/// it. The retry below only gets the chance if we notice,
/// because the code count alone looks healthy.
fn missing_vocals(request: &Value, result: &Value) -> bool {
    if request.get("lyrics").is_some() || !request["vocal_language"].is_string() {
        return false;
    }
    // An answer without the field at all says nothing either way; rolling again
    // would cost a second pass whose result could never look any better.
    result["lyrics"].is_string() && !sings(result)
}

/// A take sings when something outside the section markers carries letters or
/// digits. The web app strips markers the same way with `re.sub(r"\[[^\]]*\]", "")`
/// and then looks for `\w`, which also counts `_`; and after an unclosed bracket
/// everything following it counts as a marker here.
fn sings(result: &Value) -> bool {
    let Some(lyrics) = result["lyrics"].as_str() else {
        return false;
    };
    let mut inside = false;
    lyrics.chars().any(|c| match c {
        '[' => {
            inside = true;
            false
        }
        ']' => {
            inside = false;
            false
        }
        c => !inside && c.is_alphanumeric(),
    })
}

/// Codes reach the requested duration within the tolerance the rest of the
/// pipeline already applies. Without a requested duration anything will do.
fn long_enough(count: usize, params: &Value) -> bool {
    crate::audio_facts::requested_duration(params).is_none_or(|requested| {
        (count as f64 / 5.0) + crate::audio_facts::tolerance(requested) + 1e-6 >= requested
    })
}

impl EngineClient {
    /// Retry the LM stage at most once; synthesize the best available codes exactly once.
    async fn complete_codes(
        &self,
        request: &Value,
        params: &Value,
        cancel: &CancellationToken,
        progress: &impl Fn(Progress),
    ) -> Result<Value> {
        let started = Instant::now();
        let mut best = self.language_model(request, cancel, progress).await?;
        let mut count = code_count(&best);
        let mut attempts = 1;
        let remaining = self.timeout.saturating_sub(started.elapsed());
        let silent = missing_vocals(request, &best);
        let short = count == 0 || silent || !long_enough(count, params);
        if short && !remaining.is_zero() {
            let mut retry = request.clone();
            let previous = best["lm_seed"].as_u64().map(|seed| seed as u32);
            let seed = previous
                .map(|seed| seed.wrapping_add(1))
                .unwrap_or_else(|| uuid::Uuid::new_v4().as_u128() as u32);
            retry["lm_seed"] = json!(seed);
            let mut client = self.clone();
            client.timeout = remaining.min(Duration::from_secs(120));
            attempts = 2;
            match client.language_model(&retry, cancel, progress).await {
                Ok(candidate) => {
                    let candidate_count = code_count(&candidate);
                    // A take that sings beats a silent one even when it is a little
                    // shorter, as long as it still reaches the requested duration.
                    // A fragment does not: that would be worse than the full
                    // instrumental piece the first roll produced.
                    // `silent` is redundant against today's retry triggers - with
                    // either of the other two, more codes already win - and is kept
                    // so the branch stays bound to silence if a trigger is added.
                    if candidate_count > count
                        || (silent
                            && candidate_count > 0
                            && sings(&candidate)
                            && long_enough(candidate_count, params))
                    {
                        best = candidate;
                        count = candidate_count;
                    }
                }
                Err(Error::Cancelled) => return Err(Error::Cancelled),
                Err(error) => {
                    best["lm_retry_error"] =
                        json!(error.to_string().chars().take(500).collect::<String>());
                }
            }
            best["lm_retry_seed"] = json!(seed);
        }
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if count == 0 {
            return Err(message(
                "Language model returned no audio codes. Run the hardware test again.",
            ));
        }
        best["lm_attempts"] = json!(attempts);
        Ok(best)
    }
}

fn code_count(meta: &Value) -> usize {
    meta["audio_codes"]
        .as_str()
        .unwrap_or("")
        .split(',')
        .filter(|code| !code.trim().is_empty())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocal_language_is_spelled_out_for_the_prompt_and_handed_back_as_a_code() {
        let mut request = json!({"vocal_language": "de", "lyrics": "[Verse]\nIrgendwas"});
        let code = normalize_vocal_request(&mut request);
        assert_eq!(request["vocal_language"], "German");
        // The caller needs the code back to restore it on the result.
        assert_eq!(code.as_deref(), Some("de"));
        // Codes the picker cannot produce stay untouched rather than being dropped.
        let mut unknown = json!({"vocal_language": "xx", "lyrics": "[Verse]\nsomething"});
        assert_eq!(normalize_vocal_request(&mut unknown).as_deref(), Some("xx"));
        assert_eq!(unknown["vocal_language"], "xx");
        let mut instrumental = json!({"lyrics": "[Instrumental]"});
        assert_eq!(normalize_vocal_request(&mut instrumental), None);
        assert!(instrumental.get("vocal_language").is_none());
    }

    /// Every spelling reaches the language model verbatim, so a typo in one of
    /// them would quietly cost that language the fix this module exists for.
    #[test]
    fn every_code_the_picker_offers_has_the_english_name_of_its_language() {
        assert_eq!(
            ["en", "de", "fr", "es", "it", "pt", "ja", "ko", "zh", "ru"].map(language_name),
            [
                Some("English"),
                Some("German"),
                Some("French"),
                Some("Spanish"),
                Some("Italian"),
                Some("Portuguese"),
                Some("Japanese"),
                Some("Korean"),
                Some("Chinese"),
                Some("Russian"),
            ]
        );
        // Anything else is left alone rather than guessed at.
        assert_eq!(language_name("nl"), None);
        assert_eq!(language_name("de-DE"), None);
        assert_eq!(language_name("DE"), None);
        assert_eq!(language_name(""), None);
    }

    #[test]
    fn temperature_is_capped_only_when_the_model_invents_the_lyrics() {
        let mut invented = json!({"vocal_language": "en", "lm_temperature": 1.2});
        normalize_vocal_request(&mut invented);
        assert_eq!(
            invented["lm_temperature"],
            json!(INVENTED_LYRICS_TEMPERATURE)
        );
        // Typed lyrics are left alone, so the chosen variance survives.
        let mut written =
            json!({"vocal_language": "en", "lm_temperature": 1.2, "lyrics": "[Verse]\nwords"});
        normalize_vocal_request(&mut written);
        assert_eq!(written["lm_temperature"], json!(1.2));
        // A deliberately low setting is never raised.
        let mut low = json!({"vocal_language": "en", "lm_temperature": 0.4});
        normalize_vocal_request(&mut low);
        assert_eq!(low["lm_temperature"], json!(0.4));
        // Without a setting the cap is what the request carries.
        let mut absent = json!({"vocal_language": "en"});
        normalize_vocal_request(&mut absent);
        assert_eq!(absent["lm_temperature"], json!(INVENTED_LYRICS_TEMPERATURE));
    }

    #[test]
    fn missing_vocals_only_flags_an_unanswered_request_for_singing() {
        let asked = json!({"vocal_language": "German"});
        assert!(missing_vocals(&asked, &json!({"lyrics": "[Instrumental]"})));
        assert!(missing_vocals(
            &asked,
            &json!({"lyrics": "[Intro]\n\n[Verse 1]\n[Outro]"})
        ));
        // Without the field there is nothing to judge, so no second pass.
        assert!(!missing_vocals(&asked, &json!({})));
        // No vocal language was asked for either, so there is nothing to miss.
        // Instrumentals arrive this way: the empty value is filtered out before
        // the request is sent, leaving the field absent.
        assert!(!missing_vocals(
            &json!({}),
            &json!({"lyrics": "[Instrumental]"})
        ));
        assert!(!missing_vocals(
            &asked,
            &json!({"lyrics": "[Verse 1]\nLichter blinken kalt im Raum"})
        ));
        // An instrumental was asked for, so silence is the correct answer.
        let instrumental = json!({"lyrics": "[Instrumental]"});
        assert!(!missing_vocals(
            &instrumental,
            &json!({"lyrics": "[Instrumental]"})
        ));
        // The user wrote the words, so nothing was left to the model.
        let written = json!({"vocal_language": "German", "lyrics": "[Verse]\nWorte"});
        assert!(!missing_vocals(
            &written,
            &json!({"lyrics": "[Instrumental]"})
        ));
    }

    #[test]
    fn length_is_only_judged_against_a_requested_duration() {
        // Nothing was asked for, so any number of codes will do.
        assert!(long_enough(0, &json!({})));
        assert!(long_enough(1, &json!({})));
        // A duration of zero is no request either, and neither is nonsense.
        assert!(long_enough(1, &json!({"duration": 0})));
        assert!(long_enough(1, &json!({"duration": "bald"})));
        // 120 s wants 600 codes; the pipeline's own tolerance is 2.4 s here, so
        // 588 still counts and 587 does not.
        assert!(long_enough(600, &json!({"duration": 120})));
        assert!(long_enough(588, &json!({"duration": 120})));
        assert!(!long_enough(587, &json!({"duration": 120})));
        assert!(!long_enough(0, &json!({"duration": 120})));
    }

    #[test]
    fn singing_is_what_stands_outside_the_section_markers() {
        assert!(sings(&json!({"lyrics": "[Verse 1]\nLichter blinken"})));
        // Words beside a marker on the same line still count as singing.
        assert!(sings(&json!({"lyrics": "[Chorus] La la [Hey]"})));
        assert!(!sings(&json!({"lyrics": "[Instrumental]"})));
        assert!(!sings(&json!({"lyrics": "[Intro]\n\n[Outro]"})));
        // Punctuation is not singing; only letters and digits are.
        assert!(!sings(&json!({"lyrics": "[Intro]\n...\n[Outro]"})));
        assert!(!sings(&json!({"lyrics": "[Instrumental]\n~ ~ ~"})));
        // Nothing to read means nothing to judge.
        assert!(!sings(&json!({})));
    }
}
