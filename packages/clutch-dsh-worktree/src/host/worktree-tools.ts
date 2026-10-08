import type { Context, Fiber } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WorktreeManager, WorktreeRecord } from '../contract/index.js';
import type { DshReadAdapter } from '../provider/types.js';
import { samePhysicalPath } from '../provider/path-identity.js';
import { decodeCursor, latestToolSessionCursor, readToolSession } from './worktree-tool-history.js';
import type { WorktreeToolSessionPort } from './worktree-tool-session.js';
import { worktreeToolOutputs } from './worktree-tool-schemas.js';
export type { WorktreeToolSessionPort } from './worktree-tool-session.js';

interface CallingAgent {
  readonly session: { readonly id: string };
  readonly ctx: Context;
}
interface Execution {
  agent?: CallingAgent;
  signal: AbortSignal;
}
interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  output: {
    schema: unknown;
    render(args: unknown, value: unknown): { type: 'text'; text: string }[];
  };
  execute(args: unknown, exec: Execution): Promise<unknown>;
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
  > & {
    resolveRuntimeCwd(input: { workspaceId: string; sessionId: string }): Promise<string>;
    readSessionHead(input: { workspaceId: string; sessionId: string }): Promise<string>;
    createWorktreeAtCommit(input: {
      workspaceId: string;
      baseBranch?: string;
      baseCommit: string;
      newBranch: string;
    }): Promise<WorktreeRecord>;
  };
  dsh: Pick<DshReadAdapter, 'getSession' | 'getWorkspace' | 'listSessions' | 'listWorkspaces'>;
  sessions: WorktreeToolSessionPort;
  changed(workspaceId: string, worktreeId: string): void;
  isDisposed(): boolean;
}
const text = z.string().trim().min(1);
const prompt = z.string().refine((value) => value.trim().length > 0, 'prompt must not be empty');
const model = z.object({ provider: text, model: text, reasoningEffort: text.optional() }).strict();
const workspace = z.object({ workspaceId: text.optional() }).strict();
const newArgs = z
  .object({
    name: text,
    baseBranch: text.optional(),
    instructions: z.string().max(32000).optional(),
  })
  .strict();
const spanArgs = z
  .object({
    worktreeId: text.optional(),
    name: text.optional(),
    prompt,
    model: model.optional(),
    title: text.max(200).optional(),
  })
  .strict()
  .refine(
    (value) => (value.worktreeId === undefined) !== (value.name === undefined),
    'Specify exactly one worktreeId or name',
  );
const listSessionsArgs = workspace.extend({ worktreeId: text.optional() }).strict();
const readArgs = z.object({ sessionId: text, afterCursor: text.optional() }).strict();
const sendArgs = z
  .object({
    sessionId: text,
    prompt,
    mode: z.enum(['queue', 'steer']).default('queue'),
    requestId: text.max(200).optional(),
  })
  .strict();
const waitArgs = z
  .object({
    sessionIds: z.array(text).min(1).max(8),
    afterCursors: z.record(z.string(), text).optional(),
    timeoutMs: z.number().int().min(0).max(60000).default(30000),
  })
  .strict();
const listModelsArgs = z.object({ provider: text.optional() }).strict();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
// Zod schemas carry non-enumerable Standard Schema functions; native tool
// catalogs and outputs accept only lossless plain JSON.
const jsonProjection = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

