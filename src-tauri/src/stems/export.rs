use super::{
    file, jobs, managed_dir,
    mix::{self, Mix, Render, RenderTrack, WaveFormat},
};
use crate::{
    audio_export::{self, AudioFormat},
    error::{message, Error, Result},
    state::AppState,
    types::{id, now},
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Instant,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Raw,
    Processed,
    Mix,
    Package,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Request {
    pub project_id: String,
    pub kind: Kind,
    pub mix: Mix,
    #[serde(default)]
    pub selected: Vec<String>,
    pub format: AudioFormat,
    pub wav_format: WaveFormat,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub channels: Option<u16>,
    #[serde(default)]
    pub keep_position: bool,
    #[serde(default)]
    pub include_original: bool,
    #[serde(default)]
    pub include_mix: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Output {
    pub file: String,
    pub peak: Option<f32>,
    pub clipped: bool,
}

#[derive(Serialize)]
pub struct Export {
    pub id: String,
    pub project_id: String,
    pub status: String,
    pub progress: u8,
    pub error: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
    pub outputs: Vec<Output>,
}

pub fn start(state: &AppState, request: Request) -> Result<String> {
    let job = jobs::get(state, &request.project_id)?;
    let project = job.complete()?;
    request.mix.validate(project)?;
    request.mix.validate_track_ids(state, &request.project_id)?;
    export_audio_options(&request, project)?;
    if !audio_export::available(&state.resources).contains(&request.format)
        || request.format == AudioFormat::Original
        || (request.kind == Kind::Package && request.format != AudioFormat::Wav)
    {
        return Err(message("stem_export_format"));
    }
    let selected: std::collections::HashSet<_> = request.selected.iter().collect();
    let selected_stems = matches!(request.kind, Kind::Raw | Kind::Processed)
        || (request.kind == Kind::Package && request.mix.version >= 2);
    if selected_stems
        && ((selected.is_empty()
            && !(request.kind == Kind::Package
                && (request.include_original || request.include_mix)))
            || selected.len() != request.selected.len()
            || selected
                .iter()
                .any(|role| !request.mix.tracks.iter().any(|track| &track.role == *role)))
    {
        return Err(message("stem_export_selection"));
    }
    build_files(state, &job, &request)?;
    package_source(state, &job, &request)?;
    state.runtime.enqueue(|| {
        let id = id();
        state.db.lock().execute(
            "INSERT INTO stem_exports(id,project_id,request,status,created_at) VALUES(?1,?2,?3,'queued',?4)",
            params![id, request.project_id, serde_json::to_string(&request)?, now()],
        )?;
        Ok(id)
    })
}

fn export_audio_options(
    request: &Request,
    project: &jobs::Project,
) -> Result<(u32, u16, WaveFormat)> {
    let sample_rate = request
        .sample_rate
        .unwrap_or(if request.format == AudioFormat::Ogg {
            48_000
        } else {
            project.rate
        });
    let channels = request.channels.unwrap_or(2);
    if !matches!(sample_rate, 44_100 | 48_000)
        || !matches!(channels, 1 | 2)
        || (request.format == AudioFormat::Ogg && sample_rate != 48_000)
    {
        return Err(message("stem_export_format"));
    }
    let format = if request.format == AudioFormat::Wav {
        request.wav_format
    } else {
        WaveFormat::Pcm16
    };
    Ok((sample_rate, channels, format))
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Export> {
    let outputs = row
        .get::<_, Option<String>>(7)?
        .map(crate::db::parse_json)
        .transpose()?
        .unwrap_or_default();
    Ok(Export {
        id: row.get(0)?,
        project_id: row.get(1)?,
        status: row.get(2)?,
        progress: row.get(3)?,
        error: row.get(4)?,
        created_at: row.get(5)?,
        finished_at: row.get(6)?,
        outputs,
    })
}

const SUMMARY: &str = "id,project_id,status,progress,error,created_at,finished_at,result";

pub fn get(state: &AppState, id: &str) -> Result<Export> {
    state
        .db
        .lock()
        .query_row(
            &format!("SELECT {SUMMARY} FROM stem_exports WHERE id=?1"),
            [id],
            read,
        )
        .optional()?
        .ok_or_else(|| message("stem_export_missing"))
}

pub fn list(state: &AppState, project: &str) -> Result<Vec<Export>> {
    let con = state.db.lock();
    let mut statement = con.prepare(&format!(
        "SELECT {SUMMARY} FROM stem_exports WHERE project_id=?1 ORDER BY created_at DESC LIMIT 50"
    ))?;
    let rows = statement.query_map([project], read)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn cancel(state: &AppState, id: &str) -> Result<bool> {
    state.runtime.cancel_song(id, || {
        Ok(state.db.lock().execute(
            "UPDATE stem_exports SET status='cancelled',finished_at=?2 WHERE id=?1 AND status IN ('queued','running')",
            params![id, now()],
        )? == 1)
    })
}

pub fn path(state: &AppState, id: &str, index: usize) -> Result<PathBuf> {
    let export = get(state, id)?;
    let output = export
        .outputs
        .get(index)
        .filter(|_| export.status == "done")
        .ok_or_else(|| message("stem_export_missing"))?;
    file(&managed_dir(&state.db.root, "exports", id)?, &output.file)
}

pub async fn run(state: &AppState, id: &str, cancel: &CancellationToken, notify: impl Fn()) {
    let result = execute(state, id, cancel, &notify).await;
    if let Err(error) = result {
        let (status, message) = match error {
            Error::Cancelled if state.runtime.is_shutdown() => {
                ("error", Some("stem_interrupted".into()))
            }
            Error::Cancelled => ("cancelled", None),
            _ => ("error", Some(error.to_string())),
        };
        let _ = state.db.lock().execute(
            "UPDATE stem_exports SET status=?2,error=?3,finished_at=?4 WHERE id=?1 AND status='running'",
            params![id, status, message, now()],
        );
    }
    notify();
}

async fn execute(
    state: &AppState,
    id: &str,
    cancel: &CancellationToken,
    notify: &impl Fn(),
) -> Result<()> {
    let json: String = state
        .db
        .lock()
        .query_row(
            "SELECT request FROM stem_exports WHERE id=?1 AND status='running'",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(Error::Cancelled)?;
    let request: Request = serde_json::from_str(&json)?;
    let job = jobs::get(state, &request.project_id)?;
    let project = job.complete()?.clone();
    request.mix.validate(&project)?;
    let (sample_rate, channels, sample_format) = export_audio_options(&request, &project)?;
    let convert_settings = sample_rate != project.rate || channels != 2;
    let target = managed_dir(&state.db.root, "exports", id)?;
    let parent = target.parent().expect("export parent");
    std::fs::create_dir_all(parent)?;
    let staging = tempfile::Builder::new()
        .prefix(".export-")
        .tempdir_in(parent)?;
    let files = build_files(state, &job, &request)?;
    let samples = if request.keep_position {
        request.mix.end
    } else {
        request.mix.end - request.mix.first
    };
    let export_frames = super::resample::aligned_frames(samples, sample_rate);
    if export_frames == 0
        || export_frames > u64::from((u32::MAX - 1024) / (u32::from(channels) * 4))
    {
        return Err(message("stem_range"));
    }
    let required = samples.max(export_frames) * 8 * (files.len() as u64 + 2);
    let original = package_source(state, &job, &request)?;
    let original_size = original
        .as_ref()
        .and_then(|path| path.metadata().ok())
        .map_or(0, |m| m.len());
    crate::download::ensure_space(
        parent,
        required.saturating_mul(2).saturating_add(original_size),
    )?;
    let progress = |percent| {
        let _ = state.db.lock().execute(
            "UPDATE stem_exports SET progress=?2 WHERE id=?1 AND status='running'",
            params![id, percent],
        );
        notify();
    };
    let mut outputs = Vec::new();
    let count = files.len();
    let format = request.format;
    for (index, output) in files.into_iter().enumerate() {
        let was_raw = output.inputs.len() == 1 && output.inputs[0].1.is_none();
        let full_raw = was_raw
            && request.mix.first == 0
            && request.mix.end == project.frames
            && sample_format == WaveFormat::Float32
            && format == AudioFormat::Wav
            && !convert_settings;
        let wave = staging.path().join(format!("{}.wav", output.name));
        let work = {
            let project = project.clone();
            let wave = wave.clone();
            let cancel = cancel.clone();
            let mix = request.mix.clone();
            let db = state.db.clone();
            let id = id.to_owned();
            let keep_position = request.keep_position;
            tokio::task::spawn_blocking(move || {
                let mut last = Instant::now();
                if full_raw {
                    let source = &output.inputs[0].0;
                    if let Some(peak) = mix::raw_copy_peak(source, project.frames, &cancel)? {
                        copy(source, &wave, &cancel)?;
                        return Ok((output.name, peak));
                    }
                }
                let tracks: Vec<_> = output
                    .inputs
                    .iter()
                    .map(|(path, track)| RenderTrack {
                        path,
                        controls: track.as_ref(),
                    })
                    .collect();
                let intermediate = wave.with_extension("mix.wav");
                let output_path = if convert_settings {
                    &intermediate
                } else {
                    &wave
                };
                let render = Render {
                    tracks: &tracks,
                    frames: project.frames,
                    first: mix.first,
                    end: mix.end,
                    prefix: if keep_position { mix.first } else { 0 },
                    mix: &mix,
                    master: output.master,
                    format: if convert_settings {
                        WaveFormat::Float32
                    } else {
                        sample_format
                    },
                };
                let peak = render.write(output_path, &cancel, |frames| {
                    if last.elapsed().as_millis() > 200 {
                        let progress =
                            ((index as f64 + frames as f64 / (mix.end - mix.first) as f64) * 90.0
                                / count as f64) as u8;
                        let _ = db.lock().execute(
                            "UPDATE stem_exports SET progress=?2 WHERE id=?1 AND status='running'",
                            params![id, progress],
                        );
                        last = Instant::now();
                    }
                })?;
                let peak = if convert_settings {
                    let peak = super::resample::convert(
                        &intermediate,
                        &wave,
                        samples,
                        sample_rate,
                        channels,
                        sample_format,
                        &cancel,
                    )?;
                    std::fs::remove_file(intermediate)?;
                    peak
                } else {
                    peak
                };
                Ok::<_, Error>((output.name, peak))
            })
        };
        let (name, peak) = work.await.map_err(|_| message("stem_export_failed"))??;
        let name = format!("{name}.{}", format.extension().expect("export format"));
        if format != AudioFormat::Wav {
            let encoded = audio_export::convert(
                &state.resources,
                &state.db.root,
                &format!("{id}:{index}"),
                &wave,
                format,
                cancel,
            )
            .await?;
            tokio::fs::copy(&encoded, staging.path().join(&name)).await?;
            tokio::fs::remove_file(wave).await?;
            audio_export::remove_cached(&state.db.root, &format!("{id}:{index}"));
        }
        outputs.push(Output {
            file: name,
            peak: Some(peak),
            clipped: peak > 1.0 && sample_format != WaveFormat::Float32,
        });
        progress(((index + 1) * 90 / count) as u8);
    }
    if request.kind == Kind::Package {
        let dir = staging.path().to_path_buf();
        let package_cancel = cancel.clone();
        let selected_tracks = request.mix.tracks.iter().enumerate().filter(|(_, track)|
            request.mix.version == 1 || request.selected.contains(&track.role)).map(|(index, track)| json!({
                "id": track.role, "name": track.name, "file": format!("{}.wav", stem_filename(index, track)),
            })).collect::<Vec<_>>();
        let package_manifest = json!({
            "version": 2,
            "source": job.source, "separation": job.request, "project": project,
            "mix": request.mix, "first_frame": request.mix.first, "end_frame": request.mix.end,
            "position_preserved": request.keep_position, "files": outputs,
            "export_rate": sample_rate, "export_channels": channels, "export_frames": export_frames,
            "wav_format": sample_format, "stems": selected_tracks,
            "raw_stems": true, "include_original_source": request.include_original,
        });
        let original_extension = job.source.extension;
        let clipping = outputs.iter().any(|output| output.clipped);
        tokio::task::spawn_blocking(move || {
            package(
                &dir,
                &outputs,
                original.as_deref(),
                &original_extension,
                &package_manifest,
                &package_cancel,
            )
        })
        .await
        .map_err(|_| message("stem_export_failed"))??;
        outputs = vec![Output {
            file: "stems.zip".into(),
            peak: None,
            clipped: clipping,
        }];
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let result = serde_json::to_string(&outputs)?;
    std::fs::rename(staging.path(), &target)?;
    let updated = state.db.lock().execute(
        "UPDATE stem_exports SET status='done',progress=100,result=?2,finished_at=?3 WHERE id=?1 AND status='running'",
        params![id, result, now()],
    );
    if !matches!(updated, Ok(1)) {
        let _ = std::fs::remove_dir_all(target);
    }
    updated?;
    Ok(())
}

struct RenderFile {
    name: String,
    inputs: Vec<(PathBuf, Option<mix::Track>)>,
    master: bool,
}

fn stem_filename(index: usize, track: &mix::Track) -> String {
    format!(
        "{:02}-{}-{}",
        index + 1,
        track.role,
        portable_name(&track.name)
    )
}

fn package_source(state: &AppState, job: &jobs::Job, request: &Request) -> Result<Option<PathBuf>> {
    (request.kind == Kind::Package && request.include_original)
        .then(|| job.source.original(&state.db.root))
        .transpose()
}

fn build_files(state: &AppState, job: &jobs::Job, request: &Request) -> Result<Vec<RenderFile>> {
    let mut files = Vec::new();
    if request.kind != Kind::Mix {
        for (index, track) in request.mix.tracks.iter().enumerate() {
            if (request.kind == Kind::Package && request.mix.version == 1)
                || request.selected.contains(&track.role)
            {
                let name = stem_filename(index, track);
                let asset = if request.kind == Kind::Processed {
                    track.replacement.as_ref().unwrap_or(&track.role)
                } else {
                    &track.role
                };
                files.push(RenderFile {
                    name,
                    master: false,
                    inputs: vec![(
                        super::layer::audio_path(state, job, asset)?,
                        (request.kind == Kind::Processed).then(|| track.clone()),
                    )],
                });
            }
        }
    }
    if request.kind == Kind::Mix || (request.kind == Kind::Package && request.include_mix) {
        let inputs = request
            .mix
            .audible()
            .map(|track| {
                Ok((
                    super::layer::audio_path(
                        state,
                        job,
                        track.replacement.as_ref().unwrap_or(&track.role),
                    )?,
                    Some(track.clone()),
                ))
            })
            .collect::<Result<_>>()?;
        files.push(RenderFile {
            name: "mix".into(),
            inputs,
            master: true,
        });
    }
    Ok(files)
}

pub(crate) fn portable_name(name: &str) -> String {
    let cleaned = crate::exports::clean_name(&name.chars().take(48).collect::<String>());
    let cleaned = cleaned.trim().trim_matches('.');
    if cleaned.is_empty() {
        "track".into()
    } else {
        cleaned.into()
    }
}

fn transfer(from: &Path, to: &mut impl Write, cancel: &CancellationToken) -> Result<()> {
    let mut input = std::fs::File::open(from)?;
    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let length = input.read(&mut buffer)?;
        if length == 0 {
            return Ok(());
        }
        to.write_all(&buffer[..length])?;
    }
}

fn copy(from: &Path, to: &Path, cancel: &CancellationToken) -> Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)?;
    transfer(from, &mut file, cancel)?;
    file.sync_all()?;
    Ok(())
}

fn package(
    dir: &Path,
    outputs: &[Output],
    original: Option<&Path>,
    extension: &str,
    manifest: &serde_json::Value,
    cancel: &CancellationToken,
) -> Result<()> {
    let file = std::fs::File::create(dir.join("stems.zip"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().large_file(true);
    for output in outputs {
        archive
            .start_file(&output.file, options)
            .map_err(|_| message("stem_export_failed"))?;
        transfer(&dir.join(&output.file), &mut archive, cancel)?;
    }
    if let Some(path) = original {
        archive
            .start_file(format!("original-source.{extension}"), options)
            .map_err(|_| message("stem_export_failed"))?;
        transfer(path, &mut archive, cancel)?;
    }
    archive
        .start_file("manifest.json", options)
        .map_err(|_| message("stem_export_failed"))?;
    serde_json::to_writer_pretty(&mut archive, manifest)?;
    archive
        .finish()
        .map_err(|_| message("stem_export_failed"))?
        .sync_all()?;
    for output in outputs {
        std::fs::remove_file(dir.join(&output.file))?;
    }
    Ok(())
}

pub fn save_to(state: &AppState, id: &str, directory: &Path) -> Result<PathBuf> {
    let export = get(state, id)?;
    let job = jobs::get(state, &export.project_id)?;
    if export.status != "done" {
        return Err(message("stem_export_missing"));
    }
    if !super::valid_id(id) {
        return Err(message("stem_invalid_id"));
    }
    let destination = directory.join(format!("{}-{}", portable_name(&job.request.name), &id[..8]));
    match destination.symlink_metadata() {
        Ok(_) => return Err(message("stem_export_exists")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let staging = tempfile::Builder::new()
        .prefix(".stem-export-")
        .tempdir_in(directory)?;
    let cancel = state.runtime.cancellation();
    for (index, output) in export.outputs.iter().enumerate() {
        copy(
            &path(state, id, index)?,
            &staging.path().join(&output.file),
            &cancel,
        )?;
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    std::fs::rename(staging.path(), &destination).map_err(|error| {
        if destination.exists() {
            message("stem_export_exists")
        } else {
            error.into()
        }
    })?;
    state.db.remember_export_directory(directory)?;
    Ok(destination)
}
