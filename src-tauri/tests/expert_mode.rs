use music_generator::{
    admission,
    catalog::{self, Selection},
    configuration::{self, SettingsPatch},
    db::Database,
    hardware::{self, Hardware},
    runtime::OperationKind,
    setup::{self, SetupRequest},
    state::AppState,
    types::{GenerateRequest, Settings, SongFilter},
};
use serde_json::json;
use std::{path::Path, sync::Arc, time::UNIX_EPOCH};

fn hardware(gib: u64) -> Hardware {
    let ram = gib * 1024u64.pow(3);
    let (lm, chunk) = hardware::recommend(ram, None);
    Hardware {
        ram_bytes: ram,
        gpu: "CPU".into(),
        vram_bytes: None,
        recommended_lm: lm.into(),
        vae_chunk: chunk,
        platform: "macos",
        cpu_only: true,
        nvidia: None,
        cuda: None,
    }
}

fn turbo() -> Selection {
    Selection {
        provider: "ace-step".into(),
        synthesis: "acestep-v15-turbo-Q8_0.gguf".into(),
        language: "acestep-5Hz-lm-0.6B-Q8_0.gguf".into(),
    }
}

fn state(root: &Path) -> Arc<AppState> {
    let db = Database::open(root).unwrap();
    let mut settings = db.settings().unwrap();
    settings.setup_complete = true;
    settings.expert_mode = true;
    turbo().apply(&mut settings).unwrap();
    db.save_settings(&settings).unwrap();
    let state = Arc::new(AppState::new(db, root.join("resources")));
    state.restore_setup().unwrap();
    state
}

// Simulate an installed, verified profile for admission tests. Hashing is tested in verification.rs.
fn installed(state: &AppState, selection: &Selection) {
    let settings = state.db.settings().unwrap();
    let root = Path::new(&settings.models_dir);
    std::fs::create_dir_all(root).unwrap();
    let mut entries = serde_json::Map::new();
    for model in catalog::required(selection).unwrap() {
        let path = root.join(model.file);
        std::fs::write(&path, b"model fixture").unwrap();
        let stamp = path.metadata().unwrap();
        entries.insert(
            path.canonicalize().unwrap().to_string_lossy().into_owned(),
            json!([
                model.sha256,
                stamp.len(),
                stamp
                    .modified()
                    .unwrap()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ]),
        );
    }
    std::fs::write(
        state.db.root.join("verified-models.json"),
        json!({"entries": entries}).to_string(),
    )
    .unwrap();
}

#[test]
fn yue2_analysis_uses_verified_ace_step_without_changing_the_active_profile() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let ace = turbo();
    let yue2 = catalog::catalog()
        .profiles
        .into_iter()
        .find(|profile| profile.selection.provider == "yue2")
        .unwrap()
        .selection;
    let mut settings = state.db.settings().unwrap();
    yue2.apply(&mut settings).unwrap();
    state.db.save_settings(&settings).unwrap();
    let engine = music_generator::engine::engine_path(&state.resources);
    std::fs::create_dir_all(engine.parent().unwrap()).unwrap();
    std::fs::write(engine, b"engine fixture").unwrap();
    assert_eq!(
        admission::analysis_settings(&state, None)
            .unwrap_err()
            .to_string(),
        "yue2_analysis_requires_ace_step"
    );
    installed(&state, &ace);
    assert_eq!(
        Selection::from_settings(&admission::analysis_settings(&state, None).unwrap()),
        ace
    );
    assert_eq!(
        Selection::from_settings(&state.db.settings().unwrap()),
        yue2
    );
    std::fs::remove_file(Path::new(&settings.models_dir).join(&ace.language)).unwrap();
    assert!(admission::analysis_settings(&state, Some(yue2)).is_err());
}

