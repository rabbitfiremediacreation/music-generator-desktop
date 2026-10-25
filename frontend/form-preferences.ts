import "./form-preferences-i18n";
import { backend } from "./backend";
import { t } from "./i18n.js";
import type { GenerationFormPreferences } from "./types";

export const DEFAULT_FORM_PREFERENCES: Readonly<GenerationFormPreferences> = Object.freeze({
  duration: 90, bpm: 0, inference_steps: 80, lm_temperature: 1.2, variants: 2,
});
const fields = Object.keys(DEFAULT_FORM_PREFERENCES) as (keyof GenerationFormPreferences)[];

/** At most one IPC write at a time; retain the newest snapshot on failure for an explicit retry. */
export function createPreferenceWriter(save: (values: GenerationFormPreferences) => Promise<void>, reportError: (failed: boolean) => void) {
  let pending: GenerationFormPreferences | null = null;
  let active: Promise<void> | null = null;
  function start(): Promise<void> {
    if (active) return active;
    active = Promise.resolve().then(async () => {
      try {
        while (pending) {
          const values = pending;
          pending = null;
          try { await save(values); reportError(false); }
          catch {
            pending ??= values;
            reportError(true);
            return;
          }
        }
      } finally { active = null; }
    });
    return active;
  }
  return {
    queue(values: GenerationFormPreferences) { pending = { ...values }; void start(); },
    async flush() {
      if (active) await active;
      if (pending) await start();
    },
  };
}

export function createFormPreferences(form: HTMLFormElement, refresh: () => void) {
  const input = (name: keyof GenerationFormPreferences) => form.elements.namedItem(name) as HTMLInputElement;
  const error = form.querySelector<HTMLElement>("#genPreferencesError")!;
  let failed = false;
  const reportError = (value: boolean) => {
    failed = value;
    error.hidden = !value;
    error.textContent = value ? t("form_preferences_error") : "";
  };
  const writer = createPreferenceWriter(backend.saveGenerationFormPreferences, reportError);
  const snapshot = (): GenerationFormPreferences => {
    const values = Object.fromEntries(fields.map(name => [name, Number(input(name).value)])) as unknown as GenerationFormPreferences;
    if (values.bpm <= Number(input("bpm").min)) values.bpm = 0;
    return values;
  };
  const apply = (values: GenerationFormPreferences) => {
    for (const name of fields) input(name).value = String(name === "bpm" && values.bpm === 0 ? input(name).min : values[name]);
    refresh();
  };
  let previous = "";
  let loaded = false;
  let loadFailed = false;
  function capture(force = false) {
    if (!loaded) return;
    const values = snapshot(), serialized = JSON.stringify(values);
    if (force || serialized !== previous) {
      loadFailed = false;
      previous = serialized;
      writer.queue(values);
    }
  }
  const ready = (async () => {
    try { apply(await backend.generationFormPreferences()); }
    catch { apply({ ...DEFAULT_FORM_PREFERENCES }); loadFailed = true; reportError(true); }
    previous = JSON.stringify(snapshot());
    loaded = true;
    const changed = (event: Event) => {
      if (event.target instanceof HTMLInputElement && fields.includes(event.target.name as keyof GenerationFormPreferences)) capture(failed);
    };
    form.addEventListener("input", changed);
    form.addEventListener("change", changed);
    form.querySelector<HTMLButtonElement>("#resetGenPreferences")!.onclick = () => {
      apply({ ...DEFAULT_FORM_PREFERENCES }); capture(true);
    };
    document.addEventListener("langchange", () => reportError(failed));
  })();
  return { ready, capture, async flush() {
    await ready;
    capture();
    // A failed read must not overwrite previously saved values with the fallback defaults.
    if (loadFailed) {
      try { await backend.generationFormPreferences(); loadFailed = false; reportError(false); }
      catch { reportError(true); }
    }
    await writer.flush();
  } };
}

let controller: ReturnType<typeof createFormPreferences> | undefined;
export async function initializeGenerationFormPreferences(form: HTMLFormElement, refresh: () => void): Promise<void> {
  controller ??= createFormPreferences(form, refresh);
  await controller.ready;
}
export function captureGenerationFormPreferences(): void { controller?.capture(); }
export async function flushGenerationFormPreferences(): Promise<void> { await controller?.flush(); }
