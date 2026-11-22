import { expect, it } from "vitest";
import { catalogFixture } from "../models/model-fixtures";
import { layerModels } from "./layer-models";

it("recognizes a manually copied Base model before its first checksum verification", () => {
  const catalog = structuredClone(catalogFixture);
  const base = "acestep-v15-base-Q4_K_M.gguf";
  for (const model of catalog.models.filter(model => model.family.endsWith("-base"))) {
    model.present = model.file === base;
    model.verified = false;
  }
  const result = layerModels(catalog);
  expect(result.options).toEqual([expect.objectContaining({
    selection: { ...catalog.selection, synthesis: base }, verified: false,
  })]);
  expect(result.prepare).toBeUndefined();
});
