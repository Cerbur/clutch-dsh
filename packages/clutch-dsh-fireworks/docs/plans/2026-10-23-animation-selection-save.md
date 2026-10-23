# Fix selection-only saves

Historical regression record. Save/preview-gate behavior below is superseded by
[immediate settings](2026-10-23-immediate-animation-settings.md).

## Reproduction and cause

Choosing a previously saved custom animation left Save disabled. The settings
component required `validated === selected.id` for every custom selection and
cleared that value on each selection. Saved source was never recognized as
reusable, and switching away from a successfully previewed draft lost its result.
The disabled button had no explanation for an otherwise valid saved selection.

The regression runs the actual browser bundle's settings component and event
handlers. Before the fix, `node --test test/animation-settings.test.mjs` failed
with `保存动画设置 must be enabled` for both saved selections and validated drafts
switched away and back. After the fix, both scenarios pass.

## Behavior

- Saved custom templates can be selected and saved directly, including after
  refresh or Host restart.
- Validation is attached to script id and exact source. A successful full
  preview survives switching; incomplete, stopped, failed, or stale callbacks
  cannot validate an import. Every new/changed script in a draft must pass,
  including unselected imports, and the page names pending scripts.
- A revision-only conflict may retry once after a fresh load confirms identical
  saved selection and script bytes. A real concurrent edit, a file warning,
  readonly state, or another conflict is refused. The Host revision check remains.
- Component-level regressions now cover the user interaction that the previous
  renderer and Host-only tests could not catch. No renderer rewrite is needed.

## Real 3088 regression

Environment: DSH 0.2.1-rc.2, `DSH_HOME=~/.dsh-test`, same feature worktree.
Each round used a distinct 65,536-byte script, imported through the file chooser.

| Check                                                                     | Before restart (A) | After real Host restart (B) |
| ------------------------------------------------------------------------- | ------------------ | --------------------------- |
| Upload and visible validation requirement                                 | Passed             | Passed with a new file      |
| Complete preview                                                          | Passed             | Passed                      |
| Switch away/back without losing validation, then save                     | Passed             | Passed                      |
| Exact file bytes, `0600`, relative-only configuration                     | Passed             | Passed                      |
| Saved custom → built-in → uploaded custom, saving each without re-preview | Passed             | Passed                      |
| Refresh restores chosen template                                          | Passed             | Passed                      |
| Real background `happy_fireworks` uses selected uploaded script           | Passed             | Passed                      |
| Toast opens the originating Session                                       | Passed             | Passed                      |

The restart also restored A's selected state before B was imported. Additional
negative coverage imported a script throwing during render: preview failed,
Save remained disabled even after selecting a built-in, and Discard removed
the draft. Test references were removed afterward and the original Aurora
selection and two custom scripts were restored; files remain retained by design.

Commands: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, scoped
`pnpm exec prettier --check ...`, `git diff --check`, and root
`pnpm run check:workspace` / `pnpm run check:patches`.

Final results: build and all 82 tests passed; typecheck, lint, scoped formatting,
whitespace, workspace and patch checks passed. Patch validation retains the
existing unrelated YAML `!!js dshHomePath()` warning. The final parsed test
profile exactly equals the profile captured before these two rounds, including
all unrelated fields. A final selection of Canvas Show again confirmed Save
enabled without preview; the unsaved selection was then discarded.
