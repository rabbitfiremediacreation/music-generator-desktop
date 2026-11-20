//! Translate a queued MiniMax Music 3 song into one offline audio.cpp invocation.
use super::{native::WavJob, progress::Progress};
use crate::{
    audio_facts,
    error::{message, Result},
};
use serde_json::{json, Value};
use std::{borrow::Cow, path::Path};
use tokio_util::sync::CancellationToken;

struct Request<'a> {
    caption: &'a str,
    lyrics: &'a str,
    duration: f64,
    seed: u32,
}

impl<'a> Request<'a> {
    fn from_params(params: &'a Value) -> Result<Self> {
        Ok(Self {
            caption: text(params, "caption")?,
            lyrics: text(params, "lyrics")?,
            duration: audio_facts::requested_duration(params)
                .ok_or_else(|| message("MiniMax-Music3 requires a positive duration"))?,
            seed: params["seed"]
                .as_u64()
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| message("MiniMax-Music3 requires a nonnegative 32-bit seed"))?,
        })
    }

    fn arguments(&self, model: &Path, backend: &str, output: &Path) -> Vec<String> {
        // audio.cpp scans all argument tokens for flags, including text argument values.
        let caption = if self.caption.starts_with("--") {
            Cow::Owned(format!(" {}", self.caption))
        } else {
            Cow::Borrowed(self.caption)
        };
        [
            "--task",
            "gen",
            "--family",
            "minimax_music3",
            "--mode",
            "offline",
            "--model",
            &model.to_string_lossy(),
            "--backend",
            backend,
            "--session-option",
            "minimax_music3.language_model_gguf=language_model_q4_0.gguf",
            "--session-option",
            "minimax_music3.rvq_depth_decoder_gguf=rvq_depth_decoder_q8_0.gguf",
            "--session-option",
            "minimax_music3.flow_transformer_gguf=transformer_q4_0.gguf",
            "--text",
            &caption,
            "--request-option",
            &format!("lyrics={}", self.lyrics),
            "--request-option",
            &format!("duration_sec={}", self.duration),
            "--request-option",
            &format!("seed={}", self.seed),
            "--out-format",
            "pcm16",
            "--out",
            &output.to_string_lossy(),
            "--metrics",
        ]
        .map(str::to_owned)
        .into()
    }
}

fn text<'a>(params: &'a Value, field: &str) -> Result<&'a str> {
    params[field]
        .as_str()
        .filter(|value| !value.trim().is_empty() && !value.contains('\0'))
        .ok_or_else(|| message(format!("MiniMax-Music3 requires valid {field} text")))
}

