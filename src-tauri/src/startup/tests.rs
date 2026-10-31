use super::*;
use tauri::{
    test::{mock_app, MockRuntime},
    WebviewWindowBuilder,
};

mod exports;

fn fixture(allowed: bool) -> (tempfile::TempDir, tauri::App<MockRuntime>) {
    let temporary = tempfile::tempdir().unwrap();
    let app = mock_app();
    let startup = Startup::new(
        temporary.path().join("data"),
        temporary.path().into(),
        Instant::now(),
    );
    startup.launch_allowed.set(allowed).unwrap();
    app.manage(startup);
    for label in ["main", "splash"] {
        WebviewWindowBuilder::new(&app, label, Default::default())
            .visible(label == "splash")
            .build()
            .unwrap();
    }
    (temporary, app)
}

#[tokio::test]
async fn early_frontend_failure_is_logged_before_the_splash_has_painted() {
    let (temporary, app) = fixture(true);
    startup_error(
        app.get_webview_window("main").unwrap(),
        app.state(),
        app.handle().clone(),
        "early startup failure".into(),
        1,
    )
    .await
    .unwrap();
    let log = std::fs::read_to_string(temporary.path().join("data/logs/desktop.log"))
        .expect("early startup errors must create the desktop log");
    assert!(log.contains("early startup failure"));
}

#[test]
fn snapshot_identifies_the_first_startup_attempt() {
    let (_temporary, app) = fixture(true);
    let status = serde_json::to_value(startup_status(app.state())).unwrap();
    assert_eq!(status["attempt"], 1);
}

#[tokio::test(start_paused = true)]
async fn splash_timeout_retries_once_then_reports_a_logged_recoverable_failure() {
    let (temporary, app) = fixture(true);
    let started = tokio::time::Instant::now();
    let startup = app.state::<Startup>();
    let error = startup.prepare(app.handle(), 1).await.err().unwrap();
    assert_eq!(error.to_string(), "startup_splash_timeout");
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(30));
    let status = startup_status(app.state());
    assert_eq!(status.phase, "error");
    assert_eq!(status.error.as_deref(), Some("startup_splash_timeout"));
    assert!(app.try_state::<Arc<AppState>>().is_none());
    let log = std::fs::read_to_string(temporary.path().join("data/logs/desktop.log")).unwrap();
    assert!(log.contains("startup_splash_timeout"));
    assert_eq!(log.matches("Automatic splash retry").count(), 1);
}

