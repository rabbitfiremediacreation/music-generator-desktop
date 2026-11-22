use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompressorMode {
    Standard,
    Optical,
    Fet,
    Vca,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct DynamicsSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attack_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub makeup_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knee_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limiter: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mix: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_ratio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brickwall: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optical: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<CompressorMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fet_attack_us: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fet_release_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fet_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vca_attack_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vca_release_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vca_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_gain: Option<bool>,
}

impl DynamicsSettings {
    pub(in crate::stems) fn brickwall_setting(&self) -> Option<bool> {
        self.brickwall.or(self.limit_ratio)
    }

    pub(in crate::stems) fn compressor_threshold(&self, comp: f64) -> f64 {
        self.threshold_db.unwrap_or(if comp > 0.0 {
            -36.0 * (comp / 100.0)
        } else {
            -18.0
        })
    }

    pub(in crate::stems) fn brickwall_threshold(&self, comp: f64) -> Option<f64> {
        self.brickwall_setting()
            .filter(|&active| active)
            .map(|_| self.compressor_threshold(comp))
    }

    pub(super) fn is_default(&self) -> bool {
        *self == Self::default()
    }

    pub(super) fn valid(&self) -> bool {
        self.attack_ms.is_none_or(|n| (0.1..=200.0).contains(&n))
            && self.release_ms.is_none_or(|n| (10.0..=1000.0).contains(&n))
            && self.makeup_db.is_none_or(|n| (-12.0..=18.0).contains(&n))
            && self.knee_db.is_none_or(|n| (0.0..=24.0).contains(&n))
            && self.mix.is_none_or(|n| (0.0..=100.0).contains(&n))
            && self.threshold_db.is_none_or(|n| (-60.0..=0.0).contains(&n))
            && self.ratio.is_none_or(|n| (1.0..=20.0).contains(&n))
            && self
                .fet_attack_us
                .is_none_or(|n| (20.0..=800.0).contains(&n))
            && self
                .fet_release_ms
                .is_none_or(|n| (50.0..=1100.0).contains(&n))
            && self
                .fet_ratio
                .is_none_or(|n| [4.0, 8.0, 12.0, 20.0].contains(&n))
            && self
                .vca_attack_ms
                .is_none_or(|n| [0.1, 0.3, 1.0, 3.0, 10.0, 30.0].contains(&n))
            && self
                .vca_release_ms
                .is_none_or(|n| [0.0, 100.0, 200.0, 400.0, 800.0, 1600.0].contains(&n))
            && self
                .vca_ratio
                .is_none_or(|n| [1.5, 2.0, 3.0, 4.0, 5.0, 10.0].contains(&n))
    }
}