#[test]
fn defaults_and_legacy_settings_are_disabled_and_both_values_survive_restart() {
    assert!(!Settings::default().expert_mode);
    let legacy: Settings =
        serde_json::from_value(json!({"synthesis_model": turbo().synthesis})).unwrap();
    assert!(!legacy.expert_mode);
    let root = tempfile::tempdir().unwrap();
    for enabled in [false, true, false] {
        let db = Database::open(root.path()).unwrap();
        let mut settings = db.settings().unwrap();
        turbo().apply(&mut settings).unwrap();
        db.save_settings(&settings).unwrap();
        db.set_expert_mode(enabled).unwrap();
        drop(db);
        let db = Database::open(root.path()).unwrap();
        assert_eq!(db.settings().unwrap().expert_mode, enabled);
        assert_eq!(Selection::from_settings(&db.settings().unwrap()), turbo());
    }
}

#[test]
fn all_ace_step_families_and_precisions_require_expert_mode_except_hardware_recommendations() {
    let catalog = catalog::catalog();
    assert_eq!(catalog.expert_families.len(), 7);
    for family in [
        "turbo",
        "turbo-continuous",
        "turbo-shift1",
        "turbo-shift3",
        "sftturbo50",
        "xl-turbo",
        "xl-sftturbo50",
    ] {
        assert!(catalog
            .expert_families
            .contains(&format!("acestep-v15-{family}")));
    }
    for gib in [8, 16, 32] {
        let hw = hardware(gib);
        let recommendations = catalog.recommended_profiles(&hw);
        let ace_step_models = catalog.models.iter().filter(|m| m.provider == "ace-step");
        for synthesis in ace_step_models.clone().filter(|m| m.role == "synthesis") {
            for language in ace_step_models.clone().filter(|m| m.role == "language") {
                let selection = Selection {
                    provider: "ace-step".into(),
                    synthesis: synthesis.file.clone(),
                    language: language.file.clone(),
                };
                assert!(catalog.ensure_allowed(&selection, true, Some(&hw)).is_ok());
                let result = catalog.ensure_allowed(&selection, false, Some(&hw));
                assert_eq!(
                    result.is_ok(),
                    recommendations.contains(&selection),
                    "{selection:?} on {gib} GiB"
                );
                if let Err(error) = result {
                    assert_eq!(error.to_string(), "expert_mode_required");
                }
                if catalog.expert_families.contains(&synthesis.family) {
                    assert!(!recommendations.contains(&selection));
                }
            }
        }
    }
}

#[test]
fn recommendations_use_complete_profile_ram_and_recommended_language_size() {
    let catalog = catalog::catalog();
    for (gib, lm, count) in [(8, "0.6B", 1), (16, "1.7B", 2), (32, "4B", 2)] {
        let hw = hardware(gib);
        let profiles: Vec<_> = catalog
            .recommended_profiles(&hw)
            .into_iter()
            .filter(|profile| profile.provider == "ace-step")
            .collect();
        assert_eq!(profiles.len(), count);
        assert!(profiles
            .iter()
            .all(|p| p.language == music_generator::manifest::lm_file(lm)));
        assert_eq!(profiles[0].synthesis, "acestep-v15-sft-Q8_0.gguf");
        assert!(profiles
            .iter()
            .all(|p| catalog::memory_bytes(&catalog.required(p).unwrap()) <= hw.ram_bytes));
    }
    assert!(catalog.recommended_profiles(&hardware(4)).is_empty());
    let xl = Selection {
        synthesis: "acestep-v15-xl-sft-Q8_0.gguf".into(),
        ..turbo()
    };
    let mut hw = hardware(8);
    hw.ram_bytes = catalog::memory_bytes(&catalog.required(&xl).unwrap());
    assert!(catalog.recommended_profiles(&hw).contains(&xl));
    hw.ram_bytes -= 1;
    assert!(!catalog.recommended_profiles(&hw).contains(&xl));
    hw.recommended_lm = "unknown".into();
    assert!(catalog.recommended_profiles(&hw).is_empty());
}

