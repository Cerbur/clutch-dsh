import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateSessionStatus,
  deriveSessionPresentationIndex,
} from '../lib/client/session/session-view.js';
import {
  nativeStatusFixture,
  statusRenderers,
  findNodes,
} from './native-session-status-fixture.mjs';

const dots = (node) =>
  findNodes(node, (item) => item.type === 'StateDot').map((item) => item.props.state);

test('native off-main completion reaches Session dot and collapsed Worktree/Workspace', async () => {
  const f = await nativeStatusFixture();
  try {
    const render = await statusRenderers();
    f.render();
    f.running(false);
    const current = f.list.getSnapshot();
    f.list.set({ ...current, byId: { ...current.byId, s: { ...current.byId.s, running: false } } });
    assert.equal(f.status().completionUnread, true, 'real UiSession owns unread completion');
    assert.equal('completed' in f.list.getSnapshot().byId.s, false);
    const source = f.render();
    assert.equal(source.sessionPresentations.s.completed, true);
    assert.deepEqual(dots(render.session(source.sessionPresentations.s)), ['done']);
    const aggregate = aggregateSessionStatus(['s'], source.sessionPresentations);
    assert.equal(aggregate?.labelKey, 'completed');
    assert.deepEqual(dots(render.group(aggregate)), ['done']);
    assert.deepEqual(dots(render.workspace(aggregate)), ['done']);
    assert.deepEqual(dots(render.group(aggregate, true)), []);
    assert.deepEqual(dots(render.workspace(aggregate, true)), []);
    assert.deepEqual(dots(render.dashboard(source)), ['done']);
  } finally {
    await f.dispose();
  }
});

test('status-only stop and rerun re-render without changing byId or creating a second unread owner', async () => {
  const f = await nativeStatusFixture();
  try {
    const render = await statusRenderers();
    const before = f.render();
    const byId = before.sessions.byId;
    f.running(false);
    assert.equal(f.h.dirty, true, 'native status subscription schedules render');
    const stopped = f.render();
    assert.strictEqual(stopped.sessions.byId, byId);
    assert.notStrictEqual(stopped.sessionPresentations, before.sessionPresentations);
    assert.equal(stopped.sessionPresentations.s.completed, true);
    assert.equal(
      stopped.sessionPresentations.s.running,
      false,
      'native status outranks stale list running',
    );
    assert.deepEqual(dots(render.dashboard(stopped)), ['done']);
    f.running(true);
    const rerun = f.render();
    assert.strictEqual(rerun.sessions.byId, byId);
    assert.equal(f.status().completionUnread, false);
    assert.equal(rerun.sessionPresentations.s.completed, false);
    assert.deepEqual(dots(render.session(rerun.sessionPresentations.s)), ['ongoing']);
    assert.deepEqual(dots(render.dashboard(rerun)), ['ongoing']);
  } finally {
    await f.dispose();
  }
});

test('opening the completed Session clears native, row, Dashboard and parent reminders', async () => {
  const f = await nativeStatusFixture();
  try {
    const render = await statusRenderers();
    f.render();
    f.running(false);
    const current = f.list.getSnapshot();
    f.list.set({ ...current, byId: { ...current.byId, s: { ...current.byId.s, running: false } } });
    assert.equal(f.render().sessionPresentations.s.completed, true);
    f.open();
    const opened = f.render();
    assert.equal(f.status().completionUnread, false);
    assert.equal(opened.sessionPresentations.s.completed, false);
    assert.deepEqual(dots(render.session(opened.sessionPresentations.s)), []);
    assert.deepEqual(dots(render.dashboard(opened)), []);
    const aggregate = aggregateSessionStatus(['s'], opened.sessionPresentations);
    assert.equal(aggregate, undefined);
    assert.deepEqual(dots(render.group(aggregate)), []);
    assert.deepEqual(dots(render.workspace(aggregate)), []);
    // A subsequent stop while retained by mainView must not become unread.
    f.running(true);
    f.running(false);
    assert.equal(f.render().sessionPresentations.s.completed, false);
  } finally {
    await f.dispose();
  }
});

test('cold idle and repeated idle events are not completions', async () => {
  const f = await nativeStatusFixture({ s: { running: false } });
  try {
    f.render();
    f.running(false);
    const source = f.render();
    assert.equal(f.status().completionUnread, false);
    assert.equal(source.sessionPresentations.s.completed, false);
    assert.equal(source.sessionPresentations.s.status.labelKey, 'idle');
    assert.equal(aggregateSessionStatus(['s'], source.sessionPresentations), undefined);
  } finally {
    await f.dispose();
  }
});

