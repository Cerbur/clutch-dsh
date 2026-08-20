# clutch-dsh Package and Plugin Identity Implementation Plan

> **Status:** implemented baseline, amended on 2026-08-20 after inspecting
> DSH's real bundle loader. The worktree package consolidation is tracked in
> `packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-20-clutch-dsh-worktree-package-consolidation.md`.

**Goal:** 让 workspace validator 同时支持 atomic plugin packages 和确有独立
演进需求的 nested module packages，并按真实 DSH manifest 校验 bundle。

**Architecture:** `clutchDsh` 描述本 workspace 的 package role；`role: plugin`
表示一个 package 内部拥有多个能力角色。DSH 的实际 bundle identity 来自
`package.json.dsh.bundle.patch`，而不是从目录名、角色后缀或 Service
Definition 名称推导。

## Implemented rules

- package directory name equals the unscoped part of `package.json.name`;
- scoped package names use the `@scope/<directory>` form;
- an atomic package name may equal `clutchDsh.plugin`;
- a nested module package name must use the plugin prefix;
- `clutchDsh.role` is `plugin`, `service-definition`, `provider`, or `consumer`;
- `plugin` and `service-definition` identities equal their package name;
- independent Provider/Consumer packages use exact `workspace:*` dependencies;
- `dsh.bundle.patch` is a relative path to a YAML array inside the package;
- planning directories without `package.json` are skipped.

## Task 1: Workspace metadata guard

**Files:** `scripts/check-workspace.mjs`,
`scripts/check-workspace.test.mjs`

- [x] Accept `@cerbur/clutch-dsh-worktree` as an atomic plugin package.
- [x] Accept the existing independent package fixture shape.
- [x] Reject invalid directory/name, plugin prefix, role, identity and
      Provider/Consumer dependency values.

## Task 2: DSH bundle guard

**Files:** `scripts/validate-cordis-patches.mjs`,
`scripts/validate-cordis-patches.test.mjs`

- [x] Read `package.json.dsh.bundle.patch`.
- [x] Reject missing, absolute or package-external patch paths.
- [x] Reject missing files, malformed YAML and non-array YAML roots.
- [x] Keep direct/nested package discovery and planning-directory skips.

## Task 3: Documentation and worktree migration

**Files:** root authoring/bootstrap docs and
`packages/clutch-dsh-worktree/` design/plan docs.

- [x] Document one package as the default plugin shape.
- [x] Document internal `contract`/Provider/Client seams.
- [x] Remove the old manager/local/ui package model from current worktree docs.
- [x] Add the DSH evidence and the consolidated execution plan.

## Verification

Run from the repository root:

```bash
node --test scripts/check-workspace.test.mjs scripts/validate-cordis-patches.test.mjs
pnpm run check:workspace
pnpm run check:patches
```

The feature-specific package migration and its tests are verified by the
worktree consolidation plan; this naming plan does not create demo packages or
publish anything.
