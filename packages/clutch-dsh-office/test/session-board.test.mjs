import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectSessionBoard } from '../lib/office/session-board.js';
import { activityClocks, elapsedTime } from '../lib/client/session-time.js';
import { recentSessionFacts } from '../lib/client/native-facts.js';
import { createRoamingMotion, advanceRoamingMotion } from '../lib/office/roaming.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function sourceModule(url) {
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.compileFunction(code, ['require', 'exports'])((specifier) => {
    if (specifier === './runtime.js')
      return {
        createKitchenRuntime() {
          throw Error('SSR must not allocate a renderer');
        },
      };
    if (specifier === '../office/session-board.js') return { projectSessionBoard };
    if (specifier === './session-time.js') return require('../lib/client/session-time.js');
    if (specifier.startsWith('.'))
      return sourceModule(new URL(specifier.replace(/\.js$/, '.tsx'), url));
    return require(specifier);
  }, exports);
  return exports;
}
const { OfficeDashboard } = sourceModule(
  new URL('../src/client/OfficeDashboard.tsx', import.meta.url),
);
import { zh } from '../lib/client/locales.js';
const ws = [{ id: 'w', title: 'Workspace one', sessionIds: ['a', 'b', 'c', 'd', 'e', 'idle'] }];
const summaries = Object.fromEntries(
  ['a', 'b', 'c', 'd', 'e', 'idle'].map((id, i) => [
    id,
    {
      blank: false,
      running: false,
      title: 'Full title ' + id,
      updatedAt: 1000 + i,
      cwd: '/repo/' + id,
    },
  ]),
);
const statuses = new Map([
  ['a', { running: true }],
  ['b', { running: true, pendingInteraction: { kind: 'approval' } }],
  ['c', { running: false, completionUnread: true }],
  ['d', { running: false, pendingInteraction: { kind: 'plan-review' } }],
  ['e', { running: false, pendingInteraction: { kind: 'question' } }],
]);
const read = (
  ids = Object.keys(summaries),
  byId = summaries,
  status = statuses,
  archived = [],
  workspaces = ws,
) => recentSessionFacts(ids, byId, status, archived, workspaces, () => undefined, 'Ungrouped');
test('native active, approval, plan, question and unread share one scene; idle is absent from the list', () => {
  const board = projectSessionBoard(read());
  assert.equal(board.sessions.length, 5);
  assert.equal(board.office.activeCount, 5);
  assert.equal(board.office.actors.length, 4);
  assert.equal(board.office.overflow, 1);
  assert.deepEqual(
    board.sessions.map((s) => s.id),
    ['e', 'd', 'c', 'b', 'a'],
  );
  assert.equal(board.sessions.find((s) => s.id === 'b').status, 'approval');
  assert.equal(board.sessions.find((s) => s.id === 'c').status, 'unread');
  assert.equal(board.sessions[0].workspaceTitle, 'Workspace one');
});
test('native status false and absent unread override summary; Office never mutates status or marks read', () => {
  const before = JSON.stringify([...statuses]);
  const a = read(['a'], summaries, new Map([['a', { running: false }]]));
  assert.equal(a[0].status, 'idle');
  projectSessionBoard(read());
  assert.equal(JSON.stringify([...statuses]), before);
  assert.equal(
    read(
      ['a'],
      summaries,
      new Map([['a', { completionUnread: false, pendingInteraction: { kind: 'other' } }]]),
    )[0].status,
    'idle',
  );
});
test('filtering excludes blank, archived, subagent and catalog-only identities but retains ungrouped list members', () => {
  const by = {
    ...summaries,
    blank: { blank: true },
    child: { blank: false, origin: 'subagent', running: true },
    catalog: { blank: false, running: true },
  };
  const out = read(['a', 'a', 'blank', 'child', 'b', 'missing', 'idle'], by, statuses, ['b'], []);
  assert.deepEqual(
    out.map((s) => s.id),
    ['a', 'idle'],
  );
  assert.equal(out[0].workspaceTitle, 'Ungrouped');
});
test('native subagent activity rolls up to listed parent without adding a subagent character', () => {
  const by = {
    p: { blank: false, running: false },
    s: { blank: false, running: true, origin: 'subagent', parentId: 'p' },
  };
  const out = read(['p', 's'], by, new Map(), [], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'running');
});
test('admitted actors survive reorders and title/workspace/status changes; freed seats refill up to four', () => {
  const first = projectSessionBoard(read());
  const updated = read().map((s) => ({
    ...s,
    updatedAt: 9000 - (s.updatedAt ?? 0),
    label: 'Renamed ' + s.id,
    workspaceTitle: 'Other',
  }));
  const next = projectSessionBoard(updated, first.office.actors);
  assert.deepEqual(
    next.office.actors.map((a) => [a.id, a.seat]),
    first.office.actors.map((a) => [a.id, a.seat]),
  );
  assert.ok(
    next.office.actors.every((a) => a.label.startsWith('Renamed') && a.workspaceTitle === 'Other'),
  );
  const remove = first.office.actors[0].id;
  const last = projectSessionBoard(
    updated.filter((s) => s.id !== remove),
    next.office.actors,
  );
  assert.equal(last.office.actors.length, 4);
  assert.equal(new Set(last.office.actors.map((a) => a.seat)).size, 4);
  assert.equal(
    last.office.actors.some((a) => a.id === remove),
    false,
  );
});
test('unread-to-read withdraws both actor and list row; empty list has one empty scene', () => {
  const a = read(['c']);
  const board = projectSessionBoard(a);
  assert.equal(board.office.actors.length, 1);
  const cleared = projectSessionBoard(read(['c'], summaries, new Map()), board.office.actors);
  assert.equal(cleared.sessions.length, 0);
  assert.equal(cleared.office.actors.length, 0);
  assert.equal(projectSessionBoard([]).office.id, 'session-office');
});
test('UI renders one branded scene and compact active title/workspace rows without four-row truncation', () => {
  const html = renderToStaticMarkup(
    React.createElement(OfficeDashboard, {
      version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version,
      board: projectSessionBoard(read()),
      phase: 'ready',
      t: (k) => zh[k],
      onOpenSession: () => {
        throw Error('render cannot navigate');
      },
    }),
  );
  assert.equal((html.match(/class="co-canvas"/g) ?? []).length, 1);
  assert.equal((html.match(/class="co-bubble"/g) ?? []).length, 4);
  assert.equal((html.match(/data-office-session=/g) ?? []).length, 5);
  assert.ok(!html.includes('Full title idle'));
  for (const id of Object.keys(summaries).filter((id) => id !== 'idle')) {
    assert.ok(html.includes('Full title ' + id));
    assert.ok(!html.includes('/repo/' + id));
  }
  assert.ok(html.includes('Workspace one'));
  assert.ok(html.includes('胡闹厨房'));
  assert.ok(html.includes('DSH Office'));
  assert.ok(
    html.includes(
      'v' + JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version,
    ),
  );
  assert.ok(!html.includes('co-scene-caption'));
  assert.ok(html.includes('co-running-icon'));
  assert.ok(html.includes('完成于'));
  assert.ok(!html.includes('<small>a</small>'));
  assert.ok(!html.includes('进入厨房'));
  assert.ok(!html.includes('visibility:hidden'));
  const pending = renderToStaticMarkup(
    React.createElement(OfficeDashboard, {
      version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version,
      board: projectSessionBoard(read()),
      phase: 'loading',
      t: (k) => zh[k],
      onOpenSession: () => {},
    }),
  );
  assert.equal((pending.match(/class="co-bubble"/g) ?? []).length, 0);
  assert.equal((pending.match(/data-office-session=/g) ?? []).length, 0);
});
test('four roaming actors move over time with peer clearance and freeze under reduced motion', () => {
  let states = [0, 1, 2, 3].map(createRoamingMotion);
  const traveled = [0, 0, 0, 0];
  for (let f = 0; f < 10000; f++) {
    for (let i = 0; i < 4; i++) {
      const prev = states[i];
      states[i] = advanceRoamingMotion(
        prev,
        states.filter((_, j) => i !== j),
        1 / 30,
      );
      traveled[i] += Math.hypot(
        states[i].position[0] - prev.position[0],
        states[i].position[1] - prev.position[1],
      );
      for (let j = 0; j < 4; j++)
        if (i !== j)
          assert.ok(
            Math.hypot(
              states[i].position[0] - states[j].position[0],
              states[i].position[1] - states[j].position[1],
            ) >= 0.7499,
          );
    }
  }
  assert.ok(
    traveled.every((n) => n > 1),
    JSON.stringify(traveled),
  );
  for (const state of states) {
    const next = advanceRoamingMotion(state, [], 0.06, true);
    assert.deepEqual(next.position, state.position);
    assert.equal(next.moving, false);
  }
});
test('specified face-blink-r2 immutable asset is adopted exactly', async () => {
  const m = JSON.parse(
    await readFile(new URL('../assets/models/character/deepseek.manifest.json', import.meta.url)),
  );
  assert.equal(m.revision, '2026-10-29-face-blink-r2');
  assert.equal(m.sha256, 'eea3bc03f99ea735948a8e33c108b3ae5eb2bbb860651d4bc217421a604bc003');
  const bytes = await readFile(new URL('../assets/models/character/deepseek.glb', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), m.sha256);
});

