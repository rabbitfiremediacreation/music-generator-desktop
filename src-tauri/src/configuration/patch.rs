use crate::{
    error::{message, Result},
    types::{Settings, UpdateStream},
};
use std::path::Path;

#[derive(Default, serde::Deserialize)]
#[serde(default)]
pub struct SettingsPatch {
    pub expert_mode: Option<bool>,
    pub generate_cover_art: Option<bool>,
    pub update_stream: Option<UpdateStream>,
    pub cpu_iteration_behavior: Option<crate::types::CpuIterationBehavior>,
    pub lm_device: Option<String>,
    pub export_format: Option<String>,
    pub timeout_minutes: Option<f64>,
    pub dit: Option<String>,
    pub songs_dir: Option<String>,
}

impl SettingsPatch {
    pub(super) fn preferences_only(&self) -> bool {
        (self.expert_mode.is_some()
            || self.generate_cover_art.is_some()
            || self.cpu_iteration_behavior.is_some()
            || self.update_stream.is_some())
            && self.lm_device.is_none()
            && self.export_format.is_none()
            && self.timeout_minutes.is_none()
            && self.dit.is_none()
            && self.songs_dir.is_none()
    }

    pub(super) fn apply(
        self,
        mut settings: Settings,
        root: &Path,
        resources: &Path,
    ) -> Result<Settings> {
        let selection_changed = self.dit.is_some();
        if let Some(enabled) = self.expert_mode {
            settings.expert_mode = enabled;
        }
        if let Some(enabled) = self.generate_cover_art {
            settings.generate_cover_art = enabled;
        }
        if let Some(behavior) = self.cpu_iteration_behavior {
            settings.cpu_iteration_behavior = behavior;
        }
        if let Some(stream) = self.update_stream {
            settings.update_stream = stream;
        }
        if let Some(device) = self.lm_device {
            settings.lm_device = device;
        }
        if let Some(format) = self.export_format {
            let selected = crate::audio_export::AudioFormat::parse(&format)?;
            if format != settings.export_format
                && !crate::audio_export::available(resources).contains(&selected)
            {
                return Err(message("audio_export_format_unavailable"));
            }
            settings.export_format = format;
        }
        if let Some(timeout) = self.timeout_minutes {
            settings.timeout_minutes = timeout;
        }
        if let Some(dit) = self.dit {
            settings.dit = dit;
            settings.synthesis_model.clear();
        }
        if let Some(dir) = self.songs_dir {
            settings.songs_dir = if dir.is_empty() {
                root.join("songs").to_string_lossy().into()
            } else {
                dir
            };
        }
        validate_settings(&settings)?;
        if selection_changed {
            crate::catalog::ensure_allowed(
                &crate::catalog::Selection::from_settings(&settings),
                settings.expert_mode,
            )?;
        }
        if settings.synthesis_model.is_empty()
            && settings.dit == "xl"
            && !Path::new(&settings.models_dir)
                .join("acestep-v15-xl-sft-Q8_0.gguf")
                .is_file()
        {
            return Err(message("Download the XL model in model setup first"));
        }
        Ok(settings)
    }
}

pub fn validate_settings(settings: &Settings) -> Result<()> {
    if !["auto", "cpu"].contains(&settings.lm_device.as_str()) {
        return Err(message("Unknown language model device"));
    }
    crate::audio_export::AudioFormat::parse(&settings.export_format)?;
    if !settings.poll_interval.is_finite()
        || !(0.1..=60.0).contains(&settings.poll_interval)
        || !settings.timeout_minutes.is_finite()
        || !(1.0..=600.0).contains(&settings.timeout_minutes)
    {
        return Err(message("Invalid timeout or poll interval"));
    }
    if !["standard", "xl"].contains(&settings.dit.as_str()) {
        return Err(message("Unknown synthesis model"));
    }
    for path in [&settings.models_dir, &settings.songs_dir] {
        if !std::path::Path::new(path).is_absolute() {
            return Err(message("Select an absolute data folder"));
        }
    }
    Ok(())
}
