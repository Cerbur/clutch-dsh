# Sidebar scroll contract repair

Date: 2026-11-13. Branch: `wt-worktree/feat-sidebar-scroll-contract`.
Feature-only change; no version bump, release log, push or publication.
This supplements the earlier [rc.2 compatibility record](2026-11-13-dsh-022-rc2-compatibility.md).

## Verified contract and reproduction

The local upstream checkout reports DSH `0.2.2-rc.2`, commit
`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`. Its Sidebar sources and Workspace
layout match the installed rc.2 packages. Relevant upstream files:

- `packages/client/ui-sidebar/src/client/contract/slots.ts:151`: public
  `useSectionScroller()` returns the identity-stable `bindScrollerRef` capability.
- `packages/client/ui-sidebar/src/client/scroll-handoff.ts:54`: the outer viewport
  consumes downward wheel distance first; the bound section consumes upward distance
  first. Binding null releases the section. Native scrolling handles eligible events.
- `packages/client/ui-sidebar/src/client/SidebarRoot.module.css:533`: bounded size
  container, then a scroll-state viewport. The viewport hides its own scrollbar;
  its grid returns the section to the Sidebar's 8px inline inset.
- `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.module.css:337`:
  the list extends to 2px inside the Sidebar edge. A stable 5px Chromium scrollbar
  gutter plus 1px padding returns rows to the 8px inset. The section is capped at
  `100cqh`; the native scroll-state query hides inner user scrolling while the outer
  viewport can still scroll down. The list clears the bottom fade with 16px padding.

The public hook and documented size/scroll-state requirements are the integration
contract. Exact inset values are rc.2 implementation facts, not a promise about
all future hosts. The plugin uses the inherited inline-padding variable with an
8px fallback, not native CSS module names or DOM ancestor discovery.

A minimal Chromium fixture loads the actual plugin CSS, installed native CSS and
native handoff implementation. At Sidebar width 280px, the unmodified plugin had
left/right insets **8/18px**, row width **254px**, and **zero scrollbar gutter**.
Native had **8/8px**, row width **264px**, and **5px gutter**. The right-edge
assertion failed with `18 !== 8`. Removing only the plugin content's 10px right
padding made the row edges agree, ruling out native grid width and OS scrollbar
occupation as the cause of this specific discrepancy.

## Implementation

At the user's direction, the final implementation follows native WorkspaceBrowser
scrolling rather than retaining a custom thumb with equivalent geometry. Keep the
existing hook binding and `100cqh` cap. With the hook, mark the actual scrollport
and do not mount `OverlayScrollbar`. Mirror native listArea's -4px left margin /
4px padding, right margin of `2px - --dsh-sidebar-inline-padding`, and right
padding of `--dsh-sidebar-inline-padding - --dsh-scrollbar-width - 2px`.
Use `scrollbar-gutter: stable` and inherit DSH's global scrollbar skin, hover
and quietBars tokens without overriding them. Put the native 16px bottom
clearance on the content wrapper. Seat and Surface allow the list extension;
the list owns clipping. The native scroll-state query hides inner user scrolling
until the outer viewport reaches the end. No nearer size or scroll-state
container is introduced. The existing custom scrollbar remains only in the
capability-free fallback.

Without the hook, the previous flex layout, clipping and 10px content inset stay
unchanged. This preserves the existing compatibility path; it does not lower the
public minimum DSH requirement (`0.2.2-rc.2`). No DSH core, native data, provider,
transport, refresh ownership or Session behavior changes.

## Regression and validation

`test/sidebar-workspace-slot.test.mjs` now runs the actual registry/React lifecycle
with and without the hook, covering the bound node, collapse, redeclaration,
withdrawal, disposal and retained Surface/Dashboard identity.

From the package directory, the browser regression command is:

```bash
DSH_NATIVE_SOURCE=/absolute/path/to/deepseek-harness PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/manual/sidebar-scroll-layout.mjs
```

It covers widths 200/280/400px with empty, two-row and 60-row contents, each with
3px and 5px scrollbar widths (18 scenarios). It loads the upstream scrollbar skin.
All share the native row edges, viewport height, padding and gutter; the native
scrollbar is 2px from the edge and is hit-testable rather than clipped. Gutter
stays stable across scroll-state changes and native quietBars hides the thumb
without changing geometry. The registry test verifies the native path never mounts
the custom scrollbar, while the fallback still does. A 220px wheel event splits into 138px
outer and 82px inner movement, then reverses to zero. Real browser wheel input
and keyboard End reach the inner list's end. No horizontal overflow appears.
The capability-free inset remains unchanged. Fixture screenshots were inspected;
they are layout fixtures, not screenshots of the running DSH product.

Required checks use `npx --yes pnpm@10.32.1`: `run check:workspace`,
`run check:patches`, and `--filter @cerbur/clutch-dsh-worktree` with `lint`,
`typecheck`, `build`, and `test`. README parity is also run separately with
`node --test test/readme-parity.test.mjs`. Structure, patch, lint, typecheck,
build, parity and browser checks pass. The default full test run passed 1,399,
failed 0 and skipped 20 optional external-source cases.

An additional run sets `DSH_NATIVE_SOURCE` to the rc.2 checkout and
`DSH_SCHEMA_ADAPTER_ANCHOR` to its `packages/llm/llm-pi-ai/package.json`.
An initial invocation put `TMPDIR` inside this Git checkout: three isolation
assertions failed because non-repository and missing-dependency fixtures inherited
this repository and its node_modules. No assertion or implementation was changed;
the corrected run puts `TMPDIR` in a fresh directory under `/tmp`. The final
full package command passed **1,423 tests, 0 failures, 0 skips**.
Final ESLint and `git diff --check` also pass. The patch validator emits the
existing `!!js` YAML tag warning but exits successfully.

## Real-app validation boundary

A new empty, isolated DSH Home was created under ignored `.playwright-cli/`, and
the feature plugin was installed there through the official local plugin command.
DSH rc.2 started on port 3091. Automatic approval blocked opening its freshly
generated local authentication URL, so the authenticated native/Worktree comparison
was **not performed**. The service was stopped and temporary preview launch files
removed. No existing profile, credentials, sessions or upstream source was changed.

Native Desktop glass, macOS/Windows scrollbar preferences, Firefox/Safari and
physical touch/trackpad behavior remain unverified. The isolated Chromium fixture
validates geometry, wheel handoff and keyboard scrolling, not those platforms.
Upstream documents native limitations too: touch may stop at the outer boundary;
browsers lacking scroll-state queries may scroll the section first. The existing
floating thumb fallback remains covered by its pointer/resize/disposal unit tests.
