use super::{model, AppState, Path};
use crate::mcp::server::MusicServer;
use rmcp::{model::CallToolRequestParams, ServiceExt};
use serde_json::json;
use std::{sync::Arc, time::Duration};

/// Submit the real audio fixture through an MCP client before reopening the queue in the worker test.
pub(super) async fn install_and_separate(
    state: AppState,
    path: &Path,
    profile: &model::Profile,
) -> String {
    let app = tauri::test::mock_app();
    let server = MusicServer::new(Arc::new(state), app.handle().clone());
    let (server_io, client_io) = tokio::io::duplex(65536);
    let task = tokio::spawn(async move {
        server
            .serve(server_io)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let client = ().serve(client_io).await.unwrap();
    let call = async |name: &'static str, args: serde_json::Value| {
        let result = client
            .call_tool(
                CallToolRequestParams::new(name).with_arguments(args.as_object().unwrap().clone()),
            )
            .await
            .unwrap();
        assert_ne!(result.is_error, Some(true), "{name}: {:?}", result.content);
        result.structured_content.unwrap()["result"].clone()
    };
    let setup = call(
        "set_stem_model",
        json!({"pin":profile.pin(),"download_missing":true}),
    )
    .await;
    assert_eq!(setup["poll_tool"], "get_operations");
    tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let result = call(
                "get_operations",
                json!({"operation_id":setup["operation_id"]}),
            )
            .await;
            let operation = &result["operations"][0];
            match operation["status"].as_str() {
                Some("completed") => break,
                Some("running") => tokio::time::sleep(Duration::from_millis(100)).await,
                _ => panic!("Model setup failed: {operation}"),
            }
        }
    })
    .await
    .expect("model setup timed out");
    // This range resamples to 132413.00625 frames, which rounds down in float32.
    let mut args = json!({"path":path,"model_id":profile.id,"name":"Reference separation",
        "start":0.15,"end":151_323.0 / 48_000.0,"overlap":0.25,
        "shifts":1,
        "quality":if profile.id == "htdemucs-6s" {"standard"} else {"fast"},
        "outputs":profile.roles.iter().copied().chain(["instrumental", "no_drums", "residual"]).collect::<Vec<_>>()});
    if profile.id == "htdemucs-6s" {
        args["no_split"] = json!(true);
    } else {
        args["segment"] = json!(2.0);
        args["transition_power"] = json!(2.0);
        args["num_workers"] = json!(2);
    }
    let id = call("separate_song", args).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client.cancel().await.unwrap();
    task.await.unwrap();
    id
}
