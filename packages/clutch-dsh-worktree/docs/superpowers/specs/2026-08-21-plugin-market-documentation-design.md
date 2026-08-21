# Plugin Market Documentation Separation Design

**Goal:** 将 `@cerbur/clutch-dsh-worktree` 的公开安装说明、维护者架构约束和浏览器 Consumer 说明分层，使 package README 可以直接服务插件市场访客，同时让内部实现权责有唯一维护入口。

**Scope:** 本次调整 package 文档，并修正 workspace 根 README 中已经过时的 package 状态描述；不改变 TypeScript、DSH manifest、Cordis patch、package exports 或运行时行为。

## Information architecture

### Package README

`packages/clutch-dsh-worktree/README.md` 面向安装者、使用者和插件市场维护者，只回答：

- 这个插件做什么，以及它不做什么；
- 当前支持的 DSH 版本和前置条件；
- 如何从本地 checkout 或 registry 安装、升级和卸载；
- Worktree mode 当前能完成哪些操作；
- rc.8 下仍存在的限制和恢复行为；
- 如何在本地构建、检查和验证 package。

README 不再承担源码目录树、Provider/Manage/Host/Client 的依赖方向、sidecar 数据模型、生命周期规则和内部实现阶段记录。市场条目可使用的描述必须只陈述已由代码实现的能力，不写内部数量、未完成能力或营销性形容词。

### Package AGENTS.md

`packages/clutch-dsh-worktree/AGENTS.md` 是 package 维护者和 agent 的架构入口，集中维护：

- DSH source of truth 与 plugin sidecar 的数据边界；
- Worktree、Session binding 和 runtime cwd 的生命周期规则；
- `contract`、`provider`、`manage`、`host`、`client` 的职责和单向依赖；
- DSH read adapter、Session 创建/绑定、Worktree 创建/删除的失败恢复约束；
- 必须覆盖的验证场景以及文档同步边界。

README 只链接到这一入口，不复制完整架构说明。workspace 根 README 只保留 workspace 级事实，不重复 package 的内部权责。

### Client README

`src/client/README.md` 只描述浏览器侧 Consumer 的连接、slot、view model、交互和 disposal 边界。它可以记录客户端特有的 rc.8 workaround，但不重新定义 sidecar schema、Git adapter 或 Manage contract。

## Marketplace alignment

当前 package 已具备市场要求的本地结构：`package.json` 声明 `dsh.bundle.patch`，同目录存在可解析的 `cordis.patch.yml`，并包含真实 Host、Manage、Provider 和 Client 代码。README 的安装示例使用 package 的实际名称和现有 DSH CLI 命令。

市场投稿仍属于外部仓库操作，本文档不代替投稿 YAML。建议条目使用最接近实际能力的 `git` 分类，并使用以下准确的一句话描述：

```text
Adds a Worktree view to DSH Web UI that groups Sessions by Git worktree while keeping DSH as the source of truth.
```

仓库年龄、`dsh-plugin` topic 和投稿分支的提交数由 GitHub/市场 CI 负责确认，不在本次本地文档变更中伪造结论。

## Verification

文档调整完成后运行：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run format:check
git diff --check
```

另外扫描 README、AGENTS 和 Client README，确保没有把“Worktree UI 可删除 Worktree”、`ctx.remote.worktreeManager` 必须存在或独立 `manager/local/ui` package 等过时描述当作当前行为。
