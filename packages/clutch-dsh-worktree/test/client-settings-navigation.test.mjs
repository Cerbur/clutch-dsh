import assert from 'node:assert/strict';
import test from 'node:test';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { openWorktreeErrorSettings } from '../lib/client/settings/settings-navigation.js';

test('opens the native Settings shared viewing store through the public slot ledger', () => {
  const slots = new SlotCore();
  const dispose = slots.register({
    name: 'root', children: { 'sidebar.settings': { kind: 'single', scope: 'root' } },
  }, () => null);
  const handle = defineStore({
    init: () => ({ open: false, activeId: undefined }),
    actions: { openSection(draft, id) { draft.open = true; draft.activeId = id; } },
  });
  const instance = handle.create();
  slots.register({
    name: 'sidebar.settings', store: { ...handle, create: () => instance },
  }, () => null);
  assert.equal(openWorktreeErrorSettings(slots), true);
  assert.deepEqual(instance.getSnapshot(), { open: true, activeId: 'clutch-dsh-worktree' });
  dispose();
  assert.equal(openWorktreeErrorSettings(slots), false);
});

test('a missing or incompatible Settings store preserves manual navigation fallback', () => {
  for (const entries of [[], [{}], [{ store: {} }], [{ store: { create: () => ({}) } }]]) {
    assert.equal(openWorktreeErrorSettings({ entriesOfSlot: () => entries }), false);
  }
});
