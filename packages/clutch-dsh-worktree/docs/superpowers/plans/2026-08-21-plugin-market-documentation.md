# Plugin Market Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重组 `@cerbur/clutch-dsh-worktree` 的公开 README、维护者 AGENTS 和浏览器 Client README，使其符合插件市场的可安装性与准确描述要求。

**Architecture:** 保持一个可安装的 DSH bundle package。package README 只保留安装者需要的事实；package AGENTS.md 成为架构、数据边界和模块权责的唯一维护入口；Client README 只保留 browser-safe Consumer 的实现说明；workspace 根 README 只修正 package 状态摘要。

**Tech Stack:** Markdown、pnpm workspace checks、TypeScript package checks、DSH `dsh.bundle` manifest、Cordis YAML patch。

## Global Constraints

- 不修改 TypeScript、package exports、`package.json`、`cordis.patch.yml` 或 DSH 源码。
- `README.md` 的能力声明必须与当前代码一致，不写营销性形容词或未实现的删除入口。
- `AGENTS.md` 必须保留 DSH source of truth、sidecar 边界、runtime cwd、生命周期、模块依赖和失败恢复约束。
- `src/client/README.md` 不得把 Provider、sidecar 或 Host internals 暴露成浏览器 API。
- 不修改外部插件市场仓库，不创建虚假的市场 YAML、GitHub topic 或 npm 发布记录。
- 不提交 `lib/`、coverage、sidecar、临时 fixture 或本地凭据。

---

### Task 1: Record the approved documentation design

**Files:**

- Create: `packages/clutch-dsh-worktree/docs/superpowers/specs/2026-08-21-plugin-market-documentation-design.md`

**Interfaces:**

- Produces: 已确认的 README、AGENTS 和 Client README 三层文档边界。

- [x] **Step 1: Record the public/internal documentation split.**

  记录 package README、package AGENTS 和 Client README 各自服务的读者、允许承载的内容以及不应重复的内部架构信息。

- [x] **Step 2: Record the market-readiness facts.**

  明确当前已有 `dsh.bundle.patch`、Cordis patch 和真实代码；将仓库年龄、GitHub topic 与外部投稿 YAML 保留为外部验证项。

### Task 2: Rewrite the package README for installers

**Files:**

