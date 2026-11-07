use super::*;

async fn complete_startup(app: &tauri::App<MockRuntime>) -> Arc<AppState> {
    splash_ready(app.get_webview_window("splash").unwrap(), app.state(), 1)
        .await
        .unwrap();
    let state = app
        .state::<Startup>()
        .prepare(app.handle(), 1)
        .await
        .unwrap();
    let main = app.get_webview_window("main").unwrap();
    startup_show_main(main.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    startup_complete(main.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    state
}

#[tokio::test]
async fn frontend_reload_reuses_ready_state_without_restarting_the_native_handshake() {
    let (_temporary, app) = fixture(true);
    let state = complete_startup(&app).await;
    let startup = app.state::<Startup>();
    let main = app.get_webview_window("main").unwrap();
    let completed = startup.snapshot();
    let deadline = *startup.main_deadline.lock().unwrap();
    // The destroyed splash cannot send another handshake to a reloaded document.
    startup.painted.send_replace(0);

    for _ in 0..2 {
        assert!(startup_allowed(app.state(), app.handle().clone(), 1)
            .await
            .unwrap());
        let reused = startup.prepare(app.handle(), 1).await.unwrap();
        assert!(Arc::ptr_eq(&state, &reused));
        startup_show_main(main.clone(), app.state(), app.handle().clone(), 1)
            .await
            .unwrap();
        startup_complete(main.clone(), app.state(), app.handle().clone(), 1)
            .await
            .unwrap();
    }

    assert_eq!(startup.snapshot().phase, "ready");
    assert_eq!(startup.snapshot().sequence, completed.sequence);
    assert_eq!(*startup.main_deadline.lock().unwrap(), deadline);
    assert!(startup.ensure_active(1).is_err());
    assert!(startup_allowed(app.state(), app.handle().clone(), 0)
        .await
        .is_err());
    assert!(startup.prepare(app.handle(), 0).await.is_err());
    assert!(
        startup_show_main(main.clone(), app.state(), app.handle().clone(), 0)
            .await
            .is_err()
    );
    assert!(startup_complete(main, app.state(), app.handle().clone(), 0)
        .await
        .is_err());
    state.begin_shutdown();
}

#[tokio::test]
async fn reloaded_bootstrap_reads_live_settings_without_waiting_for_generation() {
    let (_temporary, app) = fixture(true);
    let state = complete_startup(&app).await;
    let mut settings = state.db.settings().unwrap();
    settings.export_format = "flac".into();
    state.db.save_settings(&settings).unwrap();
    state.runtime.set_configured(true);
    let generation = state
        .runtime
        .begin(crate::runtime::OperationKind::Generation)
        .await
        .unwrap();

    let bootstrap = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        crate::commands::bootstrap(app.state(), app.handle().clone(), 1),
    )
    .await
    .expect("frontend reload waited for the running generation")
    .unwrap();

    assert_eq!(bootstrap["settings"]["export_format"], "flac");
    assert!(state.runtime.is_ready());
    assert!(state.runtime.is_busy());
    assert!(!generation.cancellation().is_cancelled());
    assert_eq!(app.state::<Startup>().snapshot().phase, "ready");
    drop(generation);
    state.begin_shutdown();
}

#[tokio::test]
async fn frontend_reload_cannot_bypass_a_failed_attempt_using_existing_state() {
    let (_temporary, app) = fixture(true);
    splash_ready(app.get_webview_window("splash").unwrap(), app.state(), 1)
        .await
        .unwrap();
    let startup = app.state::<Startup>();
    let state = startup.prepare(app.handle(), 1).await.unwrap();
    startup.report(app.handle(), 1, "error", Some("initial UI failed".into()));

    assert!(startup_allowed(app.state(), app.handle().clone(), 1)
        .await
        .is_err());
    assert!(startup.prepare(app.handle(), 1).await.is_err());
    assert_eq!(
        startup.snapshot().error.as_deref(),
        Some("initial UI failed")
    );
    state.begin_shutdown();
}
