# Worktree 归档链路审查修复规格

日期：2026-09-06  
状态：修复规格与验收要求已整理；实现与验收尚未执行。  
审查基线：`e6a263405af7c53d3909f5a325bdf83fa6064a13`。

本文件补充[原归档设计](2026-09-06-worktree-archive-lifecycle-design.md)，用于修复该提交审查发现的 8 个问题。原设计中未被本文件明确细化的语义继续生效。执行步骤见[修复计划](../plans/2026-09-06-worktree-archive-review-fixes.md)。

## 1. 工作范围与约束

- 工作分支固定为 `wt-worktree-0.1.10/feat-fold-invalid-worktree`。
- 工作目录固定为 `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_cbf49b4e-cc8e-4428-9c14-89117f976363`。
- 业务修改仅限 `packages/clutch-dsh-worktree/`；不得修改官方 DSH 源码或其他 plugin。
- 本次不递增 package version，不执行 commit、rebase、merge、push、pack 或 publish。
- 不修改、归档或删除 DSH Session，不读取 transcript、prompt 或消息内容来推导活动状态。
- `WorktreeStatus` 保持 `active | removed`；归档仅修改插件索引，保留目录和 binding。
- `diskCleanup: 'completed'` 仅表示有可信清理事务依据的磁盘清理完成；目录缺失本身不能证明清理完成。
- sidecar 保持 v4，保留 v1/v2/v3 的迁移语义；本次不引入新持久化字段。
- 清理磁盘继续使用非 force 的 Git 删除；身份、路径、活动检查和 mutation token 校验不可削弱。
- forget 只移除目标 Worktree 的插件数据；相同路径重新导入使用新 ID，不恢复旧 binding。
- 活动状态、health、mutation token 和浏览器状态不得持久化到 sidecar。
- 所有刷新保留 ready 内容，并限制在受影响的 Worktree 或所属 Workspace。

文档编写期间，工作分支被外部操作更新为 `cdcc2532da749718ec03d1c2215706537a53b934`，已纳入这两份文档及 recovery health 按目标 Worktree 投影的补充修复。本次审查问题仍以 e6a2634 为来源；执行者必须先核对当前差异，保留已有修复，不能回退到旧提交。

原实施计划中的已勾选项目不等于修复验收证据。本次需要新增行为回归测试并记录实际执行结果。

## 2. 审查问题与修复目标

| ID  | 优先级 | 现状与触发条件                                                                        | 必须达到的结果                                                                             |
| --- | ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1  | P1     | 默认 Host 读取未注册的 `ctx.get('activitySource')`；普通已绑定 Worktree 始终 unknown  | 默认组合连接真实 DSH 活动事实，确认完整且空闲时能 clean/forget，有忙碌项或证据不完整时拒绝 |
| R2  | P2     | Archived 父组仅依赖手动展开；当前 Session 的自动 reveal 没有该父组                    | 导航或进入模式时能够展开当前 Session 的 Archived 祖先并定位，尊重手动折叠                  |
| R3  | P2     | context resolver 把所有 removed record 当作 stale                                     | removed、未 cleaned、有效 active binding 的 Session 保留 Worktree 分支上下文               |
| R4  | P2     | forget 后旧 fork/bind 异步结果再次发布 recovery 或 projection                         | 按 Worktree 身份清理浏览器状态，并淘汰该身份的过期异步结果                                 |
| R5  | P2     | busy/unknown 只在确认框阻止操作；菜单仍可点击，cleaned 的 detached binding 未计入投影 | 菜单和确认框共用活动限制，包含目标全部 binding 的 Session                                  |
| R6  | P2     | Git 清理成功后 permission RPC 失败使 action 整体失败，跳过刷新                        | 已提交的清理立即进入 cleaned UI；权限失败独立显示且只重试权限                              |
| R7  | P2     | 无 pending 的 archived 目录缺失在启动扫描中写成 recovery issue，forget 被锁死         | 普通缺失保持 runtime repair，重启不制造事务；无真实 blocker 时可纯索引 forget              |
| R8  | P2     | clean 身份预检失败先写 clean journal；随后 recover 把外部删除误认作 cleaned           | 预检拒绝不写 journal；恢复不得根据模糊历史标记推断清理成功                                 |

