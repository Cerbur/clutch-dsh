# Worktree/Main Shared Group Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Correction (2026-08-22):** The original plan incorrectly removed the
> Worktree removal UI from the whole Client surface. The shared row now accepts
> an optional menu configuration: active Worktrees pass the remove menu and
> confirmation flow, while Main and detached Worktrees omit it. The underlying
> Manager/API contract remains unchanged.

**Goal:** Refactor the Client tree so Main and Worktree groups use one parameterized row component, Main shows the branch/tree icon, and removal UI is exposed only for active Worktrees.

**Architecture:** `WorktreeGroupRow` will own the shared row shell, disclosure button, leading icon, optional health dot, label, fixed action rail, and optional Worktree menu. `WorktreeSurface` will keep Main and Worktree expansion/session state and pass row-specific callbacks and data. Active Worktrees pass the removal menu/modal state; Main and detached rows omit it. `WorktreeManager.removeWorktree` and its Remote/API contract remain unchanged.

**Tech Stack:** React 18, TypeScript, CSS Modules, DSH client UI primitives, Node test runner, pnpm workspace.

## Global Constraints

- Do not modify DSH source or native DSH package implementations.
- Keep DSH as the source of truth for Workspace and Session data.
- Keep Main and Worktree expansion state independent: `expandedMains` and `expandedWorktrees` remain separate browser-local state.
- Main and Worktree group rows must use the shared `worktreeRow`, `worktreeIcon`, `worktreeLabel`, `worktreeDisclosure`, and `treeActionSlot` styles.
- Main must render `IconBranchOutline16` in the same leading icon slot as Worktree.
- The Client surface must render the Worktree remove menu, confirmation dialog, UI label, and remove-specific React state only for active Worktree rows; Main and detached rows must not receive the menu parameter.
- Keep `WorktreeManager.removeWorktree`, the Remote method, Provider implementation, detached binding lifecycle, and all non-Client removal tests unchanged.
- Use `apply_patch` for local source, test, documentation, and plan edits.
- Run each focused test after its RED/GREEN change; do not write production code before observing the new test fail.
- Do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures to Git.

## File Map

- `src/client/WorktreeSurface.tsx` — replace `MainSessionGroupRow` and the inline Worktree row with the shared `WorktreeGroupRow`; retain removal UI behind the optional active-Worktree menu parameter.
- `src/client/worktree.css` — make Main use the existing Worktree row styles and keep menu-open visibility rules for active Worktree rows.
- `test/client-surface.test.mjs` — add RED assertions for one shared row, Main's tree icon, independent expansion/add-session behavior, and conditional Worktree removal UI.
- `README.md` — document active Worktree removal while retaining detached-state behavior and Main's hidden menu.
- `src/client/README.md` — document the Client action boundary and shared row presentation.
- `docs/superpowers/plans/2026-08-21-worktree-tree-parity-implementation.md` — record the follow-up consolidation and removal-UI decision.

---

### Task 1: Add failing Client surface regression tests

**Files:**

- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces:**

- Consumes: the current `WorktreeSurface.tsx` and `worktree.css` source text.
- Produces: source/CSS assertions that define the approved shared-row and conditional-removal contract before production code changes.

- [ ] **Step 1: Replace stale removal expectations with the new failing contract.**

In the existing hierarchy and native menu tests, assert the localized Worktree
remove label and `data-worktree-menu`. In the Modal test, cover both the
creation and removal dialogs:

```js
test('uses the DSH Modal primitives for Worktree create and removal dialogs', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /open=\{worktreeModalWorkspaceId !== undefined/);
  assert.match(source, /open=\{worktreeRemoval !== undefined/);
  assert.match(source, /t\('dialog\.closeWorktreeRemove'\)/);
  assert.doesNotMatch(source, /styles\.modalBackdrop/);
});
```

