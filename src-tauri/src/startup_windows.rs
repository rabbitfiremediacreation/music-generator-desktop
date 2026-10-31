use crate::startup::Startup;
use std::{path::PathBuf, time::Instant};
use tauri::{App, Manager, Runtime, WebviewWindowBuilder};

/// Register startup state before any frontend can invoke its commands.
pub fn initialize<R: Runtime>(
    app: &App<R>,
    root: PathBuf,
    resources: PathBuf,
    started: Instant,
) -> tauri::Result<()> {
    app.manage(Startup::new(root, resources, started));
    for config in &app.config().app.windows {
        WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

    #[test]
    fn every_window_can_read_startup_status_as_soon_as_it_is_created() {
        assert_managed_window_creation(include_str!("../tauri.conf.json"));
    }

    #[test]
    fn macos_window_overrides_preserve_managed_startup() {
        assert_managed_window_creation(include_str!("../tauri.macos.conf.json"));
    }

    #[allow(deprecated)]
    fn assert_managed_window_creation(config: &str) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().to_path_buf();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let windows = observed.clone();
        let mut context = mock_context(noop_assets());
        let source: serde_json::Value = serde_json::from_str(config).unwrap();
        context.config_mut().app.windows =
            serde_json::from_value(source["app"]["windows"].clone()).unwrap();
        let mut app = mock_builder()
            .plugin(
                tauri::plugin::Builder::<MockRuntime>::new("startup-order")
                    .on_webview_ready(move |webview| {
                        let status = webview
                            .try_state::<Startup>()
                            .map(|startup| serde_json::to_value(startup.snapshot()).unwrap());
                        windows
                            .lock()
                            .unwrap()
                            .push((webview.label().to_owned(), status));
                    })
                    .build(),
            )
            .setup(move |app| {
                initialize(app, root.clone(), root, Instant::now())?;
                Ok(())
            })
            .build(context)
            .unwrap();
        app.run_iteration(|_, _| {});
        let observed = observed.lock().unwrap();
        assert_eq!(observed.len(), 2);
        for (label, status) in observed.iter() {
            assert!(
                status.is_some(),
                "{label} started without managed Startup state"
            );
            assert_eq!(status.as_ref().unwrap()["phase"], "starting");
        }
    }
}
