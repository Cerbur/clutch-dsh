import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { URL, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import * as yaml from 'js-yaml';
import Include, { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionTitleService from '@deepseek-ai/dsh-session-title';
import * as titlePlugin from '../lib/index.js';

const patchPath = new URL('../cordis.patch.yml', import.meta.url);
const temporaryRoots = [];
const contexts = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test('folds the real package patch into the DSH session-title entry list', async () => {
  const patchText = await readFile(patchPath, 'utf8');
  const patch = yaml.load(patchText, { schema: entryListSchema });
  const base = [
    {
      id: 'session-title-llm',
      name: '@deepseek-ai/dsh-session-title-first-prompt-llm',
      config: { targetWords: 5 },
    },
  ];

  const warnings = [];
  const composed = applyEntryPatches(base, patch, (...args) => warnings.push(args));

  assert.deepEqual(warnings, []);
  assert.equal(composed.find((entry) => entry.id === 'session-title-llm').disabled, true);
  assert.deepEqual(
    composed.find((entry) => entry.id === 'clutch-dsh-title'),
    {
      id: 'clutch-dsh-title',
      name: '@cerbur/clutch-dsh-title',
      config: { preset: 'default' },
    },
  );
});

test('does not disable a same-id entry whose package name changed', async () => {
  const patchText = await readFile(patchPath, 'utf8');
  const patch = yaml.load(patchText, { schema: entryListSchema });
  const warnings = [];
  const composed = applyEntryPatches(
    [
      {
        id: 'session-title-llm',
        name: '@deepseek-ai/dsh-session-title-first-prompt-llm-next',
      },
    ],
    patch,
    (...args) => warnings.push(args),
  );

  assert.equal(composed.find((entry) => entry.id === 'session-title-llm').disabled, undefined);
  assert.ok(warnings.some((args) => args.join(' ').includes('name mismatch')));
});

class LoaderAdapter extends LlmAdapter {
  requests = [];

  async *stream(options) {
    this.requests.push(options);
    yield { type: 'text-delta', index: 0, text: '{"type":"配置","desc":"Loader title"}' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function loadComposition({ includeDefaultProvider = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clutch-dsh-title-loader-'));
  temporaryRoots.push(root);
  const configPath = join(root, 'cordis.yml');
  const defaultProvider = includeDefaultProvider
    ? [
        "- name: '@deepseek-ai/dsh-session-title-first-prompt-llm'",
        '  config:',
        '    targetWords: 5',
        '    targetCjkCharacters: 10',
        '    maxInputBytes: 1000',
        '    maxOutputTokens: 32',
        '    timeoutMs: 1000',
        "    provider: 'title-route'",
        "    model: 'title-model'",
      ]
    : [];
  await writeFile(
    configPath,
    [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-session-title'",
      '  config:',
      '    fallbackMaxWords: 5',
      '    fallbackMaxBytes: 80',
      '    maxTitleBytes: 120',
      ...defaultProvider,
      "- name: '@cerbur/clutch-dsh-title'",
      '  config:',
      '    preset: default',
      '',
    ].join('\n'),
  );

  const ctx = new Context();
  contexts.push(ctx);
  ctx.baseUrl = `${pathToFileURL(root).href}/`;
  await ctx.plugin(Loader);
  ctx.loader.builtins.include = Include;
  const modules = new Map([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-session-title', SessionTitleService],
    [
      '@deepseek-ai/dsh-session-title-first-prompt-llm',
      await import('@deepseek-ai/dsh-session-title-first-prompt-llm'),
    ],
    ['@cerbur/clutch-dsh-title', titlePlugin],
  ]);
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`);
      return modules.get(specifier);
    },
  };
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  });
  await ctx.loader.await();
  return ctx;
}

test('loads the custom provider through the real DSH Loader composition path', async () => {
  const ctx = await loadComposition();
  const unloaded = [...ctx.loader.entries()]
    .filter((entry) => entry.fiber === undefined && !entry.disabled)
    .map((entry) => entry.options.name);
  assert.deepEqual(unloaded, []);

  const adapter = new LoaderAdapter();
  ctx.llm.registerAdapter(['title-route'], adapter);
  const session = ctx.sessions.create(SessionId('loader-title'), {
    meta: { createdAt: Date.UTC(2026, 8, 3, 16, 0) },
  });
  session.append('turn/start', { turn: 1 });
  const message = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'Loader composition prompt' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  );
  await delay(0);
  session.append('request/header', {
    header: { config: { provider: 'title-route', model: 'title-model' } },
    reason: 'initial',
  });
  await delay(0);

  assert.equal(adapter.requests.length, 1);
  const title = ctx.sessionTitle.get(session);
  assert.deepEqual(title, {
    title: '0904|配置|Loader title',
    messageSeqs: [message.seq],
    source: {
      kind: 'provider',
      provider: 'clutch-dsh-title',
      model: { provider: 'title-route', model: 'title-model' },
    },
    eventSeq: title.eventSeq,
    updatedAt: title.updatedAt,
  });
  assert.equal(typeof title.eventSeq, 'number');
});

test('keeps the native single-provider invariant when the old provider is also enabled', async () => {
  await assert.rejects(
    loadComposition({ includeDefaultProvider: true }),
    /provider|registered|one/i,
  );
});
