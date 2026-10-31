import type { CallingAgent } from './types.js';
import type { Context } from '@deepseek-ai/cordis';
import { samePhysicalPath } from '../provider/path-identity.js';
import { createAgentRelaySender, type AgentRelayInput, type RelayAgent } from './agent-relay.js';

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
  create(input: { cwd: string; workspaceId?: string }): Promise<{ sessionId: string }>;
  /** Native directory publication; optional only for legacy injected adapters. */
  enterWorkingDirectory?(sessionId: string, cwd: string, signal: AbortSignal): Promise<void>;
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

interface NativeAgent extends RelayAgent {
  readonly session: {
    readonly id: string;
    requestHeader():
      { config: ToolModel; adapterDefaults?: { reasoningEffort?: boolean } } | undefined;
  };
  readonly ctx: Context;
  readonly status: string;
}

interface NativeSessionController {
  create(input: { cwd?: string; workspaceId?: string }): Promise<{ sessionId: string }>;
  prompt: WorktreeToolSessionPort['prompt'];
  rename: WorktreeToolSessionPort['rename'];
  modelCatalog: WorktreeToolSessionPort['modelCatalog'];
  resolveAgent(id: string): Promise<{ agent: NativeAgent } | { error: Error }>;
}

interface NativeObservation extends Disposable {
  readonly events: readonly ToolSessionEvent[];
  readonly projections?: { readonly values: Readonly<Record<string, unknown>> };
}

interface NativeContext {
  on(name: string, listener: (...args: never[]) => void, options: { global: true }): () => void;
  readonly agents: { get(id: string): NativeAgent | undefined };
  readonly sessionQuery: {
    observeSession(id: string, options: { signal: AbortSignal }): Promise<NativeObservation>;
  };
  readonly llm: { resolveCallConfig(model: ToolModel, signal: AbortSignal): Promise<ToolModel> };
}

/** Only thrown by capability preflight, before invoking native Session creation. */
export class NativeSessionCreationPreflightError extends Error {}

/** Minimal native Session creation/directory seam; browser creation needs no commands, tools or model provider. */
export function createNativeWorktreeSessionDirectoryPort(ctx: Context): Pick<WorktreeToolSessionPort,
  'create' | 'enterWorkingDirectory' | 'assertWorkingDirectory'> {
  const native = ctx as unknown as NativeContext;
  const controller = ctx.get('sessionController') as NativeSessionController;
  return {
    create: (input) => {
      if (input.workspaceId === undefined) return controller.create({ cwd: input.cwd });
      const directories = ctx.get('workingDirectory') as { set?: unknown } | undefined;
      if (typeof directories?.set !== 'function') throw new NativeSessionCreationPreflightError('Native workingDirectory service is required for Workspace-owned Worktree Sessions');
      return controller.create({ workspaceId: input.workspaceId });
    },
    enterWorkingDirectory: async (sessionId, cwd, signal) => {
      signal.throwIfAborted();
      const directories = ctx.get('workingDirectory') as {
        set(agent: NativeAgent, path: string, signal: AbortSignal): Promise<string>;
      } | undefined;
      if (typeof directories?.set !== 'function') throw new Error('Native workingDirectory service is unavailable');
      const result = await controller.resolveAgent(sessionId);
      if ('error' in result) throw result.error;
      signal.throwIfAborted();
      if (result.agent.session.id !== sessionId || native.agents.get(sessionId) !== result.agent)
        throw new Error('Native Session identity changed before directory entry');
      await directories.set(result.agent, cwd, signal);
      signal.throwIfAborted();
    },
    assertWorkingDirectory: async (sessionId, cwd, signal) => {
      signal.throwIfAborted();
      const directories = ctx.get('workingDirectory') as { get(session: NativeAgent['session']): string } | undefined;
      const agent = native.agents.get(sessionId);
      if (!directories || !agent) throw new Error('Native Session directory is unavailable');
      const actual = directories.get(agent.session);
      if (!(await samePhysicalPath(actual, cwd))) throw new Error('Native working directory changed before input admission');
      signal.throwIfAborted();
      if (native.agents.get(sessionId) !== agent || directories.get(agent.session) !== actual)
        throw new Error('Native Session directory changed during validation');
    },
  };
}

