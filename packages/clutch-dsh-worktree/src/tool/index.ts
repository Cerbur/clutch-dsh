import type { Context, Fiber } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { CallingAgent, Execution, ToolDefinition, Options } from './types.js';
import { toolWorkspace, createToolContext } from './context.js';
import { registerNewWorktree } from './new-worktree.js';
import { registerListWorktrees } from './list-worktrees.js';
import { registerSpanWorktree } from './span-worktree.js';
import { registerListModels } from './list-models.js';
import { registerListSessions } from './list-sessions.js';
import { registerReadSession } from './read-session.js';
import { registerSendMessage } from './send-message.js';
import { registerWaitSessions } from './wait-sessions.js';
const jsonProjection = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
export { createWorktreeToolSessionPort } from './native-session.js';
export { readToolSession } from './history.js';
export type { Options } from './types.js';
/** Registrations are owned jointly by the exact Agent and plugin lifetimes. */
export function registerWorktreeTools(ctx: Context, options: Options): void {
  const enabled = new Map<CallingAgent, Fiber>();
  const lifetime = new AbortController();
  ctx.effect(
    () => async () => {
      lifetime.abort(new Error('Worktree plugin is disposed'));
      await Promise.all([...enabled.values()].map((fiber) => fiber.dispose()));
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
    description: 'Enable Worktree task delegation, discovery, progress and follow-up tools',
    handler: async ({ agent, rawInput, signal }) => {
      if (rawInput.trim()) return { kind: 'error', text: 'Usage: /worktree' };
      signal.throwIfAborted();
      if (lifetime.signal.aborted || options.isDisposed())
        throw new Error('Worktree plugin is disposed');
      await toolWorkspace(agent.session.id, options);
      signal.throwIfAborted();
      if (enabled.has(agent))
        return { kind: 'success', text: 'Worktree tools are already enabled.' };
      const fiber = agent.ctx.inject(['tools'], (scoped) => {
        const scopeLifetime = new AbortController();
        scoped.effect(
          () => () => scopeLifetime.abort(new Error('Calling Agent is disposed')),
          'clutch-dsh-worktree: cancel Session waits',
        );
        const registry = scoped.get('tools') as {
          register(definition: ToolDefinition): () => void;
        };
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
          registry.register({
            name,
            description,
            parameters: jsonProjection(
              z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
            ),
            output: {
              schema: outputSchema,
              render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
            },
            execute: async (args, exec) => {
              check(exec);
              return jsonProjection(
                await execute(schema.parse(args), {
                  ...exec,
                  signal: AbortSignal.any([exec.signal, lifetime.signal, scopeLifetime.signal]),
                }),
              );
            },
          });
        };

        const context = createToolContext(agent, options, check, add);
        registerNewWorktree(context);
        registerListWorktrees(context);
        registerSpanWorktree(context);
        registerListModels(context);
        registerListSessions(context);
        registerReadSession(context);
        registerSendMessage(context);
        registerWaitSessions(context);
      });
      enabled.set(agent, fiber);
      try {
        await fiber;
        if (lifetime.signal.aborted || options.isDisposed())
          throw new Error('Worktree plugin is disposed');
      } catch (error) {
        enabled.delete(agent);
        await fiber.dispose();
        throw error;
      }
      return {
        kind: 'success',
        text: 'Enabled 8 Worktree tools for this conversation: clutch_new_worktree, clutch_list_worktrees, clutch_span_worktree, clutch_list_models, clutch_list_sessions, clutch_read_session, clutch_send_message, clutch_wait_sessions.',
      };
    },
  });
}
