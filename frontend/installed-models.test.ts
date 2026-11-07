import { expect, it } from "vitest";
import { installedModels, installedSelection } from "./installed-models";
import { catalogFixture, turbo, xl } from "./react/models/model-fixtures";
import { standard } from "./react/setup/fixtures";

it("lists verified and unverified local files but excludes partial downloads", () => {
  const catalog = structuredClone(catalogFixture);
  catalog.models = catalog.models.map(model => ({ ...model, verified: model.file === standard.synthesis, present: model.file === standard.synthesis || model.file === standard.language, partial_bytes: 100 }));
  catalog.title_model = { ...catalog.title_model, verified: false, present: false };
  expect(installedModels(catalog).map(model => model.file)).toEqual([standard.synthesis, standard.language]);
  catalog.title_model.present = true;
  const files = installedModels(catalog);
  expect(files.at(-1)?.role).toBe("title");
  expect(files.filter(model => model.file === catalog.title_model.file)).toHaveLength(1);
});

it("offers cached activation only when the entire permitted profile is verified and fits RAM", () => {
  const catalog = structuredClone(catalogFixture); catalog.hardware.ram_bytes = 64 * 1024 ** 3;
  expect(installedSelection(catalog, xl.synthesis, standard)).toEqual(xl);
  catalog.models.find(model => model.role === "dependency")!.verified = false;
  expect(installedSelection(catalog, xl.synthesis, standard)).toBeUndefined();
  catalog.models.forEach(model => { model.verified = true; });
  catalog.hardware.ram_bytes = 1;
  expect(installedSelection(catalog, xl.synthesis, standard)).toBeUndefined();
});

it("uses the recommended language pairing in basic mode and rejects advanced or non-synthesis entries", () => {
  const catalog = structuredClone(catalogFixture); catalog.hardware.ram_bytes = 64 * 1024 ** 3; catalog.expert_mode = false;
  const recommended = { ...xl, language: "acestep-5Hz-lm-4B-Q8_0.gguf" };
  catalog.recommended_profiles = [standard, recommended];
  expect(installedSelection(catalog, xl.synthesis, standard)).toEqual(recommended);
  expect(installedSelection(catalog, turbo.synthesis, standard)).toBeUndefined();
  expect(installedSelection(catalog, standard.language, standard)).toBeUndefined();
});
