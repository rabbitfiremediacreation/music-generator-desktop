use super::*;
use std::collections::BTreeMap;

fn definitions() -> BTreeMap<String, Value> {
    tools()
        .into_iter()
        .map(|tool| (tool["name"].as_str().unwrap().to_string(), tool))
        .collect()
}

#[test]
fn public_vocabulary_has_twenty_unique_tools_and_no_superseded_aliases() {
    let all = definitions();
    assert_eq!(tools().len(), 20);
    assert_eq!(all.len(), 20);
    for removed in [
        "get_status",
        "get_settings",
        "get_generation_policy",
        "get_queue",
        "list_folders",
        "create_variants",
        "wait_song",
        "get_operation",
        "list_operations",
        "select_models",
        "install_models",
        "cancel_song",
        "cancel_operation",
    ] {
        assert!(!all.contains_key(removed), "{removed}");
    }
    for tool in all.values() {
        jsonschema::validator_for(&tool["inputSchema"]).unwrap();
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    }
}

#[test]
fn variant_mapping_inherits_omitted_values_and_keeps_cpu_choice_outside_overrides() {
    let (name, args) = generation_request(
        json!({"source_song_id":"song","style":"jazz","cpu_iteration_decision":"continue"}),
    )
    .unwrap();
    assert_eq!(name, "create_variants");
    assert_eq!(
        args,
        json!({"id":"song","variants":1,"overrides":{"style":"jazz"},"cpu_iteration_decision":"continue"})
    );
    let (name, args) = generation_request(json!({"prompt":"piano"})).unwrap();
    assert_eq!(name, "generate_music");
    assert_eq!(args, json!({"prompt":"piano"}));
    for name in ["instrumental", "keep_caption", "seed"] {
        assert!(
            definitions()["generate_music"]["inputSchema"]["properties"][name]
                .get("default")
                .is_none()
        );
    }
}

#[test]
fn direct_song_poll_is_not_a_timeout_and_waited_shape_is_the_same() {
    let result = json!({"song":{"id":"song","status":"running","lyrics":"words"},"completed":false,"timed_out":true,"progress":{"phase":"synthesis"}});
    let immediate = flatten_song(result.clone(), 0).unwrap();
    let waited = flatten_song(result, 10).unwrap();
    assert_eq!(immediate["status"], "running");
    assert_eq!(immediate["timed_out"], false);
    assert_eq!(waited["timed_out"], true);
    assert!(immediate.get("song").is_none());
    assert_eq!(
        immediate.as_object().unwrap().keys().collect::<Vec<_>>(),
        waited.as_object().unwrap().keys().collect::<Vec<_>>()
    );
}

#[test]
fn schemas_express_selective_context_and_broad_model_cancellation_effects() {
    let tools = definitions();
    let schema = jsonschema::validator_for(&tools["get_context"]["inputSchema"]).unwrap();
    assert!(schema.is_valid(&json!({"sections":["queue"]})));
    for invalid in [
        json!({"sections":[]}),
        json!({"sections":["queue","queue"]}),
        json!({"sections":["generation_policy"]}),
    ] {
        assert!(!schema.is_valid(&invalid));
    }
    assert_eq!(
        tools["set_models"]["inputSchema"]["properties"]["download_missing"]["default"],
        false
    );
    assert_eq!(tools["set_models"]["annotations"]["openWorldHint"], true);
    assert_eq!(tools["cancel_job"]["annotations"]["destructiveHint"], true);
    assert_eq!(tools["cancel_job"]["annotations"]["idempotentHint"], true);
    for name in ["update_song", "save_folder", "update_settings"] {
        assert_eq!(tools[name]["annotations"]["destructiveHint"], true);
    }
}

#[test]
fn cancellation_targets_remain_distinct_and_async_results_name_public_polling() {
    assert_eq!(
        cancellation_request(json!({"target":"song","id":"s"})).unwrap(),
        ("cancel_song", json!({"id":"s"}))
    );
    assert_eq!(
        cancellation_request(json!({"target":"operation","id":"o"})).unwrap(),
        ("cancel_operation", json!({"operation_id":"o"}))
    );
    assert!(cancellation_request(json!({"target":"all","id":"x"})).is_err());
    assert_eq!(
        public_operation_result(json!({"operation_id":"o","poll_tool":"get_operation"}))
            ["poll_tool"],
        "get_operations"
    );
}
