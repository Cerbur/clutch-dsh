import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCurrentFireworksSession } from '../lib/client/fireworks-session.js';

test('selects the main-view fireworks signal from the DSH 0.1.7 session list', () => {
  const signal = { id: 'call-42', message: 'MVP shipped!' };
  const selection = selectCurrentFireworksSession({
    byId: {
      background: {
        id: 'background',
        retainedBy: { mainView: 0 },
        projectionValues: { fireworks: { id: 'background-call' } },
      },
      active: {
        id: 'active',
        retainedBy: { mainView: 1 },
        projectionValues: { fireworks: signal },
      },
    },
  });

  assert.deepEqual(selection, { sessionId: 'active', signal });
});

test('keeps using the legacy current pointer when an older host provides it', () => {
  const signal = { id: 'legacy-call' };
  const selection = selectCurrentFireworksSession({
    current: 'legacy',
    byId: {
      legacy: { id: 'legacy', projectionValues: { fireworks: signal } },
      retained: {
        id: 'retained',
        retainedBy: { mainView: 1 },
        projectionValues: { fireworks: { id: 'not-current' } },
      },
    },
  });

  assert.deepEqual(selection, { sessionId: 'legacy', signal });
});

test('prefers the selected id and falls back to the legacy current id when needed', () => {
  const signal = { id: 'legacy-call' };
  const selectedId = selectCurrentFireworksSession({
    current: 'legacy-key',
    byId: {
      'legacy-key': { id: 'canonical-id', projectionValues: { fireworks: signal } },
    },
  });
  const legacyFallback = selectCurrentFireworksSession({
    current: 'legacy-key',
    byId: {
      'legacy-key': { id: 42, projectionValues: { fireworks: signal } },
    },
  });

  assert.deepEqual(selectedId, { sessionId: 'canonical-id', signal });
  assert.deepEqual(legacyFallback, { sessionId: 'legacy-key', signal });
});

test('does not infer a session when a legacy host explicitly clears current', () => {
  assert.equal(
    selectCurrentFireworksSession({
      current: undefined,
      byId: {
        retained: {
          id: 'retained',
          retainedBy: { mainView: 1 },
          projectionValues: { fireworks: { id: 'ignored' } },
        },
      },
    }),
    undefined,
  );
});

test('returns no selection when the host has no active main-view session', () => {
  assert.equal(selectCurrentFireworksSession({ byId: {} }), undefined);
});

test('skips undefined entries in the session list while selecting the main-view session', () => {
  const signal = { id: 'active-call' };
  const selection = selectCurrentFireworksSession({
    byId: {
      missing: undefined,
      active: {
        id: 'active',
        retainedBy: { mainView: 1 },
        projectionValues: { fireworks: signal },
      },
    },
  });

  assert.deepEqual(selection, { sessionId: 'active', signal });
});

test('treats absent, null, or undefined byId as an empty session list', () => {
  assert.equal(selectCurrentFireworksSession({}), undefined);
  assert.equal(selectCurrentFireworksSession({ byId: null }), undefined);
  assert.equal(selectCurrentFireworksSession({ byId: undefined }), undefined);
});
