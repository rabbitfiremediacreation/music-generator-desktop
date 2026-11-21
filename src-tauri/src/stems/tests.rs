use super::jobs;
#[cfg(unix)]
use super::{engine, export, layer, mix, model, source};
#[cfg(unix)]
use crate::{audio_export::AudioFormat, runtime::OperationKind};
use crate::{db::Database, state::AppState};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use tokio_util::sync::CancellationToken;

mod project_management;

fn state(root: &Path, resources: PathBuf) -> AppState {
    let db = Database::open(root).unwrap();
    let settings = crate::types::Settings {
        setup_complete: true,
        models_dir: root.join("models").to_string_lossy().into(),
        songs_dir: root.join("songs").to_string_lossy().into(),
        ..Default::default()
    };
    db.save_settings(&settings).unwrap();
    let state = AppState::new(db, resources);
    state.restore_setup().unwrap();
    state
}

#[cfg(unix)]
fn synthetic_audio(path: &Path) {
    let frames = 48_000_u32;
    let size = frames * 2;
    let mut wave = Vec::with_capacity(size as usize + 44);
    wave.extend_from_slice(b"RIFF");
    wave.extend_from_slice(&(size + 36).to_le_bytes());
    wave.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0\x01\0");
    wave.extend_from_slice(&frames.to_le_bytes());
    wave.extend_from_slice(&size.to_le_bytes());
    wave.extend_from_slice(b"\x02\0\x10\0data");
    wave.extend_from_slice(&size.to_le_bytes());
    for frame in 0..frames {
        let radians = std::f32::consts::TAU * 440.0 * frame as f32 / frames as f32;
        wave.extend_from_slice(&((radians.sin() * 4096.0).round() as i16).to_le_bytes());
    }
    std::fs::write(path, wave).unwrap();
}

#[cfg(unix)]
fn model_save_dir(root: &Path, artifact: &model::Artifact) -> PathBuf {
    let models = root.join("models");
    let artifact = artifact.pinned();
    std::fs::create_dir_all(artifact.folder(&models)).unwrap();
    artifact.path(&models)
}

