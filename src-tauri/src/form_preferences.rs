use crate::{
    db::Database,
    error::{message, Result},
    generation_limits::MAX_INFERENCE_STEPS,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const KEY: &str = "generation_form_preferences";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationFormPreferences {
    pub duration: f64,
    pub bpm: u32,
    pub inference_steps: u32,
    pub lm_temperature: f64,
    pub variants: u32,
}

impl Default for GenerationFormPreferences {
    fn default() -> Self {
        Self {
            duration: 90.0,
            bpm: 0,
            inference_steps: 30,
            lm_temperature: 1.2,
            variants: 2,
        }
    }
}

fn valid(key: &str, value: &Value) -> bool {
    match key {
        "duration" => value
            .as_f64()
            .is_some_and(|v| v.is_finite() && (10.0..=600.0).contains(&v)),
        "bpm" => value
            .as_u64()
            .is_some_and(|v| v == 0 || (51..=200).contains(&v)),
        "inference_steps" => value
            .as_u64()
            .is_some_and(|v| (1..=u64::from(MAX_INFERENCE_STEPS)).contains(&v)),
        "lm_temperature" => value
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.3..=1.5).contains(&v)),
        "variants" => value.as_u64().is_some_and(|v| (1..=10).contains(&v)),
        _ => false,
    }
}

impl GenerationFormPreferences {
    fn from_stored(value: Value, defaults: &Self) -> Self {
        let mut normalized = serde_json::to_value(defaults).unwrap();
        for (key, fallback) in normalized.as_object_mut().unwrap() {
            if let Some(value) = value.get(key).filter(|v| valid(key, v)) {
                *fallback = value.clone();
            }
        }
        serde_json::from_value(normalized).unwrap()
    }
}

impl Database {
    pub fn generation_form_preferences(&self) -> Result<GenerationFormPreferences> {
        self.generation_form_preferences_with_defaults(&GenerationFormPreferences::default())
    }

    pub fn generation_form_preferences_with_defaults(
        &self,
        defaults: &GenerationFormPreferences,
    ) -> Result<GenerationFormPreferences> {
        let text: Option<String> = self
            .lock()
            .query_row("SELECT value FROM settings WHERE key=?1", [KEY], |row| {
                row.get(0)
            })
            .optional()?;
        let mut value = text
            .as_deref()
            .and_then(|text| match serde_json::from_str(text) {
                Ok(value) => Some(value),
                Err(error) => {
                    tracing::warn!(%error, "Ignoring damaged generation form preferences");
                    None
                }
            })
            .unwrap_or(Value::Null);
        if value["inference_steps"].as_u64().is_some_and(|steps| {
            (u64::from(MAX_INFERENCE_STEPS) + 1..=u64::from(u32::MAX)).contains(&steps)
        }) {
            value["inference_steps"] = MAX_INFERENCE_STEPS.into();
            self.lock().execute(
                "UPDATE settings SET value=?1 WHERE key=?2 AND value=?3",
                rusqlite::params![value.to_string(), KEY, text],
            )?;
        }
        Ok(GenerationFormPreferences::from_stored(value, defaults))
    }

