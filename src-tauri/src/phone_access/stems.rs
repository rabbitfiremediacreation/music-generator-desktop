use super::{blocking, failure, stream_file, Remote};
use crate::{
    error::Result,
    stems::{export, jobs, layer, mix, model},
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub(super) fn routes() -> Router<Remote> {
    Router::new()
        .route("/api/stems/models", get(models))
        .route("/api/stems/jobs", get(list).post(start))
        .route("/api/stems/jobs/{id}", get(job))
        .route("/api/stems/jobs/{id}/cancel", post(cancel))
        .route("/api/stems/jobs/{id}/retry", post(retry))
        .route("/api/stems/jobs/{id}/audio/{role}", get(audio))
        .route("/api/stems/jobs/{id}/mixes", get(mixes).post(save_mix))
        .route("/api/stems/jobs/{id}/exports", get(exports))
        .route("/api/stems/exports", post(start_export))
        .route("/api/stems/exports/{id}", get(export_status))
        .route("/api/stems/exports/{id}/cancel", post(cancel_export))
        .route("/api/stems/exports/{id}/files/{index}", get(download))
}

fn respond(data: Result<impl Serialize>) -> Response {
    match data {
        Ok(data) => Json(data).into_response(),
        Err(error) => failure(error),
    }
}

async fn models(State(remote): State<Remote>) -> Response {
    respond(blocking(move || model::catalog(&remote.state)).await)
}

#[derive(Deserialize)]
struct Filter {
    song_id: Option<String>,
    folder_id: Option<String>,
    #[serde(default)]
    offset: u32,
}

async fn list(State(remote): State<Remote>, Query(filter): Query<Filter>) -> Response {
    respond(
        blocking(move || {
            jobs::list(
                &remote.state,
                filter.song_id.as_deref(),
                None,
                filter.folder_id.as_deref(),
                filter.offset,
            )
        })
        .await,
    )
}

async fn start(State(remote): State<Remote>, Json(input): Json<jobs::FromSong>) -> Response {
    respond(jobs::from_song(&remote.state, input).await.map(|id| {
        (remote.changed)();
        json!({ "id": id })
    }))
}

async fn job(State(remote): State<Remote>, Path(id): Path<String>) -> Response {
    respond(blocking(move || jobs::get(&remote.state, &id)).await)
}

async fn cancel(State(remote): State<Remote>, Path(id): Path<String>) -> Response {
    respond(jobs::cancel(&remote.state, &id).map(|cancelled| {
        (remote.changed)();
        json!({ "cancelled": cancelled })
    }))
}

async fn retry(State(remote): State<Remote>, Path(id): Path<String>) -> Response {
    respond(jobs::retry(&remote.state, &id).map(|()| {
        (remote.changed)();
        json!({ "id": id })
    }))
}

async fn audio(
    State(remote): State<Remote>,
    Path((id, role)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let path =
        blocking(move || layer::audio_path(&remote.state, &jobs::get(&remote.state, &id)?, &role))
            .await;
    match path {
        Ok(path) => stream_file(&path, &headers, None).await,
        Err(error) => failure(error),
    }
}

async fn mixes(State(remote): State<Remote>, Path(id): Path<String>) -> Response {
    respond(blocking(move || mix::versions(&remote.state, &id)).await)
}

#[derive(Deserialize)]
struct Save {
    version: Option<String>,
    name: String,
    mix: mix::Mix,
}

async fn save_mix(
    State(remote): State<Remote>,
    Path(id): Path<String>,
    Json(input): Json<Save>,
) -> Response {
    respond(
        blocking(move || {
            mix::save(
                &remote.state,
                &id,
                input.version.as_deref(),
                &input.name,
                input.mix,
            )
        })
        .await,
    )
}

async fn exports(State(remote): State<Remote>, Path(id): Path<String>) -> Response {
    respond(blocking(move || export::list(&remote.state, &id)).await)
}

async fn start_export(
    State(remote): State<Remote>,
    Json(request): Json<export::Request>,
) -> Response {
    respond(
        blocking(move || {
            export::start(&remote.state, request).map(|id| {
                (remote.changed)();
                json!({ "id": id })
            })
        })
        .await,
    )
}

async fn export_status(State(remote): State<Remote>, Path(id): Path<String>) -> Response {
    respond(blocking(move || export::get(&remote.state, &id)).await)
}

async fn cancel_export(State(remote): State<Remote>, Path(id): Path<String>) -> Response {
    respond(export::cancel(&remote.state, &id).map(|cancelled| {
        (remote.changed)();
        json!({ "cancelled": cancelled })
    }))
}

async fn download(
    State(remote): State<Remote>,
    Path((id, index)): Path<(String, usize)>,
    headers: HeaderMap,
) -> Response {
    match blocking(move || export::path(&remote.state, &id, index)).await {
        Ok(path) => {
            stream_file(
                &path,
                &headers,
                path.file_name().and_then(|name| name.to_str()),
            )
            .await
        }
        Err(error) => failure(error),
    }
}
