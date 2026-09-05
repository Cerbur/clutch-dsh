import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';

const { resolveTitleConfig } = await import('../lib/config.js');

test('resolves the default preset', () => {
  const resolved = resolveTitleConfig({});

  assert.equal(resolved.preset, 'default');
  assert.equal(resolved.template, '${daytime}|${type}|${desc}');
  assert.deepEqual(resolved.fields.type, {
    kind: 'llm-enum',
    instruction: '判断这个 session 的任务类型',
    values: ['前端', '后端', '配置', '文档'],
  });
  assert.deepEqual(resolved.fields.desc, {
    kind: 'llm-text',
    instruction: '总结首次 prompt，保留具体任务含义',
    maxCharacters: 32,
  });
  assert.equal(resolved.fields.daytime.kind, 'datetime');
  assert.equal(resolved.fields.daytime.source, 'session.createdAt');
  assert.equal(resolved.fields.daytime.format, 'MMDD');
  assert.equal(resolved.fields.daytime.timezone, 'Asia/Shanghai');
  assert.equal(resolved.maxInputBytes, 4096);
  assert.equal(resolved.maxOutputTokens, 512);
  assert.equal(resolved.timeoutMs, 60000);
  assert.deepEqual(resolved.compiledTemplate.segments, [
    { kind: 'field', name: 'daytime' },
    { kind: 'literal', text: '|' },
    { kind: 'field', name: 'type' },
    { kind: 'literal', text: '|' },
    { kind: 'field', name: 'desc' },
  ]);
});

test('merges field names while replacing each field definition as a whole', () => {
  const fields = {
    desc: {
      kind: 'llm-text',
      instruction: '用不超过 20 个字总结首次 prompt',
      maxCharacters: 20,
    },
    scope: {
      kind: 'literal',
      value: 'work',
    },
  };

  const resolved = resolveTitleConfig({
    preset: 'default',
    template: '${type}: ${desc}',
    fields,
  });

  assert.equal(resolved.template, '${type}: ${desc}');
  assert.equal(resolved.fields.daytime.kind, 'datetime');
  assert.deepEqual(resolved.fields.scope, { kind: 'literal', value: 'work' });
  assert.equal(resolved.fields.desc.maxCharacters, 20);
  assert.deepEqual(fields, {
    desc: {
      kind: 'llm-text',
      instruction: '用不超过 20 个字总结首次 prompt',
      maxCharacters: 20,
    },
    scope: {
      kind: 'literal',
      value: 'work',
    },
  });
});

test('rejects unknown presets and undeclared template fields', () => {
  assert.throws(() => resolveTitleConfig({ preset: 'compact' }), /preset/i);
  assert.throws(() => resolveTitleConfig({ template: '${missing}' }), /field|declared|template/i);
});

test('rejects invalid field identifiers and prototype keys', () => {
  for (const name of ['bad.name', 'bad name', '${bad}', '__proto__', 'constructor']) {
    assert.throws(
      () =>
        resolveTitleConfig({
          fields: {
            [name]: { kind: 'literal', value: 'x' },
          },
        }),
      /identifier|field|key/i,
    );
  }
});

test('rejects invalid field definitions and unknown keys', () => {
  assert.throws(
    () =>
      resolveTitleConfig({
        fields: {
          day: { kind: 'datetime', source: 'session.updatedAt', format: 'MMDD', timezone: 'UTC' },
        },
      }),
    /source/i,
  );
  assert.throws(() => resolveTitleConfig({ fields: { marker: { kind: 'literal' } } }), /value/i);
  assert.throws(() => resolveTitleConfig({ fields: { kind: { kind: 'unknown' } } }), /kind/i);
  assert.throws(
    () => resolveTitleConfig({ fields: { marker: { kind: 'literal', value: 'x', extra: true } } }),
    /unknown|key/i,
  );
  assert.throws(() => resolveTitleConfig({ extra: true }), /unknown|key/i);
});

test('rejects empty, duplicate, or malformed LLM field constraints', () => {
  assert.throws(
    () =>
      resolveTitleConfig({
        fields: { type: { kind: 'llm-enum', instruction: '分类', values: [] } },
      }),
    /values/i,
  );
  assert.throws(
    () =>
      resolveTitleConfig({
        fields: { type: { kind: 'llm-enum', instruction: '分类', values: ['前端', '前端'] } },
      }),
    /duplicate|values/i,
  );
  assert.throws(
    () =>
      resolveTitleConfig({
        fields: { type: { kind: 'llm-enum', instruction: '分类', values: [''] } },
      }),
    /value|empty/i,
  );
  assert.throws(
    () =>
      resolveTitleConfig({
        fields: { desc: { kind: 'llm-text', instruction: '总结', maxCharacters: 0 } },
      }),
    /maxCharacters/i,
  );
  assert.throws(
    () =>
      resolveTitleConfig({
        fields: { desc: { kind: 'llm-text', instruction: '总结', maxCharacters: 1.5 } },
      }),
    /maxCharacters/i,
  );
});

test('canonicalizes enum values and rejects duplicates after normalization', () => {
  const resolved = resolveTitleConfig({
    fields: {
      type: {
        kind: 'llm-enum',
        instruction: '分类',
        values: [' 配置 ', '前端'],
      },
    },
  });

  assert.deepEqual(resolved.fields.type.values, ['配置', '前端']);
  assert.throws(
    () =>
      resolveTitleConfig({
        fields: {
          type: {
            kind: 'llm-enum',
            instruction: '分类',
            values: ['配置', ' 配置 '],
          },
        },
      }),
    /duplicate|values/i,
  );
});

test('rejects invalid datetime configuration during resolution', () => {
  const base = {
    kind: 'datetime',
    source: 'session.createdAt',
    format: 'MMDD',
    timezone: 'Asia/Shanghai',
  };

  assert.throws(
    () => resolveTitleConfig({ fields: { daytime: { ...base, timezone: 'Mars/Olympus' } } }),
    /timezone/i,
  );
  assert.throws(
    () => resolveTitleConfig({ fields: { daytime: { ...base, format: 'YYYY-DDDD' } } }),
    /format|token/i,
  );
});

test('requires provider and model together and validates request budgets', () => {
  assert.throws(() => resolveTitleConfig({ provider: 'route' }), /provider|model/i);
  assert.throws(() => resolveTitleConfig({ model: 'model' }), /provider|model/i);
  assert.throws(() => resolveTitleConfig({ maxInputBytes: 0 }), /maxInputBytes/i);
  assert.throws(() => resolveTitleConfig({ maxOutputTokens: 0 }), /maxOutputTokens/i);
  assert.throws(() => resolveTitleConfig({ timeoutMs: MAX_TIMER_DELAY_MS + 1 }), /timeout/i);
});
