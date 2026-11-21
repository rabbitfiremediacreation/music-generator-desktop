use super::mix::{ChannelFx, Mix, Track};

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

struct Biquad {
    coefficients: [f64; 5],
    delays: [[f64; 2]; 2],
    bypass: bool,
}

impl Biquad {
    fn new(coefficients: [f64; 5]) -> Self {
        Self {
            coefficients,
            delays: [[0.0; 2]; 2],
            bypass: coefficients == IDENTITY,
        }
    }

    fn process(&mut self, pair: &mut [f64; 2]) {
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

struct Dynamics {
    comp: f64,
    drive: f64,
    limiting: bool,
    ceiling: f64,
    attack: f64,
    release: f64,
    limit_release: f64,
    reduction: f64,
    limit_gain: f64,
}

impl Dynamics {
    fn new(comp: f64, limit: f64, rate: f64) -> Self {
        let coefficient = |seconds: f64| 1.0 - (-1.0 / (rate * seconds)).exp();
        Self {
            comp: comp / 100.0,
            drive: amplitude(12.0 * limit / 100.0),
            limiting: limit > 0.0,
            ceiling: amplitude(-1.0),
            attack: coefficient(0.010),
            release: coefficient(0.120),
            limit_release: coefficient(0.080),
            reduction: 0.0,
            limit_gain: 1.0,
        }
    }

    fn compress(&mut self, pair: &mut [f64; 2]) {
        if self.comp == 0.0 {
            return;
        }
        let peak = pair[0].abs().max(pair[1].abs());
        let over = 20.0 * peak.log10() + 36.0 * self.comp;
        let slope = 1.0 / (1.0 + 7.0 * self.comp) - 1.0;
        let wanted = if over <= -3.0 {
            0.0
        } else if over >= 3.0 {
            slope * over
        } else {
            slope * (over + 3.0).powi(2) / 12.0
        };
        let time = if wanted < self.reduction {
            self.attack
        } else {
            self.release
        };
        self.reduction += (wanted - self.reduction) * time;
        if self.reduction.abs() < 1e-9 {
            self.reduction = 0.0;
        }
        let gain = amplitude(self.reduction);
        pair[0] *= gain;
        pair[1] *= gain;
    }

    fn limit(&mut self, pair: &mut [f64; 2]) {
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
    dynamics: Dynamics,
    width: f64,
    left: f64,
    right: f64,
}

impl Strip {
    pub(super) fn new(track: &Track, rate: f64) -> Self {
        let ChannelFx {
            low_db,
            mid_db,
            high_db,
            comp,
            limit,
            width,
            filter: cutoff,
        } = track.fx;
        let gain = if track.gain_off {
            0.0
        } else {
            amplitude(f64::from(track.gain_db))
        };
        let pan = f64::from(track.pan);
        Self {
            filters: [
                filter(cutoff, rate),
                eq(Band::Low, 100.0, low_db, rate),
                eq(Band::Mid, 1000.0, mid_db, rate),
                eq(Band::High, 10_000.0, high_db, rate),
            ]
            .map(Biquad::new),
            dynamics: Dynamics::new(comp, limit, rate),
            width: width / 100.0,
            left: gain * (1.0 - pan.max(0.0)),
            right: gain * (1.0 + pan.min(0.0)),
        }
    }

    pub(super) fn process(&mut self, pair: &mut [f64; 2], fade: f64) {
        for band in &mut self.filters {
            band.process(pair);
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
            dynamics: Dynamics::new(mix.master_comp, mix.master_limit, rate),
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
