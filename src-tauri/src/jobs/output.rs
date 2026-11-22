use crate::{
    audio_export::tags,
    error::{message, Error, Result},
};
use std::path::Path;
use tokio_util::sync::CancellationToken;

pub(super) async fn save(
    dir: &Path,
    sid: &str,
    extension: &str,
    bytes: Vec<u8>,
    cancel: &CancellationToken,
    provenance: Option<&str>,
) -> Result<String> {
    tokio::fs::create_dir_all(dir).await?;
    let filename = format!("{sid}.{extension}");
    let temp = dir.join(format!("{sid}.part"));
    let result = async {
        tokio::fs::write(&temp, bytes).await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if let Some(provenance) = provenance.filter(|_| tags::supports(extension)) {
            let (temp, extension, provenance) =
                (temp.clone(), extension.to_owned(), provenance.to_owned());
            tokio::task::spawn_blocking(move || tags::write(&temp, &extension, &provenance))
                .await
                .map_err(|error| message(error.to_string()))??;
        }
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        tokio::fs::rename(&temp, dir.join(&filename)).await?;
        Ok(filename)
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(temp).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{audio_provenance, catalog::Selection};
    use serde_json::json;

    #[tokio::test]
    async fn saved_audio_carries_the_song_provenance_in_a_wav_info_chunk() {
        let dir = tempfile::tempdir().unwrap();
        let pcm = b"RIFF\x26\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x40\x1f\0\0\x80\x3e\0\0\x02\0\x10\0data\x02\0\0\0\x01\0";
        let mut metadata = json!({});
        audio_provenance::capture(
            &mut metadata,
            &Selection {
                provider: "mulacover".into(),
                synthesis: "mulacover-noncommercial".into(),
                language: String::new(),
            },
            &json!({"reference_audio": "fixture"}),
        );
        let comment = audio_provenance::comment(&metadata).unwrap();
        let saved = save(
            dir.path(),
            "song",
            "wav",
            pcm.to_vec(),
            &CancellationToken::new(),
            Some(&comment),
        )
        .await
        .unwrap();

        let copy = dir.path().join("copied.wav");
        std::fs::copy(dir.path().join(saved), &copy).unwrap();
        let bytes = std::fs::read(copy).unwrap();
        let info = bytes
            .windows(8)
            .position(|window| window == b"INFOICMT")
            .unwrap();
        let size = u32::from_le_bytes(bytes[info + 8..info + 12].try_into().unwrap()) as usize;
        let embedded = std::str::from_utf8(&bytes[info + 12..info + 11 + size]).unwrap();
        assert!(embedded.contains("Music model: MuLaCover"));
        assert!(embedded.contains("Commercial use requires written permission from MuLa Labs."));
        assert!(embedded.contains("Source: https://huggingface.co/HeartMuLa/MuLaCover/blob/0f5ca612a41134738a14a28f95ed80bfa9b52adc/MODEL_LICENSE"));
        assert!(embedded.contains("Reference audio: Check rights to the recording"));
        assert!(bytes.windows(10).any(|chunk| chunk == &pcm[36..]));
    }
}
