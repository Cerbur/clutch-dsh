import assert from 'node:assert/strict';
import test from 'node:test';
import { permissionHost, permissionProvider } from './helpers/permission-host.mjs';

function retire(provider) {
  for (const name of ['current', 'resolve', 'set']) {
    provider.service[name] = () => assert.fail('must not call retired provider ' + name);
  }
  Object.defineProperty(provider.service, 'names', {
    get() {
      return assert.fail('must not read retired catalog');
    },
  });
}

for (const order of ['provider-first', 'host-first']) {
  test('Host composition shows Full Access confirmation with ' + order, async () => {
    const provider = permissionProvider();
    const h = await permissionHost({ provider: order === 'provider-first' ? provider : undefined });
    try {
      if (order === 'host-first') await h.mount('permissionPresets', provider.service);
      assert.equal(h.ctx.get('permissionPresets'), provider.service);
      assert.equal(h.mounts, 1);
      const { pending } = await h.startFlow();
      try {
        assert.equal(
          h.controller.getSnapshot()?.sessionId,
          h.request.sessionId,
          'live provider must expose confirmation dialog state',
        );
        assert.deepEqual(provider.calls, [], 'Full Access must not be applied before confirmation');
        assert.deepEqual(h.log, []);
      } finally {
        h.controller.resolve(true);
        await pending;
      }
      assert.equal(h.results.at(-1).status, 'full-applied');
      assert.deepEqual(provider.calls, ['worktree-full-access']);
    } finally {
      await h.dispose();
    }
  });
}

test('missing capability requests recover on retry without remounting Host', async () => {
  const h = await permissionHost();
  const provider = permissionProvider();
  try {
    await h.flow();
    assert.deepEqual(h.results.at(-1), {
      status: 'unverified',
      sandboxMode: 'workspace-write',
      retryable: true,
    });
    assert.equal(h.controller.getSnapshot(), undefined);
    assert.deepEqual(h.log, []);
    await h.mount('permissionPresets', provider.service);
    const { pending } = await h.startFlow();
    try {
      assert.equal(h.controller.getSnapshot()?.sessionId, h.request.sessionId);
      assert.deepEqual(provider.calls, []);
    } finally {
      h.controller.resolve(true);
      await pending;
    }
    assert.equal(h.results.at(-1).status, 'full-applied');
    assert.equal(h.mounts, 1);
  } finally {
    await h.dispose();
  }
});

test('revocation between dialog and confirmation fails closed, then retry uses replacement', async () => {
  const old = permissionProvider();
  const h = await permissionHost({ provider: old });
  try {
    const { pending } = await h.startFlow();
    assert.ok(h.controller.getSnapshot());
    await h.providerFiber.dispose();
    retire(old);
    h.controller.resolve(true);
    await pending;
    assert.equal(h.results.at(-1).status, 'unverified');
    assert.equal(h.results.at(-1).retryable, true);
    assert.deepEqual(old.calls, []);
    assert.deepEqual(h.log, []);
    const replacement = permissionProvider();
    await h.mount('permissionPresets', replacement.service);
    assert.equal((await h.ensure()).status, 'confirmation-required');
    assert.deepEqual(replacement.calls, []);
    assert.equal((await h.ensure({ ...h.request, confirmed: true })).status, 'full-applied');
    assert.deepEqual(replacement.calls, ['worktree-full-access']);
    assert.equal(h.mounts, 1);
  } finally {
    await h.dispose();
  }
});

test('replacement while confirmation is open uses only the current provider', async () => {
  const old = permissionProvider();
  const h = await permissionHost({ provider: old });
  try {
    const { pending } = await h.startFlow();
    assert.ok(h.controller.getSnapshot());
    await h.providerFiber.dispose();
    retire(old);
    const replacement = permissionProvider();
    await h.mount('permissionPresets', replacement.service);
    h.controller.resolve(true);
    await pending;
    assert.equal(h.results.at(-1).status, 'full-applied');
    assert.deepEqual(old.calls, []);
    assert.deepEqual(replacement.calls, ['worktree-full-access']);
    assert.equal(h.mounts, 1);
  } finally {
    await h.dispose();
  }
});

test('replacement and remounting preserve explicit restriction and runtime ownership', async () => {
  const old = permissionProvider();
  const h = await permissionHost({ provider: old });
  try {
    assert.equal((await h.ensure({ ...h.request, confirmed: true })).status, 'full-applied');
    // Native user action after the plugin applied Full Access.
    h.session.append('permission/preset', { preset: 'workspace-write' });
    h.session.append('sandbox/mode', { mode: 'workspace-write' });
    await h.providerFiber.dispose();
    retire(old);
    assert.equal((await h.ensure()).status, 'user-restricted');
    for (let i = 0; i < 3; i++) {
      const replacement = permissionProvider();
      const fiber = await h.mount('permissionPresets', replacement.service);
      await h.flow();
      assert.equal(h.results.at(-1).status, 'user-restricted');
      assert.equal(h.controller.getSnapshot(), undefined);
      assert.deepEqual(replacement.calls, []);
      await fiber.dispose();
      retire(replacement);
    }
    assert.equal(h.mounts, 1);
  } finally {
    await h.dispose();
  }
});

