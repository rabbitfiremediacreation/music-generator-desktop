use crate::catalog::{self, Catalog, ProviderProfile, Selection};
use serde_json::{json, Value};
use std::sync::LazyLock;

static OUTPUT_USAGE: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../models/output-usage.json"))
        .expect("output usage texts")
});

/// Snapshot the model that ran and the catalog's output guidance with the song.
pub(crate) fn capture(meta: &mut Value, selection: &Selection, params: &Value) {
    let catalog = catalog::catalog();
    let profile = catalog.profile(selection);
    let name = profile.map(|profile| profile.name.as_str()).or_else(|| {
        catalog
            .providers
            .iter()
            .find(|provider| provider.id == selection.provider)
            .map(|provider| provider.name.as_str())
    });
    meta["audio_provenance"] = json!({
        "model": name.unwrap_or("Unknown"),
        "variant": selection.synthesis,
        "revision": params["generation_profile"]["model_revision"],
        "reference_audio": !params["reference_audio"].is_null() || !params["remix"].is_null(),
    });
    meta["output_usage"] =
        profile.map_or_else(|| ace_step_usage(&catalog, selection), output_usage);
}

fn ace_step_usage(catalog: &Catalog, selection: &Selection) -> Value {
    if selection.provider != "ace-step"
        || !catalog.models.iter().any(|model| {
            model.provider == "ace-step"
                && model.role == "synthesis"
                && model.file == selection.synthesis
        })
    {
        return Value::Null;
    }
    json!({
        "text": "The model card describes commercial use. The separate Space license states conditions for commercial use. Which conditions apply to this local checkpoint is unconfirmed. Check the rights to your inputs and the resulting song.",
        "text_de": "Die Modellkarte beschreibt kommerzielle Nutzung. Die separate Space-Lizenz nennt Bedingungen für kommerzielle Nutzung. Welche Bedingungen für dieses lokale Modell gelten, ist ungeklärt. Prüfe die Rechte an deinen Eingaben und am entstandenen Song.",
        "source_urls": [
            "https://huggingface.co/ACE-Step/Ace-Step1.5/blob/19671f406d603126926c1b7e2adc169acbcade22/README.md#key-features",
            "https://huggingface.co/spaces/ACE-Step/Ace-Step-v1.5/blob/cd892b3afc8348027b61f8a60c1dc96d919563a6/LICENSE",
        ],
    })
}

fn output_usage(profile: &ProviderProfile) -> Value {
    let key = &profile.usage.outputs;
    // Some catalog entries are complete English sentences. Others reference the shared texts.
    let text = OUTPUT_USAGE["en"][key]
        .as_str()
        .or_else(|| (key.split_whitespace().count() > 1).then_some(key.as_str()));
    let Some(text) = text else { return Value::Null };
    let model_source = profile.upstream_sources.iter().find(|source| {
        matches!(
            source.role.as_str(),
            "official" | "weights" | "checkpoint" | "weights_codec" | "mimetic_weights_vae"
        )
    });
    let model_license = model_source.map(|source| source.license_url.as_str());
    let policy = profile.usage.policy_url.as_deref();
    let sources: Vec<_> = [
        policy,
        model_license.filter(|source| Some(*source) != policy),
    ]
    .into_iter()
    .flatten()
    .collect();
    if sources.is_empty() {
        return Value::Null;
    }
    let local_key = if profile.selection.provider == "yue2" {
        "yue2_usage_outputs"
    } else {
        key
    };
    json!({"text": text, "text_de": OUTPUT_USAGE["de"][local_key], "source_urls": sources})
}

/// Render the stored snapshot for standalone files, independently of current settings and catalog.
pub(crate) fn comment(meta: &Value) -> Option<String> {
    let provenance = &meta["audio_provenance"];
    let model = provenance["model"].as_str()?;
    let mut lines = vec![
        "Music Generator provenance".to_owned(),
        format!("Music model: {model}"),
    ];
    for (key, label) in [("variant", "Variant"), ("revision", "Model revision")] {
        if let Some(value) = provenance[key].as_str().filter(|value| !value.is_empty()) {
            lines.push(format!("{label}: {value}"));
        }
    }
    let usage = &meta["output_usage"];
    let text = usage["text"]
        .as_str()
        .unwrap_or("Unknown. Check rights before publishing or monetizing.");
    lines.push(format!("Model output terms: {text}"));
    if let Some(sources) = usage["source_urls"].as_array() {
        lines.extend(
            sources
                .iter()
                .filter_map(Value::as_str)
                .map(|url| format!("Source: {url}")),
        );
    }
    if provenance["reference_audio"] == true {
        lines.push("Reference audio: Check rights to the recording, composition and performance for the intended use.".into());
    }
    Some(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_audio_profiles_record_human_readable_output_terms_and_sources() {
        for profile in catalog::catalog().profiles {
            if profile.capabilities.output_kind.is_audio() {
                let saved = output_usage(&profile);
                assert!(
                    saved["text"]
                        .as_str()
                        .is_some_and(|text| text.contains(' ')),
                    "{}",
                    profile.name
                );
                assert!(
                    saved["source_urls"][0]
                        .as_str()
                        .is_some_and(|url| url.starts_with("https://")),
                    "{}",
                    profile.name
                );
            }
        }
    }

    #[test]
    fn unknown_model_terms_never_imply_permission() {
        let mut meta = json!({});
        capture(
            &mut meta,
            &Selection {
                provider: "unspecified".into(),
                synthesis: String::new(),
                language: String::new(),
            },
            &Value::Null,
        );
        let comment = comment(&meta).unwrap();
        assert!(comment.contains("Music model: Unknown"));
        assert!(comment.contains(
            "Model output terms: Unknown. Check rights before publishing or monetizing."
        ));
        assert!(!comment.contains("Source:"));
    }
}
