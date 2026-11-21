use super::{model, source, Quality, Request};
use crate::{
    error::{message, Result},
    state::AppState,
};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
pub struct FromSong {
    song_id: String,
    #[serde(flatten)]
    options: Options,
}

#[derive(Deserialize)]
pub struct Options {
    model_id: String,
    name: Option<String>,
    folder_id: Option<String>,
    #[serde(default)]
    start: f64,
    end: Option<f64>,
    quality: Option<Quality>,
    overlap: Option<f64>,
    outputs: Option<Vec<String>>,
    #[serde(default)]
    vocals_and_instrumental: bool,
    #[serde(default)]
    preview: bool,
}

pub enum Input<'a> {
    Song(&'a str),
    Managed(&'a str),
    File(&'a Path),
}

impl Options {
    /// Resolve the active revision once and keep the source and render settings in the queued request.
    pub async fn request(self, state: &AppState, input: Input<'_>) -> Result<Request> {
        let model = model::catalog(state)?
            .models
            .into_iter()
            .find(|model| model.profile.id == self.model_id)
            .ok_or_else(|| message("stem_model_unknown"))?;
        let pin = model
            .active
            .filter(|_| model.status == "ready")
            .ok_or_else(|| message("stem_model_missing"))?
            .pin;
        let outputs = match (self.outputs, self.vocals_and_instrumental) {
            (Some(_), true) => return Err(message("Specify outputs or vocals_and_instrumental")),
            (Some(roles), false) => roles,
            (None, true) => vec!["vocals".into(), "instrumental".into()],
            (None, false) => model
                .profile
                .roles
                .iter()
                .map(|role| (*role).into())
                .collect(),
        };
        let source = match input {
            Input::Song(id) => source::song(state, id).await?,
            Input::Managed(id) => source::get(state, id)?,
            Input::File(path) => {
                let name = path
                    .file_name()
                    .ok_or_else(|| message("audio_read"))?
                    .to_string_lossy();
                source::snapshot(state, path, &name, None, &state.runtime.cancellation()).await?
            }
        };
        Ok(Request {
            source_id: source.id,
            pin,
            name: self
                .name
                .unwrap_or_else(|| source.name.chars().take(160).collect()),
            folder_id: self.folder_id,
            start: self.start,
            end: self.end.or_else(|| {
                self.preview
                    .then(|| (self.start + 20.0).min(source.audio.seconds()))
            }),
            quality: self.quality.unwrap_or(Quality::Standard),
            overlap: self.overlap.unwrap_or(0.25),
            outputs,
            preview: self.preview,
        })
    }
}

pub async fn from_song(state: &AppState, input: FromSong) -> Result<String> {
    let request = input
        .options
        .request(state, Input::Song(&input.song_id))
        .await?;
    super::enqueue(state, request)
}
