import { randomUUID } from 'node:crypto';

// DSH owns admission and persistence; the Host contributes pre-step messages.
interface Message {
  id: string;
  role: 'user';
  content: { type: 'text'; text: string }[];
  source: { kind: string; plugin?: string; form?: string };
}
interface Session {
  id: string;
  surface: { nodes: readonly number[] };
  snapshotEvents(): readonly { type: string; seq: number; data: unknown }[];
}
type Decision = { kind: 'reject' } | { kind: 'enter'; messages: Message[] };
export interface WorktreeInstructionHost {
  on(
    event: 'agent/pre-step',
    listener: (
      context: { agent: { session: Session }; signal?: AbortSignal },
      next: () => Promise<Decision>,
    ) => Promise<Decision>,
  ): unknown;
}
const plugin = '@cerbur/clutch-dsh-worktree';
const cleared =
  '<system-reminder>\nNo Worktree instructions apply. Disregard earlier Worktree instructions.\n</system-reminder>';

function ownedText(value: unknown): string | undefined {
  const message = value as Partial<Message> | null;
  if (message?.source?.kind !== 'plugin' || message.source.plugin !== plugin) return;
  if (!Array.isArray(message.content) || message.content.length !== 1) return;
  const block = message.content[0];
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : undefined;
}

export function registerWorktreeInstructions(
  host: WorktreeInstructionHost,
  resolve: (sessionId: string) => Promise<string>,
  isDisposed: () => boolean,
): void {
  host.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind === 'reject' || isDisposed()) return decision;
    signal?.throwIfAborted();
    const instructions = await resolve(agent.session.id);
    signal?.throwIfAborted();
    if (isDisposed()) return decision;
    const text = instructions.trim()
      ? [
          '<system-reminder>',
          'Shared instructions for this Worktree. This replaces all earlier Worktree instructions:',
          instructions,
          '</system-reminder>',
        ].join('\n')
      : cleared;
    const visible = new Set(agent.session.surface.nodes);
    let published = false;
    let latest: string | undefined;
    for (const event of [...agent.session.snapshotEvents()].reverse()) {
      if (event.type !== 'user/message') continue;
      const previous = ownedText(event.data);
      if (previous === undefined) continue;
      published = true;
      if (visible.has(event.seq)) {
        latest = previous;
        break;
      }
    }
    const messages = decision.messages.filter((message) => ownedText(message) === undefined);
    if (latest === text || (!published && !instructions.trim())) {
      return messages.length === decision.messages.length ? decision : { ...decision, messages };
    }
    const pending = decision.messages.find((message) => ownedText(message) === text);
    return {
      ...decision,
      messages: [
        ...messages,
        pending ?? {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin, form: 'instructions' },
        },
      ],
    };
  });
}
