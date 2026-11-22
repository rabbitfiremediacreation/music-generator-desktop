use std::f64::consts::TAU;

pub(super) const SIZE: usize = 2048;
pub(super) type Spectrum = [[f64; 2]; SIZE];
pub(super) type Power = [f64; SIZE / 2 + 1];

pub(super) struct Transform {
    pub window: [f64; SIZE],
    roots: [[f64; 2]; SIZE / 2],
}

impl Transform {
    pub fn new() -> Self {
        Self {
            window: std::array::from_fn(|index| {
                (1.0 - (TAU * index as f64 / SIZE as f64).cos()) / 2.0
            }),
            roots: std::array::from_fn(|index| {
                let (sin, cos) = (-TAU * index as f64 / SIZE as f64).sin_cos();
                [cos, sin]
            }),
        }
    }

    pub fn analyse(
        &self,
        audio: &[[f32; 2]],
        first: isize,
        channel: usize,
        spectrum: &mut Spectrum,
    ) {
        for (index, (bin, window)) in spectrum.iter_mut().zip(&self.window).enumerate() {
            let value = audio
                .get((first + index as isize) as usize)
                .map_or(0.0, |pair| pair[channel]);
            *bin = [f64::from(value) * window, 0.0];
        }
        self.fft(spectrum, false);
    }

    /// Take the greater power of the two channels so opposite phases cannot cancel.
    pub fn stereo_power(
        &self,
        audio: &[[f32; 2]],
        center: usize,
        spectrum: &mut Spectrum,
        power: &mut Power,
    ) {
        power.fill(0.0);
        let first = center as isize - SIZE as isize / 2;
        for channel in 0..2 {
            self.analyse(audio, first, channel, spectrum);
            for (peak, &[real, imag]) in power.iter_mut().zip(&*spectrum) {
                *peak = peak.max(real * real + imag * imag);
            }
        }
    }

    pub fn inverse(&self, spectrum: &mut Spectrum) {
        self.fft(spectrum, true);
        for bin in spectrum {
            bin[0] /= SIZE as f64;
        }
    }

    fn fft(&self, data: &mut Spectrum, inverse: bool) {
        for index in 0..SIZE {
            let reversed = index.reverse_bits() >> (usize::BITS - SIZE.ilog2());
            if reversed > index {
                data.swap(index, reversed);
            }
        }
        for power in 1..=SIZE.ilog2() {
            let size = 1 << power;
            for chunk in data.chunks_exact_mut(size) {
                let (even, odd) = chunk.split_at_mut(size / 2);
                for (index, (a, b)) in even.iter_mut().zip(odd).enumerate() {
                    let [cos, sin] = self.roots[index * SIZE / size];
                    let sin = if inverse { -sin } else { sin };
                    let real = cos * b[0] - sin * b[1];
                    let imag = sin * b[0] + cos * b[1];
                    *b = [a[0] - real, a[1] - imag];
                    *a = [a[0] + real, a[1] + imag];
                }
            }
        }
    }
}
