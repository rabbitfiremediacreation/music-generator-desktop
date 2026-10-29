//! Console entry point for MCP hosts, including redirected pipes on Windows.
fn main() {
    let code = music_generator::mcp::bridge::cli().unwrap_or_else(|| {
        eprintln!("Usage: music-generator-mcp --mcp-stdio /absolute/path/to/mcp.json");
        2
    });
    std::process::exit(code);
}