### R1：真实活动来源与完整性

Host 必须在 composition root 创建实际 `WorktreeActivitySource`，将其交给现有 reader；保留 source 注入供单元测试使用，但不能依赖一个无人注册的服务名。

在 shard/repository mutation 临界区内、操作开始前，以最新 sidecar 中目标 Worktree 的全部 binding 查活动。关联 Session 本身，以及以这些 Session 为祖先的运行中子任务，都会阻止 clean/forget。cleaned 后仍有 detached binding，不能因此省略这些 Session。

规则：

1. 有可信 busy 证据就返回 busy；即使剩余覆盖不完整，也不能降为 idle。
2. 只有当前快照覆盖完整且无运行项才返回 idle。
3. 缺失能力、读取失败、未知归属、dispose 或无法证明完整覆盖时返回 unknown。
4. Browser 展示的快照只用于提示；Host 必须重新读取，不能信任客户端的 idle。
5. 不承诺与 DSH 原生 Session 启动建立全局互斥锁，保证仅限操作前的即时检查。

已核对的本地官方源码为 `/Users/yuancheng/Documents/Code/deepseek-harness`，核对时 HEAD 为 `a66e4702047846cdaa10c66c9d3df3951f5ea70d`。执行时重新核对实际 HEAD：

- `agents.list()` 提供 live Agent；`status` 和 Session header 可提供运行及父子事实。
- `jobs.list(agent)` 是按 owner 读取的快照；无参数调用只返回 unowned jobs，不能当作全局列表。
- `subagents.list()` 返回 provider 名称，不返回运行列表。
- `subagent/start`、`subagent/end` 事件可维护热态观察，但单靠监听不能恢复 plugin 热加载前的运行基线。
- Session-backed descendant 列表不能直接证明非本地或 one-shot 子任务均已结束；使用任何 projection query 前要确认它不会读取消息内容。

**实现入口门禁：**先用真实默认组合验证活动覆盖，包括正在运行但父 Session 已 idle 的子任务、非本地/one-shot 子任务与热加载。当前审查没有证明现有公共 API 足以覆盖全部情况。若找不到满足边界的真实能力，记录精确缺口，将 R1 保持未完成，并继续其他独立修复；不能把固定 unknown、模拟 source 或省略子任务当作修复完成，也不能未经授权改造 upstream。

### R2：当前 Session 的归档父组

为 current-session location 增加是否属于 Archived 的事实，并将 `archived:<workspaceId>` 加入 reveal keys，位于 Workspace 与 Worktree 之间。

同一个展开判定必须同时控制父行的展开图标和子节点挂载。自动展开沿用现有 reveal/suppression 生命周期：

- 初次进入模式或切换到 Archived 中的 Session，展开其 Workspace、Archived、Worktree 及必要的 Session 分页。
- 用户手动折叠 Archived 后，同一 Session 的普通刷新不立即重新打开。
- 切换到另一个需要 reveal 的 Session 或重新进入模式，按现有导航规则产生新 reveal。
- 用户点击归档当前 Worktree，不因此立即打开 Archived；对本次归档导致的 reveal 作定向抑制。
- 非目标 Workspace 和手动展开状态不受影响。

### R3：归档后保留上下文

上下文取决于有效 binding 与 Worktree 可用性，不能用 `record.status === 'active'` 代替。有效 archived binding 继续显示同一 Worktree branch；runtime cwd 继续由原 contract 派生。

record 不存在、Workspace 不匹配、detached、cleaned、repair 或 recovery-needed 仍走现有明确的不可用上下文，不伪装成 Main。不能为修复 context 修改原生 Session header.cwd。

### R4：forget 与浏览器异步生命周期

forget 成功的时刻是目标旧 ID 在浏览器中的失效边界。失败的 forget 不清理任何 ready/recovery 数据。

成功后同步完成以下定向清理，再刷新所属 Workspace：

- 目标 Session group 展开、pending Session binding recovery 和 permission notices；
- fork coordinator 中目标 Worktree 的 recovery、正在等待的继承 binding 及其发布资格；
- 目标的 native membership projection、当前 context 缓存及旧 targeted-read 结果的发布资格。

