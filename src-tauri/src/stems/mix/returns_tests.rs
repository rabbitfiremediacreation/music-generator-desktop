use super::*;

type Samples = Vec<(u64, f32, f32)>;

#[derive(Deserialize)]
struct ReturnSettings {
    gain_db: f32,
    fx: ChannelFx,
}

#[derive(Deserialize)]
struct ProcessedReturn {
    settings: ReturnSettings,
    samples: Samples,
}

#[derive(Deserialize)]
struct Reference {
    legacy: [Samples; FX_SLOTS],
    processed: ProcessedReturn,
}

fn write_impulse(source: &Path, frames: u64) {
    let mut audio = Vec::new();
    header(&mut audio, WaveFormat::Float32, frames, RATE, 2).unwrap();
    audio.extend(0.5_f32.to_le_bytes());
    audio.extend(0.25_f32.to_le_bytes());
    audio.resize(audio.len() + (frames as usize - 1) * 8, 0);
    std::fs::write(source, &audio).unwrap();
}

#[test]
fn effect_returns_match_live_stereo_output_and_only_enter_the_mix_export() {
    let reference: Reference = serde_json::from_str(include_str!(
        "../../../../frontend/react/stems/mixer-returns-parity.json"
    ))
    .unwrap();
    let folder = tempfile::tempdir().unwrap();
    let source = folder.path().join("impulse.wav");
    let output = folder.path().join("output.wav");
    let frames = 34000;
    write_impulse(&source, frames);

    let legacy = reference
        .legacy
        .into_iter()
        .enumerate()
        .map(|(slot, samples)| (slot, samples, None));
    let processed = (
        1,
        reference.processed.samples,
        Some(reference.processed.settings),
    );
    for (slot, samples, settings) in legacy.chain(std::iter::once(processed)) {
        let mut track = Track::new("vocals");
        track.gain_db = -6.0;
        track.sends[slot] = 60.0;
        let mut bus_settings = returns::defaults().map(|bus| FxReturn { level: 50.0, ..bus });
        if let Some(settings) = settings {
            bus_settings[slot].gain_db = Some(settings.gain_db);
            bus_settings[slot].fx = Some(settings.fx);
        }
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "tracks": [track], "master_db": 0.0, "first": 0, "end": frames, "looping": false,
            "fx_returns": bus_settings,
        }))
        .unwrap();
        assert!(mix.fx_returns.unwrap().into_iter().all(FxReturn::valid));
        for master in [false, true] {
            Render {
                tracks: &[RenderTrack {
                    path: &source,
                    controls: Some(&mix.tracks[0]),
                }],
                frames,
                first: 0,
                end: frames,
                prefix: 0,
                mix: &mix,
                master,
                format: WaveFormat::Float32,
            }
            .write(&output, &CancellationToken::new(), |_| {})
            .unwrap();
            let mut wave = StereoWave::open(&output, frames).unwrap();
            for &(frame, left, right) in &samples {
                let mut pair = [0; 8];
                wave.seek(frame).unwrap();
                wave.read(&mut pair).unwrap();
                let [left, right] = if master { [left, right] } else { [0.0; 2] };
                assert!(
                    (sample_value(&pair[..4]).unwrap() - left).abs() < 1e-6,
                    "slot {slot}, frame {frame}, left"
                );
                assert!(
                    (sample_value(&pair[4..]).unwrap() - right).abs() < 1e-6,
                    "slot {slot}, frame {frame}, right"
                );
            }
        }
    }
}

#[test]
fn mix_export_handles_return_power_mute_and_solo_without_cutting_sends() {
    let folder = tempfile::tempdir().unwrap();
    let source = folder.path().join("impulse.wav");
    let output = folder.path().join("mix.wav");
    let frames = 17_000;
    write_impulse(&source, frames);
    let mut track = Track::new("vocals");
    track.sends = [0.0, 60.0, 60.0, 0.0];

    for (enabled, mute, solo, solo_track, expected) in [
        (true, false, false, false, [true, true, true]),
        (true, true, false, false, [true, false, true]),
        (false, false, true, false, [true, false, true]),
        (true, false, true, false, [false, true, false]),
        (true, false, true, true, [true, true, false]),
    ] {
        track.solo = solo_track;
        let mut settings = returns::defaults();
        settings[1] = FxReturn {
            enabled,
            mute,
            solo,
            ..settings[1]
        };
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "tracks": [track], "master_db": 0.0, "first": 0, "end": frames, "looping": false,
            "fx_returns": settings,
        }))
        .unwrap();
        Render {
            tracks: &[RenderTrack {
                path: &source,
                controls: Some(&mix.tracks[0]),
            }],
            frames,
            first: 0,
            end: frames,
            prefix: 0,
            mix: &mix,
            master: true,
            format: WaveFormat::Float32,
        }
        .write(&output, &CancellationToken::new(), |_| {})
        .unwrap();
        let mut wave = StereoWave::open(&output, frames).unwrap();
        for (frame, expected) in [0, 15_876, 4410].into_iter().zip(expected) {
            let mut pair = [0; 8];
            wave.seek(frame).unwrap();
            wave.read(&mut pair).unwrap();
            assert_eq!(
                sample_value(&pair[..4]).unwrap() > 0.01, expected,
                "frame {frame}, enabled {enabled}, mute {mute}, solo {solo}, source solo {solo_track}"
            );
        }
    }
}