test('canceling confirmation never applies Full Access', async () => {
  const provider = permissionProvider();
  const h = await permissionHost({ provider });
  try {
    const { pending } = await h.startFlow();
    const rejected = assert.rejects(pending, { name: 'WorktreeSessionPermissionError' });
    assert.ok(h.controller.getSnapshot());
    h.controller.resolve(false);
    await rejected;
    assert.deepEqual(provider.calls, []);
    assert.deepEqual(h.log, []);
  } finally {
    await h.dispose();
  }
});

test('a native read-only restriction survives initial mount and provider replacement', async () => {
  const provider = permissionProvider();
  const events = [
    { type: 'permission/preset', data: { preset: 'read-only' } },
    { type: 'sandbox/mode', data: { mode: 'read-only' } },
  ];
  const h = await permissionHost({ provider, events });
  try {
    assert.equal((await h.ensure()).status, 'user-restricted');
    await h.providerFiber.dispose();
    retire(provider);
    const replacement = permissionProvider();
    await h.mount('permissionPresets', replacement.service);
    await h.flow();
    assert.equal(h.results.at(-1).status, 'user-restricted');
    assert.equal(h.controller.getSnapshot(), undefined);
    assert.deepEqual(replacement.calls, []);
    assert.deepEqual(h.log, events);
  } finally {
    await h.dispose();
  }
});

test('unknown provider shape fails closed and recovery uses the new catalog', async () => {
  const h = await permissionHost();
  try {
    const invalid = await h.mount('permissionPresets', {});
    assert.equal((await h.ensure({ ...h.request, confirmed: true })).status, 'unverified');
    assert.deepEqual(h.log, []);
    await invalid.dispose();
    const fallback = permissionProvider({ names: ['workspace-write'] });
    const fiber = await h.mount('permissionPresets', fallback.service);
    await h.flow();
    assert.equal(h.controller.getSnapshot(), undefined);
    assert.equal(h.results.at(-1).status, 'fallback-workspace-write');
    assert.deepEqual(fallback.calls, ['workspace-write']);
    await fiber.dispose();
    retire(fallback);
    const replacement = permissionProvider();
    await h.mount('permissionPresets', replacement.service);
    assert.equal((await h.ensure()).status, 'confirmation-required');
    assert.deepEqual(replacement.calls, []);
  } finally {
    await h.dispose();
  }
});

test('sandboxPolicy late mount, replacement and revocation project only the live default', async () => {
  const h = await permissionHost({ sandboxPolicy: null });
  try {
    assert.deepEqual(await h.ensure(), { status: 'unverified', retryable: true });
    const old = { defaultMode: 'workspace-write' };
    const fiber = await h.mount('sandboxPolicy', old);
    assert.equal((await h.ensure()).sandboxMode, 'workspace-write');
    await fiber.dispose();
    Object.defineProperty(old, 'defaultMode', {
      get() {
        return assert.fail('must not read retired sandboxPolicy');
      },
    });
    const replacement = { defaultMode: 'read-only' };
    const next = await h.mount('sandboxPolicy', replacement);
    assert.deepEqual(await h.ensure(), {
      status: 'unverified',
      sandboxMode: 'read-only',
      retryable: true,
    });
    await next.dispose();
    assert.deepEqual(await h.ensure(), { status: 'unverified', retryable: true });
    assert.deepEqual(h.log, []);
    assert.equal(h.mounts, 1);
  } finally {
    await h.dispose();
  }
});

test('detached normalization uses replacement, never the revoked provider', async () => {
  const old = permissionProvider();
  const h = await permissionHost({ provider: old });
  try {
    await h.ensure({ ...h.request, confirmed: true });
    h.worktree.status = 'removed';
    h.worktree.diskCleanup = 'completed';
    h.binding.status = 'detached';
    await h.providerFiber.dispose();
    retire(old);
    assert.equal((await h.normalize()).status, 'unverified');
    const replacement = permissionProvider();
    await h.mount('permissionPresets', replacement.service);
    assert.equal((await h.normalize()).status, 'normalized-workspace-write');
    assert.deepEqual(old.calls, ['worktree-full-access']);
    assert.deepEqual(replacement.calls, ['workspace-write']);
    assert.equal(h.mounts, 1);
  } finally {
    await h.dispose();
  }
});
