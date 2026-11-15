/** One cancellable poll; never leave a timer behind after a Dashboard closes. */
export function waitNativeDiffPoll(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export interface NativeDiffDiagnostic {
  readonly phase: string;
  readonly elapsedMs: number;
  readonly result?: string;
}

export class NativeDiffRequestTimeout extends Error {}

/** Bound a request even when an injected adapter ignores cancellation. */
export async function nativeDiffRequest<T>(signal: AbortSignal, timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  try {
    return await new Promise<T>((resolve, reject) => {
      const cancelled = () => reject(timedOut ? new NativeDiffRequestTimeout() : new Error('Native Diff action cancelled'));
      if (controller.signal.aborted) return cancelled();
      controller.signal.addEventListener('abort', cancelled, { once: true });
      void run(controller.signal).then(resolve, reject).finally(() =>
        controller.signal.removeEventListener('abort', cancelled));
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Diagnostics contain phase/timing only, never Session ids, paths or RPC payloads. */
export function nativeDiffReporter(observer?: (event: NativeDiffDiagnostic) => void) {
  const started = Date.now();
  return (phase: string, result?: string) => {
    try { observer?.({ phase, elapsedMs: Date.now() - started, ...(result === undefined ? {} : { result }) }); }
    catch { /* Diagnostic consumers cannot change navigation. */ }
  };
}
