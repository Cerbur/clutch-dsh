# Git Dependency Build Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:verification-before-completion before claiming completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@cerbur/clutch-dsh-worktree` build its generated `lib/` output during Git dependency installation while preserving the existing publish and client artifact build chain.

**Architecture:** Keep `build` as the single source of truth for TypeScript compilation, Typert generation, and client bundling. Expose that command through pnpm's `prepare` lifecycle so a Git dependency is prepared from source, and keep package metadata/documentation aligned with the generated publish layout.

**Tech Stack:** pnpm 10.32.1, TypeScript, Node.js ESM scripts, pnpm package lifecycle hooks.

## Global Constraints

- Do not change dependency versions.
- Preserve `tsc -p tsconfig.json`, `node scripts/generate-typert.mjs`, and `node scripts/build-client.mjs` in the build chain.
- Keep `DOM.Iterable` in the TypeScript library set so a clean Git preparation install can compile browser iteration types.
- `prepare` must delegate to `pnpm run build` and must not invoke itself recursively.
- The package tarball must include `lib` and `cordis.patch.yml`.
- Do not commit generated `lib/` or `dist/` output.

## Task 1: Lock the package lifecycle contract with a regression check

**Files:**

- Create: `test/package-manifest.test.mjs`

- [x] **Step 1: Assert the desired lifecycle, package manager, build chain, and files.**

Read the package manifest and assert:

```js
assert.equal(manifest.packageManager, 'pnpm@10.32.1');
assert.equal(manifest.scripts.prepare, 'pnpm run build');
assert.equal(manifest.scripts.prepack, undefined);
assert.equal(
  manifest.scripts.build,
  'tsc -p tsconfig.json && node scripts/generate-typert.mjs && node scripts/build-client.mjs',
);
assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml']);
assert.ok(tsconfig.compilerOptions.lib.includes('DOM.Iterable'));
```

- [x] **Step 2: Run the focused check and confirm it fails against the current manifest.**

Run `node --test test/package-manifest.test.mjs` from `packages/clutch-dsh-worktree`.
Expected: failure because `packageManager` and `prepare` are missing while `prepack` is present.

## Task 2: Switch Git preparation to the non-recursive build lifecycle

**Files:**

- Modify: `package.json`

- [x] **Step 1: Replace `prepack` with `prepare`, add the actual pnpm version, and keep clean-install browser types.**

Set `packageManager` to `pnpm@10.32.1`, set `scripts.prepare` to `pnpm run build`, remove `scripts.prepack`, add `DOM.Iterable` to `tsconfig.json`'s `compilerOptions.lib`, and leave the existing `build` command byte-for-byte unchanged.

- [x] **Step 2: Run the manifest check and package build.**

Run `node --test test/package-manifest.test.mjs` and `pnpm run build`.
Expected: the manifest test and build both exit successfully; `lib` contains TypeScript output, Typert artifacts, and `client.js`.

## Task 3: Align release documentation with both installation paths

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/RELEASING.md`

- [x] **Step 1: Document `prepare` as the source checkout/Git dependency hook.**

Explain that Git dependencies use `prepare` to generate `lib/` from source, while `pnpm pack`/publish also run lifecycle preparation; describe `build` as the shared command and keep the tarball requirement for `lib` and `cordis.patch.yml`.

- [x] **Step 2: Run formatting and documentation-aware checks.**

Run `pnpm exec prettier --check package.json AGENTS.md README.md docs/RELEASING.md docs/superpowers/plans/2026-08-25-git-install-build.md` and the existing workspace/patch validators.

## Task 4: Verify the Git install behavior and final scope

**Files:**

- Verify: `package.json`, `tsconfig.json`, build scripts, `files` metadata, generated package contents, and Git dependency installation.

- [x] **Step 1: Preview the package.**

Run `pnpm pack --dry-run`; confirm the output lists `lib/` and `cordis.patch.yml`.

- [x] **Step 2: Simulate a Git dependency installation where supported.**

Use a temporary local Git repository and a temporary consumer package to install the monorepo subdirectory through pnpm. Allow the Git package's build script in the temporary consumer's pnpm policy, confirm installation completes, and verify the installed package contains generated `lib/` output. Also record the default pnpm security-policy failure when the consumer does not approve the Git build. If the local pnpm/Git resolver cannot represent a subdirectory dependency, report the exact limitation and retain the direct lifecycle/build evidence.

- [x] **Step 3: Run the relevant package checks and review the diff.**

Run `pnpm run test`, `pnpm run check:workspace`, `pnpm run check:patches`, `git diff --check`, and `git status --short`. Confirm no generated output or unrelated package changes are included.

## Verification Record

- `pnpm run build`: passed; ran TypeScript, Typert generation, and browser client bundling.
- `pnpm pack --dry-run`: passed; listed `lib/` and `cordis.patch.yml`.
- `pnpm run test`: passed with 201 tests.
- `pnpm run check:workspace`, `pnpm run check:patches`, package `typecheck`, and Prettier checks: passed.
- A temporary local Git monorepo subdirectory install first reproduced pnpm's unapproved Git build policy error, then passed with the consumer allowlist and verified installed `lib/index.js`, `lib/client.js`, and `cordis.patch.yml`.

## Follow-up correction (2026-08-25)

The Git install reproduction was rerun through the DSH profile path after the original
verification. pnpm's Git prepare policy is stricter than a package-name-only allowlist: for a
direct Git dependency it requires the exact key printed in `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`,
including the resolved commit and `path:/packages/clutch-dsh-worktree`. The earlier release note
that suggested `onlyBuiltDependencies` or only the package name was incorrect for the current DSH
profile and has been corrected in `README.md` and `docs/RELEASING.md`.

The generated awesome-dsh-plugin command is not the difference from `dsh-pet`; both use the same
`github:<repo>#path:/...` source form. After the exact key is accepted, this monorepo's Git
prepare runs its workspace install before the package build, so the profile also needs a working
registry/network. No generated `lib/` output was added to Git, and the diagnostic session itself
did not publish to npm. The maintainer has since published the package, so the npm path is now the
recommended no-`allowBuilds` installation path.
