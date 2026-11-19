use music_generator::{
    catalog::{self, Acquisition, Catalog, Selection},
    db::Database,
    generation_limits::validate_request,
    types::GenerateRequest,
    verification::ModelVerifier,
};
use serde_json::json;
use std::path::Path;
use tokio_util::sync::CancellationToken;

fn profile() -> (Catalog, Selection) {
    let catalog = catalog::catalog();
    let selection = catalog
        .profiles
        .iter()
        .find(|profile| profile.selection.provider == "minimax-music3")
        .unwrap()
        .selection
        .clone();
    (catalog, selection)
}

#[test]
fn catalog_pins_the_balanced_package_and_license_while_release_is_held() {
    let (catalog, selection) = profile();
    let profile = catalog.profile(&selection).unwrap();
    assert_eq!(profile.acquisition, Acquisition::Manual);
    assert_eq!(profile.platforms.len(), 0);
    assert_eq!(
        profile.runtime.revision,
        "f7ac446fb75e594a6913c846bea6c85b637f6ac0"
    );
    assert_eq!(
        profile.upstream_sources[1].repository,
        "MiniMaxAI/MiniMax-Music3"
    );
    assert!(matches!(
        catalog.ensure_allowed(&selection, true, None),
        Err(error) if error.to_string().contains("license safeguards")
    ));
    let files = catalog.required(&selection).unwrap();
    let required = [
        "language_model_q4_0.gguf",
        "config.json",
        "config/language_model.json",
        "config/rvq_depth_decoder.json",
        "config/condition_encoder.json",
        "config/transformer.json",
        "config/vocoder.json",
        "tokenizer/tokenizer.json",
        "tokenizer/tokenizer_config.json",
        "rvq_depth_decoder_q8_0.gguf",
        "condition_encoder.gguf",
        "transformer_q4_0.gguf",
        "vocoder.gguf",
        "LICENSE",
    ];
    assert_eq!(files.len(), required.len());
    for (file, expected) in files.iter().zip(required) {
        let source = file.source.as_ref().unwrap();
        assert_eq!(file.file, format!("MiniMax-Music3-GGUF/{expected}"));
        assert_eq!(source.path, expected);
        assert_eq!(source.repository, "audio-cpp/MiniMax-Music3-GGUF");
        assert_eq!(source.revision, "46fe77f8bb395ccdbe797d784225f7b84866e7ce");
        assert!(source.url().ends_with(&format!("/{expected}")));
    }
    assert_eq!(
        files.iter().map(|file| file.estimated_bytes).sum::<u64>(),
        8_446_106_333
    );
    let snapshot = catalog::generation_profile(&selection).unwrap();
    assert_eq!(
        snapshot.model_revision,
        profile.upstream_sources[0].revision
    );
    assert_eq!(snapshot.files.len(), files.len());
}

#[tokio::test]
async fn manual_import_checks_every_file_without_activating_a_held_profile() {
    let (mut catalog, selection) = profile();
    let local = tempfile::tempdir().unwrap();
    let db = Database::open(local.path()).unwrap();
    let mut settings = db.settings().unwrap();
    settings.models_dir = local.path().join("models").to_string_lossy().into();
    db.save_settings(&settings).unwrap();
    let models_dir = Path::new(&settings.models_dir);
    let active = Selection::from_settings(&settings);
    let cancel = CancellationToken::new();

    for asset in catalog
        .models
        .iter_mut()
        .filter(|asset| asset.provider == selection.provider)
    {
        asset.estimated_bytes = 3;
        asset.sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into();
        let path = models_dir.join(&asset.file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        if asset.role != "license" {
            std::fs::write(path, b"abc").unwrap();
        }
    }
    assert!(
        catalog::verify_imported_models(&catalog, &db, &selection, &cancel, |_| {})
            .await
            .is_err()
    );
    let license = models_dir.join("MiniMax-Music3-GGUF/LICENSE");
    std::fs::write(&license, b"bad").unwrap();
    let failure = catalog::verify_imported_models(&catalog, &db, &selection, &cancel, |_| {})
        .await
        .unwrap_err();
    assert!(failure.to_string().contains("LICENSE failed verification"));
    std::fs::write(&license, b"abc").unwrap();
    catalog::verify_imported_models(&catalog, &db, &selection, &cancel, |_| {})
        .await
        .unwrap();
    let cache = ModelVerifier::open(&db.root);
    assert!(catalog
        .required(&selection)
        .unwrap()
        .iter()
        .all(|asset| { cache.is_verified(&models_dir.join(&asset.file), &asset.sha256) }));
    assert_eq!(Selection::from_settings(&db.settings().unwrap()), active);

    cancel.cancel();
    assert!(matches!(
        catalog::verify_imported_models(&catalog, &db, &selection, &cancel, |_| {}).await,
        Err(music_generator::error::Error::Cancelled)
    ));
}

#[test]
fn queue_parameters_preserve_sections_lyrics_duration_and_seed() {
    let (_, selection) = profile();
    let capabilities = catalog::capabilities(&selection).unwrap();
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let request = GenerateRequest {
        model_selection: Some(selection),
        prompt: "Global Metadata: folk\nVocal Details: warm\nArrangement: strings".into(),
        lyrics: "[Verse]\nWe follow starlight\n[Chorus]\nWe make it home".into(),
        instrumental: false,
        duration: 180.0,
        seed: i64::from(u32::MAX),
        ..Default::default()
    };
    let id = db.enqueue(&request).unwrap().remove(0);
    let (claimed, params) = db.claim_next().unwrap().unwrap();
    assert_eq!(claimed, id);
    assert_eq!(params["caption"], json!(request.prompt));
    assert_eq!(params["lyrics"], json!(request.lyrics));
    assert_eq!(params["duration"], json!(request.duration));
    assert_eq!(params["seed"], json!(request.seed));
    for invalid in [
        GenerateRequest {
            prompt: "a\0b".into(),
            ..request.clone()
        },
        GenerateRequest {
            prompt: "ü".repeat(4096),
            ..request.clone()
        },
        GenerateRequest {
            lyrics: String::new(),
            ..request.clone()
        },
        GenerateRequest {
            seed: request.seed + 1,
            ..request
        },
    ] {
        assert!(validate_request(&invalid, &capabilities).is_err());
    }
}

#[tokio::test]
#[ignore = "requires the pinned local GGUF package in MINIMAX_TEST_MODELS_DIR"]
async fn verifies_the_real_imported_package() {
    let (catalog, selection) = profile();
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let mut settings = db.settings().unwrap();
    settings.models_dir = std::env::var("MINIMAX_TEST_MODELS_DIR").unwrap();
    db.save_settings(&settings).unwrap();
    catalog::verify_imported_models(&catalog, &db, &selection, &CancellationToken::new(), |_| {})
        .await
        .unwrap();
}
