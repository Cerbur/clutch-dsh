# clutch-dsh-worktree Package Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `clutch-dsh-worktree` 合并为一个真实 DSH bundle package，同时在
`src/` 内以 `contract`、`provider`、`manage`、`client` 保留清晰的单向
内部 seam。

**Architecture:** DSH 以 `packages/clutch-dsh-worktree/package.json` 中的
`dsh.bundle.patch` 激活整个 plugin，不要求三个能力角色成为三个 package。
`src/contract/` 是无副作用的内部 Service Definition；`src/provider/`
提供 Git、sidecar 和 DSH read adapter；`src/manage/` 负责 Worktree/Session
用例编排；未来浏览器 Consumer 使用 `src/client/` entrypoint，并通过
browser-safe contract/Remote facade 访问 Host 能力。

**Tech Stack:** pnpm workspace、TypeScript、Node test runner、真实 DSH bundle
manifest、YAML patch layer、Git worktree、JSON sidecar。

## Global Constraints

- 只修改 `/Users/yuancheng/Documents/Code/clutch-dsh`，不修改 DSH 源码仓库。
- `clutch-dsh-worktree` 是唯一 workspace package；不保留 manager/local/ui 的 nested `package.json`、patch 或独立测试入口。
- DSH bundle metadata 位于 package.json：`dsh.bundle.patch: "./cordis.patch.yml"`；patch 文件本身是 YAML 数组。
- `clutchDsh.role: "plugin"` 表示一个 package 可以同时拥有多个能力角色；独立 Provider/Consumer package 才使用 `workspace:*` 依赖规则。
- `src/contract/` 不依赖 Git、sidecar、Node-only API、React 或 DSH mutation API。
- `src/provider/` 不依赖 `src/manage/` 或 `src/client/`，只负责底层 adapter 和持久化。
- `src/manage/` 组合 `contract` 与 `provider`，负责上层 Worktree/Session 用例编排。
- Provider 只维护 Worktree 和 Session binding 关系，不写入或复制 DSH Workspace、Session、消息、prompt、transcript 或历史内容。
- `src/client/` 不执行 Git、不读 sidecar 文件、不导入 Provider internals。
- 不提交 `dist`、coverage、sidecar、凭据或临时 fixture。
- 保留工作区中本次任务开始前的用户改动，不重置、不覆盖无关文件。

## DSH evidence

DSH 的 `dsh plugin` loader 以依赖 package 是否声明 `dsh.bundle` 作为 bundle
判定；它不要求 Service Definition、Provider、Consumer 使用不同 package。
DSH 的能力 seam 文档也允许一个 package 拥有多个角色，只有独立演进或替换
时才拆包。普通 UI package 使用同一 package 的 `src/index.ts` 和
`src/client/index.ts` 两个运行时 entrypoint；这与 package 数量无关。

## Task 1: Make workspace guards represent an atomic plugin package

**Files:**

- Modify: `scripts/check-workspace.test.mjs`
- Modify: `scripts/validate-cordis-patches.test.mjs`
- Modify: `scripts/check-workspace.mjs`
- Modify: `scripts/validate-cordis-patches.mjs`

**Interfaces:**

- `check-workspace.mjs` accepts `clutchDsh.role === "plugin"` and requires its
  declared `serviceDefinition` to equal the package name, just like a
  Service Definition package. Provider/Consumer dependency checks remain for
  truly separate packages.
- `validate-cordis-patches.mjs` reads `packageJson.dsh.bundle.patch`, resolves
  that relative path inside the package, and requires the target to parse as a
  YAML array.

- [x] **Step 1: Add the failing atomic-package fixture.**

Extend `check-workspace.test.mjs` with a direct package fixture named
`clutch-dsh-worktree` whose metadata is:

```json
{
  "plugin": "clutch-dsh-worktree",
  "role": "plugin",
  "serviceDefinition": "clutch-dsh-worktree"
}
```

The fixture must also contain the existing required scripts/files. Assert that
the current validator rejects it because `plugin` is not yet a valid role.

