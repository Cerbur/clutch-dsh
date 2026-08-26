# Draft TODO 5：拓展 Worktree 管理能力，支持导入并管理非 plugin 创建的 Worktree

**状态：** Design confirmed; implementation plan available
**设计文档：** [2026-08-26-worktree-external-import-design.md](../specs/2026-08-26-worktree-external-import-design.md)
**实现计划：** [2026-08-26-worktree-external-import.md](../plans/2026-08-26-worktree-external-import.md)

**来源：** 用户提出的 0.1.6 第 1 项。

## 目标

拓展 Worktree 管理能力，覆盖 plugin 创建与外部（非 plugin 创建）两类 Worktree：

- plugin 创建的 Worktree 继续保存到 plugin 目标目录（现状：`<dshHome>/clutch-dsh-worktree/worktree/<worktreeId>`）。
- Workspace `+` 继续打开同一个 Worktree 弹窗，提供「创建」或「导入」两个横向 Tab：
  - **创建**：沿用现有流程，创建一个新的由 plugin 管理的 Worktree（目录位于 plugin 目标目录）；
  - **导入**：从 Git Worktree 列表展示当前 Workspace 的候选项；登记已有 Worktree（目录不移动、不复制、不修改），然后复用创建 Worktree 后的 Session、binding、membership projection、打开、刷新和错误恢复流程。

## 已完成调研

### 现有创建流程（`src/manage/manager-worktrees.ts` 的 `createWorktree`）

1. `requireWorkspace()` 从 DSH read adapter 取得 workspace root，校验绝对路径与存在性；
2. 校验 base branch 存在、new branch 不与现有 branch/已 checkout 分支冲突；
3. 生成 `worktreeId` 与 target path `<dshHome>/clutch-dsh-worktree/worktree/<id>`，先做词法边界校验（`validateGeneratedPath`）再做物理/symlink 边界校验（`validatePhysicalGeneratedPath`），拒绝已存在路径；
4. 先执行 `git.createWorktree(workspace.rootPath, targetPath, baseBranch, newBranch)`，再在 sidecar mutate 内写入 `WorktreeRecord`（重复 ID/branch 在序列化 mutation 内复查）；
5. `WorktreeRecord = { worktreeId, workspaceId, absolutePath, branch, source, status }`，其中 `source` 为 `plugin` 或 `external`，status 只区分 `active` 与删除后的保留状态。

### sidecar 是唯一管理边界

- `listWorktrees` 只返回 sidecar 中记录的 Worktree；Git 里已 checkout 但 sidecar 未记录的目录就是「外部 Worktree」。
- 判定「是否已由 plugin 管理」应以 sidecar 记录为准，并用绝对路径/物理路径去重（`samePhysicalPath` 已用于 Git 与记录的对齐，可复用）。
- 目录「不动」意味着导入只写 sidecar 关系索引，不执行任何 Git mutation，也不修改外部目录内容。

## 已确认的实现方向

1. Contract 扩展：为 `WorktreeRecord` 增加来源标识（例如 `source: 'plugin' | 'external'`），或新增独立 `importWorktree` API；sidecar schema 需要版本化迁移，保证旧数据可读。
2. Manager 新增导入语义：
   - 校验输入路径是绝对路径、属于该 workspace 的 Git worktree（`git.listWorktrees` 可列出）、目录存在；
   - 校验 sidecar 中不存在相同 `absolutePath` 或相同物理路径（`samePhysicalPath`）的任何已管理记录；同一 Workspace、同一物理路径的 active external 记录幂等返回，plugin 或不兼容记录返回 `WORKTREE_ALREADY_MANAGED`；
   - 导入写入的 record 目录保持不动，不执行 `git worktree add` 或其他目录操作；后续删除仍复用真实 `git worktree remove`。
3. Client 交互：Import Tab 只展示未被 sidecar 管理、非 repository root、存在 local branch 的 Git Worktree；第一版不展示 detached HEAD。导入成功后走与创建一致的 Session、binding、projection、open、refresh 和 recovery。
4. 删除/解绑/binding/Session 创建复用现有能力。plugin-created 和 external Worktree 都支持真实 `git worktree remove`；external 删除具有破坏性，确认文案必须明确说明可能删除关联 Worktree 目录。

## 已确认的边界

- 外部 Worktree 可以位于任意绝对路径，但必须是当前 Workspace repository 的已登记、存在且 branch-attached 的 Git Worktree；repository root、detached HEAD、相对路径、缺失路径和其他 repository 的路径拒绝并返回 `WORKTREE_IMPORT_INVALID`。
- 导入只登记 sidecar 关系，不修改 DSH 原始 Workspace/Session 数据和外部工作树；Git/目录保持不变。
- sidecar 从 schema v1 迁移到 v2：旧记录读取时归一为 `source: plugin`，只读读取不写文件，下一次成功 mutation 原子写入 v2。
- 与 rc.8 Client projection（虚拟 Workspace membership）叠加：导入记录与创建记录使用同一投影、Session 和刷新生命周期。
- 导入时 branch 冲突语义不变：外部 Worktree 已 checkout 的 branch 会继续使后续 plugin 创建同 branch 的 Worktree 返回 `WORKTREE_BRANCH_CONFLICT`。
- 删除语义已确认：Git remove 成功前不改变 sidecar；Git 成功后才标记 removed 并将 binding 置为 detached。若 sidecar 同步失败，保留可诊断、可重试的同步状态。

## 验收草案

- 选择外部 Worktree → 创建：生成 plugin 目标目录下的新 Worktree，流程与现状一致；
- 选择外部 Worktree → 导入：sidecar 出现 `source: external` 记录，目录和 Git 状态未被导入改变；随后 binding、Session 创建、health 展示、排序、cwd、projection、打开、刷新与自主创建一致；
- 对已管理的 Worktree 再次导入/创建 → 明确错误提示，不产生重复记录；
- 非 Git worktree、相对路径、不存在的目录 → 拒绝并给出可诊断错误；
- sidecar 迁移后旧数据可读；DSH 原始 Project/Session 数据 byte-for-byte 不变；
- 回归测试覆盖导入幂等、重复导入拒绝、外部目录不被写、refresh 后列表一致。

## 相关代码

- 本插件：`src/manage/manager-worktrees.ts`、`src/manage/manager-support.ts`（`requireWorkspace`、`samePhysicalPath`、`validateGeneratedPath`）、`src/provider/sidecar-schema.ts`、`src/provider/sidecar.ts`、`src/provider/git.ts`、`src/contract/index.ts`、`src/client/worktree-view.ts`、`src/client/worktree-view-actions.ts`、`src/client/WorktreeSurface.tsx`、`src/client/worktree-surface-dialogs.tsx`
- 现有测试：`test/`（manager/sidecar/client fixture）
