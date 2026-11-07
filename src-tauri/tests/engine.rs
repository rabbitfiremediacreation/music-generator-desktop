use axum::{
    extract::Query,
    http::header::CONTENT_TYPE,
    routing::{get, post},
    Json, Router,
};
use music_generator::engine::client::{
    extract_audio, extract_json, limit_audio_codes, selftest_ok, EngineClient,
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;
#[path = "support/wav.rs"]
mod wav;

fn multipart() -> Vec<u8> {
    let mut body = b"--song\r\nContent-Type: application/json\r\n\r\n{\"caption\":\"test\"}\r\n--song\r\nContent-Type: audio/wav\r\n\r\n".to_vec();
    body.extend(wav::tone(1.0));
    body.extend(b"\r\n--song--\r\n");
    body
}

#[test]
fn multipart_preserves_binary_audio_and_extracts_metadata() {
    let ctype = "multipart/mixed; boundary=\"song\"";
    assert_eq!(
        extract_json(ctype, &multipart()).unwrap()["caption"],
        "test"
    );
    assert_eq!(
        extract_audio(ctype, &multipart()).unwrap(),
        (wav::tone(1.0), "wav".into())
    );
    assert!(extract_audio("application/json", b"{}").is_err());
    assert!(extract_json("application/json", b"[]").is_err());
}

#[test]
fn gpu_selftest_rejects_empty_and_repetitive_codes() {
    let codes = (0..50).map(|n| n.to_string()).collect::<Vec<_>>().join(",");
    assert!(selftest_ok(
        &json!({"audio_codes":codes,"bpm":37,"keyscale":"C major"})
    ));
    assert!(!selftest_ok(
        &json!({"audio_codes":"","bpm":90,"keyscale":"C major"})
    ));
    assert!(!selftest_ok(
        &json!({"audio_codes":vec!["1";50].join(","),"bpm":90,"keyscale":"C major"})
    ));
}

#[tokio::test]
async fn analysis_multipart_contains_selected_model_names_and_original_audio() {
    let app = Router::new()
        .route(
            "/understand",
            post(
                |headers: axum::http::HeaderMap, body: axum::body::Bytes| async move {
                    assert!(headers[CONTENT_TYPE]
                        .to_str()
                        .unwrap()
                        .starts_with("multipart/form-data; boundary="));
                    let text = String::from_utf8_lossy(&body);
                    assert!(text.contains("name=\"request\""));
                    assert!(text.contains("\"lm_model\":\"acestep-5Hz-lm-4B-Q6_K.gguf\""));
                    assert!(text.contains("\"synth_model\":\"acestep-v15-turbo-Q5_K_M.gguf\""));
                    assert!(body.windows(7).any(|bytes| bytes == b"RIFF\x00\xff\x01"));
                    Json(json!({"id":"analysis"}))
                },
            ),
        )
        .route(
            "/job",
            get(
                |Query(query): Query<std::collections::HashMap<String, String>>| async move {
                    Json(if query.contains_key("result") {
                        json!({"caption":"piano"})
                    } else {
                        json!({"status":"done"})
                    })
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let models = music_generator::catalog::Selection {
        provider: "ace-step".into(),
        synthesis: "acestep-v15-turbo-Q5_K_M.gguf".into(),
        language: "acestep-5Hz-lm-4B-Q6_K.gguf".into(),
    };
    let client = EngineClient::new(base.clone(), base, 0.01, 1.0).unwrap();
    let result = client
        .analyze(
            b"RIFF\x00\xff\x01".to_vec(),
            "idea.wav".into(),
            &models,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result["caption"], "piano");
    task.abort();
}

#[test]
fn codes_obey_requested_duration_and_the_ten_minute_ceiling() {
    for (duration, lm_duration, expected) in [
        (10.0, 600.0, 50),
        (90.0, 600.0, 450),
        (600.0, 605.0, 3000),
        (900.0, 900.0, 3000),
        (0.0, 90.0, 450),
        (0.0, 0.0, 3000),
    ] {
        let params = json!({"duration":duration,"inference_steps":50,"lm_temperature":1.0});
        let original = params.clone();
        let mut enriched = json!({"audio_codes":vec!["7";3020].join(","),"duration":lm_duration});
        limit_audio_codes(&mut enriched, &params);
        assert_eq!(
            enriched["audio_codes"].as_str().unwrap().split(',').count(),
            expected
        );
        assert_eq!(params, original);
        assert_eq!(enriched["duration"], lm_duration);
    }
    let mut short = json!({"audio_codes":"1, 2,,3,","duration":600});
    let original = short.clone();
    limit_audio_codes(&mut short, &json!({}));
    assert_eq!(short, original);
}

#[tokio::test]
async fn generation_trims_lm_overproduction_before_synthesis() {
    let codes = (0..3020)
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let app = Router::new()
        .route("/lm", post(|| async { Json(json!({"id":"lm"})) }))
        .route(
            "/synth",
            post(|Json(request): Json<Value>| async move {
                let codes: Vec<_> = request["audio_codes"]
                    .as_str()
                    .unwrap()
                    .split(',')
                    .collect();
                assert_eq!(codes.len(), 3000);
                assert_eq!(codes[2999], "2999");
                assert_eq!(request["duration"].as_f64(), Some(600.0));
                Json(json!({"id":"synth"}))
            }),
        )
        .route(
            "/job",
            get(
                move |Query(query): Query<std::collections::HashMap<String, String>>| {
                    let codes = codes.clone();
                    async move {
                        if !query.contains_key("result") {
                            return (
                                [(CONTENT_TYPE, "application/json")],
                                serde_json::to_vec(&json!({"status":"done"})).unwrap(),
                            );
                        }
                        if query["id"] == "lm" {
                            (
                                [(CONTENT_TYPE, "application/json")],
                                serde_json::to_vec(&json!({"audio_codes":codes,"duration":600}))
                                    .unwrap(),
                            )
                        } else {
                            ([(CONTENT_TYPE, "audio/wav")], wav::tone(600.0))
                        }
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let params = json!({"duration":600,"inference_steps":50,"lm_temperature":1.0});
    let original = params.clone();
    let client = EngineClient::new(base.clone(), base, 0.01, 1.0).unwrap();
    assert!(client
        .generate(
            &params,
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {}
        )
        .await
        .is_ok());
    assert_eq!(params, original);
    task.abort();
}

#[tokio::test]
async fn synthesis_errors_use_new_logs_for_failed_jobs_http_and_missing_audio() {
    use std::io::Write;
    for mode in ["job", "http", "audio", "stale", "timeout"] {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("ace-server.log");
        std::fs::write(&log, "old: out of memory\n").unwrap();
        let output = log.clone();
        let app = Router::new()
            .route("/lm",post(|| async { Json(json!({"id":"lm"})) }))
            .route("/synth",post(move || {
                let output = output.clone();
                async move {
                    if mode != "stale" {
                        writeln!(std::fs::OpenOptions::new().append(true).open(output).unwrap(),"failed to allocate").unwrap();
                    }
                    (if mode == "http" {axum::http::StatusCode::INTERNAL_SERVER_ERROR} else {axum::http::StatusCode::OK}, Json(json!({"id":"synth"})))
                }
            }))
            .route("/job",get(move |Query(query): Query<std::collections::HashMap<String,String>>| async move {
                if !query.contains_key("result") {
                    Json(json!({"status":if query["id"]=="synth" && mode=="timeout" {"running"}else if query["id"]=="synth" && mode!="audio" {"failed"}else{"done"}}))
                }else if query["id"]=="lm" {
                    Json(json!({"audio_codes":"1,2,3"}))
                }else {Json(json!({"error":"empty audio"}))}
            }).post(|| async {Json(json!({"ok":true}))}));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut client = EngineClient::new(base.clone(), base, 0.01, 1.0).unwrap();
        client.synth_log = Some(log);
        if mode == "timeout" {
            client.timeout = Duration::from_millis(80);
        }
        let failure = client
            .generate(
                &json!({}),
                "lm.gguf",
                "sft.gguf",
                &CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap_err();
        let error = failure.to_string();
        if mode == "timeout" {
            assert!(matches!(
                failure,
                music_generator::error::Error::EngineTimeout { .. }
            ));
            assert!(error.contains("Raise the timeout in the settings"));
        }
        assert_eq!(
            error.contains("Not enough memory"),
            mode != "stale" && mode != "timeout",
            "{mode}: {error}"
        );
        task.abort();
    }
}

#[tokio::test]
async fn generation_chains_lm_and_synthesis_and_preserves_parameters() {
    let app = Router::new()
        .route(
            "/lm",
            post(|Json(request): Json<Value>| async move {
                assert_eq!(request["lm_model"], "test.gguf");
                assert_eq!(request["caption"], "piano");
                assert_eq!(request["peak_clip"], 0);
                assert!(request.get("variants").is_none());
                Json(json!({"id":"lm"}))
            }),
        )
        .route(
            "/synth",
            post(|Json(request): Json<Value>| async move {
                assert_eq!(request["audio_codes"], "1,2,3");
                assert_eq!(request["output_format"], "wav16");
                assert_eq!(request["synth_model"], "sft.gguf");
                assert_eq!(request["peak_clip"], 0);
                Json(json!({"id":"synth"}))
            }),
        )
        .route(
            "/job",
            get(
                |Query(query): Query<std::collections::HashMap<String, String>>| async move {
                    if !query.contains_key("result") {
                        return (
                            [(CONTENT_TYPE, "application/json")],
                            serde_json::to_vec(&json!({"status":"done"})).unwrap(),
                        );
                    }
                    if query["id"] == "lm" {
                        (
                            [(CONTENT_TYPE, "application/json")],
                            serde_json::to_vec(
                                &json!([{"audio_codes":"1,2,3","bpm":90,"peak_clip":10}]),
                            )
                            .unwrap(),
                        )
                    } else {
                        (
                            [(CONTENT_TYPE, "multipart/mixed; boundary=song")],
                            multipart(),
                        )
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = EngineClient::new(base.clone(), base, 0.1, 1.0).unwrap();
    let params = json!({"caption":"piano","variants":2,"inference_steps":50,"lm_temperature":1.0,"peak_clip":17});
    let original = params.clone();
    let (audio, ext, meta) = client
        .generate(
            &params,
            "test.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(audio, wav::tone(1.0));
    assert_eq!(ext, "wav");
    assert_eq!(meta["bpm"], 90);
    assert_eq!(meta["peak_clip"], 0);
    assert_eq!(params, original);
    task.abort();
}

async fn pending_server() -> (EngineClient, Arc<AtomicU32>, tokio::task::JoinHandle<()>) {
    let count = Arc::new(AtomicU32::new(0));
    let cancelled = count.clone();
    let app = Router::new()
        .route("/lm", post(|| async { Json(json!({"id":"pending"})) }))
        .route(
            "/job",
            get(|| async { Json(json!({"status":"running"})) }).post(move || {
                let count = cancelled.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"ok":true}))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (
        EngineClient::new(base.clone(), base, 0.01, 1.0).unwrap(),
        count,
        task,
    )
}

#[tokio::test]
async fn timeout_cancels_the_engine_job() {
    use music_generator::{db::Database, error::Error, types::GenerateRequest};
    let (mut client, count, task) = pending_server().await;
    client.timeout = Duration::from_millis(80);
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let request = GenerateRequest {
        prompt: "saved piano song".into(),
        duration: 90.0,
        inference_steps: 75,
        lm_temperature: Some(0.65),
        seed: 42,
        ..Default::default()
    };
    let id = db.enqueue(&request).unwrap()[0].clone();
    let (claimed, params) = db.claim_next().unwrap().unwrap();
    assert_eq!(claimed, id);
    let error = client
        .language_model(&params, &CancellationToken::new(), |_| {})
        .await
        .unwrap_err();
    assert!(matches!(error, Error::EngineTimeout { .. }));
    let text = error.to_string();
    assert!(text.contains("Timeout-Zeit erhöhen"));
    assert!(text.contains("Raise the timeout in the settings"));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    db.fail(&id, &text).unwrap();
    drop(db);
    let db = Database::open(root.path()).unwrap();
    let saved = db.song(&id).unwrap();
    assert_eq!(saved.params, params);
    assert_eq!(saved.message.as_deref(), Some(text.as_str()));
    db.retry(&id).unwrap();
    assert_eq!(db.claim_next().unwrap().unwrap(), (id, params));
    task.abort();
}

#[tokio::test]
async fn user_cancellation_cancels_the_engine_job() {
    let (client, count, task) = pending_server().await;
    let cancel = CancellationToken::new();
    let signal = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(80)).await;
        signal.cancel();
    });
    assert!(matches!(
        client
            .language_model(&json!({}), &cancel, |_| {})
            .await
            .unwrap_err(),
        music_generator::error::Error::Cancelled
    ));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    task.abort();
}

#[cfg(unix)]
#[test]
fn closing_the_supervisor_pipe_terminates_the_engine() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    let mut process = Command::new(env!("CARGO_BIN_EXE_music-generator"))
        .args([
            "--engine-supervisor",
            "/bin/sh",
            "-c",
            "echo $$; exec sleep 60",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(process.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let pid = line.trim();
    assert!(!pid.is_empty());
    drop(process.stdin.take());
    for _ in 0..100 {
        if process.try_wait().unwrap().is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(process.try_wait().unwrap().is_some());
    assert!(!Command::new("kill")
        .args(["-0", pid])
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success());
}

/// A request for vocals that the language model answers with `[Instrumental]`
/// and full-length codes must be rolled again, and the picker's language code
/// must survive the detour through the spelled-out name. The sung take wins even
/// though it is two codes shorter, because it still reaches the asked duration.
#[tokio::test]
async fn an_instrumental_answer_to_a_vocal_request_is_retried() {
    let codes = |n: usize| (0..n).map(|n| n.to_string()).collect::<Vec<_>>().join(",");
    let (silent, sung) = (codes(600), codes(598));
    let attempts = Arc::new(AtomicU32::new(0));
    let asked = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let synthesized = Arc::new(std::sync::Mutex::new(Value::Null));
    let (counter, seen, sent) = (attempts.clone(), asked.clone(), synthesized.clone());
    let app = Router::new()
        .route(
            "/lm",
            post(move |Json(request): Json<Value>| {
                let (counter, seen) = (counter.clone(), seen.clone());
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    seen.lock().unwrap().push(request);
                    Json(json!({"id":"lm"}))
                }
            }),
        )
        .route(
            "/synth",
            post(move |Json(request): Json<Value>| {
                let sent = sent.clone();
                async move {
                    *sent.lock().unwrap() = request;
                    Json(json!({"id":"synth"}))
                }
            }),
        )
        .route(
            "/job",
            get(
                move |Query(query): Query<std::collections::HashMap<String, String>>| {
                    let (silent, sung, attempts) = (silent.clone(), sung.clone(), attempts.clone());
                    async move {
                        if !query.contains_key("result") {
                            return (
                                [(CONTENT_TYPE, "application/json")],
                                serde_json::to_vec(&json!({"status":"done"})).unwrap(),
                            );
                        }
                        if query["id"] != "lm" {
                            return ([(CONTENT_TYPE, "audio/wav")], wav::tone(120.0));
                        }
                        // The first roll stays silent at full length; the second sings
                        // and is slightly shorter, still within the duration tolerance.
                        let (lyrics, codes) = if attempts.load(Ordering::SeqCst) == 1 {
                            ("[Instrumental]", silent)
                        } else {
                            ("[Verse 1]\nDie Strassen kalt, die Naechte lang", sung)
                        };
                        (
                            [(CONTENT_TYPE, "application/json")],
                            serde_json::to_vec(
                                &json!({"audio_codes":codes,"duration":120,"lyrics":lyrics,"vocal_language":"German"}),
                            )
                            .unwrap(),
                        )
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let params =
        json!({"duration":120,"inference_steps":50,"lm_temperature":1.2,"vocal_language":"de"});
    let client = EngineClient::new(base.clone(), base, 0.01, 1.0).unwrap();
    client
        .generate(
            &params,
            "lm.gguf",
            "sft.gguf",
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();

    let asked = asked.lock().unwrap();
    assert_eq!(asked.len(), 2, "the silent answer was not rolled again");
    // The prompt gets the spelled-out name and at most the engine's own variance.
    assert_eq!(asked[0]["vocal_language"], "German");
    assert_eq!(asked[0]["lm_temperature"], json!(0.85));
    // The first roll leaves the model's own seed alone; only the retry pins one.
    assert!(asked[0].get("lm_seed").is_none());
    assert!(asked[1]["lm_seed"].is_number());
    // Everything else carries over unchanged.
    assert_eq!(asked[1]["vocal_language"], "German");
    assert_eq!(asked[1]["lm_temperature"], json!(0.85));

    let sent = synthesized.lock().unwrap();
    assert!(
        sent["lyrics"].as_str().unwrap().contains("Strassen"),
        "synthesis did not receive the sung take: {}",
        sent["lyrics"]
    );
    assert_eq!(sent["vocal_language"], "de", "the saved song lost its code");
    task.abort();
}

/// The retry must not make things worse: a second take that stays silent, drops
/// its codes or comes back too short leaves the first one in place.
#[tokio::test]
async fn a_worse_second_take_does_not_replace_the_first() {
    for (lyrics, codes, duration) in [
        // Each case isolates one condition: silence, length, any codes at all.
        // The third asks for no duration, where any length would pass.
        ("[Instrumental 2]", 598, 120),
        ("[Verse 1]\nEin Wort", 300, 120),
        ("[Verse 1]\nEin Wort", 0, 0),
    ] {
        let full = (0..600)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let short = (0..codes)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let attempts = Arc::new(AtomicU32::new(0));
        let synthesized = Arc::new(std::sync::Mutex::new(Value::Null));
        let (counter, sent, ticker) = (attempts.clone(), synthesized.clone(), attempts.clone());
        let app = Router::new()
            .route(
                "/lm",
                post(move |Json(_): Json<Value>| {
                    let counter = counter.clone();
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        Json(json!({"id":"lm"}))
                    }
                }),
            )
            .route(
                "/synth",
                post(move |Json(request): Json<Value>| {
                    let sent = sent.clone();
                    async move {
                        *sent.lock().unwrap() = request;
                        Json(json!({"id":"synth"}))
                    }
                }),
            )
            .route(
                "/job",
                get(
                    move |Query(query): Query<std::collections::HashMap<String, String>>| {
                        let (full, short, attempts) = (full.clone(), short.clone(), ticker.clone());
                        async move {
                            if !query.contains_key("result") {
                                return (
                                    [(CONTENT_TYPE, "application/json")],
                                    serde_json::to_vec(&json!({"status":"done"})).unwrap(),
                                );
                            }
                            if query["id"] != "lm" {
                                return ([(CONTENT_TYPE, "audio/wav")], wav::tone(120.0));
                            }
                            let (text, codes) = if attempts.load(Ordering::SeqCst) == 1 {
                                ("[Instrumental]", full)
                            } else {
                                (lyrics, short)
                            };
                            (
                                [(CONTENT_TYPE, "application/json")],
                                serde_json::to_vec(
                                    &json!({"audio_codes":codes,"duration":120,"lyrics":text}),
                                )
                                .unwrap(),
                            )
                        }
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut params = json!({"inference_steps":50,"lm_temperature":1.2,"vocal_language":"de"});
        if duration > 0 {
            params["duration"] = json!(duration);
        }
        let client = EngineClient::new(base.clone(), base, 0.01, 1.0).unwrap();
        client
            .generate(
                &params,
                "lm.gguf",
                "sft.gguf",
                &CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            2,
            "the silent first take should still be retried"
        );
        let sent = synthesized.lock().unwrap();
        assert_eq!(
            sent["lyrics"], "[Instrumental]",
            "the weaker second take replaced the first for {lyrics:?} with {codes} codes"
        );
        task.abort();
    }
}
