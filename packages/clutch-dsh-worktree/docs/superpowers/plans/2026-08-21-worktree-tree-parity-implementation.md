# Worktree Tree Native Parity Implementation Plan

> **Follow-up (2026-08-21):** Main now uses the same split-row/disclosure
> presentation as Worktree. Its browser-local expansion state is independent
> from the Workspace and session overflow state; the Main `+` remains available,
> while Main intentionally has no removal menu.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Worktree Workspace tree behave and look like the native DSH Workspace browser, including whole-row disclosure, native text metrics, and one aligned trailing `+` rail.

**Architecture:** Keep the existing `WorktreeWorkspaceRow` and Worktree tree composition. Add row-level disclosure handling and a native hover presentation in the Consumer, then make the existing Workspace/Main/Worktree action slot an explicit fixed-width rail with a shared right-edge anchor. No DSH source, RPC, sidecar, or relationship logic changes.

**Tech Stack:** React 18, TypeScript, CSS Modules, DSH client UI primitives, Node test runner, pnpm workspace, Arc Computer Use through `@oai/sky`.

## Global Constraints

- Do not modify the native DSH source repository or native DSH package implementations.
- Keep `WorktreeWorkspaceRow` as the Worktree Consumer's local presentation component.
- The Workspace row itself toggles expansion; menu and `+` actions must stop propagation.
- Folder/chevron presentation is hover-only for Workspace rows, matching native DSH.
- Workspace, Worktree, and Session tree text uses `14px`, regular weight, and `20px` line height; the session overflow action uses `12px`.
- Workspace, Main, and active Worktree rows share a fixed `64px` trailing action rail; no per-row `translateX` alignment hack is allowed.
- Preserve the existing 28px button hit area and semantic DSH color tokens.
- Use `apply_patch` for source, test, plan, and README edits.
- Run focused tests before broader package checks, and use Computer Use to inspect the already-open DSH page in Arc after the build; code-only verification is insufficient.
- Do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures to Git.

---

### Task 1: Add failing interaction, typography, and rail regression tests

**Files:**

- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: the current source text from `src/client/WorktreeSurface.tsx` and CSS text from `src/client/worktree.css`.
- Produces: focused source/CSS assertions that fail before the implementation and protect the approved native-parity behavior.

- [x] **Step 1: Add the failing Workspace interaction assertions.**

Add a test that reads both files and asserts the Workspace row has row-level
`onClick` wiring, while the menu and Workspace `+` handlers call
`stopPropagation()`. Assert that the Workspace disclosure control has a
dedicated class so its hover-only presentation can be tested separately. The
test should use a scoped source slice around `WorktreeWorkspaceRow`, so the
existing disclosure button's `onClick={onToggle}` cannot satisfy the row-click
assertion accidentally:

```js
test('uses native whole-row Workspace disclosure and hover affordances', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  const rowStart = source.indexOf('className={`${styles.workspaceRow} ${markerClass}`}');
  const rowEnd = source.indexOf('</div>\n  );\n}', rowStart);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);
  const rowSource = source.slice(rowStart, rowEnd);
  assert.match(rowSource, /onClick=\{\(\) => \{\s*onToggle\(\);/);
  assert.match(rowSource, /className=\{`\$\{styles\.disclosureButton\} \$\{styles\.workspaceDisclosure\}`\}/);
  assert.match(rowSource, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);[\s\S]*onCreateWorktree\(\);/);
  assert.match(rowSource, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);[\s\S]*onMenuOpenChange/);
  assert.match(styles, /\.workspaceRow \.workspaceDisclosure\s*\{[\s\S]*display: none;/);
  assert.match(styles, /\.workspaceRow:hover \.workspaceDisclosure\s*,[\s\S]*display: inline-flex;/);
  assert.match(styles, /\.workspaceRow:hover \.workspaceIcon\s*,[\s\S]*display: none;/);
});
```

- [x] **Step 2: Add the failing native text metric assertions.**

In the same test file, add a CSS declaration helper or direct source
assertions that require these exact declarations:

```js
assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*font-size: 14px;/);
assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*font-weight: 400;/);
assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*line-height: 20px;/);
assert.match(styles, /\.treeSessionContent\s*\{[\s\S]*font-size: 14px;[\s\S]*line-height: 20px;/);
assert.match(styles, /\.sessionOverflowButton\s*\{[\s\S]*font-size: 12px;/);
assert.match(styles, /\.searchInput\s*\{[\s\S]*font-size: 13px;/);
```

