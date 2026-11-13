import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const HEAD_DEBOUNCE_MS = 100;

export interface WorkspaceCheckoutWatcherOptions {
  /** Host lifecycle gate; a disposed service must stop reporting changes. */
  readonly isDisposed: () => boolean;
  /** Report one Workspace-local checkout observation; never a mutation. */
  readonly onChanged: (workspaceId: string, gitRootPath: string) => void;
  readonly debounceMs?: number;
}

interface WatchEntry {
  readonly gitRootPath: string;
  readonly watcher: FSWatcher;
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
  private readonly pending = new Map<string, string>();
  private disposed = false;

  constructor(private readonly options: WorkspaceCheckoutWatcherOptions) {}

  /** Ensure the checkout root is watched; repeated calls with the same root are inert. */
  async observe(workspaceId: string, gitRootPath: string | undefined): Promise<void> {
    if (this.disposed || gitRootPath === undefined || gitRootPath.length === 0) return;
    const current = this.entries.get(workspaceId);
    if (current?.gitRootPath === gitRootPath) return;
    if (this.pending.get(workspaceId) === gitRootPath) return;
    this.pending.set(workspaceId, gitRootPath);
    try {
      const gitDir = await resolveGitDir(gitRootPath);
      if (this.disposed || this.pending.get(workspaceId) !== gitRootPath) return;
      if (gitDir === undefined) return;
      this.close(workspaceId);
      const entry = this.start(workspaceId, gitRootPath, gitDir);
      this.entries.set(workspaceId, entry);
    } catch {
      // Missing or unreadable checkouts keep the existing explicit refresh behavior.
    } finally {
      if (this.pending.get(workspaceId) === gitRootPath) this.pending.delete(workspaceId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const workspaceId of [...this.entries.keys()]) this.close(workspaceId);
    this.pending.clear();
  }

  private start(workspaceId: string, gitRootPath: string, gitDir: string): WatchEntry {
    const entry: WatchEntry = {
      gitRootPath,
      watcher: watch(gitDir, { persistent: false }, (_event, filename) => {
        if (filename !== null && String(filename).toLowerCase() !== 'head') return;
        this.schedule(workspaceId, entry);
      }),
    };
    entry.watcher.on('error', () => this.close(workspaceId));
    return entry;
  }

  private schedule(workspaceId: string, entry: WatchEntry): void {
    if (this.disposed || this.entries.get(workspaceId) !== entry) return;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (this.disposed || this.entries.get(workspaceId) !== entry) return;
      this.options.onChanged(workspaceId, entry.gitRootPath);
    }, this.options.debounceMs ?? HEAD_DEBOUNCE_MS);
    entry.timer.unref?.();
  }

  private close(workspaceId: string): void {
    const entry = this.entries.get(workspaceId);
    if (entry === undefined) return;
    this.entries.delete(workspaceId);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.watcher.close();
  }
}
