# @cerbur/clutch-dsh-worktree Release Log

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
