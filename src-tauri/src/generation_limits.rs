use crate::{
    catalog::GenerationCapabilities,
    error::{message, Result},
    types::GenerateRequest,
};

/// The verified desktop runtime supports up to two hundred diffusion iterations.
pub const MAX_INFERENCE_STEPS: u32 = 200;
pub(crate) const LEGACY_INFERENCE_STEPS_LIMIT: u32 = 100;
const MAX_NATIVE_TEXT_BYTES: usize = 8 * 1024;

/// Validate the profile-specific request shape before saving or resubmitting a job.
pub fn validate_request(
    request: &GenerateRequest,
    capabilities: &GenerationCapabilities,
) -> Result<()> {
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
    let minimum = if capabilities.advanced {
        0
    } else {
        capabilities.min_duration
    };
    if !(f64::from(minimum)..=f64::from(capabilities.max_duration)).contains(&request.duration) {
        return Err(message(format!(
            "This model supports durations between {minimum} and {} seconds",
            capabilities.max_duration
        )));
    }
    if !capabilities.prompt {
        if !request.prompt.trim().is_empty() || !request.caption.trim().is_empty() {
            return Err(message(
                "This model accepts style tags instead of prompts or captions",
            ));
        }
        if !request.style.split(',').any(|tag| !tag.trim().is_empty()) {
            return Err(message("Enter at least one style tag"));
        }
    }
    if request.instrumental && !capabilities.instrumental {
        return Err(message("This model requires a vocal song"));
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
        if request.style.len() + request.lyrics.len() > MAX_NATIVE_TEXT_BYTES {
            return Err(message(
                "Style tags and lyrics must total at most 8 KiB of UTF-8 text",
            ));
        }
        if request.style.contains('\0') || request.lyrics.contains('\0') {
            return Err(message(
                "Style tags and lyrics cannot contain NUL characters",
            ));
        }
    }
    Ok(())
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
