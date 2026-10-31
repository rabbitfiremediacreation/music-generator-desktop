# Windows CUDA setup (#58)

Actual Chromium captures of the implemented setup controller, translations and
styles, using simulated Tauri IPC responses and Windows/NVIDIA hardware data.
The fixture uses an RTX 4060, example paths, a driver-version example and an
empty library. No NVIDIA download, native Windows installation or audio
generation was performed for these captures.

- `download-de.png`: missing CUDA runtime, optional download button and size.
- `ready-de.png`: UI after the simulated download returns CUDA availability.
- `driver-de.png`: simulated driver initialization error, driver link and
  expanded technical diagnosis.

The captures use the production `showSetup` implementation and the Tauri API's
`mockIPC` helper. A temporary Vite build was loaded through local browser request
interception without starting a server. Viewport: 1100 × 1000, device scale 1.
The capture exercised the download button and the diagnostic disclosure, and
reported no browser JavaScript errors. These images are interface evidence;
Windows/NVIDIA hardware acceptance remains open as documented in
`docs/backend-status.md`.
