use crate::engine::progress::Progress;

#[derive(Default)]
pub(super) struct Yue2Progress {
    chunks: u32,
    completed_chunks: u32,
}

impl Yue2Progress {
    pub(super) fn parse(&mut self, line: &str) -> Option<Progress> {
        for (prefix, phase) in [("[AR] Score ", "planning"), ("[AR] Semantic ", "lm")] {
            if let Some(counts) = line.strip_prefix(prefix).and_then(step_counts) {
                return Some(steps(phase, counts));
            }
        }
        if let Some(song) = line.strip_prefix("[NAR] Song ") {
            if let Some((_, count)) = song
                .split_once(", prefix ")
                .and_then(|(_, s)| s.split_once(", "))
            {
                self.chunks = count.split_whitespace().next()?.parse().ok()?;
                self.completed_chunks = 0;
                return Some(Progress::new("synth"));
            }
            if let Some((completed, total)) =
                song.split_once(" chunk ").and_then(|(_, s)| step_counts(s))
            {
                self.completed_chunks = completed;
                self.chunks = total;
            }
        }
        if let Some((step, total)) = line.strip_prefix("[NAR] Step ").and_then(step_counts) {
            let completed = self
                .completed_chunks
                .checked_mul(total)?
                .checked_add(step)?;
            return Some(steps(
                "synth",
                (completed, self.chunks.max(1).checked_mul(total)?),
            ));
        }
        if line.starts_with("[VAE] Track ") {
            return Some(Progress::new("vae"));
        }
        None
    }
}

fn step_counts(line: &str) -> Option<(u32, u32)> {
    let (step, total) = line.split([',', ':', ' ']).next()?.split_once('/')?;
    let (step, total) = (step.parse().ok()?, total.parse().ok()?);
    (total > 0 && step <= total).then_some((step, total))
}

fn steps(phase: &'static str, (step, total): (u32, u32)) -> Progress {
    Progress {
        step: Some(step),
        total_steps: Some(total),
        ..Progress::new(phase)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_token_budgets_and_counts_synthesis_steps_across_chunks() {
        let mut log = Yue2Progress::default();
        assert_eq!(
            log.parse("[AR] Score 100/4096"),
            Some(steps("planning", (100, 4096)))
        );
        assert_eq!(
            log.parse("[AR] Semantic 500/3000"),
            Some(steps("lm", (500, 3000)))
        );
        assert_eq!(log.parse("[AR] Semantic prefill: 42 ms, CFG=1.00"), None);
        log.parse("[NAR] Song 0: 3000 frames (120.0 s), prefix 85, 2 chunks of 2000, 1 variation");
        assert_eq!(
            log.parse("[NAR] Step 24/32, 100 ms"),
            Some(steps("synth", (24, 64)))
        );
        log.parse("[NAR] Song 0 chunk 1/2: 2000 frames, cache 2070 rows, 0 forwarded");
        assert_eq!(
            log.parse("[NAR] Step 1/32, 110 ms"),
            Some(steps("synth", (33, 64)))
        );
        assert_eq!(
            log.parse("[VAE] Track 1/1: song 0 variation 0"),
            Some(Progress::new("vae"))
        );
    }
}
