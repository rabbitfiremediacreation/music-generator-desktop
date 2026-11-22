use super::DownloadProgress;
use crate::{
    error::{Error, Result},
    types::id,
};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard, Semaphore, SemaphorePermit};
use tokio_util::sync::CancellationToken;

pub(crate) const LIMIT: usize = 4;
const RECENT: usize = 24;

#[derive(Clone, Serialize)]
pub(crate) struct Entry {
    id: String,
    file: String,
    phase: &'static str,
    downloaded: u64,
    total: u64,
    error: Option<String>,
}

struct Row {
    entry: Entry,
    cancel: Option<CancellationToken>,
}

struct Queue {
    permits: Semaphore,
    rows: Mutex<VecDeque<Row>>,
    paths: Mutex<HashMap<PathBuf, Weak<AsyncMutex<()>>>>,
}

impl Queue {
    fn new() -> Self {
        Self {
            permits: Semaphore::new(LIMIT),
            rows: Mutex::new(VecDeque::new()),
            paths: Mutex::new(HashMap::new()),
        }
    }

    fn destination_lock(&self, path: &Path) -> Arc<AsyncMutex<()>> {
        let mut paths = self.paths.lock().unwrap();
        paths.retain(|_, entry| entry.strong_count() > 0);
        if let Some(lock) = paths.get(path).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(AsyncMutex::new(()));
        paths.insert(path.to_owned(), Arc::downgrade(&lock));
        lock
    }
}

fn queue() -> &'static Queue {
    static QUEUE: OnceLock<Queue> = OnceLock::new();
    QUEUE.get_or_init(Queue::new)
}

pub(crate) fn list() -> Vec<Entry> {
    queue()
        .rows
        .lock()
        .unwrap()
        .iter()
        .map(|row| row.entry.clone())
        .collect()
}

pub(crate) fn cancel(id: &str) {
    if let Some(cancel) = queue()
        .rows
        .lock()
        .unwrap()
        .iter()
        .find(|row| row.entry.id == id)
        .and_then(|row| row.cancel.clone())
    {
        cancel.cancel();
    }
}

/// Count an external package downloader as one job when individual files are unavailable.
pub(crate) async fn external<T>(
    name: &str,
    target: &Path,
    cancel: &CancellationToken,
    run: impl AsyncFnOnce(&CancellationToken) -> Result<T>,
) -> Result<T> {
    let task = Task::begin(name, 0, cancel);
    let result = async {
        let _permit = task.acquire(target).await?;
        run(task.cancellation()).await
    }
    .await;
    task.finish(&result);
    result
}

pub(super) struct Task<'a> {
    queue: &'a Queue,
    id: String,
    cancel: CancellationToken,
}

impl Task<'static> {
    pub(super) fn begin(file: &str, total: u64, parent: &CancellationToken) -> Self {
        Self::register(queue(), file, total, parent)
    }
}

impl<'a> Task<'a> {
    fn register(queue: &'a Queue, file: &str, total: u64, parent: &CancellationToken) -> Self {
        let id = id();
        let cancel = parent.child_token();
        let mut rows = queue.rows.lock().unwrap();
        while rows.iter().filter(|row| row.cancel.is_none()).count() >= RECENT {
            if let Some(index) = rows.iter().position(|row| row.cancel.is_none()) {
                rows.remove(index);
            }
        }
        rows.push_back(Row {
            entry: Entry {
                id: id.clone(),
                file: file.to_owned(),
                phase: "queued",
                downloaded: 0,
                total,
                error: None,
            },
            cancel: Some(cancel.clone()),
        });
        Self { queue, id, cancel }
    }

    fn update(&self, update: impl FnOnce(&mut Row)) {
        if let Some(row) = self
            .queue
            .rows
            .lock()
            .unwrap()
            .iter_mut()
            .find(|row| row.entry.id == self.id && row.cancel.is_some())
        {
            update(row);
        }
    }

    pub(super) fn cancellation(&self) -> &CancellationToken {
        &self.cancel
    }

    pub(super) fn progress(&self, progress: &DownloadProgress) {
        self.update(|row| {
            row.entry.phase = progress.phase;
            row.entry.downloaded = progress.downloaded;
            row.entry.total = progress.total;
        });
    }

    pub(super) fn finish<T>(&self, result: &Result<T>) {
        self.update(|row| {
            row.cancel = None;
            row.entry.phase = match result {
                Ok(_) => {
                    row.entry.downloaded = row.entry.total;
                    "done"
                }
                Err(Error::Cancelled) => "cancelled",
                Err(error) => {
                    row.entry.error = Some(error.to_string());
                    "error"
                }
            };
        });
    }

    pub(super) async fn acquire(&self, target: &Path) -> Result<Permit<'a>> {
        let path = self.queue.destination_lock(target);
        // A second profile can share an asset. Wait for its writer before taking a network slot.
        let path = tokio::select! {
            biased;
            _ = self.cancel.cancelled() => return Err(Error::Cancelled),
            lock = path.lock_owned() => lock,
        };
        let slot = tokio::select! {
            biased;
            _ = self.cancel.cancelled() => return Err(Error::Cancelled),
            slot = self.queue.permits.acquire() => slot.map_err(|_| Error::Cancelled)?,
        };
        self.update(|row| row.entry.phase = "downloading");
        Ok(Permit {
            _slot: slot,
            _path: path,
        })
    }
}

pub(super) struct Permit<'a> {
    _slot: SemaphorePermit<'a>,
    _path: OwnedMutexGuard<()>,
}

impl Drop for Task<'_> {
    fn drop(&mut self) {
        self.finish(&Err::<(), _>(Error::Cancelled));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{pin::pin, task::Poll};

    #[tokio::test]
    async fn a_fifth_download_waits_until_an_active_slot_is_released() {
        let queue = Queue::new();
        let cancel = CancellationToken::new();
        let mut active = Vec::new();
        for name in ["first", "second", "third", "fourth"] {
            let task = Task::register(&queue, name, 10, &cancel);
            let permit = task.acquire(Path::new(name)).await.unwrap();
            active.push((task, permit));
        }
        let next = Task::register(&queue, "fifth", 10, &cancel);
        let mut waiting = pin!(next.acquire(Path::new("fifth")));
        assert!(matches!(futures_util::poll!(&mut waiting), Poll::Pending));
        assert_eq!(
            queue.rows.lock().unwrap().back().unwrap().entry.phase,
            "queued"
        );
        active.pop();
        let _permit = waiting.await.unwrap();
        assert_eq!(
            queue.rows.lock().unwrap().back().unwrap().entry.phase,
            "downloading"
        );
    }

    #[tokio::test]
    async fn duplicate_destinations_wait_without_using_a_slot_and_can_be_cancelled() {
        let queue = Queue::new();
        let cancel = CancellationToken::new();
        let first = Task::register(&queue, "model", 100, &cancel);
        let _permit = first.acquire(Path::new("model")).await.unwrap();
        let duplicate = Task::register(&queue, "model", 100, &cancel);
        let mut waiting = pin!(duplicate.acquire(Path::new("model")));

        assert!(matches!(futures_util::poll!(&mut waiting), Poll::Pending));
        assert_eq!(queue.permits.available_permits(), LIMIT - 1);
        duplicate.cancellation().cancel();
        assert!(matches!(waiting.await, Err(Error::Cancelled)));
        assert!(!first.cancellation().is_cancelled());
    }
}
