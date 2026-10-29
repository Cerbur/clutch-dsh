import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools';
import { toolParameters } from '../../lib/tool/schema.js';

// The author/native profile, NOT the provider's normalized strict wire schema.
const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'default']);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);
function description(text, identity) {
  assert.equal(typeof text, 'string', identity + ': missing description');
  assert.equal(text, text.trim(), identity + ': untrimmed description');
  assert.ok(text.length > 0, identity + ': empty description');
  assert.doesNotMatch(text, /TODO|TBD|placeholder|lorem ipsum|\$\{/i, identity + ': unfinished description');
  const meaning = text
    .replace(/(?:Minimum|Maximum) length:.*?(?:tool\)\.|UTF-16 units\.|$)/g, '')
    .replace(/\bNonempty\./g, '').trim();
  assert.ok(meaning.split(/\s+/).length >= 3, identity + ': describe meaning, not just a label');
  assert.notEqual(meaning.toLowerCase().replace(/[^a-z]/g, ''), identity.split('.').at(-1).toLowerCase().replace(/[^a-z]/g, ''), identity + ': label is not a description');
}
export function assertPortableTool(tool) {
  assert.match(tool.name, /^clutch_[a-z][a-z0-9_]*$/);
  assert.ok(tool.name.length <= 64, 'portable function name limit');
  description(tool.description, tool.name);
  assert.ok(tool.description.length <= 2400, tool.name + ': keep workflows in scoped guidance');
  assert.match(tool.description, /Returns?\b/, tool.name + ': state the result');
  assert.equal(tool.parameters.type, 'object', tool.name + ': object root required (issue #8)');
  assertSupportedJsonSchema(tool.parameters);
  function visit(schema, location, field = false) {
    assert.ok(schema && typeof schema === 'object' && !Array.isArray(schema), location + ': schema object required');
    for (const key of Object.keys(schema)) assert.ok(keywords.has(key), location + ': nonportable keyword ' + key);
    assert.ok(types.has(schema.type), location + ': explicit single portable type required');
    if (field) description(schema.description, location);
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, location + ': close every object');
      assert.ok(schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties), location + ': property map required');
      const names = Object.keys(schema.properties);
      const required = schema.required ?? [];
      assert.ok(Array.isArray(required), location + ': required array');
      assert.equal(new Set(required).size, required.length, location + ': duplicate required');
      for (const name of required) assert.ok(names.includes(name), location + ': unknown required ' + name);
      const descriptions = Object.values(schema.properties).map((child) => child.description);
      assert.equal(new Set(descriptions).size, descriptions.length, location + ': duplicate sibling descriptions');
      for (const [name, child] of Object.entries(schema.properties)) visit(child, location + '.' + name, true);
    } else if (schema.type === 'array') {
      assert.ok(schema.items && !Array.isArray(schema.items), location + ': homogeneous array items required');
      visit(schema.items, location + '[]');
    }
    if (schema.enum) {
      assert.ok(['string', 'number', 'integer', 'boolean'].includes(schema.type), location + ': scalar enum only');
      assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, location + ': nonempty enum');
      assert.equal(new Set(schema.enum).size, schema.enum.length, location + ': duplicate enum');
    }
  }
  visit(tool.parameters, tool.name);
}

// Discover executable registrars, not a handwritten list of seven schemas.
// index/guidance compose lifecycle/prompt sections rather than tool definitions.
export async function discoverToolDeclarations() {
  const directory = new URL('../../lib/tool/', import.meta.url);
  const declarations = [];
  for (const file of await readdir(directory, { recursive: true })) {
    if (!file.endsWith('.js') || ['index.js', 'guidance.js'].includes(file)) continue;
    const module = await import(new URL(file, directory).href);
    for (const [name, register] of Object.entries(module)) {
      if (!name.startsWith('register') || typeof register !== 'function') continue;
      register({ add(toolName, text, validator, output) {
        declarations.push({ name: toolName, description: text, parameters: toolParameters(validator), validator, output });
        return () => {};
      } });
    }
  }
  assert.ok(declarations.length > 0, 'no discovered tool declarations');
  assert.equal(new Set(declarations.map((tool) => tool.name)).size, declarations.length, 'duplicate tool name');
  return declarations;
}
