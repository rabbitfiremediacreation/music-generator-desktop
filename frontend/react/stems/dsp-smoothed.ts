export class Smoothed {
  constructor(public value: number, private target = value) {}
  set(target: number, instant: boolean) {
    this.target = target;
    if (instant) this.value = target;
  }
  next(step: number) {
    const delta = this.target - this.value;
    this.value = Math.abs(delta) < 1e-9 ? this.target : this.value + delta * step;
    return this.value;
  }
}
