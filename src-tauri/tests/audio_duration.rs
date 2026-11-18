use axum::{
    extract::Query,
    http::header::CONTENT_TYPE,
    routing::{get, post},
    Json, Router,
};
use music_generator::{db::Database, engine::client::EngineClient, phone_access::PhoneGeneration};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
};
use tokio_util::sync::CancellationToken;
#[path = "support/wav.rs"]
mod wav;

struct Script {
    counts: Vec<usize>,
    lm: Mutex<Vec<Value>>,
    synth: Mutex<Vec<Value>>,
    options: Options,
    retry_polled: AtomicBool,
    cancelled: AtomicU32,
}

#[derive(Default)]
struct Options {
    silent_first_take: bool,
    pending_retry: bool,
    retry_error: bool,
    malformed_audio: bool,
    retry_post_delay_ms: u64,
    synthesis_limit: Option<u32>,
    synthesis_steps: Option<u32>,
    truncate_multipart: bool,
}

async fn server(counts: Vec<usize>) -> (EngineClient, Arc<Script>, tokio::task::JoinHandle<()>) {
    server_with(counts, Options::default()).await
}

async fn server_with(
    counts: Vec<usize>,
    options: Options,
) -> (EngineClient, Arc<Script>, tokio::task::JoinHandle<()>) {
    let script = Arc::new(Script {
        counts,
        lm: Mutex::new(Vec::new()),
        synth: Mutex::new(Vec::new()),
        options,
        retry_polled: AtomicBool::new(false),
        cancelled: AtomicU32::new(0),
    });
    let lm = script.clone();
    let synth = script.clone();
    let jobs = script.clone();
    let cancels = script.clone();
    let app = Router::new()
        .route(
            "/lm",
            post(move |Json(request): Json<Value>| {
                let script = lm.clone();
                async move {
                    let (id, retry) = {
                        let mut requests = script.lm.lock().unwrap();
                        let id = format!("lm-{}", requests.len());
                        requests.push(request);
                        (id, requests.len() == 2)
                    };
                    if retry && script.options.retry_post_delay_ms > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            script.options.retry_post_delay_ms,
                        ))
                        .await;
                    }
                    let failed = script.options.retry_error && retry;
                    (
                        if failed {
                            axum::http::StatusCode::BAD_GATEWAY
                        } else {
                            axum::http::StatusCode::OK
                        },
                        Json(json!({"id":id})),
                    )
                }
            }),
        )
        .route(
            "/synth",
            post(move |Json(request): Json<Value>| {
                let script = synth.clone();
                async move {
                    script.synth.lock().unwrap().push(request);
                    Json(json!({"id":"synth"}))
                }
            }),
        )
        .route(
            "/job",
            get(move |Query(query): Query<HashMap<String, String>>| {
                let script = jobs.clone();
                async move {
                    if script.options.pending_retry
                        && query["id"] == "lm-1"
                        && !query.contains_key("result")
                    {
                        script.retry_polled.store(true, Ordering::SeqCst);
                        return (
                            [(CONTENT_TYPE, "application/json")],
                            serde_json::to_vec(&json!({"status":"running"})).unwrap(),
                        );
                    }
                    if !query.contains_key("result") {
                        return (
                            [(CONTENT_TYPE, "application/json")],
                            serde_json::to_vec(&json!({"status":"done"})).unwrap(),
                        );
                    }
                    if let Some(index) = query["id"].strip_prefix("lm-") {
                        let index: usize = index.parse().unwrap();
                        let count = script.counts[index.min(script.counts.len() - 1)];
                        let request = script.lm.lock().unwrap()[index].clone();
                        let mut result = json!({
                            "audio_codes":vec!["7";count].join(","), "duration":10,
                            "lm_seed":request["lm_seed"].as_u64().unwrap_or(4122037654),
                            "inference_steps":999,"seed":999,
                            "effective_inference_steps":200,"inference_steps_limit":200
                        });
                        if script.options.silent_first_take {
                            result["lyrics"] = if index == 0 {
                                json!("[Instrumental]")
                            } else {
                                json!("[Verse]\nThe city wakes")
                            };
                        }
                        return (
                            [(CONTENT_TYPE, "application/json")],
                            serde_json::to_vec(&result).unwrap(),
                        );
                    }
                    let request = script.synth.lock().unwrap().last().unwrap().clone();
                    let codes = request["audio_codes"].as_str().unwrap().split(',').count();
                    let audio = if script.options.malformed_audio {
                            b"RIFFtest".to_vec()
                        } else {
                            wav::tone(codes as f64 / 5.0)
                        };
                    if let Some(limit) = script.options.synthesis_limit {
                        let metadata = json!([{"inference_steps_limit":limit,"effective_inference_steps":script.options.synthesis_steps}]);
                        let mut body = format!("--result\r\nContent-Type: application/json\r\n\r\n{metadata}\r\n--result\r\nContent-Type: audio/wav\r\n\r\n").into_bytes();
                        body.extend(audio);
                        if !script.options.truncate_multipart {
                            body.extend(b"\r\n--result--\r\n");
                        }
                        ([(CONTENT_TYPE, "multipart/mixed; boundary=result")], body)
                    } else {
                        ([(CONTENT_TYPE, "audio/wav")], audio)
                    }
                }
            })
            .post(move || {
                let script = cancels.clone();
                async move {
                    script.cancelled.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"ok":true}))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (
        EngineClient::new(base.clone(), base, 0.01, 1.0).unwrap(),
        script,
        task,
    )
}

