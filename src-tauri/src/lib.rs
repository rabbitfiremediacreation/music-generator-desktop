pub mod admission;
pub mod audio_export;
pub mod catalog;
mod commands;
pub mod configuration;
pub mod db;
pub mod download;
pub mod engine;
pub mod error;
pub mod exports;
pub mod hardware;
pub mod import;
mod jobs;
pub mod library;
pub mod manifest;
mod model_commands;
pub mod power;
pub mod runtime;
pub mod sandbox;
pub mod setup;
pub mod state;
pub mod titles;
pub mod types;
mod updates;
pub mod verification;
mod windows;

use std::sync::Arc;
use tauri::{Emitter, Manager};

pub fn run() {
    #[cfg(windows)]
    windows::configure_runtime();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            let root = sandbox::data_root();
            #[cfg(not(target_os = "macos"))]
            let root = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(root.join("logs"))?;
            let log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(root.join("logs/desktop.log"))?;
            let _ = tracing_subscriber::fmt()
                .with_ansi(false)
                .with_writer(std::sync::Mutex::new(log))
                .try_init();
            sandbox::initialize(&root)?;
            let resources = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
            } else {
                app.path().resource_dir()?
            };
            let state = Arc::new(state::AppState::new(db::Database::open(&root)?, resources));
            app.manage(state.clone());
            tauri::async_runtime::spawn(jobs::worker(state, app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::setup_models,
            commands::setup_estimate,
            commands::cancel_setup,
            commands::import_library,
            commands::preview_import,
            commands::preview_library_move,
            commands::list_songs,
            commands::get_song,
            commands::generate,
            commands::patch_song,
            commands::delete_song,
            commands::retry_song,
            commands::list_folders,
            commands::save_folder,
            commands::delete_folder,
            commands::queue,
            commands::get_settings,
            commands::save_settings,
            commands::analyze,
            commands::health,
            commands::export_file,
            commands::check_update,
            commands::exit_app,
            commands::remember_folder,
            model_commands::model_catalog,
            model_commands::use_models,
            model_commands::select_models,
            model_commands::download_title_model,
            model_commands::cancel_model_download
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start Music Generator");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
        {
            api.prevent_exit();
            let _ = app.emit("request-exit", ());
        }
        if let tauri::RunEvent::Exit = event {
            let state = app.state::<Arc<state::AppState>>();
            state.begin_shutdown();
            state.stop_engine();
            #[cfg(target_os = "macos")]
            sandbox::shutdown();
        }
    });
}
