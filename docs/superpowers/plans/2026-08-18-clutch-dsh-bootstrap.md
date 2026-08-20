# clutch-dsh Workspace Bootstrap Implementation Plan

> **Status:** bootstrap implementation completed and package convention amended
> on 2026-08-20 after inspecting DSH's real bundle loader. The current
> Worktree migration is tracked in
> `packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-20-clutch-dsh-worktree-package-consolidation.md`.

**Goal:** 建立一个 private pnpm workspace，用 package shape、role metadata 和
真实 DSH bundle manifest guard 管理后续 plugin。

**Architecture:** 根目录只负责 workspace、共享配置、检查脚本和文档。默认
一个 plugin 是一个 package；Service Definition、Provider、Consumer 只有在
需要独立发布或替换时才成为不同 package。DSH bundle 由
`package.json.dsh.bundle.patch` 激活，`cordis.patch.yml` 是 YAML patch 数组。

## Global Constraints

- 根 package `private: true`，不发布为 plugin。
- workspace 发现 `packages/*` 与 `packages/*/*`；没有 `package.json` 的规划目录被跳过。
- package 目录名必须等于 `package.json.name`。
- atomic package 的 package name 可以等于 `clutchDsh.plugin`；nested module package 使用 plugin 前缀。
- `clutchDsh.role` 可以是 `plugin`、`service-definition`、`provider` 或 `consumer`。
- atomic/plugin 和 Service Definition 的 `serviceDefinition` 等于 package name。
- 独立 Provider/Consumer 对 Service Definition 使用精确的 `workspace:*`。
- `dsh.bundle.patch` 必须是 package 内的相对路径，目标 YAML 必须是数组。
- 不创建 `my-cap` 等 demo package，不加入构建产物、coverage、sidecar 或凭据。

## Target Structure

```text
clutch-dsh/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── prettier.config.mjs
├── scripts/
│   ├── check-workspace.mjs
│   └── validate-cordis-patches.mjs
├── README.md
├── docs/PLUGIN_AUTHORING.md
└── packages/
    └── clutch-dsh-worktree/
        ├── package.json
        ├── cordis.patch.yml
        ├── src/
        │   ├── index.ts
        │   ├── contract.ts
        │   ├── provider.ts
        │   ├── git.ts
        │   ├── sidecar.ts
        │   ├── types.ts
        │   └── client/
        │       └── index.ts  # future browser entry
        └── test/
```

## Completed Tasks

### Task 1: Workspace root and shared tooling

- [x] Create private root package and scripts.
- [x] Discover direct and one-level nested packages.
- [x] Keep README-only planning directories valid.
- [x] Provide `check`, `build`, `typecheck`, `lint`, `format:check` and `test` commands.

### Task 2: Workspace metadata guard

**Files:** `scripts/check-workspace.mjs`,
`scripts/check-workspace.test.mjs`

- [x] Validate package shape, scripts, directory/name and plugin identity.
- [x] Accept atomic `role: plugin` packages.
- [x] Preserve independent Service Definition/Provider/Consumer validation.
- [x] Validate exact `workspace:*` dependencies only for independent Provider/Consumer packages.

### Task 3: Real DSH bundle guard

**Files:** `scripts/validate-cordis-patches.mjs`,
`scripts/validate-cordis-patches.test.mjs`

- [x] Read `package.json.dsh.bundle.patch` rather than inventing a bundle name
      from a folder or Service Definition.
- [x] Reject missing, absolute and package-external patch paths.
- [x] Reject missing files, invalid YAML and non-array YAML roots.
- [x] Keep planning-directory skips and direct/nested package compatibility.

### Task 4: Documentation

- [x] Update root README and AGENTS instructions.
- [x] Update `docs/PLUGIN_AUTHORING.md` with atomic and independent package forms.
- [x] Update bootstrap and package-naming specs/plans.
- [x] Link the Worktree consolidation plan as the current package migration authority.

## Verification

Run from the repository root:

```bash
node --test scripts/check-workspace.test.mjs scripts/validate-cordis-patches.test.mjs
pnpm run check:workspace
pnpm run check:patches
```

The Worktree package, sidecar behavior and future DSH Host/UI composition are
verified by their own package plan; this bootstrap plan does not publish or
modify the DSH source repository.
