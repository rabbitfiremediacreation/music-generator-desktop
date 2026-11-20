use crate::{
    error::{message, Result},
    state::AppState,
    types::UpdateStream,
};
use objc2::runtime::Bool;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

extern "C" {
    fn music_configure_updates(stable: Bool);
    fn music_check_native_update() -> Bool;
}

pub fn configure<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(state) = handle.try_state::<Arc<AppState>>() {
            if let Ok(settings) = state.db.settings() {
                // The bridge owns Cocoa objects and runs only on the main thread.
                unsafe {
                    music_configure_updates(Bool::new(
                        settings.update_stream == UpdateStream::Stable,
                    ))
                };
            }
        }
    });
}

pub async fn check(app: &AppHandle) -> Result<bool> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(unsafe { music_check_native_update() });
    })
    .map_err(|error| message(error.to_string()))?;
    receive
        .await
        .map(Bool::as_bool)
        .map_err(|error| message(error.to_string()))
}
