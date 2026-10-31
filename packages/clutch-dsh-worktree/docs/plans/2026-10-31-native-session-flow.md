# Worktree Session 原生执行机制：调研与待决策方案

状态：人类已选择方案 A（原 Workspace 内新建）；按该决策实施并验证。本文件补充历史 bootstrap 计划。历史目录、Session 与权限不自动迁移。

## 已验证事实

- Session 的原始 Workspace、immutable header cwd 与 effective working directory 是不同事实。
- 当前 DSH 创建输入仅接受互斥的 workspaceId / cwd，没有 worktree 创建或 prompt 字段。
- 原生 workingDirectory.set(agent, path, signal) 切换 effective cwd，由 DSH 自行持久化
  working-directory/change 及通知；插件不能直接追加事件或改写 header。
- 原生 working_directory({ cd }) 调用上述服务。仅要求 Agent 在提示词中 cd
  不能保证任务开始前已切换，也不能成为 Host 授权或原子绑定契约。
- sandboxPolicy.resolve() 仍用 session.header.cwd 作为 workspace-write 根；
  原生目录切换明确不改变权限，也不改变已经运行的进程。
- DSH experimental worktree 默认放在源 checkout 的 .agents/worktrees，
  会准备目录和 ignore 文件，不能未经决策直接替换插件现有事务。
- 插件目前把新 Worktree 放在 DSH Home 下，并明确拒绝 Workspace 内路径。
- 浏览器与 Agent 派发目前以 Worktree cwd 创建 Session；新绑定校验要求
  header cwd 等于 Worktree 路径。Host 只读适配器尚未读取 effective cwd。
- 浏览器还执行专用 Full Access 确认，bundle 贡献专用权限 preset。

## 人类决策：目录与权限目标

| 方案 | 新目录 / Session 流程 | 收益 | 代价与边界 |
| --- | --- | --- | --- |
| A（严格无额外权限目标建议） | 新 checkout 放在原 Workspace 内的专属 pool；Session 以原 Workspace 创建，经原生目录服务进入后才允许任务 admission | 默认 workspace-write 可编辑目标，也可与原 Workspace 协同 | 改变现有目录边界；必须确定忽略规则；旧外置及导入目录无法保证无额外权限 |
| B | 保留 DSH Home 外置目录；Session 以原 Workspace 创建，原生服务进入目标；移除专用权限配置 | 保留现有目录与 Git/Sidecar 事务 | workspace-write 不能写外置 checkout，仍需 DSH 普通操作审批；只能承诺无插件专用权限配置 |
| C | 先指定其他 DSH 基线或 Session 输入能力 | 可据确切契约实现原目标 | 暂停依赖此能力的实现，不虚构字段、不绕过 sandbox |

A 的子目录 Workspace 必须把 checkout 放在该 Workspace 的可写范围，不能简单采用
Git 仓库根的 .agents/worktrees，否则仍越出 sandbox root。忽略策略未经批准不写业务
.gitignore，不触碰用户已有目录。历史 checkout 不自动移动、Session 不自动迁移或改写。

## 推荐的保守兼容与生命周期策略（随目录方案确认）

1. 区分 original cwd 与 effective cwd；同时校验物理身份与原始 Workspace 授权。
2. 浏览器、Agent 派发、Dashboard 同步共享原生创建/进入/绑定流程；失败保留 Session，
   返回身份与失败阶段，不回滚删除。
3. 新原生目录能力缺失时显式拒绝新流程，不静默使用旧 cwd。
4. Fork 按实际原生 prefix/projection 校验，不仅凭 parent binding 继承目标。
5. 用户主动离开 Worktree 后不强制切回；新投递/回报对 cwd 错配显式失败。
6. 归档保留目录及 binding；解绑、清理、移出管理不把仍运行的任务静默重定向 Main。
7. 历史原始数据和已保存权限不自动迁移、降权或扩大。是否保留手动 legacy helper
   需随目录方案确认；不能承诺外置旧会话也免额外权限。
8. Sidecar 损坏、目录缺失和原生 cwd 自动恢复保持 fail closed，原生视图仍可读。

## 调研证据

本地 DSH 源码根：/Users/yuancheng/Documents/Code/deepseek-harness。

- packages/api/session-controller/src/types.ts:287：原生创建输入。
- packages/session/working-directory/src/index.ts:122、154、186：effective cwd、切换、事件与通知所有权。
- packages/sandbox/sandbox-policy/src/index.ts:164：sandbox root 使用原 header。
- packages/experimental/worktree/src/index.ts:127：pool、原生 sandbox 与最终目录进入。
- src/client/view/worktree-view-actions.ts、src/tool/dispatch-session.ts：插件创建入口。
- src/manage/manager-support.ts:217、267：现有目录边界与绑定校验。
- src/manage/manager-sessions.ts:109：Sidecar 派生 cwd 尚不是实际执行目录。
- src/host/dsh-read-adapter.ts：只读 header；src/client/session/worktree-session.ts:125：专用权限确认。
- cordis.patch.yml：专用 preset 安装贡献。

