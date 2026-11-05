# 活跃范围筛选视图（今日 / 24 小时 / 7 天 / 全部）

日期：2026-11-03
范围：`packages/clutch-dsh-worktree` 客户端侧栏导航（`shell.overlay`）
状态：已实现

## 背景与目标

Worktree 侧栏此前只有搜索这一个收窄维度。随着 Workspace、Worktree 与 Session 数量增长，
"我今天在哪些地方工作过"无法在树中直接回答。本次在侧栏顶部（标题栏之下）增加活跃范围选择器，
把整棵树收窄到：

| 范围 | 语义 |
| --- | --- |
| 今日 `today` | 本地日历零点之后有活动 |
| 24 小时 `last24h` | 从当前时间向前 24 小时滚动窗口 |
| 7 天 `last7d` | 从当前时间向前 7 天滚动窗口 |
| 全部 `all` | 不过滤（默认值，保持升级前的完整树） |

"活跃"只使用客户端已经持有的原生 Session 事实，因此该视图不需要新的 Host 能力。

## 语义定义

一条 Session 在所选范围内视为活跃，当且仅当满足任一条件：

1. 正在运行（`SessionPresentation.ongoing`，包含运行中的子代理）；
2. 等待交互（`SessionPresentation.status.state === 'warning'`：审批、计划审核、回答）；
3. 最近更新时间 `updatedAt` 落在范围内（含下界）。

派生规则：

- **当前 Session 永远可见**。否则用户切到"今日"时可能看不到自己正在用的会话，导航会变成陷阱。
- **Workspace 与 Worktree 结构始终渲染**（搜索没有匹配项时除外）。范围只隐藏 Session 行；
  分类、空分组与管理入口保留，记录、目录与绑定不变。
- **Session 行**先按 `archivedSessionIds` 与 `sessions.ids` 收敛，再由范围谓词过滤；空白 Session
  只在它是当前 Session 时可见。
- 搜索与范围为独立维度：搜索收窄 Workspace/Worktree 结构，范围只收窄其下的 Session 行。
- 计数与过滤共用同一谓词，标签数字不会与树内容不一致。

## 筛选器可见性（2026-11-04）

范围栏右侧新增一个常驻的下拉勾选菜单，用来决定哪些范围显示为上方标签：

| 行为 | 语义 |
| --- | --- |
| 勾选 | 该范围重新出现在标签栏，并插回固定顺序（今日 → 24 小时 → 7 天 → 全部） |
| 取消勾选 | 该标签从范围栏移除；筛选谓词、计数与树内容不变 |
| 隐藏当前范围 | 选择自动移到顺序上的下一个可见标签（末尾回绕）；Session 行按新范围收窄，Workspace/Worktree 结构不变 |
| 仅剩一个范围 | 该范围的复选框禁用，提示"至少保留一个筛选"，避免范围栏失去全部标签 |
| 范围无 Session | 结构保持可见，范围计数显示 0；搜索无匹配时仍由 `workspace.noMatches` 单独提示 |
| 持久化 | 可见范围集合与 `activityWindow` 共用 `clutch-dsh-worktree.view-mode`；旧版本载荷缺少该字段时回退为四个范围全部可见，非法项与重复项被过滤 |
| 菜单状态 | 展开状态只存在于当前渲染，不持久化；菜单复用 DSH `Menu`，支持 Esc/点击外部关闭与方向键行走 |

实现要点：

- `activity-filter.ts` 新增 `effectiveActivityWindows`（持久化守卫 + 固定顺序 + 非空回退）、
  `toggleActivityWindow`（返回原数组表示无变化）与 `nextActivityWindow`（隐藏当前范围时的交接）。
- store 新增 `setActivityWindowVisible`，在同一个 draft 中同时更新可见集合与所选范围，避免两次持久化。
- `ActivityFilterBar` 只渲染可见范围；右侧按钮使用 `IconSlidersTwoOutline16`，菜单行为
  `role="menuitemcheckbox"` + `aria-checked`，每行仍带本地化计数。
- 标签栏与右侧按钮分离：`.activityTabs` 独占横向滚动，按钮固定在右边缘，不会被标签挤出。

## 实现分解