    // This independent preference never changes engine configuration or takes an operation permit.
    pub fn save_generation_form_preferences(
        &self,
        values: &GenerationFormPreferences,
    ) -> Result<()> {
        let value = serde_json::to_value(values)?;
        if !value
            .as_object()
            .unwrap()
            .iter()
            .all(|(key, value)| valid(key, value))
        {
            return Err(message("Invalid generation form preferences"));
        }
        self.lock().execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            rusqlite::params![KEY, value.to_string()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store(db: &Database, text: &str) {
        db.lock()
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
                rusqlite::params![KEY, text],
            )
            .unwrap();
    }

    #[test]
    fn preferences_survive_reopening_and_unrelated_settings_writes() {
        let root = tempfile::tempdir().unwrap();
        let values = GenerationFormPreferences {
            duration: 315.0,
            bpm: 123,
            inference_steps: 42,
            lm_temperature: 0.65,
            variants: 7,
        };
        {
            let db = Database::open(root.path()).unwrap();
            let mut stale_settings = db.settings().unwrap();
            db.save_generation_form_preferences(&values).unwrap();
            assert_eq!(
                serde_json::to_value(db.settings().unwrap()).unwrap(),
                serde_json::to_value(&stale_settings).unwrap()
            );
            stale_settings.timeout_minutes = 47.0;
            db.save_settings(&stale_settings).unwrap();
        }
        let reopened = Database::open(root.path()).unwrap();
        assert_eq!(reopened.generation_form_preferences().unwrap(), values);
        assert_eq!(reopened.settings().unwrap().timeout_minutes, 47.0);
        reopened
            .save_generation_form_preferences(&GenerationFormPreferences::default())
            .unwrap();
        drop(reopened);
        assert_eq!(
            Database::open(root.path())
                .unwrap()
                .generation_form_preferences()
                .unwrap(),
            GenerationFormPreferences::default()
        );
    }

    #[test]
    fn eighty_and_ninety_one_steps_survive_reopening_until_explicit_reset() {
        for steps in [80, 91] {
            let root = tempfile::tempdir().unwrap();
            let defaults = GenerationFormPreferences {
                inference_steps: 80,
                ..Default::default()
            };
            let saved = GenerationFormPreferences {
                inference_steps: steps,
                ..defaults.clone()
            };
            {
                let db = Database::open(root.path()).unwrap();
                db.save_generation_form_preferences(&saved).unwrap();
            }
            let changed = GenerationFormPreferences {
                duration: 300.0,
                ..saved.clone()
            };
            {
                let db = Database::open(root.path()).unwrap();
                assert_eq!(
                    db.generation_form_preferences_with_defaults(&defaults)
                        .unwrap(),
                    saved
                );
                db.save_generation_form_preferences(&changed).unwrap();
            }
            {
                let db = Database::open(root.path()).unwrap();
                assert_eq!(
                    db.generation_form_preferences_with_defaults(&defaults)
                        .unwrap(),
                    changed
                );
                db.save_generation_form_preferences(&defaults).unwrap();
            }
            let db = Database::open(root.path()).unwrap();
            assert_eq!(
                db.generation_form_preferences_with_defaults(&defaults)
                    .unwrap(),
                defaults
            );
        }
    }

    #[test]
    fn saved_iteration_values_within_two_hundred_remain_unchanged() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        for steps in [100, 101, 120, 200] {
            store(
                &db,
                &json!({"inference_steps": steps, "duration": 30, "variants": 1, "legacy_note": "retain"}).to_string(),
            );
            let values = db.generation_form_preferences().unwrap();
            assert_eq!(values.inference_steps, steps);
            assert_eq!(values.duration, 30.0);
            assert_eq!(values.variants, 1);
            let saved: String = db
                .lock()
                .query_row("SELECT value FROM settings WHERE key=?1", [KEY], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&saved).unwrap(),
                json!({"inference_steps": steps, "duration": 30, "variants": 1, "legacy_note": "retain"})
            );
        }
    }

    #[test]
    fn new_preferences_cannot_persist_iterations_above_the_engine_limit() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let saved = GenerationFormPreferences {
            inference_steps: 100,
            ..Default::default()
        };
        db.save_generation_form_preferences(&saved).unwrap();
        for steps in [201, u32::MAX] {
            let invalid = GenerationFormPreferences {
                inference_steps: steps,
                ..saved.clone()
            };
            assert!(db.save_generation_form_preferences(&invalid).is_err());
            assert_eq!(db.generation_form_preferences().unwrap(), saved);
        }
    }

    #[test]
    fn missing_damaged_and_partially_invalid_values_use_defaults() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        assert_eq!(
            db.generation_form_preferences().unwrap(),
            GenerationFormPreferences::default()
        );
        for text in ["{broken", "null", "[]", "42"] {
            store(&db, text);
            assert_eq!(
                db.generation_form_preferences().unwrap(),
                GenerationFormPreferences::default()
            );
            assert!(db.settings().is_ok());
        }
        store(&db, &json!({"duration": 305, "bpm": 50, "inference_steps": "80", "lm_temperature": 0.65, "variants": 11, "prompt": "ignored"}).to_string());
        assert_eq!(
            db.generation_form_preferences().unwrap(),
            GenerationFormPreferences {
                duration: 305.0,
                lm_temperature: 0.65,
                ..Default::default()
            }
        );
    }

    #[test]
    fn device_defaults_fill_only_missing_or_invalid_values() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        for steps in [8, 30, 80] {
            let defaults = GenerationFormPreferences {
                inference_steps: steps,
                ..Default::default()
            };
            store(&db, "{}");
            assert_eq!(
                db.generation_form_preferences_with_defaults(&defaults)
                    .unwrap()
                    .inference_steps,
                steps
            );
            store(&db, r#"{"inference_steps":"invalid"}"#);
            assert_eq!(
                db.generation_form_preferences_with_defaults(&defaults)
                    .unwrap()
                    .inference_steps,
                steps
            );
            store(&db, r#"{"inference_steps":80}"#);
            assert_eq!(
                db.generation_form_preferences_with_defaults(&defaults)
                    .unwrap()
                    .inference_steps,
                80
            );
        }
    }

    #[test]
    fn invalid_writes_do_not_replace_saved_preferences() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let defaults = GenerationFormPreferences::default();
        db.save_generation_form_preferences(&defaults).unwrap();
        let mut invalid = Vec::new();
        for duration in [9.0, 601.0, f64::NAN, f64::INFINITY] {
            invalid.push(GenerationFormPreferences {
                duration,
                ..defaults.clone()
            });
        }
        for bpm in [1, 50, 201] {
            invalid.push(GenerationFormPreferences {
                bpm,
                ..defaults.clone()
            });
        }
        for inference_steps in [0, 201] {
            invalid.push(GenerationFormPreferences {
                inference_steps,
                ..defaults.clone()
            });
        }
        for lm_temperature in [0.29, 1.51, f64::NAN] {
            invalid.push(GenerationFormPreferences {
                lm_temperature,
                ..defaults.clone()
            });
        }
        for variants in [0, 11] {
            invalid.push(GenerationFormPreferences {
                variants,
                ..defaults.clone()
            });
        }
        for values in invalid {
            assert!(
                db.save_generation_form_preferences(&values).is_err(),
                "{values:?}"
            );
            assert_eq!(db.generation_form_preferences().unwrap(), defaults);
        }
        for values in [
            GenerationFormPreferences {
                duration: 10.0,
                bpm: 0,
                inference_steps: 1,
                lm_temperature: 0.3,
                variants: 1,
            },
            GenerationFormPreferences {
                duration: 600.0,
                bpm: 200,
                inference_steps: 200,
                lm_temperature: 1.5,
                variants: 10,
            },
        ] {
            db.save_generation_form_preferences(&values).unwrap();
            assert_eq!(db.generation_form_preferences().unwrap(), values);
        }
    }

    #[tokio::test]
    async fn active_generation_does_not_block_or_get_cancelled_by_preferences() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::state::AppState::new(
            Database::open(root.path()).unwrap(),
            root.path().join("resources"),
        );
        let generation = state
            .runtime
            .try_begin(crate::runtime::OperationKind::Generation)
            .unwrap();
        let values = GenerationFormPreferences {
            bpm: 140,
            ..Default::default()
        };
        state.db.save_generation_form_preferences(&values).unwrap();
        assert_eq!(state.db.generation_form_preferences().unwrap(), values);
        assert!(state.runtime.is_busy());
        assert!(!generation.cancellation().is_cancelled());
    }
}
