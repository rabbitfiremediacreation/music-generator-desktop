use crate::error::{message, Result};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
    time::Duration,
};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioFormat {
    Wav,
    Mp3_128,
    Mp3,
    Mp3_320,
    Aac,
    Ogg,
    Original,
}

impl AudioFormat {
    pub const ALL: [Self; 7] = [
        Self::Wav,
        Self::Mp3_128,
        Self::Mp3,
        Self::Mp3_320,
        Self::Aac,
        Self::Ogg,
        Self::Original,
    ];

    pub fn parse(value: &str) -> Result<Self> {
        serde_json::from_value(value.into()).map_err(|_| message("Unknown export format"))
    }

    pub fn extension(self) -> Option<&'static str> {
        match self {
            Self::Wav => Some("wav"),
            Self::Aac => Some("aac"),
            Self::Ogg => Some("ogg"),
            Self::Original => None,
            _ => Some("mp3"),
        }
    }

    pub(super) fn bitrate(self) -> Option<u32> {
        match self {
            Self::Mp3_128 => Some(128),
            Self::Mp3 => Some(192),
            Self::Mp3_320 => Some(320),
            _ => None,
        }
    }
}

pub(super) struct Ffmpeg {
    pub(super) path: PathBuf,
    pub(super) mp3: bool,
    pub(super) aac: bool,
    pub(super) opus: bool,
    pub(super) wav: bool,
}

pub(super) fn ffmpeg() -> Option<&'static Ffmpeg> {
    static CODECS: OnceLock<Option<Ffmpeg>> = OnceLock::new();
    CODECS
        .get_or_init(|| {
            let from_path = std::env::var_os("PATH")
                .into_iter()
                .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>());
            let fallback = if cfg!(target_os = "macos") {
                &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"][..]
            } else {
                &[]
            };
            from_path
                .chain(fallback.iter().map(PathBuf::from))
                .filter(|path| path.is_absolute())
                .find_map(|dir| {
                    let path = dir.join(if cfg!(windows) {
                        "ffmpeg.exe"
                    } else {
                        "ffmpeg"
                    });
                    if !path.is_file() {
                        return None;
                    }
                    let output = crate::process_output::output(
                        Command::new(&path).args(["-hide_banner", "-encoders"]),
                        Duration::from_secs(1),
                    )?;
                    let has = |name| {
                        output
                            .lines()
                            .any(|line| line.split_whitespace().nth(1) == Some(name))
                    };
                    Some(Ffmpeg {
                        path,
                        mp3: has("libmp3lame"),
                        aac: has("aac"),
                        opus: has("libopus"),
                        wav: has("pcm_s16le"),
                    })
                })
        })
        .as_ref()
}

pub(super) fn afconvert() -> Option<&'static Path> {
    let path = Path::new("/usr/bin/afconvert");
    (cfg!(target_os = "macos") && path.is_file()).then_some(path)
}

pub fn available(resources: &Path) -> Vec<AudioFormat> {
    let ffmpeg = ffmpeg();
    let mp3 = super::codec_path(resources).is_file() || ffmpeg.is_some_and(|codec| codec.mp3);
    AudioFormat::ALL
        .into_iter()
        .filter(|format| match format {
            AudioFormat::Wav | AudioFormat::Original => true,
            AudioFormat::Aac => afconvert().is_some() || ffmpeg.is_some_and(|codec| codec.aac),
            AudioFormat::Ogg => ffmpeg.is_some_and(|codec| codec.opus),
            _ => mp3,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::AudioFormat;

    #[test]
    fn mp3_presets_have_distinct_keys_and_bitrates() {
        for (key, bitrate) in [("mp3_128", 128), ("mp3", 192), ("mp3_320", 320)] {
            let format = AudioFormat::parse(key).unwrap();
            assert_eq!(format.extension(), Some("mp3"));
            assert_eq!(format.bitrate(), Some(bitrate));
            assert_eq!(serde_json::to_value(format).unwrap(), key);
        }
    }
}
