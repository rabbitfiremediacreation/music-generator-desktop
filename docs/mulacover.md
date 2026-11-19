# MuLaCover

MuLaCover by MuLa Labs is an experimental local remix profile. In **Settings → Models and hardware → Add model**, choose **MuLaCover** and review the usage and output terms before downloading. The installer and first-run recommendations use their usual ACE-Step models. MuLaCover weights are acquired separately.

Both the weights and music generated with them are for noncommercial use. Commercial use requires written authorization from MuLa Labs. CC BY-NC 4.0 requires attribution when sharing the weights. The model terms grant no rights to third-party recordings, compositions, performances, or lyrics. Use only your own material or material you have permission to remix. [Official project](https://github.com/HeartMuLa/MuLaCover) · [Model and output terms](https://huggingface.co/HeartMuLa/MuLaCover/blob/0f5ca612a41134738a14a28f95ed80bfa9b52adc/MODEL_LICENSE)

## Local audio workflow

In the Creator, choose a local 16-bit PCM WAV (mono or stereo, 8–48 kHz, up to 60 MiB) containing clear lead singing. Confirm that you have permission to use it. Enter lyrics and style such as `genre:[folk]; instrument:[acoustic guitar]; mood:[warm]`. Maximum length is a generation budget. MuLaCover can finish earlier. The app stores a local copy of the reference for queued jobs and retries. The result is a 48 kHz stereo PCM16 WAV, with measured playback duration and elapsed runtime saved separately.

The pinned audio.cpp release supports either a reference recording or melody/chord MIDI, with an optional drum MIDI track. Its audio path transcribes the lead vocal with YourMT3, estimates tempo, and extracts harmony using five ChordNet folds. It requires SoXR resampling. The app exposes audio conditioning on the desktop and uses the shared generation queue and cancellation. [audio.cpp v0.9.5](https://github.com/0xShug0/audio.cpp/releases/tag/v0.9.5) · [Pinned reference modes](https://huggingface.co/audio-cpp/audio.cpp-gguf/blob/57de533382ad47d5527e7562d1f80c41f769553b/MuLaCover-GGUF/README.md)

## Pinned artifacts

The selected runtime loads a single GGUF, which embeds the generator, Qwen3 style encoder, HeartCodec, YourMT3, and five ChordNet folds. The shared downloader resumes interrupted transfers and verifies the pinned size and SHA-256 before activation. To import an existing GGUF, place it at `mulacover/MuLaCover-Q8_0.gguf` under the selected model directory and choose **Verify and use** in the picker.

| Runtime checkpoint | Pinned revision | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| [`audio-cpp/audio.cpp-gguf/MuLaCover-GGUF/mulacover-q8_0.gguf`](https://huggingface.co/audio-cpp/audio.cpp-gguf/blob/57de533382ad47d5527e7562d1f80c41f769553b/MuLaCover-GGUF/mulacover-q8_0.gguf) | `57de533382ad47d5527e7562d1f80c41f769553b` | 8,220,378,496 | `5daca50ce959c63dcfef3be1e3a7cd855eee753a91cab1a3475da1af781e4518` |

The package author names the MuLaCover base revision `bbbaef2b31835c2ef5172ff528dbe325230d46fb` and the reference implementation commit `e27fa7fa0da7c9817879cc6210cc5693f9327946`. The five source shard hashes, configuration, index and tokenizer match the official catalog revision `0f5ca612a41134738a14a28f95ed80bfa9b52adc`. [Package provenance](https://huggingface.co/audio-cpp/audio.cpp-gguf/blob/57de533382ad47d5527e7562d1f80c41f769553b/MuLaCover-GGUF/README.md) · [The app’s pinned catalog](../models/catalog.json)

The GGUF reuses the [HeartCodec revision from #125](https://huggingface.co/HeartMuLa/HeartCodec-oss-20260123/tree/58ec14fd02a123316e4fdaa9fe49fa7a902d1a6f). Both original Safetensors shards passed their pinned byte counts and SHA-256 checks. The config and shard index match the embedded bytes. Reapplying the audio.cpp conversion to every original tensor reproduced all 818 embedded tensors byte for byte (307 FP32, 295 FP16, 216 Q8_0, totaling 1,967,809,746 bytes). The launcher reads this embedded codec from the GGUF.

The style encoder config, tokenizer and tokenizer config match the embedded GGUF data. The first input layer-normalization tensor matches after widening the original BF16 values to FP32. The official encoder uses Apache-2.0, as does HeartCodec. The following pins record the original Qwen inputs to the audio.cpp converter. The runtime reads the corresponding data from the GGUF. [Qwen3-Embedding-0.6B at `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/tree/97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3)

| Qwen source path | Bytes | SHA-256 |
| --- | ---: | --- |
| `config.json` | 727 | `b5bf1f51fc45be473a54718cef92448d90a1be001bf9b9a44b8c7f10a19feaa9` |
| `model.safetensors` | 1,191,586,416 | `0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd` |
| `tokenizer.json` | 11,423,705 | `def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a` |
| `tokenizer_config.json` | 9,706 | `253153d0738ceb4c668d2eff957714dd2bea0b56de772a9fdccd96cbf517e6a0` |

## Transcription checkpoints

YourMT3's published checkpoint is `amt/logs/2024/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops/checkpoints/last.ckpt`, 561,544,628 bytes, SHA-256 `ae38e415c79efd5592dcb9b658cdb99ddb11d4c4e1eaa364cab04a052473fc25`. The publisher's Hugging Face Space labels revision `5e66c1ea173a8186e0d20432b841d3180cc015b5` Apache-2.0. audio.cpp also attributes its YourMT3 path under Apache-2.0. The YourMT3 GitHub repository carries GPL-3.0, and MuLaCover's reference implementation records an unresolved source-license discrepancy for the adapted Python files. The app uses the audio.cpp native implementation and the GGUF publisher's converted tensors. Exact source-revision authorization for public redistribution of the port remains unconfirmed. [Pinned checkpoint](https://huggingface.co/spaces/mimbres/YourMT3/blob/5e66c1ea173a8186e0d20432b841d3180cc015b5/amt/logs/2024/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops/checkpoints/last.ckpt) · [Audio.cpp notices](https://github.com/0xShug0/audio.cpp/blob/61c7838baf1f7f34769b5b7bd369c0d78edf9535/tests/mulacover/NOTICE) · [MuLaCover third-party notices](https://github.com/HeartMuLa/MuLaCover/blob/e27fa7fa0da7c9817879cc6210cc5693f9327946/THIRD_PARTY_NOTICES.md)

ChordNet's five folds are published by Music X Lab under MIT at commit `481f4ce703f8822b99f4037e9104ba1760e21ea3`. The original files were downloaded and hashed. Each filename below is under `cache_data/` and begins with `joint_chord_net_ismir_naive_v1.0_reweight(0.0,10.0)_`. [Pinned ChordNet checkpoints](https://github.com/music-x-lab/ISMIR2019-Large-Vocabulary-Chord-Recognition/tree/481f4ce703f8822b99f4037e9104ba1760e21ea3/cache_data) · [ChordNet license](https://github.com/music-x-lab/ISMIR2019-Large-Vocabulary-Chord-Recognition/blob/481f4ce703f8822b99f4037e9104ba1760e21ea3/LICENSE)

| Checkpoint suffix | Bytes | SHA-256 |
| --- | ---: | --- |
| `s0.best.sdict` | 5,746,183 | `921b42d5d1cf9ce1c0c0e45a74d409b8066e0acec46058ef74e24ee0fb540761` |
| `s1.best.sdict` | 5,746,175 | `bcb75859e0efa256696cf5da396b320093317b9b1d9560c304f46c25fe1f8b17` |
| `s2.best.sdict` | 5,746,179 | `acddf85c3fff29954c4877021177d72e2cba9f729ce80c1010f054c477bf3f61` |
| `s3.best.sdict` | 5,746,175 | `65d81a3ab73435aaaade586981b4cabdf57b8953d76052703e6968c32ef8421c` |
| `s4.best.sdict` | 5,746,227 | `5ff6b0ec85640e17a09a9b3de68c93fdd45adc24488e8fa9be5715c28d561122` |

Three sampled YourMT3 FP32 tensors match the published checkpoint byte for byte. For ChordNet, all 160 tensors across the five folds reproduce the embedded GGUF bytes using the appropriate FP32, FP16, or Q8_0 conversion.

The macOS arm64 runtime uses the shared [pinned audio.cpp C SDK package](../models/audio-cpp-runtime.json) and a bundled SoXR 0.1.3 dylib. The SoXR build verifies the [publisher's source tarball](https://downloads.sourceforge.net/project/soxr/soxr-0.1.3-Source.tar.xz) (94,384 bytes, SHA-256 `b111c15fdc8c029989330ff559184198c161100a59312f5dc19ddeb9b5a15889`) and includes its LGPL-2.1-or-later license and corresponding source.

## Hardware acceptance

On 2026-11-19, the pinned launcher ran on an Apple M5 Pro (20 GPU cores, 64 GiB unified memory, macOS 26.6.2, build 25G83) with the Metal backend. A macOS sandbox denied external outbound connections and permitted loopback. The GGUF had already passed its full-file SHA-256 check. The picker enables the profile for macOS arm64 with the bundled runtime and at least 64 GiB of memory.

| Check | Observed result |
| --- | --- |
| Reference | 22.912 seconds, mono PCM16 WAV, 44.1 kHz |
| Run | 10-second budget, seed 1234, 155.46 seconds wall time including startup and model load |
| Output | 10.000 seconds, stereo PCM16 WAV, 48 kHz, 1,920,044 bytes |
| Output SHA-256 | `44c87f54d0b050f7c6d13aec8513c6dbc6a5b52ad37521877f5284e97e67ed3c` |
| Memory | 9,204,187,136 bytes maximum RSS (8.57 GiB) and 8,828,444,856 bytes peak memory footprint (8.22 GiB), reported by `/usr/bin/time -l` |
| Native process interruption | Interrupted a second run after the first backbone decode stage began. The process exited in 0.133 seconds and left no WAV. |
| Desktop download | The shared ModelDownloader resumed the final 1 MiB from the pinned Hugging Face URL, verified the complete 8,220,378,496-byte file, and activated the profile. |
| Desktop offline import and remix | A fresh data directory with external outbound connections denied verified the existing GGUF from disk and activated it. The desktop queue rendered 10.000 seconds of stereo PCM16 WAV at 48 kHz in 124.50 seconds. The blank title used its local fallback. |
| Desktop cancellation and export | Cancelling a second running job removed its temporary WAV workspace. The normal WAV export of the completed remix matched the library file byte for byte. SHA-256 `fbc804fc9ace7f600cae70991ead1f0a53fc214abb5f8e8b32126cff98e17629`. |

The test reference was the public high-quality preview of a CC0 vocal performance by buggly, transcoded to mono PCM16 at 44.1 kHz. Its WAV SHA-256 is `a728b5d3868b6c7363ed28a5bbd56ce0286f398808404b16ecc3d0fe8ecb81d6`. A separate synthetic reference reached transcription, yielded no recognized lead notes, and returned a model error without a WAV. [CC0 reference](https://freesound.org/people/buggly/sounds/748552/)

The measured path covers the first short audio remix on Apple Silicon and Metal. MIDI, Intel Mac, Windows, Linux, CPU inference, and other memory configurations have no hardware acceptance in this change.
