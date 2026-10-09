import { z } from 'zod';

const examples: Record<string, unknown> = {
  clutch_new_worktree: { name: 'feature/demo' },
  clutch_list_worktrees: {},
  clutch_span_worktree: {
    worktreeId: 'wt_<id returned by new/list>',
    prompt: 'Implement the task and verify its acceptance criteria.',
  },
  clutch_list_models: {},
  clutch_list_sessions: { worktreeId: 'wt_<id returned by new/list>' },
  clutch_send_message: {
    sessionId: 'session-<id returned by span/list>',
    prompt: 'Add the missing test.',
  },
  clutch_report_result: {
    status: 'completed',
    summary: 'Implemented the requested feature.',
    evidence: 'Tests passed; include the command and result.',
  },
};
export function recovery(name: string): string {
  return [
    'Use only the documented fields and exact ids returned by discovery/creation; ids are not paths or titles.',
    name === 'clutch_span_worktree'
      ? 'Supply exactly one worktreeId or legacy exact branch name, plus a nonempty prompt. List Worktrees to select an active healthy target; list models only for an explicit override.'
      : '',
    name === 'clutch_send_message' || name === 'clutch_report_result'
      ? 'The target must still belong to the same Workspace with a valid binding/cwd. Repair unavailable or detached relations first. On uncertain admission retry the identical message with the returned requestId.'
      : '',
    'Do not repeat a failed mutation without checking returned identities and its failed stage.',
    `Example: ${name}(${JSON.stringify(examples[name] ?? {})})`,
  ]
    .filter(Boolean)
    .join(' ');
}
export function actionableError(name: string, cause: unknown): Error {
  const invalid = cause instanceof z.ZodError;
  const issues = invalid
    ? cause.issues.flatMap((issue) =>
        issue.code === 'invalid_union' ? issue.errors.flat() : [issue],
      )
    : [];
  const reason = invalid
    ? issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; ')
    : cause instanceof Error
      ? cause.message
      : String(cause);
  const code = invalid
    ? 'INVALID_ARGUMENTS'
    : ((cause as { code?: unknown } | null)?.code ?? 'TOOL_OPERATION_FAILED');
  return new Error(`${name}: ${code}. Why: ${reason.slice(0, 700)}. Correction: ${recovery(name)}`);
}
