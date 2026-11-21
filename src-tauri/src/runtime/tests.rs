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
        operation.report(Progress::new("synth"), 55);
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
    let sequence = first.report(Progress::new("starting"), 0).unwrap().sequence;
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
    assert!(next.report(Progress::new("starting"), 0).unwrap().sequence > sequence);
}

#[test]
fn estimates_remaining_seconds_after_enough_whole_song_progress() {
    assert_eq!(estimate_remaining_seconds(4, 50), None);
    assert_eq!(estimate_remaining_seconds(60, 9), None);
    assert_eq!(estimate_remaining_seconds(60, 40), Some(90));
    assert_eq!(estimate_remaining_seconds(60, 75), Some(20));
    assert_eq!(estimate_remaining_seconds(15, 99), Some(1));
    assert_eq!(estimate_remaining_seconds(60, 100), Some(0));
}

#[test]
fn remaining_time_smooths_jumps_and_counts_down_at_a_steady_rate() {
    let mut sample = None;
    let elapsed = Duration::from_secs;
    assert_eq!(
        smooth_remaining_seconds(&mut sample, elapsed(20), 50),
        Some(20)
    );
    assert_eq!(
        smooth_remaining_seconds(&mut sample, elapsed(30), 75),
        Some(10)
    );
    // Another update in the same instant should not speed up the filter.
    assert_eq!(
        smooth_remaining_seconds(&mut sample, elapsed(30), 95),
        Some(10)
    );
    let adjusted = smooth_remaining_seconds(&mut sample, elapsed(31), 95).unwrap();
    assert!((3..10).contains(&adjusted));
    assert_eq!(
        smooth_remaining_seconds(&mut sample, elapsed(31), 100),
        Some(0)
    );
}

#[test]
fn remaining_time_uses_the_song_clock_instead_of_the_current_phase() {
    let runtime = Arc::new(Runtime::default());
    let operation = runtime.try_begin(OperationKind::Generation).unwrap();
    operation.start_song("song");
    let mut status = runtime.status.lock().unwrap();
    status
        .active
        .as_mut()
        .unwrap()
        .song
        .as_mut()
        .unwrap()
        .started_at -= std::time::Duration::from_secs(30);
    drop(status);

    let update = operation.report(Progress::new("vae"), 50).unwrap();
    assert_eq!(update.progress.elapsed_seconds, 0);
    let remaining = update.estimated_remaining_seconds.unwrap();
    assert!(remaining >= 30);
    assert_eq!(
        runtime.progress().unwrap().estimated_remaining_seconds,
        Some(remaining)
    );
}

#[test]
fn overall_progress_never_decreases_within_a_song_and_starts_fresh_for_the_next_one() {
    let runtime = Arc::new(Runtime::default());
    let first = runtime.try_begin(OperationKind::Generation).unwrap();
    first.start_song("first");
    first.report(Progress::new("synth"), 74).unwrap();
    let late = first.report(Progress::new("loading"), 4).unwrap();
    assert_eq!(late.progress.phase, "loading");
    assert_eq!(late.overall_percent, 74);
    assert_eq!(runtime.progress().unwrap().overall_percent, 74);
    assert_eq!(
        first
            .report(Progress::new("complete"), 100)
            .unwrap()
            .overall_percent,
        100
    );
    drop(first);
    let next = runtime.try_begin(OperationKind::Generation).unwrap();
    next.start_song("next");
    assert_eq!(
        next.report(Progress::new("starting"), 0)
            .unwrap()
            .overall_percent,
        0
    );
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
