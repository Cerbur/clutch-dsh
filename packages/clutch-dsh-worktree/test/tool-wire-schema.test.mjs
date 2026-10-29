import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { toolParameters } from '../lib/tool/schema.js';
import { nullableToolParameters } from '../lib/tool/wire-schema.js';

test('nullable wire projection represents omission and bounds without changing the native catalog', () => {
  const schema = z.object({
    prompt: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    model: z.object({ provider: z.string().min(1), model: z.string().min(1), effort: z.string().min(1).optional() }).strict().optional(),
  }).strict();
  const before = toolParameters(schema);
  const wire = nullableToolParameters(schema);
  assert.deepEqual(wire.required, ['prompt', 'name', 'model']);
  assert.equal(wire.additionalProperties, false);
  assert.equal(wire.properties.prompt.minLength, 1);
  assert.deepEqual(wire.properties.name.anyOf, [{ type: 'string', minLength: 1 }, { type: 'null' }]);
  const model = wire.properties.model.anyOf[0];
  assert.deepEqual(model.required, ['provider', 'model', 'effort']);
  assert.equal(model.additionalProperties, false);
  assert.equal(model.properties.provider.type, 'string', 'required model identity cannot become nullable');
  assert.deepEqual(toolParameters(schema), before);
  assert.deepEqual(before.required, ['prompt']);
  assert.equal(before.properties.name.anyOf, undefined);
});
