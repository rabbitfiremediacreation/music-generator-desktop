// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { Bootstrap, CudaStatus } from "./types";

const mocks = vi.hoisted(() => ({ cudaStatus: vi.fn(), installCuda: vi.fn() }));
vi.mock("./backend", () => ({ backend: mocks }));
const hardware: Bootstrap["hardware"] = { platform: "windows", gpu: "NVIDIA GeForce RTX 4060", ram_bytes: 32e9, vram_bytes: 8e9, cpu_only: false, recommended_lm: "1.7B", vae_chunk: 128, cuda: { minimum_compute_capability: "7.5", architecture_supported: true } };
const status = (state: CudaStatus["state"], details: string | null = null): CudaStatus => ({ state, details, download_bytes: 402682743 });
let container: HTMLElement;
const busy = vi.fn();
const idle = vi.fn();

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  document.body.innerHTML = "<section></section>";
  container = document.querySelector("section")!;
  mocks.cudaStatus.mockResolvedValue(status("runtime_missing"));
  mocks.installCuda.mockResolvedValue(status("ready"));
  const { setLang } = await import("./i18n.js"); setLang("de");
});

async function show(hw = hardware) {
  const { setupCuda } = await import("./cuda-setup");
  await setupCuda(container, hw, busy, idle);
}
const download = () => container.querySelector<HTMLButtonElement>("[data-cuda-download]")!;
const check = () => container.querySelector<HTMLButtonElement>("[data-cuda-check]")!;

it.each(["macos", "linux"])("does not check or offer downloads on %s", async platform => {
  await show({ ...hardware, platform });
  expect(container.hidden).toBe(true); expect(mocks.cudaStatus).not.toHaveBeenCalled();
});

it("does not offer CUDA downloads for unsupported GPUs or non-NVIDIA devices", async () => {
  await show({ ...hardware, cuda: { minimum_compute_capability: "7.5", architecture_supported: false } });
  expect(container.hidden).toBe(true);
  await show({ ...hardware, gpu: "AMD Radeon" });
  expect(container.hidden).toBe(true); expect(mocks.cudaStatus).not.toHaveBeenCalled();
});

it("downloads on demand, prevents duplicate work and displays actual CUDA availability", async () => {
  let finish!: (result: CudaStatus) => void;
  mocks.installCuda.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await show();
  expect(download().hidden).toBe(false);
  expect(container.textContent).toContain("NVIDIA-Grafikkarte wurde erkannt");
  expect(container.textContent).toContain("0,4 GiB");
  expect(mocks.installCuda).not.toHaveBeenCalled();
  download().click(); download().click(); check().click();
  expect(mocks.installCuda).toHaveBeenCalledTimes(1);
  expect(busy).toHaveBeenCalledTimes(1); expect(check().disabled).toBe(true);
  finish(status("ready"));
  await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
  expect(download().hidden).toBe(true);
  expect(container.textContent).toContain("CUDA ist verfügbar");
  expect(container.textContent).toContain("tatsächliche Nutzung");
});

it.each(["driver_error", "cuda_failed", "ready", "unsupported_build", "check_failed"] as const)("offers no runtime installation for %s", async state => {
  mocks.cudaStatus.mockResolvedValue(status(state, "<img src=x onerror=alert(1)>"));
  await show(); expect(download().hidden).toBe(true);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("pre")!.textContent).toContain("<img");
  const driver = container.querySelector<HTMLAnchorElement>("[data-cuda-driver]")!;
  expect(driver.parentElement!.hidden).toBe(state !== "driver_error" && state !== "cuda_failed");
});

it("permits retry after failed installation and keeps diagnosis as text", async () => {
  mocks.installCuda.mockRejectedValueOnce(new Error("Checksum mismatch"));
  await show(); download().click();
  await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
  expect(container.textContent).toContain("Installation ist fehlgeschlagen");
  expect(container.querySelector("pre")!.textContent).toContain("Checksum mismatch");
  download().click();
  await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(2));
  expect(container.textContent).toContain("CUDA ist verfügbar");
});

it("announces cancellation, retains retry and translates the current state", async () => {
  mocks.installCuda.mockRejectedValueOnce(new Error("Operation cancelled"));
  await show(); download().click();
  await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
  expect(container.textContent).toContain("CUDA-Download abgebrochen");
  expect(download().hidden).toBe(false);
  const { setLang } = await import("./i18n.js"); setLang("en");
  expect(container.textContent).toContain("CUDA download cancelled");
  expect(download().textContent).toBe("Download CUDA support");
  check().click();
  await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(2));
  expect(container.textContent).toContain("Your NVIDIA graphics card was detected");
});

it("ignores a late check from an earlier wizard view", async () => {
  let finish!: (result: CudaStatus) => void;
  mocks.cudaStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { setupCuda } = await import("./cuda-setup");
  const previous = setupCuda(container, hardware, busy, idle);
  mocks.cudaStatus.mockResolvedValue(status("ready"));
  await setupCuda(container, hardware, busy, idle);
  finish(status("runtime_missing")); await previous;
  expect(download().hidden).toBe(true);
  expect(container.textContent).toContain("CUDA ist verfügbar");
});
