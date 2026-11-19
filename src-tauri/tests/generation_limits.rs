use music_generator::{db::Database, generation_limits::effective_steps, types::GenerateRequest};
use serde_json::json;

#[test]
fn native_vocal_limits_apply_to_lyrics_tags_seeds_and_supported_controls() {
    use music_generator::{catalog::GenerationCapabilities, generation_limits::validate_request};
    let caps = GenerationCapabilities {
        min_duration: 5,
        max_duration: 30,
        max_variants: 1,
        prompt: false,
        lyrics: true,
        lyrics_required: true,
        instrumental: false,
        bpm: false,
        advanced: false,
        analysis: false,
        max_seed: Some(u32::MAX),
        output_kind: Default::default(),
    };
    let request = GenerateRequest {
        style: "folk, mellow".into(),
        lyrics: "[Chorus]\nThe rain runs down the hill".into(),
        instrumental: false,
        duration: f64::from(caps.min_duration),
        seed: i64::from(u32::MAX),
        ..Default::default()
    };
    validate_request(&request, &caps).unwrap();
    for invalid in [
        GenerateRequest {
            duration: f64::from(caps.min_duration) - 0.1,
            ..request.clone()
        },
        GenerateRequest {
            duration: f64::from(caps.max_duration) + 0.1,
            ..request.clone()
        },
        GenerateRequest {
            seed: request.seed + 1,
            ..request.clone()
        },
        GenerateRequest {
            seed: -2,
            ..request.clone()
        },
        GenerateRequest {
            style: ", ,".into(),
            ..request.clone()
        },
        GenerateRequest {
            lyrics: "[Instrumental]".into(),
            ..request.clone()
        },
        GenerateRequest {
            lyrics: "lyrics\0after NUL".into(),
            ..request.clone()
        },
        GenerateRequest {
            lyrics: "ä".repeat(4096),
            ..request.clone()
        },
        GenerateRequest {
            instrumental: true,
            ..request.clone()
        },
        GenerateRequest {
            inference_steps: 8,
            ..request.clone()
        },
        GenerateRequest {
            lm_temperature: Some(0.7),
            ..request.clone()
        },
        GenerateRequest {
            bpm: 95,
            ..request.clone()
        },
        GenerateRequest {
            prompt: "Write a ballad".into(),
            ..request.clone()
        },
        GenerateRequest {
            variants: caps.max_variants + 1,
            ..request.clone()
        },
    ] {
        assert!(validate_request(&invalid, &caps).is_err(), "{invalid:?}");
    }
    let random = GenerateRequest {
        seed: -1,
        duration: f64::from(caps.max_duration),
        ..request
    };
    validate_request(&random, &caps).unwrap();
}

#[test]
fn new_queue_snapshots_use_the_iterations_the_pinned_engine_can_execute() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    for (requested, effective) in [
        (100, 100),
        (101, 101),
        (120, 120),
        (200, 200),
        (0, 50),
        (1, 1),
    ] {
        let request = GenerateRequest {
            title: "Iteration contract".into(),
            prompt: "quiet piano".into(),
            inference_steps: requested,
            ..Default::default()
        };
        let id = db.enqueue(&request).unwrap().remove(0);
        assert_eq!(db.song(&id).unwrap().params["inference_steps"], effective);
        assert_eq!(request.inference_steps, requested);
        let (_, execution) = db.claim_next().unwrap().unwrap();
        assert_eq!(execution["inference_steps"], effective);
        db.fail(&id, "fixture").unwrap();
    }
}

#[test]
fn new_requests_above_two_hundred_are_rejected_without_creating_songs() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    for steps in [201, u32::MAX] {
        assert!(db
            .enqueue(&GenerateRequest {
                prompt: "quiet piano".into(),
                inference_steps: steps,
                ..Default::default()
            })
            .is_err());
    }
    assert!(db.songs(&Default::default()).unwrap().is_empty());
}

#[test]
fn legacy_engine_defaults_follow_the_selected_model_including_hybrid_turbo_models() {
    for synthesis in [
        "acestep-v15-turbo-Q8_0.gguf",
        "acestep-v15-sftturbo50-Q8_0.gguf",
    ] {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let mut settings = db.settings().unwrap();
        settings.synthesis_model = synthesis.into();
        settings.lm_model = "acestep-5Hz-lm-0.6B-Q8_0.gguf".into();
        db.save_settings(&settings).unwrap();
        let id = db
            .enqueue(&GenerateRequest {
                prompt: "quiet piano".into(),
                ..Default::default()
            })
            .unwrap()
            .remove(0);
        assert_eq!(db.song(&id).unwrap().params["inference_steps"], 8);
        assert_eq!(effective_steps(None, synthesis), 8);
        assert_eq!(effective_steps(Some(0), synthesis), 8);
    }
    assert_eq!(effective_steps(None, "acestep-v15-sft-Q8_0.gguf"), 50);
    assert_eq!(effective_steps(Some(0), "acestep-v15-xl-sft-Q8_0.gguf"), 50);
    assert_eq!(effective_steps(Some(100), "sft.gguf"), 100);
    assert_eq!(effective_steps(Some(101), "sft.gguf"), 101);
    assert_eq!(effective_steps(Some(200), "sft.gguf"), 200);
    assert_eq!(effective_steps(Some(u64::MAX), "sft.gguf"), 200);
}

#[test]
fn retry_keeps_historical_requests_while_execution_uses_the_supported_limit() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let id = db
        .enqueue(&GenerateRequest {
            prompt: "legacy piano".into(),
            inference_steps: 80,
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    let mut original = db.song(&id).unwrap().params;
    original["inference_steps"] = json!(120);
    let connection = rusqlite::Connection::open(root.path().join("music.db")).unwrap();
    connection
        .execute(
            "UPDATE songs SET params=?1 WHERE id=?2",
            rusqlite::params![original.to_string(), id],
        )
        .unwrap();
    let (_, queued) = db.claim_next().unwrap().unwrap();
    assert_eq!(queued, original);
    db.fail(&id, "historical fixture").unwrap();
    db.retry(&id).unwrap();
    let (_, retried) = db.claim_next().unwrap().unwrap();
    assert_eq!(retried, original);
    assert_eq!(
        effective_steps(retried["inference_steps"].as_u64(), "sft.gguf"),
        120
    );
    assert_eq!(db.song(&id).unwrap().params, original);
}

#[test]
fn historical_metadata_keeps_the_old_cap_without_explicit_new_runtime_evidence() {
    use music_generator::generation_limits::enrich_metadata;
    let params = json!({"inference_steps": 120});
    for (mut metadata, expected) in [
        (json!({"inference_steps":120}), 100),
        (json!({"effective_inference_steps":100}), 100),
        (json!({"effective_inference_steps":120}), 100),
        (
            json!({"inference_steps":200,"inference_steps_limit":200}),
            200,
        ),
        (
            json!({"effective_inference_steps":200,"inference_steps_limit":200}),
            200,
        ),
    ] {
        let original = params.clone();
        enrich_metadata(&params, &mut metadata);
        assert_eq!(metadata["effective_inference_steps"], expected);
        assert_eq!(params, original);
    }
}
