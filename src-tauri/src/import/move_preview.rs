use super::{destination::target, ImportPreview, MissingAudio};
use crate::{
    db::{safe_song_path, Database},
    error::Result,
};
use std::path::Path;

pub fn preview_move(db: &Database, songs_dir: &str) -> Result<ImportPreview> {
    let source = db.settings()?.songs_dir;
    let files = db.audio_files()?;
    let mut preview = ImportPreview {
        files: files.len(),
        songs_source: source.clone(),
        ..Default::default()
    };
    preview.songs = db
        .lock()
        .query_row("SELECT COUNT(*) FROM songs", [], |r| r.get(0))?;
    for file in &files {
        let path = safe_song_path(Path::new(&source), file)?;
        match std::fs::File::open(&path).and_then(|file| file.metadata()) {
            Ok(meta) if meta.is_file() => preview.bytes = preview.bytes.saturating_add(meta.len()),
            _ => preview.issue("songs_access", path),
        }
    }
    if db.busy()? {
        preview.issue("library_busy", &source);
    }
    target(
        &mut preview,
        Path::new(songs_dir),
        Path::new(&source),
        files.iter().map(String::as_str),
    );
    {
        let con = db.lock();
        let mut stmt =
            con.prepare("SELECT id,COALESCE(title,caption),file FROM songs WHERE audio_missing=1")?;
        preview.missing = stmt
            .query_map([], |r| {
                Ok(MissingAudio {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    file: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
    }
    preview.can_import = preview.issues.is_empty();
    Ok(preview)
}
