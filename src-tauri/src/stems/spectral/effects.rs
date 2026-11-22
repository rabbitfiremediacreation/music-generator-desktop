mod dynamic;
mod impulse;

use crate::{
    error::Result,
    stems::dsp::dynamic_eq::{BandSettings, EqBandSettings, Response, MAX_EQ_BANDS},
};
use serde::Deserialize;
use std::ops::Range;
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum Effect {
    DeClick {
        sensitivity: f64,
    },
    DeCrackle {
        sensitivity: f64,
    },
    DynamicEq {
        #[serde(flatten)]
        configuration: EqConfiguration,
    },
    DeEsser(BandSettings),
}

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum EqConfiguration {
    Multiple { bands: Vec<EqBandSettings> },
    Single(EqBandSettings),
}

impl EqConfiguration {
    fn bands(&self) -> &[EqBandSettings] {
        match self {
            Self::Multiple { bands } => bands,
            Self::Single(band) => std::slice::from_ref(band),
        }
    }
}

impl Effect {
    pub fn valid(&self) -> bool {
        match self {
            Self::DeClick { sensitivity } | Self::DeCrackle { sensitivity } => {
                (1.0..=100.0).contains(sensitivity)
            }
            Self::DynamicEq { configuration } => {
                let bands = configuration.bands();
                (1..=MAX_EQ_BANDS).contains(&bands.len()) && bands.iter().all(|band| band.valid())
            }
            Self::DeEsser(band) => band.valid(2500.0, 12_000.0),
        }
    }

    pub fn process(
        &self,
        audio: &mut [[f32; 2]],
        range: Range<usize>,
        cancel: &CancellationToken,
    ) -> Result<()> {
        match self {
            Self::DeClick { sensitivity } => {
                impulse::repair(audio, range, impulse::Settings::click(*sensitivity), cancel)
            }
            Self::DeCrackle { sensitivity } => impulse::repair(
                audio,
                range,
                impulse::Settings::crackle(*sensitivity),
                cancel,
            ),
            Self::DynamicEq { configuration } => {
                for band in configuration.bands() {
                    dynamic::reduce(
                        audio,
                        range.clone(),
                        band.band,
                        Response::eq(band.q),
                        cancel,
                    )?;
                }
                Ok(())
            }
            Self::DeEsser(band) => {
                dynamic::reduce(audio, range, *band, Response::de_esser(), cancel)
            }
        }
    }
}