Keep the existing Session/Workspace `Menu` and `Modal` assertions; additionally
verify that Main does not pass `menu`, while active Worktree rows do.

- [ ] **Step 2: Add the shared-row and Main icon regression test.**

Append this focused test to `test/client-surface.test.mjs`:

```js
test('shares one parameterized group row while gating removal UI by row configuration', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.equal((source.match(/function WorktreeGroupRow/g) ?? []).length, 1);
  assert.match(source, /function WorktreeGroupRow/);
  assert.doesNotMatch(source, /MainSessionGroupRow/);
  assert.match(source, /kind="main"/);
  assert.match(source, /kind="worktree"/);
  assert.match(source, /kind="main"[\s\S]*icon=\{<IconBranchOutline16 \/>\}/);
  assert.match(source, /kind="worktree"[\s\S]*icon=\{<IconBranchOutline16 \/>\}/);
  assert.match(source, /data-add-main-session/);
  assert.match(source, /data-add-session/);
  assert.match(source, /expandedMains/);
  assert.match(source, /expandedWorktrees/);
  assert.match(source, /worktreeRemoval|openWorktreeMenuId|data-worktree-menu/);
  assert.match(source, /t\('worktree\.remove'\)/);
  assert.doesNotMatch(styles, /\.mainRow|\.mainLabel|\.mainDisclosure/);
});
```

The old source must fail this test because it did not expose the conditional
remove menu/modal or the menu-open CSS branches. The test also protects against
passing that menu parameter to Main.

- [ ] **Step 3: Run the focused tests and verify RED.**

Run from the package directory:

```bash
pnpm exec node --test test/client-surface.test.mjs
```

Expected: the command exits non-zero. The failure must come from the new
shared-row/removal assertions (and the intentionally inverted old removal
expectations), not from a syntax or module-resolution error.

- [ ] **Step 4: Commit the failing test slice.**

```bash
git add test/client-surface.test.mjs
git commit -m "test(worktree): define shared group row contract"
```

### Task 2: Implement the shared row and preserve conditional removal UI

**Files:**

- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/worktree.css`

**Interfaces:**

- Consumes: `expandedMains`, `expandedWorktrees`, existing Session creation callbacks, existing Worktree health projection, and existing `treeActionSlot` CSS.
- Produces: one `WorktreeGroupRow` component used by Main and Worktree rows, with an optional Client-visible Worktree removal action.

- [ ] **Step 1: Define the shared row props and implement its minimal row shell.**

Extend the React import with `type ReactNode` and add the following types and
component where `MainSessionGroupRow` currently lives:

```tsx
type WorktreeGroupKind = 'main' | 'worktree';

interface WorktreeGroupRowProps {
  readonly kind: WorktreeGroupKind;
  readonly label: string;
  readonly expanded: boolean;
  readonly icon: ReactNode;
  readonly workspaceTitle: string;
  readonly state?: 'done' | 'warning' | 'error';
  readonly stateLabel?: string;
  readonly onToggle: () => void;
  readonly onCreateSession?: () => void;
}

