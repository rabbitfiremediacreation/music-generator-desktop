use crate::{
    error::{message, Result},
    state::AppState,
    types::UpdateStream,
};
use objc2::runtime::Bool;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

extern "C" {
    fn music_configure_updates(enabled: Bool);
    fn music_check_native_update() -> Bool;
}

pub(crate) fn bundled_stream() -> UpdateStream {
    stream_for_build(option_env!("MUSIC_GENERATOR_UPDATE_BUILD"))
}

fn stream_for_build(build: Option<&str>) -> UpdateStream {
    match build.and_then(super::build_number) {
        Some(("daily", 1..)) => UpdateStream::Daily,
        Some(("develop", 1..)) => UpdateStream::Develop,
        _ => UpdateStream::Stable,
    }
}

pub fn configure<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(state) = handle.try_state::<Arc<AppState>>() {
            if let Ok(settings) = state.db.settings() {
                // The bridge owns Cocoa objects and runs only on the main thread.
                unsafe {
                    music_configure_updates(Bool::new(settings.update_stream == bundled_stream()))
                };
            }
        }
    });
}

pub async fn check(app: &AppHandle, requested: UpdateStream) -> Result<bool> {
    if requested != bundled_stream() {
        return Ok(false);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_the_channel_of_the_bundled_sparkle_feed() {
        assert_eq!(stream_for_build(Some("daily-101")), UpdateStream::Daily);
        assert_eq!(stream_for_build(Some("develop-100")), UpdateStream::Develop);
        for build in [None, Some("daily-0"), Some("test-101"), Some("daily-next")] {
            assert_eq!(stream_for_build(build), UpdateStream::Stable);
        }
    }
}
