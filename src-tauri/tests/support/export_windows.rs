use crate::{
    export_cases::{assert_stopped, run, wait_started},
    export_fixture::{temporary_directories, Fixture},
};
use fs2::FileExt;
use music_generator::{audio_export::mp3, error::Error};
use std::{
    fs::{File, OpenOptions},
    os::windows::fs::OpenOptionsExt,
    sync::mpsc,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub fn transient_file_lock_does_not_leave_temporary_files_after_cancellation() {
    run(async {
        let fixture = Fixture::new("block");
        let cancel = CancellationToken::new();
        let mut conversion = Box::pin(mp3(
            &fixture.resources,
            fixture.root.path(),
            "scanner-locked-song",
            &fixture.source,
            &cancel,
        ));
        tokio::select! {
            _ = wait_started(&fixture) => {},
            result = &mut conversion => panic!("Codec finished before scanner lock: {result:?}"),
        }
        let directories = temporary_directories(fixture.root.path());
        assert_eq!(directories.len(), 1);
        let scanner = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .share_mode(0)
            .open(directories[0].join("scanner.lock"))
            .unwrap();
        let (cancelled, release) = mpsc::channel();
        let codec_lock = fixture.root.path().join("original.lock");
        let scanner = std::thread::spawn(move || {
            let _ = release.recv_timeout(Duration::from_secs(5));
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let lock = File::open(&codec_lock).unwrap();
                if lock.try_lock_exclusive().is_ok() {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "Converter did not release its lock"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            std::thread::sleep(Duration::from_millis(150));
            drop(scanner);
        });
        cancel.cancel();
        cancelled.send(()).unwrap();
        let result = conversion.await;
        scanner.join().unwrap();
        assert!(matches!(result.unwrap_err(), Error::Cancelled));
        assert_stopped(&fixture);
        assert!(temporary_directories(fixture.root.path()).is_empty());
    });
}