- [x] **Step 3: Add the failing fixed-rail assertions.**

Require the CSS to define a single fixed-width rail and a right-edge anchor
for its final `+` button:

```js
assert.match(styles, /\.treeActionSlot\s*,[\s\S]*\.workspaceActions\s*\{[\s\S]*flex: 0 0 64px;/);
assert.match(styles, /\.treeActionSlot\s*,[\s\S]*\.workspaceActions\s*\{[\s\S]*width: 64px;/);
assert.match(styles, /\.treeActionSlot > \.iconButton:last-child\s*\{[\s\S]*right: 0;/);
assert.match(styles, /\.treeActionSlot > \.menuAction\s*\{[\s\S]*right: 32px;/);
```

- [x] **Step 4: Run the focused tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='Workspace|native text|action rail|surface'
```

Expected: the existing surface tests that already pass remain meaningful, but
the new row interaction, typography, and rail assertions fail because the
current row has no row-level click handler, current tree text is 12–13px, and
the rail is flex-positioned rather than right-anchored.

- [x] **Step 5: Commit the red regression tests.**

```bash
git add test/client-surface.test.mjs
git commit -m "test(worktree): pin native tree parity requirements"
```

### Task 2: Implement whole-row disclosure, native typography, and shared action rail

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`

**Interfaces:**

- Consumes: the existing `WorktreeWorkspaceRow` props, `toggleWorkspace`, and current tree action markup.
- Produces: a Workspace row that toggles from its body or disclosure affordance, native hover presentation, native text metrics, and a stable trailing rail consumed by Workspace/Main/Worktree rows.

- [x] **Step 1: Add row-level Workspace disclosure without double toggles.**

Update the root Workspace row element in `WorktreeWorkspaceRow` so it calls
`onToggle` from the row body:

```tsx
<div
  className={`${styles.workspaceRow} ${markerClass}`}
  data-workspace-drag={drag.active ? 'active' : undefined}
  data-menu-open={menuOpen || undefined}
  draggable
  onClick={() => {
    onToggle();
  }}
  onDragStart={(event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', workspace.workspaceId);
    drag.start();
  }}
  onDragEnd={drag.end}
  onDragOver={(event) => {
    if (!drag.active) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    drag.hover(rowHalf(event));
  }}
  onDrop={(event) => {
    if (!drag.active) return;
    event.preventDefault();
    drag.drop(rowHalf(event));
  }}
>
```

Give its existing disclosure button the dedicated class and stop propagation
before calling the same toggle callback:

```tsx
<button
  type="button"
  className={`${styles.disclosureButton} ${styles.workspaceDisclosure}`}
  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${workspace.title}`}
  aria-expanded={expanded}
  onClick={(event) => {
    event.stopPropagation();
    onToggle();
  }}
>
```

Keep the existing `stopPropagation()` calls on the ellipsis and Workspace
`+` buttons. Do not add a second expansion state or change Worktree expansion.

- [x] **Step 2: Implement native folder/chevron hover swapping.**

Add these CSS rules next to the Workspace row rules. The folder is visible at
rest; the dedicated disclosure control replaces it only while the Workspace
row is hovered. Keep the menu-open state visually pinned without changing the
toggle semantics:

```css
.workspaceRow .workspaceDisclosure {
  display: none;
}

.workspaceRow:hover .workspaceDisclosure,
.workspaceRow[data-menu-open='true'] .workspaceDisclosure {
  display: inline-flex;
}

.workspaceRow:hover .workspaceIcon,
.workspaceRow[data-menu-open='true'] .workspaceIcon {
  display: none;
}
```

- [x] **Step 3: Apply the native tree text metrics.**

Update the existing selectors without changing semantic colors:

```css
.workspaceTitle,
.worktreeLabel {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
}

.treeSessionContent {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
}

.sessionOverflowButton {
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
}

.searchInput {
  font-size: 13px;
  line-height: 18px;
}
```

Retain the existing `MAIN` rule at `10px`/`600` and its native letter
spacing. Do not increase modal/error copy as part of this tree-only fix.

- [x] **Step 4: Make the trailing action rail deterministic.**

Replace the current flex-only action-slot sizing with an explicit positioned
rail. Keep the 28px hit target, reserve the hidden menu slot, and anchor the
last direct button to the same right edge for Workspace, Main, and Worktree:

```css
.treeActionSlot,
.workspaceActions {
  position: relative;
  display: inline-flex;
  flex: 0 0 64px;
  align-items: center;
  justify-content: flex-end;
  width: 64px;
  height: 28px;
  margin-left: auto;
}