/** Ownership comes from native membership or one active binding, never cwd alone. */
export async function toolWorkspace(sessionId: string, options: Options): Promise<string> {
  const session = await options.dsh.getSession(sessionId);
  if (!session) throw new Error('Calling Session not found');
  if (session.workspaceId) return session.workspaceId;
  const owners: string[] = [];
  for (const item of (await options.dsh.listWorkspaces?.()) ?? []) {
    const bindings = await options.manager.listBindings({ workspaceId: item.workspaceId });
    if (bindings.some((binding) => binding.sessionId === sessionId && binding.status === 'active'))
      owners.push(item.workspaceId);
  }
  if (owners.length !== 1)
    throw new Error('The calling Session must belong to one Workspace or active Worktree binding');
  return owners[0];
}
function available(record: WorktreeRecord): boolean {
  return (
    record.status === 'active' &&
    record.diskCleanup !== 'completed' &&
    (record.health === undefined || record.health === 'ready')
  );
}
async function defaultBase(
  sessionId: string,
  workspaceId: string,
  options: Options,
): Promise<{ branch?: string; commit: string }> {
  const bindings = (await options.manager.listBindings({ workspaceId })).filter(
    (binding) => binding.sessionId === sessionId,
  );
  if (bindings.length > 1) throw new Error('Calling Session has ambiguous Worktree bindings');
  const session = await options.dsh.getSession(sessionId);
  if (!session) throw new Error('Calling Session not found');
  if (bindings[0]?.status === 'active') {
    const record = (await options.manager.listWorktrees({ workspaceId })).find(
      (item) => item.worktreeId === bindings[0].worktreeId,
    );
    if (!record || !available(record))
      throw new Error('Calling Worktree needs repair; cannot infer its base branch');
    const cwd = await options.manager.resolveRuntimeCwd({ workspaceId, sessionId });
    if (!(await samePhysicalPath(session.cwd, cwd)))
      throw new Error('Calling Session cwd does not match its Worktree');
    return {
      branch: record.branch,
      commit: await options.manager.readSessionHead({ workspaceId, sessionId }),
    };
  }
  const root = await options.dsh.getWorkspace(workspaceId);
  if (!root || !(await samePhysicalPath(session.cwd, root.rootPath)))
    throw new Error('Calling Session is not in the Workspace root; specify baseBranch explicitly');
  const current = (await options.manager.listBranches({ workspaceId })).find(
    (branch) => branch.isCurrent,
  );
  return {
    branch: current?.name,
    commit: await options.manager.readSessionHead({ workspaceId, sessionId }),
  };
}