/** Native reads stay cold; model routing is installed only on a newly created Agent. */
export function createWorktreeToolSessionPort(ctx: Context): WorktreeToolSessionPort {
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
  const hooks = new Map<string, () => void>();
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
      for (const dispose of hooks.values()) dispose();
      hooks.clear();
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
    ...createNativeWorktreeSessionDirectoryPort(ctx),
    prompt: (input, signal) => controller.prompt(input, signal),
    sendAgentMessage: (input, signal) => relay.send(input, signal),
    rename: (input) => controller.rename(input),
    modelCatalog: () => controller.modelCatalog(),
    snapshot,
    currentModel: async (sessionId, signal) => {
      const value = await snapshot(sessionId, signal);
      const selection = value.values.modelSelection as { next?: ToolModel | null } | undefined;
      if (selection?.next) return { ...selection.next };
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
    validateModel: async (model, signal) => {
      signal.throwIfAborted();
      const catalog = await controller.modelCatalog();
      const entry = catalog.groups
        .find((group) => group.id === model.provider)
        ?.models.find((item) => item.id === model.model);
      if (
        !entry ||
        (model.reasoningEffort !== undefined &&
          !entry.reasoning?.efforts.some((effort) => effort.id === model.reasoningEffort))
      ) {
        throw new Error(
          'Requested model or reasoning effort is unavailable; use clutch_list_models',
        );
      }
      const resolved = await native.llm.resolveCallConfig(model, signal);
      signal.throwIfAborted();
      return {
        provider: resolved.provider,
        model: resolved.model,
        ...(resolved.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: resolved.reasoningEffort }),
      };
    },
    configureModel: async (sessionId, model, signal) => {
      signal.throwIfAborted();
      const result = await controller.resolveAgent(sessionId);
      if ('error' in result) throw result.error;
      signal.throwIfAborted();
      const { agent } = result;
      hooks.get(sessionId)?.();
      // Prepend makes these outer waterfalls: the native model listeners run
      // first, then this creation-only route wins consistently on both surfaces.
      // DSH records the resulting request/header and restores it on cold resume.
      const scoped = agent.ctx as unknown as {
        on(
          name: string,
          listener: (...args: never[]) => Promise<unknown>,
          options: { prepend: true },
        ): () => void;
      };
      const assembly = scoped.on(
        'system-prompt/assemble',
        (async (
          _assembly: unknown,
          _context: unknown,
          next: () => Promise<{ variables: Record<string, unknown> }>,
        ) => {
          const assembled = await next();
          return {
            ...assembled,
            variables: { ...assembled.variables, provider: model.provider, model: model.model },
          };
        }) as (...args: never[]) => Promise<unknown>,
        { prepend: true },
      );
      const request = scoped.on(
        'agent/request',
        (async (_payload: unknown, next: () => Promise<Record<string, unknown>>) => {
          const { reasoningEffort: _effort, ...config } = await next();
          void _effort;
          return { ...config, ...model };
        }) as (...args: never[]) => Promise<unknown>,
        { prepend: true },
      );
      const dispose = () => {
        assembly();
        request();
        event();
        disposed();
        hooks.delete(sessionId);
      };
      const event = native.on(
        'session/event',
        ((session: { id: string }, value: ToolSessionEvent) => {
          if (
            session.id === sessionId &&
            (value.type === 'request/header' || value.type === 'model/selection')
          )
            dispose();
        }) as (...args: never[]) => void,
        { global: true },
      );
      const disposed = native.on(
        'agent/disposed',
        ((value: { agent: NativeAgent }) => {
          if (value.agent === agent || value.agent.session.id === sessionId) dispose();
        }) as (...args: never[]) => void,
        { global: true },
      );
      hooks.set(sessionId, dispose);
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