pub(crate) async fn generate(
    job: &WavJob<'_>,
    params: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(Progress),
) -> Result<(Vec<u8>, String, Value)> {
    let request = Request::from_params(params)?;
    let (audio, extension, mut meta) = job
        .run(params, cancel, progress, |output| {
            request.arguments(job.model_folder, job.backend, output)
        })
        .await?;
    meta["lyrics"] = json!(request.lyrics);
    meta["machine_generated"] = json!(true);
    meta["generated_by"] = json!("MiniMax-Music3");
    Ok((audio, extension, meta))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_the_complete_caption_and_lyrics_in_separate_arguments() {
        let caption = "Global Metadata: Synth-Pop, 110 BPM\nVocal Details: warm\nArrangement: keys";
        let lyrics = "[Verse]\nLichter glänzen = überm Meer\n[Chorus]\n--out bleibt Songtext";
        let params = json!({"caption": caption, "lyrics": lyrics, "duration": 27.5, "seed": 0});
        let request = Request::from_params(&params).unwrap();
        assert_eq!(
            request.arguments(
                Path::new("models with spaces"),
                "cuda",
                Path::new("song.wav")
            ),
            [
                "--task",
                "gen",
                "--family",
                "minimax_music3",
                "--mode",
                "offline",
                "--model",
                "models with spaces",
                "--backend",
                "cuda",
                "--session-option",
                "minimax_music3.language_model_gguf=language_model_q4_0.gguf",
                "--session-option",
                "minimax_music3.rvq_depth_decoder_gguf=rvq_depth_decoder_q8_0.gguf",
                "--session-option",
                "minimax_music3.flow_transformer_gguf=transformer_q4_0.gguf",
                "--text",
                caption,
                "--request-option",
                &format!("lyrics={lyrics}"),
                "--request-option",
                "duration_sec=27.5",
                "--request-option",
                "seed=0",
                "--out-format",
                "pcm16",
                "--out",
                "song.wav",
                "--metrics",
            ]
        );
    }

    #[test]
    fn rejects_job_inputs_the_cli_cannot_represent() {
        let params = json!({"caption": "Music", "lyrics": "[Verse]\nNight", "duration": 20, "seed": u32::MAX});
        assert!(Request::from_params(&params).is_ok());
        for (field, value) in [
            ("caption", json!("  ")),
            ("caption", json!("Music\0")),
            ("lyrics", json!(null)),
            ("lyrics", json!("Night\0")),
            ("duration", json!(0)),
            ("seed", json!(-1)),
            ("seed", json!(u64::from(u32::MAX) + 1)),
        ] {
            let mut invalid = params.clone();
            invalid[field] = value;
            assert!(
                Request::from_params(&invalid).is_err(),
                "{field}: {invalid}"
            );
        }
    }

    #[test]
    fn caption_cannot_be_interpreted_as_a_cli_flag() {
        let params =
            json!({"caption": "--help", "lyrics": "[Verse]\nNight", "duration": 20, "seed": 1});
        let arguments = Request::from_params(&params).unwrap().arguments(
            Path::new("model"),
            "cuda",
            Path::new("song.wav"),
        );
        assert!(!arguments.iter().any(|arg| arg == "--help"));
        assert!(arguments
            .windows(2)
            .any(|args| args == ["--text", " --help"]));
    }

    #[tokio::test]
    async fn a_cancelled_job_never_starts_the_runtime() {
        let data = tempfile::tempdir().unwrap();
        let job = WavJob {
            executable: &data.path().join("missing-runtime"),
            model_folder: &data.path().join("model"),
            data_root: data.path(),
            log_name: "generation.log",
            backend: "cuda",
            timeout: std::time::Duration::from_secs(60),
        };
        let params =
            json!({"caption": "Music", "lyrics": "[Verse]\nNight", "duration": 20, "seed": 1});
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(matches!(
            generate(&job, &params, &cancel, |_| panic!(
                "cancelled job reported progress"
            ))
            .await,
            Err(crate::error::Error::Cancelled)
        ));
        assert!(data.path().read_dir().unwrap().next().is_none());
    }

    #[test]
    #[ignore = "requires a local audio.cpp executable and the verified MiniMax GGUF package"]
    fn generates_and_exports_a_real_wav() {
        use crate::{catalog, db::Database, types::GenerateRequest};
        use std::{env, fs, path::PathBuf, process::Command, time::Instant};

        let executable = PathBuf::from(env::var_os("MINIMAX_TEST_EXECUTABLE").unwrap());
        let models = PathBuf::from(env::var_os("MINIMAX_TEST_MODELS_DIR").unwrap());
        let backend = env::var("MINIMAX_TEST_BACKEND").unwrap();
        let output = PathBuf::from(env::var_os("MINIMAX_TEST_OUTPUT").unwrap());
        let duration =
            env::var("MINIMAX_TEST_DURATION").map_or(20.0, |value| value.parse::<f64>().unwrap());
        let lyrics = env::var_os("MINIMAX_TEST_LYRICS_FILE").map_or_else(
            || "[Verse]\nThe city lights reflect along the bay\nThe trains have gone but we are here to stay\n[Chorus]\nWait for the morning, wait for the tide\nCarry the little light home tonight".into(),
            |path| fs::read_to_string(path).unwrap(),
        );
        let lyrics_output = output.with_extension("lyrics.txt");
        assert!(
            !output.exists() && !lyrics_output.exists(),
            "Choose a new output path"
        );
        let data = tempfile::tempdir().unwrap();
        let db = Database::open(data.path()).unwrap();
        let catalog = catalog::catalog();
        let selection = catalog
            .profiles
            .iter()
            .find(|profile| profile.selection.provider == "minimax-music3")
            .unwrap()
            .selection
            .clone();
        let profile = catalog::generation_profile(&selection).unwrap();
        let request = GenerateRequest {
            model_selection: Some(selection),
            title: "Wait for the Tide".into(),
            caption: "Global Metadata: melodic indie folk, steady 86 BPM\nVocal Details: clear lead, close-miked\nArrangement: acoustic guitar, light drums, rising electric piano in the chorus".into(),
            lyrics,
            instrumental: false,
            duration,
            seed: 41,
            ..Default::default()
        };
        let id = db
            .enqueue_with_profile(&request, Some(&profile))
            .unwrap()
            .remove(0);
        let (claimed, params) = db.claim_next().unwrap().unwrap();
        assert_eq!(id, claimed);
        let wav_file = format!("{id}.wav");
        let songs = PathBuf::from(db.settings().unwrap().songs_dir);
        fs::create_dir_all(&songs).unwrap();
        let wav_path = songs.join(&wav_file);
        let mut arguments = Request::from_params(&params).unwrap().arguments(
            &models.join("MiniMax-Music3-GGUF"),
            &backend,
            &wav_path,
        );
        arguments.push("--log".into());
        let started = Instant::now();
        let status = Command::new(&executable)
            .current_dir(executable.parent().unwrap())
            .args(arguments)
            .status()
            .unwrap();
        assert!(status.success(), "audio.cpp exited with {status}");
        let runtime_seconds = started.elapsed().as_secs_f64();
        let audio = fs::read(&wav_path).unwrap();
        let wav = audio_facts::wav_facts(&audio).unwrap();
        eprintln!(
            "{backend} runtime={runtime_seconds:.3}s, requested={duration}s, actual={:.3}s, {} Hz, {} channels, {}-bit PCM, {} bytes",
            wav.duration_seconds, wav.sample_rate_hz, wav.channels,
            wav.bits_per_sample, audio.len(),
        );
        let mut metadata = json!({"lyrics": params["lyrics"], "seed": params["seed"]});
        audio_facts::record_duration(wav.duration_seconds, &params, &mut metadata);
        assert!(db
            .finish_with_engine(&id, &wav_file, &metadata, &profile.provider)
            .unwrap());
        let saved = db.song(&id).unwrap();
        assert_eq!(saved.seed, request.seed);
        assert_eq!(saved.result_meta.unwrap()["duration"], wav.duration_seconds);
        db.export_audio(&id, &output).unwrap();
        db.export_lyrics(&id, &lyrics_output).unwrap();
        assert_eq!(fs::read(&output).unwrap(), audio);
        assert_eq!(
            fs::read_to_string(&lyrics_output).unwrap(),
            request.lyrics.trim()
        );
    }
}