## 后续实施与验证

已按人类选择的 A 方案同步权威架构、开发指引、双语 README 与 Agent 硬约束。
共享 native directory port 与创建 module 覆盖浏览器、Agent 派发和 Dashboard 同步；
浏览器创建不依赖 commands/tools/llm，可保留未知传输结果的请求身份。
保持既有 tool schema 安全断言不变；新增原始归属、effective cwd、原生权限 no-op、
副作用失败、冷观察释放、清理、cwd 变更和任务输入时序回归。
全部七项门禁及部署 graph 的真实 workingDirectory/Projection/SandboxPolicy 集成作为交付验证。

编辑工具限制：本环境没有 apply_patch 可执行文件（exit 127）；本新增调研文档通过
原生 write 工具创建，未覆盖现有文件，未修改业务实现。

## 2026-10-31 修复与范围更新

人类明确要求完全删除 Worktree Full Access 代码，取代上文待定的 legacy helper 兼容选项。已移除 preset 安装贡献、权限修改 adapter、确认 UI、权限 RPC 和清理归一化；历史 Session 策略不自动变更。

真实浏览器复现新建 Session 后绑定失败，原始错误为 `cannot get property "workingDirectory" without inject`。根因是只读 adapter 直接读取未注入的 Cordis sibling service；Host 改为调用时 `ctx.get()`，回归使用独立 Cordis fiber 复现，覆盖创建、目录发布和绑定。复用空白 Session 继续通过 Host bind 校验物理身份。

## 2026-11-01 续接验收

- active binding 的幂等重试重新校验原生归属与 effective cwd；错配显式失败，保留原绑定，不自动重定向。已覆盖成功重试与目录变化后的拒绝。
- 清理已删除 Full Access 模块对应的旧 `lib` 编译产物；源码和重新构建的产物均无该 preset、权限 RPC 或确认组件。
- 在 feature worktree 根运行 `pnpm run check:workspace`、`pnpm run check:patches`，以及 `pnpm --filter @cerbur/clutch-dsh-worktree` 的 `lint`、`typecheck`、`build`、`test`，全部通过。全量测试 1,249 通过、0 失败、12 跳过。
- 包目录运行 `node --test test/readme-parity.test.mjs` 通过；以 `DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness` 运行 `node --test test/native-session-flow.test.mjs`，14 项全部通过。
- 重启独立 3088 测试服务，确认安装链接指向本 feature worktree。浏览器在 `qa/session-flow` 新建 Session 成功，再次点击加号复用同一空白 Session；原生权限仍为工作区内修改。只读检查原生记录确认 header cwd 保留原 Workspace，working-directory/change 指向 Worktree，未写入 Full Access。
- 此次仅完成 feature 验收；未提交、合并、发布或调整版本。

## 2026-11-01 Review 修复

- 保留已有 active binding 的 Git-root cwd 兼容性；新绑定仍要求 Worktree 工作目录，复用仍验证原生身份、归属和物理 cwd。
- 历史 Session 缺少原生 Workspace 成员关系时，唯一 active binding 支撑 cwd 与 HEAD 读取；显式其他 Workspace 归属和错配 cwd 仍拒绝。
- 创建前的读取或校验失败释放请求缓存，允许相同 requestId 重试；尝试原生创建之后的不确定失败不释放，避免重复创建。
- Client 成功 open-bound 或 bind-existing 恢复后清除对应请求身份，后续新建不再重放旧 Session。
- 回归测试先复现 5 项失败，再验证修复；另覆盖不确定创建失败只尝试一次与归属/cwd 冲突拒绝。
- 第一轮原会话复审发现原生目录服务缺失的能力预检仍被缓存；补充真实 Cordis 同 requestId 恢复回归，先红后绿。适配器以专用 preflight 错误标识确定未调用原生创建，Host 仅对该明确无副作用错误释放缓存，普通原生创建错误仍保留去重。
- 最终补修后重新验证：feature 根目录 `pnpm run check:workspace`、`pnpm run check:patches`、`pnpm --filter @cerbur/clutch-dsh-worktree lint`、`typecheck`、`test`（内含 `build`）均通过；全量 1,256 通过、0 失败、12 跳过。包目录以 `DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness` 运行 `node --test test/native-session-flow.test.mjs test/readme-parity.test.mjs`，22 项全部通过。
