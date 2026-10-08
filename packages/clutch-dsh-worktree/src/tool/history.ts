import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { ToolSessionEvent, ToolSessionSnapshot } from './native-session.js';

const TEXT_CHUNK = 8000;
const TEXT_BUDGET = 32000;
const EVENT_LIMIT = 20;

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function eventText(event: ToolSessionEvent): string | undefined {
  const data = object(event.data);
  const message = event.type === 'user/message' ? data : object(data.message);
  const content = message.content;
  if (Array.isArray(content))
    return content
      .map((part) => object(part))
      .filter((part) => part.type === 'text')
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  return undefined;
}

function state(snapshot: ToolSessionSnapshot): string {
  const pending = new Set<string>();
  let end: Record<string, unknown> = {};
  for (const event of snapshot.events) {
    const data = object(event.data);
    if (event.type === 'approval/asked' && typeof data.id === 'string') pending.add(data.id);
    if (event.type === 'approval/decided' && typeof data.id === 'string') pending.delete(data.id);
    if (event.type === 'turn/start') end = {};
    if (event.type === 'turn/end') {
      end = object(data.reason);
      pending.clear();
    }
  }
  if (snapshot.values.worktreeToolWaitingForUser === true || pending.size > 0)
    return 'waiting-for-user';
  if (snapshot.running) return 'running';
  if (snapshot.error || end.kind === 'error') return 'error';
  if (end.kind === 'interrupted') return 'interrupted';
  if (end.kind === 'aborted') return 'cancelled';
  if (end.kind === 'blocked') return 'blocked';
  const inbox = object(snapshot.values.inbox);
  if (['next-turn', 'next-step'].some((key) => Array.isArray(inbox[key]) && inbox[key].length > 0))
    return 'queued';
  return 'idle';
}

type Cursor = [sessionId: string, nextSeq: number, textOffset: number, status: string];

export function decodeCursor(sessionId: string, value: string): Cursor {
  try {
    if (value.length > 2048) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 4 ||
      parsed[0] !== sessionId ||
      !Number.isSafeInteger(parsed[1]) ||
      parsed[1] < 0 ||
      !Number.isSafeInteger(parsed[2]) ||
      parsed[2] < 0 ||
      typeof parsed[3] !== 'string'
    )
      throw new Error();
    return parsed as Cursor;
  } catch {
    throw new Error('Invalid Session cursor; use the cursor returned for this Session');
  }
}

const cursor = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString('base64url');
const stateStamp = (status: string, error?: string) =>
  JSON.stringify([
    status,
    createHash('sha256')
      .update(error ?? '')
      .digest('hex'),
  ]);

/** Bounded text fragments with a cursor that never skips an oversized message. */
export function readToolSession(
  sessionId: string,
  snapshot: ToolSessionSnapshot,
  afterCursor?: string,
) {
  const status = state(snapshot);
  const stamp = stateStamp(status, snapshot.error);
  const previous = afterCursor === undefined ? undefined : decodeCursor(sessionId, afterCursor);
  let nextSeq = previous?.[1] ?? Math.max(0, snapshot.events.length - 100);
  let offset = previous?.[2] ?? 0;
  if (nextSeq > snapshot.events.length || (nextSeq === snapshot.events.length && offset !== 0))
    throw new Error('Session cursor is ahead of the current history');
  const entries: {
    seq: number;
    time: number;
    type: string;
    text?: string;
    textOffset?: number;
    continued?: boolean;
    reason?: unknown;
  }[] = [];
  let budget = TEXT_BUDGET;
  while (nextSeq < snapshot.events.length && entries.length < EVENT_LIMIT && budget > 0) {
    const event = snapshot.events[nextSeq];
    if (event.seq !== nextSeq) throw new Error('Session history is not contiguous');
    if (
      ![
        'user/message',
        'assistant/message',
        'turn/start',
        'turn/end',
        'approval/asked',
        'approval/decided',
      ].includes(event.type)
    ) {
      if (offset !== 0) throw new Error('Invalid Session text cursor');
      nextSeq++;
      continue;
    }
    const text = eventText(event);
    if (offset > (text?.length ?? 0)) throw new Error('Invalid Session text cursor');
    const fragment = text?.slice(offset, offset + Math.min(TEXT_CHUNK, budget));
    const continued = text !== undefined && offset + (fragment?.length ?? 0) < text.length;
    entries.push({
      seq: event.seq,
      time: event.time,
      type: event.type,
      ...(fragment === undefined ? {} : { text: fragment, textOffset: offset, continued }),
      ...(event.type === 'turn/end'
        ? { reason: object(object(event.data).reason).kind ?? 'unknown' }
        : {}),
    });
    budget -= fragment?.length ?? 0;
    if (continued) offset += fragment?.length ?? 0;
    else {
      nextSeq++;
      offset = 0;
    }
  }
  let lastEnd: ToolSessionEvent | undefined;
  for (let index = snapshot.events.length - 1; index >= 0; index--) {
    if (snapshot.events[index].type === 'turn/end') {
      lastEnd = snapshot.events[index];
      break;
    }
  }
  const failure = object(object(object(lastEnd?.data).reason).error).message;
  return {
    sessionId,
    status,
    running: snapshot.running,
    entries,
    cursor: cursor([sessionId, nextSeq, offset, stamp]),
    hasMore: nextSeq < snapshot.events.length,
    historyOmitted: previous === undefined && snapshot.events.length > 100,
    statusChanged: previous !== undefined && previous[3] !== stamp,
    ...(snapshot.error || (status === 'error' && typeof failure === 'string')
      ? { error: (snapshot.error ?? String(failure)).slice(0, TEXT_CHUNK) }
      : {}),
  };
}

export function latestToolSessionCursor(sessionId: string, snapshot: ToolSessionSnapshot): string {
  const status = state(snapshot);
  return cursor([sessionId, snapshot.events.length, 0, stateStamp(status, snapshot.error)]);
}
