use crate::{
    audio_facts::is_reference_wav,
    audio_import::{
        read_selection, read_selection_with_limit, AudioPermissionPrompt, AudioSelection,
    },
    db::Database,
    error::{message, Error, Result},
    state::AppState,
    types::GenerateRequest,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

pub(crate) const MAX_REMIX_BYTES: usize = 120 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ReferenceAudio {
    id: String,
    name: String,
}

pub(crate) fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn resolve(root: &Path, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(message("mulacover_reference_invalid"));
    }
    let path = root.join("reference-audio").join(format!("{id}.wav"));
    if !path.symlink_metadata().is_ok_and(|m| m.is_file()) {
        return Err(message("mulacover_reference_missing"));
    }
    Ok(path)
}

/// Keep a content-addressed local copy for queued jobs and retries.
fn stage(root: &Path, name: String, data: &[u8]) -> Result<ReferenceAudio> {
    if !is_reference_wav(data) {
        return Err(message("mulacover_reference_format"));
    }
    let id = format!("{:x}", Sha256::digest(data));
    let folder = root.join("reference-audio");
    std::fs::create_dir_all(&folder)?;
    if resolve(root, &id).is_err() {
        let mut file = tempfile::NamedTempFile::new_in(&folder)?;
        file.write_all(data)?;
        file.as_file().sync_all()?;
        if let Err(error) = file.persist_noclobber(folder.join(format!("{id}.wav"))) {
            if error.error.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(error.error.into());
            }
        }
        resolve(root, &id)?;
    }
    Ok(ReferenceAudio { id, name })
}

/// Snapshot the source before queueing so that deleting the original cannot break a retry.
pub(crate) fn prepare_remix(db: &Database, request: &mut GenerateRequest) -> Result<()> {
    let remix = request.remix.as_ref().expect("remix options are required");
    let (id, duration) = if let Some(id) = &request.reference_audio {
        let path = resolve(&db.root, id)?;
        (
            id.clone(),
            remix_duration(crate::audio_facts::file_duration(&path)?)?,
        )
    } else {
        let source = remix
            .source_song_id
            .as_deref()
            .ok_or_else(|| message("mulacover_reference_required"))?;
        let song = db.song(source)?;
        let path = song
            .audio_path()
            .filter(|_| song.status == "done")
            .ok_or_else(|| message("mulacover_reference_missing"))?;
        let (audio, duration) = read_remix_source(Path::new(path))?;
        (stage(&db.root, audio.name, &audio.data)?.id, duration)
    };
    request.reference_audio = Some(id);
    request.duration = duration;
    request.ignore_recommended_duration = false;
    Ok(())
}

fn read_remix_source(path: &Path) -> Result<(AudioSelection, f64)> {
    let audio = read_selection_with_limit(path, MAX_REMIX_BYTES).map_err(|error| match error {
        Error::Message(code) if code == "audio_size" => message("remix_source_size"),
        error => error,
    })?;
    let duration = validate_remix_duration(&audio.data)?;
    Ok((audio, duration))
}

fn validate_remix_duration(data: &[u8]) -> Result<f64> {
    remix_duration(
        crate::audio_facts::duration(data).map_err(|_| message("mulacover_reference_format"))?,
    )
}

pub(crate) fn stage_remix_upload(root: &Path, name: String, data: &[u8]) -> Result<ReferenceAudio> {
    validate_remix_duration(data)?;
    stage(root, name, data)
}

fn remix_duration(seconds: f64) -> Result<f64> {
    if seconds > 0.0 && seconds <= 600.0 {
        Ok(seconds)
    } else {
        Err(message("remix_source_duration"))
    }
}

