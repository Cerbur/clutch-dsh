# Plugin-Prefixed Package Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the workspace package convention so every runnable package uses its plugin name as a prefix, while module names remain plugin-specific and Provider/Consumer Service Definition dependencies stay exact.

**Architecture:** Package role is declared explicitly in `package.json` under `clutchDsh`, because arbitrary module names cannot identify a Service Definition, Provider, or Consumer by suffix. The workspace validator checks package shape, directory/name equality, plugin prefix, role metadata, and the exact Service Definition dependency; the Cordis patch validator checks `dsh.bundle` against the same declared Service Definition.

**Tech Stack:** Node.js ESM scripts, Node test runner, pnpm, YAML parser, Markdown documentation.

## Global Constraints

- Every runnable package directory name must equal `package.json.name`.
- Every runnable package must declare `clutchDsh.plugin`, and its package name must start with `${clutchDsh.plugin}-`.
- Module names after the plugin prefix are free-form; `manager`, `local`, `ui`, `tool`, and `dsh` are not inferred or required suffixes.
- `clutchDsh.role` is one of `service-definition`, `provider`, or `consumer`.
- A Service Definition declares itself as `clutchDsh.serviceDefinition`; Provider and Consumer depend on that exact name with `"workspace:*"` in `dependencies`.
- Every runnable package patch has `dsh.bundle` equal to `clutchDsh.serviceDefinition`.
- Existing required files, required scripts, root-private behavior, planning-directory skipping, and unrelated workspace behavior remain unchanged.
- Do not modify any file below `packages/clutch-dsh-worktree/`.
- Use `apply_patch` for local edits and do not create demo packages or build artifacts.

---

### Task 1: Replace workspace name and role inference with explicit metadata

**Files:**

- Modify: `scripts/check-workspace.mjs`
- Test: `scripts/check-workspace.test.mjs`

**Interfaces:**

- Consumes: Existing package shape checks and temporary workspace fixtures.
- Produces: A validator that accepts arbitrary plugin-prefixed module names and reports directory/name, metadata, prefix, role, and dependency violations with package paths.

- [ ] **Step 1: Add failing tests for arbitrary module names and metadata.**

  Extend `scripts/check-workspace.test.mjs` with a fixture helper that creates all required package files and a package manifest containing:

  ```json
  {
    "name": "clutch-dsh-worktree-manager",
    "clutchDsh": {
      "plugin": "clutch-dsh-worktree",
      "role": "service-definition",
      "serviceDefinition": "clutch-dsh-worktree-manager"
    },
    "scripts": {
      "build": "node build.mjs",
      "lint": "node lint.mjs",
      "typecheck": "node typecheck.mjs",
      "test": "node test.mjs"
    }
  }
  ```

  Add one test that creates these three packages and expects exit code `0`:

  ```text
  packages/clutch-dsh-worktree-manager  role service-definition, serviceDefinition itself
  packages/clutch-dsh-worktree-git      role provider, dependency clutch-dsh-worktree-manager: workspace:*
  packages/clutch-dsh-worktree-ui       role consumer, dependency clutch-dsh-worktree-manager: workspace:*
  ```

  Add tests that create a complete package and expect exit code `1` when:

  - directory `clutch-dsh-worktree-git` contains a different `package.json.name`;
  - `packageJson.name` does not start with `clutchDsh.plugin + "-"`;
  - `clutchDsh` is missing or has an unsupported `role`;
  - a Provider or Consumer uses a dependency value other than exactly `workspace:*`.

- [ ] **Step 2: Run the focused workspace tests and verify the new tests fail for the old assumptions.**

  Run:

  ```bash
  node --test scripts/check-workspace.test.mjs
  ```

  Expected: the new valid fixture fails because the current validator still derives names as `dsh-*`/`dsh-tool-*`; the existing planning-only and invalid-package tests remain meaningful.

