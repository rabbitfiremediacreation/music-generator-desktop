use super::{gain_valid, ChannelFx};
use crate::stems::dsp::amplitude;
use serde::{Deserialize, Serialize};

pub(in crate::stems) const FX_SLOTS: usize = 4;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(in crate::stems) enum Effect {
    Off,
    Reverb {
        decay_s: f64,
        size: f64,
        damping_hz: f64,
    },
    Delay {
        time_ms: f64,
        feedback: f64,
        damping_hz: f64,
    },
    SlapDelay {
        time_ms: f64,
        spread_ms: f64,
        damping_hz: f64,
    },
    Chorus {
        rate_hz: f64,
        depth_ms: f64,
        stereo: f64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub(in crate::stems) struct FxReturn {
    pub effect: Effect,
    pub level: f64,
    #[serde(default = "super::enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gain_db: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gain_off: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx: Option<ChannelFx>,
}

pub(super) fn valid_send(level: f64) -> bool {
    (0.0..=100.0).contains(&level)
}

pub(super) fn empty_sends(sends: &[f64; FX_SLOTS]) -> bool {
    sends.iter().all(|send| *send == 0.0)
}

impl FxReturn {
    pub(in crate::stems) fn is_soloed(self) -> bool {
        self.enabled && self.solo && !matches!(self.effect, Effect::Off)
    }

    pub(in crate::stems) fn gain(self) -> f64 {
        if self.gain_off == Some(true) {
            return 0.0;
        }
        self.gain_db
            .map_or(self.level / 100.0, |db| amplitude(f64::from(db)))
    }

    pub(super) fn valid(self) -> bool {
        let damping = 800.0..=16_000.0;
        valid_send(self.level)
            && self.gain_db.is_none_or(gain_valid)
            && self.fx.is_none_or(|fx| fx.valid())
            && match self.effect {
                Effect::Off => true,
                Effect::Reverb {
                    decay_s,
                    size,
                    damping_hz,
                } => {
                    (0.2..=8.0).contains(&decay_s)
                        && (40.0..=150.0).contains(&size)
                        && damping.contains(&damping_hz)
                }
                Effect::Delay {
                    time_ms,
                    feedback,
                    damping_hz,
                } => {
                    (10.0..=1200.0).contains(&time_ms)
                        && (0.0..=90.0).contains(&feedback)
                        && damping.contains(&damping_hz)
                }
                Effect::SlapDelay {
                    time_ms,
                    spread_ms,
                    damping_hz,
                } => {
                    (45.0..=220.0).contains(&time_ms)
                        && (0.0..=60.0).contains(&spread_ms)
                        && damping.contains(&damping_hz)
                }
                Effect::Chorus {
                    rate_hz,
                    depth_ms,
                    stereo,
                } => {
                    (0.1..=5.0).contains(&rate_hz)
                        && (0.5..=12.0).contains(&depth_ms)
                        && valid_send(stereo)
                }
            }
    }
}

pub(in crate::stems) fn defaults() -> [FxReturn; FX_SLOTS] {
    [
        Effect::Reverb {
            decay_s: 1.8,
            size: 100.0,
            damping_hz: 6200.0,
        },
        Effect::Delay {
            time_ms: 360.0,
            feedback: 35.0,
            damping_hz: 7800.0,
        },
        Effect::SlapDelay {
            time_ms: 100.0,
            spread_ms: 18.0,
            damping_hz: 6800.0,
        },
        Effect::Chorus {
            rate_hz: 0.8,
            depth_ms: 5.0,
            stereo: 75.0,
        },
    ]
    .map(|effect| FxReturn {
        effect,
        level: 100.0,
        enabled: true,
        mute: false,
        solo: false,
        gain_db: None,
        gain_off: None,
        fx: None,
    })
}
