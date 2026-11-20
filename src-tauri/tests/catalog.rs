use music_generator::{
    catalog::{self, Selection},
    db::Database,
    hardware::Hardware,
    types::{GenerateRequest, Settings},
};
use serde_json::json;
use std::collections::HashSet;

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
            .filter(|m| m.provider == "ace-step" && m.role == "synthesis")
            .count(),
        52
    );
    assert_eq!(
        catalog
            .models
            .iter()
            .filter(|m| m.provider == "ace-step" && m.role == "language")
            .count(),
        8
    );
    assert_eq!(
        catalog
            .models
            .iter()
            .filter(|m| m.provider == "ace-step" && m.role == "dependency")
            .count(),
        2
    );
    let mut files = HashSet::new();
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
        if model.provider == "ace-step" && model.role == "synthesis" {
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

fn audiocraft_selection(synthesis: &str) -> Selection {
    Selection {
        provider: "audiocraft".into(),
        synthesis: synthesis.into(),
        language: String::new(),
    }
}

#[test]
fn audiocraft_profiles_pin_both_checkpoints_and_the_shared_t5_dependency() {
    let catalog = catalog::catalog();
    let syntheses = catalog
        .profiles
        .iter()
        .filter(|profile| profile.selection.provider == "audiocraft")
        .map(|profile| profile.selection.synthesis.as_str())
        .collect::<HashSet<_>>();
    assert_eq!(
        syntheses,
        HashSet::from(["musicgen-small", "magnet-small-30secs"])
    );

    let t5_pins = [
        (
            "config.json",
            1_208,
            "46dd7cb62d29c81fb551e0ef1ea274c24a46ba441eeb948897706252933df033",
        ),
        (
            "spiece.model",
            791_656,
            "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86",
        ),
        (
            "model.safetensors",
            891_646_390,
            "a90903540cc02cbeb7ff9f823f1a80eb778c7e22426a0e620b01c77a5ec8f5b4",
        ),
    ];
    for (synthesis, revision, min_duration, state_pin, codec_pin) in [
        (
            "musicgen-small",
            "4c8334b02c6ec4e8664a91979669a501ec497792",
            1,
            (
                "state_dict.bin",
                840_843_863,
                "830fe5771e2835cbd305f3ffdda22d3ff38718fbbe8274bd19dc203265de7244",
            ),
            (
                "compression_state_dict.bin",
                236_001_935,
                "37d256b525d4117f8bbf790ab448a8e9f4746cd401900fe1ae72e154b1513a30",
            ),
        ),
        (
            "magnet-small-30secs",
            "7d62a3ef839d51abb5f087ac72732d6f45301460",
            30,
            (
                "state_dict.bin",
                840_844_851,
                "965b4d537d691483918ccc6d97e738c0177191900c2e2cd3272d29fa3c9a44d0",
            ),
            (
                "compression_state_dict.bin",
                236_003_715,
                "91598c7da3d183eb8e0cc19cbbdc4f64f2d0c53069f9c8aa84185d0e33873c67",
            ),
        ),
    ] {
        let selection = audiocraft_selection(synthesis);
        let profile = catalog.profile(&selection).unwrap();
        let snapshot = catalog::generation_profile(&selection).unwrap();
        let repository = format!("facebook/{synthesis}");
        let t5_revision = "a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1";
        assert!(profile.name.contains("CC BY-NC 4.0"));
        assert!(profile.upstream_sources.iter().any(|source| {
            source.repository == repository
                && source.revision == revision
                && source.license == "CC BY-NC 4.0"
        }));
        assert!(profile.upstream_sources.iter().any(|source| {
            source.repository == "google-t5/t5-base"
                && source.revision == t5_revision
                && source.license == "Apache-2.0"
        }));
        assert_eq!(snapshot.model_revision, revision);
        assert_eq!(
            profile.runtime.executable,
            "engine/audiocraft/audiocraft-synth"
        );
        assert_eq!(snapshot.capabilities, profile.capabilities);
        assert_eq!(profile.capabilities.min_duration, min_duration);
        assert_eq!(profile.capabilities.max_duration, 30);
        assert_eq!(profile.capabilities.max_variants, 1);
        assert!(profile.capabilities.prompt);
        assert!(!profile.capabilities.lyrics);
        assert!(!profile.capabilities.advanced);
        assert!(!profile.capabilities.analysis);
        assert_eq!(snapshot.files.len(), 5);
        for (folder, repository, revision, pins) in [
            (
                synthesis,
                repository.as_str(),
                revision,
                &[state_pin, codec_pin][..],
            ),
            ("t5-base", "google-t5/t5-base", t5_revision, &t5_pins[..]),
        ] {
            for &(path, bytes, sha256) in pins {
                let file = format!("audiocraft/{folder}/{path}");
                let pin = snapshot.files.iter().find(|pin| pin.file == file).unwrap();
                assert_eq!(pin.bytes, bytes, "{file}");
                assert_eq!(pin.sha256, sha256, "{file}");
                let source = pin.source.as_ref().unwrap();
                assert_eq!(source.path, path);
                assert_eq!(source.revision, revision);
                assert_eq!(source.repository, repository);
                assert_eq!(
                    source.url(),
                    format!("https://huggingface.co/{repository}/resolve/{revision}/{path}")
                );
            }
        }
    }
}

#[test]
fn audiocraft_profiles_stay_out_of_automatic_and_legacy_selection() {
    let mut settings = Settings {
        lm_model: selection().language,
        ..Settings::default()
    };
    let hardware = Hardware {
        ram_bytes: u64::MAX,
        gpu: "CPU".into(),
        vram_bytes: None,
        recommended_lm: "0.6B".into(),
        vae_chunk: None,
        platform: std::env::consts::OS,
        cpu_only: true,
        nvidia: None,
        cuda: None,
    };
    let catalog = catalog::catalog();
    let recommended = catalog.recommended_profiles(&hardware);
    assert!(!recommended.is_empty());
    for name in ["musicgen-small", "magnet-small-30secs"] {
        let profile = audiocraft_selection(name);
        assert!(!recommended.contains(&profile));
        assert_eq!(
            catalog
                .ensure_allowed(&profile, false, Some(&hardware))
                .unwrap_err()
                .to_string(),
            "expert_mode_required"
        );
        catalog.ensure_allowed(&profile, true, None).unwrap();
    }
    assert_eq!(Selection::from_settings(&settings), selection());
    let profile = audiocraft_selection("musicgen-small");
    profile.apply(&mut settings).unwrap();
    assert_eq!(Selection::from_settings(&settings), profile);
    assert_eq!(catalog::legacy_selection(&settings), selection());
    let untested = Hardware {
        platform: "untested-platform",
        ..hardware
    };
    assert!(!catalog::compatible(&profile, &untested).unwrap());
    assert!(catalog
        .required(&audiocraft_selection("musicgen-melody"))
        .is_err());
    assert!(catalog
        .required(&audiocraft_selection("magnet-small-10secs"))
        .is_err());
}

#[tokio::test]
async fn imports_audiocraft_profiles_from_local_files_through_the_pinned_downloader() {
    use sha2::{Digest, Sha256};

    let models = tempfile::tempdir().unwrap();
    let mut catalog = catalog::catalog();
    let contents = b"model fixture";
    let sha256 = format!("{:x}", Sha256::digest(contents));
    for asset in catalog
        .models
        .iter_mut()
        .filter(|asset| asset.provider == "audiocraft")
    {
        asset.estimated_bytes = contents.len() as u64;
        asset.sha256.clone_from(&sha256);
        let path = models.path().join(&asset.file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }
    assert_audiocraft_offline_imports(catalog, models.path()).await;
}

#[tokio::test]
#[ignore = "requires both complete AudioCraft profiles in AUDIOCRAFT_TEST_MODELS"]
async fn imports_both_audiocraft_profiles_offline_and_reuses_t5_verification() {
    let models =
        std::path::PathBuf::from(std::env::var_os("AUDIOCRAFT_TEST_MODELS").expect("model folder"));
    assert_audiocraft_offline_imports(catalog::catalog(), &models).await;
}

async fn assert_audiocraft_offline_imports(
    mut catalog: catalog::Catalog,
    models: &std::path::Path,
) {
    use music_generator::verification::ModelVerifier;
    use std::sync::Mutex;
    use tokio_util::sync::CancellationToken;

    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let mut settings = db.settings().unwrap();
    settings.models_dir = models.to_string_lossy().into();
    settings.expert_mode = true;
    settings.setup_complete = true;
    db.save_settings(&settings).unwrap();

    // The shared installer must finish from the local files even with unusable source URLs.
    for asset in catalog
        .models
        .iter_mut()
        .filter(|asset| asset.provider == "audiocraft")
    {
        asset.source.as_mut().unwrap().repository = "invalid-repository".into();
    }
    let cancel = CancellationToken::new();
    for (synthesis, new_files) in [("musicgen-small", 5), ("magnet-small-30secs", 2)] {
        let selection = audiocraft_selection(synthesis);
        let required = catalog.required(&selection).unwrap();
        for asset in &required {
            let path = models.join(&asset.file);
            assert_eq!(
                path.metadata().unwrap().len(),
                asset.estimated_bytes,
                "{path:?}"
            );
        }
        let hashed = Mutex::new(HashSet::new());
        catalog::install_profile(&catalog, &db, &selection, &cancel, |progress| {
            assert_eq!(progress.phase, "verifying");
            hashed.lock().unwrap().insert(progress.file);
        })
        .await
        .unwrap();
        assert_eq!(hashed.into_inner().unwrap().len(), new_files);
        let verifier = ModelVerifier::open(root.path());
        for asset in required {
            assert!(verifier.is_verified(&models.join(asset.file), &asset.sha256));
        }
        assert_eq!(Selection::from_settings(&db.settings().unwrap()), selection);
    }
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
    settings.model_provider = "retired-provider".into();
    settings.synthesis_model = "retired-model.gguf".into();
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
    assert_eq!(raw, "\"retired-provider\"");
}

#[test]
fn removed_profiles_cannot_enter_the_queue() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let request = GenerateRequest {
        model_selection: Some(Selection {
            provider: "retired-provider".into(),
            synthesis: "retired-model.gguf".into(),
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
