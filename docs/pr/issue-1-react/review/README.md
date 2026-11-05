# PR #52 review corrections

Actual React production-build screenshots captured in Chromium at 1280×1100 with simulated Tauri/backend responses and a synthetic one-second WAV. They are UI evidence, not a native Windows/GPU acceptance test.

- `player-instrumental-de.png`: original player title „Genießt den Fluß“ is preserved; manually typed `[Instrumental]` is labeled as instrumental.
- `settings-de.png`: settings after dismissing an edited draft with Escape and reopening. Chromium also verified backdrop dismissal and that no save command was sent by either dismissal.
- `setup-xl-fr.png`: simulated GTX 1060/6 GiB with existing XL files and a selected Standard profile. The additional XL download stays unchecked; an explicitly selected XL profile is covered by regression tests.

The Chromium check also deleted the loaded song through the real React library controls and verified that the player disappeared. Analysis normalization, queue transitions, pending-audio deletion, protected settings saves, and all twelve CUDA languages have focused regression tests.
