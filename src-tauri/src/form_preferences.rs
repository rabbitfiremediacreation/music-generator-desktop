use crate::{
    db::Database,
    error::{message, Result},
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
            inference_steps: 80,
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
        "inference_steps" => value.as_u64().is_some_and(|v| (1..=200).contains(&v)),
        "lm_temperature" => value
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.3..=1.5).contains(&v)),
        "variants" => value.as_u64().is_some_and(|v| (1..=10).contains(&v)),
        _ => false,
    }
}

impl GenerationFormPreferences {
    fn from_stored(value: Value) -> Self {
        let mut normalized = serde_json::to_value(Self::default()).unwrap();
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
        let text: Option<String> = self
            .lock()
            .query_row("SELECT value FROM settings WHERE key=?1", [KEY], |row| {
                row.get(0)
            })
            .optional()?;
        let value = text
            .and_then(|text| match serde_json::from_str(&text) {
                Ok(value) => Some(value),
                Err(error) => {
                    tracing::warn!(%error, "Ignoring damaged generation form preferences");
                    None
                }
            })
            .unwrap_or(Value::Null);
        Ok(GenerationFormPreferences::from_stored(value))
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
