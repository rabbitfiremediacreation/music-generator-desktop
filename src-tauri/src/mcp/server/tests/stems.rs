use super::{fixture, MusicServer};
use crate::{
    stems::{export, jobs},
    types::id,
};
use rusqlite::params;
use serde_json::{json, Value};
use std::{f64::consts::TAU, path::Path, time::Duration};
use tauri::test::MockRuntime;

async fn invoke(server: &MusicServer<MockRuntime>, name: &str, args: Value) -> Value {
    let result = server.invoke(name, args).await.unwrap();
    assert_ne!(result.is_error, Some(true), "{name}: {:?}", result.content);
    result.structured_content.unwrap()["result"].clone()
}

fn project_with_audio(
    server: &MusicServer<MockRuntime>,
    frames: u32,
    sample_at: impl Fn(u32) -> [f32; 2],
) -> String {
    let state = &server.state;
    let source = id();
    let project = id();
    let source_data = json!({"id":source,"song_id":null,"name":"Voice","hash":"fixture",
        "extension":"wav","decoded":false,"audio":{"rate":44100,"channels":2,"frames":frames,"peaks":[]}});
    let request = json!({"source_id":source,"pin":{"model":"htdemucs","repository":"fixture","revision":"fixture"},
        "name":"Project","start":0,"quality":"fast","overlap":0.25,"outputs":["vocals"]});
    let result = json!({"rate":44100,"channels":2,"frames":frames,"source_start_frame":0,"source_frames":frames,
        "roles":["vocals"],"engine":"demucs","engine_version":"fixture","architecture":"fixture",
        "backend":"cpu","weights_sha256":"","expected_roles":["vocals"],"original_peak":0.5,"track_peaks":[0.5]});
    {
        let db = state.db.lock();
        db.execute(
            "INSERT INTO stem_sources(id,data) VALUES (?1,?2)",
            params![source, source_data.to_string()],
        )
        .unwrap();
        db.execute("INSERT INTO stem_jobs(id,source_id,request,status,phase,created_at,result) VALUES (?1,?2,?3,'done','done','2026',?4)",
            params![project, source, request.to_string(), result.to_string()]).unwrap();
    }
    let folder = state.db.root.join("stems/projects").join(&project);
    std::fs::create_dir_all(&folder).unwrap();
    let bytes = frames * 8;
    let mut wav = b"RIFF".to_vec();
    wav.extend((36 + bytes).to_le_bytes());
    wav.extend(b"WAVEfmt \x10\0\0\0\x03\0\x02\0\x44\xac\0\0\x20\x62\x05\0\x08\0\x20\0data");
    wav.extend(bytes.to_le_bytes());
    for frame in 0..frames {
        for sample in sample_at(frame) {
            wav.extend(sample.to_le_bytes());
        }
    }
    std::fs::write(folder.join("vocals.wav"), wav).unwrap();
    project
}

#[tokio::test]
async fn mixer_roundtrip_renders_the_saved_snapshot_after_a_later_edit() {
    let (_root, server) = fixture();
    let state = &server.state;
    state.runtime.set_configured(true);
    let project = project_with_audio(&server, 1, |_| [0.5; 2]);
    let job = invoke(
        &server,
        "get_stem_job",
        json!({"id":project,"include_mix":true}),
    )
    .await;
    let mut mix = job["default_mix"].clone();
    assert_eq!(mix["tracks"][0]["role"], "vocals");
    mix["tracks"][0]["fx"]["dynamics"] = json!({"mix":0,"mode":"vca","vca_ratio":2.0});
    mix["tracks"][0]["dynamic_eq"] = json!({"bypass":true,"bands":[
        {"frequency_hz":8000,"threshold_db":-24,"reduction_db":9,"q":1.5}
    ]});
    mix["tracks"][0]["sends"] = json!([25, 0, 0, 0]);
    mix["fx_returns"] = json!([
        {"effect":{"kind":"delay","time_ms":300,"feedback":20,"damping_hz":6200},"level":100,"enabled":false},
        {"effect":{"kind":"off"},"level":100},
        {"effect":{"kind":"off"},"level":100},
        {"effect":{"kind":"off"},"level":100}
    ]);
    mix["master_db"] = json!(-6);
    let saved = invoke(
        &server,
        "save_stem_mix",
        json!({"id":project,"name":"Demo","mix":mix}),
    )
    .await;
    assert_eq!(saved["mix"]["tracks"][0]["sends"][0], 25.0);
    assert_eq!(saved["mix"]["fx_returns"][0]["effect"]["kind"], "delay");
    let exports = invoke(
        &server,
        "export_stems",
        json!({"request":{"project_id":project,
        "kind":"mix","version_id":saved["id"],"format":"wav","wav_format":"float32"}}),
    )
    .await;

    mix["master_off"] = json!(true);
    invoke(
        &server,
        "save_stem_mix",
        json!({"id":project,"version":saved["id"],"name":"Muted","mix":mix}),
    )
    .await;
    let Some(jobs::Work::Export(id)) = state.db.claim_work().unwrap() else {
        panic!("export should be queued")
    };
    assert_eq!(exports["id"], id);
    export::run(state, &id, &state.runtime.cancellation(), || {}).await;
    let finished = invoke(&server, "get_stem_export", json!({"id":id})).await;
    assert_eq!(finished["export"]["status"], "done", "{finished}");
    let peak = finished["export"]["outputs"][0]["peak"].as_f64().unwrap();
    assert!((peak - 0.25059).abs() < 0.0001, "{peak}");
    assert!(std::path::Path::new(finished["local_files"][0].as_str().unwrap()).is_file());
}

