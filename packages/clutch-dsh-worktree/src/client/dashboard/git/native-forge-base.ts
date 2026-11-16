import { useLayoutEffect } from 'react';
import { nativeDiffRequest, NativeDiffRequestTimeout, waitNativeDiffPoll } from './native-diff-wait.js';
import type { WorktreeManager, WorktreeGitRequestContext } from '../../../contract/index.js';

const SLOT = 'sidebar.right.pane.tab';
const FORGE = '@deepseek-ai/dsh-experimental-client-ui-forge/changes';
const BRIDGE = 'clutch-dsh-worktree-forge-base-bridge';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' ? value as ObjectValue : undefined;
}
interface Entry { options: { key?: string }; store?: unknown }
interface Registry {
  entriesOfSlot(key: string): readonly Entry[];
  subscribe(key: string, listener: () => void): () => void;
  register(options: ObjectValue, component: typeof Bridge): () => void;
}
interface Face { state: unknown; actions: unknown }
interface BridgeProps {
  sessionId: string;
  useStore: (select: (value: unknown) => unknown) => unknown;
  actions: unknown;
  publish: (sessionId: string, face: Face) => () => void;
}
function Bridge({ sessionId, useStore, actions, publish }: BridgeProps) {
  const state = useStore((value) => value);
  useLayoutEffect(() => publish(String(sessionId), { state, actions }), [sessionId, state, actions, publish]);
  return null;
}

export type ForgeBaseResult = 'synced' | 'unsupported' | 'no-base' | 'stale' | 'timeout';

export async function syncNativeForgeBase(
  bridge: Pick<ReturnType<typeof createNativeForgeBaseBridge>, 'sync'>,
  manager: Pick<WorktreeManager, 'listBranches'>,
  input: Parameters<ReturnType<typeof createNativeForgeBaseBridge>['sync']>[0] & WorktreeGitRequestContext,
  timeoutMs = 1500,
): Promise<ForgeBaseResult> {
  const current = () => !input.signal.aborted && input.isCurrent();
  if (!current()) return 'stale';
  let baseBranch = input.baseBranch;
  // Creation and older saved baselines can use short names. Only Host may
  // disambiguate those names; never prefix refs/heads or borrow a stale UI read.
  if (baseBranch && !baseBranch.startsWith('refs/')) {
    try {
      const branches = await nativeDiffRequest(input.signal, timeoutMs, () =>
        manager.listBranches({ workspaceId: input.workspaceId }));
      if (!current()) return 'stale';
      const matches = branches.filter((branch) => branch.name === baseBranch ||
        (branch.kind === 'remote' && 'remotes/' + branch.name === baseBranch));
      if (matches.length > 1) return 'unsupported';
      baseBranch = matches[0]?.ref;
    } catch (error) {
      if (!current()) return 'stale';
      return error instanceof NativeDiffRequestTimeout ? 'timeout' : 'unsupported';
    }
  }
  if (!current()) return 'stale';
  return bridge.sync({ ...input, baseBranch });
}

/**
 * Public Slot handle sharing, with a guarded dependency on Forge's internal
 * byTab/actions shape. Never creates a store, replaces Forge, or persists state.
 */
