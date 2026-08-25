# clutch-dsh 协作说明

## 项目定位

clutch-dsh 是一个 pnpm workspace，用于开发一系列 DSH（DeepSeek Harness）plugin。

根目录负责 workspace 级的公共能力和约定：

- pnpm workspace 配置
- TypeScript、lint、format 等共享工具
- workspace/package 结构校验
- 跨 plugin 的脚本和文档
- 不承载某个具体 plugin 的业务实现

## 工作区结构

- 根 package 必须保持 private，不发布根 package。
- `packages/*` 下的目录可以是完整 plugin package，也可以是包含 nested
  module packages 的 plugin 根目录。workspace 同时发现 `packages/*` 和
  `packages/*/*`。
- Service Definition、Provider、Consumer 是能力角色；只有需要独立替换、
  发布或安装时才拆成 package，一个 plugin package 可以拥有多个角色。
- 只有独立 Provider/Consumer package 才使用 `workspace:*` 依赖独立的
  Service Definition package。
- 每个可运行 plugin package 应包含 package.json、cordis.patch.yml、tsconfig.json 和 src/index.ts。
- `packages/` 下的每个可运行 plugin package 必须提供：
  - `README.md`：英文公开文档；
  - `README.zh.md`：中文公开文档；
  - `assets/screenshots/`：当 UI 行为需要视觉说明时，存放文档引用的截图。
- 两份 README 必须按以下顺序包含四个部分：功能介绍（含截图）、能力、安装（先 npm，再仓库/源码安装）、详细使用（含相关图片）。
- 公开行为、能力、安装方式或限制发生变化时，必须同时更新两份 README。README 不得重复当前 package version；`package.json` 是版本唯一来源。两种语言中的命令、package 名称、错误码、路径和 source-of-truth 说明必须保持同步。
- plugin 专属文档和计划放在对应 plugin 目录下，优先使用最近的 AGENTS.md。

## 计划与文档

仓库初始化计划：

- docs/superpowers/plans/2026-08-18-clutch-dsh-bootstrap.md

clutch-dsh-worktree 的专属入口：

- packages/clutch-dsh-worktree/README.md
- packages/clutch-dsh-worktree/AGENTS.md
- packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md

新增或修改行为前，先阅读对应计划和最近的 README；如果实现与计划不一致，要同步更新计划或明确记录原因。

## 工作方式

1. 先检查当前 git status，保留用户已有改动，不重置或覆盖无关文件。
2. 先阅读仓库根 AGENTS.md，再阅读目标目录下更近的 AGENTS.md。
3. 遵循现有目录和命名约定，避免为单个 plugin 引入根级特殊规则。
4. 使用小范围、可审查的修改；本地文件编辑使用 apply_patch。
5. 修改完成后运行与改动匹配的检查，并在交接时说明实际运行过的命令。
6. 不在未获授权时执行发布、推送、删除数据或修改外部系统的操作。

## 分支、Worktree 与 Release 聚合

工作区的 release、package feature worktree 和 root/workspace change 按以下关系组织：

```text
main
  └─ release/<release-name>-<version>
       ├─ wt-<release-name>-<version>/<feature-name>
       └─ wt-<release-name>-<version>/<feature-name>
```

- release branch 从 `main` 创建，是目标版本的聚合边界，命名为
  `release/<release-name>-<version>`。`<release-name>` 使用 package short name，例如
  `clutch-dsh-worktree` 使用 `worktree`，`clutch-dsh-discuss` 使用 `discuss`；例如
  `release/worktree-0.1.4`。
- package feature worktree 从对应 release branch 创建，命名为
  `wt-<release-name>-<version>/<feature-name>`，例如
  `wt-worktree-0.1.4/feat-readme`。
- 不属于某个 package 的 root/workspace change 使用 `base/feat-<feature-name>`，例如
  `base/feat-xxxx`。
- 每个 worktree 独立运行与改动匹配的检查，并在交接前整理为一个 scoped commit；commit
  message 必须明确说明改动范围。
- 合并 worktree 前，必须先将其 rebase 到最新的 release branch，再把该 worktree 的单个
  scoped commit 合并到 release branch。发生冲突时先解决并重新验证，不能跳过 rebase gate。
- 在 `npm pack`、npm publish 或最终 release verification 之前，必须先将 release branch
  rebase 到最新的 `main`，再运行完整检查；发布准备完成后将 release branch 合并回
  `main`。
- 本流程只定义分支和验证顺序，不自动授权 commit、push、publish 或其他外部系统变更；
  这些操作仍须获得明确授权。

## 校验命令

当根工具链和 package 已初始化后，优先使用：

- pnpm install
- pnpm run check:workspace
- pnpm run check:patches
- pnpm run check
- pnpm --filter <package-name> typecheck
- pnpm --filter <package-name> build
- pnpm --filter <package-name> test

当前仓库仍可能处于规划阶段；如果某个命令所需的 package 或脚本尚未存在，说明原因，不要为了让命令通过而伪造实现。

## Git 与变更边界

- 不使用 git reset --hard、git checkout -- 或广泛删除命令覆盖用户工作。
- 不修改与当前任务无关的 plugin、计划或公共配置。
- 不把构建产物、coverage、临时 sidecar 数据或本地凭据加入 Git。
- 完成前用 git status、目标文件检查和适当的测试验证实际状态。