fn phone_params(instrumental: bool) -> Value {
    let phone: PhoneGeneration = serde_json::from_value(json!({
        "prompt": "quiet piano", "duration": 10, "lyrics": "", "instrumental": instrumental
    }))
    .unwrap();
    let directory = tempfile::tempdir().unwrap();
    let db = Database::open(directory.path()).unwrap();
    db.enqueue(&phone.request("phone".into()).unwrap()).unwrap();
    db.claim_next().unwrap().unwrap().1
}

#[tokio::test]
async fn full_length_instrumental_answer_retries_only_the_phone_vocal_request() {
    for (instrumental, attempts, expected_lyrics) in [
        (false, 2, "[Verse]\nThe city wakes"),
        (true, 1, "[Instrumental]"),
    ] {
        let (client, script, task) = server_with(
            vec![50, 49],
            Options {
                silent_first_take: true,
                ..Default::default()
            },
        )
        .await;
        let (_, _, meta) = client
            .generate(
                &phone_params(instrumental),
                "lm.gguf",
                "sft.gguf",
                &CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
        task.abort();
        let lm = script.lm.lock().unwrap();
        assert_eq!(lm.len(), attempts, "instrumental={instrumental}");
        assert!(lm
            .iter()
            .all(|request| request.get("vocal_language").is_none()));
        if instrumental {
            assert_eq!(lm[0]["lyrics"], "[Instrumental]");
        } else {
            assert!(lm.iter().all(|request| request.get("lyrics").is_none()));
        }
        assert_eq!(meta["lm_attempts"], attempts);
        let synth = script.synth.lock().unwrap();
        assert_eq!(synth.len(), 1);
        assert_eq!(synth[0]["lyrics"], expected_lyrics);
    }
}

#[tokio::test]
async fn synthesis_rejects_complete_wav_in_unterminated_multipart() {
    let (client, _, task) = server_with(
        vec![50],
        Options {
            synthesis_limit: Some(200),
            synthesis_steps: Some(200),
            truncate_multipart: true,
            ..Default::default()
        },
    )
    .await;
    let error = client
        .generate(
            &json!({"duration": 10}),
            "lm.gguf",
            "synth.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("Incomplete multipart engine response"));
    task.abort();
}

#[tokio::test]
async fn actual_wav_duration_replaces_the_lm_claim_without_rewriting_the_request() {
    let (client, _script, task) = server(vec![28]).await;
    let params = json!({"duration":10,"seed":1955703464,"caption":"music box and cello","inference_steps":30});
    let original = params.clone();
    let (audio, extension, meta) = client
        .generate(
            &params,
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    task.abort();
    assert_eq!(audio, wav::tone(5.6));
    assert_eq!(extension, "wav");
    assert_eq!(meta["duration"], 5.6);
    assert_eq!(meta["requested_duration"], 10.0);
    assert_eq!(meta["duration_warning"]["code"], "short_audio");
    assert_eq!(params, original);
}

#[tokio::test]
async fn only_actual_synthesis_result_evidence_can_confirm_two_hundred_iterations() {
    for (limit, actual, expected) in [
        (Some(200), Some(200), 200),
        (Some(200), Some(120), 120),
        (None, None, 100),
    ] {
        let (client, script, task) = server_with(
            vec![50],
            Options {
                synthesis_limit: limit,
                synthesis_steps: actual,
                ..Default::default()
            },
        )
        .await;
        let (_, _, meta) = client
            .generate(
                &json!({"duration":10,"inference_steps":200,"inference_steps_limit":200}),
                "lm.gguf",
                "sft.gguf",
                &CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
        task.abort();
        assert_eq!(meta["effective_inference_steps"], expected);
        assert_eq!(meta["inference_steps"], expected);
        assert_eq!(
            meta.get("inference_steps_limit").and_then(Value::as_u64),
            limit.map(u64::from)
        );
        let request = &script.synth.lock().unwrap()[0];
        assert_eq!(request["inference_steps"], 200);
        assert!(request.get("inference_steps_limit").is_none());
        assert!(request.get("effective_inference_steps").is_none());
    }
}

#[tokio::test]
async fn an_incomplete_new_synthesis_contract_cannot_be_saved_as_a_verified_result() {
    let (client, _script, task) = server_with(
        vec![50],
        Options {
            synthesis_limit: Some(200),
            synthesis_steps: None,
            ..Default::default()
        },
    )
    .await;
    let result = client
        .generate(
            &json!({"duration":10,"inference_steps":200}),
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await;
    task.abort();
    assert!(result.unwrap_err().to_string().contains("did not confirm"));
}

#[tokio::test]
async fn lm_shortfall_gets_one_distinct_seed_retry_before_a_single_synthesis() {
    let (client, script, task) = server(vec![28, 50]).await;
    let params = json!({"duration":10,"seed":1955703464,"caption":"music box and cello","inference_steps":30});
    let (_, _, meta) = client
        .generate(
            &params,
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    task.abort();
    assert_eq!(meta["duration"], 10.0);
    assert_eq!(meta["lm_attempts"], 2);
    assert!(meta.get("duration_warning").is_none());
    let requests = script.lm.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["lm_seed"], 1955703464u64);
    assert_eq!(requests[1]["lm_seed"], 1955703465u64);
    assert_eq!(requests[0]["caption"], requests[1]["caption"]);
    assert_eq!(requests[0]["duration"], requests[1]["duration"]);
    assert_eq!(meta["lm_seed"], requests[1]["lm_seed"]);
    assert_eq!(script.synth.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn retry_limit_keeps_the_longer_audio_and_never_changes_music_seed_or_effective_steps() {
    let (client, script, task) = server(vec![28, 20, 50]).await;
    let params = json!({"duration":10,"seed":42,"inference_steps":120});
    let (_, _, meta) = client
        .generate(
            &params,
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    task.abort();
    assert_eq!(script.lm.lock().unwrap().len(), 2);
    let synth = script.synth.lock().unwrap();
    assert_eq!(synth.len(), 1);
    assert_eq!(synth[0]["seed"], 42);
    assert_eq!(synth[0]["inference_steps"], 120);
    assert_eq!(script.lm.lock().unwrap()[0]["inference_steps"], 120);
    assert_eq!(meta["effective_inference_steps"], 100);
    assert_eq!(meta["inference_steps"], 100);
    assert_eq!(meta["duration"], 5.6);
    assert_eq!(meta["lm_seed"], 42);
    assert_eq!(meta["lm_retry_seed"], 43);
    assert_eq!(params["inference_steps"], 120);
}

#[tokio::test]
async fn overproduction_is_capped_and_normal_duration_rounding_does_not_retry() {
    for (requested, codes, actual) in [(30.0, 425, 30.0), (10.0, 48, 9.6), (90.0, 446, 89.2)] {
        let (client, script, task) = server(vec![codes]).await;
        let (_, _, meta) = client
            .generate(
                &json!({"duration":requested}),
                "lm.gguf",
                "sft.gguf",
                &CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
        task.abort();
        assert_eq!(script.lm.lock().unwrap().len(), 1);
        assert_eq!(meta["duration"], actual);
        assert!(meta.get("duration_warning").is_none());
    }
}

#[tokio::test]
async fn empty_lm_codes_retry_once_then_fail_clearly_if_both_attempts_are_empty() {
    for second in [0, 50] {
        let (client, script, task) = server(vec![0, second]).await;
        let result = client
            .generate(
                &json!({"duration":10}),
                "lm.gguf",
                "sft.gguf",
                &CancellationToken::new(),
                |_| {},
            )
            .await;
        task.abort();
        assert_eq!(script.lm.lock().unwrap().len(), 2);
        if second == 0 {
            assert!(result.unwrap_err().to_string().contains("no audio codes"));
            assert!(script.synth.lock().unwrap().is_empty());
        } else {
            assert_eq!(result.unwrap().2["duration"], 10.0);
        }
    }
}

#[tokio::test]
async fn failed_optional_retry_preserves_the_original_audio_with_an_honest_warning() {
    let (client, script, task) = server_with(
        vec![28, 50],
        Options {
            retry_error: true,
            ..Default::default()
        },
    )
    .await;
    let (_, _, meta) = client
        .generate(
            &json!({"duration":10}),
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    task.abort();
    assert_eq!(script.lm.lock().unwrap().len(), 2);
    assert_eq!(script.synth.lock().unwrap().len(), 1);
    assert_eq!(meta["duration"], 5.6);
    assert_eq!(meta["duration_warning"]["code"], "short_audio");
    assert!(meta["lm_retry_error"].as_str().unwrap().contains("502"));
}

#[tokio::test]
async fn cancellation_during_the_retry_cancels_that_job_and_never_synthesizes() {
    let (client, script, task) = server_with(
        vec![50, 49],
        Options {
            silent_first_take: true,
            pending_retry: true,
            ..Default::default()
        },
    )
    .await;
    let token = CancellationToken::new();
    let signal = token.clone();
    let generation = tokio::spawn(async move {
        client
            .generate(&phone_params(false), "lm.gguf", "sft.gguf", &token, |_| {})
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !script.retry_polled.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    signal.cancel();
    assert!(matches!(
        generation.await.unwrap(),
        Err(music_generator::error::Error::Cancelled)
    ));
    task.abort();
    assert_eq!(script.lm.lock().unwrap().len(), 2);
    assert_eq!(script.cancelled.load(Ordering::SeqCst), 1);
    assert!(script.synth.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_audio_is_rejected_instead_of_becoming_a_finished_song() {
    let (client, script, task) = server_with(
        vec![50],
        Options {
            malformed_audio: true,
            ..Default::default()
        },
    )
    .await;
    let result = client
        .generate(
            &json!({"duration":10}),
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await;
    task.abort();
    assert!(result.unwrap_err().to_string().contains("invalid WAV"));
    assert_eq!(script.synth.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn optional_retry_respects_remaining_lm_time_and_cancels_its_timed_out_job() {
    let (mut client, script, task) = server_with(
        vec![50, 49],
        Options {
            silent_first_take: true,
            pending_retry: true,
            ..Default::default()
        },
    )
    .await;
    client.timeout = std::time::Duration::from_millis(300);
    let (_, _, meta) = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        client.generate(
            &phone_params(false),
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        ),
    )
    .await
    .unwrap()
    .unwrap();
    task.abort();
    assert_eq!(meta["duration"], 10.0);
    assert_eq!(meta["lyrics"], "[Instrumental]");
    assert_eq!(script.lm.lock().unwrap().len(), 2);
    assert!(meta["lm_retry_error"]
        .as_str()
        .unwrap()
        .contains("Timeout after"));
    assert_eq!(script.cancelled.load(Ordering::SeqCst), 1);
    assert_eq!(script.synth.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn optional_retry_budget_includes_waiting_for_the_job_id() {
    let (mut client, script, task) = server_with(
        vec![28, 50],
        Options {
            retry_post_delay_ms: 200,
            ..Default::default()
        },
    )
    .await;
    client.timeout = std::time::Duration::from_millis(80);
    let (_, _, meta) = client
        .generate(
            &json!({"duration":10}),
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    task.abort();
    assert_eq!(meta["duration"], 5.6);
    assert!(meta["lm_retry_error"]
        .as_str()
        .unwrap()
        .contains("Timeout after"));
    assert_eq!(script.synth.lock().unwrap().len(), 1);
}
