use super::*;
use crate::{db::Database, types::GenerateRequest};

fn fixture() -> (
    tempfile::TempDir,
    Arc<AppState>,
    tauri::App<tauri::test::MockRuntime>,
) {
    let root = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState::new(
        Database::open(&root.path().join("data")).unwrap(),
        root.path().join("resources"),
    ));
    (root, state, tauri::test::mock_app())
}

async fn terminal(app: &AppHandle<tauri::test::MockRuntime>, id: &str) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let result = tasks::for_app(app).get(id).unwrap();
            if matches!(
                result["status"].as_str(),
                Some("completed" | "failed" | "cancelled")
            ) {
                return result;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn lyrics_export_returns_a_trackable_result_and_preserves_originals() {
    let (root, state, app) = fixture();
    let id = state
        .db
        .enqueue(&GenerateRequest {
            prompt: "A song".into(),
            instrumental: false,
            lyrics: "Words to remember".into(),
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    let destination = root.path().join("lyrics.txt");
    let accepted = call(
        "export_file",
        json!({"kind":"lyrics","id":id,"destination":destination}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap()
    .unwrap();
    let finished = terminal(app.handle(), accepted["operation_id"].as_str().unwrap()).await;
    assert_eq!(finished["status"], "completed", "{finished}");
    assert_eq!(
        std::fs::read_to_string(&destination).unwrap(),
        "Words to remember"
    );
    assert_eq!(
        state.db.song(&id).unwrap().lyrics.as_deref(),
        Some("Words to remember")
    );
    let saved = state
        .db
        .export_default_path("next.txt", Path::new("/unused"))
        .unwrap();
    assert_eq!(saved, root.path().join("next.txt"));
    let rejected = call(
        "export_file",
        json!({"kind":"lyrics","id":id,"destination":destination}),
        state,
        app.handle(),
    )
    .await
    .unwrap();
    assert!(rejected.is_err());
    assert_eq!(
        std::fs::read_to_string(destination).unwrap(),
        "Words to remember"
    );
    assert!(std::fs::read_dir(root.path()).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".music-generator-export-")));
}

#[tokio::test]
async fn analysis_errors_are_observable_and_release_the_runtime() {
    let (root, state, app) = fixture();
    state.runtime.set_configured(true);
    let settings = crate::types::Settings {
        expert_mode: true,
        lm_model: crate::manifest::lm_file("0.6B"),
        ..state.db.settings().unwrap()
    };
    state.db.save_settings(&settings).unwrap();
    let path = root.path().join("not-audio.txt");
    std::fs::write(&path, b"wrong type").unwrap();
    let accepted = call(
        "analyze_audio",
        json!({"path":path}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap()
    .unwrap();
    let finished = terminal(app.handle(), accepted["operation_id"].as_str().unwrap()).await;
    assert_eq!(finished["status"], "failed");
    assert_eq!(finished["error"], "audio_type");
    assert!(!state.runtime.is_busy());
    assert_eq!(
        state.health().await["backend_status"]["state"],
        "not_started"
    );
}

#[tokio::test]
async fn model_install_rejects_incomplete_setup_before_registering_a_job() {
    let (_root, state, app) = fixture();
    let selection = crate::catalog::Selection::from_settings(&state.db.settings().unwrap());
    let result = call(
        "install_models",
        json!({"selection":selection}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap();
    assert!(result.unwrap_err().to_string().contains("first-run"));
    assert!(!state.runtime.is_busy());
}

#[test]
fn only_explicit_download_tools_advertise_network_side_effects() {
    for tool in tools() {
        let name = tool["name"].as_str().unwrap();
        assert_eq!(
            tool["annotations"]["openWorldHint"],
            matches!(name, "install_models" | "download_title_model")
        );
        if matches!(
            name,
            "install_models"
                | "download_title_model"
                | "analyze_audio"
                | "import_library"
                | "export_file"
        ) {
            assert_eq!(tool["annotations"]["readOnlyHint"], false);
        }
    }
}

#[tokio::test]
async fn exports_serialize_with_configuration_and_allow_queue_admission() {
    let (root, state, app) = fixture();
    state.runtime.set_configured(true);
    let active = state
        .runtime
        .try_begin(crate::runtime::OperationKind::Generation)
        .unwrap();
    let result = call(
        "export_file",
        json!({"kind":"lyrics","id":"fixture","destination":root.path().join("result.txt")}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap();
    assert!(result.is_err());
    assert!(!root.path().join("result.txt").exists());
    drop(active);
    let export = state
        .runtime
        .try_begin(crate::runtime::OperationKind::Export)
        .unwrap();
    assert!(state
        .runtime
        .try_begin(crate::runtime::OperationKind::Settings)
        .is_err());
    assert!(state.runtime.enqueue(|| Ok(())).is_ok());
    drop(export);
    assert!(state
        .runtime
        .try_begin(crate::runtime::OperationKind::Settings)
        .is_ok());
}
