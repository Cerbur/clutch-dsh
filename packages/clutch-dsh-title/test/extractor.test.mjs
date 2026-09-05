import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';

const { extractLlmFields } = await import('../lib/extractor.js');
const { resolveTitleConfig } = await import('../lib/config.js');

const titleProvider = SessionTitleProviderId('clutch-dsh-title');
const route = { provider: 'main-route', model: 'main-model' };
const selectedMessages = [{ seq: 7, text: '请优化 session title 生成规则' }];

function makeConfig(overrides = {}) {
  return resolveTitleConfig({
    template: '${type}|${desc}',
    fields: {
      type: {
        kind: 'llm-enum',
        instruction: '判断这个 session 的任务类型',
        values: ['前端', '后端', '配置', '文档'],
      },
      desc: {
        kind: 'llm-text',
        instruction: '总结首次 prompt，保留具体任务含义',
        maxCharacters: 32,
      },
    },
    ...overrides,
  });
}

function makeRequest(options = {}) {
  const signal = options.signal ?? new globalThis.AbortController().signal;
  const requestRoute = Object.prototype.hasOwnProperty.call(options, 'requestRoute')
    ? options.requestRoute
    : route;
  const events = [];
  const request = {
    session: {
      id: 'title-session',
      append(type, data) {
        events.push({ kind: 'append', type, data });
      },
    },
    messages: selectedMessages,
    route: requestRoute,
    signal,
  };
  return { request, events };
}

function textChunks(text, reason = { kind: 'stop' }) {
  return [
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason },
  ];
}

async function runExtraction({
  chunks,
  config = makeConfig(),
  requestOptions = {},
  streamBody,
} = {}) {
  const { request, events } = makeRequest(requestOptions);
  const requests = [];
  const ctx = {
    llm: {
      async *stream(options) {
        requests.push(options);
        events.push({ kind: 'stream' });
        if (streamBody !== undefined) {
          yield* streamBody(options);
          return;
        }
        for (const chunk of chunks ??
          textChunks('{"type":"配置","desc":"优化 session title 生成规则"}')) {
          yield chunk;
        }
      },
    },
  };
  const result = await extractLlmFields(ctx, config, request, selectedMessages, titleProvider);
  return { result, request, events, requests };
}

test('builds one structured JSON request and records the native request event first', async () => {
  const { result, request, events, requests } = await runExtraction({});
  const options = requests[0];

  assert.deepEqual(result, {
    values: { type: '配置', desc: '优化 session title 生成规则' },
    model: route,
  });
  assert.equal(requests.length, 1);
  assert.equal(options.provider, 'main-route');
  assert.equal(options.model, 'main-model');
  assert.equal(options.sessionId, 'title-session');
  assert.equal(options.purpose, 'session-title');
  assert.equal(options.maxTokens, 512);
  assert.notEqual(options.signal, request.signal);
  assert.equal(options.messages.length, 1);
  assert.equal(options.messages[0].role, 'user');
  assert.deepEqual(options.messages[0].source, { kind: 'plugin', plugin: 'clutch-dsh-title' });
  assert.match(options.messages[0].content[0].text, /JSON array/);
  assert.match(options.messages[0].content[0].text, /请优化 session title 生成规则/);
  assert.match(options.system, /JSON object/i);
  assert.match(options.system, /Markdown/i);
  assert.match(options.system, /human messages.*data/i);
  assert.match(options.system, /判断这个 session 的任务类型/);
  assert.match(options.system, /总结首次 prompt，保留具体任务含义/);
  assert.match(options.system, /前端.*后端.*配置.*文档/s);
  assert.doesNotMatch(options.system, /daytime|session\.createdAt|Asia\/Shanghai|MMDD/);

  assert.equal(events[0].kind, 'append');
  assert.equal(events[0].type, 'session/title-llm-request');
  assert.equal(events[1].kind, 'stream');
  assert.deepEqual(events[0].data, {
    titleProvider,
    messageSeqs: [7],
    route: options.provider === route.provider && options.model === route.model ? route : undefined,
    system: options.system,
    messages: options.messages,
    maxTokens: options.maxTokens,
  });
  assert.notEqual(options.messages, request.messages);
  assert.ok(Object.isFrozen(result.values));
});

