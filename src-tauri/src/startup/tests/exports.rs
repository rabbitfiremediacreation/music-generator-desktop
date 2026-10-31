use super::*;

#[tokio::test]
async fn startup_cleans_stale_exports_before_publishing_state_and_never_sweeps_active_state() {
    let (temporary, app) = fixture(true);
    let exports = temporary.path().join("data/export");
    let stale = exports.join("temporary-0123456789ab4def8123456789abcdef");
    std::fs::create_dir_all(&stale).unwrap();
    std::fs::write(stale.join("source.wav"), b"unfinished source").unwrap();
    std::fs::write(stale.join("encoded.mp3"), b"unfinished conversion").unwrap();

    let cache = exports.join(format!("{}-4096-123456789-192.mp3", "a".repeat(64)));
    let finished = exports.join("finished.zip");
    let temporary_file = exports.join("temporary-22222222222242228222222222222222");
    for path in [&cache, &finished, &temporary_file] {
        std::fs::write(path, b"keep completed file").unwrap();
    }
    let unrelated = [
        "temporary-user-files",
        "temporary-0123456789ab1def8123456789abcdef",
        "temporary-ABCDEF0123454DEF8123456789ABCDEF",
        "temporary-01234567-89ab-4def-8123-456789abcdef",
    ]
    .map(|name| exports.join(name));
    for path in &unrelated {
        std::fs::create_dir(path).unwrap();
        std::fs::write(path.join("keep.txt"), b"unrelated directory").unwrap();
    }
    let outside = temporary.path().join("external-export");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("keep.wav"), b"external source").unwrap();
    let link = exports.join("temporary-fedcba98765443218abcdef012345678");
    std::os::unix::fs::symlink(&outside, &link).unwrap();

    assert!(app.try_state::<Arc<AppState>>().is_none());
    let splash = app.get_webview_window("splash").unwrap();
    splash_ready(splash.clone(), app.state(), 1).await.unwrap();
    let state = app
        .state::<Startup>()
        .prepare(app.handle(), 1)
        .await
        .unwrap();

    assert!(app.try_state::<Arc<AppState>>().is_some());
    assert!(!stale.exists());
    for path in [&cache, &finished, &temporary_file] {
        assert_eq!(std::fs::read(path).unwrap(), b"keep completed file");
    }
    for path in &unrelated {
        assert_eq!(
            std::fs::read(path.join("keep.txt")).unwrap(),
            b"unrelated directory"
        );
    }
    assert!(std::fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read(outside.join("keep.wav")).unwrap(),
        b"external source"
    );

    let active = exports.join("temporary-1234567890ab4def8123456789abcdef");
    std::fs::create_dir(&active).unwrap();
    std::fs::write(active.join("source.wav"), b"active conversion").unwrap();
    let reused = app
        .state::<Startup>()
        .prepare(app.handle(), 1)
        .await
        .unwrap();
    assert!(Arc::ptr_eq(&state, &reused));
    assert_eq!(
        std::fs::read(active.join("source.wav")).unwrap(),
        b"active conversion"
    );

    startup_error(
        app.get_webview_window("main").unwrap(),
        app.state(),
        app.handle().clone(),
        "retry fixture".into(),
        1,
    )
    .await
    .unwrap();
    retry_startup(splash.clone(), app.state(), app.handle().clone(), 1)
        .await
        .unwrap();
    splash_ready(splash, app.state(), 2).await.unwrap();
    let retried = app
        .state::<Startup>()
        .prepare(app.handle(), 2)
        .await
        .unwrap();
    assert!(Arc::ptr_eq(&state, &retried));
    assert_eq!(
        std::fs::read(active.join("source.wav")).unwrap(),
        b"active conversion"
    );
    state.begin_shutdown();
}

#[tokio::test]
async fn startup_preserves_temporary_files_beyond_a_symlinked_export_directory() {
    let (temporary, app) = fixture(true);
    let data = temporary.path().join("data");
    std::fs::create_dir(&data).unwrap();
    let outside = temporary.path().join("external-exports");
    let external_work = outside.join("temporary-0123456789ab4def8123456789abcdef");
    std::fs::create_dir_all(&external_work).unwrap();
    std::fs::write(external_work.join("source.wav"), b"external conversion").unwrap();
    let exports = data.join("export");
    std::os::unix::fs::symlink(&outside, &exports).unwrap();
    splash_ready(app.get_webview_window("splash").unwrap(), app.state(), 1)
        .await
        .unwrap();

    let state = app
        .state::<Startup>()
        .prepare(app.handle(), 1)
        .await
        .unwrap();

    assert!(app.try_state::<Arc<AppState>>().is_some());
    assert!(std::fs::symlink_metadata(exports)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 1);
    assert_eq!(std::fs::read_dir(&external_work).unwrap().count(), 1);
    assert_eq!(
        std::fs::read(external_work.join("source.wav")).unwrap(),
        b"external conversion"
    );
    state.begin_shutdown();
}
