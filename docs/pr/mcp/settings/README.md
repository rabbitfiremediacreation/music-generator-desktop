# MCP TCP service in React

These screenshots show the implemented `SettingsDialog` and `McpSettings` React components, built with the repository's Vite/React/Tailwind plugins and rendered in Chromium. Tauri command responses, network addresses and access keys are fixtures; the screenshots do not claim native model inference or contain live credentials.

- `settings-de.png`: MCP enabled for the local network on port 32123, direct HTTP client configuration copied, access key masked.
- `settings-narrow-de.png`: the same controls at a 480-pixel viewport, after closing and reopening the settings dialog.

Browser interaction verified activation with Enter in the port field, fixed port selection, valid copied HTTP JSON with the selected LAN URL and bearer header, masked credentials, clearing credentials on reopening, preserved settings after reopening, deactivation, no writes to general settings, and no horizontal overflow at the narrow width. There were no page errors. Separate Rust tests exercise the actual TCP listener, HTTP authentication over a detected non-loopback interface, persisted scope and private access key, local/LAN switching, port conflicts and shutdown behavior. These checks do not claim a second-device or firewall acceptance test.
