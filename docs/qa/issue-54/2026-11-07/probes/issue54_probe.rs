use music_generator::engine::client::EngineClient;
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    let out = PathBuf::from(env::var("ISSUE54_OUTPUT").unwrap());
    let client = EngineClient::new(
        env::var("ISSUE54_ENGINE").unwrap(),
        env::var("ISSUE54_LM_PROXY").unwrap(),
        0.25,
        10.0,
    )
    .unwrap();
    let params = json!({"caption":"synthwave, retro pop, layered female vocals, analog synths, driving bass, wide reverb", "lyrics":"", "duration":120, "bpm":110, "vocal_language":"en", "lm_temperature":1.2, "seed":12345, "inference_steps":5, "use_cot_caption":true});
    fs::write(
        out.join("params.json"),
        serde_json::to_vec_pretty(&params).unwrap(),
    )
    .unwrap();
    let (audio, extension, metadata) = client
        .generate(
            &params,
            "acestep-5Hz-lm-4B-Q8_0.gguf",
            "acestep-v15-sft-Q8_0.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    fs::write(out.join(format!("song.{extension}")), audio).unwrap();
    fs::write(
        out.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata).unwrap(),
    )
    .unwrap();
    assert_eq!(metadata["lm_attempts"], 2);
    assert_eq!(metadata["lm_retry_seed"], 7);
    assert_eq!(metadata["vocal_language"], "en");
    assert_ne!(metadata["lyrics"], Value::String("[Instrumental]".into()));
    assert_eq!(metadata["effective_inference_steps"], 5);
    println!(
        "Real LM retry and synthesis passed; metadata: {}",
        out.display()
    );
}
