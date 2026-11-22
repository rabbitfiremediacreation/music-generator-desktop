use crate::error::Result;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};
mod wav;
pub(crate) use wav::WavFacts;
pub(crate) use wav::{float_data, pcm16_data, WavAssembly};

#[derive(PartialEq, Eq)]
struct Signature {
    size: u64,
    modified: Option<SystemTime>,
}
struct Cached {
    signature: Signature,
    seconds: f64,
}

pub fn duration(audio: &[u8]) -> Result<f64> {
    Ok(wav_facts(audio)?.duration_seconds)
}

pub(crate) fn wav_facts(audio: &[u8]) -> Result<WavFacts> {
    wav::facts(&mut Cursor::new(audio))
}

pub(crate) fn is_reference_wav(audio: &[u8]) -> bool {
    wav_facts(audio).is_ok_and(|format| {
        format.bits_per_sample == 16
            && matches!(format.channels, 1 | 2)
            && (8000..=48000).contains(&format.sample_rate_hz)
    })
}

pub(crate) fn is_stereo_48khz_pcm16(audio: &[u8]) -> bool {
    wav_facts(audio).is_ok_and(|format| {
        format.bits_per_sample == 16 && format.channels == 2 && format.sample_rate_hz == 48000
    })
}

pub fn tolerance(requested: f64) -> f64 {
    0.4f64.max(requested * 0.02)
}

pub fn requested_duration(params: &Value) -> Option<f64> {
    params["duration"]
        .as_f64()
        .filter(|n| n.is_finite() && *n > 0.0)
}

fn remember_claim(meta: &mut Value) {
    if !meta.is_object() {
        *meta = json!({});
    }
    if meta["duration_source"] != "wav" && meta.get("lm_duration").is_none() {
        if let Some(claimed) = meta.get("duration").cloned() {
            meta["lm_duration"] = claimed;
        }
    }
}

/// Record measured facts without changing the submitted request or the audio bytes.
pub fn record_duration(seconds: f64, params: &Value, meta: &mut Value) {
    remember_claim(meta);
    meta["duration"] = json!(seconds);
    meta["duration_source"] = json!("wav");
    meta.as_object_mut().unwrap().remove("duration_warning");
    if let Some(requested) = requested_duration(params) {
        meta["requested_duration"] = json!(requested);
    }
    let limit = meta["duration_limit"].as_f64().filter(|limit| *limit > 0.0);
    if let Some(requested) = limit.or_else(|| requested_duration(params)) {
        let delta = seconds - requested;
        let too_short = delta < -tolerance(requested) - 1e-6
            && limit.is_none()
            && meta["duration_is_limit"] != true;
        if too_short || delta > tolerance(requested) + 1e-6 {
            meta["duration_warning"] = json!({
                "code":if seconds < requested { "short_audio" } else { "long_audio" },
                "requested_seconds":requested,"actual_seconds":seconds
            });
        }
    }
}

/// Preserve historical claims for diagnostics without presenting them as measured audio facts.
pub fn unknown_duration(params: &Value, meta: &mut Value) {
    remember_claim(meta);
    meta.as_object_mut().unwrap().remove("duration");
    meta.as_object_mut().unwrap().remove("duration_warning");
    meta["duration_source"] = json!("unknown");
    if let Some(requested) = requested_duration(params) {
        meta["requested_duration"] = json!(requested);
    }
}

/// Project truthful legacy durations using header-only reads, cached by file size and modification.
pub fn enrich_metadata(path: &Path, params: &Value, meta: &mut Value) -> Result<()> {
    match file_duration(path) {
        Ok(seconds) => {
            record_duration(seconds, params, meta);
            Ok(())
        }
        Err(error) => {
            unknown_duration(params, meta);
            Err(error)
        }
    }
}

pub(crate) fn file_duration(path: &Path) -> Result<f64> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Cached>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let metadata = std::fs::metadata(path)?;
    let signature = Signature {
        size: metadata.len(),
        modified: metadata.modified().ok(),
    };
    let cached = cache
        .lock()
        .unwrap()
        .get(path)
        .filter(|entry| entry.signature == signature && signature.modified.is_some())
        .map(|entry| entry.seconds);
    let seconds = if let Some(seconds) = cached {
        seconds
    } else {
        let seconds = wav::facts(&mut std::fs::File::open(path)?)?.duration_seconds;
        let mut cache = cache.lock().unwrap();
        if cache.len() >= 1024 {
            cache.clear();
        }
        cache.insert(path.into(), Cached { signature, seconds });
        seconds
    };
    Ok(seconds)
}
