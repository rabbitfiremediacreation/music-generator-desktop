use music_generator::{db::Database, titles, types::GenerateRequest};
use serde_json::json;

#[test]
fn finished_lyrics_take_priority_and_instrumentals_use_the_prompt() {
    let params = json!({"lyrics":"Original lyric", "caption":"beach reggae", "instrumental":false});
    let generated = json!({"lyrics":"[Chorus]\nWir tragen das Licht durch die Nacht"});
    assert_eq!(
        titles::request(&params, &generated)["lyrics"],
        generated["lyrics"]
    );
    assert_eq!(
        titles::request(&params, &json!({"lyrics":"[Instrumental]"}))["lyrics"],
        "Original lyric"
    );
    assert_eq!(
        titles::request(
            &json!({"lyrics":"[Instrumental]","caption":"Rainy Tokyo"}),
            &json!({})
        ),
        json!({"lyrics":"","prompt":"Rainy Tokyo"})
    );
    assert_eq!(
        titles::request(
            &json!({"instrumental":true,"lyrics":"unrelated"}),
            &generated
        )["lyrics"],
        ""
    );
}

#[test]
fn unicode_input_is_bounded_without_losing_the_final_chorus() {
    let lyrics = format!("Anfang {} Finale", "夜".repeat(18000));
    let request = titles::request(
        &json!({"lyrics":lyrics,"caption":"x".repeat(10000)}),
        &json!({}),
    );
    let text = request["lyrics"].as_str().unwrap();
    assert!(text.starts_with("Anfang"));
    assert!(text.ends_with("Finale"));
    assert!(text.chars().count() <= 8000);
    assert!(serde_json::to_vec(&request).unwrap().len() < 65536);
}

#[test]
fn title_output_is_clean_and_preserves_non_latin_languages() {
    assert_eq!(
        titles::clean("\n Titel: „Licht durch die Nacht“\nExplanation").unwrap(),
        "Licht durch die Nacht"
    );
    assert_eq!(titles::clean("夜の希望").unwrap(), "夜の希望");
    for invalid in ["", "\n", "<think>reasoning", "```", "bad\u{0001}title"] {
        assert!(titles::clean(invalid).is_err(), "{invalid:?}");
    }
    assert!(titles::clean(&"長".repeat(121)).is_err());
}

#[test]
fn auto_title_is_atomic_and_never_rewrites_manual_titles_or_saved_parameters() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    for manual in ["", "Mein Titel"] {
        let id = db
            .enqueue(&GenerateRequest {
                prompt: "night".into(),
                title: manual.into(),
                variants: 1,
                ..Default::default()
            })
            .unwrap()[0]
            .clone();
        let (_, original) = db.claim_next().unwrap().unwrap();
        assert!(db
            .finish(
                &id,
                "song.wav",
                &json!({"generated_title":"Licht durch die Nacht"})
            )
            .unwrap());
        assert_eq!(
            db.song(&id).unwrap().title.as_deref(),
            Some(if manual.is_empty() {
                "Licht durch die Nacht"
            } else {
                manual
            })
        );
        assert_eq!(db.song(&id).unwrap().params, original);
    }
    let id = db
        .enqueue(&GenerateRequest {
            prompt: "night".into(),
            variants: 1,
            ..Default::default()
        })
        .unwrap()[0]
        .clone();
    db.claim_next().unwrap();
    db.patch(&id, &json!({"title":"Während der Generierung umbenannt"}))
        .unwrap();
    db.finish(&id, "song.wav", &json!({"generated_title":"Model title"}))
        .unwrap();
    assert_eq!(
        db.song(&id).unwrap().title.as_deref(),
        Some("Während der Generierung umbenannt")
    );
    // Completed rows cannot be backfilled/replaced by a late or repeated result.
    assert!(!db
        .finish(&id, "other.wav", &json!({"generated_title":"Late result"}))
        .unwrap());
}

