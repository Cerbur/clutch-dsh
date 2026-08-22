# Worktree UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Polish the Worktree tree rows so hover disclosure does not shift content, Main renders as bold `MAIN`, the health dot is closer to the branch name, and truncated names use the native DSH hover card.

**Architecture:** Keep the existing parameterized `WorktreeGroupRow` as the sole Main/Worktree presentation component. Apply the geometry and typography changes in the Worktree-specific CSS selectors, and wrap only Worktree rows in the already-installed DSH `HoverCard` primitive. No host, manager, transport, sidecar, or DSH-owned data changes are needed.

**Tech Stack:** TypeScript, React 18, CSS Modules, `@deepseek-ai/dsh-client-ui-primitives`, Node test runner, pnpm workspace.

## Global Constraints

- Keep the branch/tree icon slot and disclosure slot in `.worktreeRow` at exactly `22px`.
- Keep the existing Workspace row geometry unchanged.
- Apply uppercase and stronger weight only to the Main Worktree label selected by `data-main-group='true'`.
- Reduce `.worktreeState` from `16px` plus `2px` right margin to `12px` plus `0` right margin.
- Use DSH primitives `HoverCard` with a `500ms` open delay for Worktree rows; do not use a browser `title` tooltip.
- Disable the Worktree hover card while its menu is open.
- Do not change DSH source, RPC/transport, sidecar persistence, host/manage code, or unrelated packages.
- Use `apply_patch` for local source, test, documentation, and plan edits.
- Do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures to Git.

---

## File map

- `src/client/WorktreeSurface.tsx` — imports `HoverCard`, keeps the current row as the anchor, and shows the complete Worktree label in the native card.
- `src/client/worktree.css` — owns the 22px replacement slots, Main-only typography, shortened state spacing, and readable hover-card text.
- `test/client-surface.test.mjs` — source/CSS regression test for the four requested UI behaviors.
- `src/client/README.md` — documents the native hover-card behavior at the browser Consumer boundary.

## Task 1: Add the failing UI regression test

**Files:**

- Modify: `test/client-surface.test.mjs` after the existing shared Worktree row geometry test.

**Interfaces:**

- Consumes: `src/client/WorktreeSurface.tsx` and `src/client/worktree.css` as source text.
- Produces: one focused test that fails on the current implementation because it has no `HoverCard`, no Main-only rule, no 22px Worktree icon rule, and the old state spacing.

- [ ] **Step 1: Add the failing source/CSS assertions.**

Append this test to `test/client-surface.test.mjs`:

```js
test('polishes Main and Worktree row hover presentation', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /\bHoverCard\b/);
  assert.match(source, /<HoverCard[\s\S]*openDelayMs=\{500\}/);
  assert.match(
    source,
    /content=\{<div className=\{styles\.worktreeHoverTitle\}>\{label\}<\/div>\}/,
  );
  assert.match(source, /disabled=\{menu\?\.open === true\}/);

  assert.match(
    styles,
    /\.worktreeRow \.worktreeIcon,[\s\S]*\.worktreeRow \.disclosureButton\s*\{[\s\S]*width: 22px;/,
  );
  assert.match(
    styles,
    /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[\s\S]*text-transform: uppercase;[\s\S]*font-weight: 600;/,
  );
  assert.match(
    styles,
    /\.worktreeState\s*\{[\s\S]*width: 12px;[\s\S]*margin-right: 0;/,
  );
  assert.match(
    styles,
    /\.worktreeHoverTitle\s*\{[\s\S]*color: var\(--dsw-static-neutral-bluish-00\);/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='polishes Main and Worktree row hover presentation'
```

Expected: the package build completes, then the new test fails because the
current source does not import or render `HoverCard` and the CSS still has the
old Worktree icon/state declarations.

## Task 2: Implement the four UI fixes

**Files:**

- Modify: `src/client/WorktreeSurface.tsx` near the `WorktreeGroupRow` import and function.
- Modify: `src/client/worktree.css` in the Worktree icon/state/label rules and at the end of the row styles.
- Modify: `src/client/README.md` in the Worktree surface contract bullet list.

**Interfaces:**

- Consumes: the existing `WorktreeGroupRowProps`, `kind`, `label`, `menu`, and CSS Module export.
- Produces: the same row component API and DOM behavior, with Worktree-only native hover-card presentation.

