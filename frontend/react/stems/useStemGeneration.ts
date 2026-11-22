import { useQuery, useQueryClient } from "@tanstack/react-query";
import { stemApi, type StemGenerationProgress, type StemGenerationRequest, type StemLayer } from "../../stems";

export interface RunningStemGeneration {
  status: "running";
  attempt: symbol;
  progress?: StemGenerationProgress;
  cancelling?: boolean;
  cancelError?: unknown;
}

type Task = RunningStemGeneration | { status: "done"; layer: StemLayer } | { status: "error"; cause: unknown };
type Tasks = Partial<Record<string, Task>>;
const key = ["stem-generation"] as const;
const anyRunning = (tasks: Tasks) => Object.values(tasks).some(task => task?.status === "running");

/** Keep running jobs and their unclaimed results available across mixer navigation. */
export function useStemGeneration(id?: string) {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: key, queryFn: () => ({} as Tasks), enabled: false, gcTime: Infinity,
    select: tasks => ({ task: id ? tasks[id] : undefined, occupied: anyRunning(tasks) }),
  });
  const task = data?.task;

  function read() {
    return client.getQueryData<Tasks>(key) ?? {};
  }

  function update(project: string, next: Task | undefined) {
    const tasks = { ...read() };
    if (next) tasks[project] = next;
    else delete tasks[project];
    client.setQueryData(key, tasks);
  }

  function activeAttempt(project: string, attempt: symbol) {
    const active = read()[project];
    return active?.status === "running" && active.attempt === attempt ? active : undefined;
  }

  async function start(request: StemGenerationRequest) {
    const tasks = read();
    if (!id || anyRunning(tasks) || tasks[id]?.status === "done") return;
    const attempt = Symbol();
    update(id, { status: "running", attempt });
    try {
      const layer = await stemApi.generateTrack(id, request, progress => {
        const active = activeAttempt(id, attempt);
        if (active) update(id, { ...active, progress });
      });
      if (activeAttempt(id, attempt)) update(id, { status: "done", layer });
    } catch (cause) {
      if (!activeAttempt(id, attempt)) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      update(id, message === "Operation cancelled" ? undefined : { status: "error", cause });
    }
  }

  async function cancel() {
    if (!id) return;
    const active = read()[id];
    if (active?.status !== "running" || active.cancelling || !active.progress) return;
    update(id, { ...active, cancelling: true, cancelError: undefined });
    try { await stemApi.cancelTrackGeneration(active.progress.job_id); }
    catch (cause) {
      const latest = activeAttempt(id, active.attempt);
      if (latest) update(id, { ...latest, cancelling: false, cancelError: cause });
    }
  }

  function takeResult() {
    if (!id) return;
    const result = read()[id];
    if (result?.status !== "done") return;
    update(id, undefined);
    return result.layer;
  }

  return {
    start, cancel, takeResult, occupied: data?.occupied ?? false,
    running: task?.status === "running" ? task : undefined,
    result: task?.status === "done" ? task.layer : undefined,
    error: task?.status === "error" ? task.cause : undefined,
  };
}
