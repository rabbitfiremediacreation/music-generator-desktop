use super::{DynamicEqSettings, Strip};
use crate::stems::mix::returns::{Effect, FxReturn, FX_SLOTS};
use std::f64::consts::{PI, TAU};

pub(in crate::stems) type Inputs = [[f64; 2]; FX_SLOTS];

fn frames(ms: f64, rate: f64) -> f64 {
    ms * rate / 1000.0
}

fn low_pass(hz: f64, rate: f64) -> f64 {
    1.0 - (-TAU * hz / rate).exp()
}

struct DelayLine {
    samples: Vec<f64>,
    cursor: usize,
}

impl DelayLine {
    fn new(rate: f64, max_ms: f64) -> Self {
        Self {
            samples: vec![0.0; frames(max_ms, rate).ceil() as usize + 2],
            cursor: 0,
        }
    }

    fn read(&self, delay: f64) -> f64 {
        let length = self.samples.len();
        let position = (self.cursor + length) as f64 - delay;
        let first = position as usize;
        let fraction = position - first as f64;
        let value = self.samples[first % length];
        value + (self.samples[(first + 1) % length] - value) * fraction
    }

    fn push(&mut self, value: f64) {
        self.samples[self.cursor] = value;
        self.cursor = (self.cursor + 1) % self.samples.len();
    }
}

struct Echo {
    lines: [DelayLine; 2],
    taps: [f64; 2],
    feedback: f64,
    tone: f64,
    output: [f64; 2],
}

impl Echo {
    fn new(rate: f64, time_ms: f64, spread_ms: f64, feedback: f64, damping_hz: f64) -> Self {
        Self {
            lines: std::array::from_fn(|_| DelayLine::new(rate, time_ms + spread_ms)),
            taps: [
                frames(time_ms, rate),
                frames(time_ms, rate) + frames(spread_ms, rate),
            ],
            feedback: feedback / 100.0,
            tone: low_pass(damping_hz, rate),
            output: [0.0; 2],
        }
    }

    fn process(&mut self, input: [f64; 2]) -> [f64; 2] {
        for (channel, sample) in input.into_iter().enumerate() {
            let line = &mut self.lines[channel];
            let output = &mut self.output[channel];
            *output += (line.read(self.taps[channel]) - *output) * self.tone;
            line.push(sample + *output * self.feedback);
        }
        self.output
    }
}

struct Chorus {
    lines: [DelayLine; 2],
    phase: f64,
    step: f64,
    depth: f64,
    center: f64,
    stereo: f64,
}

impl Chorus {
    fn new(rate: f64, rate_hz: f64, depth_ms: f64, stereo: f64) -> Self {
        Self {
            lines: std::array::from_fn(|_| DelayLine::new(rate, 30.0)),
            phase: 0.0,
            step: TAU * rate_hz / rate,
            depth: frames(depth_ms, rate),
            center: frames(18.0, rate),
            stereo: PI * stereo / 100.0,
        }
    }

    fn process(&mut self, input: [f64; 2]) -> [f64; 2] {
        let output = [
            self.lines[0].read(self.center + self.phase.sin() * self.depth),
            self.lines[1].read(self.center + (self.phase + self.stereo).sin() * self.depth),
        ];
        for (line, sample) in self.lines.iter_mut().zip(input) {
            line.push(sample);
        }
        self.phase += self.step;
        if self.phase >= TAU {
            self.phase -= TAU;
        }
        output
    }
}

/// Four damped delay lines scatter reflections through an orthogonal feedback matrix.
struct Reverb {
    lines: [DelayLine; 4],
    taps: [f64; 4],
    decay: [f64; 4],
    damped: [f64; 4],
    tone: f64,
}

impl Reverb {
    fn new(rate: f64, decay_s: f64, size: f64, damping_hz: f64) -> Self {
        let times = [29.7, 37.1, 41.1, 43.7].map(|ms| ms * size / 100.0);
        Self {
            lines: std::array::from_fn(|_| DelayLine::new(rate, 66.0)),
            taps: times.map(|ms| frames(ms, rate)),
            decay: times.map(|ms| 10.0_f64.powf(-3.0 * ms / (1000.0 * decay_s))),
            damped: [0.0; 4],
            tone: low_pass(damping_hz, rate),
        }
    }

    fn process(&mut self, [left, right]: [f64; 2]) -> [f64; 2] {
        let reads =
            std::array::from_fn::<_, 4, _>(|index| self.lines[index].read(self.taps[index]));
        for (damped, sample) in self.damped.iter_mut().zip(reads) {
            *damped += (sample - *damped) * self.tone;
        }
        let [a, b, c, d] = self.damped;
        let feedback = [a + b + c + d, a - b + c - d, a + b - c - d, a - b - c + d];
        let input = [left, right, left, -right];
        for (index, line) in self.lines.iter_mut().enumerate() {
            line.push(input[index] * 0.5 + feedback[index] * 0.5 * self.decay[index]);
        }
        let [x, y, z, w] = reads;
        [(x + z) * 0.5, (y - w) * 0.5]
    }
}

enum Processor {
    Echo(Echo),
    Chorus(Chorus),
    Reverb(Reverb),
}

impl Processor {
    fn new(effect: Effect, rate: f64) -> Option<Self> {
        Some(match effect {
            Effect::Off => return None,
            Effect::Delay {
                time_ms,
                feedback,
                damping_hz,
            } => Self::Echo(Echo::new(rate, time_ms, 0.0, feedback, damping_hz)),
            Effect::SlapDelay {
                time_ms,
                spread_ms,
                damping_hz,
            } => Self::Echo(Echo::new(rate, time_ms, spread_ms, 0.0, damping_hz)),
            Effect::Chorus {
                rate_hz,
                depth_ms,
                stereo,
            } => Self::Chorus(Chorus::new(rate, rate_hz, depth_ms, stereo)),
            Effect::Reverb {
                decay_s,
                size,
                damping_hz,
            } => Self::Reverb(Reverb::new(rate, decay_s, size, damping_hz)),
        })
    }

    fn process(&mut self, input: [f64; 2]) -> [f64; 2] {
        match self {
            Self::Echo(processor) => processor.process(input),
            Self::Chorus(processor) => processor.process(input),
            Self::Reverb(processor) => processor.process(input),
        }
    }
}

pub(in crate::stems) struct Rack([Option<(Processor, Strip)>; FX_SLOTS]);

impl Rack {
    pub(in crate::stems) fn new(
        settings: [FxReturn; FX_SLOTS],
        routed: [bool; FX_SLOTS],
        solo: bool,
        rate: f64,
    ) -> Option<Self> {
        let buses = std::array::from_fn(|slot| {
            let bus = settings[slot];
            let gain = bus.gain();
            if !routed[slot] || !bus.enabled || bus.mute || (solo && !bus.solo) || gain == 0.0 {
                return None;
            }
            let processor = Processor::new(bus.effect, rate)?;
            let strip = Strip::with_settings(
                bus.fx.unwrap_or_default(),
                &DynamicEqSettings::default(),
                gain,
                0.0,
                rate,
            );
            Some((processor, strip))
        });
        buses.iter().any(Option::is_some).then_some(Self(buses))
    }

    pub(in crate::stems) fn process(&mut self, dry: &mut [f64; 2], inputs: Inputs) {
        for (bus, input) in self.0.iter_mut().zip(inputs) {
            if let Some((processor, strip)) = bus {
                let mut wet = processor.process(input);
                strip.process(&mut wet, 1.0);
                dry[0] += wet[0];
                dry[1] += wet[1];
            }
        }
    }
}
