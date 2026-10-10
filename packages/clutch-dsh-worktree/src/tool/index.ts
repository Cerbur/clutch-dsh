import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand';
import { WORKTREE_TOOL_IDS, type WorktreeToolId, type WorktreeToolSettingsScope } from '../contract/tool-settings.js';
import { authorize, available } from './context.js';
import type { Context, Fiber } from '@deepseek-ai/cordis';
import type { z } from 'zod';
import type { CallingAgent, Execution, ToolDefinition, Options } from './types.js';
import { toolWorkspace, createToolContext } from './context.js';
import { registerNewWorktree } from './new-worktree.js';
import { registerListWorktrees } from './list-worktrees.js';
import { registerSpanWorktree } from './span-worktree.js';
import { registerListModels } from './list-models.js';
import { registerListSessions } from './list-sessions.js';
import { registerSendMessage } from './send-message.js';
import { registerReportResult } from './report-result.js';
import { registerToolGuidance } from './guidance.js';
import { actionableError } from './errors.js';
import { toolParameters } from './schema.js';
const jsonProjection = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
export { createWorktreeToolSessionPort } from './native-session.js';
export { readToolSession } from './history.js';
export type { Options } from './types.js';
/** Registrations and reporting destinations are runtime-only and Agent-scoped. */
export async function registerWorktreeTools(ctx: Context, options: Options): Promise<void> {
  type State = {
    fiber: Fiber;
    names: Set<string>;
    add?: (names: readonly string[], parentSessionId?: string) => number;
    parentSessionId?: string;
  };
  const enabled = new Map<CallingAgent, State>();
  const lifetime = new AbortController();
  ctx.effect(
    () => async () => {
      lifetime.abort(new Error('Worktree plugin is disposed'));
      await Promise.all([...enabled.values()].map(({ fiber }) => fiber.dispose()));
      enabled.clear();
    },
    'clutch-dsh-worktree: scoped tool cleanup',
  );
  (
    ctx as unknown as {
      on(event: 'agent/disposed', listener: (input: { agent: CallingAgent }) => void): unknown;
    }
  ).on('agent/disposed', ({ agent }) => {
    enabled.delete(agent);
  });

  const enable = async (
    agent: CallingAgent,
    signal: AbortSignal,
    names: readonly string[],
    parentSessionId?: string,
  ): Promise<number> => {
    signal.throwIfAborted();
    if (lifetime.signal.aborted || options.isDisposed())
      throw new Error('Worktree plugin is disposed');
    await toolWorkspace(agent.session.id, options);
    signal.throwIfAborted();
    const existing = enabled.get(agent);
    if (existing) {
      await existing.fiber;
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      return existing.add!(names, parentSessionId);
    }
    const state = { names: new Set<string>(), parentSessionId } as State;
    const fiber = agent.ctx.inject(['tools', 'systemPrompt'], (scoped) => {
      const scopeLifetime = new AbortController();
      scoped.effect(
        () => () => scopeLifetime.abort(new Error('Calling Agent is disposed')),
        'clutch-dsh-worktree: scoped cancellation',
      );
      const registry = scoped.get('tools') as { register(definition: ToolDefinition): () => void };
      const check = (exec: Execution) => {
        exec.signal.throwIfAborted();
        if (lifetime.signal.aborted || scopeLifetime.signal.aborted || options.isDisposed())
          throw new Error('Worktree plugin or calling Agent is disposed');
        if (exec.agent !== agent) throw new Error('Use /cluworktree in the calling Session first');
      };
      let transaction: (() => void)[] = [];
      const add = <Schema extends z.ZodType>(
        name: string,
        description: string,
        schema: Schema,
        outputSchema: unknown,
        execute: (args: z.output<Schema>, exec: Execution) => Promise<unknown>,
      ) => {
        const dispose = registry.register({
          name,
          description,
          parameters: jsonProjection(toolParameters(schema)),
          output: {
            schema: outputSchema,
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          execute: async (args, exec) => {
            const execution = {
              ...exec,
              signal: AbortSignal.any([exec.signal, lifetime.signal, scopeLifetime.signal]),
            };
            try {
              check(execution);
              return jsonProjection(await execute(schema.parse(args), execution));
            } catch (cause) {
              execution.signal.throwIfAborted();
              throw actionableError(name, cause);
            }
          },
        });
        transaction.push(dispose);
      };
      const context = createToolContext(agent, options, check, add);
      context.enableChild = async (sessionId, exec) => {
        check(exec);
        const child = await options.sessions.resolveAgent(sessionId, exec.signal);
        await enable(child, exec.signal, ['clutch_report_result'], agent.session.id);
        await autoEnable(child, exec.signal);
        check(exec);
      };
      const registrations: Record<WorktreeToolId, (input: typeof context) => void> = {
        clutch_new_worktree: registerNewWorktree,
        clutch_list_worktrees: registerListWorktrees,
        clutch_span_worktree: registerSpanWorktree,
        clutch_list_models: registerListModels,
        clutch_list_sessions: registerListSessions,
        clutch_send_message: registerSendMessage,
      };
      registerToolGuidance(
        scoped,
        () => state.names,
        () => state.parentSessionId,
      );
      state.add = (requested, parent) => {
        const missing = requested.filter((name) => !state.names.has(name));
        if (!missing.length) return 0;
        transaction = [];
        const previousParent = state.parentSessionId;
        try {
          if (parent !== undefined) state.parentSessionId = parent;
          context.parentSessionId = state.parentSessionId;
          for (const name of missing) {
            if (name === 'clutch_report_result') registerReportResult(context);
            else registrations[name as WorktreeToolId](context);
          }
          for (const name of missing) state.names.add(name);
          return missing.length;
        } catch (error) {
          for (const dispose of transaction.reverse()) dispose();
          state.parentSessionId = previousParent;
          context.parentSessionId = previousParent;
          throw error;
        }
      };
    });
    state.fiber = fiber;
    enabled.set(agent, state);
    try {
      await fiber;
      signal.throwIfAborted();
      if (lifetime.signal.aborted || options.isDisposed())
        throw new Error('Worktree plugin is disposed');
      return state.add!(names, parentSessionId);
    } catch (error) {
      enabled.delete(agent);
      await fiber.dispose();
      throw error;
    }
  };
  /** Bindings may follow agent creation; resolve preferences at prompt assembly. */
  const autoEnable = async (agent: CallingAgent, signal: AbortSignal): Promise<number> => {
    if (!options.settings) return 0;
    const workspaceId = await toolWorkspace(agent.session.id, options);
    const bindings = (await options.manager.listBindings({ workspaceId })).filter(
      (binding) => binding.sessionId === agent.session.id,
    );
    if (bindings.length > 1) return 0;
    const binding = bindings[0];
    let scope: WorktreeToolSettingsScope;
    if (binding) {
      if (binding.status !== 'active') return 0;
      const record = (await options.manager.listWorktrees({ workspaceId })).find(
        (item) => item.worktreeId === binding.worktreeId,
      );
      if (!record || !available(record)) return 0;
      scope = { kind: 'worktree', workspaceId, worktreeId: record.worktreeId };
    } else {
      scope = { kind: 'local', workspaceId };
    }
    let selection;
    try {
      selection = await options.settings.read(scope);
    } catch {
      // Damaged preferences must not block ordinary native Session execution.
      return 0;
    }
    if (!selection.enabled) return 0;
    await authorize(agent.session.id, workspaceId, options, true);
    return enable(agent, signal, selection.tools);
  };
  const freshAssembly = Symbol('clutch-worktree: fresh prompt assembly');
  type AssemblyContext = {
    agent?: CallingAgent;
    scope?: unknown;
    signal?: AbortSignal;
    [freshAssembly]?: true;
  };
  (
    ctx as unknown as {
      on(
        event: 'system-prompt/assemble',
        listener: (
          assembly: unknown,
          context: AssemblyContext,
          next: () => Promise<unknown>,
        ) => Promise<unknown>,
        options: { prepend: true },
      ): unknown;
    }
  ).on('system-prompt/assemble', async (_assembly, context, next) => {
    if (context[freshAssembly] || !options.settings ||
      lifetime.signal.aborted || options.isDisposed()) return next();
    const candidate = context.agent ?? context.scope;
    if (candidate === null || typeof candidate !== 'object' ||
      !('session' in candidate) || !('ctx' in candidate) ||
      context.scope !== candidate) return next();
    const agent = candidate as CallingAgent;
    const before = enabled.get(agent)?.names.size ?? 0;
    let workspaceId: string | undefined;
    try {
      workspaceId = await toolWorkspace(agent.session.id, options);
    } catch {
      /* Global and unowned Agent assemblies retain their native catalog. */
    }
    if (workspaceId === undefined) return next();
    const added = await autoEnable(agent, context.signal ?? lifetime.signal);
    if (!added && (enabled.get(agent)?.names.size ?? 0) === before) return next();
    // DSH collects registered providers before this waterfall, and pre-step runs
    // after assemble(). Rebuild once so both the SDK and guidance reach request 1.
    // The marker belongs to this invocation; concurrent assemblies are independent.
    const prompt = ctx.get('systemPrompt') as {
      assemble(context: AssemblyContext): Promise<unknown>;
    };
    return prompt.assemble({ ...context, [freshAssembly]: true });
  }, { prepend: true });
  const commands = ctx.get('commands') as {
    register(command: {
      definitionId: ReturnType<typeof CommandDefinitionId>;
      name: string;
      description: string;
      handler(input: {
        agent: CallingAgent;
        rawInput: string;
        signal: AbortSignal;
      }): Promise<{ kind: 'error' | 'success'; text: string }>;
    }): () => void;
  };
  let unregister: (() => void) | undefined;
  const syncCommand = (active: boolean) => {
    if (lifetime.signal.aborted || options.isDisposed()) return;
    if (!active) {
      unregister?.();
      unregister = undefined;
      return;
    }
    if (unregister) return;
    unregister = commands.register({
      definitionId: CommandDefinitionId('@cerbur/clutch-dsh-worktree:cluworktree'),
      name: 'cluworktree',
      description: 'Enable the Worktree capabilities selected in Settings for this conversation',
      handler: async ({ agent, rawInput, signal }) => {
        if (rawInput.trim()) return { kind: 'error', text: 'Usage: /cluworktree' };
        const selection = options.settings
          ? await options.settings.read({ kind: 'general' })
          : { enabled: true, tools: WORKTREE_TOOL_IDS };
        if (!selection.enabled || !selection.tools.length)
          return {
            kind: 'error',
            text: 'Enable Worktree tools in Settings → Worktree → General first.',
          };
        await autoEnable(agent, signal);
        const added = await enable(agent, signal, selection.tools);
        const count = [...enabled.get(agent)!.names].filter(
          (name) => name !== 'clutch_report_result',
        ).length;
        return {
          kind: 'success',
          text: added
            ? `Worktree tools enabled for this conversation: ${added} added, ${count} available. Describe the task you want to delegate or isolate.`
            : `Worktree tools are already enabled for this conversation: ${count} available.`,
        };
      },
    });
  };
  ctx.effect(() => () => unregister?.(), 'clutch-dsh-worktree: command cleanup');
  if (options.settings) {
    ctx.effect(
      () =>
        options.settings!.subscribe((scope, selection) => {
          if (scope.kind === 'general') syncCommand(selection.enabled);
        }),
      'clutch-dsh-worktree: preferences subscription',
    );
  }
  let active = !options.settings;
  if (options.settings) {
    try {
      active = (await options.settings.read({ kind: 'general' })).enabled;
    } catch {
      /* Keep command unavailable; native Sessions and result reporting stay usable. */
    }
  }
  syncCommand(active);
}