function WorktreeGroupRow({
  kind,
  label,
  expanded,
  icon,
  workspaceTitle,
  state,
  stateLabel,
  onToggle,
  onCreateSession,
}: WorktreeGroupRowProps) {
  const main = kind === 'main';

  return (
    <div
      className={styles.worktreeRow}
      data-main-group={main || undefined}
      data-main-expanded={main ? expanded : undefined}
      onClick={onToggle}
    >
      <button
        type="button"
        className={`${styles.disclosureButton} ${styles.worktreeDisclosure}`}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        {expanded ? (
          <IconChevronDownOutline14 size={18} />
        ) : (
          <IconChevronRightOutline14 size={18} />
        )}
      </button>
      <span className={styles.worktreeIcon} aria-hidden="true">
        {icon}
      </span>
      {state !== undefined && stateLabel !== undefined && (
        <span className={styles.worktreeState} role="img" aria-label={stateLabel} title={stateLabel}>
          <StateDot state={state} />
        </span>
      )}
      <span className={styles.worktreeLabel}>{label}</span>
      <span className={styles.treeActionSlot}>
        {onCreateSession !== undefined && (
          <button
            type="button"
            className={styles.iconButton}
            data-add-main-session={main ? 'true' : undefined}
            data-add-session={main ? undefined : 'true'}
            aria-label={`Add Session to ${workspaceTitle}`}
            onClick={(event) => {
              event.stopPropagation();
              onCreateSession();
            }}
          >
            <IconPlusOutline16 />
          </button>
        )}
      </span>
    </div>
  );
}
```

This component must keep the remove menu behind an optional menu prop; it must
not introduce a Main-only class or separate Main label style.

- [ ] **Step 2: Remove the obsolete Main component and restore conditional Client removal state.**

Delete `MainSessionGroupRow` and retain these state variables in
`WorktreeSurface` for active Worktree removal:

```tsx
const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRecord>();
const [openWorktreeMenuId, setOpenWorktreeMenuId] = useState<string>();
```

Keep the inline behavior in the shared `WorktreeGroupRow` menu prop,
`data-worktree-menu`, the `setOpenWorktreeMenuId` calls, and the final
`worktreeRemoval` `<Modal>`. Pass the menu only when `record.status ===
'active'`; Main and detached rows omit it.

- [ ] **Step 3: Render Main through the shared component.**

Replace the `MainSessionGroupRow` call with:

```tsx
<WorktreeGroupRow
  kind="main"
  label="Main"
  expanded={mainExpanded}
  icon={<IconBranchOutline16 />}
  workspaceTitle={workspace.title}
  onToggle={() => {
    toggleMain(workspace.workspaceId);
  }}
  onCreateSession={
    createMainSession === undefined
      ? undefined
      : () => {
          createMainSession(workspace.workspaceId);
        }
  }
/>
```

Keep the existing `mainExpanded && <WorktreeSessionGroup ... />` condition and
all Main Session callbacks unchanged.

- [ ] **Step 4: Render every Worktree through the shared component.**

Inside the existing `worktrees.map`, keep the outer `worktreeGroup` wrapper and
the health calculation, then replace the inline row with:

```tsx
<WorktreeGroupRow
  kind="worktree"
  label={record.branch}
  expanded={worktreeExpanded}
  icon={<IconBranchOutline16 />}
  workspaceTitle={workspace.title}
  state={state}
  stateLabel={stateLabel}
  onToggle={() => {
    toggleWorktree(record.worktreeId);
  }}
  onCreateSession={
    record.status === 'active'
      ? () => {
          void createSession({
            workspaceId: record.workspaceId,
            worktreeId: record.worktreeId,
            cwd: record.absolutePath,
          });
        }
      : undefined
  }
  menu={
    record.status === 'active'
      ? {
          open: openWorktreeMenuId === record.worktreeId,
          label: record.branch,
          disabled: actionPending,
          onOpenChange: (open) => {
            setOpenWorktreeMenuId(open ? record.worktreeId : undefined);
          },
          onRemove: () => {
            setWorktreeRemoval(record);
            setActionError(undefined);
          },
        }
      : undefined
  }
/>
```

Keep the existing `worktreeExpanded && <WorktreeSessionGroup ... />` block and
its Session ordering/navigation callbacks unchanged. Detached rows therefore
retain their health display but do not receive a `+` button or remove menu.

- [ ] **Step 5: Remove Main-only CSS and retain menu-open Worktree CSS.**

Keep the shared Worktree row rules and keep the disclosure/icon hidden at rest,
while also pinning the menu-open row state:

```css
.worktreeRow .worktreeDisclosure {
  display: none;
}

.worktreeRow:hover .worktreeDisclosure,
.worktreeRow[data-menu-open='true'] .worktreeDisclosure {
  display: inline-flex;
}