- [x] **Step 2: Add the failing real-DSH bundle fixtures.**

Change the patch fixture helper to write:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

and write `[]\n` to `cordis.patch.yml`. Add tests that accept this manifest,
reject a missing `dsh.bundle`, reject a missing `dsh.bundle.patch`, reject a
missing patch file, and reject a patch file whose YAML root is not an array.

- [x] **Step 3: Run the focused tests and confirm RED.**

Run:

```bash
node --test scripts/check-workspace.test.mjs scripts/validate-cordis-patches.test.mjs
```

Expected: the new plugin-role and real-bundle tests fail against the old
role/bundle assumptions; existing unrelated tests remain meaningful.

- [x] **Step 4: Implement the minimal validator changes.**

Add `plugin` to the valid role set. Require
`serviceDefinition === packageJson.name` for `plugin` and
`service-definition`; keep exact `workspace:*` checks for separate Provider and
Consumer packages.

In `validate-cordis-patches.mjs`, replace bundle-name comparison with:

```js
const patchReference = packageJson?.dsh?.bundle?.patch
if (typeof patchReference !== 'string' || patchReference.length === 0) {
  throw new Error('dsh.bundle.patch is missing')
}
const patchPath = path.resolve(packageDirectory, patchReference)
const patch = parseYaml(await readFile(patchPath, 'utf8'))
if (!Array.isArray(patch)) {
  throw new Error('cordis.patch.yml must contain a YAML array')
}
```

Reject an absolute patch reference or a resolved path outside the package before
reading it. Preserve package-directory scanning and planning-directory skips.

- [x] **Step 5: Run the focused tests and confirm GREEN.**

Run the same Node test command. Expected: all validator tests pass.

## Task 2: Consolidate package metadata, source, and tests

**Files:**

- Create: `packages/clutch-dsh-worktree/package.json`
- Create: `packages/clutch-dsh-worktree/cordis.patch.yml`
- Create: `packages/clutch-dsh-worktree/tsconfig.json`
- Create: `packages/clutch-dsh-worktree/src/contract/index.ts`
- Create: `packages/clutch-dsh-worktree/src/contract/index.contract.ts`
- Create: `packages/clutch-dsh-worktree/test/contract.test.mjs`
- Create: `packages/clutch-dsh-worktree/test/manage.test.mjs`
- Move: existing Local Provider source files into `packages/clutch-dsh-worktree/src/provider/` and `src/manage/`
- Move: existing Local Provider and Service Definition tests into `packages/clutch-dsh-worktree/test/`
- Delete: `clutch-dsh-worktree-manager/`
- Delete: `clutch-dsh-worktree-local/`
- Delete: `clutch-dsh-worktree-ui/`

**Interfaces:**

- Root package name, plugin id, service identity and DSH bundle identity are
  `clutch-dsh-worktree`.
- `src/index.ts` re-exports `src/contract/`, `src/provider/` and `src/manage/`.
- Provider files import `../contract/index.js` rather than a workspace package.
- The package remains independently testable through injected DSH, Git and
  sidecar adapters; no real DSH composition is invented in this migration.

- [x] **Step 1: Create the failing root-package fixture metadata.**

Create the root package manifest with these relevant fields:

