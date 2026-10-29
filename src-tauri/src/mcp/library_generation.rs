use crate::{
    catalog::Selection,
    error::{message, Result},
    state::AppState,
    synthesis_policy::{Backend, Policy},
    types::{CpuIterationBehavior, GenerateRequest, Song},
};
use serde_json::{json, Value};
use std::sync::Arc;

async fn policy(state: Arc<AppState>, selection: Selection) -> Result<Policy> {
    tokio::task::spawn_blocking(move || {
        let mut policy =
            state
                .synthesis_probe
                .session_policy(&state.resources, &selection, true, || {
                    state.backend_status()
                });
        let settings = state.db.settings()?;
        policy.cpu_iteration_behavior = settings.cpu_iteration_behavior;
        policy.lm_device = settings.lm_device;
        Ok(policy)
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

/// Respect saved CPU behavior; a one-call choice resolves only the interactive Ask setting.
fn apply_cpu_policy(
    request: &mut GenerateRequest,
    policy: &Policy,
    choice: Option<&str>,
) -> Result<bool> {
    if policy.backend == Backend::Gpu || request.inference_steps <= 30 {
        return Ok(false);
    }
    let behavior = match policy.cpu_iteration_behavior {
        CpuIterationBehavior::Ask => match choice {
            Some("limit_30") => CpuIterationBehavior::Limit30,
            Some("continue") => CpuIterationBehavior::Continue,
            _ => return Err(message("CPU or unknown synthesis backend with more than 30 iterations: set cpu_iteration_decision to limit_30 or continue before submitting this job")),
        },
        saved => saved,
    };
    if behavior == CpuIterationBehavior::Limit30 {
        request.inference_steps = 30;
        return Ok(true);
    }
    Ok(false)
}

fn selection(state: &AppState, values: &Value) -> Result<Selection> {
    values
        .get("model_selection")
        .filter(|value| !value.is_null())
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(Into::into)
        .and_then(|selection| {
            Ok(selection.unwrap_or(Selection::from_settings(&state.db.settings()?)))
        })
}

fn overlay(target: &mut Value, values: &Value) {
    if let (Some(target), Some(values)) = (target.as_object_mut(), values.as_object()) {
        for (key, value) in values {
            if key != "cpu_iteration_decision" {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}

/// Match the studio's saved form values and device-aware defaults for omitted inputs.
pub(super) async fn generate(state: Arc<AppState>, args: Value) -> Result<Value> {
    let selection = selection(&state, &args)?;
    let policy = policy(state.clone(), selection.clone()).await?;
    let preferences = state
        .db
        .generation_form_preferences_with_defaults(&policy.defaults)?;
    let mut values = serde_json::to_value(GenerateRequest::default())?;
    overlay(&mut values, &serde_json::to_value(preferences)?);
    overlay(&mut values, &args);
    values["model_selection"] = json!(selection);
    let mut request: GenerateRequest = serde_json::from_value(values)?;
    let reduced = apply_cpu_policy(
        &mut request,
        &policy,
        args["cpu_iteration_decision"].as_str(),
    )?;
    enqueue(&state, request, reduced)
}

fn from_song(song: &Song) -> Result<GenerateRequest> {
    let mut request: GenerateRequest = serde_json::from_value(song.params.clone())?;
    if song.params.get("lyrics").is_none() {
        request.lyrics = song.lyrics.clone().unwrap_or_default();
    }
    if song.params.get("instrumental").is_none() {
        request.instrumental = request.lyrics.trim().eq_ignore_ascii_case("[Instrumental]");
    }
    if song.params.get("keep_caption").is_none() {
        request.keep_caption = song.params["use_cot_caption"] != true;
    }
    request.caption = song.caption.clone();
    request.title = song.title.clone().unwrap_or_default();
    request.folder_id = song.folder_id.clone();
    request.inference_steps = crate::generation_limits::effective_steps(
        Some(u64::from(request.inference_steps)),
        request
            .model_selection
            .as_ref()
            .map(|s| s.synthesis.as_str())
            .unwrap_or_default(),
    );
    if request.duration == 0.0 {
        request.duration = 90.0;
    }
    Ok(request)
}

pub(super) async fn variants(state: Arc<AppState>, args: Value) -> Result<Value> {
    let song = state.db.song(super::string(&args, "id")?)?;
    let mut request = from_song(&song)?;
    request.group_id = Some(song.group_id);
    request.variants = args["variants"].as_u64().unwrap_or(1) as u32;
    request.seed = -1;
    let mut values = serde_json::to_value(request)?;
    overlay(&mut values, &args["overrides"]);
    let selection = selection(&state, &values)?;
    let policy = policy(state.clone(), selection.clone()).await?;
    values["model_selection"] = json!(selection);
    let mut request: GenerateRequest = serde_json::from_value(values)?;
    let reduced = apply_cpu_policy(
        &mut request,
        &policy,
        args["cpu_iteration_decision"].as_str(),
    )?;
    enqueue(&state, request, reduced)
}

pub(super) async fn retry(state: Arc<AppState>, args: Value) -> Result<Value> {
    let id = super::string(&args, "id")?;
    let song = state.db.song(id)?;
    if !matches!(song.status.as_str(), "error" | "cancelled") {
        return Err(message("Only failed or cancelled songs can be retried"));
    }
    let mut request = from_song(&song)?;
    let selection = selection(&state, &serde_json::to_value(&request)?)?;
    let policy = policy(state.clone(), selection.clone()).await?;
    request.model_selection = Some(selection);
    let reduced = apply_cpu_policy(
        &mut request,
        &policy,
        args["cpu_iteration_decision"].as_str(),
    )?;
    if reduced {
        request.group_id = None;
        request.variants = 1;
        let mut result = enqueue(&state, request, true)?;
        result["original_id"] = json!(id);
        result["created_new_song"] = json!(true);
        return Ok(result);
    }
    crate::admission::retry(&state, id)?;
    Ok(json!({"ids": [id], "created_new_song": false, "song": state.db.song(id)?}))
}

fn enqueue(state: &AppState, request: GenerateRequest, reduced: bool) -> Result<Value> {
    let steps = request.inference_steps;
    let ids = crate::admission::generate(state, request)?;
    Ok(json!({"ids": ids, "inference_steps": steps, "cpu_iterations_limited": reduced}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_choices_preserve_saved_behavior_and_never_raise_low_steps() {
        let selection = Selection::from_settings(&Default::default());
        for backend in [Backend::Cpu, Backend::Unknown, Backend::Gpu] {
            for saved in [
                CpuIterationBehavior::Ask,
                CpuIterationBehavior::Limit30,
                CpuIterationBehavior::Continue,
            ] {
                for steps in [8, 30, 80] {
                    let mut policy = crate::synthesis_policy::policy(backend, &selection);
                    policy.cpu_iteration_behavior = saved;
                    let mut request = GenerateRequest {
                        inference_steps: steps,
                        ..Default::default()
                    };
                    let result = apply_cpu_policy(&mut request, &policy, None);
                    let risky = backend != Backend::Gpu && steps > 30;
                    assert_eq!(result.is_err(), risky && saved == CpuIterationBehavior::Ask);
                    assert_eq!(
                        request.inference_steps,
                        if risky && saved == CpuIterationBehavior::Limit30 {
                            30
                        } else {
                            steps
                        }
                    );
                }
            }
        }
        let mut policy = crate::synthesis_policy::policy(Backend::Cpu, &selection);
        let mut request = GenerateRequest {
            inference_steps: 80,
            ..Default::default()
        };
        assert!(apply_cpu_policy(&mut request, &policy, Some("limit_30")).unwrap());
        request.inference_steps = 80;
        assert!(!apply_cpu_policy(&mut request, &policy, Some("continue")).unwrap());
        policy.cpu_iteration_behavior = CpuIterationBehavior::Limit30;
        assert!(apply_cpu_policy(&mut request, &policy, Some("continue")).unwrap());
        assert_eq!(request.inference_steps, 30);
    }
}
