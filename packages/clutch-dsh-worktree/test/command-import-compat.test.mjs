import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('the Worktree Host loads without the retired commands/brand export', async () => {
  // The pinned RC still exports this path. Reproduce the alpha package boundary.
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      assert.notEqual(specifier, '@deepseek-ai/dsh-commands/brand');
      return nextResolve(specifier, context);
    },
  });
  try {
    const { default: Host } = await import('../lib/index.js');
    assert.equal(typeof Host, 'function');
    const tools = await import('../lib/tool/index.js');
    assert.equal(typeof tools.registerWorktreeTools, 'function');
  } finally {
    hook.deregister();
  }
});