#[test]
fn failed_titling_keeps_the_finished_audio_and_survives_restart() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let id = db
        .enqueue(&GenerateRequest {
            prompt: "night".into(),
            variants: 1,
            ..Default::default()
        })
        .unwrap()[0]
        .clone();
    let (_, original) = db.claim_next().unwrap().unwrap();
    db.finish(
        &id,
        "song.wav",
        &json!({"title_generation_error":"Timed out"}),
    )
    .unwrap();
    drop(db);
    let db = Database::open(root.path()).unwrap();
    let song = db.song(&id).unwrap();
    assert_eq!(song.status, "done");
    assert_eq!(song.file.as_deref(), Some("song.wav"));
    let title = song.title.as_deref().expect("a random replacement title");
    assert_eq!(title.split_whitespace().count(), 2);
    assert_eq!(titles::clean(title).unwrap(), title);
    assert_eq!(song.params, original);
    let meta = song.result_meta.as_ref().unwrap();
    assert_eq!(meta["title_generation_error"], "Timed out");
    assert_eq!(meta["generated_title"], title);
    drop(db);
    assert_eq!(
        Database::open(root.path())
            .unwrap()
            .song(&id)
            .unwrap()
            .title
            .as_deref(),
        Some(title)
    );
}

#[test]
fn title_failure_never_replaces_manual_titles_or_later_edits() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    for initial in ["Mein Titel", ""] {
        let id = db
            .enqueue(&GenerateRequest {
                title: initial.into(),
                prompt: "night".into(),
                variants: 1,
                ..Default::default()
            })
            .unwrap()[0]
            .clone();
        let (_, original) = db.claim_next().unwrap().unwrap();
        if initial.is_empty() {
            db.patch(&id, &json!({"title":"Mein Titel"})).unwrap();
        }
        assert!(db
            .finish(
                &id,
                "song.wav",
                &json!({"title_generation_error":"Invalid title"})
            )
            .unwrap());
        let song = db.song(&id).unwrap();
        assert_eq!(song.title.as_deref(), Some("Mein Titel"));
        assert_eq!(song.params, original);
    }
}

#[test]
fn title_failure_does_not_backfill_completed_or_cancelled_songs() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    for cancelled in [false, true] {
        let id = db
            .enqueue(&GenerateRequest {
                prompt: "night".into(),
                variants: 1,
                ..Default::default()
            })
            .unwrap()[0]
            .clone();
        db.claim_next().unwrap();
        if cancelled {
            db.cancel_or_delete(&id).unwrap();
        } else {
            db.finish(&id, "song.wav", &json!({})).unwrap();
        }
        assert!(!db
            .finish(
                &id,
                "late.wav",
                &json!({"title_generation_error":"Too late"})
            )
            .unwrap());
        let song = db.song(&id).unwrap();
        assert!(song.title.is_none());
        assert_eq!(song.status, if cancelled { "cancelled" } else { "done" });
    }
}

#[test]
fn starter_model_choices_share_exactly_one_pinned_title_model() {
    for (lm, xl) in [("0.6B", false), ("1.7B", true), ("4B", false)] {
        let request = music_generator::setup::SetupRequest {
            lm: lm.into(),
            xl,
            models_dir: "/models".into(),
            songs_dir: "/songs".into(),
        };
        let plan = music_generator::setup::plan(&request).unwrap();
        let models = plan
            .iter()
            .filter(|(model, _)| model.kind == "titles")
            .collect::<Vec<_>>();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].0.file, titles::manifest().model.file);
        assert!(models[0].1.contains(&titles::manifest().revision));
        assert_eq!(models[0].0.sha256.len(), 64);
    }
}

#[tokio::test]
async fn cancelled_title_install_never_fetches_or_changes_provider_settings() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let before = serde_json::to_value(db.settings().unwrap()).unwrap();
    let cancel = tokio_util::sync::CancellationToken::new();
    cancel.cancel();
    assert!(matches!(
        titles::install(
            root.path(),
            &root.path().join("models"),
            &cancel,
            |_| panic!("no progress after cancel")
        )
        .await,
        Err(music_generator::error::Error::Cancelled)
    ));
    assert_eq!(
        serde_json::to_value(db.settings().unwrap()).unwrap(),
        before
    );
}
