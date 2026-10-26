import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { text } from './inputs.js';
import { authorize, errorText } from './context.js';
import * as output from './outputs.js';
import { ToolRecoveryError } from './errors.js';

const reportArgs = z
  .object({
    status: z
      .enum(['completed', 'blocked', 'failed'])
      .describe(
        'completed: requested work and checks finished; blocked: needs help; failed: task could not be fulfilled.',
      ),
    summary: text
      .max(2000)
      .describe(
        'Concise outcome or blocker; no history or intermediate steps.',
      ),
    evidence: text
      .max(2000)
      .optional()
      .describe(
        'Checks/results, artifacts, risks or required help; omitted/null adds none.',
      ),
    requestId: text
      .max(200)
      .optional()
      .describe(
        'Host-returned retry id only; never invent one or use the task/message id. Omit for a first report (JSON null also accepted); for uncertain admission reuse the returned report id with identical content.',
      ),
  })
  .strict();

export function registerReportResult(context: ToolContext): () => void {
  const { add, agent, options, check, scope, delegation } = context;
  return add(
    'clutch_report_result',
    'Push one delegated-task result as an Agent relay with Host-fixed recipient and sender. Returns admission, not a reply or proof of success; include verification evidence. Successful admission consumes the in-memory task token; tokenless calls fail even while visible. Later human work cannot report to the former parent; only explicit new parent dispatch grants another token.',
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
        throw new ToolRecoveryError(
          'A report requestId must come from this token’s previous uncertain admission.',
          'REPORT_RETRY_REQUIRED',
          'This call was rejected before report admission. Omit requestId (or use JSON null) and submit the same status, summary and evidence. The Host generates the report id; do not invent one or copy the task/message id.',
        );
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
        await options.sessions.sendAgentMessage(
          {
            sender: agent,
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
