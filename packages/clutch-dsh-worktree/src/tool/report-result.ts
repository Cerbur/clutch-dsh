import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { text } from './inputs.js';
import { authorize, errorText } from './context.js';
import * as output from './outputs.js';

const reportArgs = z
  .object({
    status: z
      .enum(['completed', 'blocked', 'failed'])
      .describe(
        'Your task outcome. completed requires finished work and verification; blocked requires help; failed means the task could not be fulfilled.',
      ),
    summary: text
      .max(2000)
      .describe(
        'Concise outcome, changed files or the specific blocker. Do not include conversation history or intermediate steps.',
      ),
    evidence: text
      .max(2000)
      .optional()
      .describe(
        'Verification commands and results, artifact paths, remaining risks, or what help is required.',
      ),
    requestId: text
      .max(200)
      .optional()
      .describe(
        'Omit for a new report. Reuse the returned id only to retry the identical report after uncertain admission.',
      ),
  })
  .strict();

export function registerReportResult(context: ToolContext): () => void {
  const { add, agent, options, check, scope, delegation } = context;
  return add(
    'clutch_report_result',
    'Push one concise result or blocker only when the Host holds an active in-memory report token for this delegated task. Successful completed, blocked or failed admission consumes the token. The tool stays available but calls without a token are rejected; later user work must not report to the former parent. Only an explicit new parent dispatch grants another token. Required fields: status and summary; optional evidence and retry requestId. On uncertain admission retry only the identical report with its returned requestId. The Host fixes the destination. Include verification evidence. This is your claim, not automatic proof of success. Returns message admission, not a reply.',
    reportArgs,
    output.object(
      {
        workspaceId: output.string,
        sessionId: output.string,
        parentSessionId: output.string,
        requestId: output.string,
        status: { type: 'string', enum: ['admitted', 'prompt-failed'] },
        error: output.string,
        correction: output.string,
      },
      ['workspaceId', 'sessionId', 'parentSessionId', 'requestId', 'status'],
    ),
    async (args, exec) => {
      const reportTask = delegation.assertReport(agent);
      const { parentSessionId } = reportTask;
      const workspaceId = await scope();
      await authorize(agent.session.id, workspaceId, options, true);
      await authorize(parentSessionId, workspaceId, options, true);
      check(exec);
      const requestId = args.requestId ?? `clutch-worktree-report:${randomUUID()}`;
      if (args.requestId !== undefined && !reportTask.attempt)
        throw Object.assign(new Error('A report requestId must come from this token’s previous uncertain admission.'), { code: 'REPORT_RETRY_REQUIRED' });
      const identity = { workspaceId, sessionId: agent.session.id, parentSessionId, requestId };
      const message = JSON.stringify({
        kind: 'worktree-task-report',
        fromSessionId: agent.session.id,
        status: args.status,
        summary: args.summary,
        ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
      });
      delegation.claimReport(agent, reportTask, requestId, message);
      const attempt = reportTask.attempt!;
      try {
        await options.sessions.prompt(
          {
            sessionId: parentSessionId,
            requestId,
            mode: 'queue',
            content: [
              {
                type: 'text',
                text: `Delegated Session report (claims require verification; no automatic reply needed):\n${message}`,
              },
            ],
          },
          exec.signal,
        );
        delegation.close(reportTask);
        return { ...identity, status: 'admitted' };
      } catch (cause) {
        exec.signal.throwIfAborted();
        return {
          ...identity,
          status: 'prompt-failed',
          error: errorText(cause).slice(0, 700),
          correction:
            'Admission may have succeeded. Retry this identical report using the returned requestId; do not send a new report id for the same attempt.',
        };
      } finally {
        attempt.pending = false;
      }
    },
  );
}
