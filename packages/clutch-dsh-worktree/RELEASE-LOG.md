# @cerbur/clutch-dsh-worktree Release Log

## Unreleased

### 中文

#### 新增

- 为已管理 Worktree 增加只读“Git 与变更”Dashboard：用户可选择并修改本地 branch 基线，查看 commit 历史、changed files 和 unified diff。
- Dashboard facts 支持选择除当前 Worktree branch 之外的本地 branch 并保存，替换 Sidecar 中原先的 `baseBranch`；保存后的有效基线会成为 Git Tab 选择器的默认值，若基线缺失或等于当前 branch，Git Tab 会提示用户选择，同时保持 Dashboard 工作区信息正常展示。
- 增加 commit/path 归属校验、首个 Git Tab lazy load、刷新 ready 内容保留、binary/超大 diff 降级以及旧请求结果隔离。
- Git 与变更 Tab 在有效基线加载后默认选择“基线汇总”，不再自动选中第一个 commit；切换基线 branch 也会回到该汇总。
- 基线汇总支持 **包含工作区改动**：以基线到当前工作区的真实净 projection 展示 committed、staged、unstaged、untracked、删除和重命名改动，并保持按需刷新。
- 当已保存有效基线时，Overview 按需分别展示 ahead/behind、已提交变更和未提交工作区变更的行数；Git 与变更的 changed-file 栏标题同步展示当前目标的 +/- 总行数，文件行统计使用与文件名对齐的字号，并使用绿色 `+N` 和红色 `-N`；这些 Git 数值保持为临时 projection，不写入 Sidecar。

#### 优化

- Sidecar schema 升级至 v5，严格保留可选 `baseCommit`，同时兼容读取 v1–v4 历史记录。
- Git Dashboard 复用现有 `/api` Worktree Manager transport，并沿用 Provider 的 argv、超时、取消和输出边界。
- 将 Overview 中的基线编辑改为铅笔图标入口和 DSH 弹窗；弹窗打开时先保持选择列表关闭，点击第一行搜索框后再展开响应式、可滚动的 branch 选择器并过滤本地 branch。
- 收窄 Git 读取成本：working-tree 的存在性与路径授权改用仅路径 projection，未跟踪文件的行数统计限定为前 50 个（其余显示“未知”），多选 commit 的归属校验改为基于一次固定的 history projection，二进制基线不再写入文本临时文件比较。
- changed-file 行改用文件名的颜色区分增删改，并在行标题与无障碍标签中给出本地化状态；超过 2000 行的 Diff 会先折叠并可手动展开；Main 的“Git 与变更”视图不再发起任何 Git 读取。
- 在提交栏标题增加默认关闭的**多选提交**开关：关闭时点击 commit 直接查看该 commit 自己的 Diff，打开后才启用多选提交；关闭开关时会把多选收敛回当前聚焦的 commit。
- 移除变更文件中每行的“在侧栏打开”入口，打开文件统一由汇总 Diff 工具栏的**在侧栏打开**提供；该按钮改用方形右上箭头图标，修正原先 icon 被压缩、与文字基线不对齐的问题。
- 可拖动分割线补齐两侧边线：上下分割线同时绘制上边和下边，左右分割线同时绘制左边和右边，两侧面板的边界更清晰。

### English

#### Added

- Add a read-only Git & Changes Dashboard for managed Worktrees where users can select and change a local branch baseline for commit history, changed files, and unified diffs.
- Let Dashboard facts save any local branch except the current Worktree branch, replacing the Sidecar's previous `baseBranch`; use a saved baseline as the Git-tab selector default only when it differs from the current branch, and prompt for a baseline when no valid fact exists while keeping Dashboard Workspace information visible.
- Add commit/path membership checks, first-Git-tab lazy loading, ready-content-preserving refreshes, binary/oversized-diff degradation, and stale-result isolation.
- Make the Git & Changes tab select **Baseline summary** by default after loading a valid baseline instead of the first commit; changing the baseline branch returns to that summary.
- Add an **Include working tree** option to the Baseline summary: show a true net baseline-to-live-tree projection with committed, staged, unstaged, untracked, deleted, and renamed changes, refreshed on demand.
- When a valid persisted baseline exists, let Overview read and show ahead/behind plus separate committed and uncommitted line totals on demand; the Git & Changes changed-file header also shows +/- totals for the current target, file statistics use the filename-aligned size, and changed files use green `+N` additions and red `-N` deletions, with Git metrics kept ephemeral rather than persisted in the Sidecar.

#### Improved

