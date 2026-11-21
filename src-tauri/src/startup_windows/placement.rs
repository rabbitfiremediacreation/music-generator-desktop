use serde::Deserialize;
use tauri::{utils::config::WindowConfig, App, Runtime};

#[derive(Deserialize)]
struct SavedWindow {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    prev_x: i32,
    prev_y: i32,
    maximized: bool,
    fullscreen: bool,
}

/// Supply the saved client size to Tao at creation, when it computes the native
/// frame for the target monitor. The plugin continues tracking moves and saves.
pub(super) fn restore_config<R: Runtime>(app: &App<R>, config: &WindowConfig) -> WindowConfig {
    use tauri::Manager;
    let mut config = config.clone();
    if config.label != "main" {
        return config;
    }
    let saved = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read(dir.join(tauri_plugin_window_state::DEFAULT_FILENAME)).ok())
        .and_then(|bytes| {
            serde_json::from_slice::<std::collections::HashMap<String, SavedWindow>>(&bytes).ok()
        })
        .and_then(|mut states| states.remove("main"));
    let Some(saved) = saved else { return config };
    config.maximized = saved.maximized;
    config.fullscreen = saved.fullscreen;
    let (x, y) = if saved.maximized {
        (saved.prev_x, saved.prev_y)
    } else {
        (saved.x, saved.y)
    };
    let monitor = app
        .monitor_from_point(f64::from(x), f64::from(y))
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        (config.x, config.width) = fit(
            x,
            saved.width,
            config.width,
            config.min_width,
            area.position.x,
            area.size.width,
            scale,
        );
        (config.y, config.height) = fit(
            y,
            saved.height,
            config.height,
            config.min_height,
            area.position.y,
            area.size.height,
            scale,
        );
    }
    config
}

fn fit(
    position: i32,
    size: u32,
    default: f64,
    minimum: Option<f64>,
    origin: i32,
    extent: u32,
    scale: f64,
) -> (Option<f64>, f64) {
    let size = if size == 0 {
        default * scale
    } else {
        f64::from(size)
    };
    let size = size
        .max(minimum.unwrap_or_default() * scale)
        .min(f64::from(extent));
    let origin = f64::from(origin);
    let position = f64::from(position).clamp(origin, origin + f64::from(extent) - size);
    (Some(position / scale), size / scale)
}
