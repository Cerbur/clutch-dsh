import assert from 'node:assert/strict';
import test from 'node:test';

const { compileTemplate, renderTemplate } = await import('../lib/renderer.js');

test('compiles placeholders and renders deterministic values', () => {
  const compiled = compileTemplate(
    '${daytime}|类型[${type}]|描述[${desc}]',
    new Set(['daytime', 'type', 'desc']),
  );

  assert.deepEqual(compiled.segments, [
    { kind: 'field', name: 'daytime' },
    { kind: 'literal', text: '|类型[' },
    { kind: 'field', name: 'type' },
    { kind: 'literal', text: ']|描述[' },
    { kind: 'field', name: 'desc' },
    { kind: 'literal', text: ']' },
  ]);
  assert.equal(
    renderTemplate(compiled, {
      daytime: '0903',
      type: '配置',
      desc: '优化 session title 生成规则',
    }),
    '0903|类型[配置]|描述[优化 session title 生成规则]',
  );
});

test('preserves pure literals, dollar signs, and Unicode punctuation', () => {
  const compiled = compileTemplate('人民币 ¥100｜完成。', new Set());

  assert.deepEqual(compiled.segments, [{ kind: 'literal', text: '人民币 ¥100｜完成。' }]);
  assert.equal(renderTemplate(compiled, {}), '人民币 ¥100｜完成。');
  assert.equal(compileTemplate('$${name}', new Set(['name'])).source, '$${name}');
});

test('rejects unsafe or malformed placeholders at compile time', () => {
  const invalidTemplates = [
    '${missing}',
    '${foo',
    '${}',
    '${foo-bar}',
    '${foo.bar}',
    '${foo ? foo : ""}',
    '${foo(1)}',
    '${foo[0]}',
    '${foo.toString}',
  ];

  for (const source of invalidTemplates) {
    assert.throws(
      () => compileTemplate(source, new Set(['foo'])),
      /template|placeholder|field|identifier/i,
      source,
    );
  }
});

test('rejects missing and non-string runtime values', () => {
  const compiled = compileTemplate('${type}', new Set(['type']));

  assert.throws(() => renderTemplate(compiled, {}), /value|type/i);
  assert.throws(() => renderTemplate(compiled, { type: 1 }), /string|type/i);
  assert.throws(() => renderTemplate(compiled, { type: () => 'x' }), /string|type/i);
});

test('does not interpret expressions or truncate rendered output', () => {
  const compiled = compileTemplate('prefix:${value}:suffix', new Set(['value']));
  const value = 'a'.repeat(500);

  assert.equal(renderTemplate(compiled, { value }), `prefix:${value}:suffix`);
});