| 文件 | 职责 |
| --- | --- |
| `src/client/view/activity-filter.ts` | 纯逻辑：窗口下界、活跃谓词、候选会话集合、范围计数、可见集合守卫/切换/交接、`ActivityFilterView` 读面 |
| `src/client/surface/state/useActivityFilter.ts` | 共享偏好读取、60 秒时钟、可见范围、菜单状态、`isActive`/`hasActiveSession`/`count` 与写回 |
| `src/client/surface/components/ActivityFilterBar.tsx` | 顶部范围标签 + 右侧可见范围勾选菜单（`role="group"`、`aria-pressed`、`menuitemcheckbox`） |
| `src/client/surface/components/WorkspaceTree.tsx` | Workspace / Worktree 结构保留、Session 行过滤与 `resetKey` |
| `src/client/surface/components/ActiveWorktree.tsx`、`ArchivedWorktree.tsx` | 保留 Worktree 行，仅过滤叶子 Session 行与分组状态聚合 |
| `src/client/surface/components/ArchivedWorktrees.tsx` | 归档分组计数与聚合状态按范围收敛 |
| `src/client/view/view-mode.ts`、`view-mode-store.ts` | `activityWindow` + `activityWindows` 持久偏好与 `setActivityWindowVisible` action |
| `src/client/worktree.css`、`locales.ts` | 顶部标签栏、右侧按钮与勾选行样式，中英文文案（`activity.*`、`filter.*`） |

## 保持的不变量

- **数据所有权**：不新增 Sidecar 字段、不写 DSH Session/Workspace、不读取或修改业务目录。
- **最小刷新作用域**：筛选不触发任何读取；切换范围只重渲染，不推进 reader 代次、不刷新其他 Workspace。
- **保持 ready 内容**：范围切换不清空投影，不产生 loading 或白屏。
- **Git 与破坏性操作**：与筛选无关；被隐藏的记录不改变任何门禁。
- **浏览器本地偏好**：与 `viewMode` 共用 `clutch-dsh-worktree.view-mode` 键；非法持久化值回退 `all`，
  可见范围集合回退为四个范围全部可见且永不置空。

## 验证

```bash
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree test
node --test test/readme-parity.test.mjs
```

新增 `test/client-activity-filter.test.mjs` 覆盖：窗口下界与本地零点、非法时钟、持久化值守卫、
运行中/等待交互的活跃语义、下界含等号、当前 Session 恒可见、`updatedAt` 回退来源、
顺序保持、归档与空白排除、四个范围的计数一致性；以及可见范围守卫/切换/交接、只渲染勾选的
标签、勾选菜单语义与"仅剩一个范围不可取消"。

## 后续调整

- **移除 Worktree 级空文案**（2026-11-04）：Main 行下方原先在"全部"范围显示"暂无 Worktree"，
  但 Main 行本身已代表 Workspace 的本地 checkout，且其他范围都没有这一行，显得多余且不一致。
  现已删除该空状态及其 `worktree.noWorktrees` 文案与 `.emptyNested` 样式。
- **范围只过滤 Session 行**（2026-11-05）：原先范围会连 Workspace、Worktree 与已归档 Worktree
  一起隐藏，导致用户无法判断结构是否存在，也找不到创建/导入、Dashboard、归档与清理入口。
  现在 Workspace / Worktree 行始终保留（搜索仍可收窄结构），范围只过滤叶子 Session 行与
  分组状态聚合；`filter.empty` / `filter.emptyHint` / `filter.emptyHintMenu` 与 `.emptyHint`
  不再需要，已删除。

## 遗留与后续

- **截图与 Features 表**：本次未新增 `assets/screenshots/` 图片，因此没有向两份 README 的
  Features 表新增行；已在实际运行的 DSH 中完成视觉验证后再补截图与表格行，并同步 `screenshots.json`。
- **Worktree 级独立活跃信号**：当前"活跃"完全由 Session 派生。若后续需要"今天创建的 Worktree
  即使还没有 Session 也显示"，可以引入 `createdAt`/`importedAt`（获取事实，已在 Sidecar 中）作为
  补充条件；这会改变语义，需要人类确认。
- **长期活动的低成本刷新**：目前 60 秒重算一次计数与边界。若树规模显著增长，可改为只在范围切换、
  Session 列表变化或文档可见性恢复时重算。
