pub mod admission;
pub mod audio_export;
pub mod audio_facts;
pub mod audio_import;
mod audio_upload;
pub mod catalog;
mod commands;
pub mod configuration;
pub mod cuda_runtime;
pub mod db;
pub mod download;
pub mod engine;
pub mod engine_packages;
pub mod error;
pub mod exports;
pub mod form_preferences;
pub mod generation_limits;
pub mod hardware;
mod hugging_face_token;
pub mod import;
mod jobs;
mod lan_tls;
mod launch_location;
pub mod library;
pub mod manifest;
pub mod mcp;
mod menu;
mod model_commands;
pub mod paths;
pub mod phone_access;
pub mod power;
mod process_output;
mod random_titles;
mod reference_audio;
pub mod runtime;
pub mod sandbox;
pub mod setup;
mod startup;
mod startup_windows;
pub mod state;
pub mod stems;
pub mod synthesis_policy;
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
        .register_asynchronous_uri_scheme_protocol("audio-analysis", audio_upload::handle)
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
        .on_window_event(|window, event| {
            if window.label() == "splash"
                && matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                )
                && window
                    .try_state::<startup::Startup>()
                    .is_none_or(|startup| startup.should_exit_on_splash_close())
            {
                window.app_handle().exit(0);
            }
        })
        .plugin(
            {
                let builder = tauri_plugin_window_state::Builder::default();
                #[cfg(windows)]
                let builder = builder.skip_initial_state("main");
                builder
            }
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
            {
                use tauri::Listener;
                menu::install(app)?;
                let handle = app.handle().clone();
                app.listen("settings-changed", move |_| {
                    updates::macos::configure(&handle)
                });
            }
            #[cfg(target_os = "macos")]
            let root = sandbox::data_root();
            #[cfg(not(target_os = "macos"))]
            let root = app.path().app_local_data_dir()?;
            #[cfg(debug_assertions)]
            let root = std::env::var_os("MUSIC_GENERATOR_DEV_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(root);
            let resources = resource_directory(app)?;
            startup_windows::initialize(app, root, resources, started)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            stems::desktop::stem_models,
            stems::desktop::stem_search,
            stems::desktop::stem_cancel_search,
            stems::desktop::stem_hf_check,
            stems::desktop::stem_check_update,
            stems::desktop::stem_install_engine,
            stems::desktop::stem_install_model,
            stems::desktop::stem_pause_transfer,
            stems::desktop::stem_discard_partial,
            stems::desktop::stem_model_removal,
            stems::desktop::stem_remove_model,
            stems::desktop::stem_activate_model,
            stems::desktop::stem_song_source,
            stems::desktop::stem_pick_sources,
            stems::desktop::stem_source_audio,
            stems::desktop::stem_project_audio,
            stems::desktop::stem_add_track,
            stems::desktop::stem_generate_track,
            stems::desktop::stem_prepare_track_model,
            stems::desktop::stem_cancel_track_generation,
            stems::desktop::stem_spectral_preview,
            stems::desktop::stem_spectral_scan,
            stems::desktop::stem_spectral_audition,
            stems::desktop::stem_repair_spectrum,
            stems::desktop::stem_relink_source,
            stems::desktop::stem_preflight,
            stems::desktop::stem_start,
            stems::desktop::stem_jobs,
            stems::desktop::stem_job,
            stems::desktop::stem_latest_project,
            stems::desktop::stem_remove_project,
            stems::desktop::stem_cancel,
            stems::desktop::stem_retry,
            stems::desktop::stem_mixes,
            stems::desktop::stem_save_mix,
            stems::desktop::stem_start_export,
            stems::desktop::stem_exports,
            stems::desktop::stem_cancel_export,
            stems::desktop::stem_save_export,
            stems::desktop::stem_open_export,
            startup::startup_status,
            startup::startup_splash_progress,
            startup::startup_allowed,
            startup::splash_ready,
            startup::startup_error,
            startup::retry_startup,
            startup::startup_show_main,
            startup::startup_complete,
            commands::setup_models,
            commands::setup_library,
            engine_packages::engine_package_status,
            engine_packages::install_engine_package,
            engine_packages::remove_engine_package,
            commands::setup_estimate,
            commands::cancel_setup,
            commands::cuda_status,
            commands::install_cuda_runtime,
            commands::import_library,
            commands::preview_import,
            commands::preview_library_move,
            commands::list_songs,
            commands::list_song_page,
            commands::get_song,
            commands::read_song_audio,
            commands::generate,
            commands::patch_song,
            commands::cancel_song,
            commands::delete_song,
            commands::retry_song,
            commands::list_folders,
            commands::save_folder,
            commands::delete_folder,
            commands::queue,
            commands::work_queue,
            commands::completed_work,
            commands::cancel_download,
            commands::get_settings,
            menu::configure_app_menu,
            mcp::settings::get_mcp_settings,
            mcp::settings::get_mcp_http_connection,
            mcp::settings::save_mcp_settings,
            commands::open_songs_folder,
            commands::save_settings,
            commands::export_default_path,
            commands::get_generation_form_preferences,
            commands::generation_policy,
            commands::save_generation_form_preferences,
            commands::health,
            commands::export_file,
            commands::check_update,
            commands::exit_app,
            commands::remember_folder,
            paths::dialog_directory,
            phone_access::phone_access_status,
            phone_access::set_phone_access,
            audio_import::pick_and_analyze_audio,
            reference_audio::pick_reference_audio,
            model_commands::model_catalog,
            model_commands::hugging_face_token_status,
            model_commands::set_hugging_face_token,
            model_commands::discover_hugging_face_models,
            model_commands::adopt_hugging_face_model,
            model_commands::use_models,
            model_commands::verify_imported_models,
            model_commands::select_models,
            model_commands::remove_model,
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
            mcp::transport::stop(app);
            if let Some(state) = app.try_state::<Arc<state::AppState>>() {
                state.begin_shutdown();
                state.stop_engine();
            }
            #[cfg(target_os = "macos")]
            sandbox::shutdown();
        }
    });
}

fn resource_directory<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<std::path::PathBuf> {
    if cfg!(debug_assertions) {
        if let Some(path) = std::env::var_os("MUSIC_GENERATOR_DEV_RESOURCES_DIR") {
            return Ok(path.into());
        }
        #[cfg(target_os = "macos")]
        if launch_location::inside_app_bundle() {
            return app.path().resource_dir();
        }
        return Ok(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
    }
    app.path().resource_dir()
}
