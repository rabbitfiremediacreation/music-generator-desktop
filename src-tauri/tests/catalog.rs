use music_generator::{
    catalog::{self, Selection},
    db::Database,
    hardware::Hardware,
    types::{GenerateRequest, Settings},
};
use serde_json::json;

fn selection() -> Selection {
    Selection::from_settings(&Settings {
        lm_model: "acestep-5Hz-lm-0.6B-Q8_0.gguf".into(),
        ..Default::default()
    })
}

#[test]
fn pinned_catalog_covers_all_generation_variants_and_matches_starter_checksums() {
    let catalog = catalog::catalog();
    assert!(catalog.base_url.ends_with(&catalog.revision));
    assert_eq!(
        catalog
            .models
            .iter()
            .filter(|m| m.role == "synthesis")
            .count(),
        52
    );
    assert_eq!(
        catalog
            .models
            .iter()
            .filter(|m| m.role == "language")
            .count(),
        8
    );
    assert_eq!(
        catalog
            .models
            .iter()
            .filter(|m| m.role == "dependency")
            .count(),
        2
    );
    let mut files = std::collections::HashSet::new();
    for model in &catalog.models {
        assert!(files.insert(&model.file));
        assert!(!model.file.contains('\\'));
        assert!(std::path::Path::new(&model.file)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_))));
        if model.provider == "ace-step" {
            assert!(!model.file.contains('/'));
            assert!(model.source.is_none());
        }
        assert!(model.estimated_bytes > 0);
        assert_eq!(model.sha256.len(), 64);
        assert!(model.sha256.chars().all(|c| c.is_ascii_hexdigit()));
        if model.role == "synthesis" {
            assert_eq!(
                model.recommended_steps,
                Some(if model.family.contains("turbo") {
                    8
                } else {
                    80
                })
            );
        }
    }
    for starter in music_generator::manifest::manifest().models {
        let model = catalog
            .models
            .iter()
            .find(|m| m.file == starter.file)
            .unwrap();
        assert_eq!(model.sha256, starter.sha256);
    }
    assert!(!files.contains(&"acestep-5Hz-lm-4B-Q4_K_M.gguf".to_string()));
}

#[test]
fn mulacover_resolves_only_the_pinned_native_package_and_never_becomes_a_starter_model() {
    let catalog = catalog::catalog();
    let profile = catalog
        .profiles
        .iter()
        .find(|profile| profile.selection.provider == "mulacover")
        .unwrap();
    let files = catalog.required(&profile.selection).unwrap();
    let [package] = files.as_slice() else {
        panic!("The complete native checkpoint is the only separately installed weight file");
    };
    assert_eq!(package.file, "mulacover/MuLaCover-Q8_0.gguf");
    assert_eq!(package.estimated_bytes, 8_220_378_496);
    assert_eq!(
        package.sha256,
        "5daca50ce959c63dcfef3be1e3a7cd855eee753a91cab1a3475da1af781e4518"
    );
    assert_eq!(
        package.source.as_ref().unwrap().url(),
        "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/57de533382ad47d5527e7562d1f80c41f769553b/MuLaCover-GGUF/mulacover-q8_0.gguf"
    );
    assert!(profile.capabilities.reference_audio);
    assert!(profile.capabilities.lyrics_required);
    assert!(!profile.capabilities.analysis);
    assert_eq!(profile.usage.outputs, "mulacover_outputs");
    let codec_source = |profile: &catalog::ProviderProfile| {
        profile
            .upstream_sources
            .iter()
            .find(|source| source.repository == "HeartMuLa/HeartCodec-oss-20260123")
            .unwrap()
            .revision
            .clone()
    };
    let heartmula = catalog
        .profiles
        .iter()
        .find(|profile| profile.selection.provider == "heartmula")
        .unwrap();
    assert_eq!(codec_source(profile), codec_source(heartmula));
    let mut unsupported = music_generator::hardware::inspect().clone();
    unsupported.platform = "windows";
    assert!(!catalog::compatible(&profile.selection, &unsupported).unwrap());
    unsupported.platform = "macos";
    unsupported.ram_bytes = 32 * 1024u64.pow(3);
    assert!(!catalog::compatible(&profile.selection, &unsupported).unwrap());
    assert!(catalog
        .recommended_profiles(music_generator::hardware::inspect())
        .iter()
        .all(|entry| entry.provider == "ace-step"));
}

