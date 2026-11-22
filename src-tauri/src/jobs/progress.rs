use crate::engine::progress::Progress;

pub(super) const RENDERED_PERCENT: u8 = 94;

/// Estimate render progress from phase milestones and measured steps. Equal-length sections
/// each receive the same share of the render budget, with the end reserved for title and saving.
pub(super) fn render_percent(
    progress: &Progress,
    section: u32,
    sections: u32,
    has_token_stages: bool,
) -> u8 {
    let (start, end) = match progress.phase {
        "starting" => (0.0, 0.0),
        "loading" | "generation" => (2.0, 93.0),
        "planning" => (4.0, 24.0),
        "lm" => (24.0, 60.0),
        "synth" | "dit" if !has_token_stages => (2.0, 93.0),
        "synth" | "dit" => (60.0, 93.0),
        "vae" => (93.0, 100.0),
        _ => (0.0, 0.0),
    };
    let fraction = match (progress.step, progress.total_steps) {
        (Some(step), Some(total)) if total > 0 => f64::from(step.min(total)) / f64::from(total),
        _ => 0.0,
    };
    let phase_percent = start + (end - start) * fraction;
    let render_fraction = (f64::from(section - 1) + phase_percent / 100.0) / f64::from(sections);
    (2.0 + f64::from(RENDERED_PERCENT - 2) * render_fraction) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steps(phase: &'static str, step: u32, total_steps: u32) -> Progress {
        Progress {
            step: Some(step),
            total_steps: Some(total_steps),
            ..Progress::new(phase)
        }
    }

    #[test]
    fn phase_steps_share_one_progress_scale_across_render_sections() {
        let milestones = [
            render_percent(&steps("planning", 100, 200), 1, 2, true),
            render_percent(&steps("lm", 40, 100), 1, 2, true),
            render_percent(&steps("synth", 24, 32), 1, 2, true),
            render_percent(&Progress::new("vae"), 1, 2, true),
            render_percent(&Progress::new("starting"), 2, 2, true),
            render_percent(&steps("planning", 100, 200), 2, 2, true),
            render_percent(&steps("synth", 24, 32), 2, 2, true),
        ];
        assert!(milestones.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(milestones[4], 48);
        assert!(milestones[6] < RENDERED_PERCENT);
    }
}
