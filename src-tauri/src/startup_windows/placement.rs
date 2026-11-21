use serde::Deserialize;
use tauri::{Manager, Runtime, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

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

/// Restore while the main HWND is hidden, on the setup thread. The plugin
/// still saves physical client dimensions and outer screen coordinates.
pub(super) fn restore<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let app = window.app_handle();
    let saved = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read(dir.join(tauri_plugin_window_state::DEFAULT_FILENAME)).ok())
        .and_then(|bytes| {
            serde_json::from_slice::<std::collections::HashMap<String, SavedWindow>>(&bytes).ok()
        })
        .and_then(|mut states| states.remove("main"));
    let Some(saved) = saved else { return Ok(()) };
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
        let hwnd = window.hwnd()?;
        let flags = SWP_NOZORDER | SWP_NOACTIVATE;
        // Move first so Windows applies the destination monitor's DPI before
        // measuring the non-client frame.
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                area.position.x,
                area.position.y,
                0,
                0,
                flags | SWP_NOSIZE | SWP_FRAMECHANGED,
            )?;
        }
        let inner = window.inner_size()?;
        let outer = window.outer_size()?;
        let (left, width) = fit_axis(
            x,
            saved.width,
            inner.width,
            outer.width,
            area.position.x,
            area.size.width,
        );
        let (top, height) = fit_axis(
            y,
            saved.height,
            inner.height,
            outer.height,
            area.position.y,
            area.size.height,
        );
        unsafe {
            SetWindowPos(hwnd, None, left, top, width, height, flags)?;
        }
    }
    if saved.maximized {
        window.maximize()?;
    }
    if saved.fullscreen {
        window.set_fullscreen(true)?;
    }
    Ok(())
}

// All coordinates and lengths here are physical pixels.
fn fit_axis(
    position: i32,
    saved_client: u32,
    client: u32,
    outer: u32,
    origin: i32,
    extent: u32,
) -> (i32, i32) {
    let requested = if saved_client == 0 {
        client
    } else {
        saved_client
    };
    let size = requested
        .saturating_add(outer.saturating_sub(client))
        .min(extent);
    let last = i64::from(origin) + i64::from(extent - size);
    (
        i64::from(position).clamp(i64::from(origin), last) as i32,
        size as i32,
    )
}
