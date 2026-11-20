use music_generator::{
    catalog::{self, Acquisition, Selection},
    db::Database,
    types::GenerateRequest,
};
use serde_json::json;
use tokio_util::sync::CancellationToken;

fn selection(variant: &str) -> Selection {
    Selection {
        provider: "stable-audio-3".into(),
        synthesis: format!("stable-audio-3-{variant}"),
        language: String::new(),
    }
}

#[test]
fn stable_audio_variants_have_separate_pinned_imports_and_duration_limits() {
    let catalog = catalog::catalog();
    for (variant, max_duration) in [("small-music", 120), ("medium", 380)] {
        let selection = selection(variant);
        let profile = catalog.profile(&selection).unwrap();
        assert_eq!(profile.acquisition, Acquisition::Manual);
        assert_eq!(profile.capabilities.max_duration, max_duration);
        assert!(profile.capabilities.prompt && profile.capabilities.instrumental);
        assert!(!profile.capabilities.lyrics && !profile.capabilities.analysis);
        let files = catalog.required(&selection).unwrap();
        assert_eq!(files.len(), 7);
        for file in files {
            let source = file.source.as_ref().unwrap();
            assert_eq!(
                source.repository,
                format!("stabilityai/{}", selection.synthesis)
            );
            assert_eq!(source.revision, profile.upstream_sources[0].revision);
            assert_eq!(source.revision.len(), 40);
            assert_eq!(
                file.file,
                format!("{}/{}", selection.synthesis, source.path)
            );
            assert!(file.estimated_bytes > 0);
            assert_eq!(file.sha256.len(), 64);
        }
        assert!(profile
            .upstream_sources
            .iter()
            .any(
                |source| source.repository == "stabilityai/stable-audio-3-optimized"
                    && source.role == "optimized_reference"
            ));
    }
    assert!(catalog.required(&selection("optimized")).is_err());
}

#[tokio::test]
async fn local_import_rejects_missing_changed_and_cancelled_files_without_activating() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let mut settings = db.settings().unwrap();
    settings.models_dir = root.path().to_string_lossy().into();
    db.save_settings(&settings).unwrap();
    let selection = selection("small-music");
    let mut fixture = catalog::catalog();
    fixture.base_url = "http://127.0.0.1:1".into();
    let cancel = CancellationToken::new();
    assert!(
        catalog::verify_manual_profile(&fixture, &db, &selection, &cancel, |_| {})
            .await
            .is_err()
    );

    for file in fixture
        .models
        .iter_mut()
        .filter(|file| file.family == selection.synthesis)
    {
        file.estimated_bytes = 3;
        file.sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into();
        let destination = root.path().join(&file.file);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::write(destination, b"abc").unwrap();
    }
    let config = root
        .path()
        .join(&selection.synthesis)
        .join("model_config.json");
    std::fs::write(&config, b"xyz").unwrap();
    assert!(
        catalog::verify_manual_profile(&fixture, &db, &selection, &cancel, |_| {})
            .await
            .is_err()
    );
    std::fs::write(&config, b"abc").unwrap();
    assert!(
        catalog::verify_manual_profile(&fixture, &db, &selection, &cancel, |_| cancel.cancel())
            .await
            .is_err()
    );
    catalog::verify_manual_profile(&fixture, &db, &selection, &CancellationToken::new(), |_| {})
        .await
        .unwrap();
    assert_ne!(Selection::from_settings(&db.settings().unwrap()), selection);
}

#[test]
fn an_instrumental_request_persists_no_lyrics_and_remains_valid_for_retry() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let selection = selection("small-music");
    let request = GenerateRequest {
        model_selection: Some(selection.clone()),
        prompt: "quiet piano".into(),
        duration: 5.5,
        instrumental: true,
        keep_caption: true,
        ..Default::default()
    };
    let id = db.enqueue(&request).unwrap().remove(0);
    let song = db.song(&id).unwrap();
    assert_eq!(song.params["lyrics"], json!(""));
    assert_eq!(song.params["instrumental"], json!(true));
    music_generator::generation_limits::validate_request(
        &serde_json::from_value(song.params).unwrap(),
        &catalog::capabilities(&selection).unwrap(),
    )
    .unwrap();

    let vocal = GenerateRequest {
        instrumental: false,
        ..request
    };
    assert!(db.enqueue(&vocal).is_err());
}
