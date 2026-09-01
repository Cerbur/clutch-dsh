# clutch-dsh-discuss MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the installable `@cerbur/clutch-dsh-discuss@0.1.0` atomic DSH plugin with a `/discuss [topic]` command that invokes the bundled `brainstorming` skill and keeps design documents under `docs/clutch/specs/`.

**Architecture:** The package is a thin Cordis plugin whose `apply()` registers one runtime skill and one human command through the existing `skills` and `commands` services. The command creates an ordinary DSH user message and calls `agent.steer()`; the existing `@deepseek-ai/dsh-skill` loader owns skill injection and the skill owns the conversational design workflow. The package has no plugin-owned session state, projection, tool, UI, or filesystem write path.

**Tech Stack:** TypeScript 5.9, Node.js ESM, `@deepseek-ai/cordis@4.0.1`, `@deepseek-ai/dsh-commands@0.1.1-rc.2`, `@deepseek-ai/dsh-llm@0.1.1-rc.2`, `@deepseek-ai/dsh-skill@0.1.0-rc.8`, Node test runner, pnpm, YAML Cordis bundle patch, Markdown, and SVG.

## Global Constraints

- Work only in `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_ad9f262d-d502-4567-b2ec-fd5beab02bb0` on `wt-discuss-0.1.0/release`.
- Preserve the pre-existing untracked `.idea/`, `packages/clutch-dsh-discuss/lib/`, and `docs/superpowers/specs/2026-09-01-clutch-dsh-discuss-mvp-design.md` files byte-for-byte; never use the default build output while validating this change.
- Treat the approved design's generic “skill loader” reference as the installed `@deepseek-ai/dsh-skill` service; do not add or modify any DeepSeek Harness source package.
- Register the package skill as both `modelInvocable: true` and `userInvocable: true`, with `source: 'bundled'`, `provider: '@cerbur/clutch-dsh-discuss'`, and a directory resource base beside the skill file.
- `/discuss` must steer exactly `/brainstorming`; `/discuss <topic>` must steer exactly `/brainstorming\\n\\n<trimmed topic>` as one `createUserMessage()` user message, with `recordInput: false`.
- Skill frontmatter must be separated from the Markdown body before registration; malformed or unreadable resources must throw a clear setup error.
- README.md and README.zh.md must describe identical public behavior, use the required four-section order, and not duplicate the package version.
- Do not publish, push, merge, create release tags, or commit without separate explicit authorization.

---

### Task 1: Add the atomic package manifest and bundle registration

**Files:**

- Create: `packages/clutch-dsh-discuss/test/package-manifest.test.mjs`
- Create: `packages/clutch-dsh-discuss/package.json`
- Create: `packages/clutch-dsh-discuss/cordis.patch.yml`
- Create: `packages/clutch-dsh-discuss/tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces package identity `@cerbur/clutch-dsh-discuss`, version `0.1.0`, role metadata, `dsh.bundle.patch`, and the `commands`/`skills` peer contracts consumed by later tasks.

- [x] **Step 1: Write the failing manifest and patch test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const packageDirectory = path.resolve(import.meta.dirname, '..');

test('manifest describes the atomic discuss plugin and publishes runtime resources', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));

  assert.equal(manifest.name, '@cerbur/clutch-dsh-discuss');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.type, 'module');
  assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml', 'skills', 'assets']);
  assert.equal(manifest.exports['.'].import, './lib/index.js');
  assert.equal(manifest.exports['.'].types, './lib/index.d.ts');
  assert.equal(manifest.exports['./package.json'], './package.json');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.clutchDsh, {
    plugin: '@cerbur/clutch-dsh-discuss',
    role: 'plugin',
    serviceDefinition: '@cerbur/clutch-dsh-discuss',
  });
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.1');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-commands'], '>=0.1.1-rc.2 <0.2.0-0');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-llm'], '>=0.1.1-rc.2 <0.2.0-0');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-skill'], '>=0.1.0-rc.8 <0.2.0-0');
});

test('Cordis patch inserts the discuss plugin into the DSH bundle', async () => {
  const patch = parse(await readFile(path.join(packageDirectory, 'cordis.patch.yml'), 'utf8'));

  assert.deepEqual(patch, [
    {
      insert: [
        {
          id: 'clutch-dsh-discuss',
          name: '@cerbur/clutch-dsh-discuss',
        },
      ],
    },
  ]);
});
```

- [x] **Step 2: Run the manifest test to verify it fails for missing package files**

Run: `pnpm exec node --test packages/clutch-dsh-discuss/test/package-manifest.test.mjs`

Expected: FAIL with a missing `packages/clutch-dsh-discuss/package.json` or `cordis.patch.yml` error; this confirms the test is guarding the new package rather than an existing implementation.

- [x] **Step 3: Add the minimal package metadata**

Create `packages/clutch-dsh-discuss/package.json` with the exact runtime and development contracts below:

