# MCP integration evidence

`integration.jpg` is a browser screenshot of `integration.html`, rendered from the actual serialized MCP responses in `transcript.json`. The test uses the official SDK client against the implemented server, an isolated SQLite library and a mock Tauri window runtime. Folder creation, song updates, cancellation and resource reads run through the real MCP handlers and are asserted against the shared database. No real audio engine or models are used in this fixture.

Capture a fresh transcript after building the frontend:

```sh
MUSIC_GENERATOR_MCP_TEST_TRANSCRIPT=/tmp/music-generator-mcp-transcript.json \
  cargo test --manifest-path src-tauri/Cargo.toml --locked \
  sdk_roundtrip_controls_the_shared_library -- --nocapture
```

Additional tests exercise actual loopback HTTP requests (authentication, legacy and modern negotiation, routing, body size), the console stdio bridge as a child process, CPU admission, imported vocal variants, cancellation races, pagination, scoped background operations and export publication. See [the setup guide](../../mcp.md) for supported features and remaining native setup requirements.
