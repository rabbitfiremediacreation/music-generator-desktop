import { expect, it } from "vitest";
import { dynamicEqCut, eqCutAt, eqCutPosition, eqFrequencyAt, eqFrequencyPosition, eqSpectrum } from "./dynamic-eq-curve";
import { defaultEqBand } from "./repair-tools";

it("plots the engine's configured maximum cut at the band center and narrows as Q increases", () => {
  const band = { ...defaultEqBand, frequency_hz: 3700, reduction_db: 11.5 };
  expect(dynamicEqCut(band, band.frequency_hz, 44100)).toBeCloseTo(11.5);
  expect(dynamicEqCut(band, 30, 44100)).toBeLessThan(.05);
  expect(dynamicEqCut(band, 1300, 44100)).toBeGreaterThan(dynamicEqCut({ ...band, q: 4 }, 1300, 44100));
  expect(eqFrequencyAt(eqFrequencyPosition(band.frequency_hz))).toBeCloseTo(band.frequency_hz);
  expect(eqCutAt(eqCutPosition(band.reduction_db))).toBeCloseTo(band.reduction_db);
});

it("uses only the selected time columns and orders the spectrum by ascending frequency", () => {
  const bins = eqSpectrum({
    width: 4, height: 2, levels: [255, 51, 102, 255, 255, 153, 204, 255], min_hz: 20, max_hz: 20_000, bin_hz: 22,
  }, .25, .75);
  expect(bins.map(bin => bin.level)).toEqual([.8, .4]);
  expect(bins[0].x).toBeLessThan(bins[1].x);
});