export function createNativeForgeBaseBridge(options: {
  slots: unknown;
  activeTab: () => { id: string; contentId?: string; kind?: string } | undefined;
  timeoutMs?: number;
  pollMs?: number;
}) {
  const slots = options.slots as Partial<Registry>;
  let entry: Entry | undefined;
  let generation = 0;
  let disposed = false;
  let release: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let request = 0;
  const faces = new Map<string, Face>();
  const find = () => slots.entriesOfSlot?.(SLOT).find((candidate) => candidate.options.key === FORGE);
  const retire = () => {
    generation++;
    faces.clear();
    const previous = release;
    release = undefined;
    entry = undefined;
    previous?.();
  };
  const reconcile = () => {
    if (disposed) return;
    try {
      const next = find();
      if (next === entry) return;
      retire();
      const handle = object(next?.store);
      const actions = object(object(handle?.spec)?.actions);
      if (!next || typeof handle?.create !== 'function' ||
          typeof actions?.based !== 'function' || typeof actions?.scoped !== 'function') return;
      entry = next;
      const epoch = generation;
      // Same handle + same Session scope gives the actual Forge instance.
      // Publishing happens after React commit, never as a side effect of inject.
      const publish = (sessionId: string, face: Face) => {
        if (disposed || epoch !== generation) return () => {};
        faces.set(sessionId, face);
        return () => { if (faces.get(sessionId) === face) faces.delete(sessionId); };
      };
      release = slots.register!({
        // Blank Sessions hide header utilities, but still mount the composer.
        name: 'conversation.input.right', id: BRIDGE,
        store: next.store, inject: () => ({ publish }),
      }, Bridge);
    } catch { retire(); }
  };
  if (typeof slots.entriesOfSlot === 'function' && typeof slots.subscribe === 'function' &&
      typeof slots.register === 'function') {
    try { unsubscribe = slots.subscribe(SLOT, reconcile); reconcile(); }
    catch { retire(); }
  }
  return {
    dispose() { disposed = true; request++; unsubscribe?.(); retire(); },
    async sync(input: {
      sessionId: string; address: string; baseBranch?: string;
      signal: AbortSignal; isCurrent: () => boolean;
    }): Promise<ForgeBaseResult> {
      const ticket = ++request;
      const ref = input.baseBranch;
      // Only exact canonical branch refs. Legacy short names/commit-only bases
      // are ambiguous and must retain native behavior.
      if (!ref || !/^refs\/(heads|remotes)\/.+/u.test(ref)) return 'no-base';
      const epoch = generation;
      const original = entry;
      let tab: ReturnType<typeof options.activeTab>;
      try { tab = options.activeTab(); } catch { return 'unsupported'; }
      if (!original || !tab || tab.kind !== 'forge-changes' || tab.contentId !== input.address) return 'unsupported';
      const deadline = Date.now() + (options.timeoutMs ?? 1500);
      const current = () => {
        if (disposed || input.signal.aborted || !input.isCurrent() || ticket !== request || epoch !== generation) return false;
        // Registry checks are synchronous: do not depend on its batched unload notification.
        if (find() !== original) return false;
        const active = options.activeTab();
        return active?.id === tab.id && active.contentId === input.address && active.kind === 'forge-changes';
      };
      try {
        while (current()) {
          // Timers may resume late after a suspended/busy browser. Readiness
          // arriving after the budget must not turn that old click into a write.
          if (Date.now() >= deadline) return 'timeout';
          const face = faces.get(input.sessionId);
          const state = object(object(face?.state)?.byTab);
          const bucket = object(state?.[tab.id]);
          if (bucket) {
            const actions = object(face?.actions);
            const base = bucket.base === null ? null : object(bucket.base);
            if (!['branch', 'uncommitted', 'staged', 'unstaged'].includes(String(bucket.scope)) ||
                (base !== null && (typeof base?.ref !== 'string' || typeof base?.name !== 'string')) ||
                typeof bucket.navigated !== 'number' ||
                typeof actions?.based !== 'function' || typeof actions?.scoped !== 'function') return 'unsupported';
            if (!current()) return 'stale';
            if (Date.now() >= deadline) return 'timeout';
            // Use native actions: both clear obsolete selected commits. No await
            // separates the final identity check and the synchronous mutations.
            actions.scoped(tab.id, 'branch');
            actions.based(tab.id, { ref, name: ref.replace(/^refs\/(heads|remotes)\//u, '') });
            return 'synced';
          }
          await waitNativeDiffPoll(input.signal, Math.min(options.pollMs ?? 25, Math.max(0, deadline - Date.now())));
        }
        return 'stale';
      } catch { return 'unsupported'; }
    },
  };
}