.treeActionSlot > .menuAction {
  position: absolute;
  top: 0;
  right: 32px;
}

.treeActionSlot > .iconButton:last-child {
  position: absolute;
  top: 0;
  right: 0;
}
```

Ensure the existing `.menuAction` keeps its 28px width/height and hidden
visibility at rest. Remove the standalone `.worktreeActions { display:
inline-flex; }` override because the shared rail declaration now controls its
display; keep the existing hover/menu-open visibility behavior for the menu
and Worktree actions.

- [x] **Step 5: Run the focused tests and verify GREEN.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='Workspace|native text|action rail|surface'
```

Expected: the new regression assertions and all existing matching Client
surface tests pass.

- [x] **Step 6: Commit the implementation slice.**

```bash
git add src/client/WorktreeSurface.tsx src/client/worktree.css
git commit -m "fix(worktree): match native workspace tree parity"
```

### Task 3: Update records, run package verification, and perform Arc UI QA

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-21-worktree-surface-optimization.md`
- Verify: `src/client/WorktreeSurface.tsx`
- Verify: `src/client/worktree.css`
- Verify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: the completed Consumer implementation and the existing Arc tab titled `查看当前工作目录 — DSH Local Build`.
- Produces: documented native-parity behavior, passing package checks, and a visual confirmation from the real DSH page.

- [x] **Step 1: Record the behavior change in package documentation.**

Add a short native-parity note to `README.md` and the current surface
optimization plan: Workspace rows toggle from the row body, the chevron is a
hover affordance, tree copy follows native DSH metrics, and the Workspace/Main/
Worktree `+` controls share a fixed right-aligned rail. State that this remains
browser-local presentation and does not alter DSH data or source.

- [x] **Step 2: Build the package and run the complete package checks.**

Run from the package directory:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
git diff --check
```

Expected: typecheck, build, and the full Node test suite exit with code 0; the
diff check reports no whitespace errors. Do not add generated `lib/` output.

- [x] **Step 3: Reload and inspect the real DSH page with Computer Use.**

Use the persistent Computer Use `node_repl` session and the `@oai/sky` API;
do not substitute a terminal-only or code-only check:

```js
var state = await sky.get_app_state({ app: 'Arc' });
nodeRepl.write(state.text);
if (state.screenshot) {
  var fs = await import('node:fs/promises');
  var url = await import('node:url');
  await nodeRepl.emitImage({
    bytes: await fs.readFile(url.fileURLToPath(state.screenshot.url)),
    mimeType: 'image/png',
  });
}
```

If the DSH page still shows the old bundle, reload Arc with
`sky.press_key({ app: 'Arc', key: 'super+r' })`, then call
`sky.get_app_state({ app: 'Arc' })` again before acting on the page. The page
must remain the existing local DSH page; do not navigate to a new site.

- [x] **Step 4: Verify row interaction and hover presentation in Arc.**

Use the latest screenshot and fresh coordinates/AX indices after every action:

1. Move the pointer away by clicking an inert blank area in the conversation
   pane and capture the screenshot. Confirm Workspace rows show folders without
   a visible chevron.
2. Click the body/title of an expanded Workspace row, not its menu, `+`, or
   disclosure control. Capture the screenshot and confirm the Workspace
   children collapse; click the same row again and confirm they re-open.
3. Move the pointer onto the Workspace row by clicking its title/body and
   capture the screenshot. Confirm the hover row exposes the chevron and the
   folder is replaced, while the click also preserves the expected expanded
   state.
4. Click a Workspace `+` and a Worktree `+` only if an action dialog is needed
   to expose their positions; close any opened dialog through its normal
   Cancel/Close control without creating data. Confirm their visible plus
   centers share one vertical line with the Main `+` in the screenshot.

Do not delete Workspaces or Worktrees, create Sessions, submit forms, or alter
external data during this QA pass. If the page cannot be reloaded or the
visual result differs, record the exact Arc state and stop before claiming the
fix is complete.

- [x] **Step 5: Review the final diff and status.**

Run:

```bash
git status --short
git diff --stat HEAD~2..HEAD
rg -n "translateX|treeActionSlot|workspaceDisclosure|font-size: 14px" src/client/worktree.css src/client/WorktreeSurface.tsx test/client-surface.test.mjs
```

Expected: only the approved design/plan, Consumer, focused test, and package
documentation files are changed; no DSH source, generated output, sidecar, or
credential files are present.
