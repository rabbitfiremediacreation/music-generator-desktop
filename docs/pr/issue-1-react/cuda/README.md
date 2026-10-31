# CUDA setup in React

Screenshots of the implemented React setup wizard with simulated Windows/NVIDIA backend responses. Captured in headless Chromium at 1100 px width from a production Vite build; no Windows GPU or actual driver installation was used.

- `download-de.png`: compatible NVIDIA GPU with missing app-local CUDA components, optional download and download size.
- `ready-de.png`: successful simulated download, refreshed GPU policy and availability message; actual generation remains unconfirmed.
- `driver-de.png`: driver initialization failure, NVIDIA driver help and expanded text diagnostics.

React integration tests cover hardware gating, all backend states, duplicate requests, mutual exclusion with model setup, progress/stage events, cancellation and retry, policy refresh, language changes, native driver link and subscription cleanup.
