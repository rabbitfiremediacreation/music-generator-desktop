use super::worker;
use crate::{
    admission, catalog,
    db::Database,
    state::AppState,
    types::{GenerateRequest, Settings, Song, Yue2Options, Yue2Sampling},
};
use std::{
    path::{Path, PathBuf},
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

#[test]
fn accepts_old_vocal_job_pins_after_enabling_instrumentals() {
    let catalog = catalog::catalog();
    let selection = &yue2_profile(&catalog).selection;
    let mut pins = serde_json::to_value(catalog::generation_profile(selection).unwrap()).unwrap();
    pins["capabilities"]["instrumental"] = serde_json::json!(false);
    let mut params = serde_json::json!({ "generation_profile": pins, "instrumental": false });
    assert!(admission::validate_saved_profile(selection, &params).is_ok());
    params["instrumental"] = serde_json::json!(true);
    assert!(admission::validate_saved_profile(selection, &params).is_err());
}

#[test]
fn accepts_jobs_saved_with_the_one_minute_limit() {
    let catalog = catalog::catalog();
    let selection = &yue2_profile(&catalog).selection;
    let mut pins = serde_json::to_value(catalog::generation_profile(selection).unwrap()).unwrap();
    pins["capabilities"]["max_duration"] = serde_json::json!(60);
    for instrumental in [false, true] {
        let mut params = serde_json::json!({
            "generation_profile": pins,
            "instrumental": instrumental,
            "duration": 60.0
        });
        admission::validate_saved_profile(selection, &params).unwrap();
        params["duration"] = serde_json::json!(60.01);
        assert!(admission::validate_saved_profile(selection, &params).is_err());
    }
}

#[test]
fn queues_yue2_variants_in_one_group_with_independent_audio_seeds() {
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let catalog = catalog::catalog();
    let profile = yue2_profile(&catalog);
    let pins = catalog::generation_profile(&profile.selection).unwrap();
    let mut request = GenerateRequest {
        model_selection: Some(profile.selection.clone()),
        style: "lofi, piano".into(),
        instrumental: true,
        duration: 60.0,
        seed: 42,
        variants: 3,
        yue2: Some(Yue2Options {
            steps: Some(16),
            lm_seed: Some(101),
            semantic_sampling: Some(Yue2Sampling {
                top_p: Some(0.8),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    };
    let ids = db.enqueue_with_profile(&request, Some(&pins)).unwrap();
    assert_eq!(ids.len(), 3);
    let group = db.song(&ids[0]).unwrap().group_id;
    for (index, id) in ids.iter().enumerate() {
        let song = db.song(id).unwrap();
        assert_eq!(song.group_id, group);
        assert_eq!(song.seed, 42 + index as i64);
        assert_eq!(song.params["yue2"]["lm_seed"], 101);
        assert_eq!(song.params["yue2"]["steps"], 16);
        assert_eq!(song.params["yue2"]["semantic_sampling"]["top_p"], 0.8);
        admission::validate_saved_profile(&profile.selection, &song.params).unwrap();
    }
    request.yue2.as_mut().unwrap().lm_seed = Some(-1);
    let random = db.enqueue_with_profile(&request, Some(&pins)).unwrap();
    for id in random {
        let song = db.song(&id).unwrap();
        assert!(song.params["yue2"]["lm_seed"].as_u64().is_some());
    }
    request.variants = 9;
    assert!(db.enqueue_with_profile(&request, Some(&pins)).is_err());
}

#[test]
fn reopens_single_variant_jobs_saved_before_yue2_options() {
    let catalog = catalog::catalog();
    let selection = &yue2_profile(&catalog).selection;
    let mut pins = serde_json::to_value(catalog::generation_profile(selection).unwrap()).unwrap();
    pins["capabilities"]
        .as_object_mut()
        .unwrap()
        .remove("yue2_options");
    pins["capabilities"]["max_variants"] = 1.into();
    admission::validate_saved_profile(
        selection,
        &serde_json::json!({
            "generation_profile": pins,
            "instrumental": true,
            "duration": 360.0,
        }),
    )
    .unwrap();
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
        models_dir: models.clone(),
        songs_dir: songs.to_str().unwrap().into(),
        setup_complete: true,
        ..Default::default()
    })
    .unwrap();
    let catalog = catalog::catalog();
    let profile = catalog
        .profiles
        .iter()
        .find(|profile| {
            profile.selection.provider == "yue2"
                && Path::new(&models)
                    .join(&profile.selection.synthesis)
                    .is_file()
        })
        .expect("YuE2 backbone fixture");
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
    let policy = admission::generation_policy(
        &state,
        &state.db.settings().unwrap(),
        &profile.selection,
        true,
    )
    .unwrap();
    assert!(policy.available);
    assert_eq!(
        policy.detected_backend,
        crate::engine::backend_status::Backend::Metal
    );
    let work = tokio::spawn(worker(state.clone(), app.handle().clone()));

    let request = GenerateRequest {
        style: "English, acoustic pop, bright piano, soft drums, lead vocal".into(),
        lyrics: "[Verse]\nMorning light falls on the shore\nI hear the waves and sing once more"
            .into(),
        instrumental: false,
        seed: 128,
        variants: 2,
        yue2: Some(Yue2Options {
            steps: Some(8),
            lm_seed: Some(21),
            semantic_sampling: Some(Yue2Sampling {
                temperature: Some(0.85),
                ..Default::default()
            }),
            ..Default::default()
        }),
        duration: 10.0,
        ..Default::default()
    };
    let versions = admission::generate(&state, request.clone()).unwrap();
    assert_eq!(versions.len(), 2);
    let mut observed_steps = false;
    let mut overall_percent = 0;
    let song = wait_for_song(&state, &versions[0], |song| {
        if let Some(update) = state
            .runtime
            .progress()
            .filter(|update| update.job_id == versions[0])
        {
            assert!(update.overall_percent >= overall_percent);
            overall_percent = update.overall_percent;
            observed_steps |= update.progress.phase == "synth"
                && update.progress.step.is_some()
                && update.progress.total_steps == Some(8);
        }
        song.status == "done"
    })
    .await;
    assert!(
        observed_steps,
        "YuE2 did not report its actual synthesis steps"
    );
    assert!(overall_percent >= 50);
    let alternate = wait_for_song(&state, &versions[1], |song| song.status == "done").await;
    assert_eq!(alternate.group_id, song.group_id);
    assert_eq!(alternate.seed, song.seed + 1);
    let alt_audio = std::fs::read(alternate.path.unwrap()).unwrap();
    let meta = song.result_meta.unwrap();
    let audio = std::fs::read(song.path.unwrap()).unwrap();
    assert!(alt_audio != audio);
    let duration = crate::audio_facts::duration(&audio).unwrap();
    assert_eq!(song.engine.as_deref(), Some("yue2"));
    assert_eq!(
        song.params["generation_profile"]["runtime_revision"],
        profile.runtime.revision
    );
    assert_eq!(meta["duration"], duration);
    assert_eq!(meta["channels"], 2);
    assert_eq!(meta["sample_rate"], 48_000);
    assert_eq!(meta["effective_inference_steps"], 8);
    assert_eq!(meta["lm_seed"], 21);
    assert!(duration > 0.0 && duration <= 10.0);
    assert!(song.title.as_deref().is_some_and(|title| !title.is_empty()));
    println!(
        "YuE2 WAV {duration:.2}s, runtime {}s",
        meta["runtime_seconds"]
    );

    let instrumental = admission::generate(
        &state,
        GenerateRequest {
            style: "warm solo piano, soft drums".into(),
            lyrics: String::new(),
            instrumental: true,
            variants: 1,
            ..request.clone()
        },
    )
    .unwrap()
    .remove(0);
    let clip = wait_for_song(&state, &instrumental, |song| song.status == "done").await;
    let meta = clip.result_meta.unwrap();
    assert_eq!(meta["instrumental"], true);
    assert_eq!(meta["channels"], 2);
    assert_eq!(meta["sample_rate"], 48_000);
    let duration = meta["duration"].as_f64().unwrap();
    assert!(duration > 0.0 && duration <= 10.0);
    println!(
        "YuE2 instrumental WAV {duration:.2}s, runtime {}s",
        meta["runtime_seconds"]
    );

    let second = admission::generate(
        &state,
        GenerateRequest {
            duration: 60.0,
            variants: 1,
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
    assert_eq!(std::fs::read_dir(songs).unwrap().count(), 3);
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
