import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { CallingAgent } from './types.js';

// Same native relay record used by DSH subagents/Teams. A local map key keeps
// this Host adapter independent of the subagent service's Context type graph.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'clutch-worktree-agent-relay': {
      readonly kind: 'agent-message';
      readonly form: 'relay';
      readonly senderSessionId: string;
    };
  }
}

export interface AgentRelayInput {
  readonly sender: CallingAgent;
  readonly sessionId: string;
  readonly requestId: string;
  readonly mode: 'queue' | 'steer';
  readonly content: readonly { type: 'text'; text: string }[];
}
export interface RelayAgent extends CallingAgent {
  readonly inbox: { readonly nextTurn: readonly UserMessage[]; readonly nextStep: readonly UserMessage[] };
  followup(message: UserMessage): void;
  steer(message: UserMessage): void;
}
/** A native message identity, not a model-supplied sender or a human RPC source. */
export function relayMessageId(requestId: string): string {
  const prefix = requestId.startsWith('clutch-worktree-report:') ? 'clutch-worktree-relay-report:' : 'clutch-worktree-relay:';
  return prefix + createHash('sha256').update(JSON.stringify(requestId)).digest('hex');
}

interface RelayObservation extends Disposable {
  readonly events: readonly { readonly type: string; readonly data: unknown }[];
}

/** Native inbox insertion/history own receipts. Only active admission lanes live in memory. */
export function createAgentRelaySender(deps: {
  getAgent(id: string): RelayAgent | undefined;
  resolveAgent(id: string): Promise<RelayAgent>;
  observeSession(id: string, options: { signal: AbortSignal }): Promise<RelayObservation>;
}) {
  const lifetime = new AbortController();
  const revoked = new WeakSet<CallingAgent>();
  const lanes = new Map<string, Promise<void>>();
  const live = (agent: CallingAgent) => !revoked.has(agent) && deps.getAgent(agent.session.id) === agent;
  return {
    revoke(agent: CallingAgent): void { revoked.add(agent); },
    dispose(): void { lifetime.abort(new Error('Worktree relay adapter is disposed')); lanes.clear(); },
    async send(input: AgentRelayInput, callerSignal: AbortSignal): Promise<{ accepted: true }> {
      const signal = AbortSignal.any([callerSignal, lifetime.signal]);
      signal.throwIfAborted();
      if (!live(input.sender)) throw new Error('Agent relay requires the exact live sender');
      const previous = lanes.get(input.sessionId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      const tail = previous.then(() => current);
      lanes.set(input.sessionId, tail);
      try {
        await previous;
        signal.throwIfAborted();
        const target = await deps.resolveAgent(input.sessionId);
        signal.throwIfAborted();
        if (target.session.id !== input.sessionId || !live(input.sender) || !live(target)) throw new Error('Agent relay sender or recipient is no longer live');
        using observed = await deps.observeSession(input.sessionId, { signal });
        signal.throwIfAborted();
        if (target.session.id !== input.sessionId || !live(input.sender) || !live(target)) throw new Error('Agent relay sender or recipient is no longer live');
        const message = agentRelayMessage(input);
        // Claim removes pending input before awaited prompt/request preparation;
        // user/message is appended only later. The durable insertion spans that
        // gap, and remains an admission receipt after native cancellation/removal.
        let accepted = false;
        const inspect = (value: unknown) => {
          const receipt = value as Partial<UserMessage> | null;
          if (typeof receipt?.id !== 'string') throw new Error('Native Agent message receipt is unreadable');
          if (receipt.id !== message.id) return;
          if (receipt.role !== message.role || !isDeepStrictEqual(receipt.source, message.source) || !isDeepStrictEqual(receipt.content, message.content))
            throw new Error('Agent relay retry identity requires identical sender and content');
          accepted = true;
        };
        for (const receipt of [...target.inbox.nextTurn, ...target.inbox.nextStep]) inspect(receipt);
        // Check every occurrence: a later same-id replacement must not hide a
        // conflicting original admission, or let a retry adopt its changed body.
        for (const event of observed.events) {
          if (event.type === 'user/message') inspect(event.data);
          else if (event.type === 'agent/inbox/spliced') {
            const inserted = (event.data as { inserted?: unknown } | null)?.inserted;
            if (!Array.isArray(inserted)) throw new Error('Native Agent inbox insertion receipt is unreadable');
            for (const receipt of inserted) inspect(receipt);
          }
        }
        if (accepted) return { accepted: true };
        // No await across the final live/abort check and native acceptance.
        if (input.mode === 'steer') target.steer(message);
        else target.followup(message);
        return { accepted: true };
      } finally {
        release();
        if (lanes.get(input.sessionId) === tail) lanes.delete(input.sessionId);
      }
    },
  };
}

/** Construct a native relay without importing the subagent manager's private helpers. */
export function agentRelayMessage(input: AgentRelayInput): UserMessage {
  const message = createUserMessage({
    source: { kind: 'agent-message', form: 'relay', senderSessionId: input.sender.session.id },
    content: [
      { type: 'text', text: 'Agent ' + input.sender.session.id + ' sent a message: ' },
      ...input.content,
    ],
  });
  return freezeMessage({ ...message, id: relayMessageId(input.requestId) as typeof message.id });
}