test('uses an explicit provider/model pair when configured', async () => {
  const { result, requests } = await runExtraction({
    config: makeConfig({ provider: 'title-route', model: 'title-model' }),
  });

  assert.deepEqual(result.model, { provider: 'title-route', model: 'title-model' });
  assert.equal(requests[0].provider, 'title-route');
  assert.equal(requests[0].model, 'title-model');
});

test('rejects malformed structured output and never returns a partial field map', async () => {
  const invalidOutputs = [
    '{not-json}',
    '```json\n{"type":"配置","desc":"优化"}\n```',
    '{"type":"配置"}',
    '{"type":"配置","desc":"优化","extra":"unexpected"}',
    '{"type":"移动端","desc":"优化"}',
    JSON.stringify({ type: '配置', desc: '一'.repeat(40) }),
    '[]',
  ];

  for (const output of invalidOutputs) {
    await assert.rejects(
      runExtraction({ chunks: textChunks(output) }),
      /JSON|field|enum|character|object|declared|missing|exactly/i,
      output,
    );
  }
});

test('rejects empty output, tool calls, and every non-success finish reason', async () => {
  await assert.rejects(runExtraction({ chunks: textChunks('') }), /empty|text|JSON|field/i);
  await assert.rejects(
    runExtraction({
      chunks: [
        { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'shell', argumentsDelta: '{}' },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    }),
    /tool|text|JSON/i,
  );

  const failures = [
    { kind: 'max-tokens' },
    { kind: 'tool-calls' },
    { kind: 'error', failure: { code: 'UPSTREAM_ERROR', message: 'upstream failed' } },
    { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } },
    { kind: 'unknown-finish' },
  ];
  for (const reason of failures) {
    await assert.rejects(
      runExtraction({ chunks: [{ type: 'finish', reason }] }),
      /finish|token|tool|error|cancel|abort|unsupported|JSON/i,
      reason.kind,
    );
  }
});

test('rejects input over the byte budget and abort before dispatch', async () => {
  const tooSmall = makeConfig({ maxInputBytes: 1 });
  const tooSmallRun = makeRequest();
  const requests = [];
  const ctx = {
    llm: {
      stream() {
        return [];
      },
    },
  };
  await assert.rejects(
    extractLlmFields(ctx, tooSmall, tooSmallRun.request, selectedMessages, titleProvider),
    /bytes|maxInputBytes/i,
  );
  assert.equal(requests.length, 0);
  assert.equal(tooSmallRun.events.length, 0);

  const controller = new globalThis.AbortController();
  controller.abort();
  const abortedRun = makeRequest({ signal: controller.signal });
  await assert.rejects(
    extractLlmFields(ctx, makeConfig(), abortedRun.request, selectedMessages, titleProvider),
    /abort/i,
  );
  assert.equal(abortedRun.events.length, 0);
});

test('honors abort during streaming and translates deadline timeout', async () => {
  const controller = new globalThis.AbortController();
  const { request, events } = makeRequest({ signal: controller.signal });
  let streamCalls = 0;
  const ctx = {
    llm: {
      async *stream() {
        streamCalls += 1;
        controller.abort();
        yield { type: 'text-delta', index: 0, text: '{"type":"配置"' };
      },
    },
  };
  await assert.rejects(
    extractLlmFields(ctx, makeConfig(), request, selectedMessages, titleProvider),
    /abort/i,
  );
  assert.equal(streamCalls, 1);
  assert.equal(events[0].type, 'session/title-llm-request');

  const timeoutRun = makeRequest();
  const timeoutCtx = {
    llm: {
      async *stream() {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
        yield* textChunks('{"type":"配置","desc":"优化"}');
      },
    },
  };
  await assert.rejects(
    extractLlmFields(
      timeoutCtx,
      makeConfig({ timeoutMs: 1 }),
      timeoutRun.request,
      selectedMessages,
      titleProvider,
    ),
    (error) =>
      error?.code === 'SESSION_TITLE_TIMEOUT' ||
      /SESSION_TITLE_TIMEOUT|timeout/i.test(error?.message ?? ''),
  );
});

test('requires one selected message and a route when no explicit override is present', async () => {
  const { request } = makeRequest({ requestRoute: undefined });
  const ctx = { llm: { async *stream() {} } };
  await assert.rejects(extractLlmFields(ctx, makeConfig(), request, [], titleProvider), /message/i);
  await assert.rejects(
    extractLlmFields(ctx, makeConfig(), request, selectedMessages, titleProvider),
    /route|provider|model/i,
  );
});