async fn wait_for_operation(server: &MusicServer<MockRuntime>, accepted: &Value) -> Value {
    assert_eq!(accepted["poll_tool"], "get_operations");
    assert_eq!(accepted["status"], "running");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let result = invoke(
                server,
                "get_operations",
                json!({"operation_id":accepted["operation_id"]}),
            )
            .await;
            let operation = &result["operations"][0];
            if matches!(
                operation["status"].as_str(),
                Some("completed" | "failed" | "cancelled")
            ) {
                return operation.clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("MCP operation should finish")
}

#[tokio::test]
async fn stem_restoration_scans_a_track_and_previews_the_replacement_before_saving() {
    let (_root, server) = fixture();
    let frames = 44_100;
    let project = project_with_audio(&server, frames, |frame| {
        let tone = |bin| (TAU * f64::from(bin * frame) / 2048.0).sin() as f32;
        let whistle = if (frames / 4..frames * 3 / 8).contains(&frame) {
            tone(238) * 0.08
        } else {
            0.0
        };
        let sample = tone(352) * 0.16 + whistle;
        [sample, -sample]
    });
    let target = json!({"project_id":project,"role":"vocals"});
    let accepted = invoke(&server, "scan_stem_artifacts", target.clone()).await;
    let scan = wait_for_operation(&server, &accepted).await;
    assert_eq!(scan["status"], "completed", "{scan}");
    let regions = scan["result"]["regions"].as_array().unwrap();
    assert_eq!(regions.len(), 1);
    assert!(regions[0]["first"].as_u64().unwrap() < u64::from(frames / 4));
    assert!(regions[0]["end"].as_u64().unwrap() > u64::from(frames * 3 / 8));

    let destination = tempfile::tempdir().unwrap();
    let mut preview_args = target.clone();
    preview_args["selection"] = regions[0].clone();
    preview_args["destination"] = json!(destination.path());
    let accepted = invoke(&server, "preview_stem_repair", preview_args).await;
    let preview = wait_for_operation(&server, &accepted).await;
    assert_eq!(preview["status"], "completed", "{preview}");
    let result = &preview["result"];
    assert_eq!(result["rate"], frames);
    let parent = destination.path().canonicalize().unwrap();
    let before_path = Path::new(result["before"].as_str().unwrap());
    let after_path = Path::new(result["after"].as_str().unwrap());
    assert!(before_path.starts_with(&parent));
    assert_eq!(before_path.parent(), after_path.parent());
    let before = std::fs::read(before_path).unwrap();
    let after = std::fs::read(after_path).unwrap();
    assert_eq!(
        before.len(),
        56 + result["frames"].as_u64().unwrap() as usize * 8
    );
    assert_eq!(before.len(), after.len());
    assert_ne!(before, after);
    let layers = || {
        server
            .state
            .db
            .lock()
            .query_row("SELECT COUNT(*) FROM stem_layers", [], |row| {
                row.get::<_, u32>(0)
            })
            .unwrap()
    };
    assert_eq!(layers(), 0);

    let mut repair_args = target.clone();
    repair_args["selection"] = regions[0].clone();
    let accepted = invoke(&server, "repair_stem_track", repair_args).await;
    let repair = wait_for_operation(&server, &accepted).await;
    assert_eq!(repair["status"], "completed", "{repair}");
    let role = repair["result"]["role"].as_str().unwrap();
    let repaired =
        std::fs::read(crate::stems::layer::path(&server.state, &project, role).unwrap()).unwrap();
    let first = result["first_frame"].as_u64().unwrap() as usize;
    assert_eq!(
        &repaired[56 + first * 8..56 + first * 8 + after.len() - 56],
        &after[56..]
    );
    let job = invoke(
        &server,
        "get_stem_job",
        json!({"id":project,"include_mix":true}),
    )
    .await;
    let mut mix = job["default_mix"].clone();
    mix["tracks"][0]["replacement"] = json!(role);
    let saved = invoke(
        &server,
        "save_stem_mix",
        json!({"id":project,"name":"Repaired","mix":mix}),
    )
    .await;
    assert_eq!(saved["mix"]["tracks"][0]["replacement"], role);

    for kind in ["de_click", "de_crackle"] {
        let mut args = target.clone();
        args["selection"] = json!({"whole_track":true,"effect":{"kind":kind,"sensitivity":60}});
        let accepted = invoke(&server, "repair_stem_track", args).await;
        let operation = wait_for_operation(&server, &accepted).await;
        assert_eq!(operation["status"], "completed", "{operation}");
    }
    let mut whole = target.clone();
    whole["selection"] = regions[0].clone();
    whole["selection"]["whole_track"] = json!(true);
    let mut whole_preview = whole.clone();
    whole_preview["destination"] = json!(destination.path());
    let accepted = invoke(&server, "preview_stem_repair", whole_preview).await;
    let operation = wait_for_operation(&server, &accepted).await;
    assert_eq!(operation["status"], "completed", "{operation}");
    let selection = whole["selection"].as_object_mut().unwrap();
    selection.remove("first");
    selection.remove("end");
    let accepted = invoke(&server, "repair_stem_track", whole).await;
    let operation = wait_for_operation(&server, &accepted).await;
    assert_eq!(operation["status"], "completed", "{operation}");
    assert_eq!(layers(), 4);

    if let Some(path) = std::env::var_os("MUSIC_GENERATOR_MCP_STEM_EVIDENCE") {
        let path = Path::new(&path);
        let evidence = json!({"scan":scan,"preview":preview,"repair":repair,
            "saved_replacement":saved["mix"]["tracks"][0]["replacement"]});
        std::fs::write(
            path.join("results.json"),
            serde_json::to_vec_pretty(&evidence).unwrap(),
        )
        .unwrap();
        std::fs::write(path.join("before.wav"), before).unwrap();
        std::fs::write(path.join("after.wav"), after).unwrap();
    }
}

#[tokio::test]
async fn stem_generation_rejects_unsupported_models_without_creating_a_layer() {
    let (_root, server) = fixture();
    let project = project_with_audio(&server, 1, |_| [0.0; 2]);
    let accepted = invoke(
        &server,
        "generate_stem_track",
        json!({
            "project_id":project,"selection":{"provider":"ace-step","synthesis":"unsupported.gguf"},
            "track":"bass","name":"Bass"
        }),
    )
    .await;
    let operation = wait_for_operation(&server, &accepted).await;
    assert_eq!(operation["status"], "failed", "{operation}");
    assert_eq!(operation["error"], "stem_layer_generated_model");
    assert!(operation["result"].is_null());
    assert!(!server.state.runtime.is_busy());
}

#[tokio::test]
async fn stem_model_setup_requires_explicit_download_and_an_immutable_revision() {
    let (_root, server) = fixture();
    let catalog = invoke(&server, "list_stem_models", json!({})).await;
    let profile = &catalog["models"][0];
    let mut pin = json!({"model":profile["id"],"repository":profile["repository"],"revision":profile["revision"]});
    assert_eq!(
        server
            .invoke("set_stem_model", json!({"pin":pin}))
            .await
            .unwrap()
            .is_error,
        Some(true)
    );
    pin["revision"] = json!("unlisted");
    assert_eq!(
        server
            .invoke("set_stem_model", json!({"pin":pin,"download_missing":true}))
            .await
            .unwrap()
            .is_error,
        Some(true)
    );
    assert_eq!(
        invoke(&server, "get_operations", json!({})).await["operations"],
        json!([])
    );
}
