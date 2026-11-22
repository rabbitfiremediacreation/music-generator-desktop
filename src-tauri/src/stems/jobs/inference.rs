use serde::{Deserialize, Serialize};

/// Optional overrides keep saved requests compatible with the original CPU adapter.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Inference {
    pub shifts: u8,
    pub segment: Option<f64>,
    pub no_split: bool,
    pub transition_power: Option<f64>,
    pub num_workers: u8,
}

impl Inference {
    pub(super) fn window_frames(&self) -> u64 {
        let rate = u64::from(super::model::RATE);
        let shift_padding = if self.shifts > 0 { rate / 2 } else { 0 };
        rate * 39 / 5 - shift_padding
    }

    pub(super) fn fits_window(&self, frames: u64) -> bool {
        !self.no_split || frames <= self.window_frames()
    }

    pub(super) fn valid(&self) -> bool {
        self.shifts <= 10
            && self.num_workers <= 4
            && self.segment.is_none_or(|s| (1.0..=7.8).contains(&s))
            && self
                .transition_power
                .is_none_or(|p| (1.0..=4.0).contains(&p))
            && (!self.no_split || self.segment.is_none())
    }
}

pub(super) fn supported_output(role: &str, native: &[&str]) -> bool {
    native.contains(&role)
        || matches!(role, "instrumental" | "residual")
        || role
            .strip_prefix("no_")
            .is_some_and(|source| source != "vocals" && native.contains(&source))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_window_reserves_shift_padding_at_the_native_rate() {
        let mut options = Inference {
            no_split: true,
            ..Default::default()
        };
        assert!(options.fits_window(343_980));
        assert!(!options.fits_window(343_981));
        options.shifts = 2;
        assert!(options.fits_window(321_930));
        assert!(!options.fits_window(321_931));
        options.segment = Some(7.0);
        assert!(!options.valid());
    }

    #[test]
    fn complements_follow_the_selected_checkpoint() {
        let four = crate::stems::model::get("htdemucs").unwrap().roles;
        let six = crate::stems::model::get("htdemucs-6s").unwrap().roles;
        assert!(supported_output("residual", four));
        assert!(supported_output("instrumental", four));
        assert!(!supported_output("piano", four));
        assert!(!supported_output("no_piano", four));
        assert!(supported_output("no_piano", six));
        assert!(!supported_output("no_residual", six));
    }
}
