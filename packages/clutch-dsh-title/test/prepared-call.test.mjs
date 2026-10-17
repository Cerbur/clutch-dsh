import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import { resolveTitleConfig } from '../lib/config.js';
import { extractLlmFields } from '../lib/extractor.js';
import { createPlainTitleGenerator } from '../lib/plain-title.js';

class Adapter extends LlmAdapter {
  calls = [];
  failMetadata = false;
  output = '{"desc":"Prepared title"}';
  async resolveModel(provider, model, signal) {
    if (this.failMetadata) throw new Error('metadata unavailable');
    return {
      ...(await super.resolveModel(provider, model, signal)),
      reasoning: { efforts: [{ id: 'low', name: 'Low' }] },
    };
  }
  async *stream(options) {
    this.calls.push(options);
    yield { type: 'text-delta', index: 0, text: this.output };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const config = (extra = {}) =>
  resolveTitleConfig({
    template: '${desc}',
    fields: { desc: { kind: 'llm-text', instruction: 'Summarize', maxCharacters: 64 } },
    ...extra,
  });
const messages = [{ seq: 7, text: 'Verify title compatibility' }];
function request(append) {
  return {
    session: { id: 'prepared-title', append },
    messages,
    route: { provider: 'test', model: 'test' },
    signal: new AbortController().signal,
  };
}
const owner = SessionTitleProviderId('clutch-dsh-title');

test('request logging and dispatch retain one adapter generation across replacement', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    const first = new Adapter();
    const replacement = new Adapter();
    const release = ctx.llm.registerAdapter(['test'], first);
    const events = [];
    const input = request((type, data) => {
      events.push({ type, data });
      release();
      ctx.llm.registerAdapter(['test'], replacement);
    });
    const result = await extractLlmFields(ctx, config(), input, messages, owner);
    assert.equal(result.values.desc, 'Prepared title');
    assert.equal(first.calls.length, 1);
    assert.equal(replacement.calls.length, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].data.reasoningEffort, 'low');
    assert.equal(events[0].data.reasoningEffort, first.calls[0].reasoningEffort);
    assert.deepEqual(events[0].data.messages, first.calls[0].messages);
    assert.equal(events[0].data.maxTokens, first.calls[0].maxTokens);
  } finally {
    await ctx.fiber.dispose();
  }
});

for (const failure of ['unsupported effort', 'metadata failure']) {
  test(`${failure} rejects before recording or dispatching a request`, async () => {
    const ctx = new Context();
    try {
      await ctx.plugin(LlmRuntime);
      const adapter = new Adapter();
      adapter.failMetadata = failure === 'metadata failure';
      ctx.llm.registerAdapter(['test'], adapter);
      const events = [];
      const input = request((type, data) => events.push({ type, data }));
      await assert.rejects(
        extractLlmFields(
          ctx,
          config({
            ...(adapter.failMetadata ? {} : { reasoningEffort: 'unsupported' }),
          }),
          input,
          messages,
          owner,
        ),
        /metadata unavailable|reasoning effort/,
      );
      assert.deepEqual(events, []);
      assert.equal(adapter.calls.length, 0);
    } finally {
      await ctx.fiber.dispose();
    }
  });
}

test('plain titles use the shared executor, first prompt and actual registered provider attribution', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    const adapter = new Adapter();
    adapter.output = '\n**Plain title**\nExtra explanation';
    ctx.llm.registerAdapter(['test'], adapter);
    const events = [];
    const input = request((type, data) => events.push({ type, data }));
    input.messages = [...messages, { seq: 9, text: 'Do not include this later message' }];
    const result = await createPlainTitleGenerator(ctx, config())(input);
    assert.equal(result.title, 'Plain title');
    assert.deepEqual(result.messageSeqs, [7]);
    assert.equal(adapter.calls[0].maxTokens, 64);
    assert.doesNotMatch(adapter.calls[0].messages[0].content[0].text, /later message/);
    assert.equal(events[0].data.titleProvider, owner);
    assert.equal(events[0].data.reasoningEffort, 'low');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('repair requests retain the single native user message required by persisted Session V4', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    const adapter = new Adapter();
    const original = adapter.stream.bind(adapter);
    let attempt = 0;
    adapter.stream = async function* (options) {
      adapter.output = attempt++ === 0 ? 'invalid JSON' : '{"desc":"Recovered title"}';
      yield* original(options);
    };
    ctx.llm.registerAdapter(['test'], adapter);
    const events = [];
    const input = request((type, data) => events.push({ type, data }));
    assert.equal(
      (await extractLlmFields(ctx, config(), input, messages, owner)).values.desc,
      'Recovered title',
    );
    assert.equal(events.length, 2);
    for (const [index, event] of events.entries()) {
      assert.equal(event.data.messages.length, 1);
      assert.equal(event.data.messages[0].role, 'user');
      assert.equal(event.data.messages[0].source.kind, 'dsh-session-title-llm');
      assert.deepEqual(event.data.messageSeqs, [7]);
      assert.deepEqual(event.data.messages, adapter.calls[index].messages);
      assert.equal(event.data.system, adapter.calls[index].system);
    }
    assert.deepEqual(adapter.calls[0].messages, adapter.calls[1].messages);
    assert.match(adapter.calls[1].system, /invalid JSON/);
  } finally {
    await ctx.fiber.dispose();
  }
});
