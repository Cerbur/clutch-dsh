import type { Context } from '@deepseek-ai/cordis';
import { samePhysicalPath } from '../provider/path-identity.js';
import type { RelayAgent } from '../tool/agent-relay.js';
import { initializeForgeSession, type ForgeAgent } from './forge-session.js';
import type { ToolModel, ToolSessionEvent, WorktreeToolSessionPort } from '../tool/native-session.js';

export interface NativeAgent extends RelayAgent {
  readonly model?: {
    current(): Readonly<ToolModel> | undefined;
    select(model: Readonly<ToolModel>): void;
  };
  readonly session: {
    readonly id: string;
    requestHeader():
      { config: ToolModel; adapterDefaults?: { reasoningEffort?: boolean } } | undefined;
  };
  readonly ctx: Context;
  readonly status: string;
}

export interface NativeSessionController {
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

export interface NativeContext {
  on(name: string, listener: (...args: never[]) => void, options: { global: true }): () => void;
  readonly agents: { get(id: string): NativeAgent | undefined };
  readonly sessionQuery: {
    observeSession(id: string, options: { signal: AbortSignal }): Promise<NativeObservation>;
  };
  readonly llm: { resolveCallConfig(model: ToolModel, signal: AbortSignal): Promise<ToolModel> };
}

/** Only thrown by capability preflight, before invoking native Session creation. */
export class NativeSessionCreationPreflightError extends Error {}

/** Native creation succeeded, but directory entry and Forge initialization never started. */
export class WorktreeDirectoryEntryNotStarted extends Error {}

/** Only the pre-create check may change profile selection. */
export interface ForgeSessionGate {
  ensureForCreation(signal?: AbortSignal): Promise<void>;
  assertReady(signal?: AbortSignal): Promise<void>;
}

/** Browser creation needs no commands, tools or model provider. */
export function createNativeWorktreeSessionDirectoryPort(ctx: Context, forge?: ForgeSessionGate): Pick<WorktreeToolSessionPort,
  'create' | 'enterWorkingDirectory' | 'assertWorkingDirectory' | 'initializeWorktreeSession'> {
  const native = ctx as unknown as NativeContext;
  const controller = ctx.get('sessionController') as NativeSessionController;
  const fresh = new Set<string>();
  return {
    create: (input, signal) => {
      const directories = ctx.get('workingDirectory') as { set?: unknown } | undefined;
      if (input.workspaceId !== undefined && typeof directories?.set !== 'function') throw new NativeSessionCreationPreflightError('Native workingDirectory service is required for Workspace-owned Worktree Sessions');
      return Promise.resolve(forge?.ensureForCreation(signal)).then(async () => {
        if (signal?.aborted) throw new NativeSessionCreationPreflightError('Worktree Session creation cancelled before native creation');
        if (input.workspaceId === undefined) return controller.create({ cwd: input.cwd });
        const created = await controller.create({ workspaceId: input.workspaceId });
        fresh.add(created.sessionId);
        return created;
      });
    },
    initializeWorktreeSession: async (sessionId, record, signal, bind) => {
      if (!fresh.delete(sessionId)) throw new Error('Only a newly created Session may receive Forge Worktree records');
      let entryStarted = false;
      try {
        signal.throwIfAborted();
        await forge?.assertReady(signal);
        const result = await controller.resolveAgent(sessionId);
        if ('error' in result) throw result.error;
        if (result.agent.session.id !== sessionId || native.agents.get(sessionId) !== result.agent)
          throw new Error('Native Session identity changed before Forge initialization');
        await initializeForgeSession(ctx, result.agent as unknown as ForgeAgent, record, signal, async (control) => {
          await forge?.assertReady(control);
          control.throwIfAborted();
          await bind();
        }, () => { entryStarted = true; });
      } catch (error) {
        if (entryStarted) throw error;
        throw new WorktreeDirectoryEntryNotStarted(error instanceof Error ? error.message : String(error), { cause: error });
      }
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
      await forge?.assertReady(signal);
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

export type NativeTaskSessionPort = Pick<WorktreeToolSessionPort,
  'create' | 'enterWorkingDirectory' | 'assertWorkingDirectory' | 'initializeWorktreeSession' |
  'prompt' | 'rename' | 'modelCatalog' | 'validateModel' | 'configureModel'>;

/** Dashboard tasks require directory and model routing, independently of Agent tools. */
export function createNativeTaskSessionPort(ctx: Context, forge?: ForgeSessionGate): NativeTaskSessionPort {
  const native = ctx as unknown as NativeContext;
  const controller = ctx.get('sessionController') as NativeSessionController;
  const hooks = new Map<string, () => void>();
  ctx.effect(() => () => {
    for (const dispose of hooks.values()) dispose();
    hooks.clear();
  }, 'clutch-dsh-worktree: Session model routing cleanup');
  return {
    ...createNativeWorktreeSessionDirectoryPort(ctx, forge),
    prompt: (input, signal) => controller.prompt(input, signal),
    rename: (input) => controller.rename(input),
    modelCatalog: () => controller.modelCatalog(),
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
      // Current DSH freezes the route before resolving this step's tools.
      // Use its Session-local owner, never the deployment-default selector.
      if (agent.model?.select) {
        if (agent.session.id !== sessionId || native.agents.get(sessionId) !== agent)
          throw new Error('Native Session identity changed before model selection');
        agent.model.select({ ...model });
        return;
      }
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
  };
}
