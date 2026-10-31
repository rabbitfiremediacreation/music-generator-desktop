// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), start: vi.fn(), loaded: vi.fn(), loadFailure: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./main", () => { mocks.loaded(); if (mocks.loadFailure) throw new Error("module failed"); return { startApp: mocks.start }; });
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); mocks.loadFailure = false; mocks.invoke.mockImplementation(async name=>name==="startup_status"?{attempt:2}:true); });

it("does not import or initialize the UI when startup is disallowed", async () => {
  mocks.invoke.mockImplementation(async name=>name==="startup_status"?{attempt:2}:false);
  await import("./launch"); await vi.dynamicImportSettled();
  expect(mocks.loaded).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
});
it("initializes the UI after startup permission", async () => {
  await import("./launch"); await vi.dynamicImportSettled();
  expect(mocks.start).toHaveBeenCalledOnce();
});
it("reports a failed UI initialization without depending on static screen elements", async () => {
  mocks.start.mockImplementationOnce(() => { throw new Error("module failed"); }); document.body.innerHTML = '<div id="root"></div>';
  await import("./launch"); await vi.dynamicImportSettled();
  expect(mocks.invoke).toHaveBeenCalledWith("startup_error", { attempt:2,error: "module failed" });
});

it("ignores an expired startup attempt and contains reporting failures", async () => {
  mocks.invoke.mockImplementation(async name => { if(name === "startup_status")return {attempt:2}; throw "startup_attempt_expired"; });
  await import("./launch"); await vi.dynamicImportSettled();
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_error", expect.anything());
  vi.resetModules(); mocks.invoke.mockImplementation(async name => {if(name === "startup_status")return {attempt:3};throw "transport unavailable";});
  await import("./launch"); await vi.dynamicImportSettled();
  expect(mocks.invoke).toHaveBeenCalledWith("startup_error", {attempt:3,error:"transport unavailable"});
});