/** Recheck native identity, binding and physical cwd before cross-Session operations. */
async function authorize(
  sessionId: string,
  workspaceId: string,
  options: Options,
  write = false,
): Promise<void> {
  const session = await options.dsh.getSession(sessionId);
  if (!session || (session.workspaceId !== undefined && session.workspaceId !== workspaceId))
    throw new Error('Session is outside the calling Workspace or unavailable');
  // The read-only relation listing deliberately tolerates a missing Workspace
  // root. Native admission must still pass Manage's stricter write/cwd gate.
  if (write) await options.manager.resolveRuntimeCwd({ workspaceId, sessionId });
  const bindings = (await options.manager.listBindings({ workspaceId })).filter(
    (binding) => binding.sessionId === sessionId,
  );
  if (bindings.length > 1) throw new Error('Session has ambiguous Worktree bindings');
  const binding = bindings[0];
  if (binding) {
    if (binding.status !== 'active')
      throw new Error('Session binding is detached; repair it before using Session tools');
    const record = (await options.manager.listWorktrees({ workspaceId })).find(
      (item) => item.worktreeId === binding.worktreeId,
    );
    if (
      !record ||
      (write &&
        (record.diskCleanup === 'completed' ||
          (record.health !== undefined && record.health !== 'ready')))
    )
      throw new Error('Session Worktree is unavailable or needs repair');
    if (!(await samePhysicalPath(session.cwd, record.absolutePath))) {
      const cwd = await options.manager.resolveRuntimeCwd({ workspaceId, sessionId });
      if (!(await samePhysicalPath(session.cwd, cwd)))
        throw new Error('Session cwd does not match its Worktree');
    }
  } else {
    if (session.workspaceId !== workspaceId)
      throw new Error('Session is outside the calling Workspace or unavailable');
    const root = await options.dsh.getWorkspace(workspaceId);
    if (!root || !(await samePhysicalPath(session.cwd, root.rootPath)))
      throw new Error('Session cwd does not match the Workspace root');
  }
}

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
        const scope = async (requested?: string) => {
          const workspaceId = await toolWorkspace(agent.session.id, options);
          if (requested !== undefined && requested !== workspaceId)
            throw new Error('Workspace is outside the calling Session scope');
          return workspaceId;
        };
        const add = <Schema extends z.ZodType>(
          name: string,
          description: string,
          schema: Schema,
          execute: (args: z.output<Schema>, exec: Execution) => Promise<unknown>,
        ) => {
          registry.register({
            name,
            description,
            parameters: jsonProjection(
              z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
            ),
            output: {
              schema: worktreeToolOutputs[name],
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

        add(
          'clutch_new_worktree',
          'Create a managed Worktree with a new branch. By default captures the calling Session’s healthy Worktree HEAD, or its Workspace root HEAD (including detached HEAD). An explicit local baseBranch overrides this. Uncommitted files are not copied. Returns acquisition baseCommit and baseBranch when branch-attached. Does not create a Session.',
          newArgs,
          async ({ name, baseBranch, instructions = '' }, exec) => {
            const workspaceId = await scope();
            const base =
              baseBranch === undefined
                ? await defaultBase(agent.session.id, workspaceId, options)
                : undefined;
            check(exec);
            const record =
              base === undefined
                ? await options.manager.createWorktree({
                    workspaceId,
                    branch: baseBranch!,
                    newBranch: name,
                  })
                : await options.manager.createWorktreeAtCommit({
                    workspaceId,
                    baseBranch: base.branch,
                    baseCommit: base.commit,
                    newBranch: name,
                  });
            let error: string | undefined;
            try {
              check(exec);
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
              baseBranch: record.baseBranch,
              baseCommit: record.baseCommit,
              instructionsSaved: error === undefined,
              ...(error === undefined ? {} : { error }),
            };
          },
        );
        add(
          'clutch_list_worktrees',
          'List managed Worktrees and local base branches in workspaceId, defaulting to the calling Workspace. Returns stable ids, branch, path, lifecycle and health. Another Workspace is rejected.',
          workspace,
          async (args, exec) => {
            const workspaceId = await scope(args.workspaceId);
            const records = await options.manager.listWorktrees({ workspaceId });
            let branchFacts;
            try {
              branchFacts = { branches: await options.manager.listBranches({ workspaceId }) };
            } catch (error) {
              check(exec);
              branchFacts = { branchesUnavailable: errorText(error) };
            }
            check(exec);
            return {
              workspaceId,
              ...branchFacts,
              worktrees: records.map((record) => ({
                worktreeId: record.worktreeId,
                branch: record.branch,
                absolutePath: record.absolutePath,
                status: record.status,
                health: record.health,
                diskCleanup: record.diskCleanup,
                baseBranch: record.baseBranch,
                baseCommit: record.baseCommit,
              })),
            };
          },
        );
        add(
          'clutch_span_worktree',
          'Create a fresh ordinary DSH Session in a healthy managed Worktree and dispatch prompt. Prefer worktreeId; legacy exact branch name is accepted, but provide only one. model defaults to the caller’s provider/model/effort without changing the deployment default. Returns admission, not completion. Partial failures preserve the Session; repair it before retrying.',
          spanArgs,
          async (args, exec) => {
            const workspaceId = await scope();
            const matches = (await options.manager.listWorktrees({ workspaceId })).filter(
              (record) =>
                record.status === 'active' &&
                (args.worktreeId === undefined
                  ? record.branch === args.name
                  : record.worktreeId === args.worktreeId),
            );
            if (matches.length !== 1 || !available(matches[0]))
              throw new Error(
                'Worktree must identify exactly one active, healthy managed Worktree',
              );
            const record = matches[0];
            const selected = await options.sessions.validateModel(
              args.model ?? (await options.sessions.currentModel(agent.session.id, exec.signal)),
              exec.signal,
            );
            check(exec);
            const { sessionId } = await options.sessions.create({ cwd: record.absolutePath });
            let status = 'binding-failed';
            let error: string | undefined;
            const requestId = `clutch-worktree:${sessionId}:${randomUUID()}`;
            try {
              check(exec);
              await options.manager.bindSession({
                workspaceId,
                worktreeId: record.worktreeId,
                sessionId,
              });
              status = 'model-failed';
              check(exec);
              await options.sessions.configureModel(sessionId, selected, exec.signal);
              if (args.title) {
                status = 'title-failed';
                check(exec);
                await options.sessions.rename({ sessionId, title: args.title });
              }
              status = 'prompt-failed';
              check(exec);
              await options.sessions.prompt(
                {
                  sessionId,
                  requestId,
                  mode: 'queue',
                  content: [{ type: 'text', text: args.prompt }],
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
              model: selected,
              requestId,
              ...(error === undefined ? {} : { error }),
            };
          },
        );
        add(
          'clutch_list_models',
          'Discover native models grouped by provider, with reasoning efforts and provider failures. Optional provider filters the catalog. Returns the current Session model separately from the deployment default.',
          listModelsArgs,
          async (args, exec) => {
            await scope();
            const catalog = await options.sessions.modelCatalog();
            const current = await options.sessions.currentModel(agent.session.id, exec.signal);
            check(exec);
            if (
              args.provider &&
              !catalog.groups.some((group) => group.id === args.provider) &&
              !catalog.failures.some((failure) => failure.id === args.provider)
            )
              throw new Error('Unknown model provider');
            return {
              current,
              default: catalog.default,
              groups: catalog.groups.filter(
                (group) => args.provider === undefined || group.id === args.provider,
              ),
              failures: catalog.failures.filter(
                (failure) => args.provider === undefined || failure.id === args.provider,
              ),
            };
          },
        );
        add(
          'clutch_list_sessions',
          'Discover existing Sessions in the calling Workspace, optionally filtered by worktreeId. Returns stable ids, binding state, status and title. These are ordinary Sessions, not a parent/subagent task catalog.',
          listSessionsArgs,
          async (args, exec) => {
            const workspaceId = await scope(args.workspaceId);
            const bindings = await options.manager.listBindings({ workspaceId });
            if (
              args.worktreeId !== undefined &&
              !(await options.manager.listWorktrees({ workspaceId })).some(
                (item) => item.worktreeId === args.worktreeId,
              )
            )
              throw new Error('Worktree not found in the calling Workspace');
            const candidates = (await options.dsh.listSessions()).filter((session) => {
              const binding = bindings.find((item) => item.sessionId === session.sessionId);
              return (
                (session.workspaceId === workspaceId || binding !== undefined) &&
                (session.workspaceId === undefined || session.workspaceId === workspaceId) &&
                (args.worktreeId === undefined || binding?.worktreeId === args.worktreeId)
              );
            });
            const items = [];
            for (const session of candidates) {
              check(exec);
              const binding = bindings.find((item) => item.sessionId === session.sessionId);
              try {
                await authorize(session.sessionId, workspaceId, options);
              } catch (error) {
                check(exec);
                items.push({
                  sessionId: session.sessionId,
                  worktreeId: binding?.worktreeId,
                  bindingStatus: binding?.status ?? 'main',
                  status: 'unavailable',
                  diagnostic: errorText(error),
                });
                continue;
              }
              const snapshot = await options.sessions.snapshot(session.sessionId, exec.signal);
              const value = readToolSession(
                session.sessionId,
                snapshot,
                latestToolSessionCursor(session.sessionId, snapshot),
              );
              items.push({
                sessionId: session.sessionId,
                worktreeId: binding?.worktreeId,
                bindingStatus: binding?.status ?? 'main',
                cwd: session.cwd,
                status: value.status,
                title:
                  typeof snapshot.values.title === 'string' ? snapshot.values.title : undefined,
                cursor: value.cursor,
              });
            }
            return { workspaceId, sessions: items };
          },
        );
        const read = async (
          sessionId: string,
          afterCursor: string | undefined,
          exec: Execution,
        ) => {
          const workspaceId = await scope();
          await authorize(sessionId, workspaceId, options);
          check(exec);
          const snapshot = await options.sessions.snapshot(sessionId, exec.signal);
          check(exec);
          return { workspaceId, ...readToolSession(sessionId, snapshot, afterCursor) };
        };
        add(
          'clutch_read_session',
          'Read status and recent Session messages without activating it. Pass returned afterCursor for incremental reads; repeat while hasMore. Large messages are split into exact fragments. idle means a turn ended, not that its task passed verification.',
          readArgs,
          (args, exec) => read(args.sessionId, args.afterCursor, exec),
        );
        add(
          'clutch_send_message',
          'Continue an existing Session in the calling Workspace. queue (default) runs after the current turn; steer corrects at a native step boundary. Returns admitted or prompt-failed, retaining requestId on failure. Each call gets a fresh requestId; provide the returned requestId only to retry that same message.',
          sendArgs,
          async (args, exec) => {
            const workspaceId = await scope();
            await authorize(args.sessionId, workspaceId, options, true);
            check(exec);
            const requestId = args.requestId ?? `clutch-worktree:${randomUUID()}`;
            const identity = { workspaceId, sessionId: args.sessionId, requestId, mode: args.mode };
            try {
              await options.sessions.prompt(
                {
                  sessionId: args.sessionId,
                  requestId,
                  mode: args.mode,
                  content: [{ type: 'text', text: args.prompt }],
                },
                exec.signal,
              );
              return { ...identity, status: 'admitted', accepted: true };
            } catch (error) {
              // Admission may already have committed. Keep its retry identity
              // so native deduplication, not a new message, resolves uncertainty.
              return { ...identity, status: 'prompt-failed', error: errorText(error) };
            }
          },
        );
        add(
          'clutch_wait_sessions',
          'Wait for new messages, turn boundaries, errors or user attention in up to eight Sessions. Pass each Session’s afterCursors for incremental results; otherwise observe from now and return already inactive/waiting Sessions immediately. timeoutMs is 0–60000, default 30000. Does not approve requests or verify completion.',
          waitArgs,
          async (args, exec) => {
            const ids = [...new Set(args.sessionIds)];
            if (args.afterCursors && Object.keys(args.afterCursors).some((id) => !ids.includes(id)))
              throw new Error('afterCursors contains an unrequested Session');
            const cursors = new Map<string, string>();
            const workspaceId = await scope();
            for (const id of ids) {
              if (args.afterCursors?.[id]) decodeCursor(id, args.afterCursors[id]);
              await authorize(id, workspaceId, options);
            }
            let wake: (() => void) | undefined;
            let revision = 0;
            const notify = () => {
              revision++;
              wake?.();
            };
            const unsubscribe = options.sessions.subscribe(ids, notify);
            let timedOut = args.timeoutMs === 0;
            const timer = setTimeout(() => {
              timedOut = true;
              notify();
            }, args.timeoutMs);
            const abort = () => notify();
            exec.signal.addEventListener('abort', abort, { once: true });
            try {
              for (const id of ids)
                cursors.set(
                  id,
                  args.afterCursors?.[id] ??
                    latestToolSessionCursor(id, await options.sessions.snapshot(id, exec.signal)),
                );
              for (;;) {
                const before = revision;
                const snapshots = [];
                const changed = [];
                for (const id of ids) {
                  const value = await read(id, cursors.get(id), exec);
                  snapshots.push(value);
                  if (
                    value.entries.length > 0 ||
                    value.statusChanged ||
                    value.hasMore ||
                    (args.afterCursors?.[id] === undefined &&
                      value.status !== 'running' &&
                      value.status !== 'queued')
                  )
                    changed.push(value);
                  cursors.set(id, value.cursor);
                }
                if (changed.length > 0 || timedOut)
                  return {
                    workspaceId,
                    timedOut: changed.length === 0 && timedOut,
                    sessions: changed.length > 0 ? changed : snapshots,
                  };
                check(exec);
                if (before !== revision) continue;
                await new Promise<void>((resolve) => {
                  wake = resolve;
                  if (exec.signal.aborted || before !== revision) resolve();
                });
                wake = undefined;
                check(exec);
              }
            } finally {
              clearTimeout(timer);
              unsubscribe();
              exec.signal.removeEventListener('abort', abort);
            }
          },
        );
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
        text: 'Enabled Worktree creation, delegation, discovery, read, follow-up and wait tools for this conversation.',
      };
    },
  });
}
