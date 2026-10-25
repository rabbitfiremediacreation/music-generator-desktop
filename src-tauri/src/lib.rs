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
pub mod form_preferences;
pub mod hardware;
pub mod import;
mod jobs;
pub mod library;
pub mod manifest;
mod model_commands;
pub mod power;
mod process_output;
pub mod runtime;
pub mod sandbox;
pub mod setup;
mod startup;
pub mod state;
pub mod titles;
pub mod types;
mod updates;
pub mod verification;
mod windows;

use std::sync::Arc;
use tauri::{Emitter, Manager};

pub fn run() {
    let started = std::time::Instant::now();
    #[cfg(windows)]
    windows::configure_runtime();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app
                .get_webview_window("splash")
                .or_else(|| app.get_webview_window("main"))
            {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["splash"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            let root = sandbox::data_root();
            #[cfg(not(target_os = "macos"))]
            let root = app.path().app_local_data_dir()?;
            #[cfg(debug_assertions)]
            let root = std::env::var_os("MUSIC_GENERATOR_DEV_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(root);
            let resources = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
            } else {
                app.path().resource_dir()?
            };
            app.manage(startup::Startup::new(root, resources, started));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            startup::startup_status,
            startup::splash_ready,
            startup::startup_error,
            startup::retry_startup,
            startup::startup_complete,
            commands::setup_models,
            commands::setup_estimate,
            commands::cancel_setup,
            commands::import_library,
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
            commands::get_generation_form_preferences,
            commands::save_generation_form_preferences,
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
            if app.get_webview_window("splash").is_some() {
                app.exit(0);
            } else {
                let _ = app.emit("request-exit", ());
            }
        }
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app.try_state::<Arc<state::AppState>>() {
                state.begin_shutdown();
                state.stop_engine();
            }
            #[cfg(target_os = "macos")]
            sandbox::shutdown();
        }
    });
}
