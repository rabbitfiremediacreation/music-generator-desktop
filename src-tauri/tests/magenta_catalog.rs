use music_generator::catalog::{self, Acquisition, Selection};

const MODEL_REPOSITORY: &str = "google/magenta-realtime-2";
const MODEL_REVISION: &str = "010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc";
const PROVIDER: &str = "magenta-realtime-2";

#[test]
fn mrt2_small_pins_the_complete_native_bundle_and_publisher_terms() {
    let catalog = catalog::catalog();
    let selection = Selection {
        provider: PROVIDER.into(),
        synthesis: "mrt2_small".into(),
        language: String::new(),
    };
    let profile = catalog.profile(&selection).expect("mrt2_small profile");
    let expected: &[(&str, u64)] = &[
        ("models/mrt2_small/mrt2_small.mlxfn", 455_654_550),
        ("models/mrt2_small/mrt2_small_state.safetensors", 8_676_998),
        ("resources/musiccoca/spm.model", 517_448),
        ("resources/musiccoca/text_encoder.tflite", 418_674_324),
        (
            "resources/musiccoca/pretrained_vector_quantizer.tflite",
            72_422_108,
        ),
        ("resources/musiccoca/mapper.tflite", 86_166_664),
        ("resources/musiccoca/audio_preprocessor.tflite", 8_729_640),
        ("resources/musiccoca/music_encoder.tflite", 370_935_584),
        (
            "resources/spectrostream/spectrostream_encoder.mlxfn",
            104_319_983,
        ),
    ];
    assert_eq!(profile.files.len(), expected.len());
    let assets = catalog
        .required(&selection)
        .expect("complete native bundle");
    assert_eq!(assets.len(), expected.len());
    let snapshot = catalog::generation_profile(&selection).expect("generation profile snapshot");
    assert_eq!(snapshot.model_revision, MODEL_REVISION);
    assert_eq!(snapshot.runtime_revision, profile.runtime.revision);
    assert_eq!(snapshot.files.len(), assets.len());
    for (pin, asset) in snapshot.files.iter().zip(&assets) {
        assert_eq!(pin.file, asset.file);
        assert_eq!(pin.bytes, asset.estimated_bytes);
        assert_eq!(pin.sha256, asset.sha256);
        assert_eq!(pin.source, asset.source);
    }
    for &(path, bytes) in expected {
        let file = format!("{PROVIDER}/{path}");
        let asset = assets
            .iter()
            .find(|asset| asset.provider == PROVIDER && asset.file == file)
            .expect("model artifact in catalog");
        assert_eq!(asset.estimated_bytes, bytes);
        let source = asset
            .source
            .as_ref()
            .expect("immutable Hugging Face source");
        assert_eq!(source.repository, MODEL_REPOSITORY);
        assert_eq!(source.revision, MODEL_REVISION);
        assert_eq!(source.path, path);
        assert_eq!(
            source.url(),
            format!("https://huggingface.co/{MODEL_REPOSITORY}/resolve/{MODEL_REVISION}/{path}")
        );
    }
    assert_eq!(profile.acquisition, Acquisition::Download);
    assert_eq!(profile.upstream_sources.len(), 1);
    assert_eq!(profile.upstream_sources[0].repository, MODEL_REPOSITORY);
    assert_eq!(profile.upstream_sources[0].license, "CC BY 4.0");
    assert_eq!(
        profile.usage.policy_url.as_deref(),
        Some(
            "https://huggingface.co/google/magenta-realtime-2/blob/010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc/README.md#terms-of-use"
        )
    );
}

#[test]
fn mrt2_small_is_the_only_magenta_profile_and_supports_instrumental_text_capture() {
    let catalog = catalog::catalog();
    let mut profiles = catalog
        .profiles
        .iter()
        .filter(|profile| profile.selection.provider == PROVIDER);
    let profile = profiles.next().expect("mrt2_small profile");
    assert!(profiles.next().is_none());
    assert_eq!(profile.selection.synthesis, "mrt2_small");
    assert_eq!(profile.runtime.executable, "engine/magenta/mrt2-record");
    let capabilities = &profile.capabilities;
    assert!(capabilities.prompt && capabilities.instrumental);
    assert!(!capabilities.lyrics && !capabilities.analysis && !capabilities.advanced);
    assert!(!capabilities.bpm);
    assert_eq!(capabilities.max_variants, 1);
    assert_eq!(capabilities.max_seed, Some(1_000_000_000));
    assert_eq!(
        (capabilities.min_duration, capabilities.max_duration),
        (10, 120)
    );
    assert!(profile
        .platforms
        .iter()
        .all(|platform| platform.os == "macos" && platform.arch == "aarch64"));
    let unsupported = Selection {
        synthesis: "mrt2_base".into(),
        ..profile.selection.clone()
    };
    assert!(catalog.required(&unsupported).is_err());
}

#[test]
fn recommends_magenta_only_when_the_build_contains_its_runtime() {
    let mut catalog = catalog::catalog();
    let profile = catalog
        .profiles
        .iter_mut()
        .find(|profile| profile.selection.provider == PROVIDER)
        .unwrap();
    profile.platforms[0].arch = std::env::consts::ARCH.into();
    let selection = profile.selection.clone();
    let runtime = profile.runtime.clone();
    let hardware = music_generator::hardware::Hardware {
        platform: "macos",
        ram_bytes: profile.platforms[0].minimum_ram_bytes,
        ..music_generator::hardware::inspect().clone()
    };
    let resources = tempfile::tempdir().unwrap();
    let executable = runtime.executable(resources.path());
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::write(executable, []).unwrap();

    assert!(catalog.recommended_profiles(&hardware).contains(&selection));
    assert!(!catalog
        .recommendations_for_build(&hardware, resources.path())
        .contains(&selection));

    for file in &runtime.required_files {
        std::fs::write(resources.path().join(file), []).unwrap();
    }
    assert!(catalog
        .recommendations_for_build(&hardware, resources.path())
        .contains(&selection));
}