给 fork coordinator 增加 `forgetWorktree({ workspaceId, worktreeId, sessionIds }): void`。sessionIds 是操作前已知的目标全部 binding Session ID；身份失效仍按 workspaceId + worktreeId 判断，不能按路径判断。

异步流程在 lookup、bind、retry、permission 和 refresh 的 await 前后检查目标代次。lookup 开始时尚未知 Worktree 的流程，必须同时记录 source Session 的代次，使 forget 能淘汰尚未解析出来的旧继承任务。失效标记覆盖晚到成功和晚到失败，不仅清空一次 recovery 数组。

Session 代次只淘汰旧任务，不永久封禁这个 Session：后续它绑定新 Worktree 时，新任务能正常执行。原生 fork 已创建的 child 保留；不重新创建、删除或归档 child。其他 Worktree 的 recovery、projection、进行中任务保持可用。

### R5：一致的菜单限制

菜单与确认框共用一个浏览器纯函数，将 activity、actionPending 和已有 readiness 限制映射为 disabled 与原因。activity 缺失按 unknown。

- busy：两个菜单操作均禁用，说明关联 Session/子任务正在运行。
- unknown：两个操作均禁用，说明无法确认活动状态，并保留原有定向重试入口。
- idle 且无其他 blocker：允许进入对应确认框。
- cleaned：隐藏清理菜单，forget 仍受全部 detached binding Session 的活动状态约束。

禁用原因必须可读，不能只依赖不可聚焦 disabled 项上的 hover。中英文文案同步，Host 校验不变。

### R6：清理提交与权限后续操作

清理结果拆成三个阶段：

1. manager.cleanWorktree 拒绝：保留原行为，展示失败，不伪装成 cleaned。
2. manager.cleanWorktree 成功：立即应用目标 cleaned/detached projection，关闭磁盘删除确认框并发起所属 Workspace 的 targeted refresh；刷新失败保留刚提交的 cleaned 状态，显示读取错误。
3. permission normalization 单独执行：无论权限读取/写入如何失败，都不得回滚 cleaned UI 或再次暴露磁盘删除；展示目标范围的可重试权限提示。

权限重试只调用 normalizeDetachedWorktreePermissions，不再次调用 cleanWorktree。permission 返回业务失败结果和 RPC rejection 都进入相同的恢复界面。操作中的 token 只用于本次提交，不携带到权限重试。forget 或 dispose 后晚到的权限结果不得重新建立提示。

本次不增加 Remote 方法；cleanWorktree 继续返回 Promise<void>。浏览器 action 路由保持现有 create/import 返回 record 的 contract，清理后的权限流程从破坏性 action 的 reject 链中分离。

### R7：普通缺失与真实 recovery 的区分

无 pending operation 时，Archived 未清理目录缺失是运行时 repair。不得将本次扫描观察追加成持久化 recovery issue，也不得脱离该记录去锁死整个 Workspace。

对 e6a2634 已生成的无 operationId 旧 issue，只在以下条件全部成立时允许定向撤销该普通观察：

- snapshot 无 pendingOperation；
- issue.code 为 WORKTREE_RECOVERY_REQUIRED，只有目标 archived 未 cleaned Worktree 的身份；
- issue 没有 operationId，且没有身份变化或其他不可解释的证据。

在 shard lock 内重新检查并且只移除符合上述模式的观察；其余 issue 保留，既有 mutation admission 不整体绕过。必须测试仅有该观察、混合其他 issue、真实 pending 三种情况。此规则是对该提交已知无事务扫描记录的精确兼容，不是通用“忽略 recovery”。

没有真实 blocker 且活动 idle 时，即使目标目录或原 Git repository 已不可访问，也允许 forget 的纯 sidecar 删除；健康检查失败不能成为新增 Git 前置条件。

### R8：journal 与可信完成证据

clean 的顺序固定为：校验 sidecar/token → 校验身份和安全路径 → 最新活动检查 → 写入真实操作 journal → Git remove → 验证结果 → 发布 completed/detached。

预检失败必须保持原 sidecar 字节不变，不增加 pending/recoveryIssue，不更改 binding、revision 或 diskCleanup。不得将缺少 exact registration 的拒绝伪装为已启动 clean。

保持 v4 的保守兼容规则：

