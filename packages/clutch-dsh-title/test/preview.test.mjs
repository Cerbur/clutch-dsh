import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewTemplate } from '../lib/preview.js';
import { EMOJI_TEMPLATE, validateTemplate } from '../lib/templates.js';

test('emoji sample preserves separators, timezone and described enum value', () => {
  const timestamp = Date.parse('2026-09-05T17:00:00Z');
  assert.equal(
    previewTemplate(EMOJI_TEMPLATE, '设计设置页面', timestamp),
    '0906 | 🎨 | 设计设置页面',
  );
  const config = validateTemplate(EMOJI_TEMPLATE);
  assert.deepEqual(
    config.fields.type.values.map((entry) => entry.value),
    ['🎨', '🔍', '🚀', '🔧', '♻️', '📦'],
  );
  assert.equal(config.fields.desc.maxCharacters, 1024);
});

test('sample renders arbitrary fields, normalizes literals and respects Unicode text limits', () => {
  const source = [
    'template: "${label} / ${summary} / ${category}"',
    'fields:',
    '  label: { kind: literal, value: " hello  world " }',
    '  summary: { kind: llm-text, instruction: summarize, maxCharacters: 2 }',
    '  category: { kind: llm-enum, instruction: choose, values: [one, two] }',
  ].join('\n');
  assert.equal(previewTemplate(source, '🚀abc'), 'hello world / 🚀a / one');
  assert.equal(previewTemplate('template: "${missing}"', 'sample'), null);
  assert.equal(previewTemplate('template: [', 'sample'), null);
  assert.equal(previewTemplate('template: static', 'sample'), 'static');
});
