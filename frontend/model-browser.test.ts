import { expect, it } from "vitest";
import { familySelection, modelFamilies } from "./model-browser";
import { catalogFixture, xl } from "./react/models/model-fixtures";
import { standard } from "./react/setup/fixtures";

function catalog() {
  const value = structuredClone(catalogFixture);
  value.hardware.ram_bytes = 64 * 1024 ** 3;
  return value;
}

it("groups sound-model variants and searches names, precision and provider together", () => {
  const value = catalog();
  const families = modelFamilies(value, standard, true, "ace-step XL Q5", "all");
  expect(families.length).toBeGreaterThan(0);
  for (const family of families) {
    expect(family.id).toContain("-xl-");
    expect(family.variants.every(model => model.precision === "Q5_K_M" && model.role === "synthesis")).toBe(true);
  }
  expect(modelFamilies(value, standard, true, "no-such-model", "all")).toEqual([]);
});

it("distinguishes verified installations from files still requiring verification", () => {
  const value = catalog();
  value.models = value.models.map(model => ({ ...model, present: true, verified: model.file === standard.synthesis }));
  const families = modelFamilies(value, standard, false, "", "installed");
  expect(families.flatMap(family => family.variants).map(model => model.file)).toEqual([standard.synthesis]);
  expect(modelFamilies(value, standard, false, "xl", "installed")).toEqual([]);
});

it("keeps simple mode and recommendation filters limited to the recommended profiles", () => {
  const value = catalog();
  value.expert_mode = false;
  const files = modelFamilies(value, standard, false, "", "all").flatMap(family => family.variants).map(model => model.file);
  expect(files.sort()).toEqual([standard.synthesis, xl.synthesis].sort());
  expect(modelFamilies(value, standard, false, "turbo", "all")).toEqual([]);
  value.expert_mode = true;
  const recommendations = modelFamilies(value, standard, false, "", "recommended");
  expect(recommendations.every(family => family.recommended)).toBe(true);
  expect(recommendations.flatMap(family => family.variants).map(model => model.file).sort()).toEqual(files.sort());
});

it("retains a locked current profile without revealing other advanced families in simple mode", () => {
  const value = catalog(); value.expert_mode = false;
  const draft = { ...standard, synthesis: "acestep-v15-turbo-Q8_0.gguf" };
  const advanced = modelFamilies(value, draft, false, "turbo", "all");
  expect(advanced).toHaveLength(1);
  expect(advanced[0].variants.map(model => model.file)).toEqual([draft.synthesis]);
});

it("preserves precision in Expert Mode and uses the recommended language model in simple mode", () => {
  const value = catalog();
  const draft = { ...standard, synthesis: "acestep-v15-sft-Q5_K_M.gguf" };
  const family = modelFamilies(value, draft, false, "", "all").find(item => item.id === "acestep-v15-xl-sft")!;
  expect(familySelection(value, draft, family).synthesis).toBe("acestep-v15-xl-sft-Q5_K_M.gguf");
  value.expert_mode = false;
  const recommended = { ...xl, language: "acestep-5Hz-lm-4B-Q8_0.gguf" };
  value.recommended_profiles = [standard, recommended];
  const basic = modelFamilies(value, standard, false, "xl", "all")[0];
  expect(familySelection(value, standard, basic)).toEqual(recommended);
});

it("filters families above the RAM budget while retaining the current selection", () => {
  const value = catalog(); value.hardware.ram_bytes = 1;
  expect(modelFamilies(value, standard, true, "", "all").flatMap(family => family.variants).map(model => model.file)).toEqual([standard.synthesis]);
  expect(modelFamilies(value, standard, false, "", "all").length).toBeGreaterThan(1);
});
