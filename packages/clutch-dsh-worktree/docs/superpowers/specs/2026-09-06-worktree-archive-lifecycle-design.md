# Worktree 归档、磁盘清理与移出管理设计

后续修订：本文件的活动门禁已被用户确认的
[清理确认方案](2026-09-06-worktree-user-confirmed-cleanup.md)取代；其他生命周期规则保留。

日期：2026-09-06。

状态：交互、生命周期与书面规格均已获用户确认；实施计划已编写，尚未进入实现。

目标 package：`@cerbur/clutch-dsh-worktree`。

工作分支：`wt-worktree-0.1.10/feat-fold-invalid-worktree`。

## 1. 问题与目标

现有 `removeWorktree` 将 Git 删除、`status = removed` 和 binding detached 合并成一个动作。
用户需要先收纳不再活跃的 Worktree，再独立决定是否删除磁盘目录或退出插件管理。

本次将三种用户意图区分为三个操作：

| 操作                  | 插件记录                                                          | Git 与目录                         | DSH Session                                               |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| 移除／归档            | `active → removed`，保留 binding                                  | 不修改                             | 不归档、不删除，已有 active binding 继续使用 Worktree cwd |
| 清理磁盘上的 Worktree | 保留 removed 记录，保存清理完成事实，active binding 转为 detached | 确认后执行非强制 Git worktree 删除 | 不归档、不删除                                            |
| 移出 DSH 管理         | 删除该 Worktree 记录及全部 binding，撤销浏览器投影                | 不修改                             | 保留，恢复 DSH 原生归属与行为                             |

本功能适用于 plugin-created 和 external Worktree，两者共享相同生命周期与确认要求。
只按 `WorktreeStatus` 收纳；active Worktree 的运行时故障不会自动触发归档。

## 2. 已选择的方案

采用“归档状态 + 持久化清理完成事实”。`WorktreeStatus` 继续只有 `active | removed`。
`WorktreeHealth` 增加 `cleaned`，health 本身仍是运行时投影，不直接写入 sidecar。

没有选择“目录不存在即 cleaned”：目录误删、Git 读取失败或挂载不可用都不能证明用户完成了清理。
也不把 cleaned 增加为第三种 WorktreeStatus，避免将收纳状态和磁盘生命周期合并。

## 3. 数据模型与状态不变量

在 Worktree 持久化记录中增加可选的 `diskCleanup: 'completed'`。
该字段只表示本记录所管理的 Worktree 已完成清理；不需要为历史数据伪造清理时间。

| 持久化状态              | health 投影                                   | 列表位置          | binding 与运行目录                                        |
| ----------------------- | --------------------------------------------- | ----------------- | --------------------------------------------------------- |
| active，无清理完成记录  | ready / repair / recovery-needed              | 正常列表          | active binding 使用 Worktree cwd                          |
| removed，无清理完成记录 | ready / repair / recovery-needed              | 已归档分组        | 原有 active binding 保留；目录有效时继续使用 Worktree cwd |
| removed，清理完成       | cleaned；有未决恢复问题时优先 recovery-needed | 已归档分组        | 保留 detached binding，沿用现有 Workspace-root cwd 解析   |
| 不再有插件记录          | 不投影                                        | 不显示该 Worktree | 不再提供插件 Worktree binding 或 cwd 覆盖                 |

不变量：

- `diskCleanup = completed` 只能出现在 removed 记录上，且不能存在指向该记录的 active binding。
- active binding 可以指向 active Worktree，也可以指向尚未清理的 removed Worktree。
- 一个 Session 最多拥有一个 active binding；重复绑定到同一有效记录保持幂等。
- 归档不会把已有 detached binding 自动恢复为 active。
- 未清理记录的目录缺失、仓库身份异常或 Git 无法验证时显示 repair / recovery-needed；
  active binding 的 cwd 解析明确报错，不静默切换目录，也不自动生成清理完成记录。
- cleaned 是旧 Worktree 身份的终态。相同路径后来出现新目录，不使旧记录恢复可用，
  也不重新显示旧记录的清理菜单；用户先移出旧记录，再按当前候选规则重新导入。

## 4. Sidecar v4 与旧数据迁移

现有 v3 严格校验 active binding 必须指向 active Worktree，因此本次升级为 v4，
不能在同一个 v3 schema 下悄悄改变不变量。继续支持 v1、v2、v3 的有效数据读取。

- 旧 active 记录迁移后保持 active，不添加清理完成字段。
- 旧 removed 记录按旧版“Git 删除已完成”的语义转为 removed + diskCleanup completed，
  保留 detached binding，绝不将它解释为新版“仍保留磁盘的归档”。
