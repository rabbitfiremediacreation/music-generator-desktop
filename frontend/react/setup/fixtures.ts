import manifest from "../../../models/manifest.json";
import title from "../../../models/title-model.json";
import type { BackendStatus, Bootstrap, ModelSelection } from "../../types";

export const standard: ModelSelection = { provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-1.7B-Q8_0.gguf" };
export const setupFixture: Bootstrap = {
  needs_setup: true, version: "0.1.2", data_dir: "/data", error: null, manifest, title_model: title.model,
  settings: {
    cpu_iteration_behavior: "ask", models_dir: "/models", songs_dir: "/songs", lm_model: standard.language,
    expert_mode: false, dit: "standard", model_provider: standard.provider, synthesis_model: standard.synthesis,
    lm_device: "auto", export_format: "wav", poll_interval: 1.5, timeout_minutes: 30, mode: "single",
    vae_chunk: 256, tested_fingerprint: "", setup_complete: false,
  },
  hardware: { ram_bytes: 16 * 1024 ** 3, gpu: "CPU", recommended_lm: "1.7B", vram_bytes: null, vae_chunk: 256, platform: "macos", cpu_only: true },
  recommended_profiles: [standard],
};
export const measuredBackend: BackendStatus = {
  state: "running", synthesis: { state: "unconfirmed", backend: "unknown", device: null, reason: null },
  language_model: { state: "confirmed", backend: "vulkan", device: "Vulkan0", reason: "cuda_architecture_unsupported" },
};
