use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub models_dir: String,
    pub songs_dir: String,
    pub lm_model: String,
    pub model_provider: String,
    pub synthesis_model: String,
    pub model_profiles: std::collections::BTreeMap<String, crate::catalog::Selection>,
    pub dit: String,
    pub lm_device: String,
    pub export_format: String,
    pub expert_mode: bool,
    pub poll_interval: f64,
    pub timeout_minutes: f64,
    pub mode: String,
    pub vae_chunk: Option<u32>,
    pub tested_fingerprint: String,
    pub setup_complete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            models_dir: String::new(),
            songs_dir: String::new(),
            lm_model: String::new(),
            model_provider: "ace-step".into(),
            synthesis_model: String::new(),
            model_profiles: Default::default(),
            dit: "standard".into(),
            lm_device: "auto".into(),
            export_format: "wav".into(),
            expert_mode: false,
            poll_interval: 1.5,
            timeout_minutes: 30.0,
            mode: "single".into(),
            vae_chunk: None,
            tested_fingerprint: String::new(),
            setup_complete: false,
        }
    }
}

impl Settings {
    pub fn cpu_lm(&self) -> bool {
        self.lm_device == "cpu" || self.mode == "split"
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GenerateRequest {
    pub model_selection: Option<crate::catalog::Selection>,
    pub prompt: String,
    pub style: String,
    pub caption: String,
    pub lyrics: String,
    pub instrumental: bool,
    pub keep_caption: bool,
    pub title: String,
    pub duration: f64,
    pub bpm: u32,
    pub keyscale: String,
    pub timesignature: String,
    pub vocal_language: String,
    pub seed: i64,
    pub variants: u32,
    pub inference_steps: u32,
    pub lm_temperature: Option<f64>,
    pub group_id: Option<String>,
    pub folder_id: Option<String>,
}

impl Default for GenerateRequest {
    fn default() -> Self {
        Self {
            model_selection: None,
            prompt: String::new(),
            style: String::new(),
            caption: String::new(),
            lyrics: String::new(),
            instrumental: true,
            keep_caption: true,
            title: String::new(),
            duration: 0.0,
            bpm: 0,
            keyscale: String::new(),
            timesignature: String::new(),
            vocal_language: String::new(),
            seed: -1,
            variants: 1,
            inference_steps: 0,
            lm_temperature: None,
            group_id: None,
            folder_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub id: String,
    pub group_id: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub status: String,
    pub message: Option<String>,
    pub title: Option<String>,
    pub caption: String,
    pub lyrics: Option<String>,
    pub seed: i64,
    pub params: Value,
    pub result_meta: Option<Value>,
    pub engine: Option<String>,
    pub file: Option<String>,
    pub audio_missing: bool,
    pub favorite: bool,
    pub folder_id: Option<String>,
    pub letter: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SongFilter {
    pub id: String,
    pub q: String,
    pub favorites: bool,
    pub group: String,
    pub folder: String,
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
