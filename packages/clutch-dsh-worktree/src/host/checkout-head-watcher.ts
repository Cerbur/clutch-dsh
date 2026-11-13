import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GitCheckoutHead } from '../contract/index.js';

const HEAD_DEBOUNCE_MS = 100;

export interface WorkspaceCheckoutWatcherOptions {
  /** Host lifecycle gate; a disposed service must stop reporting changes. */
  readonly isDisposed: () => boolean;
  /** Report one Workspace-local checkout observation; never a mutation. */
  readonly onChanged: (workspaceId: string, gitRootPath: string) => void;
  readonly debounceMs?: number;
  readonly pollIntervalMs?: number;
}

interface WatchEntry {
  readonly gitRootPath: string;
  readonly headPath: string;
  head: string;
  navigationHead?: string;
  watcher?: FSWatcher;
  poll?: NodeJS.Timeout;
  reading?: boolean;
  timer?: NodeJS.Timeout;
}

async function resolveGitDir(gitRootPath: string): Promise<string | undefined> {
  const dotGit = path.join(gitRootPath, '.git');
  const info = await stat(dotGit);
  if (info.isDirectory()) return dotGit;
  if (!info.isFile()) return undefined;
  const content = await readFile(dotGit, 'utf8');
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(content);
  const target = match?.[1];
  if (target === undefined || target.length === 0) return undefined;
  return path.resolve(gitRootPath, target);
}

/**
 * Watches each Workspace checkout's HEAD so an external branch switch refreshes only
 * that Workspace's Local projection. Paths outside a checkout, working-tree files, and
 * index writes are ignored; an unavailable checkout keeps the explicit refresh path.
 */
export class WorkspaceCheckoutWatcher {
  private readonly entries = new Map<string, WatchEntry>();
  private readonly pending = new Map<string, { gitRootPath: string; token: symbol; promise: Promise<WatchEntry | undefined> }>();
  private disposed = false;

  constructor(private readonly options: WorkspaceCheckoutWatcherOptions) {}

  /** Reuse the listener, but reconcile each returned navigation snapshot against HEAD. */
  async observe(workspaceId: string, gitRootPath: string | undefined, navigationHead?: GitCheckoutHead): Promise<void> {
    if (this.disposed || this.options.isDisposed() || gitRootPath === undefined || gitRootPath.length === 0) return;
    const entry = await this.ensure(workspaceId, gitRootPath);
    if (entry === undefined || this.disposed || this.options.isDisposed() || this.entries.get(workspaceId) !== entry) return;
    if (navigationHead !== undefined) {
      entry.navigationHead = navigationHead.kind === 'branch'
        ? `ref: refs/heads/${navigationHead.name}` : navigationHead.commit;
      this.schedule(workspaceId, entry);
    }
  }

  private ensure(workspaceId: string, gitRootPath: string): Promise<WatchEntry | undefined> {
    const current = this.entries.get(workspaceId);
    if (current?.gitRootPath === gitRootPath) {
      this.pending.delete(workspaceId);
      return Promise.resolve(current);
    }
    const pending = this.pending.get(workspaceId);
    if (pending?.gitRootPath === gitRootPath) return pending.promise;
    const token = Symbol();
    const promise = this.create(workspaceId, gitRootPath, token);
    this.pending.set(workspaceId, { gitRootPath, token, promise });
    return promise;
  }

  private async create(workspaceId: string, gitRootPath: string, token: symbol): Promise<WatchEntry | undefined> {
    try {
      const gitDir = await resolveGitDir(gitRootPath);
      if (gitDir === undefined) return;
      const head = await readFile(path.join(gitDir, 'HEAD'), 'utf8');
      if (this.disposed || this.options.isDisposed() || this.pending.get(workspaceId)?.token !== token) return;
      this.close(workspaceId);
      const entry = this.start(workspaceId, gitRootPath, gitDir, head);
      this.entries.set(workspaceId, entry);
      // Close the gap between the baseline read and listener registration.
      this.schedule(workspaceId, entry);
      return entry;
    } catch {
      // Missing or unreadable checkouts keep the existing explicit refresh behavior.
    } finally {
      if (this.pending.get(workspaceId)?.token === token) this.pending.delete(workspaceId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const workspaceId of [...this.entries.keys()]) this.close(workspaceId);
    this.pending.clear();
  }

  private start(workspaceId: string, gitRootPath: string, gitDir: string, head: string): WatchEntry {
    const entry: WatchEntry = {
      gitRootPath,
      headPath: path.join(gitDir, 'HEAD'),
      head,
    };
    // Directory notifications can be lost (including during macOS watcher startup).
    // Poll only HEAD, never Git projections or business files, and share deduplication.
    entry.poll = setInterval(() => void this.check(workspaceId, entry), this.options.pollIntervalMs ?? 1000);
    entry.poll.unref?.();
    try {
      entry.watcher = watch(gitDir, { persistent: false }, (_event, filename) => {
        if (filename !== null && String(filename).toLowerCase() !== 'head') return;
        this.schedule(workspaceId, entry);
      });
      entry.watcher.on('error', () => {
        entry.watcher?.close();
        entry.watcher = undefined;
      });
    } catch {
      // A watcher resource limit must not silently disable HEAD observation.
    }
    return entry;
  }

  private async check(workspaceId: string, entry: WatchEntry): Promise<void> {
    if (this.disposed || this.options.isDisposed() || this.entries.get(workspaceId) !== entry || entry.reading) return;
    entry.reading = true;
    try {
      const head = await readFile(entry.headPath, 'utf8');
      if (this.disposed || this.options.isDisposed() || this.entries.get(workspaceId) !== entry) return;
      // Ignore transient truncation; the next event or poll reads the completed write.
      if (head.trim().length === 0) return;
      const staleNavigation = entry.navigationHead !== undefined && head.trim() !== entry.navigationHead;
      entry.navigationHead = undefined;
      if (head === entry.head && !staleNavigation) return;
      entry.head = head;
      this.options.onChanged(workspaceId, entry.gitRootPath);
    } catch {
      // Unavailable HEAD keeps explicit refresh semantics; polling can recover later.
    } finally {
      entry.reading = false;
    }
  }

  private schedule(workspaceId: string, entry: WatchEntry): void {
    if (this.disposed || this.entries.get(workspaceId) !== entry) return;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (this.disposed || this.entries.get(workspaceId) !== entry) return;
      void this.check(workspaceId, entry);
    }, this.options.debounceMs ?? HEAD_DEBOUNCE_MS);
    entry.timer.unref?.();
  }

  private close(workspaceId: string): void {
    const entry = this.entries.get(workspaceId);
    if (entry === undefined) return;
    this.entries.delete(workspaceId);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.poll !== undefined) clearInterval(entry.poll);
    entry.watcher?.close();
  }
}