test('display clock preserves elapsed across status/title updates, records observed completion and resets next run', () => {
  const running = { ...read(['a'])[0], updatedAt: 1_000 };
  let clocks = activityClocks(new Map(), [running], 10_000);
  assert.equal(clocks.get('a').since, 1_000);
  clocks = activityClocks(clocks, [{ ...running, label: 'renamed', status: 'question' }], 20_000);
  assert.equal(clocks.get('a').since, 1_000);
  clocks = activityClocks(
    clocks,
    [{ ...running, running: false, unread: true, status: 'unread' }],
    30_000,
  );
  assert.equal(clocks.get('a').since, 30_000);
  clocks = activityClocks(
    clocks,
    [{ ...running, running: false, unread: true, status: 'unread' }],
    40_000,
  );
  assert.equal(clocks.get('a').since, 30_000);
  clocks = activityClocks(clocks, [running], 50_000);
  assert.equal(clocks.get('a').since, 50_000);
  clocks = activityClocks(clocks, [{ ...running, updatedAt: 60_000 }], 61_000);
  assert.equal(clocks.get('a').since, 60_000);
  assert.equal(activityClocks(clocks, [], 70_000).size, 0);
});
test('display clock uses native baseline for initially unread rows without inventing missing time', () => {
  const unread = read(['c'])[0];
  assert.equal(activityClocks(new Map(), [unread], 20_000).get('c').since, unread.updatedAt);
  assert.equal(
    activityClocks(new Map(), [{ ...unread, updatedAt: undefined }], 20_000).get('c').since,
    undefined,
  );
  assert.equal(
    activityClocks(new Map(), [{ ...unread, updatedAt: NaN }], 20_000).get('c').since,
    undefined,
  );
});
test('execution duration clamps future times and handles seconds, minutes and hours', () => {
  assert.equal(elapsedTime(undefined, 10_000), undefined);
  assert.equal(elapsedTime(NaN, 10_000), undefined);
  assert.equal(elapsedTime(20_000, 10_000), '0s');
  assert.equal(elapsedTime(1_000, 60_000), '59s');
  assert.equal(elapsedTime(1_000, 62_000), '1m 1s');
  assert.equal(elapsedTime(1_000, 3_661_000), '1h 1m');
});
