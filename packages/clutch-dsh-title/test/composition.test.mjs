import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionTitleService from '@deepseek-ai/dsh-session-title';

const titlePlugin = await import('../lib/index.js');
const { mergeFieldValues } = titlePlugin;

const TITLE_CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 80,
  maxTitleBytes: 120,
};
const CREATED_AT = Date.UTC(2026, 8, 3, 16, 0);
const contexts = [];

class RecordingAdapter extends LlmAdapter {
  requests = [];
  response = '{"type":"配置","desc":"优化 session title 生成规则"}';
  responseFor = undefined;
  waitFor = undefined;

  async *stream(options) {
    this.requests.push(options);
    await this.waitFor?.(options);
    const response = this.responseFor?.(options) ?? this.response;
    yield { type: 'text-delta', index: 0, text: response };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()));
});

async function settle() {
  await delay(0);
  await delay(0);
}

async function makeContext({
  adapter = new RecordingAdapter(),
  installPlugin = true,
  config = { preset: 'default' },
} = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SessionTitleService, TITLE_CONFIG);
  ctx.llm.registerAdapter(['title-route'], adapter);
  if (installPlugin) await ctx.plugin(titlePlugin, config);
  return { ctx, adapter };
}

function appendSession(ctx, id, prompt, { route = true } = {}) {
  const session = ctx.sessions.create(SessionId(id), { meta: { createdAt: CREATED_AT } });
  session.append('turn/start', { turn: 1 });
  const first = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  );
  if (route) {
    session.append('request/header', {
      header: { config: { provider: 'title-route', model: 'title-model' } },
      reason: 'initial',
    });
  }
  return { session, first };
}

test('apply registers one first-prompt native provider with the stable id', async () => {
  const { ctx } = await makeContext({ installPlugin: false });
  let registered;
  const register = ctx.sessionTitle.register.bind(ctx.sessionTitle);
  ctx.sessionTitle.register = (provider) => {
    registered = provider;
    return register(provider);
  };

  titlePlugin.apply(ctx, { preset: 'default' });

  assert.equal(registered.id, 'clutch-dsh-title');
  assert.equal(registered.automatic, 'first-prompt');
});

test('rejects non-string values from deterministic and extracted fields', () => {
  assert.throws(() => mergeFieldValues({ scope: 1 }, undefined), /scope|string/i);
  assert.throws(() => mergeFieldValues({}, { scope: 1 }), /scope|string/i);
});

test('renders the default title from session.createdAt and the first message', async () => {
  const { ctx, adapter } = await makeContext();
  const { session, first } = appendSession(ctx, 'default-title', '请优化 session title 生成规则');
  await settle();

  const title = ctx.sessionTitle.get(session);
  assert.equal(title?.title, '0904|配置|优化 session title 生成规则');
  assert.deepEqual(title?.messageSeqs, [first.seq]);
  assert.deepEqual(title?.source, {
    kind: 'provider',
    provider: 'clutch-dsh-title',
    model: { provider: 'title-route', model: 'title-model' },
  });
  assert.equal(adapter.requests.length, 1);
  assert.equal(session.header.createdAt, CREATED_AT);
});

test('automatic and explicit refresh use only the first eligible message', async () => {
  const { ctx, adapter } = await makeContext();
  const { session, first } = appendSession(ctx, 'first-only', 'first prompt');
  await settle();

  const second = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'second prompt must be ignored' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  );
  session.append('request/header', {
    header: { config: { provider: 'title-route', model: 'title-model' } },
    reason: 'change',
  });
  await settle();
  assert.equal(adapter.requests.length, 1);

  await ctx.sessionTitle.refresh(session);
  assert.equal(adapter.requests.length, 2);
  for (const request of adapter.requests) {
    const text = request.messages[0].content[0].text;
    assert.match(text, /first prompt/);
    assert.doesNotMatch(text, /second prompt must be ignored/);
  }
  assert.deepEqual(ctx.sessionTitle.get(session)?.messageSeqs, [first.seq]);
  assert.notEqual(first.seq, second.seq);
});

test('falls back through native SessionTitleService when extraction fails', async () => {
  const { ctx, adapter } = await makeContext();
  adapter.response = '{invalid-json}';
  const { session } = appendSession(ctx, 'invalid-json', 'fallback words remain visible');
  await settle();

  assert.equal(ctx.sessionTitle.get(session)?.source.kind, 'fallback');
  await assert.rejects(ctx.sessionTitle.refresh(session), /JSON|structured extraction/i);
  assert.equal(ctx.sessionTitle.get(session)?.source.kind, 'fallback');
  assert.equal(ctx.sessionTitle.get(session)?.title, 'fallback words remain visible');
});

