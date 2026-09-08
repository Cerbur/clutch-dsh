# Client and Provider source module refactor

## Scope

Work directly in the user-selected `wt-worktree-0.1.10/release` checkout.
The initial checkout is clean at `119d8d5`. The current Surface has 2928 lines and
the transaction implementation has 1493 lines. Preserve current release behavior,
including archive, cleanup, forget, branch adoption, current Session reveal, scoped
refresh, and permission retry. No new features or package/version changes.

This task supersedes the older source optimization plan's requirement to keep all
Surface state and mutation callbacks in one file. Cohesive internal modules now
own those responsibilities. Historical version/release steps do not apply here.
No superpowers skills are used, as explicitly requested by the user.

## Boundaries

- Keep existing entrypoints and exported types compatible.
- Split Surface subscriptions/refresh, presentation state, operation handlers,
  and view composition by ownership; keep React hook order and async guards.
- Split transaction operations from shared locked context, validation, snapshot
  publication and recovery; preserve lock lifetime and durable operation ordering.
- Keep the current single plugin package, Remote protocol, sidecar schema,
  native DSH data boundaries and browser membership projection unchanged.
- Check nested relative imports against resolved module paths, so deeper folders
  cannot bypass Client/Provider dependency restrictions.

## Baseline

`pnpm --filter @cerbur/clutch-dsh-worktree test` passed all 509 tests, including
the package build and Remote contract compilation, before implementation edits.

## Completion evidence

Provider operations now delegate through `transaction/index.ts`. Locking,
admission, path safety, inspection, journal construction, publication and failure
reconciliation are separate modules; dependencies contain only runtime resources.
The shared recovery blocker indexes Worktree records once and uses short-circuit
admission, reducing repeated lookup work from O(issues × worktrees) to
O(issues + worktrees). Ten characterization cases preserve legacy observation
retirement and real recovery blocking.

Client composition now uses grouped hook results for source subscriptions,
refresh, expansion, ordering, native actions, drag, registration, Session actions
and lifecycle actions. Active and archived Worktree rendering are separate
components. Types, selectors, rows and dialogs live under `surface/`, with old
module paths forwarding their existing exports.

Independent source review compared callback bodies, effect dependencies, JSX
wiring, transaction operation bodies and lock/publication ordering against HEAD.
No semantic regression was found.

The nested Client modules exposed a build-path bug: the CSS loader assumed every
importer lived directly under `lib/client`. The loader now resolves the emitted
CSS path and mirrors its path under `lib` into `src`. A regression covers direct,
nested, deeply nested and colocated CSS imports plus existing emitted CSS priority.

Final verification:

- `pnpm --filter @cerbur/clutch-dsh-worktree test`: 522/522 passed, including build
  and Remote contract compilation (baseline: 509/509).
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`: passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`: passed.
- `pnpm exec eslint scripts/build-client.mjs scripts/client-css-path.mjs`: passed.
- `pnpm run check:workspace`: passed.
- `pnpm run check:patches`: passed with the baseline YAML `!!js` warning.
- Targeted Prettier checks for the facade, new Client/Provider modules, build
  scripts and new tests: passed.
- `git diff --check`: passed.

The Surface facade is 111 lines; the transaction facade is 63 lines behind the
two-line compatibility entrypoint. No new implementation file exceeds 800 lines.
The Client bundle increased from 67.51 kB to 71.42 kB gzip with the explicit
module composition. No extra Git/Connection reads were introduced. No live DSH
browser acceptance or runtime performance benchmark was performed.

No commit, push, publish, or real user Worktree lifecycle operation is part of this task.
