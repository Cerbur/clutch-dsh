import type { Context } from '@deepseek-ai/cordis';
import type { z } from 'zod';
import type { WorktreeToolSessionPort } from './native-session.js';
import type { readToolSession } from './history.js';
import type { WorktreeManagerService } from '../manage/index.js';
import type { DshReadAdapter } from '../provider/types.js';
export type { WorktreeRecord } from '../contract/index.js';

export interface CallingAgent {
  readonly session: { readonly id: string };
  readonly ctx: Context;
}
export interface Execution {
  agent?: CallingAgent;
  signal: AbortSignal;
}
export interface Options {
  manager: Pick<
    WorktreeManagerService,
    | 'listWorktrees'
    | 'listBindings'
    | 'listBranches'
    | 'createWorktree'
    | 'createWorktreeAtCommit'
    | 'resolveRuntimeCwd'
    | 'readSessionHead'
    | 'bindSession'
    | 'updateWorktreeInstructions'
  >;
  dsh: Pick<DshReadAdapter, 'getSession' | 'getWorkspace' | 'listSessions' | 'listWorkspaces'>;
  sessions: WorktreeToolSessionPort;
  samePhysicalPath(left: string, right: string): Promise<boolean>;
  changed(workspaceId: string, worktreeId: string): void;
  isDisposed(): boolean;
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  output: {
    schema: unknown;
    render(args: unknown, value: unknown): { type: 'text'; text: string }[];
  };
  execute(args: unknown, exec: Execution): Promise<unknown>;
}
export interface ToolContext {
  agent: CallingAgent;
  options: Options;
  check(exec: Execution): void;
  scope(requested?: string): Promise<string>;
  read(
    sessionId: string,
    afterCursor: string | undefined,
    exec: Execution,
  ): Promise<{ workspaceId: string } & ReturnType<typeof readToolSession>>;
  add<Schema extends z.ZodType>(
    name: string,
    description: string,
    schema: Schema,
    outputSchema: unknown,
    execute: (args: z.output<Schema>, exec: Execution) => Promise<unknown>,
  ): void;
}