.worktreeRow:hover .worktreeIcon,
.worktreeRow[data-menu-open='true'] .worktreeIcon {
  display: none;
}
```

Delete the `.mainRow`, `.mainLabel`, and `.mainDisclosure` blocks. Remove the
only-dead branches, but keep `.worktreeRow[data-menu-open='true']` and
`.worktreeRow:hover .menuAction` so active Worktree menus remain visible. Keep
the equivalent Workspace menu visibility and Session row menu behavior.
`treeActionSlot` owns the shared rail.

- [ ] **Step 6: Run the focused tests and verify GREEN.**

Run:

```bash
pnpm exec node --test test/client-surface.test.mjs
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
```

Expected: the Client surface test file exits with all tests passing and
TypeScript exits with code 0. If a failure is caused by an assertion that no
longer matches the exact shared component markup, update the test to assert the
public row contract rather than restoring duplicate markup.

- [ ] **Step 7: Commit the implementation slice.**

```bash
git add src/client/WorktreeSurface.tsx src/client/worktree.css
git commit -m "refactor(worktree): share main and worktree group rows"
```

### Task 3: Update behavior records and run package verification

**Files:**

- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/README.md`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/README.md`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-21-worktree-tree-parity-implementation.md`
- Verify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/docs/superpowers/specs/2026-08-21-worktree-main-shared-row-design.md`

**Interfaces:**

- Consumes: the completed shared Client row and passing focused tests.
- Produces: documentation that accurately describes the available Worktree actions and a verified package state.

- [ ] **Step 1: Update the package README action list and native-parity note.**

In `README.md`, document that active Worktree rows expose the removal menu while
Main and detached rows do not:

```md
5. 观察 Worktree 的 ready、repair 或 detached 状态；active Worktree 的选项菜单提供 Remove Worktree 入口，Main 和 detached Worktree 不显示该选项。
```

Replace the existing Main-only removal sentence with a shared-row note:

```md
Main and Worktree groups share one parameterized split-row presentation. Main
uses the same branch/tree icon and aligned action rail as Worktree, but does not
receive the optional Worktree menu. Active Worktree rows retain the remove menu
and confirmation dialog; detached bindings remain visible and the underlying
Manager contract is unchanged.
```

- [ ] **Step 2: Update the browser Client README.**

Change the Client description so it says Worktree creation and active Worktree
removal go through the injected Manager. Add the shared-row behavior next to the
existing trailing-action-rail note:

```md
The Main and Worktree group rows use one parameterized row component. Main uses
the branch/tree icon, keeps its native DSH `+` Session action, and has no
removal menu. Active Worktree rows add the health dot, Worktree Session `+`, and
the remove menu/confirmation flow; detached rows remain read-only. The
Manager/API contract remains unchanged.
```

- [ ] **Step 3: Record the follow-up in the tree-parity plan.**

Add a dated follow-up near the top of
`docs/superpowers/plans/2026-08-21-worktree-tree-parity-implementation.md`:

```md
> **Follow-up (2026-08-22):** Main and Worktree group rows now share one
> parameterized `WorktreeGroupRow`. Main uses the branch/tree icon and the same
> action rail; active Worktree rows pass the optional remove menu and Main and
> detached rows omit it. The Manager/API removal contract remains unchanged.
```

- [ ] **Step 4: Run the complete package verification.**

Run from the repository root:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
git diff --check
git status --short --branch
```

Expected: build exits 0, the package test command reports zero failures,
`git diff --check` emits no whitespace errors, and `git status` contains only
the intentional source/test/documentation changes plus no tracked generated
artifacts.

- [ ] **Step 5: Commit the documentation and verification slice.**

```bash
git add README.md src/client/README.md docs/superpowers/plans/2026-08-21-worktree-tree-parity-implementation.md
git commit -m "docs(worktree): record shared row and conditional removal UI"
```
