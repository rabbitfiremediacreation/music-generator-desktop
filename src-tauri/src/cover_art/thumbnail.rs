use super::{output_path, SIDE};
use crate::{
    db::Database,
    error::{message, Result},
    state::AppState,
};
use image::{codecs::png::PngDecoder, DynamicImage, ImageDecoder, ImageFormat};
use std::{
    fs::File,
    io::{BufReader, Cursor},
    path::Path,
    sync::Arc,
};
use tauri::{
    http::{Request, Response, StatusCode},
    Manager, UriSchemeContext, UriSchemeResponder,
};

/// Serve two physical pixels per pixel of the library's 64 px artwork tile.
pub(super) fn read(db: &Database, id: &str) -> Result<Vec<u8>> {
    let dir = db.settings()?.songs_dir;
    let recorded = db.lock().query_row(
        "SELECT EXISTS(SELECT 1 FROM songs WHERE id=?1 AND json_type(result_meta,'$.cover_art')='object')",
        [id], |row| row.get(0),
    )?;
    let path =
        output_path(Path::new(&dir), id, recorded).ok_or_else(|| message("Missing cover"))?;
    let file = File::open(path)?;
    if file.metadata()?.len() > super::inference::MAX_PNG_BYTES {
        return Err(message("Oversized cover"));
    }
    let invalid = |error: image::ImageError| message(error.to_string());
    let decoder = PngDecoder::new(BufReader::new(file)).map_err(invalid)?;
    if decoder.dimensions() != (SIDE, SIDE) {
        return Err(message("Invalid cover dimensions"));
    }
    let mut output = Cursor::new(Vec::new());
    DynamicImage::from_decoder(decoder)
        .map_err(invalid)?
        .thumbnail(128, 128)
        .write_to(&mut output, ImageFormat::Png)
        .map_err(invalid)?;
    Ok(output.into_inner())
}

pub(crate) fn handle(
    context: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if context.webview_label() != "main" {
        responder.respond(
            Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Vec::new())
                .unwrap(),
        );
        return;
    }
    let db = context
        .app_handle()
        .try_state::<Arc<AppState>>()
        .map(|state| state.db.clone());
    let id = request.uri().path().trim_start_matches('/').to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let response = match db.and_then(|db| read(&db, &id).ok()) {
            Some(bytes) => Response::builder()
                .header("Content-Type", "image/png")
                .header("Cache-Control", "private, max-age=86400")
                .body(bytes),
            None => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Vec::new()),
        };
        responder.respond(response.expect("static thumbnail headers"));
    });
}
