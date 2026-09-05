# Template manager implementation plan

**Goal:** Manage title templates in DSH settings with safe external-edit recovery.

**Architecture:** Separate template decoding/validation from settings storage, runtime
provider dispatch, and the settings page. Use native settings revision fencing and
the existing native first-prompt LLM function for disabled customization.

**Tech Stack:** TypeScript, React, Schemastery, YAML, DSH settings and slots.

**Spec:** ../specs/2026-09-06-template-manager-design.md

## Constraints

- Work only in `wt-title-0.1.1/feat-template-manager`; no commit/publish/merge.
- Default is immutable; invalid active template falls back to default.
- Preserve external invalid entries and unsaved browser drafts.
- Persist through DSH settings, not browser storage.

## Tasks

- [x] Add `src/templates.ts` and `test/templates.test.mjs`: decode unknown settings,
      validate YAML via resolveTitleConfig, reject reserved IDs/default mutation, and
      resolve missing/invalid active templates to default. Test malformed YAML, invalid
      field references, invalid types, external default override, and disabled state.
- [x] Add settings/runtime integration in `src/index.ts` and a settings adapter:
      register namespace, read raw document snapshots, dispatch native/custom generation.
      Test cold-start invalid settings and external valid-to-invalid transitions.
- [x] Add `src/client/entry.ts`, template page and browser build. Use settings.section,
      localized navigation and UI primitives. Validate before save, fence writes by the
      loaded revision, display per-template errors, disallow invalid activation, and
      preserve drafts on invalidation. Test mutation payloads and stale draft refusal.
- [x] Update both READMEs, screenshot and package/browser exports. Run package
      typecheck, build, tests, lint, formatting, workspace/patch checks and diff checks.
      Record actual outcomes and unresolved environmental limitations here.

## Verification — 2026-09-06

- `pnpm run check` passed: workspace structure, Cordis patches, repository formatting,
  lint, all package typechecks and all workspace tests. Title has 56 passing tests.
- `pnpm --filter @cerbur/clutch-dsh-title build` and the package test command were
  also exercised independently during implementation.
- Native FileSettingsProvider tests cover persistence, unrelated namespace/comment
  preservation, watcher reload, observed-revision conflict, invalid-template repair,
  inherited legacy creation/deletion and an explicit empty templates map.
- Browser bundle VM test executes the published loader closure with only browser
  shared modules and verifies settings.section registration. YAML is explicitly
  bundled from its browser entry to avoid Node process/buffer dependencies.
- Playwright exercised the real React page and DSH primitives in the isolated
  `node test/browser-preview.mjs` harness: CRUD, Chinese names, activation, disabled
  generation, invalid-save rejection, immutable default, external invalidation,
  draft preservation, repair and deletion fallback. The documentation screenshot
  is from this harness; no live user settings or sessions were changed.
- Independent review found inherited-map mutation problems; regression tests
  reproduced them before the fix. Follow-up review found no material issues.
- `git diff --check` passed. No commit, merge, publish or version bump performed.

The DSH file provider checks expectedRevision before its persistence-time disk
reconciliation. An external edit not yet observed by the watcher therefore has
a race window; do not claim cross-process compare-and-swap. This upstream limit
is documented in both READMEs. A malformed entire YAML document is likewise
handled by DSH's last-readable-document policy. Template-level invalid data is
retained for repair and never selected for generation.
