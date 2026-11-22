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
    #[serde(flatten)]
    inference: super::inference::Inference,
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

fn output_roles(
    native: &[&str],
    selected: Option<Vec<String>>,
    vocal_pair: bool,
) -> Result<Vec<String>> {
    if let Some(selected) = selected {
        if vocal_pair {
            return Err(message("Specify outputs or vocals_and_instrumental"));
        }
        return Ok(selected);
    }
    let roles = if vocal_pair {
        &["vocals", "instrumental"][..]
    } else {
        native
    };
    Ok(roles
        .iter()
        .copied()
        .chain(["residual"])
        .map(String::from)
        .collect())
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
        let outputs = output_roles(
            model.profile.roles,
            self.outputs,
            self.vocals_and_instrumental,
        )?;
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
                self.preview.then(|| {
                    let duration = if self.inference.no_split {
                        self.inference.window_frames() as f64 / f64::from(model::RATE)
                    } else {
                        20.0
                    };
                    (self.start + duration).min(source.audio.seconds())
                })
            }),
            quality: self.quality.unwrap_or(Quality::Standard),
            overlap: self.overlap.unwrap_or(0.25),
            inference: self.inference,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_mix_defaults_include_the_difference_and_honor_explicit_selections() {
        for id in ["htdemucs", "htdemucs-6s"] {
            let native = model::get(id).unwrap().roles;
            let defaults = output_roles(native, None, false).unwrap();
            assert_eq!(&defaults[..native.len()], native);
            assert_eq!(&defaults[native.len()..], ["residual"]);
            assert_eq!(
                output_roles(native, None, true).unwrap(),
                ["vocals", "instrumental", "residual"]
            );
            assert_eq!(
                output_roles(native, Some(vec!["vocals".into()]), false).unwrap(),
                ["vocals"]
            );
        }
    }
}
