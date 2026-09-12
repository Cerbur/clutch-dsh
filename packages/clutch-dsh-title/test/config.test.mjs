import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';

const { resolveTitleConfig } = await import('../lib/config.js');

test('leaves reasoning effort undefined by default and accepts adapter IDs or explicit null', () => {
  assert.equal(resolveTitleConfig({}).reasoningEffort, undefined);
  for (const reasoningEffort of ['off', 'low', 'vendor-specific', null]) {
    assert.equal(resolveTitleConfig({ reasoningEffort }).reasoningEffort, reasoningEffort);
  }
  for (const reasoningEffort of ['', '  ', false, 0, {}, []]) {
    assert.throws(() => resolveTitleConfig({ reasoningEffort }), /reasoningEffort/);
  }
});

test('supports described enum choices alongside string shorthand', () => {
  const values = [{ value: ' 前端 ', description: ' 修改页面和交互时使用 ' }, '后端'];
  const resolved = resolveTitleConfig({
    fields: { type: { kind: 'llm-enum', instruction: '分类', values } },
  });
  assert.deepEqual(resolved.fields.type.values, [
    { value: '前端', description: '修改页面和交互时使用' },
    '后端',
  ]);
  assert.ok(Object.isFrozen(resolved.fields.type.values[0]));
});

test('rejects malformed descriptions and duplicate enum values across both forms', () => {
  for (const values of [
    [{ value: '前端' }],
    [{ value: '前端', description: ' ' }],
    [{ value: '前端', description: 1 }],
    [{ value: ' ', description: '页面' }],
    [{ value: '前端', description: '页面', typo: true }],
    ['前端', { value: ' 前端 ', description: '页面' }],
    [
      { value: '前端', description: '页面' },
      { value: '前端', description: '交互' },
    ],
  ]) {
    assert.throws(() =>
      resolveTitleConfig({ fields: { type: { kind: 'llm-enum', instruction: '分类', values } } }),
    );
  }
});

test('resolves the default preset', () => {
  const resolved = resolveTitleConfig({});

  assert.equal(resolved.preset, 'default');
  assert.equal(resolved.template, '${daytime}|${type}|${desc}');
  assert.deepEqual(resolved.fields.type, {
    kind: 'llm-enum',
    instruction: '判断这个 session 的任务类型',
    values: [
      { value: '设计', description: '明确需求、制定实现方案，或设计架构、接口和交互时使用' },
      {
        value: '探索',
        description: '理解代码、调研技术、分析问题或验证可行性，主要目标是获得结论时使用',
      },
      { value: '功能', description: '新增此前不存在的能力，或扩展现有功能的使用场景时使用' },
      { value: '修复', description: '纠正缺陷、排查并解决故障，或恢复预期行为时使用' },
      {
        value: '优化',
        description: '在保持现有功能含义的基础上，改善性能、体验、结构或可维护性时使用',
      },
      { value: '发布', description: '准备版本、编写发布说明、打包、部署或执行上线流程时使用' },
    ],
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