```json
{
  "name": "@cerbur/clutch-dsh-discuss",
  "version": "0.1.0",
  "description": "Adds a /discuss command that activates the DSH brainstorming skill.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Cerbur/clutch-dsh.git",
    "directory": "packages/clutch-dsh-discuss"
  },
  "homepage": "https://github.com/Cerbur/clutch-dsh/tree/main/packages/clutch-dsh-discuss",
  "packageManager": "pnpm@10.32.1",
  "keywords": [
    "deepseek-harness",
    "dsh",
    "dsh-plugin",
    "brainstorming",
    "requirements",
    "design-doc"
  ],
  "type": "module",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "import": "./lib/index.js",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "skills", "assets"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "prepublishOnly": "pnpm run build",
    "build": "node scripts/build.mjs",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "node scripts/test.mjs"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "clutchDsh": {
    "plugin": "@cerbur/clutch-dsh-discuss",
    "role": "plugin",
    "serviceDefinition": "@cerbur/clutch-dsh-discuss"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "4.0.1",
    "@deepseek-ai/dsh-commands": ">=0.1.1-rc.2 <0.2.0-0",
    "@deepseek-ai/dsh-llm": ">=0.1.1-rc.2 <0.2.0-0",
    "@deepseek-ai/dsh-skill": ">=0.1.0-rc.8 <0.2.0-0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.1",
    "@deepseek-ai/dsh-commands": "0.1.1-rc.2",
    "@deepseek-ai/dsh-llm": "0.1.1-rc.2",
    "@deepseek-ai/dsh-skill": "0.1.0-rc.8",
    "@types/node": "^22.15.3",
    "yaml": "^2.9.0"
  }
}
```

The `yaml` dev dependency is used only by repository tests to parse the patch; runtime code uses Node built-ins and has no bundled runtime dependency.

- [x] **Step 4: Add the bundle patch and compiler configuration**

Create `packages/clutch-dsh-discuss/cordis.patch.yml` with:

```yaml
- insert:
    - id: clutch-dsh-discuss
      name: '@cerbur/clutch-dsh-discuss'
```

Create `packages/clutch-dsh-discuss/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [x] **Step 5: Refresh the workspace lockfile**

Run: `pnpm install --lockfile-only`

Expected: `pnpm-lock.yaml` gains one importer for `packages/clutch-dsh-discuss` and resolves the four DSH contracts without changing any source file or the pre-existing untracked `lib/`.

- [x] **Step 6: Run the manifest and workspace shape checks**

Run: `pnpm exec node --test packages/clutch-dsh-discuss/test/package-manifest.test.mjs`

Expected: PASS for both manifest tests.

Run: `pnpm run check:workspace`

Expected: `workspace shape ok`.

- [ ] **Step 7: Commit**

Do not execute this step without explicit authorization. When authorized:

```bash
git add pnpm-lock.yaml packages/clutch-dsh-discuss/package.json packages/clutch-dsh-discuss/cordis.patch.yml packages/clutch-dsh-discuss/tsconfig.json packages/clutch-dsh-discuss/test/package-manifest.test.mjs
git commit -m "feat(discuss): scaffold MVP plugin package"
```

### Task 2: Implement and test the `/discuss` command

**Files:**

- Create: `packages/clutch-dsh-discuss/test/command.test.mjs`
- Create: `packages/clutch-dsh-discuss/test/load-module.mjs`
- Create: `packages/clutch-dsh-discuss/src/command.ts`

**Interfaces:**

- Consumes: `CommandDefinition`, `CommandInvocation` from `@deepseek-ai/dsh-commands`; `createUserMessage` from `@deepseek-ai/dsh-llm`.
- Produces: `DISCUSS_COMMAND_NAME = 'discuss'`, `buildBrainstormingMessage(rawInput: string): string`, and `createDiscussCommand(): CommandDefinition`.

- [x] **Step 1: Add the test import helper and failing command tests**

Create `packages/clutch-dsh-discuss/test/load-module.mjs`:

```js
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadPackageModule(name) {
  const root =
    process.env.CLUTCH_DSH_DISCUSS_TEST_LIB ?? path.resolve(import.meta.dirname, '../src');
  const extension = process.env.CLUTCH_DSH_DISCUSS_TEST_LIB === undefined ? '.ts' : '.js';
  return import(pathToFileURL(path.join(root, `${name}${extension}`)).href);
}
```

Create `packages/clutch-dsh-discuss/test/command.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPackageModule } from './load-module.mjs';

const { DISCUSS_COMMAND_NAME, buildBrainstormingMessage, createDiscussCommand } =
  await loadPackageModule('command');

function invocation(rawInput, steer = () => {}) {
  return {
    commandId: 'cmd-test',
    agent: { steer },
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  };
}

test('command metadata advertises an optional topic without recording duplicate input', () => {
  const command = createDiscussCommand();

  assert.equal(DISCUSS_COMMAND_NAME, 'discuss');
  assert.equal(command.name, 'discuss');
  assert.equal(command.description, 'Start the brainstorming discussion workflow');
  assert.deepEqual(command.input, { hint: '[optional topic]' });
  assert.equal(command.recordInput, false);
});

