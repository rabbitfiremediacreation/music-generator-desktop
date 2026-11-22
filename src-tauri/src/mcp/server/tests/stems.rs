use super::{fixture, MusicServer};
use crate::{
    stems::{export, jobs},
    types::id,
};
use rusqlite::params;
use serde_json::{json, Value};
use tauri::test::MockRuntime;

async fn invoke(server: &MusicServer<MockRuntime>, name: &str, args: Value) -> Value {
    let result = server.invoke(name, args).await.unwrap();
    assert_ne!(result.is_error, Some(true), "{name}: {:?}", result.content);
    result.structured_content.unwrap()["result"].clone()
}

#[tokio::test]
async fn mixer_roundtrip_renders_the_saved_snapshot_after_a_later_edit() {
    let (_root, server) = fixture();
    let state = &server.state;
    state.runtime.set_configured(true);
    let source = id();
    let project = id();
    let source_data = json!({"id":source,"song_id":null,"name":"Voice","hash":"fixture",
        "extension":"wav","decoded":false,"audio":{"rate":44100,"channels":2,"frames":1,"peaks":[]}});
    let request = json!({"source_id":source,"pin":{"model":"htdemucs","repository":"fixture","revision":"fixture"},
        "name":"Project","start":0,"quality":"fast","overlap":0.25,"outputs":["vocals"]});
    let result = json!({"rate":44100,"channels":2,"frames":1,"source_start_frame":0,"source_frames":1,
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
    // Stereo IEEE float WAV with one frame at half amplitude.
    let wav = b"RIFF\x2c\0\0\0WAVEfmt \x10\0\0\0\x03\0\x02\0\x44\xac\0\0\x20\x62\x05\0\x08\0\x20\0data\x08\0\0\0\0\0\0\x3f\0\0\0\x3f";
    std::fs::write(folder.join("vocals.wav"), wav).unwrap();

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
