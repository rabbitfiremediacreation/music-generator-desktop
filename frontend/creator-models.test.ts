import { expect, it } from "vitest";
import { creatorOptions, profileKey } from "./creator-models";
import { catalogFixture, catalogWithText2midi, turbo, xl } from "./react/models/model-fixtures";
import { standard } from "./react/setup/fixtures";

it("offers installed recommendations as Standard and XL in Simple Mode", () => {
  const catalog = { ...catalogFixture, expert_mode: false };
  expect(creatorOptions(catalog, standard).map(option => option.label)).toEqual(["Standard", "XL"]);
  expect(creatorOptions(catalog, turbo).map(option => option.value)).not.toContain(profileKey(turbo));
});

it("offers verified expert models even after switching away from them", () => {
  const options = creatorOptions(catalogFixture, standard);
  expect(options.find(option => option.value === profileKey(turbo))?.label).toContain("turbo");
});

it("hides missing downloads, unverified weights, incomplete profiles and an absent ACE-Step engine", () => {
  const catalog = structuredClone(catalogFixture);
  catalog.expert_mode = false;
  const xlWeight = catalog.models.find(model => model.file === xl.synthesis)!;
  xlWeight.present = false;
  xlWeight.partial_bytes = 100;
  expect(creatorOptions(catalog, xl).map(option => option.label)).toEqual(["Standard"]);
  xlWeight.present = true;
  xlWeight.verified = false;
  expect(creatorOptions(catalog, xl).map(option => option.label)).toEqual(["Standard"]);
  const dependency = catalog.models.find(model => model.role === "dependency")!;
  dependency.verified = false;
  expect(creatorOptions(catalog, standard)).toEqual([]);
  dependency.verified = true;
  catalog.ace_step_available = false;
  expect(creatorOptions(catalog, standard)).toEqual([]);
});

it("requires all native profile files and an available runtime", () => {
  const catalog = catalogWithText2midi(true);
  catalog.expert_mode = false;
  const midi = catalog.profiles![0];
  const files = catalog.models.filter(model => midi.files.includes(model.file));
  expect(creatorOptions(catalog, midi.selection).map(option => option.label)).toEqual(["Standard", "XL"]);
  for (const file of files) file.present = file.verified = true;
  expect(creatorOptions(catalog, standard).map(option => option.label)).toEqual(["Standard", "XL", "Text2midi"]);
  midi.available = false;
  expect(creatorOptions(catalog, midi.selection).map(option => option.label)).toEqual(["Standard", "XL"]);
});
