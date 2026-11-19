use super::*;
use serde_json::json;

#[test]
fn capture_arguments_preserve_requested_frames_prompt_and_seed() {
    let params =
        json!({"caption": " Café rock, heavy percussion ", "duration": 12.345, "seed": 42});
    let capture = Capture::from_params(&params).unwrap();
    let bundle = Path::new("Model folder/magenta-realtime-2");
    assert_eq!(
        capture.arguments(bundle, Path::new("song.wav"), Path::new("report.json")),
        [
            "Model folder/magenta-realtime-2",
            "592560",
            "42",
            "Café rock, heavy percussion",
            "song.wav",
            "report.json"
        ]
    );
}

#[test]
fn capture_rejects_values_outside_the_profile_contract() {
    for (field, value) in [
        ("caption", json!("  ")),
        ("caption", json!("jazz\0 blues")),
        ("duration", json!(9.999)),
        ("duration", json!(120.001)),
        ("seed", json!(-1)),
        ("seed", json!(u64::from(MAX_SEED) + 1)),
    ] {
        let mut params = json!({"caption": "jazz", "duration": 10, "seed": 0});
        params[field] = value;
        assert!(Capture::from_params(&params).is_err(), "{params}");
    }
}

#[test]
fn wav_must_be_48khz_stereo_with_exactly_the_requested_number_of_frames() {
    let capture = Capture {
        prompt: "house",
        frames: 10,
        seed: 0,
    };
    let mut audio = vec![0; 84];
    audio[20..36].copy_from_slice(&[1, 0, 2, 0, 128, 187, 0, 0, 0, 238, 2, 0, 4, 0, 16, 0]);
    audio[36..40].copy_from_slice(b"data");
    audio[40..44].copy_from_slice(&40u32.to_le_bytes());
    capture.check_wav(&audio).unwrap();
    assert!(capture.check_wav(&audio[..80]).is_err());
    audio[40] = 36;
    assert!(capture.check_wav(&audio).is_err());
    audio[40] = 40;
    audio[22] = 1;
    assert!(capture.check_wav(&audio).is_err());
}

#[test]
fn metrics_keep_latency_dropouts_ram_and_realtime_separate() {
    let mut report = json!({
        "first_audio_ms": 690.1,
        "underrun_blocks": 2,
        "peak_rss_bytes": 1_900_000_000u64,
        "capture_seconds": 12.363,
        "realtime": false,
    });
    let parse = |report: &Value| StreamMetrics::read(&serde_json::to_vec(report).unwrap(), 12.345);
    let metrics = parse(&report).unwrap();
    assert_eq!(serde_json::to_value(metrics).unwrap(), report);
    report["realtime"] = json!(true);
    assert!(parse(&report).is_err());
    report["underrun_blocks"] = json!(0);
    report["capture_seconds"] = json!(12.2);
    assert!(parse(&report).is_err());
    assert!(StreamMetrics::read(b"{}", 12.345).is_err());
}

#[tokio::test]
async fn cancelling_before_launch_does_not_start_a_recorder() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    let root = tempfile::tempdir().unwrap();
    let result = generate(
        &root.path().join("missing-recorder"),
        root.path(),
        root.path(),
        &json!({"caption": "house", "duration": 10, "seed": 0}),
        &cancel,
        |_| panic!("A cancelled job must not report progress"),
    )
    .await;
    assert!(matches!(result, Err(Error::Cancelled)));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}
