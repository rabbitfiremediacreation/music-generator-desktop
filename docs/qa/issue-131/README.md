# DiffRhythm 2 · Issue #131

DiffRhythm 2 is an opt-in profile for noncommercial evaluation. In **Settings → Models and hardware → Add model**, choose **DiffRhythm 2** and read the licenses and publisher notes before choosing **Download for noncommercial evaluation**. Enable Expert Mode to use the profile from this dialog. Use English or Mandarin lyrics and a style description. The app accepts 10–210 seconds and generates one song per request. 210 seconds is the upstream CLI's default.

## Sources and terms

The complete file list in [the model catalog](../../../models/catalog.json) identifies the exact repository revision, remote path, byte count and SHA-256 for every runtime asset. The four model repositories are public and ungated. At these revisions the full download is 10,180,545,733 bytes. The shared downloader resumes interrupted transfers and hashes the complete file before use. To import local copies, put every listed file at the corresponding relative path under the model folder, then choose **Verify files and use for noncommercial evaluation**.

| Component | Revision | License |
| --- | --- | --- |
| [DiffRhythm 2 checkpoint, decoder and configurations](https://huggingface.co/ASLP-lab/DiffRhythm2/tree/9aa15742e4889c0eb2e198db6fdab1facf1b6761) | `9aa15742e4889c0eb2e198db6fdab1facf1b6761` | Apache-2.0 |
| [OpenMuQ MuQ-MuLan-large weights and configuration](https://huggingface.co/OpenMuQ/MuQ-MuLan-large/tree/2e01c796b71dca71b45251384c04cd7b237c9020) | `2e01c796b71dca71b45251384c04cd7b237c9020` | CC BY-NC 4.0 |
| [OpenMuQ MuQ-large-msd-iter audio backbone](https://huggingface.co/OpenMuQ/MuQ-large-msd-iter/tree/0562a57814f6f8bbd9fdea0a25921a2fce1a841a) | `0562a57814f6f8bbd9fdea0a25921a2fce1a841a` | CC BY-NC 4.0 |
| [XLM-RoBERTa text backbone and fast tokenizer](https://huggingface.co/FacebookAI/xlm-roberta-base/tree/e73636d4f797dec63c3081bb6ed5c7b0bb3f2089) | `e73636d4f797dec63c3081bb6ed5c7b0bb3f2089` | MIT |

MuQ-MuLan initializes both backbones when starting up, including for text conditioning. The runner loads each component from the profile folder with Hugging Face and Transformers offline mode enabled. The artifact set includes both files published for MuQ-MuLan. The build verifies the English and Mandarin lexicons, tokenizers and ONNX data against the [phonemizer file manifest](../../../scripts/desktop/diffrhythm2-runtime/phonemizer-files.json). eSpeak NG is loaded from the package.

The checkpoint licenses govern use and redistribution of those files. Preserve the Apache-2.0 notices and credit OpenMuQ under CC BY-NC 4.0 for noncommercial distribution of its weights. Separately, ASLP Lab asks users to verify musical originality, disclose AI involvement and obtain the necessary permissions for adapting protected styles. A future WAV-reference workflow requires input validation and documentation of permission to use the reference recording. [Publisher's model card](https://huggingface.co/ASLP-lab/DiffRhythm2#-license--disclaimer), [third-party notices](../../../THIRD_PARTY_NOTICES.md)

The decoder produces a single 48 kHz channel. The runner writes it as mono PCM16 WAV. Upstream's optional two-channel output derives both channels from mono. The app measures the actual WAV duration and records runner wall time separately. An upstream end-of-song prediction can yield a shorter WAV.

## CUDA evaluation build and hardware checks

The opt-in AppImage targets Linux x86-64 with NVIDIA CUDA. The runner checks whether it can allocate a CUDA tensor with the installed driver. RAM and VRAM measurements, CPU fallback, macOS and Windows are pending.

On a Linux x86-64 build machine, prepare and verify the evaluation AppImage with the explicit build flags.

```sh
MUSIC_GENERATOR_LINUX_BACKEND=cuda MUSIC_GENERATOR_DIFFRHYTHM2=1 npm run bundle
MUSIC_GENERATOR_LINUX_BACKEND=cuda MUSIC_GENERATOR_DIFFRHYTHM2=1 node scripts/desktop/verify-bundle.mjs
```

The output is `Music-Generator-VERSION-linux-x64-cuda-diffrhythm2.AppImage`. It bundles CPython 3.11.16, PyTorch and torchaudio 2.7.0 with CUDA 12.6, the upstream source at `7804f821b797b4f276090e1a9dcd37e97d9915d5`, phonemizer 3.3.0 and eSpeak NG 1.52.0. Its runner lives at `engine/diffrhythm2/diffrhythm2-synth`. Call it with `--check-runtime` for a model-free import and English/Mandarin phonemizer check.

After acquiring the models, run the following acceptance cases with network access disabled on a Linux x86-64 NVIDIA computer. Record the GPU and driver, build and model revisions, maximum VRAM, runner wall time, number of channels and measured WAV duration.

1. Verify the installed profile in ModelPicker, then submit English lyrics and a style description for a 10-second song. Leave the title blank to exercise the offline title fallback. Play the mono WAV from the library and check that the lyrics are intelligible and the style is recognizable.
2. Submit Mandarin lyrics and a different style description with a 30-second duration and a fixed seed. Listen for the Mandarin lyrics and compare `duration`, `requested_duration` and `runtime_seconds` in the song result. If the model ends early, verify the duration warning.
3. Cancel a third job after synthesis begins. Verify that the runner exits, the library has no finished WAV for that job and a new generation can start. Re-select ACE-Step and verify the normal generation controls and recommended profile remain usable.

The development host is macOS arm64. The pinned eSpeak NG source built on that host and produced IPA for English and Mandarin using the installed local dictionaries. Catalog, downloader and adapter tests cover artifact handling and the one-shot WAV process. The Linux package, a packed CUDA lyrics-to-WAV run, cancellation during GPU inference and performance measurements still require the target platform.

The seven small assets were downloaded and hashed locally. The shared downloader also acquired both primary configuration files and the XLM-RoBERTa tokenizer, then reused the verified copies with an unreachable server. The five large weight pins were checked against their immutable Git LFS pointers and the matching Hugging Face download headers. Full transfers and content hashes of those five payloads remain pending.
