import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  WORKTREE_TOOL_IDS,
  type WorktreeToolSelection,
  type WorktreeToolSettingsScope,
} from '../contract/tool-settings.js';

/** Preferences have their own files; relationship shards never contain tool configuration. */
export class WorktreeToolSettings {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<
    (scope: WorktreeToolSettingsScope, selection: WorktreeToolSelection) => void
  >();
  constructor(private readonly dshHome: string) {}

  subscribe(
    listener: (scope: WorktreeToolSettingsScope, selection: WorktreeToolSelection) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private filename(scope: WorktreeToolSettingsScope): string {
    const root = path.join(this.dshHome, 'clutch-dsh-worktree', 'tool-settings');
    if (scope.kind === 'general') return path.join(root, 'general.json');
    if (scope.kind === 'local' && scope.workspaceId)
      return path.join(root, 'locals', 'ws-' + encodeURIComponent(scope.workspaceId) + '.json');
    if (scope.kind !== 'worktree' || !scope.workspaceId || !scope.worktreeId)
      throw new Error('Invalid tool settings scope');
    return path.join(
      root,
      'worktrees',
      'ws-' + encodeURIComponent(scope.workspaceId),
      'wt-' + encodeURIComponent(scope.worktreeId) + '.json',
    );
  }

  async read(scope: WorktreeToolSettingsScope): Promise<WorktreeToolSelection> {
    try {
      const text = await readFile(this.filename(scope), 'utf8');
      if (text.length > 32_000) throw new Error('Tool settings file is too large');
      const data = JSON.parse(text) as { version?: unknown; selection?: unknown };
      if (data.version !== 1) throw new Error('Unsupported tool settings version');
      return normalizeToolSelection(data.selection);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      return { enabled: false, tools: [...WORKTREE_TOOL_IDS] };
    }
  }

  update(
    scope: WorktreeToolSettingsScope,
    selection: WorktreeToolSelection,
    expected: WorktreeToolSelection,
  ): Promise<WorktreeToolSelection> {
    const operation = this.queue.then(async () => {
      const next = normalizeToolSelection(selection);
      const current = await this.read(scope);
      if (JSON.stringify(current) !== JSON.stringify(normalizeToolSelection(expected)))
        throw new Error('Tool settings changed elsewhere. Reload the settings and try again.');
      const filename = this.filename(scope);
      const directory = path.dirname(filename);
      await mkdir(directory, { recursive: true });
      const temporary = filename + '.' + randomUUID() + '.tmp';
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({ version: 1, selection: next }) + '\n');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, filename);
        // Only directory syncing is best effort; file syncing must succeed before publication.
        try {
          const directoryHandle = await open(directory, 'r');
          try {
            await directoryHandle.sync();
          } finally {
            await directoryHandle.close();
          }
        } catch {
          /* Filesystems may not support directory syncing. */
        }
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      for (const listener of this.listeners) listener(scope, next);
      return next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

export function normalizeToolSelection(value: unknown): WorktreeToolSelection {
  const selection = value as Partial<WorktreeToolSelection> | null;
  if (
    !selection ||
    typeof selection.enabled !== 'boolean' ||
    !Array.isArray(selection.tools) ||
    selection.tools.some((tool) => !WORKTREE_TOOL_IDS.includes(tool))
  )
    throw new Error('Invalid Worktree tool selection');
  const tools = WORKTREE_TOOL_IDS.filter((tool) => selection.tools!.includes(tool));
  return { enabled: selection.enabled && tools.length > 0, tools };
}