#[tokio::test]
async fn disabling_preserves_running_and_queued_snapshots_but_blocks_new_work_and_retries() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    installed(&state, &turbo());
    let ids = admission::generate(
        &state,
        GenerateRequest {
            prompt: "piano".into(),
            title: "Kept".into(),
            variants: 2,
            ..Default::default()
        },
    )
    .unwrap();
    let original = state.db.song(&ids[1]).unwrap().params;
    let operation = state.runtime.try_begin(OperationKind::Generation).unwrap();
    let running = state.db.claim_next().unwrap().unwrap();
    let token = operation.cancellation();
    configuration::save(
        state.clone(),
        SettingsPatch {
            expert_mode: Some(false),
            ..Default::default()
        },
        |_| panic!("Preference writes cannot authorize folders"),
    )
    .await
    .unwrap();
    assert!(!token.is_cancelled());
    assert_eq!(state.db.song(&running.0).unwrap().status, "running");
    assert_eq!(state.db.song(&ids[1]).unwrap().params, original);
    assert_eq!(
        Selection::from_settings(&state.db.settings().unwrap()),
        turbo()
    );
    for model_selection in [None, Some(turbo())] {
        assert_eq!(
            admission::generate(
                &state,
                GenerateRequest {
                    prompt: "new".into(),
                    model_selection: model_selection.clone(),
                    ..Default::default()
                }
            )
            .unwrap_err()
            .to_string(),
            "expert_mode_required"
        );
        assert_eq!(
            admission::analysis_settings(&state, model_selection)
                .unwrap_err()
                .to_string(),
            "expert_mode_required"
        );
    }
    assert_eq!(state.db.songs(&SongFilter::default()).unwrap().len(), 2);
    state.db.fail(&running.0, "fixture").unwrap();
    assert_eq!(
        admission::retry(&state, &running.0)
            .unwrap_err()
            .to_string(),
        "expert_mode_required"
    );
    assert_eq!(state.db.song(&running.0).unwrap().status, "error");
    drop(operation);
    drop(state);
    let db = Database::open(root.path()).unwrap();
    let queued = db.claim_next().unwrap().unwrap();
    assert_eq!(queued.1, original);
    // The worker restores accepted snapshots without applying the new-work policy again.
    let mut settings = db.settings().unwrap();
    serde_json::from_value::<Selection>(queued.1["model_selection"].clone())
        .unwrap()
        .apply(&mut settings)
        .unwrap();
    assert_eq!(Selection::from_settings(&settings), turbo());
    drop(db);
    let state = Arc::new(AppState::new(
        Database::open(root.path()).unwrap(),
        root.path().join("resources"),
    ));
    state.restore_setup().unwrap();
    configuration::save(
        state.clone(),
        SettingsPatch {
            expert_mode: Some(true),
            ..Default::default()
        },
        |_| Ok(()),
    )
    .await
    .unwrap();
    admission::retry(&state, &running.0).unwrap();
    assert_eq!(state.db.song(&running.0).unwrap().status, "queued");
    assert!(admission::analysis_settings(&state, Some(turbo())).is_ok());
    assert!(admission::generate(
        &state,
        GenerateRequest {
            prompt: "new".into(),
            model_selection: Some(turbo()),
            ..Default::default()
        }
    )
    .is_ok());
}

#[tokio::test]
async fn forbidden_profile_installation_does_not_download_or_change_settings() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let before = serde_json::to_value(db.settings().unwrap()).unwrap();
    let result = catalog::install_profile(
        &catalog::catalog(),
        &db,
        &turbo(),
        &tokio_util::sync::CancellationToken::new(),
        |_| panic!("No download may start"),
    )
    .await;
    assert_eq!(result.unwrap_err().to_string(), "expert_mode_required");
    assert_eq!(
        serde_json::to_value(db.settings().unwrap()).unwrap(),
        before
    );
    assert!(!Path::new(&db.settings().unwrap().models_dir).exists());
}

