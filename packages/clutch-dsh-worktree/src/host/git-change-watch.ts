import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Ephemeral leases keep filesystem watches continuous across bounded /api waits.
 * No Git snapshots or paths cross the wire. Lost clients expire after 15 seconds. */
export class GitChangeWatches {
  private readonly leases = new Map<string, {
    revision: number; watchers: FSWatcher[]; wake: Set<() => void>;
    expiry?: ReturnType<typeof setTimeout>; debounce?: ReturnType<typeof setTimeout>;
    startup?: ReturnType<typeof setTimeout>;
  }>();
  private disposed = false;

  async start(root: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (this.disposed) throw new Error('Worktree plugin is disposed');
    const id = randomUUID();
    const lease = { revision: 0, watchers: [] as FSWatcher[], wake: new Set<() => void>(),
      expiry: undefined as ReturnType<typeof setTimeout> | undefined,
      startup: undefined as ReturnType<typeof setTimeout> | undefined,
      debounce: undefined as ReturnType<typeof setTimeout> | undefined };
    this.leases.set(id, lease);
    this.renew(id);
    const notify = () => {
      if (!this.leases.has(id)) return;
      clearTimeout(lease.debounce);
      lease.debounce = undefined;
      lease.revision++;
      for (const wake of lease.wake) wake();
    };
    const changed = () => {
      if (!this.leases.has(id) || lease.debounce) return;
      lease.debounce = setTimeout(notify, 200);
    };
    const observe = (directory: string, recursive: boolean, accepts: (name: string) => boolean) => {
      if (!this.leases.has(id) || signal.aborted) return;
      try {
        const watcher = watch(directory, { recursive, persistent: false }, (_event, name) => {
          if (name === null || accepts(String(name).replaceAll('\\', '/'))) changed();
        });
        watcher.on('error', () => watcher.close()); // The client retains its 60s fallback.
        lease.watchers.push(watcher);
      } catch { /* Unsupported/missing watcher: retain low-frequency refresh. */ }
    };
    try {
      observe(root, true, (name) => !name.split('/').includes('.git'));
      let gitDir = path.join(root, '.git');
      if ((await stat(gitDir)).isFile()) {
        const pointer = /^gitdir:\s*(.+)\s*$/u.exec((await readFile(gitDir, 'utf8')).trim());
        if (!pointer) throw new Error('Invalid gitdir');
        gitDir = path.resolve(root, pointer[1]!);
      }
      let common = gitDir;
      try { common = path.resolve(gitDir, (await readFile(path.join(gitDir, 'commondir'), 'utf8')).trim()); }
      catch { /* Normal checkouts have no commondir. */ }
      const metadata = (name: string) => ['HEAD', 'index', 'packed-refs', 'commondir', 'config', 'refs'].includes(name);
      observe(gitDir, false, metadata);
      if (common !== gitDir) observe(common, false, metadata);
      observe(path.join(common, 'refs'), true, (name) => !name.endsWith('.lock'));
      if (common !== gitDir) observe(path.join(gitDir, 'refs'), true, (name) => !name.endsWith('.lock'));
    } catch { /* File watching is advisory, never a prerequisite for readable Git data. */ }
    if (signal.aborted || this.disposed) {
      this.stop(id);
      signal.throwIfAborted();
      throw new Error('Worktree plugin is disposed');
    }
    // fs.watch has no ready barrier. In particular, macOS can drop the first write
    // while multiple directory streams are being registered. Request one delayed
    // reconciliation instead of treating start() as proof of native readiness.
    // This is not a readiness guarantee; the 60s client fallback remains necessary.
    if (lease.watchers.length > 0) lease.startup = setTimeout(() => {
      lease.startup = undefined;
      notify();
    }, 1000);
    return id;
  }

  private renew(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    clearTimeout(lease.expiry);
    lease.expiry = setTimeout(() => this.stop(id), 15_000);
    lease.expiry.unref();
  }

  async next(id: string, afterRevision: number, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) throw new Error('Invalid revision');
    const lease = this.leases.get(id);
    if (!lease) throw new Error('Git watch expired');
    this.renew(id);
    if (lease.revision === afterRevision) await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        lease.wake.delete(done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      // Desktop drains API reads before Host disposal; keep every wait below 10s.
      const timer = setTimeout(done, 5000);
      lease.wake.add(done);
      signal.addEventListener('abort', done, { once: true });
    });
    signal.throwIfAborted();
    if (!this.leases.has(id)) throw new Error('Git watch expired');
    return lease.revision;
  }

  stop(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    this.leases.delete(id);
    clearTimeout(lease.expiry);
    clearTimeout(lease.debounce);
    clearTimeout(lease.startup);
    for (const watcher of lease.watchers) watcher.close();
    for (const wake of [...lease.wake]) wake();
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.leases.keys()) this.stop(id);
  }
}
