import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPortableTool, discoverToolDeclarations } from './helpers/tool-contract.mjs';

const declarations = await discoverToolDeclarations();
for (const tool of declarations) test(tool.name + ' satisfies the author/native portability profile', () => assertPortableTool(tool));

const valid = () => ({
  name: 'clutch_contract_fixture',
  description: 'Read a fixture for schema contract tests. Returns the selected fixture without mutation.',
  parameters: { type: 'object', properties: { key: { type: 'string', description: 'Exact fixture key supplied by the test.' } }, required: ['key'], additionalProperties: false },
});
test('profile accepts portable nested arrays and scalar enums', () => {
  const tool = valid();
  tool.parameters.properties.items = { type: 'array', description: 'Ordered fixture records to inspect.', items: { type: 'object', properties: { mode: { type: 'string', enum: ['read', 'write'], description: 'Whether the fixture permits writes.' } }, required: ['mode'], additionalProperties: false } };
  assertPortableTool(tool);
});
for (const [name, invalidate] of [
  ['issue #8 root union', (s) => { s.parameters = { oneOf: [s.parameters, s.parameters] }; }],
  ['nested union', (s) => { s.parameters.properties.key = { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Legacy incompatible scalar union.' }; }],
  ['nested open object', (s) => { s.parameters.properties.key = { type: 'object', properties: {}, additionalProperties: true, description: 'Open arbitrary fixture properties.' }; }],
  ['array nested unsupported keyword', (s) => { s.parameters.properties.key = { type: 'array', description: 'Ordered fixture values to inspect.', items: { type: 'string', pattern: '^a' } }; }],
  ['nullable author union', (s) => { s.parameters.properties.key.type = ['string', 'null']; }],
  ['unknown required key', (s) => { s.parameters.required.push('missing'); }],
  ['tuple', (s) => { s.parameters.properties.key = { type: 'array', description: 'Fixture pair with positional types.', items: [{ type: 'string' }] }; }],
  ['missing field explanation', (s) => { delete s.parameters.properties.key.description; }],
  ['constraint-only explanation', (s) => { s.parameters.properties.key.description = 'Minimum length: 1 characters (checked by the tool).'; }],
  ['compact constraint-only explanation', (s) => { s.parameters.properties.key.description = 'Nonempty. Maximum length: 200 UTF-16 units.'; }],
  ['unfinished description', (s) => { s.description = 'TODO Returns some result later.'; }],
  ['no return contract', (s) => { s.description = 'Inspect a fixture without any further information.'; }],
  ['unportable name', (s) => { s.name = 'clutch.fixture'; }],
  ['scalar root', (s) => { s.parameters = { type: 'string' }; }],
  ['duplicate enum', (s) => { s.parameters.properties.key.enum = ['a', 'a']; }],
  ['schema-valued extra properties', (s) => { s.parameters.additionalProperties = { type: 'string' }; }],
]) test('profile rejects negative tool: ' + name, () => {
  const tool = valid();
  invalidate(tool);
  assert.throws(() => assertPortableTool(tool));
});