#[test]
fn wizard_only_accepts_recommended_starter_profiles_without_expert_mode() {
    let settings = Settings::default();
    let mut request = SetupRequest {
        lm: "0.6B".into(),
        xl: false,
        models_dir: "/models".into(),
        songs_dir: "/songs".into(),
    };
    assert!(setup::validate_selection(&request, &settings, &hardware(8)).is_ok());
    request.xl = true;
    assert_eq!(
        setup::validate_selection(&request, &settings, &hardware(8))
            .unwrap_err()
            .to_string(),
        "expert_mode_required"
    );
    request.lm = "1.7B".into();
    assert!(setup::validate_selection(&request, &settings, &hardware(16)).is_ok());
    assert!(setup::validate_selection(&request, &settings, &hardware(32)).is_err());
    let expert = Settings {
        expert_mode: true,
        ..settings
    };
    assert!(setup::validate_selection(&request, &expert, &hardware(8)).is_ok());
    for (model, _) in setup::plan(&request).unwrap() {
        assert!(!catalog::catalog()
            .models
            .iter()
            .any(|asset| asset.file == model.file
                && catalog::catalog().expert_families.contains(&asset.family)));
    }
}

#[tokio::test]
async fn disabling_expert_mode_preserves_finished_audio_and_exports() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    installed(&state, &turbo());
    let id = admission::generate(
        &state,
        GenerateRequest {
            prompt: "piano".into(),
            ..Default::default()
        },
    )
    .unwrap()
    .remove(0);
    state.db.claim_next().unwrap();
    let dir = state.db.settings().unwrap().songs_dir;
    std::fs::create_dir_all(&dir).unwrap();
    let original = Path::new(&dir).join("kept.wav");
    std::fs::write(&original, b"lossless original").unwrap();
    state.db.finish(&id, "kept.wav", &json!({})).unwrap();
    let before = state.db.song(&id).unwrap().params;
    state.db.set_expert_mode(false).unwrap();
    let song = state.db.song(&id).unwrap();
    assert_eq!(song.params, before);
    assert_eq!(
        std::fs::read(song.path.unwrap()).unwrap(),
        b"lossless original"
    );
    let output = root.path().join("export.wav");
    music_generator::exports::export(
        state.db.clone(),
        state.resources.clone(),
        "audio".into(),
        Some(id),
        None,
        output.clone(),
        tokio_util::sync::CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(output).unwrap(), b"lossless original");
    assert!(Path::new(&state.db.settings().unwrap().models_dir)
        .join(&turbo().synthesis)
        .is_file());
}

#[test]
fn creator_selection_rejects_missing_models_without_downloading_or_changing_defaults() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let before = serde_json::to_value(state.db.settings().unwrap()).unwrap();
    let recommended = catalog::catalog().recommended_profiles(&hardware(16));
    let result = catalog::activate_cached_profile(&state.db, &recommended[1], &hardware(16));
    assert_eq!(result.unwrap_err().to_string(), "model_setup_required");
    assert_eq!(
        serde_json::to_value(state.db.settings().unwrap()).unwrap(),
        before
    );
    assert!(!Path::new(&state.db.settings().unwrap().models_dir).exists());
}

#[test]
fn creator_selection_uses_verified_files_offline_and_keeps_queue_snapshots() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let recommended = catalog::catalog().recommended_profiles(&hardware(16));
    installed(&state, &recommended[1]);
    let queued = state
        .db
        .enqueue(&GenerateRequest {
            prompt: "piano".into(),
            model_selection: Some(turbo()),
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    let snapshot = state.db.song(&queued).unwrap().params;
    state.db.set_expert_mode(false).unwrap();
    catalog::activate_cached_profile(&state.db, &recommended[1], &hardware(16)).unwrap();
    let settings = state.db.settings().unwrap();
    assert_eq!(Selection::from_settings(&settings), recommended[1]);
    assert!(!settings.expert_mode);
    assert_eq!(state.db.song(&queued).unwrap().params, snapshot);
    assert!(catalog::activate_cached_profile(&state.db, &turbo(), &hardware(16)).is_err());
    assert_eq!(
        Selection::from_settings(&state.db.settings().unwrap()),
        recommended[1]
    );
    for entry in std::fs::read_dir(&settings.models_dir).unwrap() {
        assert!(!entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".part"));
    }
}