#[tokio::test]
async fn mulacover_local_import_keeps_the_active_profile_until_verified() {
    use tokio_util::sync::CancellationToken;

    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let mut settings = db.settings().unwrap();
    settings.models_dir = root.path().to_string_lossy().into();
    settings.lm_model = selection().language;
    settings.setup_complete = true;
    settings.expert_mode = true;
    db.save_settings(&settings).unwrap();
    let prior = Selection::from_settings(&settings);

    let mut fixture = catalog::catalog();
    let chosen = fixture
        .profiles
        .iter()
        .find(|profile| profile.selection.provider == "mulacover")
        .unwrap()
        .selection
        .clone();
    let asset = fixture
        .models
        .iter_mut()
        .find(|asset| asset.provider == "mulacover")
        .unwrap();
    asset.estimated_bytes = 3;
    asset.sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into();
    let imported = root.path().join(&asset.file);
    std::fs::create_dir_all(imported.parent().unwrap()).unwrap();
    std::fs::write(&imported, b"bad").unwrap();
    let cancel = CancellationToken::new();
    assert!(
        catalog::install_profile(&fixture, &db, &chosen, &cancel, |_| {})
            .await
            .is_err()
    );
    assert_eq!(Selection::from_settings(&db.settings().unwrap()), prior);

    std::fs::write(&imported, b"abc").unwrap();
    catalog::install_profile(&fixture, &db, &chosen, &cancel, |_| {})
        .await
        .unwrap();
    assert_eq!(Selection::from_settings(&db.settings().unwrap()), chosen);
    catalog::install_profile(&fixture, &db, &chosen, &cancel, |_| {
        panic!("Unchanged verified imports must reuse their cached proof");
    })
    .await
    .unwrap();
}

#[test]
fn provider_role_and_path_validation_cannot_route_unsupported_weights_to_ace_step() {
    let mut s = selection();
    assert_eq!(catalog::required(&s).unwrap().len(), 4);
    s.synthesis = "../acestep-v15-sft-Q8_0.gguf".into();
    assert!(catalog::required(&s).is_err());
    s.synthesis = s.language.clone();
    assert!(catalog::required(&s).is_err());
    s = selection();
    s.provider = "unsupported-provider".into();
    assert!(catalog::required(&s).is_err());
    let mut settings = Settings::default();
    let before = serde_json::to_value(&settings).unwrap();
    assert!(s.apply(&mut settings).is_err());
    assert_eq!(serde_json::to_value(settings).unwrap(), before);
}

#[test]
fn compatibility_uses_the_complete_profile_and_keeps_cpu_only_intel_available() {
    let mut hw = Hardware {
        ram_bytes: 8 * 1024u64.pow(3),
        gpu: "CPU".into(),
        vram_bytes: None,
        recommended_lm: "0.6B".into(),
        vae_chunk: Some(256),
        platform: "macos",
        cpu_only: true,
        nvidia: None,
        cuda: None,
    };
    let mut s = selection();
    assert!(catalog::compatible(&s, &hw).unwrap());
    s.synthesis = "acestep-v15-xl-sft-BF16.gguf".into();
    s.language = "acestep-5Hz-lm-4B-BF16.gguf".into();
    assert!(!catalog::compatible(&s, &hw).unwrap());
    hw.ram_bytes = 32 * 1024u64.pow(3);
    assert!(catalog::compatible(&s, &hw).unwrap());
    hw.ram_bytes = catalog::memory_bytes(&catalog::required(&s).unwrap()) - 1;
    assert!(!catalog::compatible(&s, &hw).unwrap());
}

#[test]
fn model_changes_survive_restart_without_changing_queue_snapshots_or_song_values() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let first = selection();
    let request = GenerateRequest {
        prompt: "jazz".into(),
        inference_steps: 8,
        lm_temperature: Some(0.65),
        seed: 123,
        model_selection: Some(first.clone()),
        ..Default::default()
    };
    let id = db.enqueue(&request).unwrap().remove(0);
    let original = db.song(&id).unwrap().params;
    let mut settings = db.settings().unwrap();
    let second = Selection {
        provider: "ace-step".into(),
        synthesis: "acestep-v15-xl-turbo-Q4_K_M.gguf".into(),
        language: "acestep-5Hz-lm-1.7B-BF16.gguf".into(),
    };
    second.apply(&mut settings).unwrap();
    db.save_settings(&settings).unwrap();
    drop(db);
    let db = Database::open(root.path()).unwrap();
    assert_eq!(Selection::from_settings(&db.settings().unwrap()), second);
    let (_, params) = db.claim_next().unwrap().unwrap();
    assert_eq!(params, original);
    assert_eq!(params["model_selection"], json!(first));
    db.fail(&id, "retry").unwrap();
    db.retry(&id).unwrap();
    assert_eq!(db.claim_next().unwrap().unwrap().1, original);
    // Settings created before the picker keep their original XL/Q8 choice.
    let legacy: Settings =
        serde_json::from_value(json!({"dit":"xl","lm_model":"acestep-5Hz-lm-4B-Q8_0.gguf"}))
            .unwrap();
    assert_eq!(
        Selection::from_settings(&legacy).synthesis,
        "acestep-v15-xl-sft-Q8_0.gguf"
    );
}

