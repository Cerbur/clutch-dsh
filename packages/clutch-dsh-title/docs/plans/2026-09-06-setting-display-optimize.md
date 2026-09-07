# Settings display optimization

Worktree: `wt-title-0.1.2/feat-setting-display-optimize`.

This extends the existing template-manager plan. The user confirmed an editable
`emoji` preset with `default` still selected, and duplication into a named draft.
No superpowers skills were used.

- Provide the requested emoji YAML through the native settings base for fresh
  settings. Existing stored maps and legacy Cordis overrides take precedence.
  Saving a template mutation materializes the inherited map in settings.yaml;
  removing emoji remains effective after a fresh settings registration.
- Duplicate any saved row (including default and invalid rows) into a create
  draft. Existing validation and revision fencing apply; save does not activate.
- Add a title example to each clutch-title-identity, using the existing compiler
  and renderer. Use a stable page timestamp, timezone-aware formatting, literal
  values, the first enum choice and localized sample text. Invalid drafts show
  an unavailable message. Preview never calls the model or reads session data.
- Update both public READMEs and the isolated harness screenshot.

Verification:

- `pnpm install --offline --frozen-lockfile` completed.
- `pnpm --filter @cerbur/clutch-dsh-title test` passed all 63 tests, including
  package build and browser-bundle loading.
- Package `typecheck` and `lint`, root `check:workspace` and `check:patches`,
  package Prettier check and `git diff --check` passed. Patch validation emits
  the existing unresolved `!!js` tag warning.
- Browser QA in `node test/browser-preview.mjs` confirmed emoji duplication,
  save without activation, live preview changes, invalid preview/save rejection,
  and Chinese/English 390px layouts with no horizontal overflow. Desktop and
  mobile dark layouts were inspected; screenshot is from the isolated harness.

No version change, commit, merge or publish is included.

## Schema-default correction — 2026-09-07

The real Cordis schema materializes omitted fields as an empty dictionary.
The original undefined-only check incorrectly treated fresh installation as a
legacy override and omitted emoji. Only an explicit template or non-empty fields
now enters the legacy branch. The fresh-settings persistence regression runs
through TitleConfigSchema, matching the actual plugin loading path.
