# Worktree Footer Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make the Worktree sidebar footer action match the native Settings row with a left-aligned branch icon, an expanded label, and an icon-only collapsed rail control.

**Architecture:** Keep the existing \`sidebar.footer.action\` slot and view-mode store. The Client action renders the DSH primitive \`IconBranchOutline16\` beside \`Worktree\` when \`wide\` is true, while local CSS mirrors the native Settings trigger geometry.

**Tech Stack:** TypeScript, React TSX, CSS Modules, Node test runner, pnpm workspace.

## Global Constraints

- Do not modify DSH source or the native Settings package.
- Keep the existing Worktree mode callback, \`aria-label\`, \`aria-pressed\`, title, and \`data-active\` state.
- Use \`IconBranchOutline16\` from \`@deepseek-ai/dsh-client-ui-primitives\`.
- The wide row is left-aligned and the collapsed rail control is icon-only.
- Do not change Worktree data, Remote, Host, Manage, Provider, or session behavior.
- Use \`apply_patch\` for local source and test edits.

---

### Task 1: Add a failing regression test

**Files:**

- Modify: \`test/client-surface.test.mjs\`.
- Read-only reference: \`src/client/WorktreeModeAction.tsx\` and \`src/client/worktree.css\`.

**Interfaces:**

- Consumes: existing source-fixture tests that read Client TSX/CSS without mounting a browser.
- Produces: a regression test named \`renders the Worktree footer action like the native Settings row\`.

- [ ] **Step 1: Write the failing test.**

Append this test to \`test/client-surface.test.mjs\`:

~~~js
test('renders the Worktree footer action like the native Settings row', async () => {
  const actionSource = await readFile(
    new URL('../src/client/WorktreeModeAction.tsx', import.meta.url),
    'utf8',
  );
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(actionSource, /IconBranchOutline16/);
  assert.match(actionSource, /<IconBranchOutline16 size=\{wide \? 16 : 18\} \/>/);
  assert.match(actionSource, /wide && <span className=\{styles\.actionLabel\}>Worktree<\/span>/);
  assert.doesNotMatch(actionSource, /wide \? 'Worktree' : 'WT'/);
  assert.match(styleSource, /\.action \{[\s\S]*justify-content: flex-start;[\s\S]*height: 42px;/);
  assert.match(
    styleSource,
    /\.action\[data-collapsed='true'\] \{[\s\S]*width: 36px;[\s\S]*height: 36px;[\s\S]*border-radius: 50%;/,
  );
});
~~~

- [ ] **Step 2: Run the focused test and verify RED.**

Run:

~~~sh
node --test test/client-surface.test.mjs --test-name-pattern='Worktree footer action'
~~~

Expected: the new test fails because the current action has no branch icon, renders \`WT\` when collapsed, and uses centered 32px styling.

### Task 2: Implement the native-style action

**Files:**

- Modify: \`src/client/WorktreeModeAction.tsx:1-43\`.
- Modify: \`src/client/worktree.css:1-31\`.

**Interfaces:**

- Consumes: the failing regression test and the existing \`wide\`, \`useStore\`, \`actions\`, and \`available\` props.
- Produces: the same Worktree toggle with native-style wide and collapsed projections.

- [ ] **Step 1: Add the DSH branch icon and render the projection.**

Add this import to \`WorktreeModeAction.tsx\`:

~~~tsx
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
~~~

Keep all existing button props and callbacks. Replace the current text-only child with:

~~~tsx
      <IconBranchOutline16 size={wide ? 16 : 18} />
      {wide && <span className={styles.actionLabel}>Worktree</span>}
~~~

- [ ] **Step 2: Match the native Settings row geometry in local CSS.**

Replace the \`.action\` and collapsed-state rules at the start of \`worktree.css\` with:

~~~css
.action {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: calc(100% + 4px);
  height: 42px;
  margin: 4px -2px;
  box-sizing: border-box;
  border: 0;
  border-radius: 12px;
  padding: 0 10px 0 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  overflow: hidden;
}

.action:hover,
.action[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.action[data-collapsed='true'] {
  width: 36px;
  height: 36px;
  margin: 8px 0 10px;
  justify-content: center;
  gap: 0;
  padding: 0;
  border-radius: 50%;
}

.actionLabel {
  overflow: hidden;
  white-space: nowrap;
}
~~~

Keep the rest of \`worktree.css\` unchanged.

- [ ] **Step 3: Run the focused test and verify GREEN.**

Run:

~~~sh
node --test test/client-surface.test.mjs --test-name-pattern='Worktree footer action'
~~~

Expected: the focused regression test passes.

### Task 3: Verify and commit

**Files:**

- Verify: \`src/client/WorktreeModeAction.tsx\`.
- Verify: \`src/client/worktree.css\`.
- Verify: \`test/client-surface.test.mjs\`.

**Interfaces:**

- Consumes: the green focused test and existing package scripts.
- Produces: a typechecked, built, tested Client change with no unrelated edits.

- [ ] **Step 1: Run the complete Client surface test file.**

Run:

~~~sh
node --test test/client-surface.test.mjs
~~~

Expected: all tests pass.

- [ ] **Step 2: Run package typecheck, build, and test.**

Run:

~~~sh
pnpm typecheck
pnpm build
pnpm test
~~~

Expected: each command exits successfully; \`pnpm test\` rebuilds the package and all Node tests pass.

- [ ] **Step 3: Check formatting and scope.**

Run:

~~~sh
git diff --check
git status --short
git diff -- src/client/WorktreeModeAction.tsx src/client/worktree.css test/client-surface.test.mjs
~~~

Expected: no whitespace errors; only the planned Client source, CSS, and test changes are present. No generated \`lib/\`, coverage, sidecar, or DSH files are added.

- [ ] **Step 4: Commit the implementation.**

Run:

~~~sh
git add src/client/WorktreeModeAction.tsx src/client/worktree.css test/client-surface.test.mjs
git commit -m "feat(worktree): match native footer action"
~~~

Expected: one implementation commit containing only the three planned files.