- Modify: `packages/clutch-dsh-worktree/README.md`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/README.md`

**Interfaces:**

- Consumes: 当前 package name、`dsh-v0.1.0-rc.8` 安装命令、当前 Worktree UI 行为和已知 workaround。
- Produces: 面向市场访客的功能、兼容性、安装、使用、限制和验证说明。

- [ ] **Step 1: Replace the opening with an accurate one-line product description.**

  说明插件给 DSH Web UI 增加 Project/Workspace → Worktree → Session 视角，并说明 DSH 仍然是原始 Project/Session 数据源。

- [ ] **Step 2: Keep only user-facing prerequisites and installation paths.**

  保留 rc.8 前置条件、本地 checkout 安装、registry 安装、升级和卸载命令；删除需要读源码才能理解的 Host/Remote assembly 细节。

- [ ] **Step 3: Describe the current user-visible Worktree surface.**

  准确列出 Workspace 搜索、Worktree 创建、Main/Worktree Session 创建、状态展示、原生 Workspace/Session 操作复用，以及当前不提供 Worktree 删除入口。

- [ ] **Step 4: Explain limitations without exposing internal architecture.**

  保留 rc.8 `session.create({ cwd })` workaround、失败可重试行为、detached 状态和 workspace deletion retention；将模块目录、Remote endpoint 和 provider 依赖移动到 AGENTS 或 Client README。

- [ ] **Step 5: Add a concise development verification section.**

  给出根 workspace 的 `check:workspace`、`check:patches` 和 package 的 typecheck/build/test 命令，并说明修改 manifest/patch 后需要重新安装 profile。

- [ ] **Step 6: Correct the workspace-level package status summary.**

  删除根 README 中“完整 UI 仍属于后续阶段”的过时描述，改为指向 package `AGENTS.md` 的当前架构入口；不把 package-specific 权责重新放回根 README。

### Task 3: Make package AGENTS.md the architecture source of truth

**Files:**

- Modify: `packages/clutch-dsh-worktree/AGENTS.md`

**Interfaces:**

- Consumes: 现有 package 协作约束和 README 中的架构/数据边界内容。
- Produces: 维护者可执行的单一架构与权责入口。

- [ ] **Step 1: Add the package source tree and dependency direction.**

  明确 `contract`、`provider`、`manage`、`host`、`client` 的职责、禁止依赖和 composition root 位置。

- [ ] **Step 2: Consolidate source-of-truth and sidecar rules.**

  明确 DSH-owned Project/Session 内容不可复制或修改，plugin sidecar 只保存关系和 Worktree 生命周期元数据，并说明 degraded/read-only 行为。

- [ ] **Step 3: Consolidate lifecycle and failure recovery rules.**

  明确 Session 创建后绑定、Worktree 创建后索引、删除失败保留关系、active/detached/main cwd 解析和冲突绑定行为。

- [ ] **Step 4: Add documentation ownership rules.**

  规定 README 只写公开使用事实，AGENTS 写架构与维护约束，`src/client/README.md` 写客户端边界，plans/specs 写设计决策和执行记录。

### Task 4: Keep the Client README browser-specific

**Files:**

- Modify: `packages/clutch-dsh-worktree/src/client/README.md`

**Interfaces:**

- Consumes: 当前 Connection、Client entry、slot、overlay 和 view model 行为。
- Produces: 不重复 package README、且不泄漏 Provider/Host runtime 的 Client 实现说明。

- [ ] **Step 1: Add a link to the package architecture entry.**

  将通用架构、sidecar 和 Manager 约束指向 package `AGENTS.md`，避免两份说明漂移。

- [ ] **Step 2: Retain browser-only connection and interaction facts.**

  保留 `/api` Connection seam、browser-local membership projection、slot mounting、overlay bounds、Session action 和 disposal 行为。

- [ ] **Step 3: Remove package-level duplication.**

  删除或改写重复的 package 发布说明、Host/Provider ownership 说明和会让用户误以为 Client 可直接读取 `ctx.remote` 的表述。

### Task 5: Verify the documentation reorganization

**Files:**

- Verify: `packages/clutch-dsh-worktree/package.json`
- Verify: `packages/clutch-dsh-worktree/cordis.patch.yml`
- Verify: `packages/clutch-dsh-worktree/README.md`
- Verify: `packages/clutch-dsh-worktree/AGENTS.md`
- Verify: `packages/clutch-dsh-worktree/src/client/README.md`
- Verify: `/Users/yuancheng/Documents/Code/clutch-dsh/README.md`

- [ ] **Step 1: Run package-shape checks.**

  ```bash
  pnpm run check:workspace
  pnpm run check:patches
  ```

  Expected: package identity、`dsh.bundle.patch` 和 YAML patch 校验通过。

- [ ] **Step 2: Run package checks.**

  ```bash
  pnpm --filter @cerbur/clutch-dsh-worktree typecheck
  pnpm --filter @cerbur/clutch-dsh-worktree build
  pnpm --filter @cerbur/clutch-dsh-worktree test
  ```

  Expected: 文档改动不影响 package 类型检查、构建和现有行为测试。

- [ ] **Step 3: Run formatting and stale-claim scans.**

  ```bash
  pnpm run format:check
  git diff --check
  rg -n 'Worktree.*删除|delete.*Worktree|ctx\.remote\.worktreeManager|clutch-dsh-worktree-(manager|local|ui)' README.md AGENTS.md src/client/README.md
  ```

  Expected: 只有明确说明“当前不提供删除入口”或“`ctx.remote.worktreeManager` 不作为 Client 依赖”的上下文保留，不出现过时的正向能力声明或独立 package 路径。
