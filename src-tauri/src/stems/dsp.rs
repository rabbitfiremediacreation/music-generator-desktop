use super::mix::{ChannelFx, CompressorMode, DynamicsSettings, Mix, Track};
pub(super) mod dynamic_eq;
pub(super) mod returns;
use dynamic_eq::{DynamicBand, DynamicEqSettings, Response};

const IDENTITY: [f64; 5] = [1.0, 0.0, 0.0, 0.0, 0.0];

pub(super) fn amplitude(db: f64) -> f64 {
    10_f64.powf(db / 20.0)
}

#[derive(PartialEq)]
enum Band {
    LowPass,
    HighPass,
    Low,
    Mid,
    High,
}

fn eq(band: Band, frequency: f64, gain: f64, rate: f64) -> [f64; 5] {
    let pass = matches!(band, Band::LowPass | Band::HighPass);
    if !pass && gain == 0.0 {
        return IDENTITY;
    }
    let angle = std::f64::consts::TAU * frequency.min(rate * 0.45) / rate;
    let (s, c) = angle.sin_cos();
    let a = 10_f64.powf(gain / 40.0);
    let q = if band == Band::Mid {
        0.7
    } else {
        std::f64::consts::FRAC_1_SQRT_2
    };
    let alpha = s / (2.0 * q);
    let norm = |b0, b1, b2, a0, a1, a2| [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    if pass {
        let b = if band == Band::LowPass {
            (1.0 - c) / 2.0
        } else {
            (1.0 + c) / 2.0
        };
        let sign = if band == Band::LowPass { 2.0 } else { -2.0 };
        return norm(b, sign * b, b, 1.0 + alpha, -2.0 * c, 1.0 - alpha);
    }
    if band == Band::Mid {
        return norm(
            1.0 + alpha * a,
            -2.0 * c,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * c,
            1.0 - alpha / a,
        );
    }
    let plus = a + 1.0;
    let minus = a - 1.0;
    let slope = 2.0 * a.sqrt() * alpha;
    if band == Band::Low {
        return norm(
            a * (plus - minus * c + slope),
            2.0 * a * (minus - plus * c),
            a * (plus - minus * c - slope),
            plus + minus * c + slope,
            -2.0 * (minus + plus * c),
            plus + minus * c - slope,
        );
    }
    norm(
        a * (plus + minus * c + slope),
        -2.0 * a * (minus + plus * c),
        a * (plus + minus * c - slope),
        plus - minus * c + slope,
        2.0 * (minus - plus * c),
        plus - minus * c - slope,
    )
}

fn filter(value: f64, rate: f64) -> [f64; 5] {
    let amount = (value.abs() - 3.0) / 97.0;
    if amount <= 0.0 {
        return IDENTITY;
    }
    let (band, start, end) = if value < 0.0 {
        (Band::LowPass, 20_000_f64.min(rate * 0.45), 80.0)
    } else {
        (Band::HighPass, 20.0, 5_000_f64.min(rate * 0.45))
    };
    let frequency = start * (end / start).powf(amount);
    let [b0, b1, b2, a1, a2] = eq(band, frequency, 0.0, rate);
    let wet = ((value.abs() - 3.0) / 8.0).min(1.0);
    [
        1.0 + (b0 - 1.0) * wet,
        a1 + (b1 - a1) * wet,
        a2 + (b2 - a2) * wet,
        a1,
        a2,
    ]
}

pub(super) struct Biquad {
    coefficients: [f64; 5],
    delays: [[f64; 2]; 2],
    bypass: bool,
}

impl Biquad {
    pub(super) fn band_pass(frequency: f64, q: f64, rate: f64) -> Self {
        let (sin, cos) = (std::f64::consts::TAU * frequency / rate).sin_cos();
        let alpha = sin / (2.0 * q);
        let a0 = 1.0 + alpha;
        Self::new([
            alpha / a0,
            0.0,
            -alpha / a0,
            -2.0 * cos / a0,
            (1.0 - alpha) / a0,
        ])
    }

    fn new(coefficients: [f64; 5]) -> Self {
        Self {
            coefficients,
            delays: [[0.0; 2]; 2],
            bypass: coefficients == IDENTITY,
        }
    }

    pub(super) fn process(&mut self, pair: &mut [f64; 2]) {
        if self.bypass {
            return;
        }
        let [b0, b1, b2, a1, a2] = self.coefficients;
        for (sample, [z1, z2]) in pair.iter_mut().zip(&mut self.delays) {
            let input = *sample;
            let output = input * b0 + *z1;
            *z1 = input * b1 - output * a1 + *z2;
            *z2 = input * b2 - output * a2;
            *sample = output;
        }
    }
}

struct ProgramRelease {
    pressure: f64,
    tracking: f64,
    slow_release: f64,
    depth: f64,
}

struct Dynamics {
    threshold: f64,
    slope: f64,
    wet: f64,
    drive: f64,
    limiting: bool,
    ceiling: f64,
    clip_ceiling: Option<f64>,
    attack: f64,
    release: f64,
    limit_release: f64,
    reduction: f64,
    optical: bool,
    optical_memory: f64,
    optical_charge: f64,
    optical_release: f64,
    program_release: Option<ProgramRelease>,
    limit_gain: f64,
    makeup: f64,
    half_knee: f64,
}

impl Dynamics {
    fn new(comp: f64, limit: f64, settings: DynamicsSettings, rate: f64) -> Self {
        let coefficient = |ms: f64| 1.0 - (-1.0 / (rate * ms / 1000.0)).exp();
        let mode = settings.mode.unwrap_or(if settings.optical == Some(true) {
            CompressorMode::Optical
        } else {
            CompressorMode::Standard
        });
        let optical = mode == CompressorMode::Optical;
        let fet = mode == CompressorMode::Fet;
        let vca = mode == CompressorMode::Vca;
        let vca_release = settings.vca_release_ms.unwrap_or(0.0);
        let vca_auto = vca && vca_release == 0.0;
        let (attack, release) = match mode {
            CompressorMode::Fet => (
                settings.fet_attack_us.unwrap_or(100.0) / 1000.0,
                settings.fet_release_ms.unwrap_or(100.0),
            ),
            CompressorMode::Vca => (
                settings.vca_attack_ms.unwrap_or(10.0),
                if vca_auto { 100.0 } else { vca_release },
            ),
            _ => (
                settings.attack_ms.unwrap_or(10.0),
                settings.release_ms.unwrap_or(120.0),
            ),
        };
        let strength = comp / 100.0;
        let has_makeup = settings.makeup_db.unwrap_or(0.0) != 0.0;
        let auto_gain = settings.auto_gain == Some(true);
        let parallel = fet
            || vca
            || auto_gain
            || settings.mix.is_some()
            || settings.threshold_db.is_some()
            || settings.ratio.is_some();
        let (threshold, ratio, wet) = if parallel {
            let threshold = settings.compressor_threshold(comp);
            let ratio = match mode {
                CompressorMode::Fet => settings.fet_ratio.unwrap_or(4.0),
                CompressorMode::Vca => settings.vca_ratio.unwrap_or(2.0),
                _ => settings.ratio.unwrap_or(if strength > 0.0 {
                    1.0 + 7.0 * strength
                } else if has_makeup {
                    1.0
                } else {
                    2.0
                }),
            };
            let wet = settings.mix.unwrap_or(if strength > 0.0 || has_makeup {
                100.0
            } else {
                0.0
            }) / 100.0;
            (threshold, ratio, wet)
        } else {
            (-36.0 * strength, 1.0 + 7.0 * strength, 1.0)
        };
        let slope = 1.0 / ratio - 1.0;
        let makeup = if auto_gain {
            (threshold * slope / 2.0).min(18.0)
        } else {
            settings.makeup_db.unwrap_or(0.0)
        };
        let knee_scale = if vca { 1.0 + 2.0 / ratio } else { 1.0 };
        Self {
            threshold,
            slope,
            wet,
            drive: amplitude(12.0 * limit / 100.0),
            limiting: settings.brickwall_setting().is_none()
                && settings.limiter.unwrap_or(limit > 0.0),
            ceiling: amplitude(-1.0),
            clip_ceiling: settings.brickwall_threshold(comp).map(amplitude),
            attack: coefficient(attack),
            release: coefficient(if optical { release / 4.0 } else { release }),
            limit_release: coefficient(settings.release_ms.unwrap_or(if limit > 0.0 {
                80.0
            } else {
                120.0
            })),
            reduction: 0.0,
            optical,
            optical_memory: 0.0,
            optical_charge: coefficient(250.0),
            optical_release: coefficient(release * 8.0),
            program_release: (fet || vca_auto).then(|| ProgramRelease {
                pressure: 0.0,
                tracking: coefficient(if vca { 250.0 } else { 150.0 }),
                slow_release: coefficient(if vca { 1200.0 } else { release * 3.0 }),
                depth: if vca { 6.0 } else { 12.0 },
            }),
            limit_gain: 1.0,
            makeup: amplitude(makeup),
            half_knee: settings.knee_db.unwrap_or(6.0) / 2.0 * knee_scale,
        }
    }

    fn compress(&mut self, pair: &mut [f64; 2]) {
        if self.wet == 0.0 {
            return;
        }
        if self.slope != 0.0 {
            let peak = pair[0].abs().max(pair[1].abs());
            let over = 20.0 * peak.log10() - self.threshold;
            let knee = self.half_knee;
            let wanted = if over <= -knee {
                0.0
            } else if over >= knee {
                self.slope * over
            } else {
                self.slope * (over + knee).powi(2) / (4.0 * knee)
            };
            let mut release = self.release;
            if let Some(program) = &mut self.program_release {
                let pressure = (-wanted / program.depth).min(1.0);
                program.pressure += (pressure - program.pressure) * program.tracking;
                if program.pressure < 1e-9 {
                    program.pressure = 0.0;
                }
                release += (program.slow_release - release) * program.pressure;
            }
            let time = if wanted < self.reduction {
                self.attack
            } else {
                release
            };
            self.reduction += (wanted - self.reduction) * time;
            if self.reduction.abs() < 1e-9 {
                self.reduction = 0.0;
            }
            if self.optical {
                let time = if wanted < self.optical_memory {
                    self.optical_charge
                } else {
                    self.optical_release
                };
                self.optical_memory += (wanted - self.optical_memory) * time;
                if self.optical_memory.abs() < 1e-9 {
                    self.optical_memory = 0.0;
                }
            }
        }
        let envelope = if self.optical {
            (self.reduction + self.reduction.min(self.optical_memory)) / 2.0
        } else {
            self.reduction
        };
        let wet_gain = amplitude(envelope) * self.makeup;
        let gain = if self.wet == 1.0 {
            wet_gain
        } else {
            1.0 + (wet_gain - 1.0) * self.wet
        };
        pair[0] *= gain;
        pair[1] *= gain;
    }

    fn limit(&mut self, pair: &mut [f64; 2]) {
        if let Some(ceiling) = self.clip_ceiling {
            pair[0] = pair[0].clamp(-ceiling, ceiling);
            pair[1] = pair[1].clamp(-ceiling, ceiling);
            return;
        }
        if !self.limiting {
            return;
        }
        let peak = pair[0].abs().max(pair[1].abs()) * self.drive;
        let wanted = if peak > self.ceiling {
            self.ceiling / peak
        } else {
            1.0
        };
        self.limit_gain =
            wanted.min(self.limit_gain + (1.0 - self.limit_gain) * self.limit_release);
        let gain = self.drive * self.limit_gain;
        pair[0] *= gain;
        pair[1] *= gain;
    }
}

/// Processing order mirrors the realtime strip, with immutable export controls.
pub(super) struct Strip {
    filters: [Biquad; 4],
    dynamic_eq: Vec<DynamicBand>,
    de_esser: Option<DynamicBand>,
    dynamics: Dynamics,
    width: f64,
    left: f64,
    right: f64,
}

impl Strip {
    pub(super) fn new(track: &Track, rate: f64) -> Self {
        let gain = if track.gain_off {
            0.0
        } else {
            amplitude(f64::from(track.gain_db))
        };
        Self::with_settings(
            track.fx,
            &track.dynamic_eq,
            gain,
            f64::from(track.pan),
            rate,
        )
    }

    fn with_settings(
        fx: ChannelFx,
        dynamic_eq: &DynamicEqSettings,
        gain: f64,
        pan: f64,
        rate: f64,
    ) -> Self {
        let ChannelFx {
            low_db,
            mid_db,
            high_db,
            comp,
            limit,
            width,
            filter: cutoff,
            de_ess,
            dynamics,
        } = fx;
        Self {
            filters: [
                filter(cutoff, rate),
                eq(Band::Low, 100.0, low_db, rate),
                eq(Band::Mid, 1000.0, mid_db, rate),
                eq(Band::High, 10_000.0, high_db, rate),
            ]
            .map(Biquad::new),
            dynamic_eq: dynamic_eq
                .bands
                .iter()
                .filter(|_| !dynamic_eq.bypass)
                .map(|band| DynamicBand::new(band.band, Response::eq(band.q), rate))
                .collect(),
            de_esser: DynamicBand::de_esser(de_ess, rate),
            dynamics: Dynamics::new(comp, limit, dynamics, rate),
            width: width / 100.0,
            left: gain * (1.0 - pan.max(0.0)),
            right: gain * (1.0 + pan.min(0.0)),
        }
    }

    pub(super) fn process(&mut self, pair: &mut [f64; 2], fade: f64) {
        for band in &mut self.filters {
            band.process(pair);
        }
        for band in &mut self.dynamic_eq {
            band.process(pair, 1.0);
        }
        if let Some(de_esser) = &mut self.de_esser {
            de_esser.process(pair, 1.0);
        }
        self.dynamics.compress(pair);
        if self.width != 1.0 {
            let mid = (pair[0] + pair[1]) / 2.0;
            let side = (pair[0] - pair[1]) * self.width / 2.0;
            *pair = [mid + side, mid - side];
        }
        pair[0] *= self.left * fade;
        pair[1] *= self.right * fade;
        self.dynamics.limit(pair);
    }
}

pub(super) struct Master {
    dynamics: Dynamics,
    gain: f64,
}

impl Master {
    pub(super) fn new(mix: &Mix, rate: f64) -> Self {
        let gain = if mix.master_off {
            0.0
        } else {
            amplitude(f64::from(mix.master_db))
        };
        Self {
            dynamics: Dynamics::new(mix.master_comp, mix.master_limit, mix.master_dynamics, rate),
            gain,
        }
    }

    pub(super) fn process(&mut self, pair: &mut [f64; 2]) {
        self.dynamics.compress(pair);
        pair[0] *= self.gain;
        pair[1] *= self.gain;
        self.dynamics.limit(pair);
    }
}