test('native interaction kinds outrank running and unread completion in rows and aggregates', async () => {
  const f = await nativeStatusFixture();
  try {
    const render = await statusRenderers();
    f.render();
    f.running(false);
    const publish = f.ctx.uiSession.registerPendingInteraction(
      (interaction) => ({ approval: 3, 'plan-review': 2, question: 1 })[interaction.kind],
    );
    const releases = [];
    for (const [kind, label] of [
      ['question', 'waitingAnswer'],
      ['plan-review', 'planReview'],
      ['approval', 'waitingApproval'],
    ]) {
      releases.push(publish({ kind, sessionId: 's', key: kind }, async () => {}));
      const source = f.render();
      assert.equal(f.status().pendingInteraction.kind, kind);
      assert.equal(source.sessionPresentations.s.completed, true);
      assert.equal(source.sessionPresentations.s.status.labelKey, label);
      const aggregate = aggregateSessionStatus(['s'], source.sessionPresentations);
      assert.equal(aggregate.labelKey, label);
      assert.deepEqual(dots(render.session(source.sessionPresentations.s)), ['warning']);
      assert.deepEqual(dots(render.group(aggregate)), ['warning']);
      assert.deepEqual(dots(render.workspace(aggregate)), ['warning']);
      assert.deepEqual(dots(render.dashboard(source)), ['warning']);
    }
    f.running(true);
    assert.equal(f.render().sessionPresentations.s.status.labelKey, 'waitingApproval');
    releases.reverse().forEach((release) => release());
    assert.equal(f.render().sessionPresentations.s.status.labelKey, 'running');
  } finally {
    await f.dispose();
  }
});

test('legacy fallback is used only without the native status hook, never for missing native entries', async () => {
  const f = await nativeStatusFixture({
    s: { running: false, completed: true, pendingInteraction: 'question' },
  });
  try {
    const native = f.render().sessionPresentations.s;
    assert.equal(native.completed, false);
    assert.equal(native.status.labelKey, 'idle');
    const absent = deriveSessionPresentationIndex(f.list.getSnapshot(), new Map()).s;
    assert.equal(absent.completed, false);
    assert.equal(absent.status.labelKey, 'idle');
    const legacyFixture = await nativeStatusFixture({
      s: { running: false, completed: true, pendingInteraction: 'question' },
    });
    try {
      // Hook availability is fixed for a mounted Client graph, not toggled mid-render.
      delete legacyFixture.props.useSessionStatus;
      const legacy = legacyFixture.render().sessionPresentations.s;
      assert.equal(legacy.completed, true);
      assert.equal(legacy.status.labelKey, 'waitingAnswer');
    } finally {
      await legacyFixture.dispose();
    }
  } finally {
    await f.dispose();
  }
});

test('catalog-only byId subagent lineage reads running from the native status source', async () => {
  const f = await nativeStatusFixture(
    { s: { running: false }, child: { running: false, origin: 'subagent', parentId: 's' } },
    ['s'],
  );
  try {
    const before = f.render();
    f.running(true, 'child');
    const source = f.render();
    assert.strictEqual(source.sessions.byId, before.sessions.byId);
    assert.equal(source.sessionPresentations.s.runningSubagentCount, 1);
    assert.equal(source.sessionPresentations.s.status.labelKey, 'subagentsRunning');
    f.running(false, 'child');
    assert.equal(f.render().sessionPresentations.s.runningSubagentCount, 0);
  } finally {
    await f.dispose();
  }
});

test('native group aggregation ranks approval, plan review, question, running, then unread', async () => {
  const f = await nativeStatusFixture({
    s: { running: true },
    run: { running: true },
    approval: { running: false },
    plan: { running: false },
    question: { running: false },
  });
  try {
    f.render();
    f.running(false);
    const publish = f.ctx.uiSession.registerPendingInteraction(() => 1);
    const releaseApproval = publish(
      { key: 'a', kind: 'approval', sessionId: 'approval' },
      async () => {},
    );
    const releasePlan = publish(
      { key: 'p', kind: 'plan-review', sessionId: 'plan' },
      async () => {},
    );
    const releaseQuestion = publish(
      { key: 'q', kind: 'question', sessionId: 'question' },
      async () => {},
    );
    const aggregate = () =>
      aggregateSessionStatus(
        ['s', 'run', 'question', 'plan', 'approval'],
        f.render().sessionPresentations,
      );
    assert.equal(aggregate().labelKey, 'waitingApproval');
    releaseApproval();
    assert.equal(aggregate().labelKey, 'planReview');
    releasePlan();
    assert.equal(aggregate().labelKey, 'waitingAnswer');
    releaseQuestion();
    assert.equal(aggregate().labelKey, 'running');
    // Only the completed member contributes when the running member is excluded.
    assert.equal(
      aggregateSessionStatus(['s'], f.render().sessionPresentations).labelKey,
      'completed',
    );
  } finally {
    await f.dispose();
  }
});
