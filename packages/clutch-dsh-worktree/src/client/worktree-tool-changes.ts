import type {
  WorktreeToolChange,
  WorktreeToolChangeBatch,
} from '../contract/index.js';

/** One cancellable long-poll per Client fiber, shared by Context and Surface. */
export function createWorktreeToolChangeMonitor(options: {
  read(revision: number, signal: AbortSignal): Promise<WorktreeToolChangeBatch>;
  changed(change: WorktreeToolChange): void;
  retryMs?: number;
}) {
  const listeners = new Set<(change: WorktreeToolChange) => void>();
  let controller = new AbortController();
  let started = false;
  let disposed = false;

  async function run(active: AbortController): Promise<void> {
    let revision = 0;
    while (!active.signal.aborted) {
      try {
        const batch = await options.read(revision, active.signal);
        if (active.signal.aborted) return;
        revision = batch.revision;
        for (const change of batch.changes) {
          options.changed(change);
          for (const listener of listeners) listener(change);
        }
      } catch {
        if (active.signal.aborted) return;
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            active.signal.removeEventListener('abort', wake);
            resolve();
          };
          const timer = setTimeout(wake, options.retryMs ?? 5000);
          active.signal.addEventListener('abort', wake, { once: true });
        });
      }
    }
  }

  return {
    start(): void {
      if (started || controller.signal.aborted) return;
      started = true;
      void run(controller);
    },
    reset(): void {
      if (disposed) return;
      controller.abort();
      controller = new AbortController();
      if (started) void run(controller);
    },
    subscribe(listener: (change: WorktreeToolChange) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      disposed = true;
      controller.abort();
      listeners.clear();
    },
  };
}
