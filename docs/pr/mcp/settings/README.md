# MCP settings in React

These screenshots show the implemented `SettingsDialog` and `McpSettings` React components, built with the repository's Vite/React/Tailwind plugins and rendered in Chromium. Tauri command responses and paths are fixtures; the screenshots do not claim native model inference or contain live credentials.

- `settings-de.png`: MCP enabled on port 32123, client configuration copied, connection details expanded.
- `settings-narrow-de.png`: the same controls at a 480-pixel viewport, after closing and reopening the settings dialog.

Browser interaction verified activation with Enter in the port field, fixed port selection, valid copied stdio JSON, preserved settings after reopening, deactivation, no writes to general settings, and no horizontal overflow at the narrow width. There were no page errors. Separate Rust loopback tests exercise the actual server and its persisted settings, authentication, port conflicts and shutdown behavior.