- 该迁移继承的是旧记录的完成事实，不证明今天同一路径不存在，也不授权删除后来出现的目录。
- v1 的 source 继续归一化为 plugin；保留 v2/v3 的显式 source。
- v1/v2 的 revision 继续从 0 归一化；v3 保留 revision 与 opaque repository fingerprint。
- 读取只在内存中归一化；第一次成功 mutation 在现有跨进程锁内原子发布 v4。
- 旧 v3 pending remove 必须保留旧版磁盘删除语义：只有身份与 Git 结果可验证时，
  才完成 removed + cleaned + detached；不能因新 remove API 变为归档而丢弃旧 pending marker。
- 未决旧 pending create 沿用安全恢复规则。损坏、未知 schema、无效 binding 和不确定身份
  继续报错，不清空、不通过迁移“修复”为另一组数据。
- 旧 plugin 不能读写 v4；升级后需重新加载 Host 与浏览器 Client，不支持新旧版本混写同一 sidecar。

## 5. 三个操作与原子性

### 5.1 移除／归档

保留 `removeWorktree` 入口，但语义改为内部归档；用户文案明确说明保留目录与 Session。
新增 `cleanWorktree`、`forgetWorktree`，分别承担清理与移出管理。
三个入口沿用 `workspaceId`、`worktreeId`、`mutationToken` 的身份与过期检查方式。

归档在 Workspace shard 锁内重新读取记录、校验 token，然后只修改 status。
它不调用 Git mutation、不变更 binding、不触发 detached Session 的权限归一化。
Session 正在运行时仍允许归档。已归档记录在重新读取后再次归档是无副作用操作；
旧 token 仍返回状态冲突，不能借幂等跳过版本校验。

归档保留原 worktrees 数组相对顺序；UI 通过按 status 分组投影收纳，无需新增归档时间字段。
未决 Git/sidecar 恢复问题不能通过归档被隐藏或清除。

### 5.2 清理磁盘上的 Worktree

仅对 removed、未完成清理的记录开放。确认框显示完整路径，并说明将删除 linked Worktree
目录、保留 Session 与归档记录。plugin 与 external 来源都使用这份明确的删除提示。

执行顺序：

1. 获取 Workspace 与 repository 锁，重新校验 token、Worktree 与仓库身份，以及关联 Session 活动。
2. 写入独立的清理 pending marker；磁盘清理日志使用 `clean-worktree`，与内部归档区分。
3. 通过现有 Git adapter 执行非强制 `git worktree remove`，不删除 branch，不额外删除业务文件。
4. 验证原 linked Worktree 注册与目标目录均已消失。
5. 原子写入清理完成事实、将该记录的 active binding 转为 detached，并清除 pending marker。
6. 刷新所属 Workspace；沿用现有 detached 权限归一化流程，能力缺失或失败继续显示可重试提示。

Git 拒绝清理时保留 removed 状态、原 binding 和清理选项。Git 已完成而 sidecar 发布失败时，
保留持久化 pending marker，显示 recovery-needed；安全恢复成功前不提前显示 cleaned。
重启恢复只核验并完成已知操作，不执行猜测性删除。

目录意外缺失的 repair 记录不自动标 cleaned。显式清理时，若无法建立与该记录匹配的
安全删除或已完成操作证据，返回可诊断错误；仍可在没有未决事务时移出管理。
缺失路径不进入通用递归删除，身份已被替换时不删除替代目录。

### 5.3 移出 DSH 管理

仅对 removed 记录开放，cleaned 与尚未清理的记录均可执行。
确认文案说明会移除插件关系，保留磁盘与 DSH Session，原有分组关系不会在重新导入时自动恢复。

在 Workspace shard 锁内重新验证身份、token、运行状态与未决操作，
原子删除目标 WorktreeRecord 及所有指向它的 active/detached binding。
不修改其他 Worktree、Workspace shard 的共享身份信息或其他记录的关系。

存在目标相关或 shard 级未决事务时，先返回 recovery-needed，不能靠删除索引掩盖半完成的 Git 操作。
普通 repair、路径不存在或仓库不可用本身不要求执行 Git，不能因此阻止可安全完成的纯索引移除。

成功后清理对应的浏览器展开/排序状态、权限提示、Session 恢复任务和 membership projection，
防止异步旧结果重建已移除的关系。失败保留原分组与关系并允许重试。
记录已经不存在时重复请求是无副作用成功；同路径的新记录使用新 worktreeId，不受旧请求影响。

重新导入遵循既有有效候选规则：同仓库、非根目录、branch-attached、尚未管理。
产生新的 Worktree 身份，沿用正常导入后的 Session 流程，不自动重建旧 binding。

