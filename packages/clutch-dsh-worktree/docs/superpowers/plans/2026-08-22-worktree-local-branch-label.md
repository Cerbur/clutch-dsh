# Worktree Local Branch Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Main label in Worktree mode with localized `Local (current-branch)` / `本地（当前分支）` text and a localized fallback when no current branch is available.

**Architecture:** Derive the current branch in the browser `WorktreeSurface` from the existing `WorktreeWorkspaceView.branches` projection and pass a translated label to the existing shared `WorktreeGroupRow`. Keep the branch value and label transformation in the Client presentation layer; do not change Host, Manager, Remote, RPC, or contract data. Preserve the existing Main row weight and remove only the Main-only uppercase CSS transformation.

**Tech Stack:** TypeScript, React 18, CSS Modules, DSH LocaleRuntime/`PropsLocale`, Node test runner, pnpm workspace.

## Global Constraints

- Select the current branch with `view?.branches.find((branch) => branch.isCurrent)?.name`.
- Use `t('worktree.mainWithBranch', { branch: currentBranch })` when a current branch exists.
- Use the existing `t('worktree.main')` key as the no-current-branch fallback.
- English copy must be `Local ({branch})`; Chinese copy must be `本地（{branch}）`.
- Display the branch name exactly as supplied by DSH/Git; do not translate, uppercase, or otherwise normalize it.
- Remove Main-only `text-transform: uppercase` while retaining `font-weight: 600`.
- Keep existing Worktree row geometry, hover card, menu behavior, accessibility wiring, and locale registration unchanged.
- Do not modify Host, Provider, Manage, Remote/RPC, sidecar persistence, or any unrelated package.
- Follow TDD: write and run the failing regression test before modifying production code.
- Use `apply_patch` for local edits and do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures.

---

## File map

- `src/client/WorktreeSurface.tsx` — derive the current branch label beside the existing Main/Worktree render and pass it to `WorktreeGroupRow`.
- `src/client/locales.ts` — change the fallback Main copy and add the parameterized English/Chinese copy.
- `src/client/worktree.css` — preserve Main weight while removing the uppercase transformation.
- `test/client-surface.test.mjs` — add source/CSS regression assertions for branch selection, fallback routing, and casing.
- `test/client-locale.test.mjs` — assert the exact localized fallback/templates and branch placeholders.
- `src/client/README.md` — document the localized Main label behavior in the browser Consumer contract.
- `README.md` — document the user-visible Main label behavior alongside the interface-language description.

## Task 1: Add the failing regression tests

**Files:**

- Modify: `test/client-surface.test.mjs` after the existing `polishes Main and Worktree row hover presentation` test.
- Modify: `test/client-locale.test.mjs` after the existing placeholder test.

**Interfaces:**

- Consumes: the current fixed `t('worktree.main')` Main label and current Main-only uppercase CSS rule.
- Produces: failing assertions that define the new Client presentation and locale contract before production code changes.

- [ ] **Step 1: Add the source/CSS regression test.**

Append this test to `test/client-surface.test.mjs`:

```js
test('renders a localized Main label with the current branch and a fallback', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const currentBranch = view\?\.branches\.find\(\s*\(branch\) => branch\.isCurrent,?\s*\)\?\.name;/,
  );
  assert.match(
    source,
    /const mainLabel = currentBranch === undefined\s+\? t\('worktree\.main'\)\s+: t\('worktree\.mainWithBranch', \{ branch: currentBranch \}\);/,
  );
  assert.match(source, /kind="main"[\s\S]*label=\{mainLabel\}/);
  assert.doesNotMatch(source, /label=\{t\('worktree\.main'\)\}/);
  assert.match(
    styles,
    /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*font-weight: 600;/,
  );
  assert.doesNotMatch(
    styles,
    /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*text-transform: uppercase;/,
  );
});
```

- [ ] **Step 2: Add the exact locale copy assertions.**

Append this test to `test/client-locale.test.mjs`:

```js
test('uses localized Local copy with the current branch', () => {
  assert.equal(zh['worktree.main'], '本地');
  assert.equal(en['worktree.main'], 'Local');
  assert.equal(zh['worktree.mainWithBranch'], '本地（{branch}）');
  assert.equal(en['worktree.mainWithBranch'], 'Local ({branch})');
});
```

- [ ] **Step 3: Update the existing UI-polish assertion for the new casing contract.**

In the existing `polishes Main and Worktree row hover presentation` test, replace
the assertion that currently requires `text-transform: uppercase`:

```js
assert.match(
  styles,
  /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[\s\S]*text-transform: uppercase;[\s\S]*font-weight: 600;/,
);
```

with these assertions:

```js
assert.match(
  styles,
  /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*font-weight: 600;/,
);
assert.doesNotMatch(
  styles,
  /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*text-transform: uppercase;/,
);
```

