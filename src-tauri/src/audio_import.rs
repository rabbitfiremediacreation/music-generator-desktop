use crate::error::{message, Result};
use crate::{catalog::Selection, commands::analyze_audio, state::AppState};
use serde_json::Value;
use std::{io::Read, path::Path, sync::Arc};
use tauri::{ipc::Channel, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

pub(crate) const MAX_AUDIO_BYTES: usize = 60 * 1024 * 1024;
pub const AUDIO_EXTENSIONS: &[&str] = &["wav", "mp3", "flac", "m4a", "ogg"];

#[derive(Debug)]
pub struct AudioSelection {
    pub name: String,
    pub directory: String,
    pub data: Vec<u8>,
}

/// Read only the native dialog result; never expose an arbitrary-path reader over IPC.
pub fn read_selection(path: &Path) -> Result<AudioSelection> {
    read_selection_with_limit(path, MAX_AUDIO_BYTES)
}

pub(crate) fn read_selection_with_limit(path: &Path, max_bytes: usize) -> Result<AudioSelection> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(message("audio_type"));
    }
    if !std::fs::metadata(path)
        .map_err(|_| message("audio_read"))?
        .is_file()
    {
        return Err(message("audio_type"));
    }
    let file = std::fs::File::open(path).map_err(|_| message("audio_read"))?;
    let metadata = file.metadata().map_err(|_| message("audio_read"))?;
    if !metadata.is_file() {
        return Err(message("audio_type"));
    }
    if metadata.len() > max_bytes as u64 {
        return Err(message("audio_size"));
    }
    let mut data = Vec::new();
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|_| message("audio_read"))?;
    if data.len() > max_bytes {
        return Err(message("audio_size"));
    }
    Ok(AudioSelection {
        name: path
            .file_name()
            .ok_or_else(|| message("audio_type"))?
            .to_string_lossy()
            .into(),
        directory: path
            .parent()
            .ok_or_else(|| message("audio_read"))?
            .to_string_lossy()
            .into(),
        data,
    })
}

#[derive(serde::Serialize)]
pub struct AudioSelectionInfo {
    name: String,
    directory: String,
}

#[derive(serde::Deserialize)]
pub struct AudioPermissionPrompt {
    title: String,
    question: String,
    accept: String,
    cancel: String,
}

impl AudioPermissionPrompt {
    /// Ask about the selected recording before opening it for processing.
    pub(crate) fn allows(&self, app: &tauri::AppHandle, path: &Path) -> Result<bool> {
        let name = path.file_name().ok_or_else(|| message("audio_type"))?;
        let mut dialog = app
            .dialog()
            .message(format!("{}\n\n{}", name.to_string_lossy(), self.question))
            .title(&self.title)
            .buttons(MessageDialogButtons::OkCancelCustom(
                self.accept.clone(),
                self.cancel.clone(),
            ));
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.parent(&window);
        }
        Ok(dialog.blocking_show())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysisDialog {
    directory: String,
    title: String,
    filter_name: String,
    permission: AudioPermissionPrompt,
}

#[tauri::command]
pub async fn pick_and_analyze_audio(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    dialog: AudioAnalysisDialog,
    selection: Option<Selection>,
    on_selected: Channel<AudioSelectionInfo>,
) -> Result<Option<Value>> {
    let AudioAnalysisDialog {
        directory,
        title,
        filter_name,
        permission,
    } = dialog;
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_directory(directory)
            .set_title(title)
            .add_filter(filter_name, AUDIO_EXTENSIONS);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(selected) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|_| message("audio_read"))?;
        if !permission.allows(&app, &path)? {
            return Ok(None);
        }
        read_selection(&path).map(Some)
    })
    .await
    .map_err(|_| message("dialog_failed"))??;
    let Some(AudioSelection {
        name,
        directory,
        data,
    }) = chosen
    else {
        return Ok(None);
    };
    let _ = on_selected.send(AudioSelectionInfo {
        name: name.clone(),
        directory,
    });
    analyze_audio(&state, data, name, selection).await.map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_selection_reads_supported_audio_and_bounds_memory() {
        let root = tempfile::tempdir().unwrap();
        for extension in ["wav", "MP3", "flac", "m4a", "ogg"] {
            let path = root.path().join(format!("雨.{extension}"));
            std::fs::write(&path, b"RIFF").unwrap();
            let selected = read_selection(&path).unwrap();
            assert_eq!(selected.name, format!("雨.{extension}"));
            assert_eq!(selected.data, b"RIFF");
            assert_eq!(selected.directory, root.path().to_string_lossy());
        }
        let large = root.path().join("large.wav");
        let file = std::fs::File::create(&large).unwrap();
        file.set_len(60 * 1024 * 1024 + 1).unwrap();
        assert_eq!(
            read_selection(&large).unwrap_err().to_string(),
            "audio_size"
        );
        let text = root.path().join("secret.txt");
        std::fs::write(&text, b"text").unwrap();
        assert_eq!(read_selection(&text).unwrap_err().to_string(), "audio_type");
        assert_eq!(
            read_selection(&root.path().join("missing.wav"))
                .unwrap_err()
                .to_string(),
            "audio_read"
        );
    }

    #[cfg(unix)]
    #[test]
    fn native_selection_rejects_a_fifo_without_waiting_for_a_writer() {
        let root = tempfile::tempdir().unwrap();
        let fifo = root.path().join("pipe.wav");
        assert!(std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success());
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(read_selection(&fifo).unwrap_err().to_string());
        });
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_millis(500))
                .expect("native audio reading must not block on a FIFO"),
            "audio_type"
        );
    }
}
