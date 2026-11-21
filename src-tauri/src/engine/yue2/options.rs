use crate::error::{message, Result};
use serde::{Deserialize, Serialize};

pub const DEFAULT_FLOW_STEPS: u32 = 32;
const MAX_TOKENS: u32 = 32_768;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Planning {
    Full,
    Melody,
    Off,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Yue2Options {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lm_seed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cot: Option<Planning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cfg_scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_clip: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abc_sampling: Option<Sampling>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_sampling: Option<Sampling>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Sampling {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repetition_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub penalty_window: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

impl Sampling {
    fn validate(&self, stage: &str, default_min: u32, default_max: u32) -> Result<()> {
        let maximum = self.max_tokens.unwrap_or(default_max);
        if self.temperature.is_some_and(|n| !(0.0..=5.0).contains(&n))
            || self.top_p.is_some_and(|n| !((n as f32) > 0.0 && n <= 1.0))
            || self.top_k.is_some_and(|n| n < 1)
            || self
                .repetition_penalty
                .is_some_and(|n| !(n as f32).is_finite() || n as f32 <= 0.0)
            || self.penalty_window.is_some_and(|n| !(1..=100).contains(&n))
            || !(1..=MAX_TOKENS).contains(&maximum)
            || self.min_tokens.unwrap_or(default_min) > maximum
        {
            return Err(message(format!("yue2_invalid_{stage}_sampling")));
        }
        Ok(())
    }
}

impl Yue2Options {
    pub(crate) fn validate(&self, instrumental: bool) -> Result<()> {
        let has_score = self
            .abc
            .as_deref()
            .is_some_and(|abc| !abc.trim().is_empty());
        if self
            .lm_seed
            .is_some_and(|n| !(-1..=i64::from(u32::MAX)).contains(&n))
            || self
                .steps
                .is_some_and(|n| !(1..=crate::generation_limits::MAX_INFERENCE_STEPS).contains(&n))
            || self
                .cfg_scale
                .is_some_and(|n| n != -1.0 && !(0.0..=10.0).contains(&n))
            || self.peak_clip.is_some_and(|n| n > 999)
        {
            return Err(message("yue2_invalid_options"));
        }
        if self
            .abc
            .as_deref()
            .is_some_and(|abc| abc.len() > 16 * 1024 || abc.contains('\0'))
        {
            return Err(message("yue2_invalid_score"));
        }
        if self.cot == Some(Planning::Off) && (instrumental || has_score) {
            return Err(message("yue2_score_requires_planning"));
        }
        if instrumental
            && has_score
            && super::score::instrumental_score(self.abc.as_deref().unwrap_or_default()).is_none()
        {
            return Err(message("yue2_invalid_instrumental_score"));
        }
        if let Some(sampling) = &self.abc_sampling {
            sampling.validate("abc", 32, 4096)?;
        }
        if let Some(sampling) = &self.semantic_sampling {
            sampling.validate("semantic", 200, 9000)?;
        }
        Ok(())
    }
}
