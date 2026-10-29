import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { normalizeOptionalNulls, toolParameters } from '../lib/tool/schema.js';

test('optional normalization is recursive, immutable and leaves required/unknown nulls for rejection', () => {
  const validator = z.object({
    required: z.string(),
    mode: z.enum(['queue', 'steer']).default('queue'),
    rows: z.array(z.object({ id: z.string(), note: z.string().optional() }).strict()).optional(),
  }).strict();
  const schema = toolParameters(validator);
  const input = { required: 'identity', mode: null, rows: [{ id: 'one', note: null }] };
  const snapshot = globalThis.structuredClone(input);
  const normalized = normalizeOptionalNulls(input, schema);
  assert.deepEqual(normalized, { required: 'identity', rows: [{ id: 'one' }] });
  assert.deepEqual(validator.parse(normalized), { required: 'identity', mode: 'queue', rows: [{ id: 'one' }] });
  assert.deepEqual(input, snapshot);
  for (const invalid of [
    { required: null },
    { required: 'identity', unknown: null },
    { required: 'identity', rows: [{ id: null, note: null }] },
    { required: 'identity', rows: [{ id: 'one', unknown: null }] },
    { required: 'identity', rows: {} },
    { required: 'identity', mode: 'interrupt' },
    null, [], 'identity',
    JSON.parse('{"required":"identity","__proto__":null}'),
  ]) assert.throws(() => validator.parse(normalizeOptionalNulls(invalid, schema)), z.ZodError, JSON.stringify(invalid));
  assert.deepEqual(validator.parse(normalizeOptionalNulls({ required: 'identity', rows: null }, schema)), { required: 'identity', mode: 'queue' });
});