test('bare /discuss steers the exact brainstorming gesture', () => {
  let steered;
  const result = createDiscussCommand().handler(
    invocation('  ', (message) => {
      steered = message;
    }),
  );

  assert.deepEqual(result, {
    kind: 'success',
    text: 'Brainstorming discussion started without a topic.',
  });
  assert.equal(buildBrainstormingMessage('  '), '/brainstorming');
  assert.equal(steered.role, 'user');
  assert.deepEqual(steered.content, [{ type: 'text', text: '/brainstorming' }]);
  assert.deepEqual(steered.source, { kind: 'user' });
});

test('topic input is trimmed and sent after the brainstorming gesture in one message', () => {
  let steered;
  const result = createDiscussCommand().handler(
    invocation('  Build a login flow  ', (message) => {
      steered = message;
    }),
  );

  assert.deepEqual(result, {
    kind: 'success',
    text: 'Brainstorming discussion started with a topic.',
  });
  assert.equal(
    buildBrainstormingMessage('  Build a login flow  '),
    '/brainstorming\\n\\nBuild a login flow',
  );
  assert.deepEqual(steered.content, [
    { type: 'text', text: '/brainstorming\\n\\nBuild a login flow' },
  ]);
});

test('steer failures become command errors and do not claim that discussion started', () => {
  const result = createDiscussCommand().handler(
    invocation('Build a login flow', () => {
      throw new Error('agent is disposed');
    }),
  );

  assert.deepEqual(result, {
    kind: 'error',
    text: 'Unable to start discussion: agent is disposed',
  });
});
```

- [x] **Step 2: Run the command tests before adding production code**

Run: `node --experimental-strip-types --test packages/clutch-dsh-discuss/test/command.test.mjs`

Expected: FAIL because `packages/clutch-dsh-discuss/src/command.ts` does not exist yet; the failure must be an absent implementation module, not a syntax error in the assertions.

- [x] **Step 3: Implement the minimal command contract**

Create `packages/clutch-dsh-discuss/src/command.ts`:

```ts
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const DISCUSS_COMMAND_NAME = 'discuss';

function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildBrainstormingMessage(rawInput: string): string {
  const topic = rawInput.trim();
  return topic.length === 0 ? '/brainstorming' : `/brainstorming\\n\\n${topic}`;
}

function successText(rawInput: string): string {
  return rawInput.trim().length === 0
    ? 'Brainstorming discussion started without a topic.'
    : 'Brainstorming discussion started with a topic.';
}

function steerDiscussion(invocation: CommandInvocation): void {
  invocation.agent.steer(
    createUserMessage({
      content: [{ type: 'text', text: buildBrainstormingMessage(invocation.rawInput) }],
      source: { kind: 'user' },
    }),
  );
}

export function createDiscussCommand(): CommandDefinition {
  return {
    name: DISCUSS_COMMAND_NAME,
    description: 'Start the brainstorming discussion workflow',
    input: { hint: '[optional topic]' },
    recordInput: false,
    handler(invocation) {
      try {
        steerDiscussion(invocation);
        return { kind: 'success', text: successText(invocation.rawInput) };
      } catch (error) {
        return { kind: 'error', text: `Unable to start discussion: ${thrownMessage(error)}` };
      }
    },
  };
}
```

- [x] **Step 4: Run the focused command tests to verify they pass**

Run: `node --experimental-strip-types --test packages/clutch-dsh-discuss/test/command.test.mjs`

Expected: PASS for four command behaviors.

- [x] **Step 5: Run TypeScript typecheck for the command**

Run: `pnpm --filter @cerbur/clutch-dsh-discuss typecheck`

Expected: PASS once the package entrypoint from Task 4 is present; if run before Task 4, use `pnpm exec tsc --noEmit -p packages/clutch-dsh-discuss/tsconfig.json` and expect only the missing-entrypoint-independent source set to be checked.

- [ ] **Step 6: Commit**

Do not execute this step without explicit authorization. When authorized:

```bash
git add packages/clutch-dsh-discuss/src/command.ts packages/clutch-dsh-discuss/test/command.test.mjs packages/clutch-dsh-discuss/test/load-module.mjs
git commit -m "feat(discuss): add brainstorming command"
```

### Task 3: Bundle and validate the brainstorming skill

**Files:**

- Create: `packages/clutch-dsh-discuss/test/skill.test.mjs`
- Create: `packages/clutch-dsh-discuss/src/skill.ts`
- Create: `packages/clutch-dsh-discuss/skills/brainstorming/SKILL.md`
- Create: `packages/clutch-dsh-discuss/skills/brainstorming/visual-companion.md`
- Create: `packages/clutch-dsh-discuss/skills/brainstorming/spec-document-reviewer-prompt.md`

**Interfaces:**

- Consumes: the approved skill behavior and the upstream brainstorming resource set.
- Produces: `BRAINSTORMING_SKILL_NAME`, `BRAINSTORMING_SKILL_PATH`, `loadBrainstormingSkill(filePath?: string): SkillRegistration`, and `createBrainstormingSkill(): SkillRegistration`.

- [x] **Step 1: Add failing skill resource tests**

Create `packages/clutch-dsh-discuss/test/skill.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadPackageModule } from './load-module.mjs';

