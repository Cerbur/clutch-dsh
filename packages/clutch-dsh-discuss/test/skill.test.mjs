import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadPackageModule } from './load-module.mjs';

const { BRAINSTORMING_SKILL_NAME, createBrainstormingSkill, loadBrainstormingSkill } =
  await loadPackageModule('skill');

test('loads the bundled skill metadata and body separately', async () => {
  const skill = createBrainstormingSkill();
  const source = await readFile(path.join(path.dirname(skill.path), 'SKILL.md'), 'utf8');

  assert.equal(BRAINSTORMING_SKILL_NAME, 'brainstorming');
  assert.equal(skill.name, 'brainstorming');
  assert.equal(
    skill.description,
    'You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.',
  );
  assert.equal(skill.source, 'bundled');
  assert.equal(skill.provider, '@cerbur/clutch-dsh-discuss');
  assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true });
  assert.deepEqual(skill.metadata, {
    name: 'brainstorming',
    description: skill.description,
  });
  assert.deepEqual(skill.resourceBase, {
    kind: 'directory',
    path: path.dirname(skill.path),
  });
  assert.equal(skill.content, source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, ''));
  assert.doesNotMatch(skill.content, /^---/u);
  assert.match(skill.content, /docs\/clutch\/specs\/YYYY-MM-DD-<topic>-design\.md/u);
  assert.match(skill.content, /visual-companion\.md/u);
  assert.match(skill.content, /spec-document-reviewer-prompt\.md/u);
});

test('rejects a skill file without a complete frontmatter boundary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-discuss-skill-'));
  const filePath = path.join(directory, 'SKILL.md');
  try {
    await writeFile(filePath, '# missing frontmatter\n');
    assert.throws(() => loadBrainstormingSkill(filePath), /frontmatter/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects frontmatter missing required name or description', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-discuss-skill-'));
  const filePath = path.join(directory, 'SKILL.md');
  try {
    await writeFile(filePath, '---\nname: brainstorming\n---\n# body\n');
    assert.throws(() => loadBrainstormingSkill(filePath), /description/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports unreadable skill resources as setup errors', () => {
  assert.throws(
    () => loadBrainstormingSkill('/private/tmp/clutch-dsh-discuss-skill-does-not-exist/SKILL.md'),
    /unable to read bundled skill/i,
  );
});
