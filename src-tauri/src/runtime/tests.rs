use super::*;

#[tokio::test]
async fn operations_exclude_each_other_and_release_on_error() {
    let runtime = Arc::new(Runtime::default());
    runtime.set_configured(true);
    let result = (|| -> Result<()> {
        let operation = runtime.try_begin(OperationKind::Setup)?;
        assert!(runtime.is_busy());
        assert!(runtime.is_ready());
        assert!(runtime.try_begin(OperationKind::Analysis).is_err());
        assert!(runtime.enqueue(|| Ok(())).is_err());
        runtime.cancel_configuration();
        assert!(operation.cancellation().is_cancelled());
        Err(message("self-test failed"))
    })();
    assert!(result.is_err());
    assert!(!runtime.is_busy());
    assert!(runtime.enqueue(|| Ok(())).is_ok());
    assert!(runtime.try_begin(OperationKind::Analysis).is_ok());
}

#[tokio::test]
async fn dropping_an_aborted_task_clears_its_operation_and_progress() {
    let runtime = Arc::new(Runtime::default());
    runtime.set_configured(true);
    let (sent, received) = tokio::sync::oneshot::channel();
    let task_runtime = runtime.clone();
    let task = tokio::spawn(async move {
        let operation = task_runtime.begin(OperationKind::Generation).await.unwrap();
        operation.start_song("song-a");
        operation.report(Progress::new("synth"));
        sent.send(operation.cancellation()).unwrap();
        std::future::pending::<()>().await;
    });
    let cancel = received.await.unwrap();
    assert_eq!(runtime.progress().unwrap().job_id, "song-a");
    assert!(runtime.enqueue(|| Ok(())).is_ok());
    runtime.cancel_song("song-b", || Ok(true)).unwrap();
    assert!(!cancel.is_cancelled());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(cancel.is_cancelled());
    assert!(!runtime.is_busy());
    assert!(runtime.progress().is_none());
    assert!(runtime.is_ready());
}

#[tokio::test]
async fn cancellation_is_scoped_and_does_not_leak_into_the_next_job() {
    let runtime = Arc::new(Runtime::default());
    let first = runtime.try_begin(OperationKind::Generation).unwrap();
    first.start_song("first");
    let sequence = first.report(Progress::new("starting")).unwrap().sequence;
    runtime.cancel_configuration();
    assert!(!first.cancellation().is_cancelled());
    assert!(!runtime.cancel_song("first", || Ok(false)).unwrap());
    assert!(!first.cancellation().is_cancelled());
    assert!(runtime.cancel_song("first", || Ok(true)).unwrap());
    assert!(first.cancellation().is_cancelled());
    drop(first);
    let next = runtime.try_begin(OperationKind::Generation).unwrap();
    next.start_song("next");
    runtime.cancel_song("first", || Ok(true)).unwrap();
    assert!(!next.cancellation().is_cancelled());
    assert!(next.report(Progress::new("starting")).unwrap().sequence > sequence);
}

#[tokio::test]
async fn shutdown_cancels_active_work_and_rejects_new_and_waiting_operations() {
    let runtime = Arc::new(Runtime::default());
    runtime.set_configured(true);
    let active = runtime.try_begin(OperationKind::Models).unwrap();
    let child = runtime.cancellation();
    runtime.shutdown();
    assert!(active.cancellation().is_cancelled());
    assert!(child.is_cancelled());
    assert!(!runtime.is_ready());
    assert!(runtime.enqueue(|| Ok(())).is_err());
    assert!(matches!(
        runtime.begin(OperationKind::Analysis).await,
        Err(Error::Cancelled)
    ));
    drop(active);
    assert!(matches!(
        runtime.try_begin(OperationKind::Settings),
        Err(Error::Cancelled)
    ));
    runtime.wait().await;
}

#[tokio::test]
async fn blocking_work_keeps_exclusive_admission_after_its_caller_is_aborted() {
    let runtime = Arc::new(Runtime::default());
    let operation = runtime.try_begin(OperationKind::Settings).unwrap();
    let (started, waiting) = tokio::sync::oneshot::channel();
    let (release, blocked) = std::sync::mpsc::channel();
    let (done, finished) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            blocked.recv().unwrap();
            drop(operation);
            done.send(()).unwrap();
        })
        .await
        .unwrap();
    });
    waiting.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(runtime.try_begin(OperationKind::Setup).is_err());
    release.send(()).unwrap();
    finished.await.unwrap();
    assert!(runtime.try_begin(OperationKind::Setup).is_ok());
}
