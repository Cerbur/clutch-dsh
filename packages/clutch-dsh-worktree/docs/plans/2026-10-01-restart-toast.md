# Worktree Host restart reminder

The historical bootstrap and Connection plans remain unchanged. This follow-up adopts the
Session Title restart reminder for Worktree while preserving the existing browser boundary.

- Check Host composition asynchronously on Client load and `connection/reset`, using only the
  existing adapter and `listBindings` read endpoint with an empty Workspace identity. An outer
  Gateway success, including an inner `WORKSPACE_NOT_FOUND`, establishes that the Host loaded.
- Show the DSH native `Toast` in an independent `shell.overlay` slot only for
  `gateway/service-unavailable`, `gateway/definition-unavailable`, or
  `gateway/invocation-unavailable`. Remind once per Client fiber to restart Desktop, or restart
  the Web server and refresh the page. Hold the toast for eight seconds.
- Abort superseded probes and probes exceeding five seconds; ignore late responses after
  replacement, timeout, or disposal. Network, argument, method, and domain errors stay quiet.
- Keep existing ready content, refresh scopes, DSH-owned data, Sidecar facts, Host contracts,
  and the Connection transport graph unchanged. No generated Remote import is required.
- Synchronize English/Chinese installation guidance and the Client boundary documentation.

## Verification

- `pnpm install --offline --frozen-lockfile --ignore-scripts` prepared the feature worktree
  without changing the lockfile.
- `pnpm run check:workspace` and `pnpm run check:patches` passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`, `build`, and `lint` passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree test` passed all 736 tests, including the five new
  reminder tests and the existing Client composition, refresh, and disposal regression coverage.
- `node --test test/dsh-composition.test.mjs test/readme-parity.test.mjs` passed all nine tests
  after adding real Gateway coverage for the empty-identity probe. The composed Host returns an
  outer success and inner `WORKSPACE_NOT_FOUND`, with no additional Git subprocess calls.
- The package remains excluded from the repository's Prettier gate. The newly added source,
  component, test, and plan were separately checked with `--ignore-path /dev/null`.
- `git diff --check` passed. No commit, merge, publish, or DSH core changes were made.

The actual Desktop/Web installation UI has not been manually verified.