#[tokio::test]
#[cfg(unix)]
#[ignore = "requires real pinned model weights and a prepared Python or packaged Demucs runtime"]
async fn offline_separation_mix_and_export_after_restart_and_model_removal() {
    let fixture = PathBuf::from(
        std::env::var_os("MUSIC_STEM_QA").expect("point MUSIC_STEM_QA to fixture files"),
    );
    let runtimes = std::env::var_os("MUSIC_STEM_QA_RESOURCES")
        .map(PathBuf::from)
        .unwrap_or_default();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let source_file = root.join("reference.wav");
    synthetic_audio(&source_file);
    let bytes = std::fs::read(&source_file).unwrap();
    let cancel = CancellationToken::new();
    let profile =
        model::get(&std::env::var("MUSIC_STEM_QA_MODEL").unwrap_or_else(|_| "htdemucs".into()))
            .unwrap();
    let pin = profile.pin();
    let first = state(root, runtimes.clone());
    if !engine::installed(&first) {
        engine::test_runtime(root, &fixture.join("runtime")).unwrap();
    }
    let model_path = model_save_dir(root, &profile.artifact);
    let config_path = model_save_dir(root, &profile.configuration);
    let online = std::env::var_os("MUSIC_STEM_QA_DOWNLOAD").is_some();
    if online {
        use std::io::Read;
        let stable = std::fs::File::open(fixture.join(profile.artifact.file)).unwrap();
        let partial = model_path.with_extension("safetensors.part");
        std::io::copy(
            &mut stable.take(2 * 1024 * 1024),
            &mut std::fs::File::create(partial).unwrap(),
        )
        .unwrap();
    } else {
        std::fs::copy(fixture.join(profile.configuration.file), &config_path).unwrap();
        std::fs::copy(fixture.join(profile.artifact.file), &model_path).unwrap();
    }
    model::install(&first, &pin, &cancel, |_| {})
        .await
        .unwrap_or_else(|error| {
            let log =
                std::fs::read_to_string(root.join("logs/stem-separation.log")).unwrap_or_default();
            panic!("{error}: {log}")
        });
    if online {
        eprintln!("Pinned Hugging Face configuration and checkpoint download verified.");
    }
    let source = source::snapshot(&first, &source_file, "Synthetic reference", None, &cancel)
        .await
        .unwrap();
    let job_id = jobs::enqueue(
        &first,
        jobs::Request {
            source_id: source.id.clone(),
            pin: pin.clone(),
            name: "Reference separation".into(),
            folder_id: None,
            start: 0.15,
            end: Some(0.85),
            quality: if profile.id == "htdemucs-6s" {
                jobs::Quality::Standard
            } else {
                jobs::Quality::Fast
            },
            overlap: 0.25,
            preview: false,
            outputs: profile
                .roles
                .iter()
                .copied()
                .chain(["instrumental"])
                .map(str::to_owned)
                .collect(),
        },
    )
    .unwrap();
    drop(first);

    // Reopen with a durable queued job and run the identical worker path used in the GUI.
    let second = state(root, runtimes.clone());
    assert!(model::catalog(&second)
        .unwrap()
        .models
        .iter()
        .any(|model| model.status == "ready"));
    assert_eq!(
        jobs::list(&second, None, None, Some("none"), 0).unwrap()[0].id,
        job_id
    );
    assert!(model::remove(&second, &pin).is_err());
    let operation = second
        .runtime
        .begin(OperationKind::Generation)
        .await
        .unwrap();
    assert!(
        matches!(second.db.claim_work().unwrap(), Some(jobs::Work::Separate(id)) if id == job_id)
    );
    operation.start_song(&job_id);
    let mut rollback = pin.clone();
    rollback.revision = "99".repeat(20);
    second.db.lock().execute(
        "INSERT INTO stem_models(model,repository,revision,active,installed_at,artifact)
         SELECT model,repository,?4,0,installed_at,artifact FROM stem_models WHERE model=?1 AND repository=?2 AND revision=?3",
        rusqlite::params![pin.model, pin.repository, pin.revision, rollback.revision],
    ).unwrap();
    model::activate(&second, &rollback).unwrap();
    assert_eq!(
        model::catalog(&second)
            .unwrap()
            .models
            .iter()
            .find(|item| item.profile.id == profile.id)
            .unwrap()
            .active
            .as_ref()
            .unwrap()
            .pin,
        rollback
    );
    jobs::run(&second, &job_id, &operation, || {}).await;
    drop(operation);
    let job = jobs::get(&second, &job_id).unwrap();
    assert_eq!(
        job.status,
        "done",
        "{:?} {}",
        job.error,
        std::fs::read_to_string(root.join("logs/stem-separation.log")).unwrap_or_default()
    );
    let project = job.complete().unwrap();
    assert_eq!(
        (
            project.rate,
            project.channels,
            project.frames,
            project.source_start_frame
        ),
        (44_100, 2, 30_870, 7_200)
    );
    assert_eq!(job.request.pin, pin);
    let original_stem = job.audio_path(root, "vocals").unwrap();
    let raw = std::fs::read(&original_stem).unwrap();
    for role in &project.roles {
        mix::verify_wave(
            &job.audio_path(root, role).unwrap(),
            project.frames,
            &cancel,
        )
        .unwrap();
    }
    assert!(
        mix::verify_wave(
            &job.audio_path(root, "original").unwrap(),
            project.frames,
            &cancel,
        )
        .unwrap()
            > 0.1
    );
    assert_eq!(std::fs::read(&source_file).unwrap(), bytes);
    let stopped_id = jobs::enqueue(
        &second,
        jobs::Request {
            name: "Cancelled separation".into(),
            preview: true,
            ..job.request.clone()
        },
    )
    .unwrap();
    let operation = second
        .runtime
        .begin(OperationKind::Generation)
        .await
        .unwrap();
    assert!(
        matches!(second.db.claim_work().unwrap(), Some(jobs::Work::Separate(candidate)) if candidate == stopped_id)
    );
    operation.start_song(&stopped_id);
    jobs::run(&second, &stopped_id, &operation, || {
        if jobs::get(&second, &stopped_id).is_ok_and(|job| job.phase == "separating") {
            jobs::cancel(&second, &stopped_id).unwrap();
        }
    })
    .await;
    let stopped = jobs::get(&second, &stopped_id).unwrap();
    assert_eq!(stopped.status, "cancelled");
    assert!(stopped.project.is_none());
    drop(operation);

    let original = job.audio_path(root, "original").unwrap();
    let imported = layer::import(&second, &job_id, &original, "Additional layer")
        .await
        .unwrap();
    assert!(layer::path(&second, &job_id, &imported.role)
        .unwrap()
        .is_file());
    let original_path = source.original(root).unwrap();
    std::fs::remove_file(&original_path).unwrap();
    assert!(source.original(root).is_err());
    assert!(source::relink(&second, &source.id, &original)
        .await
        .is_err());
    source::relink(&second, &source.id, &source_file)
        .await
        .unwrap();
    assert_eq!(std::fs::read(original_path).unwrap(), bytes);
    assert_eq!(model::removal(&second, &pin).unwrap().bytes, 0);
    model::remove(&second, &pin).unwrap();
    assert!(model_path.is_file() && config_path.is_file());
    model::remove(&second, &rollback).unwrap();
    assert!(!model_path.exists());
    assert!(!config_path.exists());

    let mut mix = mix::Mix::defaults(project);
    for track in &mut mix.tracks {
        track.mute = track.role == "vocals";
        track.solo = matches!(track.role.as_str(), "bass" | "drums");
        if track.role == "bass" {
            track.gain_db = -6.0;
        }
    }
    let mut extra = mix::Track::new(&imported.role);
    extra.name = imported.name;
    mix.tracks.push(extra);
    let version = mix::save(&second, &job_id, None, "Two instruments", mix.clone()).unwrap();
    let request = export::Request {
        project_id: job_id.clone(),
        kind: export::Kind::Raw,
        mix: mix.clone(),
        selected: vec!["vocals".into()],
        format: AudioFormat::Wav,
        wav_format: mix::WaveFormat::Float32,
        sample_rate: None,
        channels: None,
        keep_position: false,
        include_original: false,
        include_mix: false,
    };
    let raw_id = export::start(&second, request.clone()).unwrap();
    let region = mix::Mix {
        first: 100,
        end: 1100,
        looping: true,
        ..mix
    };
    let mix_id = export::start(
        &second,
        export::Request {
            kind: export::Kind::Mix,
            mix: region.clone(),
            keep_position: true,
            ..request.clone()
        },
    )
    .unwrap();
    let package_id = export::start(
        &second,
        export::Request {
            kind: export::Kind::Package,
            mix: region.clone(),
            keep_position: true,
            include_mix: true,
            include_original: true,
            ..request.clone()
        },
    )
    .unwrap();
    let pcm_id = export::start(
        &second,
        export::Request {
            kind: export::Kind::Processed,
            wav_format: mix::WaveFormat::Pcm24,
            sample_rate: Some(48_000),
            channels: Some(1),
            mix: region.clone(),
            ..request.clone()
        },
    )
    .unwrap();
    let mp3_id = if std::env::var_os("MUSIC_STEM_QA_SUPERVISOR").is_some()
        && crate::audio_export::available(&second.resources).contains(&AudioFormat::Mp3)
    {
        Some(
            export::start(
                &second,
                export::Request {
                    kind: export::Kind::Mix,
                    format: AudioFormat::Mp3,
                    ..request.clone()
                },
            )
            .unwrap(),
        )
    } else {
        None
    };
    let mut edited = region.clone();
    edited.master_db = -60.0;
    for track in &mut edited.tracks {
        track.mute = true;
    }
    mix::save(
        &second,
        &job_id,
        Some(&version.id),
        "Updated after export was queued",
        edited,
    )
    .unwrap();
    let cancelled = export::start(&second, request).unwrap();
    assert!(export::cancel(&second, &cancelled).unwrap());
    drop(second);

    let third = state(root, runtimes);
    assert_eq!(mix::versions(&third, &job_id).unwrap()[0].id, version.id);
    for id in [&raw_id, &mix_id, &package_id, &pcm_id]
        .into_iter()
        .chain(mp3_id.iter())
    {
        let operation = third
            .runtime
            .begin(OperationKind::Generation)
            .await
            .unwrap();
        assert!(
            matches!(third.db.claim_work().unwrap(), Some(jobs::Work::Export(candidate)) if candidate == *id)
        );
        operation.start_song(id);
        jobs::run_export(&third, id, &operation, || {}).await;
        assert_eq!(export::get(&third, id).unwrap().status, "done");
    }
    assert_eq!(
        std::fs::read(export::path(&third, &raw_id, 0).unwrap()).unwrap(),
        raw
    );
    assert_eq!(std::fs::read(original_stem).unwrap(), raw);
    let mixed = export::path(&third, &mix_id, 0).unwrap();
    let mut file = std::fs::File::open(&mixed).unwrap();
    let (facts, start) = crate::audio_facts::float_data(&mut file).unwrap();
    assert_eq!(facts.frames, region.end);
    let rendered = std::fs::read(mixed).unwrap();
    assert!(rendered[start as usize..start as usize + 800]
        .iter()
        .all(|byte| *byte == 0));
    let audible: Vec<_> = region
        .audible()
        .map(|track| {
            let path = job.audio_path(root, &track.role).unwrap();
            let bytes = std::fs::read(&path).unwrap();
            let (_, offset) =
                crate::audio_facts::float_data(&mut std::io::Cursor::new(&bytes)).unwrap();
            (bytes, offset as usize, mix::amplitude(track.gain_db))
        })
        .collect();
    for frame in region.first as usize..region.end as usize {
        let expected: f32 = audible
            .iter()
            .map(|(samples, start, gain)| {
                let index = start + frame * 8;
                f32::from_le_bytes(samples[index..index + 4].try_into().unwrap()) * gain
            })
            .sum();
        let offset = start as usize + frame * 8;
        let actual = f32::from_le_bytes(rendered[offset..offset + 4].try_into().unwrap());
        assert!((expected - actual).abs() <= 1e-6);
    }
    let mut packet = zip::ZipArchive::new(
        std::fs::File::open(export::path(&third, &package_id, 0).unwrap()).unwrap(),
    )
    .unwrap();
    let manifest: serde_json::Value =
        serde_json::from_reader(packet.by_name("manifest.json").unwrap()).unwrap();
    assert_eq!(manifest["separation"]["pin"]["revision"], pin.revision);
    assert_eq!(manifest["first_frame"], region.first);
    assert_eq!(manifest["mix"]["version"], 2);
    assert_eq!(manifest["files"].as_array().unwrap().len(), 2);
    assert!(packet.by_name("original-source.wav").is_ok());
    if let Some(mp3_id) = mp3_id {
        eprintln!("MP3 conversion through the existing codec service verified.");
        let mp3 = std::fs::read(export::path(&third, &mp3_id, 0).unwrap()).unwrap();
        assert!(mp3.starts_with(b"ID3") || (mp3[0] == 0xff && mp3[1] & 0xe0 == 0xe0));
    }
    let pcm = std::fs::read(export::path(&third, &pcm_id, 0).unwrap()).unwrap();
    let facts = crate::audio_facts::wav_facts(&pcm).unwrap();
    assert_eq!(
        (
            facts.sample_rate_hz,
            facts.channels,
            facts.bits_per_sample,
            facts.frames
        ),
        (48_000, 1, 24, 1088)
    );
    assert_eq!(export::get(&third, &cancelled).unwrap().status, "cancelled");
    assert!(export::path(&third, &cancelled, 0).is_err());
    eprintln!("Offline CPU separation with {} at 44.1 kHz, {} synchronized stems; raw, mixed and ZIP exports verified after model removal and restart.", profile.name, project.roles.len());
}

#[test]
fn reopens_interrupted_work_and_only_cleans_managed_staging() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let first = state(root, PathBuf::new());
    let directory = root.join("stems/projects");
    let staging = directory.join(".project-test");
    let unknown = directory.join("notes");
    std::fs::create_dir_all(&staging).unwrap();
    std::fs::create_dir_all(&unknown).unwrap();
    first.db.lock().execute_batch(
        "INSERT INTO stem_sources(id,data) VALUES('source','{}');
         INSERT INTO stem_jobs(id,source_id,request,status,phase,created_at) VALUES('job','source','{}','running','separating','2026');",
    ).unwrap();
    drop(first);
    let second = state(root, PathBuf::new());
    let result: (String, String) = second
        .db
        .lock()
        .query_row(
            "SELECT status,error FROM stem_jobs WHERE id='job'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(result, ("error".into(), "stem_interrupted".into()));
    assert!(unknown.is_dir());
    assert!(!staging.exists());
}