#[tauri::command]
pub async fn pick_reference_audio(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    title: String,
    remix: Option<bool>,
    permission: Option<AudioPermissionPrompt>,
) -> Result<Option<ReferenceAudio>> {
    let root = state.db.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(title)
            .add_filter("WAV", &["wav"]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(chosen) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|_| message("audio_read"))?;
        let audio = if remix.unwrap_or(false) {
            let permission = permission.ok_or_else(|| message("dialog_failed"))?;
            if !permission.allows(&app, &path)? {
                return Ok(None);
            }
            read_remix_source(&path)?.0
        } else {
            read_selection(&path)?
        };
        stage(&root, audio.name, &audio.data).map(Some)
    })
    .await
    .map_err(|_| message("dialog_failed"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav() -> Vec<u8> {
        let mut data = b"RIFF\x28\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0".to_vec();
        data.extend(16000u32.to_le_bytes());
        data.extend(32000u32.to_le_bytes());
        data.extend(b"\x02\0\x10\0data\x04\0\0\0\0\0\x01\0");
        data
    }

    #[test]
    fn stages_one_verified_copy_and_resolves_it_without_its_source_path() {
        let root = tempfile::tempdir().unwrap();
        let first = stage(root.path(), "original.wav".into(), &wav()).unwrap();
        let second = stage(root.path(), "another.wav".into(), &wav()).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(
            std::fs::read(resolve(root.path(), &first.id).unwrap()).unwrap(),
            wav()
        );
        assert_eq!(
            std::fs::read_dir(root.path().join("reference-audio"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn rejects_external_paths_missing_references_and_invalid_wavs() {
        let root = tempfile::tempdir().unwrap();
        assert!(resolve(root.path(), "../external.wav").is_err());
        assert!(resolve(root.path(), &"a".repeat(64)).is_err());
        assert!(stage(root.path(), "wrong.wav".into(), b"RIFF").is_err());
        let mut wrong = wav();
        wrong[20] = 3;
        assert!(stage(root.path(), "float.wav".into(), &wrong).is_err());
    }

    #[test]
    fn dropped_remix_uses_the_same_duration_and_wav_checks_as_native_selection() {
        let root = tempfile::tempdir().unwrap();
        let mut long = wav();
        let bytes = 600 * 16_000 * 2 + 2u32;
        long[4..8].copy_from_slice(&(bytes + 36).to_le_bytes());
        long[40..44].copy_from_slice(&bytes.to_le_bytes());
        long.resize(bytes as usize + 44, 0);
        assert_eq!(
            stage_remix_upload(root.path(), "long.wav".into(), &long)
                .unwrap_err()
                .to_string(),
            "remix_source_duration"
        );
        assert!(!root.path().join("reference-audio").exists());
        let audio = stage_remix_upload(root.path(), "雨.wav".into(), &wav()).unwrap();
        assert_eq!(audio.name, "雨.wav");
        assert_eq!(
            std::fs::read(resolve(root.path(), &audio.id).unwrap()).unwrap(),
            wav()
        );
    }

    #[test]
    fn remix_accepts_a_valid_wav_larger_than_the_standard_reference_limit() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("stereo.wav");
        let bytes = 64 * 1024 * 1024_u32;
        let mut wave = std::fs::File::create(&path).unwrap();
        wave.write_all(b"RIFF").unwrap();
        wave.write_all(&(bytes + 36).to_le_bytes()).unwrap();
        wave.write_all(b"WAVEfmt \x10\0\0\0\x01\0\x02\0").unwrap();
        wave.write_all(&48_000_u32.to_le_bytes()).unwrap();
        wave.write_all(&192_000_u32.to_le_bytes()).unwrap();
        wave.write_all(b"\x04\0\x10\0data").unwrap();
        wave.write_all(&bytes.to_le_bytes()).unwrap();
        wave.set_len(u64::from(bytes) + 44).unwrap();
        drop(wave);
        assert_eq!(read_selection(&path).unwrap_err().to_string(), "audio_size");
        let (_, duration) = read_remix_source(&path).unwrap();
        assert_eq!(duration, f64::from(bytes) / 192_000.0);
    }

    #[test]
    fn queued_remix_keeps_a_copy_and_provenance_after_removing_the_library_source() {
        use crate::types::{RemixMode, RemixOptions};
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let songs = PathBuf::from(db.settings().unwrap().songs_dir);
        std::fs::create_dir_all(&songs).unwrap();
        let input = GenerateRequest {
            prompt: "Original".into(),
            ..Default::default()
        };
        let source = db.enqueue(&input).unwrap().remove(0);
        db.claim_next().unwrap().unwrap();
        let file = songs.join("original.wav");
        std::fs::write(&file, wav()).unwrap();
        assert!(db
            .finish(&source, "original.wav", &serde_json::json!({}))
            .unwrap());

        let ids = db
            .enqueue(&GenerateRequest {
                prompt: "Acoustic arrangement".into(),
                remix: Some(RemixOptions {
                    mode: RemixMode::Cover,
                    source_song_id: Some(source.clone()),
                }),
                ..Default::default()
            })
            .unwrap();
        std::fs::remove_file(file).unwrap();
        let params = db.song(&ids[0]).unwrap().params;
        assert_eq!(params["remix"]["source_song_id"], source);
        assert_eq!(params["duration"], 2.0 / 16000.0);
        let snapshot = resolve(root.path(), params["reference_audio"].as_str().unwrap()).unwrap();
        assert_eq!(std::fs::read(snapshot).unwrap(), wav());
    }
}