- [ ] **Step 4: Run the focused tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='localized Main label|polishes Main and Worktree row hover presentation|localized Local copy'
```

Expected: the package build completes, then the new source/CSS and locale tests
fail because the current source has no `currentBranch`/`mainLabel`, the locale
dictionary has no `worktree.mainWithBranch`, and the current CSS still forces
uppercase. The failure must be an assertion failure, not a test-loader or
TypeScript error.

- [ ] **Step 5: Commit the failing tests.**

```bash
git add test/client-surface.test.mjs test/client-locale.test.mjs
git commit -m "test(worktree): specify localized Main branch label"
```

## Task 2: Implement the localized branch label

**Files:**

- Modify: `src/client/locales.ts:23-25` and the matching English entries.
- Modify: `src/client/WorktreeSurface.tsx:1378-1471` in the visible Workspace render.
- Modify: `src/client/worktree.css:484-487` in the Main-only label rule.

**Interfaces:**

- Consumes: `WorktreeWorkspaceView.branches`, `BranchRecord.isCurrent`, `WorktreeTranslate`, and the existing `WorktreeGroupRow` `label` prop.
- Produces: a translated `mainLabel` string that is passed to the shared Main row without changing the component API or data contract.

- [ ] **Step 1: Add the balanced locale entries.**

In `src/client/locales.ts`, replace the Chinese fixed Main entry and add the
parameterized entry beside it:

```ts
  'worktree.title': 'Worktree',
  'worktree.main': '本地',
  'worktree.mainWithBranch': '本地（{branch}）',
```

In the English dictionary, use the matching key set and exact punctuation:

```ts
  'worktree.title': 'Worktrees',
  'worktree.main': 'Local',
  'worktree.mainWithBranch': 'Local ({branch})',
```

Keep `en satisfies Record<WorktreeLocaleKey, string>` unchanged so TypeScript
continues to enforce dictionary parity.

- [ ] **Step 2: Derive the Main label from the current branch.**

In the `visibleWorkspaces.map` callback in `src/client/WorktreeSurface.tsx`,
after `const view = viewByWorkspace.get(workspace.workspaceId);`, add:

```tsx
                  const currentBranch = view?.branches.find(
                    (branch) => branch.isCurrent,
                  )?.name;
                  const mainLabel = currentBranch === undefined
                    ? t('worktree.main')
                    : t('worktree.mainWithBranch', { branch: currentBranch });
```

Then change the Main `WorktreeGroupRow` call from:

```tsx
                            label={t('worktree.main')}
```

to:

```tsx
                            label={mainLabel}
```

Do not change the Worktree row's `label={record.branch}` or any Session,
Workspace, action, or menu behavior.

- [ ] **Step 3: Remove only the Main uppercase transformation.**

Keep the Main-only selector and its weight in `src/client/worktree.css`, but
make it:

```css
.worktreeRow[data-main-group='true'] .worktreeLabel {
  font-weight: 600;
}
```

Do not alter the shared row slot widths, health spacing, hover-card styles, or
non-Main labels.

- [ ] **Step 4: Run the focused tests and verify GREEN.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='localized Main label|polishes Main and Worktree row hover presentation|localized Local copy'
```

Expected: all matching tests pass, including the existing hover-presentation
assertions and the new branch/fallback/locale assertions. The package build
must also complete without TypeScript errors.

- [ ] **Step 5: Commit the implementation.**

```bash
git add src/client/WorktreeSurface.tsx src/client/locales.ts src/client/worktree.css
git commit -m "fix(worktree): show localized current branch in Main row"
```

## Task 3: Document and verify the completed behavior

**Files:**

- Modify: `src/client/README.md` under `## Worktree surface contract`.
- Modify: `README.md` under `## 界面语言`.
- Read-only verification: all package source and test files.

**Interfaces:**

- Consumes: the localized `mainLabel` behavior from Task 2.
- Produces: documented user-visible behavior and fresh package/workspace verification evidence.

- [ ] **Step 1: Document the browser Consumer behavior.**

Add this bullet after the existing Main/Worktree group-row bullet in
`src/client/README.md`:

```md
- The Main group is localized as `Local (current branch)` / `本地（当前分支）` when DSH reports a current local branch, and falls back to `Local` / `本地` when it does not.
```

- [ ] **Step 2: Document the public UI behavior.**

Add this paragraph after the existing language-following paragraph in
`README.md`:

```md
Worktree mode 的 Main 分组会显示当前 local branch：English 为 `Local (branch)`，中文为
`本地（branch）`；如果 DSH 没有返回当前分支，则显示 `Local` 或 `本地`。branch 名称保持
DSH/Git 原值。
```

- [ ] **Step 3: Run workspace and package static checks.**

Run:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
```

Expected: each command exits with status 0. The build may refresh ignored
`lib/` output; do not stage that generated directory.

- [ ] **Step 4: Run the complete package test suite.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: the package build, remote test typecheck, and all `node:test` files
complete with zero failures.

- [ ] **Step 5: Check formatting, scope, and repository state.**

```bash
git diff --check
git status --short --branch
git diff HEAD~3 --stat
```

Expected: `git diff --check` reports no whitespace errors; only the approved
design/plan commits and the three implementation commits are represented in
the final history; no generated output, coverage, sidecar data, credentials,
or unrelated package changes are present.

- [ ] **Step 6: Commit the documentation.**

```bash
git add README.md src/client/README.md
git commit -m "docs(worktree): describe localized Main branch label"
```

Run `git status --short --branch` once more after the commit and confirm the
working tree contains no untracked or unstaged task files.
