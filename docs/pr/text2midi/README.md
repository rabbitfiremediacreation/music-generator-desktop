# Text2midi interface evidence

Captured on 2026-11-20 in Chromium using the production Vite build from the
frontend merge of `4d22ceb` and `79314f4`. Browser request interception served
the built assets locally. Tauri IPC, library rows and file-dialog responses
were fixtures. The capture used German UI labels and an isolated example
library.

- [Studio](studio-midi-de.png) shows the MIDI prompt, seed, completed MIDI
  result and export button. The fixture uses the prompt, seed and measured
  runtime from the real offline queue test. Its MIDI export is 1,308 bytes
  with SHA-256 `405c77a277bf38f635dc667a8482913d9050d20436f231248fbc4073d4fc0384`.
  Mido parsed its 13 tracks, 118 notes and one tempo event at 121.29 BPM.
  Clicking the export button in the capture issued the `midi` export IPC with
  a `.mid` destination.
- [Model catalog](model-picker-de.png) shows the Text2midi model and FLAN-T5
  encoder sources, pinned revisions, terms and supported CPU platform before
  download.
