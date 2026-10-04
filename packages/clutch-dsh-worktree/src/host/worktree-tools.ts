import type { Context, Fiber } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { WorktreeManager, WorktreeRecord } from '../contract/index.js';
import type { DshReadAdapter } from '../provider/types.js';

// Structural Host ports avoid merging DSH's Host SessionStore into the Client
// Context type graph. Runtime registrations still use the native registries.
interface CallingAgent {
  readonly session: { readonly id: string };
  readonly ctx: Context;
}
interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  output: {
    schema: unknown;
    render(args: unknown, value: unknown): { type: 'text'; text: string }[];
  };
  execute(
    args: unknown,
    exec: { agent?: CallingAgent; signal: AbortSignal },
  ): Promise<unknown>;
}
interface ToolHost {
  on(
    event: 'agent/disposed',
    listener: (input: { agent: CallingAgent }) => void,
  ): unknown;
}
interface CommandPort {
  register(command: {
    name: string;
    description: string;
    handler(input: {
      agent: CallingAgent;
      rawInput: string;
      signal: AbortSignal;
    }): Promise<{ kind: 'error' | 'success'; text: string }>;
  }): unknown;
}
interface ToolRegistryPort {
  register(definition: ToolDefinition): () => void;
}
const newArgs = z
  .object({ name: z.string(), instructions: z.string().max(32000).optional() })
  .strict();
const spanArgs = z.object({ name: z.string(), prompt: z.string() }).strict();

/** Only native creation and prompt admission cross this Host command boundary. */
export interface WorktreeToolSessionPort {
  create(input: { cwd: string }): Promise<{ sessionId: string }>;
  prompt(
    input: {
      sessionId: string;
      requestId: string;
      mode: 'queue';
      content: readonly { type: 'text'; text: string }[];
    },
    signal: AbortSignal,
  ): Promise<{ accepted: true }>;
}

interface Options {
  manager: Pick<
    WorktreeManager,
    | 'listWorktrees'
    | 'listBindings'
    | 'listBranches'
    | 'createWorktree'
    | 'bindSession'
    | 'updateWorktreeInstructions'
  >;
  dsh: Pick<DshReadAdapter, 'getSession' | 'listWorkspaces'>;
  sessions: WorktreeToolSessionPort;
  changed(workspaceId: string, worktreeId: string): void;
  isDisposed(): boolean;
}

