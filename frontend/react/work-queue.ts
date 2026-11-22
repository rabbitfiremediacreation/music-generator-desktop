import type { QueuedDownload, WorkQueue } from "../types";

export function usesDownloadSlot(download: QueuedDownload) {
  return download.phase === "downloading" || download.phase === "verifying";
}

export function runningWorkCount(queue: WorkQueue) {
  return queue.jobs.filter(job => job.status === "running").length + queue.downloads.filter(usesDownloadSlot).length;
}
