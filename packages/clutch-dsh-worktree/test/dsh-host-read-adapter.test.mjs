import assert from 'node:assert/strict';
import test from 'node:test';

import { DshHostReadAdapter } from '../lib/host/dsh-read-adapter.js';

function header(id, cwd) {
  return {
    version: 0,
    id,
    createdAt: 1,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

test('reads Workspace and Session headers without touching DSH-owned content', async () => {
  const workspace = {
    id: 'ws_example',
    path: '/tmp/project',
    title: 'Project',
    sessionIds: ['session_cold'],
  };
  const liveSession = {
    id: 'session_live',
    header: header('session_live', '/tmp/worktree'),
    events: [{ type: 'user/message', data: { content: 'DSH-owned transcript' } }],
  };
  const persistedHeaders = [
    header('session_live', '/tmp/stale-live-copy'),
    header('session_cold', '/tmp/project'),
    header('session_without_cwd'),
  ];
  const fixtureBefore = JSON.stringify({ workspace, liveSession, persistedHeaders });
  let listCalls = 0;
  const adapter = new DshHostReadAdapter({
    workspaceRegistry: {
      get(id) {
        return id === workspace.id ? workspace : undefined;
      },
      list() {
        return [workspace];
      },
    },
    sessions: {
      get(id) {
        return id === liveSession.id ? liveSession : undefined;
      },
      list() {
        return [liveSession];
      },
    },
    sessionPersistence: {
      async list() {
        listCalls += 1;
        return persistedHeaders;
      },
      async inspect() {
        throw new Error('adapter must not inspect transcript data');
      },
      async load() {
        throw new Error('adapter must not load transcript data');
      },
      async create() {
        throw new Error('adapter must not mutate DSH data');
      },
    },
  });

  assert.deepEqual(await adapter.getWorkspace('ws_example'), {
    workspaceId: 'ws_example',
    rootPath: '/tmp/project',
  });
  assert.equal(await adapter.getWorkspace('missing'), undefined);
  assert.deepEqual(await adapter.getSession('session_live'), {
    sessionId: 'session_live',
    cwd: '/tmp/worktree',
  });
  assert.deepEqual(await adapter.getSession('session_cold'), {
    sessionId: 'session_cold',
    workspaceId: 'ws_example',
    cwd: '/tmp/project',
  });
  assert.equal(await adapter.getSession('missing'), undefined);
  assert.deepEqual(await adapter.listSessions(), [
    { sessionId: 'session_live', cwd: '/tmp/worktree' },
    {
      sessionId: 'session_cold',
      workspaceId: 'ws_example',
      cwd: '/tmp/project',
    },
    { sessionId: 'session_without_cwd', cwd: '' },
  ]);
  assert.equal(listCalls, 3);
  assert.equal(JSON.stringify({ workspace, liveSession, persistedHeaders }), fixtureBefore);
});
test('reads activity without loading transcripts or touching DSH data', async () => {
  const transcriptProbe = () => {
    throw new Error('prohibited transcript access');
  };
  const sessions = [
    {
      id: 's1',
      header: { id: 's1', cwd: '/tmp/s1' },
      get transcript() {
        return transcriptProbe();
      },
      get events() {
        return transcriptProbe();
      },
    },
  ];

  let snapshotCalls = [];
  const activitySource = {
    async snapshot(ids) {
      snapshotCalls.push(ids);
      return { complete: true, busySessionIds: [] };
    },
  };

  const adapter = new DshHostReadAdapter({
    workspaceRegistry: {
      get: () => undefined,
      list: () => [],
    },
    sessions: {
      get: (id) => sessions.find((s) => s.id === id),
      list: () => sessions,
    },
    sessionPersistence: {
      list: async () => [],
      inspect: transcriptProbe,
      load: transcriptProbe,
    },
    activitySource,
  });

  assert.deepEqual(await adapter.readWorktreeActivity(['s1']), { state: 'idle' });
  assert.deepEqual(snapshotCalls, [['s1']]);
  assert.deepEqual(await adapter.readWorktreeActivity([]), { state: 'idle' });

  // Direct busy
  activitySource.snapshot = async () => ({ complete: true, busySessionIds: ['s1'] });
  assert.deepEqual(await adapter.readWorktreeActivity(['s1']), { state: 'busy', sessionIds: ['s1'] });

  // Child busy
  activitySource.snapshot = async () => ({ complete: true, busySessionIds: ['subagent_child_1'] });
  assert.deepEqual(await adapter.readWorktreeActivity(['s1']), { state: 'busy', sessionIds: ['subagent_child_1'] });

  // Incomplete coverage is unknown
  activitySource.snapshot = async () => ({ complete: false, busySessionIds: [] });
  assert.deepEqual(await adapter.readWorktreeActivity(['s1']), { state: 'unknown' });

  // Snapshot throwing is unknown
  activitySource.snapshot = async () => {
    throw new Error('source failure');
  };
  assert.deepEqual(await adapter.readWorktreeActivity(['s1']), { state: 'unknown' });

  // Adapter without activitySource returns unknown for non-empty sessions
  const adapterWithoutSource = new DshHostReadAdapter({
    workspaceRegistry: { get: () => undefined, list: () => [] },
    sessions: { get: () => undefined, list: () => [] },
    sessionPersistence: { list: async () => [] },
  });
  assert.deepEqual(await adapterWithoutSource.readWorktreeActivity(['s1']), { state: 'unknown' });
  assert.deepEqual(await adapterWithoutSource.readWorktreeActivity([]), { state: 'idle' });
});
