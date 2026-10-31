use super::*;
use crate::startup::tests::fixture;

fn deadline(startup: &Startup) -> tokio::time::Instant {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    *startup.main_deadline.lock().unwrap() = Some(deadline);
    deadline
}

#[tokio::test(start_paused = true)]
async fn a_stalled_native_callback_times_out_without_acknowledging_main() {
    let (temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    let error = startup
        .present_main(app.handle(), 1, deadline(&startup), std::future::pending())
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "startup_main_timeout");
    assert_eq!(startup.main_shown.load(Ordering::Relaxed), 0);
    assert!(app.get_webview_window("splash").is_some());
    assert!(startup_complete(
        app.get_webview_window("main").unwrap(),
        app.state(),
        app.handle().clone(),
        1,
    )
    .await
    .is_err());
    let log = std::fs::read_to_string(temporary.path().join("data/logs/desktop.log")).unwrap();
    assert!(log.contains("startup_main_timeout"));
}

#[tokio::test]
async fn a_controller_error_keeps_startup_recoverable() {
    let (_temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    let error = startup
        .present_main(app.handle(), 1, deadline(&startup), async {
            Err(message("WebView2 presentation failed: test failure"))
        })
        .await
        .unwrap_err();
    assert!(error.to_string().contains("test failure"));
    assert_eq!(startup.snapshot().phase, "error");
    assert_eq!(startup.main_shown.load(Ordering::Relaxed), 0);
    retry_startup(
        app.get_webview_window("splash").unwrap(),
        app.state(),
        app.handle().clone(),
        1,
    )
    .await
    .unwrap();
    assert_eq!(startup.snapshot().attempt, 2);
}

#[tokio::test(start_paused = true)]
async fn native_acknowledgement_precedes_main_readiness() {
    let (_temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    let (send, receive) = tokio::sync::oneshot::channel::<()>();
    let presenting = startup.present_main(app.handle(), 1, deadline(&startup), async {
        receive.await.unwrap();
        Ok(())
    });
    tokio::pin!(presenting);
    tokio::select! {
        _ = &mut presenting => panic!("presentation completed before the UI callback"),
        _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {},
    }
    assert_eq!(startup.main_shown.load(Ordering::Relaxed), 0);
    assert_ne!(startup.snapshot().phase, "ready");
    send.send(()).unwrap();
    presenting.await.unwrap();
    assert_eq!(startup.main_shown.load(Ordering::Relaxed), 1);
    assert_ne!(startup.snapshot().phase, "ready");
    startup_complete(
        app.get_webview_window("main").unwrap(),
        app.state(),
        app.handle().clone(),
        1,
    )
    .await
    .unwrap();
    assert_eq!(startup.snapshot().phase, "ready");
}

#[tokio::test(start_paused = true)]
async fn queued_controller_work_cannot_touch_a_timed_out_or_replacement_attempt() {
    let (_temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    deadline(&startup);
    startup.with_pending_presentation(1, || Ok(())).unwrap();
    tokio::time::advance(std::time::Duration::from_secs(15)).await;
    let error = startup
        .with_pending_presentation::<()>(1, || panic!("late controller call"))
        .unwrap_err();
    assert_eq!(error.to_string(), "startup_main_timeout");
    startup.report(
        app.handle(),
        1,
        "error",
        Some("startup_main_timeout".into()),
    );
    retry_startup(
        app.get_webview_window("splash").unwrap(),
        app.state(),
        app.handle().clone(),
        1,
    )
    .await
    .unwrap();
    deadline(&startup);
    let error = startup
        .with_pending_presentation::<()>(1, || panic!("old callback touched the new attempt"))
        .unwrap_err();
    assert_eq!(error.to_string(), "startup_attempt_expired");
    startup.with_pending_presentation(2, || Ok(())).unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_ready_native_result_cannot_win_after_the_deadline() {
    let (_temporary, app) = fixture(true);
    let startup = app.state::<Startup>();
    let deadline = deadline(&startup);
    tokio::time::advance(std::time::Duration::from_secs(15)).await;
    let error = startup
        .present_main(app.handle(), 1, deadline, async { Ok(()) })
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "startup_main_timeout");
    assert_eq!(startup.main_shown.load(Ordering::Relaxed), 0);
}
