const string = { type: 'string' };
const boolean = { type: 'boolean' };
const integer = { type: 'integer' };
const array = (items: unknown) => ({ type: 'array', items });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const model = object({ provider: string, model: string, reasoningEffort: string }, [
  'provider',
  'model',
]);
const worktree = object(
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
const entry = object(
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
const read = object(
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
const catalogModel = object(
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

/** Explicit schemas keep native and PTC callers able to use returned identities/cursors. */
export const worktreeToolOutputs: Readonly<Record<string, unknown>> = {
  clutch_new_worktree: object(
    {
      workspaceId: string,
      worktreeId: string,
      name: string,
      absolutePath: string,
      baseBranch: string,
      baseCommit: string,
      instructionsSaved: boolean,
      error: string,
    },
    ['workspaceId', 'worktreeId', 'name', 'absolutePath', 'instructionsSaved'],
  ),
  clutch_list_worktrees: object(
    {
      workspaceId: string,
      worktrees: array(worktree),
      branches: array(
        object({ name: string, isCurrent: boolean, checkedOut: boolean }, [
          'name',
          'isCurrent',
          'checkedOut',
        ]),
      ),
      branchesUnavailable: string,
    },
    ['workspaceId', 'worktrees'],
  ),
  clutch_span_worktree: object(
    {
      workspaceId: string,
      worktreeId: string,
      sessionId: string,
      status: {
        type: 'string',
        enum: ['dispatched', 'binding-failed', 'model-failed', 'title-failed', 'prompt-failed'],
      },
      model,
      requestId: string,
      error: string,
    },
    ['workspaceId', 'worktreeId', 'sessionId', 'status', 'model', 'requestId'],
  ),
  clutch_list_models: object(
    {
      current: model,
      default: model,
      groups: array(
        object({ id: string, name: string, models: array(catalogModel) }, ['id', 'name', 'models']),
      ),
      failures: array(object({ id: string, name: string, message: string }, ['id', 'message'])),
    },
    ['current', 'default', 'groups', 'failures'],
  ),
  clutch_list_sessions: object(
    {
      workspaceId: string,
      sessions: array(
        object(
          {
            sessionId: string,
            worktreeId: string,
            bindingStatus: string,
            cwd: string,
            status: string,
            title: string,
            cursor: string,
            diagnostic: string,
          },
          ['sessionId', 'bindingStatus', 'status'],
        ),
      ),
    },
    ['workspaceId', 'sessions'],
  ),
  clutch_read_session: read,
  clutch_send_message: object(
    {
      workspaceId: string,
      sessionId: string,
      requestId: string,
      accepted: { const: true, type: 'boolean' },
      status: { type: 'string', enum: ['admitted', 'prompt-failed'] },
      error: string,
      mode: { type: 'string', enum: ['queue', 'steer'] },
    },
    ['workspaceId', 'sessionId', 'requestId', 'status', 'mode'],
  ),
  clutch_wait_sessions: object({ workspaceId: string, timedOut: boolean, sessions: array(read) }, [
    'workspaceId',
    'timedOut',
    'sessions',
  ]),
};
