#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = music_generator::mcp::bridge::cli() {
        std::process::exit(code);
    }
    if let Some(code) = music_generator::synthesis_policy::cli() {
        std::process::exit(code);
    }
    #[cfg(target_os = "macos")]
    if std::env::args().nth(1).as_deref() == Some("--startup-location-probe") {
        music_generator::sandbox::probe::startup_location();
        return;
    }
    #[cfg(target_os = "macos")]
    if std::env::args().nth(1).as_deref() == Some("--sandbox-probe") {
        let path = std::env::args_os()
            .nth(2)
            .expect("Sandbox probe requires a denied-path fixture");
        if let Err(error) = music_generator::sandbox::probe::run(std::path::Path::new(&path)) {
            eprintln!("Sandbox probe: {error}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(code) = music_generator::engine::process::supervise() {
        std::process::exit(code);
    }
    music_generator::run();
}
