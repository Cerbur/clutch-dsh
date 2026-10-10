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
const delegationRecovery: Record<string, string> = {
  REPORT_TASK_CLOSED: 'Finish later user work in this Session. Only an explicit new parent dispatch can reopen reporting; do not bypass closure with another message tool.',
  REPORT_TASK_NOT_STARTED: 'The queued task must enter execution before its result can be reported.',
  REPORT_RETRY_REQUIRED: 'Retry the identical report with its original requestId. Do not alter its outcome, summary or evidence, use a fresh id, or dispatch new work while admission is uncertain.',
  REPORT_IN_PROGRESS: 'Wait for the existing report admission to settle; do not submit a parallel report.',
  DELEGATION_CALLBACK_BLOCKED: 'Handle the incoming report/message locally and end the turn. Wait for fresh human input or a valid parent task; do not substitute another dispatch tool.',
  DELEGATION_CYCLE: 'Do not message yourself or an ancestor. Use the active one-shot result report for a delegated task outcome.',
  DELEGATION_RETRY_MISMATCH: 'Retry only the original destination, content and mode with that requestId. A new authorized message needs a fresh id.',
  DELEGATION_RETRY_EXPIRED: 'The original retry identity is no longer available in memory. Ask the human how to proceed; do not automatically send a replacement task.',
  DELEGATION_CAPACITY: 'Wait for pending tasks to finish or ask the human to reduce delegation depth. Do not bypass the runtime capacity limit.',
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
  const correction = delegationRecovery[String(code)] ?? recovery(name);
  return new Error(`${name}: ${code}. Why: ${reason.slice(0, 700)}. Correction: ${correction}`);
}
