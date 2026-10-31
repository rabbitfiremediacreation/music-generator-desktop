use crate::export_fixture::{temporary_directories, Fixture};
use fs2::FileExt;
use music_generator::{audio_export::mp3, error::Error};
use std::{
    fs::File,
    future::Future,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub fn run(case: impl Future<Output = ()>) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(case);
}

pub fn supervised_success_removes_temporary_files_and_preserves_audio() {
    run(async {
        let fixture = Fixture::new("success");
        let original = std::fs::read(&fixture.source).unwrap();
        let target = mp3(
            &fixture.resources,
            fixture.root.path(),
            "success-song",
            &fixture.source,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(target).unwrap(), vec![b'M'; 2048]);
        assert_eq!(std::fs::read(&fixture.source).unwrap(), original);
        assert!(temporary_directories(fixture.root.path()).is_empty());
    });
}

pub fn codec_failure_removes_incomplete_files_and_preserves_audio() {
    run(async {
        let fixture = Fixture::new("fail");
        let original = std::fs::read(&fixture.source).unwrap();
        let error = mp3(
            &fixture.resources,
            fixture.root.path(),
            "failed-song",
            &fixture.source,
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "mp3_failed");
        assert_eq!(std::fs::read(&fixture.source).unwrap(), original);
        assert!(std::fs::read_dir(fixture.root.path().join("export"))
            .unwrap()
            .next()
            .is_none());
    });
}

pub fn token_cancellation_stops_the_codec_and_removes_temporary_files() {
    run(async {
        let fixture = Fixture::new("block");
        let original = std::fs::read(&fixture.source).unwrap();
        let cancel = CancellationToken::new();
        let mut conversion = Box::pin(mp3(
            &fixture.resources,
            fixture.root.path(),
            "cancelled-song",
            &fixture.source,
            &cancel,
        ));
        tokio::select! {
            _ = wait_started(&fixture) => {},
            result = &mut conversion => panic!("Codec finished before cancellation: {result:?}"),
        }
        cancel.cancel();
        let error = tokio::time::timeout(Duration::from_secs(5), conversion)
            .await
            .unwrap()
            .unwrap_err();
        assert!(matches!(error, Error::Cancelled));
        assert_stopped(&fixture);
        assert!(temporary_directories(fixture.root.path()).is_empty());
        assert_eq!(std::fs::read(&fixture.source).unwrap(), original);
    });
}

pub fn dropping_the_future_stops_the_codec_before_removing_staging() {
    run(async {
        let fixture = Fixture::new("block");
        let original = std::fs::read(&fixture.source).unwrap();
        let cancel = CancellationToken::new();
        let mut conversion = Box::pin(mp3(
            &fixture.resources,
            fixture.root.path(),
            "dropped-song",
            &fixture.source,
            &cancel,
        ));
        tokio::select! {
            _ = wait_started(&fixture) => {},
            result = &mut conversion => panic!("Codec finished before dropping: {result:?}"),
        }
        drop(conversion);
        assert_stopped(&fixture);
        assert!(temporary_directories(fixture.root.path()).is_empty());
        assert_eq!(std::fs::read(&fixture.source).unwrap(), original);
    });
}

pub fn timeout_stops_the_codec_and_removes_temporary_files() {
    run(async {
        let fixture = Fixture::new("block");
        let cancel = CancellationToken::new();
        let mut conversion = Box::pin(mp3(
            &fixture.resources,
            fixture.root.path(),
            "timed-out-song",
            &fixture.source,
            &cancel,
        ));
        tokio::select! {
            _ = wait_started(&fixture) => {},
            result = &mut conversion => panic!("Codec finished before timeout: {result:?}"),
        }
        let started = Instant::now();
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(181)).await;
        assert_eq!(conversion.await.unwrap_err().to_string(), "mp3_failed");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "The virtual timeout must fire before the fixture's natural exit"
        );
        assert_stopped(&fixture);
        assert!(temporary_directories(fixture.root.path()).is_empty());
    });
}

pub async fn wait_started(fixture: &Fixture) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !fixture.root.path().join("original-started").exists() {
        assert!(Instant::now() < deadline, "Fixture codec did not start");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

pub fn assert_stopped(fixture: &Fixture) {
    File::open(fixture.root.path().join("original.lock"))
        .unwrap()
        .try_lock_exclusive()
        .expect("The converter must release its lock before cleanup returns");
}

pub fn independent_conversions_preserve_each_others_files() {
    run(async {
        let fixture = Fixture::new("block");
        let second_source = fixture.add_source("second", "success");
        let original = std::fs::read(&fixture.source).unwrap();
        let second_original = std::fs::read(&second_source).unwrap();
        let cancel = CancellationToken::new();
        let mut first = Box::pin(mp3(
            &fixture.resources,
            fixture.root.path(),
            "blocked-song",
            &fixture.source,
            &cancel,
        ));
        tokio::select! {
            _ = wait_started(&fixture) => {},
            result = &mut first => panic!("First converter finished early: {result:?}"),
        }
        let active = temporary_directories(fixture.root.path());
        assert_eq!(active.len(), 1);
        let cached = mp3(
            &fixture.resources,
            fixture.root.path(),
            "second-song",
            &second_source,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(temporary_directories(fixture.root.path()), active);
        assert!(File::open(fixture.root.path().join("original.lock"))
            .unwrap()
            .try_lock_exclusive()
            .is_err());
        cancel.cancel();
        assert!(matches!(first.await.unwrap_err(), Error::Cancelled));
        assert_stopped(&fixture);
        assert!(temporary_directories(fixture.root.path()).is_empty());
        assert_eq!(std::fs::read(cached).unwrap(), vec![b'M'; 2048]);
        assert_eq!(std::fs::read(&fixture.source).unwrap(), original);
        assert_eq!(std::fs::read(second_source).unwrap(), second_original);
    });
}
