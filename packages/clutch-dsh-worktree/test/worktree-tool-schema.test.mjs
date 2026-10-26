import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  assertSupportedJsonSchema,
  jsonSchemaToTs,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools';
import { toolParameters } from '../lib/tool/schema.js';

test('compact length descriptions retain UTF-16 bounds and executable validation', () => {
  const value = z.string().min(1).max(200).describe('Exact identifier supplied by the caller.');
  const schema = z.object({ value }).strict();
  const parameters = toolParameters(schema);
  assert.equal(parameters.properties.value.description,
    'Exact identifier supplied by the caller. Nonempty. Maximum length: 200 UTF-16 units.');
  assertSupportedJsonSchema(parameters);
  assert.match(jsonSchemaToTs(parameters), /Maximum length: 200 UTF-16 units/);
  assert.equal(schema.safeParse({ value: '' }).success, false);
  assert.equal(schema.safeParse({ value: '😀'.repeat(100) }).success, true);
  assert.equal(schema.safeParse({ value: '😀'.repeat(101) }).success, false);
  assert.equal(schema.safeParse({ value: 'x'.repeat(201) }).success, false);
  const minimum = toolParameters(z.object({ value: z.string().min(2) }).strict());
  assert.match(minimum.properties.value.description, /Minimum length: 2 UTF-16 units/);
});

test('low-level legacy SDK projection preserves exclusive targets and runtime string limits', () => {
  const schema = z.union([
    z.object({ worktreeId: z.string().min(1), prompt: z.string().max(200) }).strict(),
    z.object({ name: z.string().min(1), prompt: z.string().max(200) }).strict(),
  ]);
  const parameters = toolParameters(schema);
  assertSupportedJsonSchema(parameters);
  assert.doesNotMatch(jsonSchemaToTs(parameters), /unknown/);
  assert.match(jsonSchemaToTs(parameters), /Maximum length: 200/);
  for (const args of [
    { worktreeId: 'wt', prompt: 'Task' },
    { name: 'branch', prompt: 'Task' },
  ]) {
    assert.deepEqual(validateJsonSchemaValue(parameters, args), []);
    assert.equal(schema.safeParse(args).success, true);
  }
  for (const args of [{ prompt: 'Task' }, { worktreeId: 'wt', name: 'branch', prompt: 'Task' }]) {
    assert.notEqual(validateJsonSchemaValue(parameters, args).length, 0);
    assert.equal(schema.safeParse(args).success, false);
  }
  assert.equal(schema.safeParse({ worktreeId: '', prompt: 'Task' }).success, false);
  assert.equal(schema.safeParse({ worktreeId: 'wt', prompt: 'x'.repeat(201) }).success, false);
});

test('overlapping alternatives cannot silently change anyOf into oneOf', () => {
  const overlapping = z.union([
    z.object({ name: z.string() }).strict(),
    z.object({ name: z.string(), extra: z.string().optional() }).strict(),
  ]);
  assert.equal(overlapping.safeParse({ name: 'demo' }).success, true);
  assert.throws(() => toolParameters(overlapping), /disjoint closed object/);
});

test('unsupported future schema constructs fail explicitly instead of generating unknown', () => {
  assert.throws(
    () => toolParameters(z.object({ name: z.string().regex(/^feature\//) }).strict()),
    /keyword: pattern/,
  );
  assert.throws(
    () => toolParameters(z.object({}).catchall(z.string())),
    /additionalProperties must be a boolean/,
  );
});
