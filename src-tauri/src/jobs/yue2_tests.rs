use super::worker;
use crate::{
    admission, catalog,
    db::Database,
    state::AppState,
    types::{GenerateRequest, Settings, Song},
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

async fn wait_for_song(state: &AppState, id: &str, mut ready: impl FnMut(&Song) -> bool) -> Song {
    tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let song = state.db.song(id).unwrap();
            assert_ne!(song.status, "error", "{:?}", song.message);
            if ready(&song) {
                return song;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("YuE2 song did not reach the expected state")
}

fn yue2_profile(catalog: &catalog::Catalog) -> &catalog::ProviderProfile {
    catalog
        .profiles
        .iter()
        .find(|profile| profile.selection.provider == "yue2")
        .unwrap()
}

#[tokio::test]
#[ignore = "requires the packaged Apple Silicon runtime and both verified YuE2 GGUF files"]
async fn yue2_offline_queue_saves_measured_wav_and_cancels_a_running_song() {
    let models = std::env::var("MUSIC_YUE2_QA_MODELS").expect("YuE2 model folder");
    let resources = std::env::var_os("MUSIC_YUE2_QA_RESOURCES")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let songs = data.path().join("songs");
    db.save_settings(&Settings {
        models_dir: models,
        songs_dir: songs.to_str().unwrap().into(),
        setup_complete: true,
        ..Default::default()
    })
    .unwrap();
    let catalog = catalog::catalog();
    let profile = yue2_profile(&catalog);
    catalog::install_profile(
        &catalog,
        &db,
        &profile.selection,
        &CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    let app = tauri::test::mock_app();
    let state = Arc::new(AppState::new(db, resources));
    assert!(state.restore_setup().unwrap());
    let work = tokio::spawn(worker(state.clone(), app.handle().clone()));

    let request = GenerateRequest {
        style: "English, acoustic pop, bright piano, soft drums, lead vocal".into(),
        lyrics: "[Verse]\nMorning light falls on the shore\nI hear the waves and sing once more"
            .into(),
        instrumental: false,
        seed: 128,
        duration: 10.0,
        ..Default::default()
    };
    let first = admission::generate(&state, request.clone())
        .unwrap()
        .remove(0);
    let song = wait_for_song(&state, &first, |song| song.status == "done").await;
    let meta = song.result_meta.unwrap();
    let audio = std::fs::read(song.path.unwrap()).unwrap();
    let duration = crate::audio_facts::duration(&audio).unwrap();
    assert_eq!(song.engine.as_deref(), Some("yue2"));
    assert_eq!(
        song.params["generation_profile"]["runtime_revision"],
        profile.runtime.revision
    );
    assert_eq!(meta["duration"], duration);
    assert_eq!(meta["channels"], 2);
    assert_eq!(meta["sample_rate"], 48_000);
    assert!(duration > 0.0 && duration <= 10.0);
    assert!(song.title.as_deref().is_some_and(|title| !title.is_empty()));
    println!(
        "YuE2 WAV {duration:.2}s, runtime {}s",
        meta["runtime_seconds"]
    );

    let second = admission::generate(
        &state,
        GenerateRequest {
            duration: 60.0,
            ..request
        },
    )
    .unwrap()
    .remove(0);
    wait_for_song(&state, &second, |song| {
        song.status == "running"
            && state.runtime.progress().is_some_and(|progress| {
                progress.job_id == second && progress.progress.elapsed_seconds >= 1
            })
    })
    .await;
    assert!(state
        .runtime
        .cancel_song(&second, || state.db.cancel_song(&second))
        .unwrap());
    wait_for_song(&state, &second, |song| song.status == "cancelled").await;
    tokio::time::timeout(Duration::from_secs(10), async {
        while state.runtime.progress().is_some() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("YuE2 runtime still active after cancellation");
    assert_eq!(std::fs::read_dir(songs).unwrap().count(), 1);
    state.begin_shutdown();
    work.await.unwrap();
}

#[tokio::test]
#[ignore = "requires network access and both YuE2 GGUF files as a resume fixture"]
async fn yue2_resumes_the_pinned_vae_from_hugging_face() {
    let fixtures = PathBuf::from(std::env::var("MUSIC_YUE2_QA_MODELS").expect("YuE2 model folder"));
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let models = data.path().join("models");
    std::fs::create_dir_all(models.join("yue2")).unwrap();
    db.save_settings(&Settings {
        models_dir: models.to_str().unwrap().into(),
        ..Default::default()
    })
    .unwrap();
    let catalog = catalog::catalog();
    let profile = yue2_profile(&catalog);
    let assets = catalog.required(&profile.selection).unwrap();
    let weight = &assets
        .iter()
        .find(|asset| asset.role == "weights")
        .unwrap()
        .file;
    let vae = assets.iter().find(|asset| asset.role == "codec").unwrap();
    std::fs::hard_link(fixtures.join(weight), models.join(weight)).unwrap();
    let partial = models.join(format!("{}.part", vae.file));
    std::fs::copy(fixtures.join(&vae.file), &partial).unwrap();
    let offset = vae.estimated_bytes - 65_536;
    std::fs::OpenOptions::new()
        .write(true)
        .open(&partial)
        .unwrap()
        .set_len(offset)
        .unwrap();
    let restarted = AtomicBool::new(false);
    catalog::install_profile(
        &catalog,
        &db,
        &profile.selection,
        &CancellationToken::new(),
        |progress| {
            if progress.phase == "downloading" && progress.downloaded < offset {
                restarted.store(true, Ordering::Relaxed);
            }
        },
    )
    .await
    .unwrap();
    assert!(!restarted.load(Ordering::Relaxed));
    assert!(!partial.exists());
    assert!(catalog::cached(
        &profile.selection,
        &models,
        &crate::verification::ModelVerifier::open(&db.root)
    )
    .unwrap());
}
