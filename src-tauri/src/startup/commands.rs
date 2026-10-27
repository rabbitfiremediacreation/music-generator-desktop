use super::*;

#[tauri::command]
pub fn startup_status(startup: State<'_, Startup>) -> Status {
    startup.snapshot()
}

#[tauri::command]
pub async fn startup_allowed<R: Runtime>(
    startup: State<'_, Startup>,
    app: AppHandle<R>,
    attempt: u64,
) -> Result<bool> {
    startup.ensure_active(attempt)?;
    if !startup.allowed().await {
        startup.report(&app, attempt, "installation_required", None);
        return Ok(false);
    }
    startup.initialize_logging()?;
    Ok(true)
}

#[tauri::command]
pub async fn splash_ready<R: Runtime>(
    window: WebviewWindow<R>,
    startup: State<'_, Startup>,
    attempt: u64,
) -> Result<()> {
    require_window(&window, "splash")?;
    let _transition = startup.transition.lock().await;
    startup.ensure_active(attempt)?;
    startup.painted_ms.store(
        startup.started.elapsed().as_millis() as u64,
        Ordering::Relaxed,
    );
    startup.painted.send_replace(attempt);
    Ok(())
}

#[tauri::command]
pub async fn startup_error<R: Runtime>(
    window: WebviewWindow<R>,
    startup: State<'_, Startup>,
    app: AppHandle<R>,
    error: String,
    attempt: u64,
) -> Result<()> {
    if window.label() != "main" && window.label() != "splash" {
        return Err(message("Unavailable in this window"));
    }
    let _transition = startup.transition.lock().await;
    if !startup.allowed().await {
        startup.report(&app, attempt, "installation_required", None);
        return Ok(());
    }
    startup.report(&app, attempt, "error", Some(error));
    Ok(())
}

#[tauri::command]
pub async fn retry_startup<R: Runtime>(
    window: WebviewWindow<R>,
    startup: State<'_, Startup>,
    app: AppHandle<R>,
    attempt: u64,
) -> Result<()> {
    require_window(&window, "splash")?;
    let _transition = startup.transition.lock().await;
    startup.require_allowed(&app, attempt).await?;
    if startup.snapshot().attempt != attempt {
        return Err(message("startup_attempt_expired"));
    }
    if startup
        .status
        .lock()
        .expect("startup status poisoned")
        .error
        .is_none()
    {
        return Err(message("startup_running"));
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| message("Main window is unavailable"))?;
    {
        let mut status = startup.status.lock().expect("startup status poisoned");
        status.attempt += 1;
        status.sequence += 1;
        status.phase = "starting";
        status.error = None;
    }
    let attempt = startup.snapshot().attempt;
    startup.painted.send_replace(0);
    startup.main_shown.store(0, Ordering::Relaxed);
    *startup
        .main_deadline
        .lock()
        .expect("startup deadline poisoned") = None;
    let _ = app.emit_to("splash", "startup-status", startup.snapshot());
    if let Err(error) = window.reload() {
        startup.report(&app, attempt, "error", Some(error.to_string()));
        return Err(message(error.to_string()));
    }
    if let Err(error) = main.reload() {
        startup.report(&app, attempt, "error", Some(error.to_string()));
        return Err(message(error.to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn startup_show_main<R: Runtime>(
    window: WebviewWindow<R>,
    startup: State<'_, Startup>,
    app: AppHandle<R>,
    attempt: u64,
) -> Result<()> {
    require_window(&window, "main")?;
    let _transition = startup.transition.lock().await;
    startup.require_allowed(&app, attempt).await?;
    startup.ensure_active(attempt)?;
    if startup.main_shown.load(Ordering::Relaxed) == attempt {
        return Ok(());
    }
    window.show().map_err(|e| message(e.to_string()))?;
    let _ = window.set_focus();
    startup.main_shown.store(attempt, Ordering::Relaxed);
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    *startup
        .main_deadline
        .lock()
        .expect("startup deadline poisoned") = Some(deadline);
    tokio::spawn(async move {
        tokio::time::sleep_until(deadline).await;
        let startup = app.state::<Startup>();
        let _transition = startup.transition.lock().await;
        if startup.ensure_active(attempt).is_ok()
            && startup.main_shown.load(Ordering::Relaxed) == attempt
        {
            startup.report(&app, attempt, "error", Some("startup_main_timeout".into()));
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn startup_complete<R: Runtime>(
    window: WebviewWindow<R>,
    startup: State<'_, Startup>,
    app: AppHandle<R>,
    attempt: u64,
) -> Result<()> {
    require_window(&window, "main")?;
    let _transition = startup.transition.lock().await;
    startup.require_allowed(&app, attempt).await?;
    startup.ensure_active(attempt)?;
    if startup.main_shown.load(Ordering::Relaxed) != attempt {
        return Err(message("startup_main_not_shown"));
    }
    let expired = startup
        .main_deadline
        .lock()
        .expect("startup deadline poisoned")
        .is_some_and(|deadline| tokio::time::Instant::now() >= deadline);
    if expired {
        startup.report(&app, attempt, "error", Some("startup_main_timeout".into()));
        return Err(message("startup_main_timeout"));
    }
    startup.report(&app, attempt, "ready", None);
    if let Some(splash) = app.get_webview_window("splash") {
        splash.destroy().map_err(|e| message(e.to_string()))?;
    }
    Ok(())
}

fn require_window<R: Runtime>(window: &WebviewWindow<R>, label: &str) -> Result<()> {
    if window.label() == label {
        Ok(())
    } else {
        Err(message("Unavailable in this window"))
    }
}