```json
{
  "name": "clutch-dsh-worktree",
  "type": "module",
  "clutchDsh": {
    "plugin": "clutch-dsh-worktree",
    "role": "plugin",
    "serviceDefinition": "clutch-dsh-worktree"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Use the existing build, lint, typecheck and test script conventions. Before
moving source, run `pnpm run check:workspace` and `pnpm run check:patches` to
record the expected RED caused by the old nested packages.

- [x] **Step 2: Move the contract and Provider source without changing behavior.**

Keep the stable domain contract in `src/contract/`, low-level adapters in
`src/provider/`, and the former lifecycle orchestration in `src/manage/`; make
`src/index.ts` expose the four internal module surfaces without creating
additional workspace packages.

- [x] **Step 3: Move tests to one package test directory.**

Rename the former manager test to `test/contract.test.mjs` and the former local
test to `test/manage.test.mjs`. Both tests continue importing `../dist/index.js`;
the root build now produces that same entrypoint. Keep all existing behavioral
assertions, including cwd resolution, idempotent binding, conflict rejection,
path validation, recovery, and byte-for-byte DSH fixture preservation.

- [x] **Step 4: Add the empty DSH patch layer.**

Set `cordis.patch.yml` to exactly:

```yaml
[]
```

This makes the package installable as a valid DSH bundle without claiming that
the unfinished Remote or UI composition is already mounted.

- [x] **Step 5: Run the package RED/GREEN cycle.**

Run:

```bash
pnpm --filter clutch-dsh-worktree typecheck
pnpm --filter clutch-dsh-worktree build
pnpm --filter clutch-dsh-worktree test
```

Expected: the root package builds and both migrated test files pass.

## Task 3: Rewrite design and execution records around one package

**Files:**

- Modify: `packages/clutch-dsh-worktree/AGENTS.md`
- Modify: `packages/clutch-dsh-worktree/README.md`
- Modify: `packages/clutch-dsh-worktree/docs/superpowers/specs/2026-08-19-clutch-dsh-worktree-design.md`
- Modify: `packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-19-clutch-dsh-worktree-implementation.md`
- Modify: `packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/PLUGIN_AUTHORING.md`
- Modify: `docs/superpowers/plans/2026-08-18-clutch-dsh-bootstrap.md`
- Modify: `docs/superpowers/specs/2026-08-18-clutch-dsh-bootstrap-design.md`
- Modify: `docs/superpowers/plans/2026-08-19-clutch-dsh-package-naming.md`
- Modify: `docs/superpowers/specs/2026-08-19-clutch-dsh-package-naming-design.md`

- [x] **Step 1: Replace the package-family diagrams and paths.**

Document only `packages/clutch-dsh-worktree/` as the runnable package. Use
`src/contract/`, `src/provider/`, `src/manage/`, and `src/client/` for internal
roles, with Manage above Provider in the use-case dependency direction.
Remove claims that `manager`, `local`, and `ui` are independent packages.

- [x] **Step 2: Record the DSH loading evidence.**

State that DSH activates a package through `package.json.dsh.bundle.patch`,
that `dsh.client` is a browser build manifest when the UI phase starts, and that
Host/browser artifacts may be separate entrypoints of one package.

- [x] **Step 3: Preserve the behavioral roadmap.**

Keep the existing sidecar ownership, Session source-of-truth, Git recovery,
Remote composition, UI view-mode, and acceptance criteria. Only change package
paths and role-to-package wording; do not broaden V1 or modify DSH source.

- [x] **Step 4: Scan for stale package references.**

Run:

```bash
rg -n --hidden -g '!node_modules' -g '!dist' -g '!pnpm-lock.yaml' \
  'clutch-dsh-worktree-(manager|local|ui)|packages/clutch-dsh-worktree/(clutch-dsh-worktree|src)' .
```

Expected: no old package paths remain; internal type names such as
`WorktreeManager` remain valid.

## Task 4: Verify the consolidated workspace

**Files:**

- Verify: root workspace manifest and lockfile
- Verify: consolidated package source/tests
- Verify: all updated design and implementation records

- [x] **Step 1: Refresh workspace metadata.**

Run `pnpm install --lockfile-only` from the repository root if the lockfile does
not already describe the new direct package. Do not use network-dependent
installation as a substitute for a failed validator.

- [x] **Step 2: Run focused checks.**

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter clutch-dsh-worktree typecheck
pnpm --filter clutch-dsh-worktree build
pnpm --filter clutch-dsh-worktree test
```

- [x] **Step 3: Run repository checks appropriate to the changed surfaces.**

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run check
```

- [x] **Step 4: Review scope and generated files.**

```bash
git diff --check
git status --short
rg --files packages/clutch-dsh-worktree | sort
```

Expected: one root package, no nested runtime package directories, no tracked
build output, no sidecar data, and no changes under
`/Users/yuancheng/Documents/Code/deepseek-harness`.
