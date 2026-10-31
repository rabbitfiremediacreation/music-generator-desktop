//! Bounded, app-scoped results for operations that outlive an MCP request.
use crate::error::{message, Error, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    future::Future,
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

const CAPACITY: usize = 100;

#[derive(Clone, Default)]
pub(super) struct Tasks(Arc<Mutex<VecDeque<Entry>>>);

struct Entry {
    id: String,
    kind: String,
    status: &'static str,
    created_at: String,
    finished_at: Option<String>,
    progress: Value,
    result: Value,
    error: Option<String>,
    cancel: CancellationToken,
}

impl Entry {
    fn value(&self) -> Value {
        json!({"operation_id":self.id,"kind":self.kind,"status":self.status,
            "created_at":self.created_at,"finished_at":self.finished_at,
            "progress":self.progress,"result":self.result,"error":self.error})
    }

    fn terminal(&self) -> bool {
        matches!(self.status, "completed" | "failed" | "cancelled")
    }
}

pub(super) fn for_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Tasks {
    // manage is atomic: a concurrent caller cannot replace the existing registry.
    app.manage(Tasks::default());
    app.state::<Tasks>().inner().clone()
}

impl Tasks {
    pub fn list(&self) -> Value {
        Value::Array(
            self.0
                .lock()
                .unwrap()
                .iter()
                .rev()
                .map(Entry::value)
                .collect(),
        )
    }

    pub fn begin(&self, kind: &str, cancel: CancellationToken) -> Result<Task> {
        let mut entries = self.0.lock().unwrap();
        if entries.len() == CAPACITY {
            let removable = entries
                .iter()
                .position(Entry::terminal)
                .ok_or_else(|| message("Too many active MCP operations"))?;
            entries.remove(removable);
        }
        let id = crate::types::id();
        entries.push_back(Entry {
            id: id.clone(),
            kind: kind.into(),
            status: "running",
            created_at: crate::types::now(),
            finished_at: None,
            progress: Value::Null,
            result: Value::Null,
            error: None,
            cancel,
        });
        Ok(Task {
            id,
            tasks: self.clone(),
        })
    }

    pub fn get(&self, id: &str) -> Result<Value> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .find(|entry| entry.id == id)
            .map(Entry::value)
            .ok_or_else(|| {
                message(
                    "MCP operation not found; results expire after 100 operations or app restart",
                )
            })
    }

    pub fn cancel(&self, id: &str) -> Result<Value> {
        let mut entries = self.0.lock().unwrap();
        let entry = entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .ok_or_else(|| message("MCP operation not found"))?;
        if !entry.terminal() {
            entry.cancel.cancel();
            entry.status = "cancelling";
        }
        Ok(entry.value())
    }
}

#[derive(Clone)]
pub(super) struct Task {
    id: String,
    tasks: Tasks,
}

impl Task {
    pub fn accepted(&self) -> Value {
        json!({"operation_id":self.id,"status":"running","poll_tool":"get_operation"})
    }

    pub fn progress(&self, progress: impl Serialize) {
        if let Some(entry) = self
            .tasks
            .0
            .lock()
            .unwrap()
            .iter_mut()
            .find(|entry| entry.id == self.id)
        {
            entry.progress = serde_json::to_value(progress).unwrap_or(Value::Null);
        }
    }

    pub fn spawn(self, future: impl Future<Output = Result<Value>> + Send + 'static) {
        tauri::async_runtime::spawn(async move {
            // Observe panics as failed results instead of leaving an eternal running entry.
            let result = match tauri::async_runtime::spawn(future).await {
                Ok(result) => result,
                Err(error) => Err(message(format!("MCP operation stopped: {error}"))),
            };
            self.finish(result);
        });
    }

    fn finish(&self, result: Result<Value>) {
        if let Some(entry) = self
            .tasks
            .0
            .lock()
            .unwrap()
            .iter_mut()
            .find(|entry| entry.id == self.id)
        {
            entry.finished_at = Some(crate::types::now());
            match result {
                Ok(result) => {
                    entry.status = "completed";
                    entry.result = result;
                }
                Err(Error::Cancelled) => {
                    entry.status = "cancelled";
                }
                Err(error) => {
                    entry.status = "failed";
                    entry.error = Some(error.to_string());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_is_scoped_and_does_not_rewrite_completed_results() {
        let tasks = Tasks::default();
        let first_cancel = CancellationToken::new();
        let other_cancel = CancellationToken::new();
        let first = tasks.begin("models", first_cancel.clone()).unwrap();
        let other = tasks.begin("analysis", other_cancel.clone()).unwrap();
        tasks.cancel(&first.id).unwrap();
        assert!(first_cancel.is_cancelled());
        assert!(!other_cancel.is_cancelled());
        first.finish(Err(Error::Cancelled));
        other.finish(Ok(json!({"bpm":120})));
        assert_eq!(tasks.get(&first.id).unwrap()["status"], "cancelled");
        assert_eq!(tasks.cancel(&other.id).unwrap()["status"], "completed");
        assert!(!other_cancel.is_cancelled());
    }

    #[test]
    fn result_retention_never_evicts_active_operations() {
        let tasks = Tasks::default();
        let active = tasks.begin("active", CancellationToken::new()).unwrap();
        for _ in 0..CAPACITY + 5 {
            tasks
                .begin("finished", CancellationToken::new())
                .unwrap()
                .finish(Ok(Value::Null));
        }
        assert_eq!(tasks.0.lock().unwrap().len(), CAPACITY);
        assert_eq!(tasks.get(&active.id).unwrap()["status"], "running");
    }
}
