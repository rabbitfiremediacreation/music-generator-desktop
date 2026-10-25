// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import html from "./splash.html?raw";
import { splashView } from "./splash-view";
import { startupText } from "./startup-text";

beforeEach(() => {
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script\b[\s\S]*?<\/script>/g, "");
  localStorage.setItem("ui_lang", "de");
});

it("shows the static icon and load message even before JavaScript runs", () => {
  expect(document.querySelector(".app-icon")).not.toBeNull();
  expect(document.querySelectorAll(".waveform rect")).toHaveLength(6);
  expect(document.querySelector<HTMLImageElement>('img[alt="Alphatester"]')!.getAttribute("src")).toBe("/alphatester.png");
  expect(document.querySelector("#splashStatus")!.textContent).toContain("Starting");
  expect(document.querySelector("[role=progressbar]")!.hasAttribute("aria-valuenow")).toBe(false);
});

it("ignores an older startup snapshot after a newer event", () => {
  const render = splashView(startupText());
  render({ sequence: 3, phase: "hardware", error: null });
  render({ sequence: 1, phase: "data", error: null });
  expect(document.querySelector("#splashStatus")!.textContent).toBe("Hardware wird erkannt…");
});

it("stops the loading presentation on failure and restores it for retry", () => {
  const render = splashView(startupText());
  render({ sequence: 4, phase: "error", error: "database is locked" });
  expect(document.body.dataset.failed).toBe("true");
  expect(document.querySelector<HTMLElement>("#splashProgress")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#splashRetry")!.hidden).toBe(false);
  expect(document.querySelector("#splashError")!.textContent).toBe("Der Start konnte nicht abgeschlossen werden. Bitte versuche es erneut.");
  expect(document.querySelector("#splashDetailsLabel")!.textContent).toBe("Technische Details");
  expect(document.querySelector<HTMLDetailsElement>("#splashDetails")!.open).toBe(false);
  expect(document.querySelector("#splashDiagnostic")!.textContent).toBe("database is locked");
  render({ sequence: 5, phase: "starting", error: null });
  expect(document.body.dataset.failed).toBe("false");
  expect(document.querySelector<HTMLElement>("#splashRetry")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#splashDetails")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#splashProgress")!.hidden).toBe(false);
});

it("uses saved language with an English fallback for unsupported locales", () => {
  expect(startupText().retry).toBe("Erneut versuchen");
  localStorage.setItem("ui_lang", "unsupported");
  expect(startupText().retry).toBe("Try again");
  expect(document.documentElement.lang).toBe("en");
});
