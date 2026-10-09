import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  assertSupportedJsonSchema,
  jsonSchemaToTs,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools';
import { toolParameters } from '../lib/tool/schema.js';

test('SDK projection preserves exclusive targets and explains runtime string limits', () => {
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
