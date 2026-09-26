# @cerbur/clutch-dsh-worktree Release Log

## 0.1.15 — 2026-09-27

### 中文

#### 优化

- 全面适配 DSH 0.1.7 系列版本（支持 `>=0.1.7-rc.1` 及已验证的 `0.1.7-rc.2`），更新 Session 导航、重命名与选中适配层，兼容 DSH 1.7 移除 `current` 字段后的 `mainView` 归属与 `using()` 生命周期。
- 采用 producer-owned 指令来源 `plugin:@cerbur/clutch-dsh-worktree` 注入 Worktree 与 Main 指令，并向前兼容读取 DSH 历史指令来源。
- 桥接 TypertLookup 生成元数据，提升在新版 DSH typert 协议下的类型与 RPC 生成稳定性。

### English

#### Improved

- Add full compatibility for DSH 0.1.7 releases (supporting `>=0.1.7-rc.1` and the verified `0.1.7-rc.2` release graph), adapting Session navigation, rename, and selection to handle DSH 1.7's `mainView` retention and `using()` lifecycle without the deprecated `current` field.
- Use producer-owned instruction source `plugin:@cerbur/clutch-dsh-worktree` when injecting Worktree and Main instructions, while retaining backward-compatible recognition of historical sources.
- Bridge TypertLookup in typert protocol metadata for resilient type and RPC descriptor generation under newer DSH runtimes.

## 0.1.14 — 2026-09-22

### 中文

#### 新增

- Main Dashboard 的 Git 与变更直接展示 Workspace 根目录 HEAD 的 commit history，最多可见 200 个已提交 commit（第 201 个记录使 projection 标记为 truncated），并在根目录有 tracked/staged/unstaged/untracked 改动时展示**未提交的改动**目标；Main 不提供基线或比较型汇总，但支持已提交多选、changed files、独立 Diff segments 与工作区目标。
- Main 指令与 Worktree 指令均可在 Dashboard 编辑；Main 指令存储在 v6 Sidecar 的 Workspace-shard `mainInstructions` 中，并注入已知 Workspace 内没有 active Worktree binding 的 Session。

#### 优化

- Sidecar schema 升级至 v6，严格保留可选 `baseCommit` 与 Workspace-shard `mainInstructions`，同时兼容读取 v1–v5 历史记录。
- 将 Dashboard 的在应用中打开入口改为只调用 DSH 官方相对 Host 路由；应用选择只在当前页面内记忆，刷新后使用第一个可用应用，并保留无可用应用或 Host 失败时的 VS Code fallback。
- 让 Main Git 多选提交复用正常的 committed aggregate projection：按可见 Main history 授权 SHA，返回 changed-file 并集与每个 commit 的独立 Diff segment；实时工作区目标仍保持单选。
- Main 的 Git 与变更视图跳过 baseline/Overview 读取，按需读取有界的 HEAD history。

#### 兼容性

- 修复 Windows 下 Sidecar 原子写入：临时文件通过可写句柄同步，文件同步失败显式报错而目录同步保持 best effort 容错；VS Code 链接仅剥离 drive/UNC 扩展前缀并统一使用 / 分隔符，未知 namespace 保持不变。
- 兼容 Windows Git 的 `NUL` 设备路径和 CRLF Worktree porcelain 输出，并避免旧版 Node 的 Windows signal-0 行为误杀存活锁进程。
- 使用物理路径比较 Session cwd 绑定与权限边界，全面兼容 Windows 盘符大小写、正反斜杠分隔符、长路径扩展前缀（`\\?\\`）、UNC 路径与符号链接；浏览器端将物理身份校验交由 Host。

### English

#### Added

- Give the Main Dashboard direct Workspace-root HEAD history, capped at 200 committed entries with `truncated` on a 201st record, plus a live **Uncommitted changes** target when the root is dirty; Main omits baseline and comparison-summary targets while supporting committed multi-selection, per-commit diff segments, and working-tree files and diffs.
- Let the Dashboard edit both Worktree and Main instructions; Main text is stored in the v6 Workspace-shard `mainInstructions` field and injected into known-Workspace Sessions without an active Worktree binding.

#### Improved

- Upgrade the sidecar schema to v6 with strict Workspace-shard `mainInstructions` support and optional `baseCommit`, while continuing to read v1–v5 historical records.
- Make the Dashboard Open In action use only DSH's official relative Host routes; keep application selection in current-page memory, use the first available application after refresh, and retain the VS Code fallback when no application is available or the Host fails.
- Make Main Git commit multi-select use the normal committed aggregate projection: authorize SHAs against visible Main history and return a changed-file union with one diff segment per commit; the live working-tree target remains single-select.
- Let Main skip baseline/Overview reads while lazily loading bounded HEAD history in Git & Changes.

#### Compatibility

- Fix Windows Sidecar atomic writes by syncing temporary files through writable handles and surfacing file-sync failures while keeping directory sync best effort; normalize VS Code links by stripping only drive/UNC extended prefixes and using / separators, leaving unknown namespaces unchanged.
- Support Git for Windows's `NUL` device path and CRLF Worktree porcelain output, and avoid legacy Node Windows signal-0 behavior killing live lock owners.
- Compare Session cwd bindings and permission boundaries by physical path so Windows drive casing, path separators, extended prefixes (`\\?\\`), UNC paths, and symlinks remain compatible; the browser delegates physical identity validation to Host.

