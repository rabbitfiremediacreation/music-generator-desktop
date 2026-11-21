use crate::{
    engine::process::OwnedProcess,
    error::{message, Error, Result},
};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

mod formats;
pub use formats::{available, AudioFormat};
mod staging;
pub(crate) use staging::cleanup_stale;
use staging::Staging;

pub fn codec_path(resources: &Path) -> PathBuf {
    resources.join("engine").join(if cfg!(windows) {
        "mp3-codec.exe"
    } else {
        "mp3-codec"
    })
}

/// An omitted format preserves the historical behavior of audio and archive callers.
pub(crate) fn legacy_format(setting: &str) -> AudioFormat {
    match AudioFormat::parse(setting) {
        Ok(AudioFormat::Wav) | Err(_) => AudioFormat::Original,
        Ok(format) => format,
    }
}

fn prefix(sid: &str) -> String {
    format!("{:x}-", Sha256::digest(sid.as_bytes()))
}

pub fn remove_cached(root: &Path, sid: &str) {
    let prefix = prefix(sid);
    if let Ok(files) = std::fs::read_dir(root.join("export")) {
        for file in files.flatten() {
            if file.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(file.path());
            }
        }
    }
}

// Convert a container-local copy; child processes never need external song-folder grants.
pub async fn mp3(
    resources: &Path,
    root: &Path,
    sid: &str,
    source: &Path,
    cancel: &CancellationToken,
) -> Result<PathBuf> {
    let format = if source
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("mp3"))
    {
        AudioFormat::Original
    } else {
        AudioFormat::Mp3
    };
    convert(resources, root, sid, source, format, cancel).await
}

pub async fn convert(
    resources: &Path,
    root: &Path,
    sid: &str,
    source: &Path,
    format: AudioFormat,
    cancel: &CancellationToken,
) -> Result<PathBuf> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let source_ext = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if format == AudioFormat::Original || (format == AudioFormat::Wav && source_ext == "wav") {
        return Ok(source.into());
    }
    let extension = format.extension().expect("original handled above");
    let error_key = if format.bitrate().is_some() {
        "mp3_failed"
    } else {
        "audio_conversion_failed"
    };
    let metadata = source.metadata()?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| message(e.to_string()))?
        .as_nanos();
    let cache = root.join("export");
    std::fs::create_dir_all(&cache)?;
    std::fs::create_dir_all(root.join("logs"))?;
    let label = format
        .bitrate()
        .map_or_else(|| extension.to_owned(), |bitrate| bitrate.to_string());
    let target = cache.join(format!(
        "{}{}-{modified}-{label}.{extension}",
        prefix(sid),
        metadata.len()
    ));
    if nonempty_file(&target) {
        return Ok(target);
    }
    let staging = Staging::new(&cache)?;
    let filename = if !source_ext.is_empty()
        && source_ext.len() < 10
        && source_ext.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        format!("source.{source_ext}")
    } else {
        "source.audio".into()
    };
    let input = staging.path().join(&filename);
    let output = staging.path().join(format!("encoded.{extension}"));
    let (codec, args) = converter(resources, format, &source_ext, &input, &output)
        .ok_or_else(|| message(error_key))?;
    staging.copy_source(source, &filename).await?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let mut process = OwnedProcess::spawn(&codec, &args, false, &root.join("logs/export.log"))
        .map_err(|error| {
            tracing::warn!("Audio converter launch failed: {error}");
            message(error_key)
        })?;
    let wait = async {
        loop {
            if let Some(status) = process.status()? {
                return Ok::<_, crate::error::Error>(status.success());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };
    let success = tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        result = tokio::time::timeout(Duration::from_secs(180), wait) => result.ok().and_then(|r| r.ok()).unwrap_or(false),
    };
    if !success || !nonempty_file(&output) {
        return Err(message(error_key));
    }
    let current = source.metadata()?;
    if current.len() != metadata.len() || current.modified()? != metadata.modified()? {
        return Err(message(error_key));
    }
    if let Err(error) = std::fs::rename(&output, &target) {
        // Another export of the same source and preset may have populated the cache.
        if !nonempty_file(&target) {
            return Err(error.into());
        }
    }
    Ok(target)
}

