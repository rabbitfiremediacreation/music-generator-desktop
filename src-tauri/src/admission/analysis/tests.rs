use super::*;
use crate::{db::Database, engine::engine_path};
use serde_json::json;
use std::{fs, time::UNIX_EPOCH};

fn hardware(ram_gib: u64) -> Hardware {
    let ram_bytes = ram_gib * 1024 * 1024 * 1024;
    let (lm, vae_chunk) = hardware::recommend(ram_bytes, None);
    Hardware {
        ram_bytes,
        gpu: "Apple GPU".into(),
        vram_bytes: None,
        recommended_lm: lm.into(),
        vae_chunk,
        platform: "macos",
        cpu_only: false,
        nvidia: None,
        cuda: None,
    }
}

// Exercise analysis admission with the same cached verification stamps as an installed profile.
fn install_verified_models(state: &AppState, models: &Path, selection: &Selection) {
    fs::create_dir_all(models).unwrap();
    let mut entries = serde_json::Map::new();
    for model in catalog::required(selection).unwrap() {
        let path = models.join(model.file);
        fs::write(&path, b"model fixture").unwrap();
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
    fs::write(
        state.db.root.join("verified-models.json"),
        json!({ "entries": entries }).to_string(),
    )
    .unwrap();
}

#[test]
fn yue2_analysis_requires_compatible_verified_ace_step_and_preserves_the_active_profile() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let state = AppState::new(db, root.path().join("resources"));
    let ace = Selection {
        provider: "ace-step".into(),
        synthesis: "acestep-v15-turbo-Q8_0.gguf".into(),
        language: "acestep-5Hz-lm-0.6B-Q8_0.gguf".into(),
    };
    let yue2 = catalog::catalog()
        .profiles
        .into_iter()
        .find(|profile| profile.selection.provider == "yue2")
        .unwrap()
        .selection;
    let mut settings = state.db.settings().unwrap();
    settings.expert_mode = true;
    ace.apply(&mut settings).unwrap();
    yue2.apply(&mut settings).unwrap();
    state.db.save_settings(&settings).unwrap();

    let ample_ram = hardware(32);
    let resolve = |hardware: &Hardware| analysis_settings_for_hardware(&state, None, hardware);
    let engine = engine_path(&state.resources);
    let models = Path::new(&settings.models_dir);
    install_verified_models(&state, models, &ace);
    assert_eq!(
        resolve(&ample_ram).unwrap_err().to_string(),
        "yue2_analysis_requires_ace_step"
    );
    fs::create_dir_all(engine.parent().unwrap()).unwrap();
    fs::write(engine, b"engine fixture").unwrap();

    assert_eq!(
        resolve(&hardware(7)).unwrap_err().to_string(),
        "yue2_analysis_requires_ace_step"
    );
    assert_eq!(Selection::from_settings(&resolve(&ample_ram).unwrap()), ace);
    assert_eq!(
        Selection::from_settings(&state.db.settings().unwrap()),
        yue2
    );

    fs::remove_file(models.join(&ace.language)).unwrap();
    assert!(analysis_settings_for_hardware(&state, Some(yue2), &ample_ram).is_err());
}
