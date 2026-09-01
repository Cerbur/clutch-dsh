# @cerbur/clutch-dsh-worktree Release Log

## Unreleased

### 中文

#### 新增

- 增加事务化 Git mutation kernel，统一 repository lock、sidecar journal 和失败恢复。
- 通过 DSH subprocess runtime 执行 Git 操作，并限制进程生命周期和诊断输出。

#### 优化

- 合并 repository identity 与 branch checkout facts 的 Git 查询，同时兼容不支持相关 ref-format atom 的旧版 Git。

#### 修复

- 强制 Worktree 删除使用最新 mutation token，并修复子目录 Workspace health、sidecar repository 归一化和 Git subprocess cleanup 的错误分类。

### English

#### Added

- Add a transactional Git mutation kernel with repository locking, sidecar journaling, and failure recovery.
- Run Git operations through the DSH subprocess runtime with bounded process lifetime and diagnostics.

#### Improved

- Consolidate repository identity and branch checkout fact reads while retaining compatibility with Git versions that lack the related ref-format atom.

#### Fixed

- Require a fresh mutation token for Worktree removal and correct subdirectory Workspace health, sidecar repository normalization, and Git subprocess cleanup classification.

## 0.1.7 — 2026-08-28

### 中文

#### 新增

- 为绑定 Worktree 的 Session 提供经原生确认的完整访问权限流程，并继续保留审批提示。
- 使用原生 Workspace 添加图标作为 Worktree 入口。
- 支持从 Worktree 菜单复制路径。
- 支持显示 Session 的原生工作状态。
- 在 Worktree 菜单中提供 active Worktree 创建入口，并支持 Local Worktree 创建。
- 支持将 fork 出的 Session 绑定到 Worktree。

#### 优化

- 优化 Session 状态点、尾部布局和可见位置，并恢复 Session header hover card 与原生 hover 详情。
- 保留手动 Session overflow 展开状态。
- 延迟 fork Session 的 Worktree membership 投影，避免过早显示不完整关系。

### English

#### Added

- Add a native-confirmed Full Access flow for Sessions bound to a Worktree while keeping approval prompts enabled.
- Use the native Workspace add icon as the Worktree entry point.
- Add a copy-path action to the Worktree menu.
- Show the native working state for Sessions.
- Add an active Worktree creation entry to the Worktree menu and support Local Worktree creation.
- Bind forked Sessions to their Worktree.

#### Improved

- Improve Session status dots, trailing layout, and visible placement, and restore the Session header hover card and native hover details.
- Preserve manual Session overflow expansion.
- Delay forked Session Worktree membership projection to avoid showing an incomplete relationship too early.

## 0.1.6 — 2026-08-26

### 中文

#### 新增

- 支持在不移动或修改目录的情况下导入已有的外部 Git Worktree。
- 支持在浏览器本地保存 Workspace 的展开状态，并在刷新后保留有效状态。
- 支持定位、临时展示、突出显示当前 Session，并将其放置在可见树中。

#### 优化

- 适配当前 upstream DSH 的约束。
- 刷新 Workspace 时避免使用过期数据创建 Worktree。
- 优化位于 Git 仓库子目录中的 Workspace 的仓库根目录解析。
- 优化当前 Session 展示的间距和定位表现。

#### 删除

- 删除当前 Session 展示中不必要的引导框。

### English

#### Added

- Import existing external Git Worktrees without moving or editing their directories.
- Persist Workspace expansion state in the browser and retain valid state across refreshes.
- Locate, temporarily reveal, highlight, and position the current Session in the visible tree.

#### Improved

- Align with the current upstream DSH constraints.
- Avoid creating Worktrees from stale data while the Workspace is refreshing.
- Improve repository-root resolution for Workspaces inside a Git repository subdirectory.
- Improve the spacing and positioning of the current Session presentation.

#### Removed

- Remove the unnecessary guide frame from the current Session presentation.
