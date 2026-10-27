import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import source from "../../../models/catalog.json";
import type { CatalogModel, ModelCatalog, ModelSelection, Settings } from "../../types";
import { setupFixture, standard } from "../setup/fixtures";
import { I18nProvider } from "../i18n";
import { createAppQueryClient } from "../data";
import { EventBridge } from "../events";
import { ModelControls } from "./ModelControls";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
export { ipc };
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
export const handlers = new Map<string, (event: { payload: unknown }) => void>();
export const xl = { ...standard, synthesis: "acestep-v15-xl-sft-Q8_0.gguf" };
export const turbo = { ...standard, synthesis: "acestep-v15-turbo-Q8_0.gguf" };
export const saved = (selection = standard): Settings => ({ ...setupFixture.settings, model_provider: selection.provider, synthesis_model: selection.synthesis, lm_model: selection.language, expert_mode: true, recommended_profiles: [standard, xl] });
export const catalogFixture: ModelCatalog = { ...source, expert_mode: true, recommended_profiles: [standard, xl], selection: standard,
  hardware: setupFixture.hardware, free_bytes: null, models_dir: "/models", busy: false,
  title_model: { ...setupFixture.title_model, verified: true, present: true, partial_bytes: 0 },
  providers: source.providers.map(provider => ({ ...provider, status: provider.status as "planned" | "available" })),
  models: source.models.map(model => ({ ...model, role: model.role as CatalogModel["role"], verified: true, present: true, partial_bytes: 0 })),
};

export function resetDesktop() {
  handlers.clear(); ipc.invoke.mockReset(); ipc.listen.mockReset();
  ipc.listen.mockImplementation(async (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); });
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "get_settings") return saved();
    if (name === "model_catalog") return structuredClone(catalogFixture);
    if (name === "select_models" || name === "use_models") return args.selection;
    if (name === "generation_policy") return { recommended_steps: 30 };
  });
}

export function mountControls(onRecommendedSteps?: (steps: number) => void) {
  const client = createAppQueryClient();
  function Harness() {
    const [selection, setSelection] = useState<ModelSelection | null>(standard), [visible, setVisible] = useState(true);
    return <>
      {visible && <ModelControls selection={selection} onSelectionChange={setSelection} onManage={() => {}} onRecommendedSteps={onRecommendedSteps} />}
      <button onClick={() => setSelection(turbo)}>Restore song</button>
      <button onClick={() => setSelection(xl)}>Complete setup</button>
      <button onClick={() => setVisible(value => !value)}>Switch screen</button>
      <output aria-label="selection">{selection?.synthesis}</output>
    </>;
  }
  return { client, ...render(<QueryClientProvider client={client}><I18nProvider><EventBridge><Harness /></EventBridge></I18nProvider></QueryClientProvider>) };
}
