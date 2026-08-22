# Worktree Local Branch Label Design

**Date:** 2026-08-22  
**Status:** Approved

## Goal

Replace the fixed Main group label in Worktree mode with a localized label that
identifies the Workspace's current local branch:

- English: `Local (branch-name)`
- Chinese: `本地（branch-name）`

When DSH does not return a branch marked as current, the label falls back to
`Local` or `本地`.

## Decisions

### Source of the current branch

The browser Consumer already receives `view.branches`, whose `isCurrent` flag
identifies the main Workspace branch. `WorktreeSurface` will derive the label
from the first branch matching `isCurrent` and will pass the resulting display
string to the existing parameterized `WorktreeGroupRow`.

No Host, Provider, Manager, Remote, RPC, or contract changes are needed. The
branch name remains DSH/Git data and is displayed without translation or other
normalization.

### Locale copy

The existing `worktree.main` key remains the no-branch fallback. A new
`worktree.mainWithBranch` key provides the parameterized label:

```text
zh: 本地（{branch}）
en: Local ({branch})
```

The Chinese full-width parentheses and English ASCII parentheses are intentional
and are covered by locale tests. The existing locale namespace and runtime
wiring remain unchanged.

### Typography and accessibility

Main keeps its existing stronger font weight, but the Main-only
`text-transform: uppercase` rule is removed so the localized label preserves
the requested casing and the branch's original spelling. The computed label is
also used by the existing expand/collapse accessible name through the shared
row component.

### Documentation

The browser Consumer README and package README will document that Main is shown
as the localized Local label with the current branch when available, otherwise
the localized fallback.

## Data flow

```text
Worktree view.branches
        │ find(branch.isCurrent)
        ▼
WorktreeSurface: t(mainWithBranch) / t(main fallback)
        │
        ▼
WorktreeGroupRow(label)
```

This remains a presentation-only transformation. It does not persist the label,
change Worktree/Session relationships, or alter the DSH Workspace and Session
source of truth.

## Regression coverage

Following the package's TDD convention, tests will be updated before production
code and will first fail against the current fixed Main implementation. The
focused Client tests will verify:

1. `WorktreeSurface` selects `isCurrent` and renders the parameterized label;
2. the no-current-branch path uses the localized fallback;
3. `zh` and `en` contain balanced keys and the exact branch placeholders and
   punctuation;
4. Main no longer applies uppercase transformation while retaining its weight;
5. existing Worktree row geometry, menus, accessibility, and full Client
   behavior remain unchanged.

The final verification remains the package typecheck, build, complete test
suite, and `git diff --check`.

## Scope

Expected implementation files:

- `src/client/WorktreeSurface.tsx`
- `src/client/locales.ts`
- `src/client/worktree.css`
- `test/client-surface.test.mjs`
- `test/client-locale.test.mjs`
- `src/client/README.md`
- `README.md`

This design supersedes only the previous UI-polish decision that forced the
Main label to uppercase; the row geometry, health spacing, and native hover-card
decisions in that work remain in force.