function requiredText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} must not be empty`);
  return text;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reuse native Workspace ownership or one unambiguous active plugin binding. */
export async function toolWorkspace(
  sessionId: string,
  options: Options,
): Promise<string> {
  const session = await options.dsh.getSession(sessionId);
  if (!session) throw new Error('Calling Session not found');
  if (session.workspaceId) return session.workspaceId;
  const owners: string[] = [];
  for (const workspace of (await options.dsh.listWorkspaces?.()) ?? []) {
    const bindings = await options.manager.listBindings({
      workspaceId: workspace.workspaceId,
    });
    if (
      bindings.some(
        (binding) =>
          binding.sessionId === sessionId && binding.status === 'active',
      )
    ) {
      owners.push(workspace.workspaceId);
    }
  }
  if (owners.length !== 1) {
    throw new Error(
      'The calling Session must belong to one Workspace or active Worktree binding',
    );
  }
  return owners[0];
}

function available(record: WorktreeRecord): boolean {
  return (
    record.status === 'active' &&
    record.diskCleanup !== 'completed' &&
    (record.health === undefined || record.health === 'ready')
  );
}

/** Scoped registrations are owned jointly by the Agent and plugin lifetimes. */
export function registerWorktreeTools(ctx: Context, options: Options): void {
  const enabled = new Map<CallingAgent, Fiber>();
  let disposed = false;
  ctx.effect(
    () => async () => {
      disposed = true;
      await Promise.all([...enabled.values()].map((fiber) => fiber.dispose()));
      enabled.clear();
    },
    'clutch-dsh-worktree: scoped tool cleanup',
  );
  (ctx as unknown as ToolHost).on('agent/disposed', ({ agent }) => {
    enabled.delete(agent);
  });

  const commands = ctx.get('commands') as CommandPort;
  commands.register({
    name: 'worktree',
    description:
      'Enable Worktree creation and Session dispatch tools for this conversation',
    handler: async ({ agent, rawInput, signal }) => {
      if (rawInput.trim()) return { kind: 'error', text: 'Usage: /worktree' };
      signal.throwIfAborted();
      if (disposed || options.isDisposed())
        throw new Error('Worktree plugin is disposed');
      await toolWorkspace(agent.session.id, options);
      signal.throwIfAborted();
      if (enabled.has(agent))
        return { kind: 'success', text: 'Worktree tools are already enabled.' };
      const fiber = agent.ctx.inject(['tools'], (scoped) => {
        const tools = scoped.get('tools') as ToolRegistryPort;
        const check = (
          caller: CallingAgent | undefined,
          signal: AbortSignal,
        ) => {
          signal.throwIfAborted();
          if (disposed || options.isDisposed())
            throw new Error('Worktree plugin is disposed');
          if (caller !== agent)
            throw new Error('Use /worktree in the calling Session first');
        };
        tools.register({
          name: 'clutch_new_worktree',
          description:
            'Create a managed Worktree in the calling Workspace from its current Main branch. The name is the new Git branch. Optional instructions are shared with Sessions in that Worktree. Returns its id and path; does not create a Session.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: 'Worktree name / new Git branch name.',
              },
              instructions: {
                type: 'string',
                maxLength: 32000,
                description:
                  'Optional shared Worktree instructions; empty means none.',
              },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: [
                'workspaceId',
                'worktreeId',
                'name',
                'absolutePath',
                'instructionsSaved',
              ],
              properties: {
                workspaceId: { type: 'string' },
                worktreeId: { type: 'string' },
                name: { type: 'string' },
                absolutePath: { type: 'string' },
                instructionsSaved: { type: 'boolean' },
                error: { type: 'string' },
              },
            },
            render: (_args, value) => [
              { type: 'text', text: JSON.stringify(value) },
            ],
          },
          execute: async (args, exec) => {
            check(exec.agent, exec.signal);
            const { name, instructions = '' } = newArgs.parse(args);
            const newBranch = requiredText(name, 'name');
            if (instructions.length > 32000)
              throw new Error('instructions must be at most 32000 characters');
            const workspaceId = await toolWorkspace(agent.session.id, options);
            const branches = await options.manager.listBranches({
              workspaceId,
            });
            const current = branches.find((branch) => branch.isCurrent);
            if (!current)
              throw new Error(
                'Workspace Main must have a current local branch',
              );
            check(exec.agent, exec.signal);
            const record = await options.manager.createWorktree({
              workspaceId,
              branch: current.name,
              newBranch,
            });
            // Once created, always publish the identity even if instruction saving fails.
            let error: string | undefined;
            try {
              check(exec.agent, exec.signal);
              if (instructions)
                await options.manager.updateWorktreeInstructions({
                  workspaceId,
                  worktreeId: record.worktreeId,
                  instructions,
                  expectedInstructions: '',
                });
            } catch (cause) {
              error = errorText(cause);
            }
            options.changed(workspaceId, record.worktreeId);
            return {
              workspaceId,
              worktreeId: record.worktreeId,
              name: record.branch,
              absolutePath: record.absolutePath,
              instructionsSaved: error === undefined,
              ...(error === undefined ? {} : { error }),
            };
          },
        });
        tools.register({
          name: 'clutch_span_worktree',
          description:
            'Create a new ordinary DSH Session in an active managed Worktree of the calling Workspace, bind it, then dispatch the prompt. Returns immediately after prompt admission, without waiting for completion. Never reuses an existing Session. On partial failure preserve the returned Session and repair it instead of blindly creating another.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'prompt'],
            properties: {
              name: {
                type: 'string',
                description:
                  'Exact managed Worktree name / branch in this Workspace.',
              },
              prompt: {
                type: 'string',
                description: 'Task to dispatch to the new Session.',
              },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['workspaceId', 'worktreeId', 'sessionId', 'status'],
              properties: {
                workspaceId: { type: 'string' },
                worktreeId: { type: 'string' },
                sessionId: { type: 'string' },
                status: {
                  type: 'string',
                  enum: ['dispatched', 'binding-failed', 'prompt-failed'],
                },
                error: { type: 'string' },
              },
            },
            render: (_args, value) => [
              { type: 'text', text: JSON.stringify(value) },
            ],
          },
          execute: async (args, exec) => {
            check(exec.agent, exec.signal);
            const { name, prompt } = spanArgs.parse(args);
            const branch = requiredText(name, 'name');
            requiredText(prompt, 'prompt');
            const workspaceId = await toolWorkspace(agent.session.id, options);
            const matches = (
              await options.manager.listWorktrees({ workspaceId })
            ).filter(
              (record) =>
                record.branch === branch && record.status === 'active',
            );
            if (matches.length !== 1 || !available(matches[0])) {
              throw new Error(
                'Worktree name must identify exactly one active, healthy managed Worktree',
              );
            }
            const record = matches[0];
            check(exec.agent, exec.signal);
            const { sessionId } = await options.sessions.create({
              cwd: record.absolutePath,
            });
            let status: 'dispatched' | 'binding-failed' | 'prompt-failed' =
              'binding-failed';
            let error: string | undefined;
            try {
              check(exec.agent, exec.signal);
              await options.manager.bindSession({
                workspaceId,
                worktreeId: record.worktreeId,
                sessionId,
              });
              status = 'prompt-failed';
              check(exec.agent, exec.signal);
              await options.sessions.prompt(
                {
                  sessionId,
                  requestId: `clutch-worktree:${sessionId}`,
                  mode: 'queue',
                  content: [{ type: 'text', text: prompt }],
                },
                exec.signal,
              );
              status = 'dispatched';
            } catch (cause) {
              error = errorText(cause);
            }
            options.changed(workspaceId, record.worktreeId);
            return {
              workspaceId,
              worktreeId: record.worktreeId,
              sessionId,
              status,
              ...(error === undefined ? {} : { error }),
            };
          },
        });
      });
      enabled.set(agent, fiber);
      try {
        await fiber;
        if (disposed || options.isDisposed())
          throw new Error('Worktree plugin is disposed');
      } catch (error) {
        enabled.delete(agent);
        await fiber.dispose();
        throw error;
      }
      return {
        kind: 'success',
        text: 'Enabled clutch_new_worktree and clutch_span_worktree for this conversation.',
      };
    },
  });
}
