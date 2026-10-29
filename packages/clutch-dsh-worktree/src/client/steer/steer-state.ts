/** Read-only presentation of this plugin's native next-step relay occurrences. */
export interface SteerRow {
  readonly id: string;
  readonly sender: string;
  readonly text: string;
  readonly status: 'pending' | 'preparing' | 'received' | 'canceled' | 'unknown';
}

export interface SteerState {
  /** Full native positions, including other producers, needed to interpret splices. */
  readonly pending: readonly string[] | undefined;
  readonly rows: readonly SteerRow[];
}

export const EMPTY_STEER_STATE: SteerState = { pending: [], rows: [] };
const RECENT_LIMIT = 8;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

/** Identity and source must both identify a Worktree task relay, never a report or human echo. */
export function steerRelay(value: unknown): SteerRow | undefined {
  const message = object(value);
  const source = object(message?.source);
  if (typeof message?.id !== 'string' || !/^clutch-worktree-relay:[a-f0-9]{64}$/.test(message.id) ||
    message.role !== 'user' || source?.kind !== 'agent-message' || source.form !== 'relay' ||
    typeof source.senderSessionId !== 'string' || !Array.isArray(message.content)) return undefined;
  const content = message.content.map(object);
  const envelope = 'Agent ' + source.senderSessionId + ' sent a message: ';
  const body = content[0]?.type === 'text' && content[0].text === envelope ? content.slice(1) : content;
  return {
    id: message.id,
    sender: source.senderSessionId,
    text: body.flatMap(part => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n'),
    status: 'pending',
  };
}

function bounded(rows: readonly SteerRow[]): readonly SteerRow[] {
  const recent = rows.filter(row => row.status !== 'pending' && row.status !== 'preparing').slice(-RECENT_LIMIT);
  const keep = new Set(recent.map(row => row.id));
  return rows.filter(row => row.status === 'pending' || row.status === 'preparing' || keep.has(row.id));
}

/** Replay native evidence; an inbox claim alone never establishes receipt or completion. */
export function reduceSteerState(state: SteerState, event: { readonly type: string; readonly data: unknown; readonly surfaceOp?: unknown }): SteerState {
  const data = object(event.data);
  if (event.type === 'turn/start') {
    return { ...state, rows: bounded(state.rows.filter(row => row.status === 'pending' || row.status === 'preparing')
      .map(row => row.status === 'preparing' ? { ...row, status: 'unknown' as const } : row)) };
  }
  if (event.type === 'user/message') {
    if (event.surfaceOp !== 'append') return state;
    const receipt = steerRelay(data);
    if (receipt === undefined) return state;
    const rows = state.rows.map(row => row.id === receipt.id && row.sender === receipt.sender && row.text === receipt.text
      ? { ...row, status: 'received' as const } : row);
    return { ...state, rows: bounded(rows) };
  }
  if (event.type !== 'agent/inbox/spliced' || !Array.isArray(data?.inserted)) return state;
  const inserted = data.inserted;
  if (data.target === 'next-turn') {
    // A canceled activity can route a steer to the normal Queue; native QueueDock owns it.
    const queued = new Set(inserted.map(item => object(item)?.id));
    return { ...state, rows: state.rows.filter(row => !queued.has(row.id)) };
  }
  if (data.target !== 'next-step') return state;
  const start = data.start;
  const count = data.removedCount ?? 0;
  const ids = inserted.map(item => object(item)?.id);
  const valid = typeof start === 'number' && Number.isSafeInteger(start) && start >= 0 &&
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && ids.every(id => typeof id === 'string');
  const positionsKnown = valid && state.pending !== undefined && start + count <= state.pending.length;
  const previous = state.pending ?? [];
  const removed = new Set(positionsKnown ? previous.slice(start, start + count) : []);
  const pending = positionsKnown
    ? [...previous.slice(0, start), ...ids as string[], ...previous.slice(start + count)]
    : undefined;
  let rows = state.rows.map(row => removed.has(row.id)
    ? { ...row, status: data.outcome === 'canceled' ? 'canceled' as const : 'preparing' as const }
    : !positionsKnown && (row.status === 'pending' || row.status === 'preparing') ? { ...row, status: 'unknown' as const } : row);
  for (const item of inserted) {
    const relay = steerRelay(item);
    if (relay !== undefined) rows = [...rows.filter(row => row.id !== relay.id), relay];
  }
  return { pending, rows: bounded(rows) };
}

/** Merge the authoritative pending projection with verified, current/recent-turn receipts. */
export function visibleSteerRows(state: SteerState | undefined, inbox: unknown): readonly SteerRow[] {
  const projection = object(inbox);
  const queued = new Set(Array.isArray(projection?.['next-turn'])
    ? projection['next-turn'].map(item => object(item)?.id) : []);
  const rows = new Map((state?.rows ?? []).map(row => [row.id, row]));
  if (Array.isArray(projection?.['next-step'])) {
    for (const value of projection['next-step']) {
      const relay = steerRelay(value);
      if (relay !== undefined && !rows.has(relay.id)) rows.set(relay.id, relay);
    }
  }
  // Projection absence is not an empty inbox and cannot prove consumption.
  const waiting = Array.isArray(projection?.['next-step']) ? new Set(projection['next-step'].map(item => object(item)?.id)) : undefined;
  const order = [...(waiting ?? [])];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...rows.values()].filter(row => !queued.has(row.id)).map((row): SteerRow => {
    if (row.status === 'unknown' && waiting?.has(row.id)) return { ...row, status: 'pending' };
    if (row.status === 'pending' && !waiting?.has(row.id)) return { ...row, status: waiting === undefined ? 'unknown' : 'preparing' };
    return row;
  }).sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
}
