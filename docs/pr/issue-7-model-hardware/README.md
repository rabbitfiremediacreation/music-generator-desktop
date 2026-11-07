# Issue 7: models and hardware entry

UI source revision: `eace0e1f340f8e2212635c4f0ad24839f5f74860`.

These screenshots show the actual production frontend rendered in headless Chromium.
The capture used isolated example settings, an empty library, a simulated Apple M4
with 16 GiB RAM, verified model fixtures and mocked Tauri IPC. No user library,
model files or native hardware tests were used. Assets were served through browser
request interception without starting a server.

- `settings.png`: the single **Modelle und Hardware** entry in Settings.
- `model-manager.png`: model management, hardware details and the explicit
  **Hardwaretest im Einrichtungsassistenten …** action. The explanatory text
  identifies setup's effects on storage locations and the recommended profile.

The images demonstrate the interface and navigation entrypoints. They do not
constitute native macOS or hardware acceptance.