fn nonempty_file(path: &Path) -> bool {
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

fn converter(
    resources: &Path,
    format: AudioFormat,
    source_ext: &str,
    input: &Path,
    output: &Path,
) -> Option<(PathBuf, Vec<String>)> {
    let input = input.to_string_lossy().into_owned();
    let output = output.to_string_lossy().into_owned();
    let bundled = codec_path(resources);
    if matches!(source_ext, "wav" | "mp3")
        && bundled.is_file()
        && (format.bitrate().is_some() || format == AudioFormat::Wav)
    {
        let mut args = vec!["-i".into(), input, "-o".into(), output];
        if let Some(bitrate) = format.bitrate() {
            args.extend(["-b".into(), bitrate.to_string()]);
        }
        return Some((bundled, args));
    }
    if let Some(codec) = formats::ffmpeg() {
        let encoder = match format {
            AudioFormat::Aac if codec.aac => Some(("aac", "adts", Some("192k".into()))),
            AudioFormat::Ogg if codec.opus => Some(("libopus", "ogg", Some("160k".into()))),
            AudioFormat::Wav if codec.wav => Some(("pcm_s16le", "wav", None)),
            _ if codec.mp3 => format
                .bitrate()
                .map(|bitrate| ("libmp3lame", "mp3", Some(format!("{bitrate}k")))),
            _ => None,
        };
        if let Some((encoder, container, bitrate)) = encoder {
            let mut args: Vec<String> = [
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-protocol_whitelist",
                "file",
                "-i",
            ]
            .map(String::from)
            .into();
            args.push(input);
            args.extend(["-map", "0:a:0", "-c:a", encoder, "-f", container].map(String::from));
            if let Some(bitrate) = bitrate {
                args.extend(["-b:a".into(), bitrate]);
            }
            args.push(output);
            return Some((codec.path.clone(), args));
        }
    }
    let codec = formats::afconvert()?;
    let options = match format {
        AudioFormat::Aac => &["-f", "adts", "-d", "aac", "-b", "192000"][..],
        AudioFormat::Wav => &["-f", "WAVE", "-d", "LEI16"][..],
        _ => return None,
    };
    let mut args: Vec<_> = options.iter().map(|option| (*option).to_owned()).collect();
    args.extend([input, output]);
    Some((codec.into(), args))
}

/// Decode a managed, container-local source for the stem adapter. Input protocols stay local.
pub(crate) async fn decode_float(
    root: &Path,
    input: &Path,
    output: &Path,
    cancel: &CancellationToken,
) -> Result<()> {
    let (program, args) = if let Some(codec) = formats::ffmpeg() {
        let mut args: Vec<_> = [
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-f",
            "mov",
            "-i",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        args.push(input.to_string_lossy().into());
        args.extend(["-map", "0:a:0", "-c:a", "pcm_f32le"].map(str::to_owned));
        (codec.path.as_path(), args)
    } else if let Some(codec) = formats::afconvert() {
        (
            codec,
            vec![
                "-f".into(),
                "WAVE".into(),
                "-d".into(),
                "LEF32".into(),
                input.to_string_lossy().into(),
            ],
        )
    } else {
        return Err(message("stem_source_decode"));
    };
    let mut args = args;
    args.push(output.to_string_lossy().into());
    let logs = root.join("logs");
    std::fs::create_dir_all(&logs)?;
    let log = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(logs.join("stem-separation.log"))?;
    let mut child = tokio::process::Command::new(program)
        .args(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(log)
        .spawn()?;
    let status = tokio::select! {
        _ = cancel.cancelled() => { let _ = child.kill().await; return Err(Error::Cancelled); },
        result = tokio::time::timeout(Duration::from_secs(180), child.wait()) => result,
    };
    if status.is_ok_and(|result| result.is_ok_and(|status| status.success()))
        && nonempty_file(output)
    {
        Ok(())
    } else {
        Err(message("stem_source_decode"))
    }
}
