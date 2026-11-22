use super::{amplitude, Biquad};
use serde::{Deserialize, Serialize};

pub const MAX_EQ_BANDS: usize = 8;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct BandSettings {
    pub frequency_hz: f64,
    pub threshold_db: f64,
    pub reduction_db: f64,
}

impl BandSettings {
    pub fn valid(self, low: f64, high: f64) -> bool {
        (low..=high).contains(&self.frequency_hz)
            && (-60.0..=-3.0).contains(&self.threshold_db)
            && (1.0..=24.0).contains(&self.reduction_db)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct EqBandSettings {
    #[serde(flatten)]
    pub band: BandSettings,
    pub q: f64,
}

impl EqBandSettings {
    pub fn valid(self) -> bool {
        self.band.valid(40.0, 18_000.0) && (0.3..=12.0).contains(&self.q)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct DynamicEqSettings {
    pub bands: Vec<EqBandSettings>,
    pub bypass: bool,
}

impl DynamicEqSettings {
    pub fn is_default(&self) -> bool {
        self.bands.is_empty()
    }

    pub fn valid(&self) -> bool {
        self.bands.len() <= MAX_EQ_BANDS && self.bands.iter().all(|band| band.valid())
    }
}

pub struct Response {
    q: f64,
    attack_ms: f64,
    release_ms: f64,
    slope: f64,
}

impl Response {
    pub fn eq(q: f64) -> Self {
        Self {
            q,
            attack_ms: 8.0,
            release_ms: 100.0,
            slope: 0.65,
        }
    }

    pub fn de_esser() -> Self {
        Self {
            q: 0.9,
            attack_ms: 1.0,
            release_ms: 45.0,
            slope: 0.85,
        }
    }
}

pub struct DynamicBand {
    filter: Biquad,
    threshold: f64,
    attack: f64,
    release: f64,
    envelope: f64,
    slope: f64,
    reduction_db: f64,
}

impl DynamicBand {
    pub fn de_esser(amount: f64, rate: f64) -> Option<Self> {
        (amount > 0.0).then(|| {
            let strength = amount / 100.0;
            Self::new(
                BandSettings {
                    frequency_hz: 6500.0,
                    threshold_db: -18.0 - 20.0 * strength,
                    reduction_db: 12.0 * strength,
                },
                Response::de_esser(),
                rate,
            )
        })
    }

    pub fn new(settings: BandSettings, response: Response, rate: f64) -> Self {
        let coefficient = |ms: f64| 1.0 - (-1000.0 / (ms * rate)).exp();
        Self {
            filter: Biquad::band_pass(settings.frequency_hz, response.q, rate),
            threshold: amplitude(settings.threshold_db),
            attack: coefficient(response.attack_ms),
            release: coefficient(response.release_ms),
            envelope: 0.0,
            slope: response.slope,
            reduction_db: settings.reduction_db,
        }
    }

    /// Attenuate only the band-pass signal using a stereo-linked peak envelope.
    pub fn process(&mut self, pair: &mut [f64; 2], wet: f64) {
        let mut band = *pair;
        self.filter.process(&mut band);
        let level = band[0].abs().max(band[1].abs());
        let speed = if level > self.envelope {
            self.attack
        } else {
            self.release
        };
        self.envelope += (level - self.envelope) * speed;
        if self.envelope <= self.threshold || wet == 0.0 {
            return;
        }
        let above = 20.0 * (self.envelope / self.threshold).log10();
        let cut = (above * self.slope).min(self.reduction_db);
        let gain = (amplitude(-cut) - 1.0) * wet;
        for (sample, filtered) in pair.iter_mut().zip(band) {
            *sample += filtered * gain;
        }
    }
}
