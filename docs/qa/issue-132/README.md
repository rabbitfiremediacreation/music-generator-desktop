# AudioCraft local profiles

Issue [#132](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/132) covers MusicGen Small and MAGNeT Small 30s. Both accept a musical description, optionally combined with style tags. The output is 32 kHz mono, 16-bit PCM WAV. MusicGen supports 1–30 seconds in 20 ms codec frames. MAGNeT generates the checkpoint's fixed 30-second clip. Both accept one variant per job and an unsigned 32-bit seed, with an option to choose the seed randomly.

## Runtime and model acquisition

The runtime uses AudioCraft 1.3.0. Its loaders consume the native `state_dict.bin` and `compression_state_dict.bin` pair for each profile. Both checkpoint configurations select the frozen T5-base encoder and 32 kHz EnCodec with four codebooks at 50 Hz. The EnCodec archives have different hashes, so each profile uses its own codec file. The shared T5-base folder contains the encoder configuration, the Safetensors checkpoint and the SentencePiece vocabulary. [AudioCraft loaders](https://github.com/facebookresearch/audiocraft/blob/72cb16f9fb239e9cf03f7bd997198c7d7a67a01c/audiocraft/models/loaders.py) · [AudioCraft text conditioner](https://github.com/facebookresearch/audiocraft/blob/72cb16f9fb239e9cf03f7bd997198c7d7a67a01c/audiocraft/modules/conditioners.py) · [T5-base files](https://huggingface.co/google-t5/t5-base/tree/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1)

The desktop patch uses PyTorch scaled dot-product attention and retains MusicGen's causal mask and MAGNeT's stage-specific attention bias. It resolves only local checkpoints, loads the two PyTorch archives with `weights_only=True`, and initializes T5 using local-only Safetensors. The application checks the complete model profile before opening the runner. [Desktop patch](../../../scripts/desktop/audiocraft-runtime/audiocraft-local.patch)

| Profile | Pinned Meta revision | Model and codec | Total with shared T5 |
| --- | --- | ---: | ---: |
| [MusicGen Small](https://huggingface.co/facebook/musicgen-small/tree/4c8334b02c6ec4e8664a91979669a501ec497792) | `4c8334b02c6ec4e8664a91979669a501ec497792` | 1,076,845,798 B | 1,969,285,052 B |
| [MAGNeT Small 30s](https://huggingface.co/facebook/magnet-small-30secs/tree/7d62a3ef839d51abb5f087ac72732d6f45301460) | `7d62a3ef839d51abb5f087ac72732d6f45301460` | 1,076,848,566 B | 1,969,287,820 B |

On a supported app build, enable Expert Mode in **Settings → Models and hardware**, open **Add model**, select a CC BY-NC 4.0 profile, and review the sources and usage terms. **Download and use** fetches and verifies the missing files. For local import, follow the file paths listed in the picker relative to the displayed model folder, refresh the file list, then choose **Verify and use**. Switching between the two profiles reuses verified T5 files. [Catalog with all seven file pins](../../../models/catalog.json)

Meta's checkpoints are available publicly under CC BY-NC 4.0, which requires attribution and limits use to noncommercial purposes. The rights to the generated music must be assessed separately. [AudioCraft weights license](https://github.com/facebookresearch/audiocraft/blob/72cb16f9fb239e9cf03f7bd997198c7d7a67a01c/LICENSE_weights) · [Upstream licensing discussion](https://github.com/facebookresearch/audiocraft/issues/198)

## Experimental desktop bundle

Build on Apple Silicon with the repository's normal desktop build prerequisites. The optional build embeds pinned CPython 3.11.15, PyTorch 2.8.0 and the remaining inference dependencies. The native launcher uses the embedded interpreter even with an empty `PATH`. The AudioCraft build produces a separate ZIP and DMG with `-audiocraft` in the filename.

```sh
npm run bundle -- --audiocraft
node scripts/desktop/verify-bundle.mjs --audiocraft
node scripts/desktop/verify-bundle.mjs --audiocraft --dmg
```

The catalog targets macOS arm64 on CPU and uses the test machine's 64 GiB RAM as the availability threshold. The embedded runtime uses approximately 565 MiB on disk. The native dependency inspection found a minimum macOS version of 14.0 or earlier on every bundled arm64 Mach-O. The inference test host runs macOS 26.6.2 on an Apple M5 Pro.

The local ZIP and DMG checks start the relocated, ad hoc signed application. The AudioCraft launcher starts with an empty `PATH`, inherits the App Sandbox and is denied access to an unselected test file.

## Acquisition checks

All seven public model files were downloaded and matched their pinned sizes and SHA-256 values. The shared downloader resumed the MusicGen codec with an HTTP 206 response for the final MiB and verified the complete file before promotion. With network access disabled, the shared installer imported both profiles from the model folder and reused T5's verified cache when switching profiles.

## Offline inference

The relocated runtime passed its native self-test with an empty `PATH` and outbound networking denied. The desktop test used a separate app ID and library and allowed only loopback transport for its test client. The timings include checkpoint loading and reflect the test host while other builds were active. Peak RSS was measured for standalone processes with `/usr/bin/time -l`.

| Profile and path | Requested | WAV | Wall time | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| MusicGen, standalone | 1 s | 1 s | 49.95 s | 2.73 GiB |
| MusicGen, desktop queue | 5.513 s | 5.5 s | 215.72 s | — |
| MusicGen, standalone | 30 s | 30 s | 802.39 s | 6.60 GiB |
| MAGNeT, standalone | 30 s | 30 s | 614.57 s | 7.21 GiB |
| MAGNeT, desktop queue | 30 s | 30 s | 642.13 s | — |

- MusicGen standalone used seed 132 and “Minimal acoustic chamber jazz, brushed drums, warm upright bass and felt piano, instrumental, slow spacious groove”. The initial 1-second run took 417.88 s including macOS library validation and produced identical bytes to the 49.95-second run.
- MAGNeT standalone used seed 133 and “Slow ambient instrumental sketch with soft analog synth chords, distant tape texture, and a gentle electric piano melody”.
- The desktop jobs used seed 42. MusicGen used “Intimate nylon guitar arpeggios, mellow brushed drums, warm bass, a quiet jazz trio”. MAGNeT used “Bright instrumental disco, syncopated bass, vintage synth phrases, clean dance drums”.

The desktop saved the requested and measured durations and the exact model snapshot. It filled blank titles from the local fallback and exported the MusicGen WAV byte for byte. Cancelling a running MAGNeT job took 0.21 s through removal of the temporary working folder and left no WAV or partial output. Killing a separate standalone MAGNeT process during checkpoint loading took 0.066 s and left no WAV.

Listening samples from the desktop test are in the local `test-results/issue-132/` directory. `musicgen-small.wav` contains 5.5 seconds. `magnet-small-preview.wav` contains the first 8 seconds of `magnet-small-desktop.wav`. For the PCM conversion the runner limits samples to the representable range. 0.18% of samples in the desktop MAGNeT WAV reached full scale, compared with 0.40% in its standalone run and 0.006% in the standalone 30-second MusicGen WAV.