const { BRAINSTORMING_SKILL_NAME, createBrainstormingSkill, loadBrainstormingSkill } = await loadPackageModule('skill');

test('loads the bundled skill metadata and body separately', async () => {
  const skill = createBrainstormingSkill();
  const source = await readFile(path.join(path.dirname(skill.path), 'SKILL.md'), 'utf8');

  assert.equal(BRAINSTORMING_SKILL_NAME, 'brainstorming');
  assert.equal(skill.name, 'brainstorming');
  assert.equal(skill.description, 'You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.');
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
  assert.equal(skill.content, source.replace(/^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n/u, ''));
  assert.doesNotMatch(skill.content, /^---/u);
  assert.match(skill.content, /docs\\/clutch\\/specs\\/YYYY-MM-DD-<topic>-design\\.md/u);
});

test('rejects a skill file without a complete frontmatter boundary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-discuss-skill-'));
  const filePath = path.join(directory, 'SKILL.md');
  try {
    await writeFile(filePath, '# missing frontmatter\\n');
    assert.throws(() => loadBrainstormingSkill(filePath), /frontmatter/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects frontmatter missing required name or description', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-discuss-skill-'));
  const filePath = path.join(directory, 'SKILL.md');
  try {
    await writeFile(filePath, '---\\nname: brainstorming\\n---\\n# body\\n');
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
```

- [x] **Step 2: Run skill tests to verify they fail for the missing implementation**

Run: `node --experimental-strip-types --test packages/clutch-dsh-discuss/test/skill.test.mjs`

Expected: FAIL because `packages/clutch-dsh-discuss/src/skill.ts` and the bundled resource files do not exist yet.

- [x] **Step 3: Add the upstream skill resources with the approved destination change**

Copy the upstream files from `https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/` into `packages/clutch-dsh-discuss/skills/brainstorming/`. Preserve the frontmatter, instruction ordering, and references to `visual-companion.md` and `spec-document-reviewer-prompt.md`; replace every design-document destination `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` with `docs/clutch/specs/YYYY-MM-DD-<topic>-design.md`. The main file must retain this frontmatter:

```markdown
---
name: brainstorming
description: 'You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.'
---
```

The packaged resource set must include all three files and no resource may instruct the model to write design documents under `docs/superpowers/specs/`.

- [x] **Step 4: Implement frontmatter parsing and runtime registration**

Create `packages/clutch-dsh-discuss/src/skill.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillRegistration } from '@deepseek-ai/dsh-skill';

export const BRAINSTORMING_SKILL_NAME = 'brainstorming';
export const BRAINSTORMING_SKILL_PATH = fileURLToPath(
  new URL('../skills/brainstorming/SKILL.md', import.meta.url),
);

const PROVIDER_NAME = '@cerbur/clutch-dsh-discuss';
const FRONTMATTER_PATTERN = /^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)$/u;

type SkillFrontmatter = Readonly<Record<string, string>>;

