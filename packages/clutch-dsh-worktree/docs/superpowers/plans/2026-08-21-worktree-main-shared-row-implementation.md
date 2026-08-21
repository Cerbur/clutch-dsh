# Worktree/Main Shared Group Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Client tree so Main and Worktree groups use one parameterized row component, Main shows the branch/tree icon, and the Worktree surface no longer exposes removal.

**Architecture:** `WorktreeGroupRow` will own the shared row shell, disclosure button, leading icon, optional health dot, label, and fixed action rail. `WorktreeSurface` will keep Main and Worktree expansion/session state and pass row-specific callbacks and data. The UI removal path is deleted from the Client only; `WorktreeManager.removeWorktree` and its Remote/API contract remain unchanged.

**Tech Stack:** React 18, TypeScript, CSS Modules, DSH client UI primitives, Node test runner, pnpm workspace.

## Global Constraints

- Do not modify DSH source or native DSH package implementations.
- Keep DSH as the source of truth for Workspace and Session data.
- Keep Main and Worktree expansion state independent: `expandedMains` and `expandedWorktrees` remain separate browser-local state.
- Main and Worktree group rows must use the shared `worktreeRow`, `worktreeIcon`, `worktreeLabel`, `worktreeDisclosure`, and `treeActionSlot` styles.
- Main must render `IconBranchOutline16` in the same leading icon slot as Worktree.
- The Client surface must not render a Worktree remove menu, remove confirmation dialog, remove UI label, or remove-specific React state.
- Keep `WorktreeManager.removeWorktree`, the Remote method, Provider implementation, detached binding lifecycle, and all non-Client removal tests unchanged.
- Use `apply_patch` for local source, test, documentation, and plan edits.
- Run each focused test after its RED/GREEN change; do not write production code before observing the new test fail.
- Do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures to Git.

## File Map

- `src/client/WorktreeSurface.tsx` — replace `MainSessionGroupRow` and the inline Worktree row with the shared `WorktreeGroupRow`; remove Client-only Worktree removal state, menu, and modal.
- `src/client/worktree.css` — make Main use the existing Worktree row styles and remove Main-only and Worktree-menu-only rules that become dead after the refactor.
- `test/client-surface.test.mjs` — add RED assertions for one shared row, Main's tree icon, independent expansion/add-session behavior, and the absence of Worktree removal UI; update stale removal expectations.
- `README.md` — document that the Worktree surface no longer exposes removal while retaining detached-state behavior.
- `src/client/README.md` — document the Client action boundary and shared row presentation.
- `docs/superpowers/plans/2026-08-21-worktree-tree-parity-implementation.md` — record the follow-up consolidation and removal-UI decision.

---

### Task 1: Add failing Client surface regression tests

**Files:**

- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces:**

- Consumes: the current `WorktreeSurface.tsx` and `worktree.css` source text.
- Produces: source/CSS assertions that define the approved shared-row and disabled-removal contract before production code changes.

- [ ] **Step 1: Replace stale removal expectations with the new failing contract.**

In the existing hierarchy test, replace the assertion that requires
`Remove Worktree` with an assertion that rejects the same label. In the native
menu test, replace the `Remove Worktree` and `data-worktree-menu` requirements
with negative assertions. In the Modal test, rename it to cover the Worktree
creation dialog only and remove the assertion for `worktreeRemoval`:

```js
test('uses the DSH Modal primitive for the Worktree create dialog', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /open=\{worktreeModalWorkspaceId !== undefined/);
  assert.doesNotMatch(source, /worktreeRemoval|Remove Worktree/);
  assert.doesNotMatch(source, /styles\.modalBackdrop/);
});
```

Keep the existing Session/Workspace `Menu` and `Modal` assertions; only remove
the expectations for the Worktree removal path.

- [ ] **Step 2: Add the shared-row and Main icon regression test.**

Append this focused test to `test/client-surface.test.mjs`:

```js
test('shares one parameterized group row between Main and Worktree without removal UI', async () => {
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
  assert.doesNotMatch(source, /worktreeRemoval|openWorktreeMenuId|data-worktree-menu/);
  assert.doesNotMatch(source, /Remove Worktree/);
  assert.doesNotMatch(styles, /\.mainRow|\.mainLabel|\.mainDisclosure/);
});
```

