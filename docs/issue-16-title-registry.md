# Issue #16: title model in the shared model directory

## Cause and treatment

On 2026-11-07, GitHub `main` and the clean starting worktree both pointed to `aa151677f7d36b43d7c0a8203b12e313bd479e16`. Issue #16 was open with no comments. The registry header is identical in the pinned macOS/Linux engine (`b7ba6d9ce2f19ca7627fb8f340032c3ebe8ae253`) and Windows engine (`6013134c136d9fb4e970cf690e76925be9553da0`). It reads GGUF headers and recognizes only `acestep-lm`, `acestep-dit`, `acestep-text-enc` and `acestep-vae`. The separate title model declares `qwen3`, so the original code emits an unknown-architecture warning.

`scripts/desktop/patches/acestep-title-registry.patch` recognizes **only** the combination of filename `Qwen3-0.6B-Q8_0.gguf` and a successfully parsed string-valued `general.architecture=qwen3`. The music scan logs it at informational level:

```text
[Registry] Qwen3-0.6B-Q8_0.gguf -> title model (handled separately)
```

It does not add that file to a music bucket or count it as an available music model. All other unknown architectures still warn, including other Qwen filenames. Unreadable/truncated headers, absent metadata and incorrectly typed architecture metadata still warn, even under the title filename. A recognized music architecture under that filename is still registered normally. Checking the metadata type also avoids GGML's string-access assertion on malformed metadata.

This is header classification, not validation of title-model weights. The existing SHA-256 verification and separate native title runtime remain responsible for title-model integrity and inference. No paths, model files, downloads, setup plans, settings, translation strings or title-generation code change. Existing shared directories require no migration. If the title-model pin changes, update the exception deliberately: the native contract uses the manifest filename and will fail until the new choice is supported. The engine recipe includes the patch, native test, contract and title manifest, invalidating old runtime caches on every platform.

## Regression and local evidence

The new `engine-registry-test.cpp` calls the production registry using the real GGML reader. `verifyRegistryContract` runs automatically during native engine preparation, including Windows against its pinned runtime DLLs. Its eight isolated scenarios cover a Unicode shared folder with all four music architectures, the title model, an unknown model, damaged data and another Qwen model; title-only folders; unknown, invalid, truncated and missing title metadata; and a music architecture under the title filename. It checks bucket counts, classification logs, preserved warnings and unchanged fixture bytes. The test executable is not copied into the shipped runtime.

Local checks on Apple Silicon:

- Red/green: the unpatched registry failed on the exact misleading title warning; the patched native registry passed the contract.
- The pinned engine and matching GGML submodule (`765bc96f9bb8d4c397c91c23b4e5c52a93fcf9b0`) built successfully with CMake, CPU backend, including `ace-server` and the registry test. The existing macOS compatibility and iteration patches applied alongside the new patch. The complete Windows patch sequence also applied to its pinned source archive.
- Five real models were copied independently into an isolated folder: Qwen title, Qwen embedding, 4B LM, standard DiT and VAE. With the production `GGML_MAX_NAME=128` configuration, the old registry reported the title warning and one model in each music bucket. The patched registry reported the informational title line, the same four music models and no registry warnings. The new server's `/health` and `/props` confirmed these four models; the title model was absent from the music lists. The server shut down after the check.
- The title copy matched the manifest SHA-256 `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`. The existing `aa15167` CI title helper, copied and ad-hoc signed without App Sandbox entitlements for this isolated CLI test, passed its self-test and generated `The song title is "Gemeinsam gehen wir ins Licht."` from synthetic German lyrics using that same shared-folder model. The original helper and user model files were not changed.
- All 466 frontend tests, TypeScript/Vite production builds and ESLint passed. All 34 desktop script tests passed; the existing Windows-only installer check was skipped on macOS. All 22 Rust tests in `titles`, `title_clean` and `download` passed with the locked dependencies offline. The download tests needed loopback access outside the restrictive tool sandbox.

The native fixtures and local build logs are under the ignored `.cache/issue-16/` directory. They are not release artifacts. Native Windows/Linux/Intel execution, GPU inference, a newly packaged/sandboxed release and a full music-generation run were not performed for this change. Real model registration and CPU title inference were performed as described above; synthetic GGUF fixtures alone do not establish successful inference.
