import assert from 'node:assert/strict';
import test from 'node:test';

const { formatDateTime, resolveDeterministicFields, validateExtractedFields } =
  await import('../lib/fields.js');

const timestamp = Date.UTC(2026, 8, 3, 16, 0);

test('formats session.createdAt in the requested timezone', () => {
  assert.equal(formatDateTime(timestamp, 'MMDD', 'Asia/Shanghai'), '0904');
  assert.equal(formatDateTime(timestamp, 'MMDD', 'UTC'), '0903');
  assert.equal(formatDateTime(timestamp, 'YYYY-MM-DD', 'Asia/Shanghai'), '2026-09-04');
  assert.equal(formatDateTime(timestamp, 'YYYY-DDD HH:mm', 'UTC'), '2026-246 16:00');
});

test('resolves only deterministic datetime and literal fields', () => {
  const values = resolveDeterministicFields(
    {
      daytime: {
        kind: 'datetime',
        source: 'session.createdAt',
        format: 'MMDD',
        timezone: 'Asia/Shanghai',
      },
      scope: { kind: 'literal', value: '  work  ' },
      type: { kind: 'llm-enum', instruction: '分类', values: ['前端'] },
    },
    timestamp,
  );

  assert.deepEqual(values, { daytime: '0904', scope: 'work' });
  assert.ok(Object.isFrozen(values));
});

test('accepts valid enum and Unicode-limited text fields after normalization', () => {
  const fields = {
    type: { kind: 'llm-enum', instruction: '分类', values: ['前端', '后端'] },
    desc: { kind: 'llm-text', instruction: '总结', maxCharacters: 8 },
  };

  assert.deepEqual(
    validateExtractedFields(fields, { type: ' 前端 ', desc: ' 优化\n title\u0000 ' }),
    { type: '前端', desc: '优化 title' },
  );
});

test('rejects invalid dynamic field shapes and values', () => {
  const fields = {
    type: { kind: 'llm-enum', instruction: '分类', values: ['前端', '后端'] },
    desc: { kind: 'llm-text', instruction: '总结', maxCharacters: 4 },
  };

  const invalidCandidates = [
    null,
    [],
    { type: '前端' },
    { type: '前端', desc: null },
    { type: '前端', desc: ['优化'] },
    { type: '前端', desc: 1 },
    { type: '前端', desc: { text: '优化' } },
    { type: '前端', desc: '优化', extra: 'unexpected' },
    { type: '移动端', desc: '优化' },
    { type: '前端', desc: '一二三四五' },
    { type: '前端', desc: '\u0000\r\n\t' },
  ];

  for (const candidate of invalidCandidates) {
    assert.throws(
      () => validateExtractedFields(fields, candidate),
      /field|value|object|enum|character/i,
    );
  }
});

test('rejects invalid timestamps, timezone names, date tokens, and literals', () => {
  const dateField = {
    kind: 'datetime',
    source: 'session.createdAt',
    format: 'MMDD',
    timezone: 'Asia/Shanghai',
  };

  for (const invalidTimestamp of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(
      () => resolveDeterministicFields({ daytime: dateField }, invalidTimestamp),
      /timestamp|date/i,
    );
  }
  assert.throws(
    () =>
      resolveDeterministicFields(
        { daytime: { ...dateField, timezone: 'Mars/Olympus' } },
        timestamp,
      ),
    /timezone/i,
  );
  assert.throws(
    () => resolveDeterministicFields({ daytime: { ...dateField, format: 'YYYY-DDDD' } }, timestamp),
    /format|token/i,
  );
  assert.throws(
    () => resolveDeterministicFields({ marker: { kind: 'literal', value: '   ' } }, timestamp),
    /literal|value/i,
  );
});
