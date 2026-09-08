# Short generated Worktree names

Scope: `wt-worktree-0.1.10/feat-shorten-worktree-name`.

The original creation plan's full UUID directory name is replaced for new records only.
Default names use `wt_` plus six cryptographically random bytes encoded as twelve lowercase
hex characters (48 random bits; fifteen characters total). Existing IDs, paths, bindings,
external imports, and sidecar schema remain compatible.

Manage retries only a Provider-owned pre-mutation collision signal. Eight random candidates
are followed by increasing numeric suffixes; even a repeating injected ID factory makes
progress. The Manager lifecycle abort signal stops retries. Branch, filesystem permission,
Git execution, journal, and recovery failures are never mistaken for name collisions.

Provider checks filesystem entries with lstat, sidecar IDs/paths including retained records,
and Git registrations including missing/prunable paths. Missing paths are compared through
their physical parents to handle macOS /var and /private/var aliases. A per-candidate
cross-process lock precedes the existing shard/repository locks and remains held through
Git verification/publication, covering concurrent repositories sharing the managed root.
External filesystem changes after preflight retain the existing conservative recovery policy.
Legacy injected sidecars receive the same preflight but retain their original concurrency contract.

Validation:

- Real Git tests: short default name, occupied file/directory, dangling symlink, stale
  registration, retained sidecar ID, repeated randomness, occupied suffixes, concurrent
  managers/Workspace shards, and ordinary Git failure without retry.
- Run workspace/patch checks, package typecheck/build/test, and inspect the final diff.
- Synchronize English and Chinese README creation behavior.

No version bump, commit, merge, or publication is included in this implementation task.

## Verification result

- `pnpm install --offline --frozen-lockfile`: installed the existing locked dependencies.
- `pnpm run check:workspace` and `pnpm run check:patches`: passed (the existing YAML
  `!!js` tag warning remains non-fatal).
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck` and
  `pnpm --filter @cerbur/clutch-dsh-worktree build`: passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree test`: passed all 538 tests before the
  last two boundary cases were added; its Remote contract compilation also passed.
- After the final build, `node --test test/*.test.mjs`: passed all 540 tests,
  including retained path aliases and Manager cancellation.
- ESLint on changed TypeScript files, Prettier on the new files, and
  `git diff --check`: passed.