#[tokio::test]
async fn activation_is_atomic_on_checksum_failure_and_cancellation_then_reuses_verified_files_offline(
) {
    use axum::{routing::get, Router};
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use tokio_util::sync::CancellationToken;
    for corrupt in [true, false] {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let mut settings = db.settings().unwrap();
        settings.models_dir = root.path().to_string_lossy().into();
        settings.lm_model = selection().language;
        settings.setup_complete = true;
        settings.expert_mode = true;
        db.save_settings(&settings).unwrap();
        let original = serde_json::to_value(&settings).unwrap();
        let bad = Arc::new(AtomicBool::new(corrupt));
        let calls = Arc::new(AtomicUsize::new(0));
        let (server_bad, server_calls) = (bad.clone(), calls.clone());
        let app = Router::new().route(
            "/{file}",
            get(move || {
                let (bad, calls) = (server_bad.clone(), server_calls.clone());
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    if bad.load(Ordering::SeqCst) {
                        "bad"
                    } else {
                        "abc"
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut fixture = catalog::catalog();
        fixture.base_url = format!("http://{}", listener.local_addr().unwrap());
        for model in &mut fixture.models {
            model.estimated_bytes = 3;
            model.sha256 =
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into();
        }
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let next = Selection {
            synthesis: "acestep-v15-turbo-Q4_K_M.gguf".into(),
            ..selection()
        };
        let cancel = CancellationToken::new();
        let result = catalog::install_profile(&fixture, &db, &next, &cancel, |p| {
            if !corrupt && p.phase == "verifying" {
                cancel.cancel();
            }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(
            serde_json::to_value(db.settings().unwrap()).unwrap(),
            original
        );
        assert!(!root.path().join(&next.synthesis).exists());
        bad.store(false, Ordering::SeqCst);
        catalog::install_profile(&fixture, &db, &next, &CancellationToken::new(), |_| {})
            .await
            .unwrap();
        assert_eq!(Selection::from_settings(&db.settings().unwrap()), next);
        let online_calls = calls.load(Ordering::SeqCst);
        task.abort();
        // No server is available, yet the persisted checksum proofs allow reuse.
        catalog::install_profile(&fixture, &db, &next, &CancellationToken::new(), |_| {})
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), online_calls);
    }
}

#[test]
fn retired_provider_settings_restore_ace_step_without_rewriting_old_songs_or_files() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let ace = selection();
    let mut settings = db.settings().unwrap();
    settings
        .model_profiles
        .insert("ace-step".into(), ace.clone());
    settings.model_provider = "heartmula".into();
    settings.synthesis_model = "heartmula-q8_0.gguf".into();
    settings.lm_model.clear();
    settings.setup_complete = true;
    db.save_settings(&settings).unwrap();
    let file = root.path().join("preserved.gguf");
    std::fs::write(&file, b"existing model").unwrap();
    let request = GenerateRequest {
        title: "Existing song".into(),
        prompt: "ambient piano".into(),
        ..Default::default()
    };
    let id = db.enqueue(&request).unwrap().remove(0);
    let before = db.song(&id).unwrap().params;
    let restored = db.settings().unwrap();
    assert_eq!(Selection::from_settings(&restored), ace);
    assert!(!restored.setup_complete);
    assert_eq!(db.song(&id).unwrap().params, before);
    assert_eq!(std::fs::read(file).unwrap(), b"existing model");
    let raw: String = rusqlite::Connection::open(root.path().join("music.db"))
        .unwrap()
        .query_row(
            "SELECT value FROM settings WHERE key='model_provider'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(raw, "\"heartmula\"");
}

#[test]
fn removed_profiles_cannot_enter_the_queue() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let request = GenerateRequest {
        model_selection: Some(Selection {
            provider: "heartmula".into(),
            synthesis: "heartmula-q8_0.gguf".into(),
            language: String::new(),
        }),
        ..Default::default()
    };
    assert!(db.enqueue(&request).is_err());
    assert!(db.songs(&Default::default()).unwrap().is_empty());
}

#[test]
fn retired_provider_without_a_saved_ace_profile_uses_verified_catalog_defaults() {
    let mut settings = Settings {
        model_provider: "retired-provider".into(),
        setup_complete: true,
        ..Default::default()
    };
    catalog::restore_supported_profile(&mut settings).unwrap();
    let selection = Selection::from_settings(&settings);
    assert_eq!(selection.provider, "ace-step");
    assert_eq!(selection.language, "acestep-5Hz-lm-0.6B-Q8_0.gguf");
    assert_eq!(catalog::required(&selection).unwrap().len(), 4);
    assert!(!settings.setup_complete);
}