## 6. Session 行为、权限与运行保护

归档后的已有 Session 可以继续打开、运行，cwd 解析、上下文显示和权限前置条件都按
“binding 有效且 Worktree 未清理”判断，不再统一以 `status === active` 判断可用性。
保留现有原生 Session 菜单；原生 Fork 产生的 child 在父 binding 有效且目录可用时，
继续继承同一 Worktree binding。归档行隐藏 `+` 只限制该行的新建入口，不破坏原生 Fork。
清理后 detached Session 的 Fork 沿用原生行为，不重新绑定到 cleaned 记录。

清理磁盘和移出管理检查该记录的全部关联 Session，不只检查展开、搜索可见或未归档的行。
Host 从 DSH 读取 Session/Agent 活动摘要，包括运行中的子代理；等待批准、等待回答和停止中但尚未结束
的执行不能当成已经空闲。能力缺失、读取失败或覆盖范围不完整时按 unknown 拒绝执行。
不通过加载 transcript 获取活动信息，不替用户停止或取消 Session。

Client 在关联 Session 忙碌时禁用操作并说明原因；Host 在取得 mutation 锁后、实际副作用之前
重新校验，拒绝忙碌或 unknown 状态，不能信任浏览器传入的 idle 值。
活动状态与错误投影需要使列表刷新后仍能解释当前操作不可用的原因。

本期的运行保护是执行前的最新状态校验。插件的 Workspace/repository 锁只串行化插件操作，
并不能阻止 DSH 的其他原生入口在检查后启动 Session；不能宣称具备覆盖所有原生执行入口的互斥锁。
实现计划必须核对 DSH 生命周期能力并测试该检查边界，不通过新增 DSH mutation 或修改上游源码
假造原子互斥。若实际能力不能可靠读取活动，相关操作保持拒绝并显示能力不可用。

移出管理后，Session 回到 DSH 原生归属与 cwd 行为，不保证进入当前 Workspace 的“本地”分组。
plugin-created Session 的 Workspace membership 可能仅来自浏览器投影；撤销投影不写回 native
Workspace.sessionIds，也不改 Session metadata。清理后的 Workspace-root cwd 指既有插件 resolver
契约，不意味着改写 DSH 原生 Session header.cwd。

## 7. Workspace 已归档折叠分组

- 每个 Workspace 的正常 Worktree 列表底部增加“已归档 / Archived”折叠分组。
- 默认折叠，显示 Worktree 数量；没有 removed 记录时隐藏。展开状态只保存在浏览器本地。
- 正常区保留 Main 和 active Worktree；active + repair / recovery-needed 不自动移入归档。
- 归档区保留 Worktree → Session 层级，沿用每组默认五行及展开更多的规则。
- removed Worktree 隐藏新建 Session 的 `+`，保留已有 Session 打开与原生菜单。
- 菜单包含复制路径、清理磁盘上的 Worktree、移出 DSH 管理；cleaned 后隐藏清理项。
- 忙碌时后两项禁用并解释原因；未知运行状态或恢复问题也有明确的不可执行原因。
- 归档分组以及其内部折叠行沿用正在运行的聚合状态提示，归档不会把运行活动变成不可见事实。
- active Worktree 的拖动仍限定所属 Workspace 的正常列表；本期不新增归档区拖动或跨分组拖动恢复。
- 首版不新增“恢复归档”操作；有效目录可以在移出管理后重新导入。
- 当前打开的 Session 不因归档被关闭或跳转；清理或移出后更新对应上下文，保留 Session 本身。

## 8. 模块职责与刷新

| 模块     | 本次职责                                                                               |
| -------- | -------------------------------------------------------------------------------------- |
| contract | Worktree 状态与清理事实 vocabulary、cleaned health、三种 mutation contract 与错误 JSON |
| provider | v4 读写迁移、锁与 token、清理 pending journal、Git 验证与安全恢复、只读活动 port       |
| manage   | 归档/清理/移出用例、活动前置检查、binding 与 cwd 规则、health 投影                     |
| host     | 从真实 DSH 服务组合只读活动 adapter，暴露现有 Typert /api Remote                       |
| client   | 按 status 分组、菜单与确认、活动提示、局部刷新、投影与恢复任务清理                     |

归档 UI 与 mutation action 的新增逻辑抽成局部模块，通过已有 facade 使用；不继续向大型
WorktreeSurface 组件堆积存储或生命周期判断，也不进行无关的整体重写。

三种 mutation 都只刷新所属 Workspace；只有当前 Session/Workspace 受影响才使其 context 失效。
ready 内容在读取和错误重试期间保留。相同目标的 in-flight reads 继续共享，旧响应不能覆盖
新的归档/清理/移出结果。Worktree 局部变化沿用 Workspace-scoped listBindings 加局部合并。

