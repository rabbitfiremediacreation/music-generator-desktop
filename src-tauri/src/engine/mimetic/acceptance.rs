use crate::{
    admission, catalog, db::Database, download, exports, jobs, state::AppState,
    types::GenerateRequest, verification::ModelVerifier,
};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

fn path(name: &str) -> PathBuf {
    let path = PathBuf::from(std::env::var_os(name).unwrap_or_else(|| panic!("Set {name}")));
    assert!(path.is_absolute(), "{name} must be an absolute path");
    path
}

#[tokio::test]
#[ignore = "requires Hugging Face access and a staged partial checkpoint"]
async fn resumes_real_checkpoint() {
    let root = path("MIMETIC_QA_DOWNLOAD_DIR");
    let catalog = catalog::catalog();
    let profile = catalog
        .profiles
        .iter()
        .find(|profile| profile.selection.provider == "mimetic-a0")
        .unwrap();
    let asset = catalog.required(&profile.selection).unwrap().remove(0);
    let model = asset.download();
    let part = root.join(format!("{}.part", asset.file));
    let size = std::fs::metadata(&part).unwrap().len();
    assert!((1..model.estimated_bytes).contains(&size));
    assert!(!root.join(&asset.file).exists());
    let mut verifier = ModelVerifier::open(&root);
    let target = download::download_pinned_model(
        &reqwest::Client::new(),
        &asset.source.unwrap().url(),
        &root,
        &model,
        &mut verifier,
        &CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    assert!(!part.exists());
    assert!(verifier.is_verified(&target, &model.sha256));
    println!(
        "Verified {} bytes at {}",
        model.estimated_bytes,
        target.display()
    );
}

#[tokio::test]
#[ignore = "requires the bundled runtime and real models; run with outbound networking denied"]
async fn offline_queue_and_wav_export() {
    let root = path("MIMETIC_QA_OUTPUT");
    std::fs::create_dir(&root).unwrap();
    let resources = path("MIMETIC_QA_RESOURCES");
    let db = Database::open(&root).unwrap();
    let mut settings = db.settings().unwrap();
    settings.setup_complete = true;
    settings.models_dir = path("MIMETIC_QA_MODELS").to_str().unwrap().into();
    settings.export_format = "wav".into();
    db.save_settings(&settings).unwrap();

    let catalog = catalog::catalog();
    let profile = catalog
        .profiles
        .iter()
        .find(|profile| profile.selection.provider == "mimetic-a0")
        .unwrap();
    let selection = &profile.selection;
    let cancel = CancellationToken::new();
    catalog::install_profile(&catalog, &db, selection, &cancel, |event| {
        assert_eq!(event.phase, "verifying");
    })
    .await
    .unwrap();

    let app = tauri::test::mock_app();
    let state = Arc::new(AppState::new(db, resources.clone()));
    assert!(state.restore_setup().unwrap());
    let worker = tokio::spawn(jobs::worker(state.clone(), app.app_handle().clone()));
    let drum_prompt = "boom bap drum loop, standard kit, swung, with ghost notes";
    let mut exported = Vec::new();
    for (file, title, prompt, bpm, bars, seed) in [
        ("drums", "Boom bap drums", drum_prompt, 90, 4, 31),
        (
            "drums-repeat",
            "Boom bap drums repeat",
            drum_prompt,
            90,
            4,
            31,
        ),
        (
            "bass",
            "",
            "finger bass bassline, over Cm - Fm - G7, sparse, C minor",
            115,
            2,
            2718,
        ),
        (
            "melody",
            "A minor melody",
            "analog mono lead synth melody, over Am - F - C - G, laid-back, A minor",
            60,
            4,
            31415,
        ),
        (
            "one-bar",
            "One bar house drums",
            "house drum loop, dance kit, open hi-hats",
            124,
            1,
            42,
        ),
        (
            "bass-2",
            "D minor synth bass",
            "analog mono bassline, over Dm - Bb - C - Dm, D minor",
            100,
            2,
            17,
        ),
        (
            "melody-2",
            "C major marimba",
            "marimba melody, over C - Am - F - G, C major, light, staccato",
            120,
            2,
            23,
        ),
    ] {
        let id = admission::generate(
            &state,
            GenerateRequest {
                title: title.into(),
                prompt: prompt.into(),
                bpm,
                bars: Some(bars),
                seed,
                ..Default::default()
            },
        )
        .unwrap()
        .remove(0);
        let song = tokio::time::timeout(Duration::from_secs(620), async {
            loop {
                let song = state.db.song(&id).unwrap();
                if !matches!(song.status.as_str(), "queued" | "running") {
                    break song;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(song.status, "done", "{:?}", song.message);
        assert_eq!(song.engine.as_deref(), Some("mimetic-a0"));
        let result = song.result_meta.unwrap();
        assert_eq!(result["duration_source"], "wav");
        assert_eq!(result["bars"], bars);
        assert_eq!(result["bpm"], bpm);
        assert_eq!(result["seed"], seed);
        let destination = root.join(format!("{file}.wav"));
        exports::export(
            state.db.clone(),
            resources.clone(),
            "audio".into(),
            Some(id),
            None,
            destination.clone(),
            cancel.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            std::fs::read(song.path.unwrap()).unwrap()
        );
        exported.push(destination);
        println!("{file}: {result}");
    }
    let archive_path = root.join("library.zip");
    exports::export(
        state.db.clone(),
        resources,
        "zip".into(),
        None,
        None,
        archive_path.clone(),
        cancel,
    )
    .await
    .unwrap();
    let mut archive = zip::ZipArchive::new(std::fs::File::open(archive_path).unwrap()).unwrap();
    assert_eq!(archive.len(), exported.len());
    let archive_clips: Vec<Vec<u8>> = (0..archive.len())
        .map(|index| {
            use std::io::Read;
            let mut clip = archive.by_index(index).unwrap();
            assert!(clip.name().ends_with(".wav"));
            let mut bytes = Vec::new();
            clip.read_to_end(&mut bytes).unwrap();
            bytes
        })
        .collect();
    for file in exported {
        assert!(archive_clips.contains(&std::fs::read(file).unwrap()));
    }
    state.begin_shutdown();
    worker.await.unwrap();
}