The current source must fail this test because it still defines
`MainSessionGroupRow`, does not pass a Main icon, and contains the Worktree
remove menu/modal and Main-only CSS selectors.

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

### Task 2: Implement the shared row and remove the Client removal path

**Files:**

- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/worktree.css`

**Interfaces:**

- Consumes: `expandedMains`, `expandedWorktrees`, existing Session creation callbacks, existing Worktree health projection, and existing `treeActionSlot` CSS.
- Produces: one `WorktreeGroupRow` component used by Main and Worktree rows, with no Client-visible Worktree removal action.

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

This component must not contain a remove menu, removal callback, Main-only
class, or separate Main label style.

- [ ] **Step 2: Remove the obsolete Main component and Client removal state.**

Delete `MainSessionGroupRow` and remove these state variables from
`WorktreeSurface`:

```tsx
const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRecord>();
const [openWorktreeMenuId, setOpenWorktreeMenuId] = useState<string>();
```

Remove the inline Worktree menu, `data-worktree-menu`, all calls to
`setOpenWorktreeMenuId`, and the final `worktreeRemoval` `<Modal>`. Do not remove
`WorktreeRecord` from imports if it remains needed by `ReadState` or another
existing type; do remove it only if the compiler proves there are no remaining
uses.

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
/>
```

Keep the existing `worktreeExpanded && <WorktreeSessionGroup ... />` block and
its Session ordering/navigation callbacks unchanged. Detached rows therefore
retain their health display but do not receive a `+` button.

- [ ] **Step 5: Remove Main-only and dead Worktree-menu CSS.**

Keep the shared Worktree row rules and change the Worktree hover rules to use
hover only:

```css
.worktreeRow .worktreeDisclosure {
  display: none;
}

.worktreeRow:hover .worktreeDisclosure {
  display: inline-flex;
}

.worktreeRow:hover .worktreeIcon {
  display: none;
}
```

Delete the `.mainRow`, `.mainLabel`, and `.mainDisclosure` blocks. Remove the
`.worktreeRow[data-menu-open='true']` and `.worktreeRow:hover .menuAction`
branches that only supported the deleted Worktree menu. Keep the equivalent
Workspace menu visibility and Session row menu behavior. Remove
`.worktreeActions` from the action-visibility selector; `treeActionSlot` now
owns the shared rail.

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

In `README.md`, replace the installation walkthrough's Worktree deletion step
with a read-only status step:

```md
6. 查看 Worktree 的 ready、repair 和 detached 状态；当前 Worktree surface 不提供 Remove Worktree 入口。
```

Replace the existing Main-only removal sentence with a shared-row note:

```md
Main and Worktree groups share one parameterized split-row presentation. Main
uses the same branch/tree icon and aligned action rail as Worktree. The Client
surface intentionally does not expose Worktree removal; detached bindings
remain visible and the underlying Manager contract is unchanged.
```

- [ ] **Step 2: Update the browser Client README.**

Change the Client description so it says Worktree creation goes through the
injected Manager but the surface does not expose removal. Add the shared-row
behavior next to the existing trailing-action-rail note:

```md
The Main and Worktree group rows use one parameterized row component. Main uses
the branch/tree icon, keeps its native DSH `+` Session action, and has no
health-dot or removal menu. Active Worktree rows add the health dot and Worktree
Session `+`; detached rows remain read-only. The Client surface does not expose
Worktree removal, while the Manager/API contract remains available to other
controlled consumers.
```

- [ ] **Step 3: Record the follow-up in the tree-parity plan.**

Add a dated follow-up near the top of
`docs/superpowers/plans/2026-08-21-worktree-tree-parity-implementation.md`:

```md
> **Follow-up (2026-08-21):** Main and Worktree group rows now share one
> parameterized `WorktreeGroupRow`. Main uses the branch/tree icon and the same
> action rail; Worktree removal is intentionally not exposed by the Client
> surface. The Manager/API removal contract remains unchanged.
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
git commit -m "docs(worktree): record shared row and disabled removal UI"
```
