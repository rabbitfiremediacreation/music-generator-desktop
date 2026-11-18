//! Display fields for the bundled PWA. Native clients use the existing songs API.
use super::{blocking, failure, flag, Remote};
use crate::{
    audio_facts::file_duration,
    db::{safe_song_path, Database},
    error::Result,
};
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Default, Deserialize)]
#[serde(default)]
pub(super) struct Filter {
    q: String,
    folder: String,
    favorites: Option<String>,
}

#[derive(Serialize)]
struct Library {
    songs: Vec<SongCard>,
    folders: Value,
}

#[derive(Serialize)]
struct SongCard {
    id: String,
    title: String,
    status: String,
    message: Option<String>,
    favorite: bool,
    folder_id: Option<String>,
    duration: Option<f64>,
    bpm: Option<f64>,
    has_audio: bool,
}

fn number(json: Option<String>) -> Option<f64> {
    match serde_json::from_str(&json?).ok()? {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite())
}

fn song_cards(db: &Database, filter: &Filter) -> Result<Vec<SongCard>> {
    let songs_dir = db.settings()?.songs_dir;
    let rows = {
        let con = db.lock();
        // Keep the search and folder semantics of the phone API, including orphaned folders.
        let mut stmt = con.prepare_cached(
            "SELECT id, COALESCE(NULLIF(title, ''), NULLIF(caption, ''), 'Song') AS display_title,
                    status, CASE WHEN status='error' THEN message END AS error_message,
                    favorite, folder_id, file, audio_missing,
                    params -> 'duration' AS requested_duration, result_meta -> 'bpm' AS bpm
             FROM songs
             WHERE (?1='' OR title LIKE ?2 OR caption LIKE ?2 OR lyrics LIKE ?2)
               AND (?3=0 OR favorite=1)
               AND (?4='' OR folder_id=?4 OR
                    (?4='none' AND (folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders))))
             ORDER BY created_at DESC, rowid DESC LIMIT 500",
        )?;
        let rows = stmt.query_map(
            params![
                filter.q,
                format!("%{}%", filter.q),
                flag(filter.favorites.as_ref()),
                filter.folder
            ],
            |row| {
                Ok((
                    SongCard {
                        id: row.get("id")?,
                        title: row.get("display_title")?,
                        message: row.get("error_message")?,
                        status: row.get("status")?,
                        favorite: row.get("favorite")?,
                        folder_id: row.get("folder_id")?,
                        duration: number(row.get("requested_duration")?),
                        bpm: number(row.get("bpm")?),
                        has_audio: false,
                    },
                    row.get::<_, Option<String>>("file")?,
                    row.get::<_, bool>("audio_missing")?,
                ))
            },
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(rows
        .into_iter()
        .map(|(mut card, file, audio_missing)| {
            if card.status == "done" && !audio_missing {
                if let Some(path) =
                    file.and_then(|file| safe_song_path(Path::new(&songs_dir), &file).ok())
                {
                    card.has_audio = true;
                    // As in the detail API, prefer the measured WAV length for historical songs.
                    card.duration = file_duration(&path).ok().or(card.duration);
                }
            }
            card
        })
        .collect())
}

pub(super) async fn get(
    State(remote): State<Remote>,
    Query(filter): Query<Filter>,
    headers: HeaderMap,
) -> Response {
    let db = remote.state.db.clone();
    let body = match blocking(move || {
        Ok(serde_json::to_vec(&Library {
            songs: song_cards(&db, &filter)?,
            folders: db.folders()?,
        })?)
    })
    .await
    {
        Ok(body) => body,
        Err(error) => return failure(error),
    };
    let etag = format!("\"{:x}\"", Sha256::digest(&body));
    let unchanged = headers
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| {
            let mut quoted = false;
            value.split(move |character| {
                if character == '"' {
                    quoted = !quoted;
                }
                character == ',' && !quoted
            })
        })
        .map(str::trim)
        .any(|value| value == "*" || value.strip_prefix("W/").unwrap_or(value) == etag);
    let response = Response::builder()
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::ETAG, etag);
    if unchanged {
        response
            .status(StatusCode::NOT_MODIFIED)
            .body(Body::empty())
    } else {
        response
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
    }
    .expect("valid library response")
}
