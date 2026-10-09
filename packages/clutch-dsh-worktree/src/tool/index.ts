import type { Context, Fiber } from '@deepseek-ai/cordis';
import { z } from 'zod';
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
const jsonProjection = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
export { createWorktreeToolSessionPort } from './native-session.js';
export { readToolSession } from './history.js';
export type { Options } from './types.js';
/** Registrations and reporting destinations are runtime-only and Agent-scoped. */
export function registerWorktreeTools(ctx: Context, options: Options): void {
  const enabled = new Map<CallingAgent, { fiber: Fiber; reporting: boolean }>();
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
    parentSessionId?: string,
  ): Promise<void> => {
    signal.throwIfAborted();
    if (lifetime.signal.aborted || options.isDisposed())
      throw new Error('Worktree plugin is disposed');
    await toolWorkspace(agent.session.id, options);
    signal.throwIfAborted();
    const existing = enabled.get(agent);
    if (existing) {
      await existing.fiber;
      return;
    }
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
        if (exec.agent !== agent) throw new Error('Use /worktree in the calling Session first');
      };
      const add = <Schema extends z.ZodType>(
        name: string,
        description: string,
        schema: Schema,
        outputSchema: unknown,
        execute: (args: z.output<Schema>, exec: Execution) => Promise<unknown>,
      ) => {
        const { $schema: _dialect, ...parameters } = z.toJSONSchema(schema, {
          io: 'input',
          unrepresentable: 'any',
        });
        void _dialect;
        registry.register({
          name,
          description,
          parameters: jsonProjection(parameters),
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
      };
      const context = createToolContext(agent, options, check, add);
      context.parentSessionId = parentSessionId;
      context.enableChild = async (sessionId, exec) => {
        check(exec);
        const child = await options.sessions.resolveAgent(sessionId, exec.signal);
        await enable(child, exec.signal, agent.session.id);
        check(exec);
      };
      registerToolGuidance(scoped, parentSessionId);
      registerNewWorktree(context);
      registerListWorktrees(context);
      registerSpanWorktree(context);
      registerListModels(context);
      registerListSessions(context);
      registerSendMessage(context);
      if (parentSessionId !== undefined) registerReportResult(context);
    });
    enabled.set(agent, { fiber, reporting: parentSessionId !== undefined });
    try {
      await fiber;
      signal.throwIfAborted();
      if (lifetime.signal.aborted || options.isDisposed())
        throw new Error('Worktree plugin is disposed');
    } catch (error) {
      enabled.delete(agent);
      await fiber.dispose();
      throw error;
    }
  };
  const commands = ctx.get('commands') as {
    register(command: {
      name: string;
      description: string;
      handler(input: {
        agent: CallingAgent;
        rawInput: string;
        signal: AbortSignal;
      }): Promise<{ kind: 'error' | 'success'; text: string }>;
    }): unknown;
  };
  commands.register({
    name: 'worktree',
    description: 'Enable isolated task delegation, discovery, follow-ups and pushed result reports',
    handler: async ({ agent, rawInput, signal }) => {
      if (rawInput.trim()) return { kind: 'error', text: 'Usage: /worktree' };
      await enable(agent, signal);
      const reporting = enabled.get(agent)?.reporting;
      const names = [
        'clutch_new_worktree',
        'clutch_list_worktrees',
        'clutch_span_worktree',
        'clutch_list_models',
        'clutch_list_sessions',
        'clutch_send_message',
        ...(reporting ? ['clutch_report_result'] : []),
      ];
      return {
        kind: 'success',
        text: `Enabled ${names.length} Worktree tools for this conversation: ${names.join(', ')}. Delegated Sessions push concise results back; do not poll for progress.`,
      };
    },
  });
}
