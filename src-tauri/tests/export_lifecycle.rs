#[path = "support/export_cases.rs"]
mod export_cases;
#[path = "support/export_destinations.rs"]
mod export_destinations;
#[path = "support/export_fixture.rs"]
mod export_fixture;
#[cfg(windows)]
#[path = "support/export_windows.rs"]
mod export_windows;

use export_fixture::{temporary_directories, Fixture};
use std::{sync::mpsc, time::Duration};
use tokio_util::sync::CancellationToken;

fn main() {
    if let Some(code) = music_generator::engine::process::supervise() {
        std::process::exit(code);
    }
    if let Some(code) = export_fixture::codec() {
        std::process::exit(code);
    }
    let filter = test_filter();
    let tests = [
        (
            "queued_copy_keeps_staging_until_the_copy_finishes",
            queued_copy_keeps_staging_until_the_copy_finishes as fn(),
        ),
        (
            "supervised_success_removes_temporary_files_and_preserves_audio",
            export_cases::supervised_success_removes_temporary_files_and_preserves_audio,
        ),
        (
            "codec_failure_removes_incomplete_files_and_preserves_audio",
            export_cases::codec_failure_removes_incomplete_files_and_preserves_audio,
        ),
        (
            "token_cancellation_stops_the_codec_and_removes_temporary_files",
            export_cases::token_cancellation_stops_the_codec_and_removes_temporary_files,
        ),
        (
            "dropping_the_future_stops_the_codec_before_removing_staging",
            export_cases::dropping_the_future_stops_the_codec_before_removing_staging,
        ),
        (
            "timeout_stops_the_codec_and_removes_temporary_files",
            export_cases::timeout_stops_the_codec_and_removes_temporary_files,
        ),
        (
            "independent_conversions_preserve_each_others_files",
            export_cases::independent_conversions_preserve_each_others_files,
        ),
        (
            "audio_and_zip_exports_preserve_destinations_originals_and_cache",
            export_destinations::audio_and_zip_exports_preserve_destinations_originals_and_cache,
        ),
        (
            "conversion_failure_preserves_existing_audio_and_zip_exports",
            export_destinations::conversion_failure_preserves_existing_audio_and_zip_exports,
        ),
        #[cfg(windows)]
        (
            "transient_file_lock_does_not_leave_temporary_files_after_cancellation",
            export_windows::transient_file_lock_does_not_leave_temporary_files_after_cancellation,
        ),
    ];
    let mut failed = 0;
    for (name, test) in tests {
        if filter.as_ref().is_some_and(|filter| !name.contains(filter)) {
            continue;
        }
        print!("test {name} ... ");
        if std::panic::catch_unwind(test).is_ok() {
            println!("ok");
        } else {
            println!("FAILED");
            failed += 1;
        }
    }
    assert_eq!(failed, 0, "Export lifecycle tests failed");
}

fn test_filter() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        if matches!(argument.as_str(), "--test-threads" | "--format") {
            args.next();
        } else if !argument.starts_with('-') {
            return Some(argument);
        }
    }
    None
}

fn queued_copy_keeps_staging_until_the_copy_finishes() {
    let fixture = Fixture::new("success");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let mut blocker = BlockingGate::new(&runtime);
        let cancel = CancellationToken::new();
        let mut conversion = Box::pin(music_generator::audio_export::mp3(
            &fixture.resources,
            fixture.root.path(),
            "queued-song",
            &fixture.source,
            &cancel,
        ));
        assert!(futures_util::poll!(conversion.as_mut()).is_pending());
        let directories = temporary_directories(fixture.root.path());
        assert_eq!(directories.len(), 1);
        let staging = &directories[0];
        drop(conversion);
        assert!(
            staging.is_dir(),
            "Dropping the export must leave the queued copy's staging alive"
        );
        blocker.release();
        tokio::task::spawn_blocking(|| {}).await.unwrap();
        assert!(
            !staging.exists(),
            "The detached copy must remove staging when it finishes"
        );
    });
}

struct BlockingGate(Option<mpsc::Sender<()>>);

impl BlockingGate {
    /// Occupy the only blocking worker until release, unwinding, or a deadline.
    fn new(runtime: &tokio::runtime::Runtime) -> Self {
        let (started, ready) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        runtime.spawn_blocking(move || {
            started.send(()).unwrap();
            let _ = wait.recv_timeout(Duration::from_secs(10));
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        Self(Some(release))
    }

    fn release(&mut self) {
        if let Some(release) = self.0.take() {
            let _ = release.send(());
        }
    }
}

impl Drop for BlockingGate {
    fn drop(&mut self) {
        self.release();
    }
}
