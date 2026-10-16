import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIREWORKS_LIMITS,
  FIREWORKS_META_KIND,
  createHappyFireworksTool,
  rollSplash,
  splashAnnouncement,
} from '../lib/index.js';
import { applyFireworksProjection } from '../lib/fireworks-projection.js';
import { planShow } from '../lib/client/show-scheduler.js';

/** Deterministic pseudo-random generator for schedule tests. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('plans a guaranteed first launch inside the window', () => {
  const plan = planShow({ windowMs: 3_200, ratePerSec: 1.5, splash: false, random: seeded(7) });
  assert.equal(plan.launchAt[0], 0);
  assert.ok(plan.launchAt.every((t) => t >= 0 && t < plan.windowMs));
  assert.ok(plan.launchAt.every((t, i) => i === 0 || t > plan.launchAt[i - 1]));
  assert.equal(plan.splashAt, undefined);
});

test('caps launches and respects the window edge', () => {
  const plan = planShow({ windowMs: 15_000, ratePerSec: 4, splash: false, random: seeded(11) });
  assert.ok(plan.launchAt.length <= FIREWORKS_LIMITS.maxLaunches);
  assert.ok(plan.launchAt.at(-1) < plan.windowMs);
});

test('attaches the finale launch at the window edge for splash shows', () => {
  const plan = planShow({ windowMs: 4_000, ratePerSec: 1.5, splash: true, random: seeded(3) });
  assert.equal(plan.splashAt, 4_000);
  assert.ok(plan.launchAt.every((t) => t < plan.splashAt));
});

test('clamps hostile window and rate values', () => {
  const low = planShow({ windowMs: 1, ratePerSec: 0, splash: false, random: seeded(1) });
  assert.equal(low.windowMs, FIREWORKS_LIMITS.minDurationMs);
  const high = planShow({ windowMs: 1e9, ratePerSec: 1e9, splash: false, random: seeded(2) });
  assert.equal(high.windowMs, FIREWORKS_LIMITS.maxDurationMs);
  const gaps = high.launchAt.slice(1).map((t, i) => t - high.launchAt[i]);
  assert.ok(gaps.every((g) => g >= 150));
});

test('is deterministic for a fixed random source', () => {
  const once = planShow({ windowMs: 5_000, ratePerSec: 2, splash: true, random: seeded(42) });
  const twice = planShow({ windowMs: 5_000, ratePerSec: 2, splash: true, random: seeded(42) });
  assert.deepEqual(once, twice);
});

test('rolls the splash only for realistic shows within chance', () => {
  assert.equal(rollSplash({ mode: 'emoji', splashChance: 1 }, () => 0), false);
  assert.equal(rollSplash({ mode: 'realistic', splashChance: 0.01 }, () => 0.005), true);
  assert.equal(rollSplash({ mode: 'realistic', splashChance: 0.01 }, () => 0.02), false);
  assert.equal(rollSplash({ mode: 'realistic', splashChance: 0 }, () => 0), false);
});

test('announces the configured splash odds', () => {
  assert.match(splashAnnouncement(0.01), /1%/);
  assert.match(splashAnnouncement(0.025), /2\.5%/);
  assert.match(splashAnnouncement(0.0005), /<0\.1%/);
});

test('executes the tool with the rolled splash flag and matching text', async () => {
  const tool = createHappyFireworksTool(
    () => ({ mode: 'realistic', splashChance: 0.01 }),
    () => 0.001,
  );
  const result = await tool.execute({ message: 'Shipped!' }, { callId: 'call-9' });
  assert.deepEqual(result, { id: 'call-9', message: 'Shipped!', splash: true });
  const rendered = tool.output.render({}, result);
  assert.match(rendered[0].text, /rare splash shell/);
  assert.deepEqual(tool.output.presentationMeta({}, result), {
    kind: FIREWORKS_META_KIND,
    id: 'call-9',
    message: 'Shipped!',
    splash: true,
  });
});

test('keeps ordinary shows splash-free in text and meta', async () => {
  const tool = createHappyFireworksTool(
    () => ({ mode: 'realistic', splashChance: 0.01 }),
    () => 0.9,
  );
  const result = await tool.execute({}, { callId: 'call-10' });
  assert.deepEqual(result, { id: 'call-10' });
  assert.match(tool.output.render({}, result)[0].text, /^Happy fireworks launched!/);
  assert.deepEqual(tool.output.presentationMeta({}, result), {
    kind: FIREWORKS_META_KIND,
    id: 'call-10',
  });
});

function resultEvent(meta) {
  return {
    type: 'tool/result',
    seq: 3,
    time: 1,
    data: {
      message: { source: { kind: 'tool', callId: meta.id } },
      meta,
    },
  };
}

test('reduces the splash flag through the projection', () => {
  const signal = applyFireworksProjection(
    null,
    resultEvent({ kind: FIREWORKS_META_KIND, id: 'call-1', splash: true }),
  );
  assert.deepEqual(signal, { id: 'call-1', splash: true });

  const plain = applyFireworksProjection(
    null,
    resultEvent({ kind: FIREWORKS_META_KIND, id: 'call-2', splash: false }),
  );
  assert.deepEqual(plain, { id: 'call-2' });

  const invalid = applyFireworksProjection(
    null,
    resultEvent({ kind: FIREWORKS_META_KIND, id: 'call-3', splash: 'yes' }),
  );
  assert.equal(invalid, null);
});
