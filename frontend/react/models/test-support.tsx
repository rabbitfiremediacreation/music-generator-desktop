import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { ModelSelection } from "../../types";
import { standard } from "../setup/fixtures";
import { catalogFixture, saved, turbo, xl } from "./model-fixtures";
export { catalogFixture, saved, turbo, xl } from "./model-fixtures";
import { I18nProvider } from "../i18n";
import { createAppQueryClient } from "../data";
import { EventBridge } from "../events";
import { ModelControls } from "./ModelControls";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
export { ipc };
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
export const handlers = new Map<string, (event: { payload: unknown }) => void>();

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
    const [selectionRevision, setSelectionRevision] = useState<number>();
    const restore = (next: ModelSelection) => { setSelection(next); setSelectionRevision(value => (value ?? 0) + 1); };
    return <>
      {visible && <ModelControls selection={selection} selectionRevision={selectionRevision} onSelectionChange={setSelection} onManage={() => {}} onRecommendedSteps={onRecommendedSteps} />}
      <button onClick={() => restore(turbo)}>Restore song</button>
      <button onClick={() => restore(standard)}>Restore original song</button>
      <button onClick={() => { setSelection(xl); setSelectionRevision(undefined); }}>Complete setup</button>
      <button onClick={() => setVisible(value => !value)}>Switch screen</button>
      <output aria-label="selection">{selection?.synthesis}</output>
    </>;
  }
  return { client, ...render(<QueryClientProvider client={client}><I18nProvider><EventBridge><Harness /></EventBridge></I18nProvider></QueryClientProvider>) };
}