- [ ] **Step 3: Implement the minimal explicit metadata validation.**

  In `scripts/check-workspace.mjs`:

  - Remove `packageRole` and `expectedPackageName`.
  - Keep `requiredFiles`, `requiredScripts`, `exists`, `report`, package discovery, planning-directory skipping, and existing shape checks.
  - Compare `packageJson.name` directly with `folderName` and report the expected directory name.
  - Read `packageJson.clutchDsh` and validate it is an object with non-empty string `plugin`, one of the three roles, and non-empty string `serviceDefinition`.
  - Require `packageJson.name.startsWith(`${plugin}-`)`.
  - Require `serviceDefinition === packageJson.name` for `service-definition`.
  - For `provider` and `consumer`, require `packageJson.dependencies?.[serviceDefinition] === 'workspace:*'`.
  - Do not inspect module suffixes or require any `dsh-*` package name.

  The dependency error must retain the existing shape of reporting the package path, dependency name, and actual value; use the declared Service Definition name instead of deriving one from the folder.

- [ ] **Step 4: Run the focused workspace tests and verify they pass.**

  Run:

  ```bash
  node --test scripts/check-workspace.test.mjs
  ```

  Expected: all workspace validator tests pass with exit code `0`.

- [ ] **Step 5: Commit the workspace validator change.**

  ```bash
  git add scripts/check-workspace.mjs scripts/check-workspace.test.mjs
  git commit -m "feat: validate plugin-prefixed package metadata"
  ```

### Task 2: Make Cordis patch validation metadata-driven

**Files:**

- Modify: `scripts/validate-cordis-patches.mjs`
- Test: `scripts/validate-cordis-patches.test.mjs`

**Interfaces:**

- Consumes: `package.json.clutchDsh.serviceDefinition` and existing `dsh.bundle` YAML shape.
- Produces: `expectedBundle(packageJson)` returning the declared Service Definition name and `validatePatch(packageDirectory)` validating the patch against it.

- [ ] **Step 1: Add failing tests for arbitrary modules and explicit bundles.**

  Change the patch fixture helper to write `clutchDsh.serviceDefinition` into `package.json`, while keeping the package directory names free-form. Add a passing test using:

  ```text
  directory: packages/clutch-dsh-worktree-git
  package name: clutch-dsh-worktree-git
  serviceDefinition: clutch-dsh-worktree-manager
  dsh.bundle: clutch-dsh-worktree-manager
  ```

  Keep a failure test with the same package but `dsh.bundle: clutch-dsh-other-manager`, and assert the output names `clutch-dsh-worktree-manager` as the expected bundle. Add a failure test for a package without a declared Service Definition.

- [ ] **Step 2: Run the focused patch tests and verify the old `dsh-<folder>` derivation fails the new cases.**

  Run:

  ```bash
  node --test scripts/validate-cordis-patches.test.mjs
  ```

  Expected: the new arbitrary-module passing test fails because `expectedBundle` still prepends `dsh-` and derives from folder suffixes.

- [ ] **Step 3: Implement metadata-driven bundle derivation.**

  In `scripts/validate-cordis-patches.mjs`:

  - Replace the folder-name `expectedBundle(folderName)` logic with `expectedBundle(packageJson)` returning `packageJson.clutchDsh?.serviceDefinition`.
  - In `validatePatch`, reject a missing or empty declared Service Definition with `clutchDsh.serviceDefinition is missing`.
  - Keep YAML parsing, missing/empty `dsh.bundle` handling, package name return value, directory scanning, planning-directory skipping, and status output unchanged.
  - Compare the parsed bundle with the declared Service Definition and report the declared expected value.
  - Do not generate or require a `dsh-*` or `dsh-tool-*` string.

- [ ] **Step 4: Run the focused patch tests and verify they pass.**

  Run:

  ```bash
  node --test scripts/validate-cordis-patches.test.mjs
  ```

  Expected: all patch validator tests pass with exit code `0`.

- [ ] **Step 5: Commit the patch validator change.**

  ```bash
  git add scripts/validate-cordis-patches.mjs scripts/validate-cordis-patches.test.mjs
  git commit -m "feat: validate Cordis bundles from package metadata"
  ```

### Task 3: Synchronize workspace documentation and root bootstrap records

**Files:**

- Modify: `README.md`
- Modify: `docs/PLUGIN_AUTHORING.md`
- Modify: `docs/superpowers/plans/2026-08-18-clutch-dsh-bootstrap.md`
- Modify: `docs/superpowers/specs/2026-08-18-clutch-dsh-bootstrap-design.md`

