use crate::{
    catalog::GenerationCapabilities,
    error::{message, Result},
    types::GenerateRequest,
};

/// The verified desktop runtime supports up to two hundred diffusion iterations.
pub const MAX_INFERENCE_STEPS: u32 = 200;
pub(crate) const LEGACY_INFERENCE_STEPS_LIMIT: u32 = 100;
const MAX_NATIVE_TEXT_BYTES: usize = 8 * 1024;

/// Validate the profile-specific request shape and return the duration to store with the job.
pub fn validate_request(
    request: &GenerateRequest,
    capabilities: &GenerationCapabilities,
) -> Result<f64> {
    match (
        capabilities.reference_audio,
        request.reference_audio.as_deref(),
    ) {
        (true, None) => return Err(message("mulacover_reference_required")),
        (true, Some(id)) if !crate::reference_audio::valid_id(id) => {
            return Err(message("mulacover_reference_invalid"));
        }
        (false, Some(_)) => return Err(message("This model does not support reference audio")),
        _ => {}
    }
    if request.variants == 0 || request.variants > capabilities.max_variants {
        return Err(message(format!(
            "This model supports 1 to {} variants",
            capabilities.max_variants
        )));
    }
    if let Some(maximum) = capabilities.max_seed {
        let last_seed = request.seed.checked_add(i64::from(request.variants - 1));
        if request.seed != -1
            && (request.seed < 0 || last_seed.is_none_or(|seed| seed > i64::from(maximum)))
        {
            return Err(message(format!(
                "This model supports seeds from 0 to {maximum} or -1 for a random seed"
            )));
        }
    }
    if !capabilities.output_kind.is_audio() {
        let prompt = request.prompt.trim();
        let prompt = if prompt.is_empty() {
            request.caption.trim()
        } else {
            prompt
        };
        if prompt.trim_matches(',').trim().is_empty() {
            return Err(message("Enter a text prompt for MIDI generation"));
        }
        if prompt.len() > MAX_NATIVE_TEXT_BYTES || prompt.contains('\0') {
            return Err(message(
                "The MIDI prompt must be at most 8 KiB and cannot contain NUL characters",
            ));
        }
        if !request.style.trim().is_empty() {
            return Err(message("Describe musical styles in the MIDI prompt"));
        }
    }
    let duration = match (&capabilities.bars, request.bars) {
        (Some(choices), Some(bars)) if choices.contains(&bars) => {
            if !(1..=300).contains(&request.bpm) {
                return Err(message("Enter a whole-number BPM from 1 to 300"));
            }
            if request.prompt.trim().trim_matches(',').trim().is_empty() {
                return Err(message("Enter a short-clip description"));
            }
            240.0 * f64::from(bars) / f64::from(request.bpm)
        }
        (Some(_), _) => return Err(message("Choose a supported number of bars")),
        (None, Some(_)) => return Err(message("This model does not support bar counts")),
        (None, None) => request.duration,
    };
    let minimum = if capabilities.advanced {
        0
    } else {
        capabilities.min_duration
    };
    if !(f64::from(minimum)..=f64::from(capabilities.max_duration)).contains(&duration) {
        if capabilities.bars.is_some() {
            return Err(message(format!(
                "The selected BPM and bar count exceed this model's {}-second limit",
                capabilities.max_duration
            )));
        }
        return Err(message(format!(
            "This model supports durations between {minimum} and {} seconds",
            capabilities.max_duration
        )));
    }
    if !capabilities.prompt {
        if !request.prompt.trim().is_empty() || !request.caption.trim().is_empty() {
            return Err(message(if capabilities.style_description {
                "This model accepts a style description in the Style field"
            } else {
                "This model accepts style tags instead of prompts or captions"
            }));
        }
        if !request.style.split(',').any(|tag| !tag.trim().is_empty()) {
            return Err(message(if capabilities.style_description {
                "Enter a style description for this model"
            } else {
                "Enter at least one style tag"
            }));
        }
    }
    if request.instrumental && !capabilities.instrumental {
        return Err(message(if capabilities.lyrics_required {
            "This model requires a vocal song"
        } else {
            "This model does not support the instrumental control"
        }));
    }
    if capabilities.instrumental && !capabilities.lyrics && !request.instrumental {
        return Err(message("This model generates instrumental music only"));
    }
    if !capabilities.lyrics && !request.lyrics.trim().is_empty() {
        return Err(message("This model does not support lyrics"));
    }
    if capabilities.lyrics_required
        && (request.lyrics.trim().is_empty()
            || request.lyrics.trim().eq_ignore_ascii_case("[instrumental]"))
    {
        return Err(message("Enter lyrics for this model"));
    }
    if (!capabilities.bpm && request.bpm != 0)
        || (!capabilities.advanced
            && (request.inference_steps != 0
                || request.lm_temperature.is_some()
                || !request.keyscale.trim().is_empty()
                || !request.timesignature.trim().is_empty()
                || !request.vocal_language.trim().is_empty()
                || !request.keep_caption))
    {
        return Err(message(
            "This model does not support the supplied generation controls",
        ));
    }
    if !capabilities.advanced {
        let style = request.style.trim().trim_matches(',');
        let prompt = request.prompt.trim().trim_matches(',');
        let separator_bytes = 2 * usize::from(!style.is_empty() && !prompt.is_empty());
        let caption_bytes = (request.style.len() + separator_bytes + request.prompt.len())
            .max(request.caption.len());
        if caption_bytes + request.lyrics.len() > MAX_NATIVE_TEXT_BYTES {
            return Err(message(
                "Description and lyrics must total at most 8 KiB of UTF-8 text",
            ));
        }
        if [
            &request.style,
            &request.prompt,
            &request.caption,
            &request.lyrics,
        ]
        .iter()
        .any(|text| text.contains('\0'))
        {
            return Err(message(
                "Description and lyrics cannot contain NUL characters",
            ));
        }
    }
    Ok(duration)
}

/// Resolve legacy engine defaults before applying the same limit to every execution path.
pub fn effective_steps(requested: Option<u64>, synthesis: &str) -> u32 {
    match requested.filter(|steps| *steps > 0) {
        Some(steps) => steps.min(u64::from(MAX_INFERENCE_STEPS)) as u32,
        None if synthesis.contains("turbo") => 8,
        None => 50,
    }
}

/// Interpret historical synthesis inputs without editing the original request or claiming missing evidence.
pub fn enrich_metadata(params: &serde_json::Value, meta: &mut serde_json::Value) {
    let limit = if meta["inference_steps_limit"].as_u64() == Some(u64::from(MAX_INFERENCE_STEPS)) {
        MAX_INFERENCE_STEPS
    } else {
        LEGACY_INFERENCE_STEPS_LIMIT
    };
    if let Some(verified) = meta["effective_inference_steps"]
        .as_u64()
        .filter(|steps| (1..=u64::from(MAX_INFERENCE_STEPS)).contains(steps))
    {
        meta["effective_inference_steps"] = verified.min(u64::from(limit)).into();
        return;
    }
    let Some(requested) = meta["inference_steps"].as_u64() else {
        return;
    };
    let synthesis = meta["synth_model"]
        .as_str()
        .or_else(|| params["model_selection"]["synthesis"].as_str());
    if requested == 0 && synthesis.is_none() {
        return;
    }
    let steps = effective_steps(Some(requested), synthesis.unwrap_or_default()).min(limit);
    meta["effective_inference_steps"] = steps.into();
}