function parseFrontmatter(
  raw: string,
  filePath: string,
): { metadata: SkillFrontmatter; content: string } {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (match === null) {
    throw new Error(
      `bundled skill at ${filePath} must start with YAML frontmatter delimited by ---`,
    );
  }

  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\\r?\\n/u)) {
    if (line.trim().length === 0) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) {
      throw new Error(`bundled skill at ${filePath} has invalid frontmatter line: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    const token = line.slice(separator + 1).trim();
    if (token.length === 0) {
      throw new Error(`bundled skill at ${filePath} has an empty frontmatter value for ${key}`);
    }
    metadata[key] =
      token.startsWith('"') && token.endsWith('"') ? (JSON.parse(token) as string) : token;
  }

  const name = metadata.name?.trim();
  const description = metadata.description?.trim();
  if (name === undefined || name.length === 0) {
    throw new Error(`bundled skill at ${filePath} frontmatter must define name`);
  }
  if (description === undefined || description.length === 0) {
    throw new Error(`bundled skill at ${filePath} frontmatter must define description`);
  }

  return { metadata: Object.freeze(metadata), content: match[2] };
}

export function loadBrainstormingSkill(filePath = BRAINSTORMING_SKILL_PATH): SkillRegistration {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`unable to read bundled skill at ${filePath}`, { cause: error });
  }

  const { metadata, content } = parseFrontmatter(raw, filePath);
  if (metadata.name !== BRAINSTORMING_SKILL_NAME) {
    throw new Error(`bundled skill at ${filePath} must be named ${BRAINSTORMING_SKILL_NAME}`);
  }

  return {
    name: metadata.name,
    description: metadata.description,
    source: 'bundled',
    provider: PROVIDER_NAME,
    path: resolve(filePath),
    resourceBase: { kind: 'directory', path: dirname(resolve(filePath)) },
    metadata,
    content,
    invocation: { modelInvocable: true, userInvocable: true },
  };
}

export function createBrainstormingSkill(): SkillRegistration {
  return loadBrainstormingSkill();
}
```

- [x] **Step 5: Run the focused skill tests to verify they pass**

Run: `node --experimental-strip-types --test packages/clutch-dsh-discuss/test/skill.test.mjs`

Expected: PASS for metadata/body separation, malformed frontmatter, missing required metadata, and unreadable resource errors.

- [ ] **Step 6: Commit**

Do not execute this step without explicit authorization. When authorized:

```bash
git add packages/clutch-dsh-discuss/src/skill.ts packages/clutch-dsh-discuss/skills packages/clutch-dsh-discuss/test/skill.test.mjs
git commit -m "feat(discuss): bundle brainstorming skill"
```

### Task 4: Wire the plugin entrypoint and verify real Cordis composition

**Files:**

- Create: `packages/clutch-dsh-discuss/src/index.ts`
- Create: `packages/clutch-dsh-discuss/test/composition.test.mjs`

**Interfaces:**

- Consumes: `createDiscussCommand()` from `src/command.ts` and `createBrainstormingSkill()` from `src/skill.ts`.
- Produces: plugin identity `name`, service dependencies `inject`, `apply(ctx)`, and exports for the command/skill seams.

- [x] **Step 1: Write the failing composition test**

Create `packages/clutch-dsh-discuss/test/composition.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPackageModule } from './load-module.mjs';

const { apply, inject, name } = await loadPackageModule('index');

test('plugin metadata requires commands and skills and registers both in order', () => {
  const registrations = [];
  apply({
    skills: {
      register(skill) {
        registrations.push(['skill', skill]);
        return () => {};
      },
    },
    commands: {
      register(command) {
        registrations.push(['command', command]);
        return () => {};
      },
    },
  });

  assert.equal(name, 'clutch-dsh-discuss');
  assert.deepEqual(inject, ['commands', 'skills']);
  assert.deepEqual(
    registrations.map(([kind]) => kind),
    ['skill', 'command'],
  );
  assert.equal(registrations[0][1].name, 'brainstorming');
  assert.equal(registrations[1][1].name, 'discuss');
});
```

- [x] **Step 2: Run the composition test to verify it fails for the missing entrypoint**

Run: `node --experimental-strip-types --test packages/clutch-dsh-discuss/test/composition.test.mjs`

Expected: FAIL because `packages/clutch-dsh-discuss/src/index.ts` does not exist yet.

- [x] **Step 3: Implement the composition root**

Create `packages/clutch-dsh-discuss/src/index.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis';
import { createDiscussCommand } from './command.js';
import { createBrainstormingSkill } from './skill.js';

export {
  createDiscussCommand,
  DISCUSS_COMMAND_NAME,
  buildBrainstormingMessage,
} from './command.js';
export {
  BRAINSTORMING_SKILL_NAME,
  BRAINSTORMING_SKILL_PATH,
  createBrainstormingSkill,
  loadBrainstormingSkill,
} from './skill.js';

export const name = 'clutch-dsh-discuss';
export const inject = ['commands', 'skills'];

export function apply(ctx: Context): void {
  ctx.skills.register(createBrainstormingSkill());
  ctx.commands.register(createDiscussCommand());
}
```

- [x] **Step 4: Run focused composition and type checks**

Run: `node --experimental-strip-types --test packages/clutch-dsh-discuss/test/composition.test.mjs`

Expected: PASS for plugin identity, injection list, registration order, and both registered names.

Run: `pnpm --filter @cerbur/clutch-dsh-discuss typecheck`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 5: Commit**

Do not execute this step without explicit authorization. When authorized:

```bash
git add packages/clutch-dsh-discuss/src/index.ts packages/clutch-dsh-discuss/test/composition.test.mjs
git commit -m "feat(discuss): compose command and skill"
```

### Task 5: Make isolated builds/test runs and add public documentation

**Files:**

- Create: `packages/clutch-dsh-discuss/scripts/build.mjs`
- Create: `packages/clutch-dsh-discuss/scripts/test.mjs`
- Create: `packages/clutch-dsh-discuss/README.zh.md`
- Modify: `packages/clutch-dsh-discuss/README.md`
- Create: `packages/clutch-dsh-discuss/RELEASE-LOG.md`
- Create: `packages/clutch-dsh-discuss/docs/RELEASING.md`
- Create: `packages/clutch-dsh-discuss/assets/screenshots/discuss-mvp.svg`
- Modify: `README.md`

**Interfaces:**

- Consumes: package exports and public command/skill behavior from Tasks 2–4.
- Produces: published documentation, the package-specific release parameters, a portable flow illustration, and `pnpm build/test` scripts that can redirect generated output through `CLUTCH_DSH_DISCUSS_OUT_DIR`.

- [x] **Step 1: Add a failing documentation/isolated-output test**

Extend `test/package-manifest.test.mjs` with:

```js
test('documents the four required sections and ships the skill resources', async () => {
  const readme = await readFile(path.join(packageDirectory, 'README.md'), 'utf8');
  const readmeZh = await readFile(path.join(packageDirectory, 'README.zh.md'), 'utf8');
  const skill = await readFile(path.join(packageDirectory, 'skills/brainstorming/SKILL.md'), 'utf8');

  assert.ok(readme.indexOf('## Feature introduction') < readme.indexOf('## Capabilities'));
  assert.ok(readme.indexOf('## Capabilities') < readme.indexOf('## Installation'));
  assert.ok(readme.indexOf('## Installation') < readme.indexOf('## Detailed usage'));
  assert.ok(readmeZh.indexOf('## 功能介绍') < readmeZh.indexOf('## 能力'));
  assert.ok(readmeZh.indexOf('## 能力') < readmeZh.indexOf('## 安装'));
  assert.ok(readmeZh.indexOf('## 安装') < readmeZh.indexOf('## 详细使用'));
  assert.match(readme, /assets\\/screenshots\\/discuss-mvp\\.svg/u);
  assert.match(readmeZh, /assets\\/screenshots\\/discuss-mvp\\.svg/u);
  assert.match(readme, /dsh plugin --profile web add @cerbur\\/clutch-dsh-discuss/u);
  assert.match(readmeZh, /dsh plugin --profile web add @cerbur\\/clutch-dsh-discuss/u);
  assert.match(skill, /docs\\/clutch\\/specs\\//u);
  assert.doesNotMatch(skill, /docs\\/superpowers\\/specs\\/YYYY-MM-DD-<topic>-design\\.md/u);
});
```

- [x] **Step 2: Run the documentation test to verify it fails before docs are added**

Run: `pnpm exec node --test packages/clutch-dsh-discuss/test/package-manifest.test.mjs`

Expected: FAIL because README.zh.md and the documentation sections/asset do not exist yet.

- [x] **Step 3: Implement isolated build and test runners**

Create `packages/clutch-dsh-discuss/scripts/build.mjs`:

```js
import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(
  packageRoot,
  'node_modules/.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);
const outputDirectory = path.resolve(packageRoot, process.env.CLUTCH_DSH_DISCUSS_OUT_DIR ?? 'lib');

accessSync(tsc, constants.X_OK);
const result = spawnSync(
  tsc,
  ['-p', path.join(packageRoot, 'tsconfig.json'), '--outDir', outputDirectory],
  {
    cwd: packageRoot,
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
```

Create `packages/clutch-dsh-discuss/scripts/test.mjs`:

```js
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(packageRoot, '.test-'));
const outputDirectory = path.join(tempRoot, 'lib');
const buildScript = path.join(packageRoot, 'scripts/build.mjs');
const testDirectory = path.join(packageRoot, 'test');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: packageRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const buildStatus = run(process.execPath, [buildScript], {
    ...process.env,
    CLUTCH_DSH_DISCUSS_OUT_DIR: outputDirectory,
  });
  if (buildStatus !== 0)
    throw new Error(`isolated package build exited with status ${buildStatus}`);

  await cp(path.join(packageRoot, 'skills'), path.join(tempRoot, 'skills'), { recursive: true });
  const tests = (await readdir(testDirectory))
    .filter((entry) => entry.endsWith('.test.mjs'))
    .sort()
    .map((entry) => path.join(testDirectory, entry));
  const testStatus = run(process.execPath, ['--test', ...tests], {
    ...process.env,
    CLUTCH_DSH_DISCUSS_TEST_LIB: outputDirectory,
  });
  if (testStatus !== 0) throw new Error(`package tests exited with status ${testStatus}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
```

- [x] **Step 4: Run the isolated package test suite**

Run: `pnpm --filter @cerbur/clutch-dsh-discuss test`

Expected: the package compiles into a temporary directory, copies only its `skills/` resources beside that temporary `lib/`, all manifest/command/skill/composition tests pass, and `git status --short` still shows the original `packages/clutch-dsh-discuss/lib/` unchanged.

- [x] **Step 5: Write the bilingual README and package release notes**

`README.md` must use exactly these headings in order and include the flow image in the first and fourth sections:

````markdown
# @cerbur/clutch-dsh-discuss

## Feature introduction

![MVP command-to-skill flow](assets/screenshots/discuss-mvp.svg)

`@cerbur/clutch-dsh-discuss` adds one human-facing `/discuss [topic]` command to a DSH host. It activates the bundled `brainstorming` skill; it does not add a custom session service, model-facing tool, client UI, or plugin-owned persistence.

## Capabilities

- Register the `brainstorming` skill for both model and user invocation.
- Start the workflow with `/discuss` or pass a trimmed topic with `/discuss Build a login flow`.
- Let the existing DSH skill loader drive the approved context/questions/approaches/design-review flow.
- Keep generated design documents under `docs/clutch/specs/YYYY-MM-DD-<topic>-design.md`.

## Installation

### npm

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
```
````

### Repository/source checkout

```bash
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-discuss
```

The source checkout must be built before installing it by path; run `pnpm --filter @cerbur/clutch-dsh-discuss build` in the release worktree or use the package's normal publish build.

## Detailed usage

![MVP command-to-skill flow](assets/screenshots/discuss-mvp.svg)

```text
/discuss
  -> DSH steers /brainstorming
  -> the registered skill is injected
  -> the model asks one question at a time and compares approaches
  -> the reviewed design is written under docs/clutch/specs/
```

Use `/discuss` for a blank intake, or `/discuss Build a login flow` to seed the same brainstorming turn with a topic. The command requires a host composition containing the DSH `commands` and `skills` services and the existing user-explicit skill loader. The selected host still controls filesystem, question, and commit capabilities.

````

`README.zh.md` must convey the same commands, paths, package name, service requirements, and limitations with headings `功能介绍`, `能力`, `安装`, and `详细使用` in that order; npm installation comes before repository/source installation.

Create `RELEASE-LOG.md` with the initial bilingual `0.1.0` entry, Chinese section before English, and create `docs/RELEASING.md` with actual values `@cerbur/clutch-dsh-discuss`, `discuss`, `packages/clutch-dsh-discuss`, `cordis.patch.yml`, and the absolute source-install command. State that build/test validation redirects to a temporary output directory because the release worktree contains a pre-existing untracked `lib/`.

- [x] **Step 6: Add the portable SVG flow asset and root README entry**

Create `assets/screenshots/discuss-mvp.svg` as a self-contained 1200×420 SVG with three labeled boxes and arrows for `/discuss [topic]`, `@deepseek-ai/dsh-skill brainstorming`, and `docs/clutch/specs/`; include accessible `<title>` and `<desc>` elements and no external image/font references.

Add one row to the root README plugin table and one install command:

```markdown
| [`@cerbur/clutch-dsh-discuss`](packages/clutch-dsh-discuss/README.md) | <img src="packages/clutch-dsh-discuss/assets/screenshots/discuss-mvp.svg" width="240" alt="clutch-dsh-discuss MVP flow"> | 通过 `/discuss [topic]` 激活 DSH brainstorming skill 并产出 design doc。 |
````

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
```

- [x] **Step 7: Run documentation and formatting checks**

Run: `pnpm exec node --test packages/clutch-dsh-discuss/test/package-manifest.test.mjs`

Expected: PASS for manifest, patch, resource, README-order, and install-command assertions.

Run: `pnpm exec prettier --check packages/clutch-dsh-discuss/package.json packages/clutch-dsh-discuss/tsconfig.json packages/clutch-dsh-discuss/cordis.patch.yml packages/clutch-dsh-discuss/src packages/clutch-dsh-discuss/test packages/clutch-dsh-discuss/scripts packages/clutch-dsh-discuss/README.md packages/clutch-dsh-discuss/README.zh.md packages/clutch-dsh-discuss/docs/RELEASING.md packages/clutch-dsh-discuss/RELEASE-LOG.md packages/clutch-dsh-discuss/assets/screenshots/discuss-mvp.svg README.md`

Expected: all checked files are formatted.

- [ ] **Step 8: Commit**

Do not execute this step without explicit authorization. When authorized:

```bash
git add README.md packages/clutch-dsh-discuss
git commit -m "feat(discuss): document MVP plugin"
```

### Task 6: Run final isolated verification and inspect the release worktree

**Files:**

- Modify: `docs/superpowers/plans/2026-09-01-clutch-dsh-discuss-mvp-implementation.md` (checklist/status only)

**Interfaces:**

- Consumes: all package source, resource, metadata, documentation, and tests from Tasks 1–5.
- Produces: verified build/type/lint/test/workspace/patch results and a clean audit proving pre-existing untracked files were untouched.

- [x] **Step 1: Build into a unique temporary output directory**

Run:

```bash
DISCUSS_BUILD_DIR="$(mktemp -d /private/tmp/clutch-dsh-discuss-build.XXXXXX)"
CLUTCH_DSH_DISCUSS_OUT_DIR="$DISCUSS_BUILD_DIR/lib" pnpm --filter @cerbur/clutch-dsh-discuss build
```

Expected: exit 0 with compiled `index.js`, `command.js`, and `skill.js` under the temporary directory; `packages/clutch-dsh-discuss/lib/` remains byte-for-byte unchanged.

- [x] **Step 2: Run package and root validation (safe decomposition)**

Run each command from the release worktree root:

```bash
pnpm --filter @cerbur/clutch-dsh-discuss typecheck
pnpm --filter @cerbur/clutch-dsh-discuss lint
pnpm --filter @cerbur/clutch-dsh-discuss test
pnpm run check:workspace
pnpm run check:patches
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm exec node --test scripts/*.test.mjs
```

Expected: every listed command exits 0; the package test runner uses its own temporary output; no command writes to the pre-existing untracked package `lib/`. The aggregate `pnpm run check` was not run because it recursively invokes unrelated package tests that may rebuild pre-existing untracked artifacts; the listed components provide the same relevant checks without that side effect.

- [x] **Step 3: Verify exact untracked-file preservation**

Before final verification, save hashes without modifying the files:

```bash
IDEA_HASH="$(find .idea -type f -print0 2>/dev/null | sort -z | xargs -0 shasum 2>/dev/null || true)"
LIB_HASH="$(find packages/clutch-dsh-discuss/lib -type f -print0 | sort -z | xargs -0 shasum)"
SPEC_HASH="$(shasum docs/superpowers/specs/2026-09-01-clutch-dsh-discuss-mvp-design.md)"
```

After verification, re-run the same three read-only hash commands and compare their output. Expected: hashes match; `git status --short` still reports the original untracked files plus only the intended implementation files.

- [x] **Step 4: Update this plan with actual verification results**

Replace each completed task checkbox with `[x]` and append a concise verification table containing the exact command and observed result. Do not claim the default `pnpm build` passed unless it was run with `CLUTCH_DSH_DISCUSS_OUT_DIR` and did not touch the protected `lib/`.

#### Actual verification results

| Command                                                                                              | Result                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env CLUTCH_DSH_DISCUSS_OUT_DIR=/private/tmp/.../lib pnpm --filter @cerbur/clutch-dsh-discuss build` | PASS; `index.js`, `command.js`, and `skill.js` emitted to isolated output.                                                                                                                                                                                |
| `pnpm --filter @cerbur/clutch-dsh-discuss typecheck`                                                 | PASS.                                                                                                                                                                                                                                                     |
| `pnpm --filter @cerbur/clutch-dsh-discuss lint`                                                      | PASS.                                                                                                                                                                                                                                                     |
| `pnpm --filter @cerbur/clutch-dsh-discuss test`                                                      | PASS; 12 tests passed in a package-local temporary output directory.                                                                                                                                                                                      |
| `pnpm run check:workspace`                                                                           | PASS; workspace shape ok.                                                                                                                                                                                                                                 |
| `pnpm run check:patches`                                                                             | PASS; existing unresolved `!!js dshHomePath()` YAML warning remains.                                                                                                                                                                                      |
| `pnpm run format:check`                                                                              | PASS.                                                                                                                                                                                                                                                     |
| `pnpm run lint`                                                                                      | PASS.                                                                                                                                                                                                                                                     |
| `pnpm run typecheck`                                                                                 | PASS; 3 workspace projects checked.                                                                                                                                                                                                                       |
| `pnpm exec node --test scripts/*.test.mjs`                                                           | PASS; 17 root script tests passed.                                                                                                                                                                                                                        |
| `git diff --check`                                                                                   | PASS.                                                                                                                                                                                                                                                     |
| Protected-file hashes before/after final verification                                                | PASS; `.idea/` `fa7837916026ec458fc64ccf75e92ce37a4dd2e826b14f2c9851d8d32b71a2d0`, discuss `lib/` `6ff9f8bcc54bd9f331260f3b1ade7495145772aea36205741c0a09f8c577cf86`, approved design `04bdaba9e041a13f6396c1254814003a68db8894a5ea79e3af806cd980f6e6ff`. |

The aggregate `pnpm run check` remains intentionally unexecuted for the safety reason recorded above; its non-mutating components and all package-specific checks passed.

- [ ] **Step 5: Commit**

Do not execute this step without explicit authorization. When authorized:

```bash
git add docs/superpowers/plans/2026-09-01-clutch-dsh-discuss-mvp-implementation.md
git commit -m "docs(discuss): record MVP implementation verification"
```

## Plan Self-Review

- Spec coverage: package shape, exact command messages, recordInput behavior, skill metadata/body split, precedence-compatible runtime registration, resource base, errors, documentation, patch entry, version `0.1.0`, no custom state/UI/tool, and protected untracked files are each covered by a task.
- Placeholder scan: no implementation step depends on `TBD`, `TODO`, “similar to Task N”, or an unspecified error/edge-case action; the only path placeholders are user-facing absolute-install examples required by the documentation.
- Type consistency: `createDiscussCommand()` returns `CommandDefinition`; `createBrainstormingSkill()` and `loadBrainstormingSkill()` return `SkillRegistration`; `apply()` consumes both and registers skill before command; test imports use the isolated `CLUTCH_DSH_DISCUSS_TEST_LIB` path.
- API correction: the design's generic `dsh-tool-skill` wording maps to the actual installed `@deepseek-ai/dsh-skill` package in this release lockfile; behavior and the approved architecture are unchanged.
- Build tooling: the package declares `typescript` as a devDependency because its isolated build script resolves the package-local compiler; this affects only source/build tooling and not published runtime dependencies.