test('keeps native rename pin semantics and uses refresh as the explicit re-derivation', async () => {
  const { ctx, adapter } = await makeContext();
  const { session } = appendSession(ctx, 'rename-pin', 'first prompt');
  await settle();
  ctx.sessionTitle.rename(session, 'Pinned by hand');

  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'later prompt' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  );
  session.append('request/header', {
    header: { config: { provider: 'title-route', model: 'title-model' } },
    reason: 'change',
  });
  await settle();
  assert.equal(adapter.requests.length, 1);
  assert.equal(ctx.sessionTitle.get(session)?.title, 'Pinned by hand');

  await ctx.sessionTitle.refresh(session);
  assert.equal(adapter.requests.length, 2);
  assert.notEqual(ctx.sessionTitle.get(session)?.title, 'Pinned by hand');
  assert.equal(ctx.sessionTitle.get(session)?.source.kind, 'provider');
});

test('keeps createdAt stable across explicit refresh and does not migrate old title events', async () => {
  const { ctx, adapter } = await makeContext();
  const { session } = appendSession(ctx, 'refresh-stability', 'first prompt');
  await settle();
  const original = ctx.sessionTitle.get(session);
  assert.equal(original?.title, '0904|配置|优化 session title 生成规则');

  await ctx.sessionTitle.refresh(session);

  assert.equal(session.header.createdAt, CREATED_AT);
  assert.equal(adapter.requests.length, 2);
  assert.equal(ctx.sessionTitle.get(session)?.title, original?.title);
  const titleEvents = session.snapshotEvents().filter((event) => event.type === 'session/title');
  assert.ok(titleEvents.length >= 2);
  assert.equal(titleEvents.at(-1).data.title, original?.title);
  assert.equal(titleEvents.filter((event) => event.data.source.kind === 'provider').length, 2);
});

test('inherits native title events across forks', async () => {
  const { ctx } = await makeContext();
  const { session: parent } = appendSession(ctx, 'fork-parent', 'first prompt');
  await settle();
  parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  const child = ctx.sessions.fork(parent, undefined, SessionId('fork-child'));

  assert.deepEqual(ctx.sessionTitle.get(child), ctx.sessionTitle.get(parent));
  assert.deepEqual(
    child.snapshotEvents().find((event) => event.type === 'session/title'),
    parent.snapshotEvents().find((event) => event.type === 'session/title'),
  );
});

test('prevents a second registered provider through the native single-provider invariant', async () => {
  const { ctx } = await makeContext();

  assert.throws(
    () =>
      ctx.sessionTitle.register({
        id: 'second-provider',
        automatic: 'first-prompt',
        async generate() {
          return { title: 'unexpected', messageSeqs: [] };
        },
      }),
    /provider|registered|only one|one/i,
  );
});

test('keeps concurrent generations isolated by native session snapshots', async () => {
  const adapter = new RecordingAdapter();
  adapter.responseFor = (options) => {
    const prompt = options.messages[0].content[0].text;
    return prompt.includes('session A')
      ? '{"type":"配置","desc":"A title"}'
      : '{"type":"配置","desc":"B title"}';
  };
  const { ctx } = await makeContext({ adapter });
  const a = appendSession(ctx, 'concurrent-a', 'session A');
  const b = appendSession(ctx, 'concurrent-b', 'session B');
  await settle();
  adapter.waitFor = async (options) => {
    if (options.messages[0].content[0].text.includes('session A')) await delay(15);
  };

  const results = await Promise.all([
    ctx.sessionTitle.refresh(a.session),
    ctx.sessionTitle.refresh(b.session),
  ]);
  assert.deepEqual(results.map((result) => result?.title).sort(), [
    '0904|配置|A title',
    '0904|配置|B title',
  ]);
  assert.equal(adapter.requests.length, 4);
  const bySession = new Map(adapter.requests.map((request) => [request.sessionId, request]));
  assert.match(bySession.get('concurrent-a').messages[0].content[0].text, /session A/);
  assert.match(bySession.get('concurrent-b').messages[0].content[0].text, /session B/);
  assert.equal(ctx.sessionTitle.get(a.session)?.title, '0904|配置|A title');
  assert.equal(ctx.sessionTitle.get(b.session)?.title, '0904|配置|B title');
});
