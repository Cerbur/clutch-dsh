export const string = { type: 'string' };
export const boolean = { type: 'boolean' };
export const integer = { type: 'integer' };
export const array = (items: unknown) => ({ type: 'array', items });
export const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export const model = object({ provider: string, model: string, reasoningEffort: string }, [
  'provider',
  'model',
]);
export const worktree = object(
  {
    worktreeId: string,
    branch: string,
    absolutePath: string,
    status: string,
    health: string,
    diskCleanup: string,
    baseBranch: string,
    baseCommit: string,
  },
  ['worktreeId', 'branch', 'absolutePath', 'status'],
);
export const entry = object(
  {
    seq: integer,
    time: integer,
    type: string,
    text: string,
    textOffset: integer,
    continued: boolean,
    reason: string,
  },
  ['seq', 'time', 'type'],
);
export const read = object(
  {
    workspaceId: string,
    sessionId: string,
    status: string,
    running: boolean,
    entries: array(entry),
    cursor: string,
    hasMore: boolean,
    historyOmitted: boolean,
    statusChanged: boolean,
    error: string,
  },
  [
    'workspaceId',
    'sessionId',
    'status',
    'running',
    'entries',
    'cursor',
    'hasMore',
    'historyOmitted',
    'statusChanged',
  ],
);
export const catalogModel = object(
  {
    id: string,
    name: string,
    description: string,
    reasoning: object(
      {
        efforts: array(object({ id: string, name: string, description: string }, ['id', 'name'])),
        defaultEffort: string,
      },
      ['efforts'],
    ),
  },
  ['id', 'name'],
);
