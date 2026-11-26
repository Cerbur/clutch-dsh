import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { Context } from '@deepseek-ai/cordis';
import { realpath } from 'node:fs/promises';
import { gitWorktreeRoot, type WorktreeRecord } from '../contract/index.js';
import { LocalGitAdapter } from '../provider/git/adapter.js';
import { samePhysicalPath } from '../provider/path-identity.js';
import type { GitSubprocessRuntime } from '../provider/types.js';

export interface NativeForgeWorktree {
  path: string;
  branch: string;
  from: string | null;
  baseCommit: string;
  repositoryRoot: string;
}

interface ForgeSession {
  readonly header: { readonly cwd?: string };
  snapshotEvents(): readonly SessionEvent[];
}

export interface ForgeAgent {
  readonly session: ForgeSession;
  runMaintenance(work: (signal: AbortSignal) => Promise<void>): Promise<void>;
}

const RECORD = 'plugin:client-ui-forge/worktree';

/** New Sessions only. DSH owns these records after this producer unloads. */
export async function initializeForgeSession(
  ctx: Context, agent: ForgeAgent, record: WorktreeRecord, signal: AbortSignal,
  bind: (control: AbortSignal) => Promise<void>,
  onDirectoryEntry?: () => void,
): Promise<void> {
  // Resolve the host runtime without merging its Cordis SessionStore into the
  // browser's Context in this package's shared compilation.
  const packageName: string = '@deepseek-ai/dsh-session';
  const { appendPluginRecord, pluginRecordOf } = await import(packageName) as {
    appendPluginRecord(session: ForgeSession, type: string, data: unknown): unknown;
    pluginRecordOf(event: SessionEvent): { type: string } | undefined;
  };
  const directories = ctx.get('workingDirectory') as {
    get(session: ForgeSession): string;
    set(agent: ForgeAgent, cwd: string, signal: AbortSignal): Promise<string>;
  };
  const sessions = ctx.get('sessions') as unknown as { flush(session: ForgeSession): Promise<boolean> };
  if (typeof agent.runMaintenance !== 'function' || typeof sessions?.flush !== 'function')
    throw new Error('Native Agent maintenance and Session durability are required for Forge Worktree Sessions');
  const original = agent.session.header.cwd;
  if (!original) throw new Error('Native Session has no original Workspace');
  await agent.runMaintenance(async (maintenance) => {
    const control = AbortSignal.any([signal, maintenance]);
    control.throwIfAborted();
    if (agent.session.snapshotEvents().some(event =>
      event.type === 'turn/start' || event.type === 'step/start' || pluginRecordOf(event)?.type === RECORD))
      throw new Error('Forge initialization requires a new, unstarted Session without Worktree records');
    const git = new LocalGitAdapter({ signal: control, subprocess: ctx.get('subprocess') as GitSubprocessRuntime | undefined });
    const repositoryRoot = await git.resolveRepositoryRoot(original);
    const path = await realpath(gitWorktreeRoot(record));
    if (!await samePhysicalPath(await git.resolveRepositoryRoot(record.absolutePath), path))
      throw new Error('Worktree execution directory no longer belongs to its recorded checkout');
    const live = await git.listWorktrees(repositoryRoot);
    let matched = false;
    for (const entry of live) {
      if (entry.branch === record.branch && !entry.detached && await samePhysicalPath(entry.absolutePath, path)) matched = true;
    }
    if (!matched) throw new Error('Worktree branch or checkout identity changed before native registration');
    const baseCommit = await git.resolveCommit(path, record.baseCommit ?? 'HEAD');
    const worktree: NativeForgeWorktree = { path, branch: record.branch, from: null, baseCommit, repositoryRoot };
    let requested = false;
    let created = false;
    try {
      // Directory notices insert into the native inbox. No open Forge request may exist yet.
      onDirectoryEntry?.();
      await directories.set(agent, record.absolutePath, control);
      control.throwIfAborted();
      appendPluginRecord(agent.session, RECORD, { action: 'request', from: null });
      requested = true;
      appendPluginRecord(agent.session, RECORD, { action: 'created', worktree });
      created = true;
      if (!await sessions.flush(agent.session)) throw new Error('Native Session persistence did not acknowledge Forge records');
      control.throwIfAborted();
    } catch (error) {
      // Do not leave an open creation request that would create a nested checkout.
      if (requested && !created) appendPluginRecord(agent.session, RECORD, { action: 'cancel' });
      // Prevent partial initialization from masquerading as a reusable Worktree blank.
      // A native Stop cancels maintenance too. Its callback still owns the
      // maintenance slot until return; bounded cleanup must not reuse that
      // cancelled signal. The native service still enforces Agent disposal.
      await directories.set(agent, original, AbortSignal.timeout(10_000));
      await sessions.flush(agent.session);
      throw error;
    }
    await bind(control);
    // Stop can arrive while the Sidecar commit owns its lock. Keep any
    // committed binding, but do not admit the queued first task afterwards.
    if (control.aborted) throw new Error('Worktree Session initialization was cancelled before task dispatch', { cause: control.reason });
  });
}