## 0.1.13 — 2026-09-17

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
- 将 Overview 中的基线编辑改为铅笔图标入口和固定尺寸的 DSH 弹窗：搜索框常驻顶部，下方是有固定高度、可滚动的 branch 列表（默认展示约七条），过滤 branch 只替换列表内容而不改变弹窗尺寸。
- 收窄 Git 读取成本：working-tree 的存在性与路径授权改用仅路径 projection，未跟踪文件的行数统计限定为前 50 个（其余显示“未知”），多选 commit 的归属校验改为基于一次固定的 history projection，二进制基线不再经过文本临时文件比较（文本基线仍使用临时文件执行 `--no-index` 比较）。
- changed-file 行改用文件名的颜色区分增删改，并在行标题与无障碍标签中给出本地化状态；超过 2000 行的 Diff 会先折叠并可手动展开；Main 的“Git 与变更”视图不再发起任何 Git 读取。
- 在提交栏标题增加默认关闭的**多选提交**开关：关闭时点击 commit 直接查看该 commit 自己的 Diff，打开后才启用多选提交；关闭开关时会把多选收敛回当前聚焦的 commit。
- 移除变更文件中每行的“在侧栏打开”入口，打开文件统一由汇总 Diff 工具栏的**在侧栏打开**提供；该按钮改用方形右上箭头图标，修正原先 icon 被压缩、与文字基线不对齐的问题。
- 可拖动分割线补齐两侧边线：上下分割线同时绘制上边和下边，左右分割线同时绘制左边和右边，两侧面板的边界更清晰。

#### 修复

- 修复创建恢复可能用 Worktree 实时 HEAD 覆盖不可变获取 commit `baseCommit` 的问题：创建后校验与崩溃恢复只在适配器无法捕获时补齐该值，被中断创建后已继续提交的 Worktree 不再把自己记录为基线。
- 修复未保存基线（或基线等于当前 branch）时 Git 与变更 Tab 无法读取的问题：Git Tab 与 Overview 现在以不可变 `baseCommit` 作为隐式基线读取，并在 Base fact 展示解析出的 commit；仅当记录既无可用基线也无捕获值时才保持未选择并提示选择分支。
- 已保存的基线 branch 被删除后，history 与 Overview 返回 `baseline-unknown` 的显式不可用状态，而不是通用 Git 失败；完整 ref 路径（如 `refs/heads/...`）、tag、远端引用与 revision 表达式仍被直接拒绝。
- 超过 Provider 输出上限的 changed-file 列表改为返回显式截断 projection 并在浏览器给出本地化提示，不再表现为通用 Git 错误。
- 移除没有调用方的 `isCommitAncestor` 与 `isExactCreatedWorktree`，并修正本分支新增测试文件中的 lint 错误，使 `pnpm run lint` 通过。

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
- Replace the Overview baseline editor with a pencil-icon trigger and a fixed-size DSH dialog whose search field stays above a fixed-height, scrollable branch list (about seven rows by default); filtering local branches swaps the rows without resizing the dialog.
- Tighten Git read cost: working-tree presence and path authorization use a paths-only projection, untracked line statistics are bounded to the first 50 files (the rest report Unknown), multi-commit membership is authorized against one pinned history projection, and binary baselines are no longer compared through a text temporary file (text baselines still use one for the `--no-index` comparison).
- Mark changed-file rows with the filename color while keeping a localized status in the row title and accessible label; fold diffs past 2000 rendered lines behind a reveal action; and issue no Git read at all for the Main Git & Changes view.
- Add an off-by-default **Multi-select commits** switch to the commits header: clicking a commit shows that commit's own diff, the switch enables additive multi-selection, and turning it off collapses the selection back to the focused commit.
- Remove the per-row open-in-sidebar action from changed files so the summary diff toolbar's **Open in Sidebar** is the only file reveal action, and swap its icon for the square right-up arrow so it keeps its aspect ratio and centers with the label.
- Draw both edges of each draggable divider: the row divider now draws its top and bottom lines and the column divider draws its left and right lines, so the panes on either side each get their own edge.

#### Fixed

- Stop creation recovery from overwriting the immutable acquisition commit `baseCommit` with the live Worktree HEAD: post-create inspection and crash recovery now only fill that value when the adapter could not capture it, so a Worktree that kept committing after an interrupted create is no longer recorded as its own baseline.
- Let the Git & Changes tab read a Worktree whose saved baseline is absent or equal to the current branch: the Git tab and the Overview now read against the immutable `baseCommit` as the implicit baseline and show the resolved commit in the Base fact; only a record with neither a usable baseline nor a captured value stays unselected and prompts for a branch.
- Report an explicit `baseline-unknown` unavailable state for history and Overview when a saved baseline branch no longer exists, instead of a generic Git failure; full ref paths such as `refs/heads/...`, tags, remote-tracking refs, and revision expressions are still rejected outright.
- Return an explicit truncated changed-file projection with a localized browser notice when a list exceeds the Provider output bound, instead of a generic Git error.
- Remove the unused `isCommitAncestor` and `isExactCreatedWorktree` surfaces, and fix lint errors in the branch's new test files so `pnpm run lint` passes.

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