连接、Gateway、domain、运行状态未知和恢复失败分别保留可诊断结果，不伪装为空列表或成功。
旧 Client 需要重新加载新的 contract 与交互；Host 不从旧 removeWorktree 调用执行磁盘清理，
权限归一化也必须独立验证 binding 已 detached，不能因调用过 remove 就降低有效 binding 的权限。

## 9. 验证与验收

| 范围       | 必须验证的结果                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 状态与 cwd | active、归档但有效、归档且 repair、cleaned/detached、移出管理；归档不换 cwd，异常不静默回退         |
| binding    | 归档保留 active；同目标重试幂等；跨目标冲突；Fork 继承未清理 binding；cleaned 不新增 active binding |
| 纯索引操作 | 归档和移出管理不调用 Git mutation；保留其他 Worktree 与原始 DSH fixtures                            |
| 磁盘清理   | plugin/external 使用真实临时 Git 仓库；脏目录拒绝、无 force、branch 保留、身份替换不删除            |
| 事务恢复   | Git 成功/sidecar 失败、进程中断、pending 旧 remove 与新 clean 恢复；不提前显示 cleaned              |
| 并发       | 跨进程锁、过期 token、清理与移出竞争、活动在弹窗打开后变化、Host 忙碌/unknown 拒绝                  |
| 活动读取   | 真实 DSH 服务结构的只读活动投影，包含子代理与未结束的等待状态，不靠只包含 running 的假 fixture      |
| 迁移       | v1/v2/v3 → v4、旧 removed 不重新激活、首次 mutation 才写入、损坏不重置、新旧 pending 区分           |
| 移出后导入 | 记录/binding/浏览器恢复状态都移除；磁盘仍有效时能重新导入，不恢复旧绑定、不复用旧 Worktree 身份     |
| UI         | 分组空态、数量、默认折叠、菜单条件、确认完整路径、运行禁用、双语文案、已有 Session 可打开           |
| 刷新       | 三种动作成功/失败/重试均不白屏，只更新所属 Workspace，旧响应不重建已移出的分组                      |
| 数据边界   | DSH Workspace、Session、消息与历史 fixture byte-for-byte 不变；仅既有权限服务处理 detached 权限     |

实现阶段从 workspace 根目录执行既有检查：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

文档阶段只验证本文格式、引用、设计一致性和 git 变更范围，不把上述命令记为已经运行。

## 10. 文档同步与工作边界

实现前先更新 package AGENTS.md 中的关系、schema、health、cwd 和删除顺序约束；
实现时同步 README.md、README.zh.md、src/client/README.md 与受影响的 Remote/生成测试。
bootstrap 计划中的旧删除约定通过追加 amendment 指向本文；旧 Git mutation kernel spec
保留历史事实，并注明磁盘删除能力由新的 clean 操作继承。

涉及 DSH capability 依赖或入口变化时同步 package manifest、patch、发布文档与生成 contract。
新增的截图放入 package assets/screenshots，并在双语公开 README 中同步引用。

本阶段只交付设计文档。提交、版本递增、release log、rebase/merge、打包和发布按仓库约定
分别处理，本次设计批准不自动授权这些操作。书面规格审阅后才进入 writing-plans。

## 11. 设计依据与自检

- [Package architecture](../../../AGENTS.md)
- [Public behavior](../../../README.md)
- [Client contract](../../../src/client/README.md)
- [Original implementation plan](../plans/2026-08-18-clutch-dsh-worktree.md)
- [Git mutation kernel](2026-08-28-worktree-git-mutation-kernel.md)
- [Minimum-scope refresh](2026-09-03-worktree-minimum-scope-binding-refresh-design.md)

代码核对基线为 feature worktree 的 bcb73bc。当前 Host read adapter 仅投影 Session id/cwd，
不能据此判断是否运行。另只读核对本机 DSH checkout a66e470204：
`packages/api/session-controller/src/list.ts` 从 `ctx.agents` 读取 running 状态，
因此活动能力必须从实际 Agent/子代理服务适配，不能假定 Session header 存在 running 字段。
该源码观察只证明活动读取方向，不证明已具备插件 mutation 与原生 Session 启动的共同锁。

自检结论：三种动作分离；归档状态不再等同磁盘删除；历史 removed 不恢复 binding；
cleaned 依赖完成事实；Session 数据边界、未知运行状态、恢复顺序、局部刷新和移出后的原生归属
均有明确规则。运行校验的并发边界已单独列出，不把未验证的上游能力作为既成事实。