- Upgrade the sidecar schema to v5 with strict optional `baseCommit` support while continuing to read v1–v4 historical records.
- Reuse the existing `/api` Worktree Manager transport and the Provider's argv, timeout, cancellation, and output bounds.
- Replace the Overview baseline editor with a pencil-icon trigger and a DSH dialog whose responsive branch picker stays closed until the first-row search field is clicked, keeps search above a scrollable list, and filters local branches before saving.
- Tighten Git read cost: working-tree presence and path authorization use a paths-only projection, untracked line statistics are bounded to the first 50 files (the rest report Unknown), multi-commit membership is authorized against one pinned history projection, and binary baselines are no longer compared through a text temporary file.
- Mark changed-file rows with the filename color while keeping a localized status in the row title and accessible label; fold diffs past 2000 rendered lines behind a reveal action; and issue no Git read at all for the Main Git & Changes view.
- Add an off-by-default **Multi-select commits** switch to the commits header: clicking a commit shows that commit's own diff, the switch enables additive multi-selection, and turning it off collapses the selection back to the focused commit.
- Remove the per-row open-in-sidebar action from changed files so the summary diff toolbar's **Open in Sidebar** is the only file reveal action, and swap its icon for the square right-up arrow so it keeps its aspect ratio and centers with the label.
- Draw both edges of each draggable divider: the row divider now draws its top and bottom lines and the column divider draws its left and right lines, so the panes on either side each get their own edge.

## 0.1.12 — 2026-09-14

### 中文

#### 优化

- 将支持的最低 DSH 版本基线提高至 `dsh-v0.1.5-rc.1`，并更新所有 `@deepseek-ai/dsh-*` peerDependencies 范围为 `>=0.1.5-rc.1`，解决新版 DSH 环境下的安装依赖匹配问题。

### English

#### Improved

- Raise the minimum DSH compatibility floor to `dsh-v0.1.5-rc.1` and update all `@deepseek-ai/dsh-*` peerDependencies to `>=0.1.5-rc.1` to resolve prerelease dependency resolution in modern DSH environments.


## 0.1.11 — 2026-09-14

### 中文

#### 新增

- 增加仅插件的 Worktree Dashboard 预览版，提供概览、会话、Worktree 指令、创建/归档和在应用中打开入口。
- 支持从 Worktree、Local/Main 行和 Session 标题快捷入口打开 Dashboard，并保持原生 Session 页面与 DSH 数据不变。

#### 优化

- 优化 Dashboard 的会话导航、获取事实展示和 Worktree 行内操作栏，悬浮时为过长名称提供横向滚动。

#### 修复

- 修复 Local 行 Dashboard 入口和预览状态文案，明确标识尚未接入的操作。
- 修复折叠且有 Session 运行时的 Worktree 指示器与名称重叠，并让运行状态与悬浮名称滚动共用同一套协调逻辑。
- 修复并兼容 DSH 会话持久化快照格式，并在 Sidecar 存储中保留 Worktree 指令、创建与导入时间等获取元数据。

### English

#### Added

- Add a plugin-only Worktree Dashboard preview with overview, Sessions, Worktree instructions, creation/archive, and an open-in-app launch entry point.
- Open the Dashboard from Worktree, Local/Main, and Session-header shortcuts while leaving the native Session page and DSH-owned data unchanged.

#### Improved

- Improve Dashboard Session navigation, acquisition-fact presentation, and the Worktree inline action rail with hover scrolling for long labels.

#### Fixed

- Fix the Local-row Dashboard entry and preview status copy so unavailable actions are clearly marked.
- Fix collapsed running Worktree rows whose activity indicator overlapped the label, and coordinate activity scrolling with hover scrolling through one shared loop.
- Support DSH session persistence snapshot reloading and preserve acquisition metadata in sidecar storage.

## 0.1.10 — 2026-09-08

### 中文

#### 新增

- 将 Worktree 生命周期拆分为保留目录和绑定的归档、磁盘清理与移出插件管理，并增加默认折叠的归档分组。
- 支持对仅元数据标记归档且磁盘未清理的 Worktree 进行取消归档（Unarchive），直接恢复至活跃状态。
- 在 Worktree Header 搜索与添加工作区之间新增「全部折叠」按钮，支持一键折叠所有工作区与 Worktree 节点。
- 支持 Worktree 分支漂移的只读投影与显式采用（adopt），并在创建同级 Worktree 时基于当前实际分支。
- 支持在统一 Provider 运行时状态映射下过滤外部 Worktree 导入候选，排除缺失、可修剪与 detached 状态。
- 将新建 Worktree 目录名简化为短随机字符（`wt_` + 12 位十六进制），并增加名称碰撞预检与自动重试退避。

#### 优化

- 将活跃 Worktree 菜单操作文案与图标调整为「归档 Worktree」，并将 Worktree Header 搜索优化为与 DSH 原生一致的单图标折叠展开输入框。
- 优化活跃 Worktree 状态的原生 HoverCard 指引、通知队列与双语提示文案。

#### 修复

- 修复归档 Session 的定位和上下文、forget 后的异步恢复、清理后的权限重试，以及缺失目录和注册信息引发的错误恢复状态。

### English

#### Added