**Interfaces:**

- Consumes: The metadata and validator rules from Tasks 1–2.
- Produces: A consistent authoring contract that uses `<plugin>-<module>` examples without imposing module suffixes, while retaining the existing package shape and command requirements.

- [ ] **Step 1: Rewrite the root README naming paragraph.**

  State that runnable packages use `packages/<plugin>-<module>/`, `package.json.name` equals the directory name, module names are plugin-specific, and `clutchDsh` declares plugin, role, and Service Definition. Keep the existing workspace layout and command lists unchanged.

- [ ] **Step 2: Rewrite `docs/PLUGIN_AUTHORING.md` around the explicit metadata contract.**

  Include:

  ```text
  packages/<plugin>-<module>/ -> package name <plugin>-<module>
  ```

  Show `clutch-dsh-worktree-manager`, `clutch-dsh-worktree-local`, and `clutch-dsh-worktree-ui` only as illustrative module choices. Document the three semantic roles, the exact `workspace:*` dependency for Provider/Consumer, `dsh.bundle` equal to `serviceDefinition`, validation commands, boundary rules, and that `my-cap`/`file-cap` are documentation examples only.

- [ ] **Step 3: Update the bootstrap plan and design spec.**

  Replace every root-level forced `dsh-<capability>`, `dsh-tool-<capability>`, `tool-<capability>`, and suffix-derived bundle rule with the explicit metadata contract. Preserve the bootstrap scope, required package files/scripts, no-demo-package constraint, planning-directory behavior, and final command list. Do not edit any path under `packages/clutch-dsh-worktree/`.

- [ ] **Step 4: Check the documentation diff and formatting.**

  Run:

  ```bash
  git diff --check
  pnpm exec prettier --check README.md docs/PLUGIN_AUTHORING.md docs/superpowers/plans/2026-08-18-clutch-dsh-bootstrap.md docs/superpowers/specs/2026-08-18-clutch-dsh-bootstrap-design.md
  ```

  Expected: no whitespace errors and all listed documents pass Prettier.

- [ ] **Step 5: Commit the documentation synchronization.**

  ```bash
  git add README.md docs/PLUGIN_AUTHORING.md docs/superpowers/plans/2026-08-18-clutch-dsh-bootstrap.md docs/superpowers/specs/2026-08-18-clutch-dsh-bootstrap-design.md
  git commit -m "docs: document plugin-prefixed package convention"
  ```

### Task 4: Run the complete verification suite and review scope

**Files:**

- Verify: `scripts/check-workspace.mjs`
- Verify: `scripts/validate-cordis-patches.mjs`
- Verify: `scripts/check-workspace.test.mjs`
- Verify: `scripts/validate-cordis-patches.test.mjs`
- Verify: all modified root documentation files

**Interfaces:**

- Consumes: Tasks 1–3 committed changes.
- Produces: Fresh command output and a final diff showing no changes under `packages/clutch-dsh-worktree/**`.

- [ ] **Step 1: Run focused validators and tests.**

  ```bash
  pnpm run check:workspace
  pnpm run check:patches
  node --test scripts/check-workspace.test.mjs scripts/validate-cordis-patches.test.mjs
  ```

  Expected: both guard commands report `ok`; all Node tests pass.

- [ ] **Step 2: Run the requested root checks.**

  ```bash
  pnpm run format:check
  pnpm run lint
  pnpm run typecheck
  pnpm run test
  ```

  Expected: every command exits `0`; the test command includes both root validator test files.

- [ ] **Step 3: Run the aggregate check.**

  ```bash
  pnpm run check
  ```

  Expected: workspace, patch, format, lint, typecheck, and test stages all exit `0`.

- [ ] **Step 4: Review final scope and status.**

  ```bash
  git diff --check
  git status --short
  git diff --name-only HEAD~3..HEAD
  git diff --name-only -- packages/clutch-dsh-worktree
  ```

  Expected: no diff-check errors; no files under `packages/clutch-dsh-worktree/` are modified; no demo package, build output, coverage, sidecar, or credential files are present.

- [ ] **Step 5: Report exact verification results.**

  Report each command actually run, its exit status, test pass/fail counts where available, and any pre-existing or unrelated references intentionally left untouched.