- [ ] **Step 1: Import the native hover-card primitive.**

Add `HoverCard` to the existing import from
`@deepseek-ai/dsh-client-ui-primitives`:

```ts
  HoverCard,
```

Keep the import alphabetically grouped with the other primitives; do not add a
new dependency because the package already declares and uses the primitives
package.

- [ ] **Step 2: Preserve the existing row as the hover-card anchor.**

Inside `WorktreeGroupRow`, replace the `return (` immediately before the
row's `<div>` with this exact line:

```tsx
  const row = (
```

Keep the entire existing row JSX unchanged, including its disclosure, icon,
StateDot, label, menu, `+`, and click handlers. Immediately after the existing
closing `</div>` and `);`, insert this exact return branch:

```tsx
  if (main) return row;
  return (
    <HoverCard
      anchor={row}
      content={<div className={styles.worktreeHoverTitle}>{label}</div>}
      openDelayMs={500}
      disabled={menu?.open === true}
    />
  );
```

Do not add a second row or duplicate the action handlers. `HoverCard` is only
returned when `main` is false, which is the existing `kind === 'worktree'`
case; Main continues to render the anchor directly.

- [ ] **Step 3: Make the Worktree replacement slots identical.**

Replace the existing narrow Worktree disclosure rule:

```css
.worktreeRow .disclosureButton {
  width: 22px;
}
```

with this combined rule after the base `.workspaceIcon, .worktreeIcon` rule:

```css
.worktreeRow .worktreeIcon,
.worktreeRow .disclosureButton {
  width: 22px;
}
```

This leaves `.workspaceIcon` and the Workspace row's inherited disclosure
width unchanged while making the Worktree icon/disclosure replacement exact.

- [ ] **Step 4: Apply Main typography and health-dot spacing.**

Change the existing `.worktreeState` declarations to:

```css
.worktreeState {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 12px;
  margin-right: 0;
}
```

Add this rule immediately after `.workspaceTitle, .worktreeLabel`:

```css
.worktreeRow[data-main-group='true'] .worktreeLabel {
  font-weight: 600;
  text-transform: uppercase;
}
```

The selector must not affect Workspace titles or non-Main Worktree branch
labels.

- [ ] **Step 5: Style the hover-card label and document the Consumer behavior.**

Add this CSS rule near the row text styles:

```css
.worktreeHoverTitle {
  color: var(--dsw-static-neutral-bluish-00);
  font-size: 14px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
```

Add this bullet under the existing Worktree surface contract in
`src/client/README.md`:

```md
- Worktree branch names use the native DSH hover card to reveal the complete label when the tree row is visually truncated; the card is suppressed while the row menu is open.
```

- [ ] **Step 6: Run the focused test and verify GREEN.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='polishes Main and Worktree row hover presentation|shared Worktree row disclosure'
```

Expected: the new polish test and the existing shared-row geometry test pass.

- [ ] **Step 7: Commit the implementation slice.**

Run:

```bash
git add src/client/WorktreeSurface.tsx src/client/worktree.css src/client/README.md test/client-surface.test.mjs
git commit -m "fix(worktree): polish native row hover presentation"
```

## Task 3: Run package verification and handoff checks

**Files:**

- Read-only verification of the implementation files and Git status.

**Interfaces:**

- Consumes: the committed UI implementation from Task 2.
- Produces: evidence that the focused regression, TypeScript, build, package
  test suite, diff formatting, and worktree cleanliness all pass.

- [ ] **Step 1: Run the package typecheck.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
```

Expected: `tsc --noEmit -p tsconfig.json` exits with status 0.

- [ ] **Step 2: Run the package build.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
```

Expected: TypeScript, Typert generation, and the client bundle complete with
status 0. Generated `lib/` output remains ignored and uncommitted.

- [ ] **Step 3: Run the complete package test suite.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: the build and all `node:test` files complete with status 0.

- [ ] **Step 4: Check formatting and final Git scope.**

```bash
git diff --check
git status --short --branch
git diff HEAD~1 --stat
```

Expected: no whitespace errors; only the intended implementation commit (plus
the earlier design commit) is present, and no generated output, credentials,
coverage, or sidecar data is staged or untracked.
