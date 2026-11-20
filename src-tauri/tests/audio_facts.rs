use music_generator::audio_facts::{duration, enrich_metadata, record_duration};
use serde_json::json;
#[path = "support/wav.rs"]
mod wav;

#[test]
fn pcm_headers_provide_actual_duration_and_support_padded_metadata_chunks() {
    for seconds in [0.2, 5.6, 10.0, 30.0, 89.2, 600.0] {
        assert_eq!(duration(&wav::tone(seconds)).unwrap(), seconds);
    }
    let mut audio = wav::tone(5.6);
    audio.splice(12..12, *b"JUNK\x03\0\0\0abc\0");
    let size = audio.len() as u32 - 8;
    audio[4..8].copy_from_slice(&size.to_le_bytes());
    assert_eq!(duration(&audio).unwrap(), 5.6);
}

#[test]
fn invalid_containers_formats_and_pcm_frame_lengths_are_rejected() {
    let valid = wav::tone(1.0);
    let mut broken = vec![b"RIFFtest".to_vec(), valid[..valid.len() - 1].to_vec()];
    for (offset, bytes) in [
        (20, vec![3, 0]),
        (24, vec![0, 0, 0, 0]),
        (32, vec![0, 0]),
        (40, vec![255, 255, 255, 127]),
    ] {
        let mut audio = valid.clone();
        audio[offset..offset + bytes.len()].copy_from_slice(&bytes);
        broken.push(audio);
    }
    for audio in broken {
        assert!(duration(&audio).is_err());
    }
}

#[test]
fn historical_metadata_is_measured_without_changing_requests_or_audio_and_cache_tracks_changes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("song.wav");
    let original = wav::tone(5.6);
    std::fs::write(&path, &original).unwrap();
    let params = json!({"duration":10,"caption":"unchanged"});
    let before = params.clone();
    let mut meta = json!({"duration":10,"lyrics":"keep"});
    enrich_metadata(&path, &params, &mut meta).unwrap();
    assert_eq!(meta["duration"], 5.6);
    assert_eq!(meta["requested_duration"], 10.0);
    assert_eq!(meta["lyrics"], "keep");
    assert_eq!(params, before);
    assert_eq!(std::fs::read(&path).unwrap(), original);
    enrich_metadata(&path, &params, &mut meta).unwrap();
    assert_eq!(meta["duration"], 5.6);
    let mut changed = original;
    changed[24..28].copy_from_slice(&500u32.to_le_bytes());
    changed[28..32].copy_from_slice(&1000u32.to_le_bytes());
    std::fs::write(&path, changed).unwrap();
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH))
        .unwrap();
    enrich_metadata(&path, &params, &mut meta).unwrap();
    assert_eq!(meta["duration"], 11.2);
    assert_eq!(meta["duration_warning"]["code"], "long_audio");
    std::fs::write(&path, wav::tone(10.0)).unwrap();
    enrich_metadata(&path, &params, &mut meta).unwrap();
    assert_eq!(meta["duration"], 10.0);
    assert!(meta.get("duration_warning").is_none());
}

#[test]
fn unavailable_audio_never_presents_old_lm_duration_as_measured() {
    let root = tempfile::tempdir().unwrap();
    let mut meta = json!({"duration":85,"lyrics":"keep"});
    assert!(enrich_metadata(
        &root.path().join("missing.wav"),
        &json!({"duration":30}),
        &mut meta
    )
    .is_err());
    assert!(meta.get("duration").is_none());
    assert_eq!(meta["lm_duration"], 85);
    assert_eq!(meta["requested_duration"], 30.0);
    assert_eq!(meta["duration_source"], "unknown");
}

#[test]
fn duration_budgets_allow_early_completion_but_still_measure_the_wav() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("remix.wav");
    std::fs::write(&path, wav::tone(5.6)).unwrap();
    let params = json!({"duration":10});
    let mut meta = json!({"duration_is_limit":true});
    enrich_metadata(&path, &params, &mut meta).unwrap();
    assert_eq!(meta["duration"], 5.6);
    assert_eq!(meta["requested_duration"], 10.0);
    assert!(meta.get("duration_warning").is_none());

    enrich_metadata(&path, &json!({"duration":4}), &mut meta).unwrap();
    assert_eq!(meta["duration_warning"]["code"], "long_audio");
}

#[test]
fn a_song_may_end_before_a_provider_duration_limit() {
    let params = json!({"duration": 30});
    let mut meta = json!({"duration_limit": 30});
    record_duration(24.8, &params, &mut meta);
    assert_eq!(meta["duration"], 24.8);
    assert_eq!(meta["requested_duration"], 30.0);
    assert!(meta.get("duration_warning").is_none());
    record_duration(34.0, &params, &mut meta);
    assert_eq!(meta["duration_warning"]["code"], "long_audio");
}