- Separate the Worktree lifecycle into archive with directory and binding retention, disk cleanup, and removal from management, with a collapsed archive group.
- Support unarchiving metadata-archived worktrees whose disk directories are intact, restoring them directly back to active status.
- Add a "Collapse All" button between the search slot and add workspace button in the Worktree Header to collapse all workspaces and worktrees in one click.
- Project runtime branch drift, support explicit branch adoption, and base sibling Worktree creation on the observed branch.
- Filter external Worktree import candidates using a shared Provider runtime status mapping that excludes missing, prunable, or detached entries.
- Shorten newly generated Worktree directory names to a 12-character random hex suffix with preflight collision retries.

#### Improved

- Update active Worktree menu action copy and icon to "Archive Worktree", and optimize Worktree header search into a DSH-native collapsible search input.
- Optimize active Worktree native HoverCard guidance, notification queue toasts, and bilingual tips.

#### Fixed

- Correct archived Session navigation and context, asynchronous recovery after forget, permission retry after cleanup, and false recovery from missing directories or registrations.

## 0.1.9 — 2026-09-04

### 中文

#### 版本说明

- 尽管本次废弃旧 DSH runtime 支持并提高最低兼容 graph 属于兼容性破坏，但 package 仍处于 0.1.x 预发布/初始阶段，因此有意以 patch 版本 `0.1.9` 承接该升级以保持预发布验证序列连续；这只是本阶段的明确例外，稳定版本仍遵循兼容性破坏使用 major 的规则。

#### 新增

- 适配 DSH `dsh-v0.1.2-rc.1` 的 Session/Workspace Controller、共享 Store 和 Client UI contract。
- 通过浏览器本地 Workspace membership projection 在原生 Workspace 刷新后保留 Worktree Session 归属。

#### 优化

- 使用 Session activity 和 Workspace creation metadata 派生最近 Workspace，并保持相同时间戳下的原生顺序。
- 将 Main Session 创建和 Workspace 目录选择委托给 DSH 原生 UI Workspace service。
- 优化 binding reconciliation 与定向刷新，减少无关 Workspace 的重复读取。
- 新建 Worktree 插入所属 Workspace 的 Worktree 列表头部并保留既有顺序。

#### 修复

- 修复 Host 权限适配器在真实 DSH Session 实例下因事件属性不匹配直接判定为未验证的问题，使 Worktree Session 能够正常触发确认并应用 Full Access。
- 修复在取消或关闭恢复期间因未捕获的中断 Promise 导致 unhandled rejection 掩盖真实加载错误的问题。

#### 删除

- 删除对 `dsh-v0.1.1-rc.2` 及更早 Client runtime graph、可写 Workspace list 和 `recentWorkspaceId` 的兼容支持。

### English

#### Versioning note

- Although removing the legacy DSH runtime support and raising the minimum compatibility graph is a breaking change, the package is still in the 0.1.x prerelease/initial phase, so `0.1.9` intentionally carries the upgrade as a patch to keep the prerelease validation line continuous; this is an explicit phase-limited exception, and stable releases still use major for breaking compatibility.

#### Added

- Adapt to the DSH `dsh-v0.1.2-rc.1` Session/Workspace Controllers, shared Store, and Client UI contracts.
- Preserve Worktree Session membership across native Workspace refreshes through a browser-local projection.

#### Improved

- Derive the recent Workspace from Session activity and Workspace creation metadata while retaining native order for tied timestamps.
- Delegate Main Session creation and Workspace directory picking to DSH's native UI Workspace service.
- Optimize binding reconciliation and targeted refreshes to avoid unrelated Workspace reads.
- Insert new Worktrees at the head of their Workspace list while preserving existing order.

#### Fixed

- Fix host permission adapter mismatch against genuine DSH Session instances, allowing Worktree Sessions to trigger confirmation and enter Full Access.
- Prevent unhandled rejections during abort and shutdown recovery from masking fatal loader errors.

#### Removed

- Remove compatibility with the `dsh-v0.1.1-rc.2` and earlier Client runtime graph, writable Workspace lists, and `recentWorkspaceId`.

## 0.1.8 — 2026-09-01

### 中文

#### 新增

- 增加事务化 Git mutation kernel，统一 repository lock、sidecar journal 和失败恢复。
- 通过 DSH subprocess runtime 执行 Git 操作，并限制进程生命周期和诊断输出。
- 支持从 Session 菜单复制非空 Worktree Session 的 ID。

#### 优化

- 合并 repository identity 与 branch checkout facts 的 Git 查询，同时兼容不支持相关 ref-format atom 的旧版 Git。

#### 修复

- 强制 Worktree 删除使用最新 mutation token，并修复子目录 Workspace health、sidecar repository 归一化和 Git subprocess cleanup 的错误分类。

### English

#### Added

- Add a transactional Git mutation kernel with repository locking, sidecar journaling, and failure recovery.
- Run Git operations through the DSH subprocess runtime with bounded process lifetime and diagnostics.
- Add a menu action to copy the ID of any non-blank Worktree Session.

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
