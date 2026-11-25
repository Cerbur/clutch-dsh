import type { CallingAgent } from './types.js';
import type { Context } from '@deepseek-ai/cordis';
import {
  createNativeTaskSessionPort, type ForgeSessionGate, type NativeAgent, type NativeContext, type NativeSessionController,
} from '../host/native-session.js';
export {
  createNativeWorktreeSessionDirectoryPort, NativeSessionCreationPreflightError, WorktreeDirectoryEntryNotStarted,
} from '../host/native-session.js';
import { createAgentRelaySender, type AgentRelayInput } from './agent-relay.js';
import type { WorktreeRecord } from '../contract/index.js';

export interface ToolModel {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

export interface ToolModelCatalog {
  readonly default: ToolModel;
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly models: readonly {
      readonly id: string;
      readonly name: string;
      readonly reasoning?: {
        readonly efforts: readonly { readonly id: string; readonly name: string }[];
        readonly defaultEffort?: string;
      };
    }[];
  }[];
  readonly failures: readonly { readonly id: string; readonly message: string }[];
}

export interface ToolSessionEvent {
  readonly seq: number;
  readonly time: number;
  readonly type: string;
  readonly data: unknown;
}

export interface ToolSessionSnapshot {
  readonly events: readonly ToolSessionEvent[];
  readonly running: boolean;
  readonly values: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

/** Host-only native capabilities; never added to the Provider's read adapter. */
export interface WorktreeToolSessionPort {
  resolveAgent(sessionId: string, signal: AbortSignal): Promise<CallingAgent>;
  sendAgentMessage(input: AgentRelayInput, signal: AbortSignal): Promise<{ accepted: true }>;
  create(input: { cwd: string; workspaceId?: string }, signal?: AbortSignal): Promise<{ sessionId: string }>;
  /** Native directory publication; optional only for legacy injected adapters. */
  enterWorkingDirectory?(sessionId: string, cwd: string, signal: AbortSignal): Promise<void>;
  initializeWorktreeSession?(sessionId: string, record: WorktreeRecord, signal: AbortSignal, bind: () => Promise<void>): Promise<void>;
  assertWorkingDirectory?(sessionId: string, cwd: string, signal: AbortSignal): Promise<void>;
  prompt(
    input: {
      sessionId: string;
      requestId: string;
      mode: 'queue' | 'steer';
      content: readonly { type: 'text'; text: string }[];
    },
    signal: AbortSignal,
  ): Promise<{ accepted: true }>;
  rename(input: { sessionId: string; title: string }): Promise<unknown>;
  modelCatalog(): Promise<ToolModelCatalog>;
  currentModel(sessionId: string, signal: AbortSignal): Promise<ToolModel>;
  validateModel(model: ToolModel, signal: AbortSignal): Promise<ToolModel>;
  configureModel(sessionId: string, model: ToolModel, signal: AbortSignal): Promise<void>;
  snapshot(sessionId: string, signal: AbortSignal): Promise<ToolSessionSnapshot>;
  subscribe(sessionIds: readonly string[], changed: () => void): () => void;
}

/** Native reads stay cold; model routing is installed only on a newly created Agent. */
export function createWorktreeToolSessionPort(ctx: Context, forge?: ForgeSessionGate): WorktreeToolSessionPort {
  const native = ctx as unknown as NativeContext;
  const controller = ctx.get('sessionController') as NativeSessionController;
  const relay = createAgentRelaySender({
    getAgent: (id) => native.agents.get(id),
    resolveAgent: async (id) => {
      const result = await controller.resolveAgent(id);
      if ('error' in result) throw result.error;
      return result.agent;
    },
    observeSession: (id, options) => native.sessionQuery.observeSession(id, options),
  });
  const disposeRelayAgent = native.on('agent/disposed', ((event: { agent: CallingAgent }) => {
    relay.revoke(event.agent);
  }) as (...args: never[]) => void, { global: true });
  const errors = new Map<string, string>();
  const questions = new Map<string, number>();
  const listeners = new Set<{ ids: ReadonlySet<string>; changed(): void }>();
  const notify = (id: string) => {
    for (const listener of listeners) if (listener.ids.has(id)) listener.changed();
  };
  const disposeQuestions = native.on(
    'user-questions/request',
    (async (request: { agent?: NativeAgent }, next: () => Promise<unknown>) => {
      const id = request.agent?.session.id;
      if (id === undefined) return next();
      questions.set(id, (questions.get(id) ?? 0) + 1);
      notify(id);
      try {
        return await next();
      } finally {
        const remaining = (questions.get(id) ?? 1) - 1;
        if (remaining === 0) questions.delete(id);
        else questions.set(id, remaining);
        notify(id);
      }
    }) as (...args: never[]) => void,
    { global: true },
  );
  const disposeError = native.on(
    'api-session/error',
    ((id: string, message: string) => {
      if (errors.size >= 128) errors.delete(errors.keys().next().value!);
      errors.set(id, message);
    }) as (...args: never[]) => void,
    { global: true },
  );
  const disposeStart = native.on(
    'session/event',
    ((session: { id: string }, event: ToolSessionEvent) => {
      if (event.type === 'turn/start') errors.delete(session.id);
    }) as (...args: never[]) => void,
    { global: true },
  );
  ctx.effect(
    () => () => {
      relay.dispose();
      disposeRelayAgent();
      disposeError();
      disposeStart();
      disposeQuestions();
      errors.clear();
      questions.clear();
      listeners.clear();
    },
    'clutch-dsh-worktree: Session tool routing cleanup',
  );

  const snapshot: WorktreeToolSessionPort['snapshot'] = async (sessionId, signal) => {
    signal.throwIfAborted();
    using observed = await native.sessionQuery.observeSession(sessionId, { signal });
    signal.throwIfAborted();
    return {
      events: observed.events,
      values: {
        ...observed.projections?.values,
        worktreeToolWaitingForUser: questions.has(sessionId),
      },
      running: native.agents.get(sessionId)?.status === 'running',
      ...(errors.has(sessionId) ? { error: errors.get(sessionId) } : {}),
    };
  };

  return {
    resolveAgent: async (sessionId, signal) => {
      signal.throwIfAborted();
      const result = await controller.resolveAgent(sessionId);
      if ('error' in result) throw result.error;
      signal.throwIfAborted();
      return result.agent;
    },
    ...createNativeTaskSessionPort(ctx, forge),
    sendAgentMessage: (input, signal) => relay.send(input, signal),
    snapshot,
    currentModel: async (sessionId, signal) => {
      signal.throwIfAborted();
      const live = native.agents.get(sessionId)?.model?.current();
      if (live) return { ...live };
      const value = await snapshot(sessionId, signal);
      const selection = value.values.modelSelection as {
        next?: ToolModel | null; pending?: ToolModel | null; lastUsed?: ToolModel | null;
      } | undefined;
      if (selection?.pending) return { ...selection.pending };
      if (selection?.next) return { ...selection.next };
      if (selection?.lastUsed) return { ...selection.lastUsed };
      const header = native.agents.get(sessionId)?.session.requestHeader();
      if (header) {
        const { reasoningEffort, ...route } = header.config;
        return {
          provider: route.provider,
          model: route.model,
          ...(reasoningEffort === undefined || header.adapterDefaults?.reasoningEffort
            ? {}
            : { reasoningEffort }),
        };
      }
      return { ...(await controller.modelCatalog()).default };
    },
    subscribe: (sessionIds, changed) => {
      const ids = new Set(sessionIds);
      const listener = { ids, changed };
      listeners.add(listener);
      const event = native.on(
        'session/event',
        ((session: { id: string }) => {
          if (ids.has(session.id)) changed();
        }) as (...args: never[]) => void,
        { global: true },
      );
      const status = native.on(
        'agent/status',
        ((value: { agent: NativeAgent }) => {
          if (ids.has(value.agent.session.id)) changed();
        }) as (...args: never[]) => void,
        { global: true },
      );
      const error = native.on(
        'api-session/error',
        ((id: string) => {
          if (ids.has(id)) changed();
        }) as (...args: never[]) => void,
        { global: true },
      );
      return () => {
        event();
        status();
        error();
        listeners.delete(listener);
      };
    },
  };
}
