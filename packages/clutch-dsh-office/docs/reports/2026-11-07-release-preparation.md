# Office release preparation · 2026-11-07

Candidate: `@cerbur/clutch-dsh-office@0.1.1` on `wt-office-0.1.1/release`,
baseline `01a5cc5`. Local `main` is an ancestor; the selected character optimization
and stepping-turn commits are already merged. The worktree was clean before preparation.

## Candidate changes

- Bump the package using `npm version patch --no-git-tag-version`.
- Add bilingual release notes from the selected commit history.
- Remove obsolete first-release notices in both READMEs, align their formatting,
  describe the shared Session dashboard in npm metadata, and correct the package's
  release parameters to the current feature naming and four-character limit.
- Preserve all runtime source, model, layout and lighting bytes during preparation.

## Completed checks

Commands ran from this release worktree (Office commands from its package unless noted):

| Check                                                                                                                   | Result                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Official registry `npm view @cerbur/clutch-dsh-office versions dist-tags --json --registry=https://registry.npmjs.org/` | Only 0.1.0 published; latest 0.1.0 at preparation time                         |
| `pnpm --filter @cerbur/clutch-dsh-office build`                                                                         | Passed; browser bundle 2,258,434 bytes, below 3 MiB                            |
| `pnpm --filter @cerbur/clutch-dsh-office lint`                                                                          | Passed, including source, scripts and tests                                    |
| `pnpm --filter @cerbur/clutch-dsh-office typecheck`                                                                     | Passed independently after recursive checks aborted                            |
| `pnpm exec tsc -p packages/clutch-dsh-office/test/tsconfig.character-turn.json` (root)                                  | Passed                                                                         |
| `OFFICE_ASSET_LIBRARY=/Users/yuancheng/Documents/blender/office node --test --test-concurrency=1 test/*.test.mjs`       | 358 passed, zero failed/skipped; 292.7 seconds                                 |
| `node --test scripts/*.test.mjs` (root)                                                                                 | 57 passed, zero failed/skipped                                                 |
| Workspace shape, patch validation and full-workspace formatting (within `pnpm run check`)                               | Passed; existing YAML `!!js` warning retained                                  |
| `npm pack --dry-run --json` and actual `npm pack --json --pack-destination /tmp/office-release-0.1.1`                   | Passed; 363 entries, 46,795,921 compressed / 53,196,352 unpacked bytes         |
| Temporary DSH-profile installation of the actual tarball                                                                | Passed with DSH 0.2.2-rc.1; installer reported peer-dependency warning         |
| Installed-package Host registration, GET routes and resource integrity                                                  | All 31 indexed resources passed size/SHA-256/response checks; includes 29 GLBs |
| Installed-package client module registration, injected version, exports and README images                               | Passed; DSH/React factory registration checked without executing a browser     |
| `git diff --check`                                                                                                      | Passed                                                                         |

## Workspace checks that remain unsuccessful

`pnpm run check` stops at three pre-existing lint errors outside Office:

- `packages/clutch-dsh-title/test/prepared-call.test.mjs:40`: undefined `AbortController`.
- `packages/clutch-dsh-title/test/remote-client.test.mjs:36`: undefined `AbortController`.
- `scripts/dsh-web-manager/test/upgrade.test.mjs:1`: unused `process` import.

A separate `pnpm run typecheck` stops on existing Fireworks `TS2742` at
`packages/clutch-dsh-fireworks/src/index.ts:29`, concerning the inferred `Config`
type's reference to the pnpm schemastery path. pnpm then terminates sibling tasks;
Office's independent typecheck subsequently passed. No unrelated files were changed.
The full workspace check is **not green**; Office-specific checks above are green.

## Artifact and isolated install

Artifact: `/tmp/office-release-0.1.1/cerbur-clutch-dsh-office-0.1.1.tgz`.
SHA-1: `bd67b4505e7bf46759f3f7552b356a8e9d7cb1f9`.

```bash
DSH_HOME=/tmp/office-release-0.1.1/dsh-home dsh plugin --profile web add /tmp/office-release-0.1.1/cerbur-clutch-dsh-office-0.1.1.tgz
node /tmp/office-release-0.1.1/verify-packed.mjs
```

The isolated profile is under `/tmp/office-release-0.1.1/dsh-home`. Existing user
profiles and services were not changed. This round did not run a browser, create
model tasks or repeat native sidebar/navigation/rendering checks. The earlier
real test-profile rendering evidence is recorded in `docs/CHARACTER-TURNING.md`;
it is prior evidence, not a browser test of this new tarball. Final visual approval
remains with the user.

Local logs: `/tmp/office-0.1.1-{build,check,tests,workspace-scripts}.log`,
plus `/tmp/office-release-0.1.1/{pack-dry-run.json,pack.json,install.log,verification.json}`.
Temporary files are local evidence, not durable repository assets.

## Manual publication handoff

After the release-preparation commit is authorized, publish manually from this
release worktree's Office package:

```bash
npm publish --access public --registry=https://registry.npmjs.org/
```

After publication, verify the exact version on the official registry before the
separately authorized merge to main, annotated `office-release-0.1.1` tag and push.
No publication, push, main merge or tag creation was performed during preparation.