- 新 clean 不再产生预检失败 journal。
- 已有 clean-worktree、phase=recovery-needed 且路径和注册均缺失的标记，可能来自错误预检，也可能来自真实操作的后续失败；现有字段无法区分。自动 recovery 保持 WORKTREE_RECOVERY_REQUIRED，不据此发布 cleaned。
- 对有可信执行阶段记录的正常执行中断，保留既有安全恢复；不要扩大到未知路径或身份。
- 旧 remove-worktree journal 保留历史磁盘删除语义，不改成归档语义。
- 已被旧代码错误写为 completed 的记录缺少重建事实，本次不自动逆向迁移、不猜测或重建 binding。

当恢复确实解决了某个 operation，清除其对应 recovery issue 时必须从待展开对象中移除旧 recoveryIssues 字段，再按过滤后的结果构造 snapshot；空数组不能因为对象 spread 遗留原 issue。只清已解决的 issue，保留其他 Worktree 的问题。这属于 R7/R8 恢复验收的必要修复。

## 3. 验收矩阵

| 验收 ID | 操作与断言                                                                                                                | 覆盖  |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| A1      | 实际 Host 默认装载，无自定义 activitySource：idle 的已绑定归档 Worktree 可清理/forget                                     | R1    |
| A2      | 根 Session running、idle 父的运行子任务、one-shot/非本地、热加载前已有任务、读取失败、dispose 分别验证；不完整不返回 idle | R1    |
| A3      | cleaned + detached binding 的运行 Session：list projection、菜单、dialog、Host 全部阻止 forget                            | R1/R5 |
| A4      | 导航到 Archived 第六个 Session，父链展开且行可见；手动折叠刷新不打开；点击归档不立即展开                                  | R2    |
| A5      | active 与 removed+ready 的 active binding context 一致；cleaned/detached/repair/mismatch 分别保留错误语义                 | R3    |
| A6      | fork lookup/bind 在 forget 前开始，分别于成功后 resolve/reject；没有旧 recovery/projection，native child 保留             | R4    |
| A7      | forget 失败不清状态；其他 Worktree 保留恢复项；同路径新 ID 可绑定且不受旧代次影响                                         | R4    |
| A8      | clean 已成功，权限 RPC rejection 或业务失败：UI cleaned、删除菜单消失、targeted refresh 执行；重试只触发权限              | R6    |
| A9      | A8 同时刷新失败：保留 cleaned ready UI；forget 后权限晚到结果不能复活通知                                                 | R4/R6 |
| A10     | 归档→外部移除目录→重启，仍 repair、无新 pending/issue；idle forget 成功且 DSH fixture 不变                                | R7    |
| A11     | 注入已知无事务旧 issue：按精确条件清理；混合真实 blocker 时保留阻断                                                       | R7    |
| A12     | exact registration 缺失时 clean 拒绝；sidecar 字节不变；recover 不产生 cleaned                                            | R8    |
| A13     | 旧模糊 clean recovery-needed marker 不自动完成；可信 journal 和旧 remove 分别保留正确恢复                                 | R8    |
| A14     | 恢复成功后对应 issue 消失、其他 issue 保留；无其他 issue 时下一次合法 mutation 不再误阻断                                 | R7/R8 |

真实 Git 测试只在测试创建的临时目录内执行删除。原生 Workspace/Session fixture 在各条写入路径前后 byte-for-byte 不变。任何浏览器刷新都不能通过清空 ready 内容显示 loading 空屏。

## 4. 完成证据

审查阶段在精确提交的临时副本中 build 成功，并运行 activity、lifecycle、manage、DSH reader、Host permission manager 共 103 个测试通过。这只说明既有覆盖没有发现上述问题，不代表修复完成。

修复交接必须列出 A1–A14 的测试名、命令、通过/失败/未运行状态及真实 Host 的 DSH HEAD/profile。只有 mock 的活动测试不能通过 A1/A2。无法获得完整真实活动事实时，明确留下 R1 blocker，其余项按实际状态交付。不得把本次文档编写或原计划的勾选记录当成执行证据。
后续修订：活动门禁及 A1/A2 的 idle-only 验收要求已被
[用户确认清理方案](2026-09-06-worktree-user-confirmed-cleanup.md)取代；不再要求完整活动源才能清理或移出管理。