#[tokio::test(start_paused = true)]
async fn missing_main_frame_reports_a_failure_and_rejects_a_late_completion() {
    let (_temporary, app) = fixture(true);
    let main = app.get_webview_window("main").unwrap();
    startup_show_main(main.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    tokio::time::advance(std::time::Duration::from_secs(15)).await;
    tokio::task::yield_now().await;
    let status = startup_status(app.state());
    assert_eq!(status.error.as_deref(), Some("startup_main_timeout"));
    assert!(startup_complete(main, app.state(), app.handle().clone(), 1)
        .await
        .is_err());
    assert!(app.get_webview_window("splash").is_some());
}

#[tokio::test(start_paused = true)]
async fn completion_after_its_deadline_cannot_win_against_the_pending_timeout_task() {
    let (_temporary, app) = fixture(true);
    let main = app.get_webview_window("main").unwrap();
    startup_show_main(main.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    tokio::time::advance(std::time::Duration::from_secs(15)).await;
    assert!(startup_complete(main, app.state(), app.handle().clone(), 1)
        .await
        .is_err());
    assert_eq!(
        startup_status(app.state()).error.as_deref(),
        Some("startup_main_timeout")
    );
}

#[tokio::test(start_paused = true)]
async fn manual_retry_runs_once_and_ignores_the_previous_attempts_messages_and_timer() {
    let (temporary, app) = fixture(true);
    let main = app.get_webview_window("main").unwrap();
    let splash = app.get_webview_window("splash").unwrap();
    splash_ready(splash.clone(), app.state(), 1).await.unwrap();
    startup_show_main(main.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    tokio::time::advance(std::time::Duration::from_secs(10)).await;
    startup_error(
        main.clone(),
        app.state(),
        app.handle().clone(),
        "first failure".into(),
        1,
    )
    .await
    .unwrap();
    let (first, duplicate) = tokio::join!(
        retry_startup(splash.clone(), app.state(), app.handle().clone(), 1),
        retry_startup(splash.clone(), app.state(), app.handle().clone(), 1),
    );
    assert!(first.is_ok());
    assert_eq!(
        duplicate.unwrap_err().to_string(),
        "startup_attempt_expired"
    );
    assert_eq!(startup_status(app.state()).attempt, 2);
    assert!(splash_ready(splash, app.state(), 1).await.is_err());
    startup_error(
        main.clone(),
        app.state(),
        app.handle().clone(),
        "stale error".into(),
        1,
    )
    .await
    .unwrap();
    assert!(
        startup_complete(main.clone(), app.state(), app.handle().clone(), 1)
            .await
            .is_err()
    );
    startup_show_main(main.clone(), app.state(), app.handle().clone(), 2)
        .await
        .unwrap();
    tokio::time::advance(std::time::Duration::from_secs(5)).await;
    tokio::task::yield_now().await;
    assert!(startup_status(app.state()).error.is_none());
    startup_complete(main, app.state(), app.handle().clone(), 2)
        .await
        .unwrap();
    assert_eq!(startup_status(app.state()).phase, "ready");
    assert!(!app.state::<Startup>().should_exit_on_splash_close());
    let log = std::fs::read_to_string(temporary.path().join("data/logs/desktop.log")).unwrap();
    assert!(!log.contains("stale error"));
}

#[tokio::test(start_paused = true)]
async fn manual_retry_does_not_reset_the_process_wide_automatic_retry_limit() {
    let (temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    assert!(startup.prepare(app.handle(), 1).await.is_err());
    retry_startup(
        app.get_webview_window("splash").unwrap(),
        app.state(),
        app.handle().clone(),
        1,
    )
    .await
    .unwrap();
    let started = tokio::time::Instant::now();
    let error = startup.prepare(app.handle(), 2).await.err().unwrap();
    assert_eq!(error.to_string(), "startup_splash_timeout");
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(15));
    let log = std::fs::read_to_string(temporary.path().join("data/logs/desktop.log")).unwrap();
    assert_eq!(log.matches("Automatic splash retry").count(), 1);
}

#[tokio::test(start_paused = true)]
async fn automatic_splash_recovery_completes_the_original_prepare_after_a_new_paint() {
    let (temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    let preparing = startup.prepare(app.handle(), 1);
    tokio::pin!(preparing);
    tokio::select! {
        result = &mut preparing => panic!("prepare returned before the splash recovered: {}", result.is_ok()),
        _ = tokio::time::sleep(std::time::Duration::from_secs(16)) => {},
    }
    assert!(app.try_state::<Arc<AppState>>().is_none());
    assert!(!temporary.path().join("data/music.db").exists());
    let log = std::fs::read_to_string(temporary.path().join("data/logs/desktop.log")).unwrap();
    assert_eq!(log.matches("Automatic splash retry").count(), 1);
    splash_ready(app.get_webview_window("splash").unwrap(), app.state(), 1)
        .await
        .unwrap();
    let state = preparing.await.unwrap();
    assert_eq!(startup_status(app.state()).attempt, 1);
    assert!(temporary.path().join("data/music.db").exists());
    state.begin_shutdown();
}

#[tokio::test(start_paused = true)]
async fn manual_retry_recovers_a_missing_handshake_with_a_fresh_splash_paint() {
    let (temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    assert!(startup.prepare(app.handle(), 1).await.is_err());
    let splash = app.get_webview_window("splash").unwrap();
    retry_startup(splash.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    assert!(splash_ready(splash.clone(), app.state(), 1).await.is_err());
    let preparing = startup.prepare(app.handle(), 2);
    tokio::pin!(preparing);
    tokio::select! {
        result = &mut preparing => panic!("retry returned before its new splash paint: {}", result.is_ok()),
        _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {},
    }
    assert!(app.try_state::<Arc<AppState>>().is_none());
    assert!(!temporary.path().join("data/music.db").exists());
    splash_ready(splash, app.state(), 2).await.unwrap();
    let state = preparing.await.unwrap();
    let main = app.get_webview_window("main").unwrap();
    startup_show_main(main.clone(), app.state(), app.handle().clone(), 2)
        .await
        .unwrap();
    startup_complete(main, app.state(), app.handle().clone(), 2)
        .await
        .unwrap();
    assert_eq!(startup_status(app.state()).phase, "ready");
    state.begin_shutdown();
}

#[tokio::test]
async fn blocked_prepare_returns_before_opening_data_or_creating_application_state() {
    let (temporary, app) = fixture(false);
    let splash = app.get_webview_window("splash").unwrap();
    splash_ready(splash, app.state(), 1).await.unwrap();
    let result = app.state::<Startup>().prepare(app.handle(), 1).await;
    assert_eq!(result.err().unwrap().to_string(), "Installation required");
    assert!(!temporary.path().join("data").exists());
    assert!(app.try_state::<Arc<AppState>>().is_none());
    assert_eq!(startup_status(app.state()).phase, "installation_required");
}

#[tokio::test]
async fn blocked_retry_cannot_reload_main_or_clear_the_installation_requirement() {
    let (_temporary, app) = fixture(false);
    let main = app.get_webview_window("main").unwrap();
    let splash = app.get_webview_window("splash").unwrap();
    startup_error(
        main.clone(),
        app.state(),
        app.handle().clone(),
        "early failure".into(),
        1,
    )
    .await
    .unwrap();
    let error = retry_startup(splash, app.state(), app.handle().clone(), 1)
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Installation required");
    startup_error(
        main,
        app.state(),
        app.handle().clone(),
        "late failure".into(),
        1,
    )
    .await
    .unwrap();
    let status = startup_status(app.state());
    assert_eq!(status.phase, "installation_required");
    assert!(status.error.is_none());
}

#[tokio::test]
async fn blocked_completion_cannot_reveal_main_or_destroy_the_splash() {
    let (temporary, app) = fixture(false);
    let main = app.get_webview_window("main").unwrap();
    let error = startup_complete(main, app.state(), app.handle().clone(), 1)
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Installation required");
    assert!(app.get_webview_window("splash").is_some());
    assert!(!temporary.path().join("data").exists());
    assert_eq!(startup_status(app.state()).phase, "installation_required");
}

#[tokio::test]
async fn installed_start_can_complete_normally() {
    let (_temporary, app) = fixture(true);
    assert!(startup_allowed(app.state(), app.handle().clone(), 1)
        .await
        .unwrap());
    let main = app.get_webview_window("main").unwrap();
    startup_show_main(main.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    startup_complete(main, app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    assert_eq!(startup_status(app.state()).phase, "ready");
}
