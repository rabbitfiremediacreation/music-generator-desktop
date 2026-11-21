type Mode = "lowpass" | "highpass" | "low" | "mid" | "high";
type Coefficients = [number, number, number, number, number];
const identity: Coefficients = [1, 0, 0, 0, 0];

export function filterFrequency(value: number, rate: number): number | undefined {
  const amount = (Math.abs(value) - 3) / 97;
  if (amount <= 0) return undefined;
  const lowpass = value < 0;
  const start = lowpass ? Math.min(20000, rate * .45) : 20;
  const end = lowpass ? 80 : Math.min(5000, rate * .45);
  return start * (end / start) ** amount;
}

export function filterCoefficients(value: number, rate: number): Coefficients {
  const frequency = filterFrequency(value, rate);
  if (frequency === undefined) return identity;
  const [b0, b1, b2, a1, a2] = equalizer(value < 0 ? "lowpass" : "highpass", frequency, 0, rate);
  const wet = Math.min(1, (Math.abs(value) - 3) / 8);
  return [1 + (b0 - 1) * wet, a1 + (b1 - a1) * wet, a2 + (b2 - a2) * wet, a1, a2];
}

/** Normalized biquad coefficients in b0, b1, b2, a1, a2 order. */
export function equalizer(mode: Mode, frequency: number, gain: number, rate: number): Coefficients {
  const pass = mode === "lowpass" || mode === "highpass";
  if (!pass && gain === 0) return identity;
  const angle = 2 * Math.PI * Math.min(frequency, rate * .45) / rate;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const a = 10 ** (gain / 40);
  const alpha = s / (2 * (mode === "mid" ? .7 : Math.SQRT1_2));
  const norm = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients =>
    [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  if (pass) {
    const b = mode === "lowpass" ? (1 - c) / 2 : (1 + c) / 2;
    return norm(b, (mode === "lowpass" ? 2 : -2) * b, b, 1 + alpha, -2 * c, 1 - alpha);
  }
  if (mode === "mid") return norm(1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a);
  const plus = a + 1, minus = a - 1, slope = 2 * Math.sqrt(a) * alpha;
  if (mode === "low") return norm(a * (plus - minus * c + slope), 2 * a * (minus - plus * c), a * (plus - minus * c - slope),
    plus + minus * c + slope, -2 * (minus + plus * c), plus + minus * c - slope);
  return norm(a * (plus + minus * c + slope), -2 * a * (minus + plus * c), a * (plus + minus * c - slope),
    plus - minus * c + slope, 2 * (minus - plus * c), plus - minus * c - slope);
}

export class StereoFilter {
  private coefficients: Coefficients = [...identity];
  private target = identity;
  private moving = false;
  private bypass = true;
  private l1 = 0;
  private l2 = 0;
  private r1 = 0;
  private r2 = 0;

  configure(target: Coefficients, instant: boolean) {
    if (instant) {
      this.target = target;
      this.coefficients = [...target];
      this.moving = false;
      this.bypass = target === identity;
    } else if (target.some((value, index) => value !== this.target[index])) {
      this.target = target;
      this.moving = true;
      this.bypass = false;
    }
  }

  reset() { this.l1 = this.l2 = this.r1 = this.r2 = 0; }

  process(pair: Float64Array, smooth: number) {
    if (this.bypass) return;
    const coeff = this.coefficients;
    if (this.moving) {
      let done = true;
      for (let index = 0; index < 5; index++) {
        const diff = this.target[index] - coeff[index];
        if (Math.abs(diff) > 1e-8) {
          coeff[index] += diff * smooth;
          done = false;
        } else coeff[index] = this.target[index];
      }
      if (done) {
        this.moving = false;
        if (this.target === identity) { this.bypass = true; this.reset(); return; }
      }
    }
    const l = pair[0], r = pair[1];
    const left = l * coeff[0] + this.l1, right = r * coeff[0] + this.r1;
    this.l1 = l * coeff[1] - left * coeff[3] + this.l2;
    this.r1 = r * coeff[1] - right * coeff[3] + this.r2;
    this.l2 = l * coeff[2] - left * coeff[4];
    this.r2 = r * coeff[2] - right * coeff[4];
    pair[0] = left; pair[1] = right;
  }
}
