use axum::{
    extract::Query,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use music_generator::engine::client::EngineClient;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[path = "support/wav.rs"]
mod wav;

#[tokio::test]
async fn fixed_seed_repeats_the_first_lm_request_and_wraps_the_retry_seed() {
    assert_seed_requests(0x1_ffff_ffff_i64, Some(0xffff_ffff), 0, true).await;
}

#[tokio::test]
async fn fixed_seed_records_the_first_seed_when_the_retry_loses() {
    assert_seed_requests(12345, Some(12345), 12346, false).await;
}

#[tokio::test]
async fn unresolved_random_seed_leaves_the_first_lm_seed_to_the_engine() {
    assert_seed_requests(-1, None, 701, false).await;
}

async fn assert_seed_requests(
    song_seed: i64,
    initial_lm_seed: Option<u32>,
    retry_lm_seed: u32,
    retry_wins: bool,
) {
    let lm_requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    let synth_requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    let app = Router::new()
        .route(
            "/lm",
            post({
                let requests = lm_requests.clone();
                move |Json(request): Json<Value>| async move {
                    let mut requests = requests.lock().unwrap();
                    let id = if requests.len().is_multiple_of(2) {
                        "first"
                    } else {
                        "retry"
                    };
                    requests.push(request);
                    Json(json!({ "id": id }))
                }
            }),
        )
        .route(
            "/synth",
            post({
                let requests = synth_requests.clone();
                move |Json(request): Json<Value>| async move {
                    requests.lock().unwrap().push(request);
                    Json(json!({ "id": "synth" }))
                }
            }),
        )
        .route(
            "/job",
            get(
                move |Query(query): Query<HashMap<String, String>>| async move {
                    if !query.contains_key("result") {
                        return Json(json!({ "status": "done" })).into_response();
                    }
                    match query["id"].as_str() {
                        // Fixed requests deliberately get no seed echo. The random
                        // request has to use the seed the engine actually chose.
                        "first" if initial_lm_seed.is_some() => {
                            Json(json!({ "audio_codes": "1" })).into_response()
                        }
                        "first" => {
                            Json(json!({ "audio_codes": "1", "lm_seed": 700 })).into_response()
                        }
                        "retry" => {
                            let codes = if retry_wins { "2,3" } else { "2" };
                            Json(json!({ "audio_codes": codes })).into_response()
                        }
                        "synth" => {
                            ([("content-type", "audio/wav")], wav::tone(0.4)).into_response()
                        }
                        id => panic!("unexpected engine job {id}"),
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = EngineClient::new(url.clone(), url, 0.01, 0.1).unwrap();
    let params = json!({ "seed": song_seed, "duration": 10, "lyrics": "[Instrumental]" });
    let expected_seed = if retry_wins {
        retry_lm_seed
    } else {
        initial_lm_seed.unwrap_or(700)
    };
    for _ in 0..2 {
        let (_, _, metadata) = client
            .generate(
                &params,
                "lm.gguf",
                "sft.gguf",
                &CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(metadata["seed"], song_seed);
        assert_eq!(metadata["lm_seed"], expected_seed);
        assert_eq!(metadata["lm_retry_seed"], json!(retry_lm_seed));
    }
    server.abort();
    let lm = lm_requests.lock().unwrap();
    assert_eq!(lm.len(), 4);
    assert_eq!(lm[..2], lm[2..]);
    assert_eq!(
        lm[0].get("lm_seed").cloned(),
        initial_lm_seed.map(Value::from)
    );
    assert_eq!(lm[1]["lm_seed"], json!(retry_lm_seed));
    assert!(lm.iter().all(|request| request["seed"] == song_seed));
    let synth = synth_requests.lock().unwrap();
    assert_eq!(synth.len(), 2);
    assert_eq!(synth[0], synth[1]);
    assert_eq!(synth[0]["seed"], song_seed);
    assert_eq!(synth[0]["lm_seed"], expected_seed);
}
