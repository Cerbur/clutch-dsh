[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-worktree

`@cerbur/clutch-dsh-worktree` 为 DSH Web UI 增加 Git Worktree 视图，按 Workspace → Worktree
→ Session 组织会话，同时保留 DSH 对 Workspace 身份、Session 元数据、原生列表、消息和会话
历史的事实来源地位。

工具偏好存储在 Host 自有的独立配置文件中，与关系索引和原生 Session 元数据隔离。
插件只在自己的 sidecar 中保存 Worktree 关系、获取事实、共享 Worktree 指令以及 Workspace 根目录的
Main 指令。受管理的 Worktree 提供可选择本地或已获取的远端 branch 基线的只读 Git 与变更 Dashboard，Main 提供 Workspace 根目录 HEAD history；
不会复制 transcript 或改写 DSH Session。

> **预览：** Worktree Dashboard 是仅 plugin 提供的早期 MVP 预览版。Worktree 导航、生命周期操作、
> Session 操作、Worktree/Main 指令以及受管理 Worktree 或 Main 的 Git 与变更视图已经连接。派生 Worktree 和
> 其他未完成操作仍标记为**即将推出**。

## 安装

向运行中的 DSH 安装插件后，请重启 DSH Desktop，或重启 DSH Web 服务后刷新页面，以加载
插件 Host 与权限配置。重启前请先结束正在运行的任务。如果 Client 已加载而 Host 尚未挂载，
原生 toast 会在每次 Client 加载期间提醒一次。如果 Worktree Session 权限检查确认
**Worktree Full Access** 预设不可用并降级为 `workspace-write`，另一条每次加载至多一次的
toast 会提示在刚安装或更新插件后重启。toast 关闭后，权限修复说明仍保留重启指引。网络故障、
Workspace 错误、无法确认的权限与用户的显式权限限制不会触发预设缺失提醒。提醒不会重载服务
或授予完全访问；若重启后预设仍不可用，请检查 DSH 的插件与权限配置。

### 从 npm 安装

在已安装 DSH CLI 的环境中：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

如果使用 DeepSeek Harness 源码 checkout 且没有独立的 `dsh` 命令，可使用等价的
`pnpm dsh` 形式。

### 从本地 checkout 安装

先构建本 package 和 DSH 源码 checkout，再用绝对路径添加 package：

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web
```

DSH Web profile 必须已经能够正常启动。修改 `package.json` 或 `cordis.patch.yml` 后，需要重新
执行绝对路径安装命令。

### 从 GitHub 源码安装（可选）

DSH plugin market 使用的源码依赖形式也可以直接安装：

```bash
dsh plugin --profile web add "github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree"
```

该方式会在安装时构建 package。pnpm 构建脚本授权和本地开发细节见
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 功能

| 功能                    | 预览                                                                                                                                 | 作用                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Worktree 导航**       | <img src="assets/screenshots/screenshots-en.png" width="420" alt="包含 Workspace、Main、Worktree 和 Session 行的 DSH Worktree 导航"> | 在 DSH 原生 Sidebar 中增加 Worktree 模式。macOS desktop 下，面板共享 DSH 原生玻璃材质，避免叠加第二层底色或透出重复导航。其他平台保留主题底色；降低透明度时使用更强的底色。Workspace 展开与新 Session 行使用原生节奏的淡入和位移动画。每个 Workspace 下可以浏览 Local/Main 和 Git Worktree，再打开对应行绑定的 Session。 |
| **创建和导入 Worktree** | <img src="assets/screenshots/screenshots-import.png" width="420" alt="Worktree 创建与导入弹窗">                                      | 从本地或已获取的远端 branch 创建 Worktree，或原地登记已有的 branch-attached Worktree。导入不会移动、复制或编辑已有目录。                                                                                                                                                                                                               |
| **Worktree Dashboard**  | <img src="assets/screenshots/screenshots-dashboard.png" width="420" alt="显示 Session 和 Worktree 操作的 Worktree Dashboard 预览">   | 预览版 Dashboard 显示 Worktree 身份、路径、Session、Worktree/Main 指令、已连接操作、由 Host 提供的在应用中打开入口，以及受管理 Worktree 或 Main 的只读 Git 与变更视图。派生 Worktree 和其他未完成卡片仍标记为**即将推出**。                                                                                         |
| **Agent 工具设置（实验性）** | <img src="assets/screenshots/screenshots-worktree-tool.png" width="420" alt="Worktree 工具设置预览"> | 在通用设置中选择 `/cluworktree` 启用的能力，在 Local/Main 与各受管 Worktree 的 Dashboard 中独立配置自动注入。委派创建的 Session 默认仅获得结果回报。 |

## 使用

### 打开 Worktree 模式

Sidebar 滚动条悬浮在边缘，不会挤压行内容或改变边距。Workspace 文件夹图标和展开时旋转的
三角标与 DSH 原生一致。包含当前 Session 且已展开的 Workspace 使用原生蓝色文件夹，其他
Workspace 文件夹使用原生灰色。悬浮在过长的 Session 标题或 Worktree 名称上时，文字以原生速度
滚动到末尾；移出后恢复起点。启用减少动态效果时会直接显示末尾。

1. 启动 DSH Web，在 DSH Sidebar 底部选择 **Worktree**。
2. 在 Worktree 树中搜索或展开 Workspace。
3. 选择 Local/Main 或某个 Worktree 浏览其 Session。这个视角是附加的，DSH 原生的 Workspace
   和 Session 导航仍然可用。每组初始显示五行，可使用**展开更多**和**收起**查看其余内容。
4. 使用 header 中的 **Collapse All** 折叠其他无关的 Workspace 和 Worktree，当前 Session 所在的
   Workspace 与 Worktree 保持展开。

收起原生 Sidebar 时，Web 和 desktop 的 Worktree 面板都会同步隐藏。macOS desktop 不保留
收起后的窄栏，请使用原生标题栏控件重新展开。行动画遵循减少动态效果偏好，并在搜索、
拖拽和首次加载时直接完成布局。
Web 的 Worktree 导航从原生 DSH 品牌栏下方开始，保留可见且可点击的 Sidebar 按钮；
新会话按钮显示快捷键时也不会遮挡顶部栏。
如果无法安全识别原生 Sidebar 布局，插件会保留原生导航，不覆盖其控件；布局变化后会重新尝试定位。
Worktree 导航与 Dashboard 支持在原生栏目之前、之间或之后插入额外标题栏或壳层控件的 AppFrame
布局，并保持这些控件可用。

### 创建 Worktree

也可以通过 `/cluworktree` 启用 Agent 工具，见下一节。

新建 Worktree 操作使用与 Worktree 行相同的分支图标。Workspace 行按钮在 hover、键盘聚焦
或选项菜单打开时显示，与菜单按钮保持一致。

1. 打开 Local/Main 或 active Worktree 的选项菜单，选择 **Create Worktree**。
2. 选择本地或已获取的远端 base branch，并填写新的本地 branch 名称。弹窗会推荐一个可用名称。
3. 确认弹窗。插件会创建 Git Worktree，记录获取事实；从该 Worktree 打开 Session 时继续执行
   正常的 Session 和 binding 流程。

创建和导入页签使用左右对齐、占满内容宽度的控件，并保持一致的字段间距。

创建、保存基线和 Git 对比共用同一个可搜索选择器，按**本地分支**和**远端分支**分组，
并标注当前与已检出状态，支持全部、本地、远端分支过滤。
下拉框在亮色与暗色主题下均使用 DSH 原生菜单材质。搜索不区分大小写；方向键移动、Enter 选择、Escape 关闭。
点击浮窗内的标题、空白、搜索、筛选或获取区域会保持打开；选中选项或点击外部区域才收起浮窗。
分支与导入选择器在候选数据加载期间也能立即打开，浮窗内显示加载状态，数据返回后原位更新。
搜索和筛选条件保持不变，刷新时保留已有候选列表。
关闭并重新打开基线编辑器后，旧弹窗的待完成结果会被忽略。
只有最新的分支读取或 Fetch 可以更新候选与加载状态。
下拉列表采用紧凑高度，优先在字段下方展开，空间不足时缩短列表并在内部滚动；仅下方可用空间过小时向上展开。
即使候选数据已经缓存，也先绘制浮窗与加载状态，再准备列表。大量候选只渲染可视区域附近的选项；
搜索、筛选和键盘选择仍覆盖全部候选。
每次打开分支选择器都会重新读取本地 Git 引用，包含 terminal 中的变更；切回浏览器不重新加载候选。
Fetch 完成后读取一次更新后的分支列表，并直接提供给选择器。
打开新建 Worktree 弹窗不预加载分支，默认基线来自当前分支或 HEAD。
完整分支列表仅在打开选择器或 Fetch 完成后读取。工作区导航单独读取 Git 就绪状态和根 checkout 当前分支；
进入 Git 与变更只加载历史，不预加载分支列表。
默认优先选择当前本地分支。远端列表来自本地仓库已有的引用；点击**远端分支**标题旁的
下载箭头可获取全部已配置远端的分支，即使远端列表为空也能使用。Fetch 更新远端分支引用并刷新
当前 Workspace，保留已选值、本地分支、tag 和工作区文件，不清理已删除的引用。
获取期间按钮显示加载图标并禁止重复点击；成功后原位显示**远端分支已更新**，2 秒后恢复下载图标。
失败保留列表，在同一按钮上显示重试入口；按钮详情保留错误码、message 与诊断信息，
并可在**报错与修复**中查看，列表底部不额外添加提示行。
分支列表读取不会自动连接远端。基于远端创建 Worktree 必须使用新的本地分支；
若该本地分支不存在，其短名可以与远端基线同名。远端 HEAD 条目不会列出。

Git repository、本地 branch 和 initial commit 必须可用。如果仓库尚未准备好，DSH 会显示对应
的 readiness 提示和可复制的 setup 指引。

如果 Workspace 位于仓库子目录，其 Worktree 会保留相同的相对目录。例如，位于
`/repo/packages/app` 的 Workspace 使用 `<worktree-root>/packages/app` 作为新 Session 的
运行目录、Dashboard 路径、复制地址和打开应用的目标；Git 操作仍针对整个 checkout。
如果该目录缺失或解析到了 checkout 外部，Worktree 会显示需要修复，不会回退到 Git 根目录，
也不会自动创建缺失目录。

子目录机制升级后，已绑定且仍使用旧 Git 根目录 cwd 的 Session 可以继续使用，包括自动工具注入、
会话发现、继续投递、结果回报，以及默认从自身 checkout 的 HEAD 创建 Worktree。原始 cwd 和历史保持不变；
新的 Session 绑定仍必须匹配 checkout 内的 Workspace 工作目录。Git 文件预览对当前 Session
cwd 内的文件使用相对地址，对其余 checkout 文件使用绝对地址，并遵循 DSH 原生文件访问校验。

### 启用 Agent Worktree 工具

打开 **设置 → Worktree → 通用**，开启 **Worktree 工具**并选择需要的能力。两处工具开关默认关闭。
在属于 Workspace 或已绑定受管 Worktree 的 Session 中执行 `/cluworktree`，即可启用所选能力。
关闭通用开关后不再提供该指令；取消全部能力时会自动关闭总开关。

若需自动注入，打开 Local/Main 或受管 Worktree 的 **Dashboard → 设置**，
开启 **自动注入 Worktree 工具**并选择能力。Local/Main 配置仅适用于此 Workspace 根目录中
未绑定 Worktree 的会话；Worktree 配置仅适用于绑定到该 Worktree 的会话，各自独立保存。
所选工具在首个模型请求组装前启用，Agent 重启后也按对应配置恢复；普通提示词 preset 同时包含委派指导，PTC 模式下也包含 SDK。
此选择与通用设置独立：通用选择 1、2、3，自动注入选择 2、3、4 时，输入 `/cluworktree`
只补齐能力 1。已经启用的工具保留到当前 Agent 结束；配置修改影响后续注入。

设置中的 Worktree 入口与侧边栏使用相同的分支图标。
两处设置均使用分组卡片，总开关位于顶部。开启后在分割线下展开工具选择与说明；
关闭后收起工具选项并保留选择。设置用功能名称与说明介绍每一项能力；
注入与回报提示集中在工具选择说明下方。
指令与自动注入设置均标有 DSH 原生的**实验性**标签。
指令沿用 DSH 原生展示，简短提示新增与当前可用数量。
新建会话中执行 `/cluworktree` 后立即进入对话页面并显示指令结果，无需先向模型发送消息。

开启委派能力后，“新建 feature Worktree 并实现或修复问题”默认先创建 Worktree，
再将任务交给其中的独立 Session，由它修改代码、安装依赖和完成验证；仅创建目录不代表任务已开始。
指导优先使用本插件已启用的工具，并尊重用户“仅创建”、在当前会话执行或使用其他工具的明确要求。

六项可选能力对应以下工具：

| 工具                    | 参数                                                          | 行为                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clutch_new_worktree`   | `name`、可选 `baseBranch`、`instructions`                     | 默认从调用 Session 所在的健康 Worktree 分支创建新分支；Local/Main 使用根 checkout 当前分支。显式本地或已获取的远端 `baseBranch` 覆盖默认值。返回获取事实 `baseBranch` 与 `baseCommit`。 |
| `clutch_list_worktrees` | 可选 `workspaceId`                                            | 列出受管 Worktree 的 id、分支、路径、生命周期和健康状态，以及可用的本地和已获取的远端基线分支。默认查询调用方 Workspace。                                                               |
| `clutch_span_worktree`  | `worktreeId` 或旧参数 `name`、`prompt`、可选 `model`、`title` | 创建新的原生 Session、建立绑定、配置初始模型并提交 prompt。返回 `sessionId` 和投递阶段状态。                                                                              |
| `clutch_list_models`    | 可选 `provider`                                               | 列出原生 provider/model、推理强度和 provider 错误，同时返回当前 Session 模型及部署默认模型。                                                                              |
| `clutch_list_sessions`  | 可选 `workspaceId`、`worktreeId`                              | 查找已有 Session、绑定状态、运行状态和标题。不可用关系仅返回诊断，不读取其历史。                                                                                          |
| `clutch_send_message`   | `sessionId`、`prompt`、可选 `mode`、`requestId`               | 继续已有 Session。默认 `queue`；`steer` 在原生 step 边界加入纠正指令。返回接收结果，不返回回复。                                                                          |

例如，让 Agent 调用 `clutch_new_worktree({ name: "feature/demo", instructions: "Run tests before finishing." })`，
再使用返回的 Worktree id 调用 `clutch_span_worktree({ worktreeId: created.worktreeId, prompt: "Implement the feature and report the result." })`。
工具名按约定保留为 `clutch_span_worktree`。Worktree 名称是调用方 Workspace 内准确的
Git 分支名；指派时优先使用稳定的 `worktreeId`。单独创建 Worktree 不会创建 Session。
仅继承已提交状态；不会复制 staged、unstaged 或 untracked 文件。
绑定不健康时不会悄悄退回 Main。默认固定调用 checkout 的已提交 HEAD，包括根目录的
detached HEAD。Detached 来源返回 `baseCommit`，不虚构 `baseBranch`；
仍可显式指定本地或已获取的远端 `baseBranch` 覆盖默认值。

新委派的 Session 默认仅自动获得
`clutch_report_result({ status, summary, evidence?, requestId? })`。Host 将回报目标固定为
发起委派的 Session。`status` 为 `completed`、`blocked` 或 `failed`；`summary` 与
`evidence` 各限 2,000 字符。其余六项能力需通过 `/cluworktree` 或此 Worktree 显式配置的自动注入开启。
报告作为普通原生消息排队投递，应核验其声明和证据再接受完成。
回报由模型主动调用；进程崩溃、Agent 停止或等待用户审批时可能无法回报。`idle` 不代表成功。

回报权限仅属于当前委派任务。`completed`、`blocked` 或 `failed` 报告成功接收一次后，
即消耗并清空内存令牌。回报工具、SDK 与指导保持稳定，无令牌时调用会被拒绝。
后续用户输入会清空残留令牌，不再向旧父 Session 回报。
只有父方通过 `clutch_send_message` 明确派发新任务，且其 prompt 被消费后，才重新开启回报。
回报接收状态不确定时，仅允许使用返回的 `requestId` 重试完全相同的报告。
令牌不会持久化，Agent／插件重启后丢失。派发重试身份仅保留在有上限的内存缓存中，
已过期的重试会明确失败，不会重新开启回报。
插件拒绝向自身或祖先 Session 发送消息，并阻止仅由报告或普通插件消息触发的轮次继续
发送消息或派发任务；新用户输入后才恢复派发。这些代码门禁适用于本插件的原生工具与 PTC 调用。

模型工具列表已移除 `clutch_read_session` 和 `clutch_wait_sessions`。派发或后续投递成功后，
简短说明已委派并结束当前轮，等待执行 Session 主动回报；仅继续用户已经要求的其他独立工作。
不通过 agent 列表、终端、Git、文件或测试检查委派任务，也不自行修改或提交它。
仅用户明确要求进度或调查、或存在具体投递失败时，才进行针对性操作。
收到报告后评估其提供的证据，不自动重复运行检查；仅按用户要求或具体证据缺口、矛盾进一步核验。
**minimal** 等完整提示词 preset 会省略额外 section；关键交接与模型选择规则同时包含在原生工具描述中，保留 preset 的完整提示词。
启用时加入当前 Agent 的提示词指导，根据普通任务描述选择委派，无需用户点名工具。
Schema 说明准确身份、默认值和目标互斥约束，不携带 `$schema`；报错包含原因、纠正办法和正确示例。
单个 Session 历史损坏时仅返回该项 `unavailable` 诊断，其余列表结果仍可用。

PTC 模式生成的 SDK 提供明确参数类型，包括回报必填的 `status` 与 `summary`。
长度限制保留在字段描述中，并在执行时严格校验；互斥的指派目标使用兼容 DSH schema 子集的 `oneOf`。

`model` 的结构是 `{ provider, model, reasoningEffort? }`。省略时继承调用 Session 的
有效模型与推理强度，该默认路径无需查询模型列表。
用户指定其他模型或要求按任务选模型时，若已启用 `clutch_list_models`，先发现可用路由再显式传入所选对象。
未知路由需查询或向用户确认，不猜测模型 id，也不回退到部署默认模型。
模型或推理强度不可用时，在创建 Session 前失败。初始模型路由不会保存部署
默认模型。在 DSH 记录首个 request header 前，该覆盖仅存在于运行时；之后由 DSH 根据
自己的历史恢复模型。首个请求前重启会丢失初始路由覆盖。原生 Session 模型切换优先。

工具变更只刷新所属 Workspace 的 Worktree 列表与绑定，并保持已有 ready 内容可见。
派发保留当前对话，使用 DSH 新 Session 的默认 preset 和权限；
不会自动授予 Worktree Full Access。
Agent 或插件重启后，未配置自动注入的能力需要重新执行 `/cluworktree`。指令不接受额外参数。
所有发现、回报和补充投递仅限调用方 Workspace；传入其他 `workspaceId` 不会获得额外访问权。
这些 Session 是普通原生 Session，不是原生 subagent 子会话，也没有持久化的委派任务目录。
Detached 绑定需要先修复，再通过这些工具发送消息或回报。
健康的已归档 Worktree 保留 active binding，允许继续其 Session；
Workspace 根目录缺失时仍拒绝消息投递。

若创建后保存指令、绑定或提交 prompt 失败，工具会返回已创建的身份和错误
（`instructionsSaved: false`、`binding-failed`、`model-failed`、`title-failed`、`reporting-failed` 或
`prompt-failed`），保留 Worktree 和原生 Session。重试前先修复或打开返回的 Session；
再次派发会创建另一个 Session。绑定与模型配置成功后，prompt 失败可使用
`clutch_send_message` 和返回的 `requestId` 重试。仅同一消息的重试复用 request id；
新补充消息使用新 id。原生 admission 抛错时，`clutch_send_message` 也返回
`prompt-failed` 并保留该 id，包括无法确定是否已接收的情况。
回报目标和启用状态只存在于运行时，重启会丢失目标；恢复后的 Session 可以启用
`/cluworktree`，再用 `clutch_send_message` 向已知的委派方 id 手动回报。
没有自动合并、发布或磁盘清理工具。

### 导入已有 Worktree

1. 选择 Workspace，打开分支图标的 **新建 Worktree** 操作，然后切换到 **Import**。
2. 打开可搜索的 Worktree 选择器，按分支名或路径过滤。每项展示分支和目录，选择要导入的 Worktree。
3. 选择 **Import Worktree**。插件会原地登记已有目录，不移动、复制或修改其中的文件，随后
   使用与新建 Worktree 相同的 Session 流程。

第一版只列出尚未被插件管理、状态 ready、绑定 branch 且不是 repository root 的 Git Worktree。
Detached、bare、prunable、缺失或无效条目会被省略。导入的 Worktree 仍可在选择本地或已获取的远端基线 branch 后
使用 Git 与变更。

导入遵循同样的 Workspace 相对目录规则，只提供该目录可用的候选项。原 Workspace 可用时，
已有记录会投影为修正后的地址。已有 DSH Session 保留原始元数据；要从修正后的目录运行，
请创建新的 Session。

### 创建并打开 Session

Local/Main 和 Worktree 行的新建 Session 按钮使用 DSH 原生的气泡加号图标。

- 在 Local/Main 上使用 **+**，创建运行目录为 Workspace root 的普通 DSH Session。
- 在 Worktree 上使用 **+**，创建运行目录为该 Worktree 的 Session。
- 如果存在完全匹配目标目录的未归档空白 Session，插件会尽量复用它。
- 可以使用 Session list、Worktree Session 菜单或 conversation 中的 DSH 原生 fork 操作。
  Worktree-bound Session 的 child 会绑定到同一个 Worktree，并在该视角打开。

如果 DSH 已创建 Session 但 binding 失败，Session 会被保留。Worktree 视图会提供重试或直接打开
的恢复操作；插件不会删除或改写 DSH Session。

### 打开 Worktree Dashboard

可以从 Local/Main 或 Worktree 行菜单、悬浮操作，或 Session 标题行原生操作旁边的 Dashboard
图标打开。Sidebar 收起时，标题行图标也可单击打开 Dashboard，不需要展开 Sidebar。
如果目标仍在加载，请求会保持，并在主区域显示加载状态；失败信息通过 toast 提示，重试在 Worktree 设置中提供。
Dashboard 是与原生 Session 内容平级的页面，显示在 Sidebar 旁边的主区域；对于绑定 Session
的目标，会保留已经打开的右侧栏。初始 Session list 处于 pending 时，Dashboard 会等待它变为 ready；如果
当前 Session 已属于目标 Worktree，就保持当前 Session；否则切换到目标 Worktree 保留顺序中排在最前的
Session，让两侧视图保持一致。ready 的空 Session list 会打开不绑定当前 Session 的 page-level Dashboard；因为没有目标 Session，
它会收起当前打开的原生右侧栏，也不会自动创建 Session。只要当前 Session 可以承载右侧栏且右侧栏处于收起状态，
Dashboard 右上角会保留原生的右侧栏按钮；右侧栏打开后，该按钮按原生行为自动隐藏。

顶部栏显示 **{workspace}/{worktreeName}**，集中放置 **Open in ...**、**Back to session**
（或 **New Session**）和右侧工具栏按钮，页面滚动时保持可见。
macOS desktop 下可拖动顶部栏空白区域移动窗口；左侧 Sidebar 收起时，
红绿灯旁显示 DSH 原生展开按钮。Windows 保留原生窗口标题栏。

使用 **Back to session**、Escape、Sidebar 中的 Session 或退出 Worktree 模式关闭它。没有 Session 的
Worktree 中，右上角操作会变为 **New Session**，直接在该 Worktree 中新建会话。当前 MVP 已连接的操作
包括查看 Overview 和 Sessions、新建 Session 或 Worktree、归档 Worktree、编辑指令、复制路径、在 VS Code
中打开记录的目录以及查看 Git 与变更。派生 Worktree 和其他标记的快捷操作仍是占位内容。VS Code
必须安装在浏览器所在机器上且能够访问记录的路径；链接不会验证应用是否成功启动。

### 在应用中打开记录的目录

Dashboard 的 **Open in ...** 分割按钮保留插件自己的按钮 UI，但只调用 DSH 官方 Host 路由：

- `GET /open-in-app/apps` 探测可用应用；
- `GET /open-in-app/icon/<appId>` 获取应用图标；
- `POST /open-in-app/open` 使用 `{ "app": string, "path": absoluteDirectoryPath }` 启动应用。

按钮使用指向当前 DSH Host 的相对 URL，并传入 Dashboard record 的 `absolutePath`；不会探测操作系统，
也不会持久化应用选择。应用选择只在当前页面内记忆，刷新后使用第一个可用应用。如果没有可用应用
或 Host 请求失败，按钮仍保留现有的 VS Code 协议链接 fallback。

### 使用 Git 与变更

从受管理 Worktree 或 Main Dashboard 打开 **Git 与变更** Tab。Main 直接读取当前 Workspace 根目录 HEAD 的
commit history；当根目录存在 tracked、staged、unstaged 或 untracked 改动时，顶部会加入**未提交的改动** entry。
默认最多展示 200 个已提交 commit，选中第一个可见目标，并对工作区目标和已提交 history 使用相同的变更文件与 Diff 面板。对于持久化 `baseBranch` 存在且不同于当前
branch，或带有作为隐式基线的获取 commit 的 managed Worktree，Overview 会通过现有 `/api` Connection
做一次轻量、按需的 Git 状态读取，分别展示 ahead/behind commit 数量、已提交（基线到 HEAD）和未提交
（当前工作区）的文件行数。这是临时 projection，不是 watcher，也不会写入 Worktree 记录。Main 没有 Worktree 基线
比较，因此 Overview 对 ahead/behind 事实仍显示 **待接入**，但 Git Tab 可以展示 Main history。不可用或未选择基线的
managed 视图会诚实显示 **待接入**。打开 Overview 不会加载 branch 列表；
Git Tab 挂载时直接按已保存分支或获取 commit 读取 history。只有打开选择器才加载分支候选，
Fetch 直接消费返回的候选列表。要替换基线，可以点击
Base fact 旁的铅笔图标打开 branch 选择器：搜索框固定在选择器顶部，下方是有固定高度的 branch 列表
（默认展示约七条），超出部分在列表内滚动，因此过滤 branch 时整个弹窗尺寸保持不变。选择除当前
Worktree branch 之外的任一本地或已获取的远端 branch，再保存。
保存会替换 plugin sidecar 中持久化的 `baseBranch`；下次打开 Git Tab 时，选择器会以保存后的值作为默认值。
Git Tab 打开后，直接修改其中的选择器仍只是临时查看选择，会重新加载 history、changed files 和 Diff，
不会再次写入 Worktree 记录。如果不存在可用的已保存基线（缺失或等于当前 Worktree branch），Git Tab
和 Overview 会改用 Worktree 不可变的获取 commit 读取，并将该解析出的 commit 显示为 Base fact；只有
既无可用已保存基线、也无获取 commit 的 Worktree 才会保持未选择状态并提示用户选择。当所选 branch
已分叉时，Git 会解析两个 branch head 的共同先祖；
Worktree 在共同先祖之后的 commit 计为 `+N` 领先，base branch 在共同先祖之后的 commit 计为 `-N` 落后，
history 和文件读取仍然可用。如果两个 head 没有共同先祖，则基线汇总退化为 base branch head 与
Worktree `HEAD` 之间的完整 tree diff，history 展示 Worktree 相对 base head 独有的 commit。
在有效的 managed Worktree 基线加载后，Git 与变更 Tab 初始会选择**基线汇总**，而不是第一个 commit；切换基线 branch
也会回到该汇总。需要更窄的查看范围时，再选择 commit 或**未提交的改动**。Main 跳过这个仅用于比较的汇总，但使用相同的已提交 history 与多选行为；Workspace 根目录有改动时也展示实时工作区目标。
选择**未提交的改动**会比较当前 Workspace 根目录与 `HEAD`，不会创建基线或写入 Git 状态。

所选 branch 每次读取都会重新解析。选择器展示短名，以枚举出的 `refs/heads/...` 或
`refs/remotes/...` 作为稳定身份。新保存的远端基线保留精确远端 ref，新增或删除同名本地分支不会改变基线。
旧短名仅在无歧义时兼容；有歧义的已保存值返回 `WORKTREE_STATE_CONFLICT`，需要重新选择目标分支。
commit SHA、tag 和任意 revision expression 仍被拒绝。已选精确分支不复存在时会显示
诚实的不可用状态，而不是泛化的 Git 失败。`baseCommit` 是不可变的获取元数据，永远不能由用户直接选择，
并在没有可用已保存 branch 基线时作为隐式基线；创建恢复也绝不会改写它。当 managed Worktree 或 Main Workspace 根目录存在 staged、unstaged 或 untracked 文件时，列表顶部会加入**未提交的改动**；
选择它会将对应的当前工作区与 `HEAD` 比较，并使用相同的变更文件和 Diff 视图。

**基线汇总**是一个独立的目标，默认展示从所选 branch 与 Worktree `HEAD` 的共同先祖到本次请求
捕获的 `HEAD` 的净已提交树差异（无共同先祖时改用两个 branch head）；不包含工作区未提交改动。
打开 **包含工作区改动** 后，该目标会改为展示从同一比较边界到当前工作区的一次净差异，其中包含已提交、
staged、unstaged、untracked、删除和重命名改动。这是按需读取的新鲜 projection，而不是简单拼接两段
Diff。点击 commit 会展示该 commit 自己的 Diff；对于 managed Worktree 和 Main，打开提交栏标题中的**多选提交**开关后，可以同时选择
多个已提交行，查看这些 commit 各自 first-parent delta 的精确并集。Main 不提供基线汇总或工作区包含开关；该开关默认关闭，关闭时会把已选
集合收敛回当前聚焦的 commit。变更文件会记录贡献它的
commit；每个所选 commit 会作为独立 Diff segment 展示，不会隐式扩展成范围，也不会包含未选择的
commit。变更文件栏标题会展示当前目标（基线汇总、所选 commit 或未提交改动）对应的绿色 `+N` 和红色
`-N` 总行数；仅包含 binary 时显示未知。未提交改动 entry 与已提交的多选互斥。汇总 Diff 工具栏中的
**在侧栏打开**会使用当前 Session 在原生右侧栏中显示当前文件，但前提是该 Session 属于 Dashboard
对应的 Worktree。空 Worktree 或无关的当前 Session 不会通过此操作打开文件。

managed Worktree 和 Main history 都最多展示 200 个 commit，更多内容会标记为 truncated；超过 Git adapter 输出上限的变更文件列表
也会显式标记为 truncated，而不是报泛化错误。commit 详情使用 first-parent 比较，root
commit 与空 tree 比较，rename/copy 行保留两个路径；binary 或过大的 diff 会显示明确的安全状态。变更
文件行会用绿色 `+N` 表示新增、红色 `-N` 表示删除；binary 文件不显示这些数量。文件名会用绿色表示新增、红色表示删除、蓝色表示其他变更，每一行的标题与无障碍标签也会写出对应状态。文件夹 icon 会直接表示文件夹当前是展开还是折叠。
**未提交的改动**是按需读取的临时快照，不会持久化，也不会持续监视 Git；刷新后才能看到后续编辑。

Git 与变更使用受页面 viewport 限制的固定尺寸布局。宽度足够时是两列：提交与变更文件上下排列在较窄
的左列，中间是可拖动的分割线，Diff 占满右列高度。宽度不足时保持两行：第一行左右排布提交和变更
文件，第二行展示汇总 Diff。两种布局下两条分割线都可以拖动：左右分割线调整两列的宽度，或在第一行
内调整提交与变更文件的宽度；上下分割线调整提交与变更文件面板的高度，或调整第一行与 Diff 的高度。
拖动分割线，或聚焦后按方向键即可移动，双击恢复默认比例。较长的 commit list 和变更文件 list 会在
各自栏内滚动，不会继续撑大 Dashboard。变更文件栏在路径宽于栏位时也允许横向滚动，文件和文件夹
名称不会被省略。变更文件按文件夹分组，文件夹默认展开，并且可以独立展开或折叠。Diff 内容也会在
固定尺寸的 Diff 栏内滚动；只读选择和刷新行为保持不变。

视图是只读的，不提供 commit 或 staging 控件。managed Worktree 会依据所选 branch 到 `HEAD` 的 projection 验证
commit；Main 会依据有界的 HEAD history projection 验证 commit。插件随后依据最新状态重新读取和授权工作区 path，因此这些 endpoint 不是通用 Git object 或文件读取器。
刷新会在替换数据加载期间保留 ready 内容；旧 commit 或文件选择的迟到响应会被忽略。

### 添加 Worktree 或 Main 指令

在 Dashboard 的指令卡片上使用 **Edit** 为选中的 Worktree 或 Main Workspace 保存或清空共享指引，长度上限为 32,000 个
UTF-16 代码单元。下一次模型请求会通过 DSH pre-step hook 收到独立的 `<system-reminder>` 上下文条目，
包括在 Main 中运行的未绑定 Session。

指令保存在 plugin 自己的数据中，不会写入项目目录或 `AGENTS.md`。清空、解绑、清理或移出管理后，后续请求不再注入；
归档会保留 active binding，因此 Worktree 指令仍然生效。指令消息仍可见时，不变的指令不会重复追加。

### 处理错误

Worktree 列表、弹窗和 Dashboard 的失败统一通过原生 toast 显示，跟随 DSH 当前界面语言
（中文或英文）。提示会说明问题和解决办法。列表保留已有内容，顶部不再显示错误窗口或诊断抽屉。

点击 toast 的**报错与修复**，或打开 **设置 → Worktree → 报错与修复**，可查看每次失败的问题说明，并展开原始诊断详情（包括
Git stderr）。读取重试、恢复中断操作、重试 Session 绑定和打开已保留 Session 的操作集中在同一个
Tab。toast 消失后记录仍然保留；列表和 Git 面板不再提供行内报错或重试按钮。原操作视图关闭后，
对应恢复按钮会停用；重新打开该视图可加载当前状态。记录仅保留在页面内存中，刷新后清空；
**清除历史记录**保留仍待处理的操作。弹窗保留输入，指令和基线保存失败时保留草稿。
Git 初始化指引仍在创建弹窗中显示。同一 Git 故障只弹一次 toast，各受影响操作仍分别保留记录。

Worktree 设置采用 DSH 原生 Tab、状态标签和紧凑按钮。说明文字、操作按钮和诊断详情跟随
**设置 → 通用**中的字体大小设置。

### 归档或移除 Worktree

- **Archive Worktree** 是非破坏性操作，会保留目录、binding、指令和运行时 Worktree 上下文。
  Git 登记仍完整时，可以取消归档。
- **Clean Up Disk** 是单独的操作，需要二次确认，并执行普通的非强制 `git worktree remove`。
  插件不会检查 Session 或子代理是否仍在使用该目录；确认前请先停止这些任务。清理成功后
  binding 会 detached，记录会保留到之后显式移出管理。
- **Remove from Management** 只删除 plugin 的 Worktree 和 binding 记录，会保留磁盘文件和原生
  DSH Session，也不要求检查 Session 活动状态。

## 要求

| 组件            | 要求                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| DSH Client      | `>=0.2.0-rc.1`，需要 Session/Workspace Controller 和 Client Store                                                                           |
| DSH Host        | `>=0.2.0-rc.1`，需要 Typert Gateway `/api` connection 和 subprocess capability                                                              |
| Git             | `>=2.20.0`，必须已安装且可在 `PATH` 中使用                                                                                                  |
| Node.js         | 插件自身要求 `>=20.0.0`；DSH `dsh-v0.2.0-rc.1` 要求 `^22.19.0                                                                               |     | >=24.0.0` |
| Host filesystem | 支持使用普通 Windows 和 macOS 本地路径保存 sidecar 与 Git Worktree 数据；网络、特殊或别名路径较多的文件系统可能不支持持久化同步或身份校验。 |

## 行为与限制

- DSH 拥有 Workspace 身份与根目录、Session 身份与元数据、原生列表、消息、prompt、transcript
  和历史。插件不会复制或改写这些数据。
- 插件外部索引保存 Worktree 路径、branch、来源、生命周期状态、binding、排序、指令、获取事实
  及相关元数据。对于受管理 Worktree，Dashboard Base fact 是持久化的 `baseBranch`；用户可以将其
  替换为除当前 Worktree branch 之外的本地或已获取的远端 branch，保存后的值会成为 Git Tab 选择器的默认值。
  不可变的获取 `baseCommit` 与它分开保存，不会因该编辑被重写。索引位于 DSH host 的 plugin data
  directory，不写入项目目录或 DSH raw data，也不保存 Session 内容或 Workspace 根目录副本。
- runtime `cwd` 在每次执行时派生。无 binding、Main 或 detached binding 使用 Workspace root；
  active Worktree binding 使用 Worktree path。cwd 不会持久化写回 DSH Session metadata。
- 一个 Session 最多有一个 active Worktree binding，一个 Worktree 可以有多个 Session。移除或
  清理 Worktree 不会删除 DSH Session。失效的 active binding 会显示 repair 状态，不会静默切换到
  另一个 Worktree。
- Git 会在相关刷新、相关菜单打开和进入 Git Dashboard 时读取，插件不会持续监视 Git。外部切换
  branch 会显示 branch drift；清理磁盘前必须显式执行 **Adopt current branch**。Detached HEAD 和
  recovery-needed 状态会保持可见并支持重试。
- Worktree 健康状态通过 branch icon 的颜色显示：ready 使用 success（绿色）状态色，branch drift 使用警告色，repair/recovery-needed 使用错误色。即使 hover 时 icon 被 disclosure control 替换，本地化健康状态标签仍可供辅助技术读取。
- 新创建或新导入的 Worktree 会插入所属 Workspace 的 Worktree 列表队头；已有 Worktree 顺序保持不变，Main 固定在第一位。
- 将 Workspace、Main 和 Worktree 的展开选择保存到浏览器本地存储；Session 五行溢出展开保持临时状态，并在刷新或父级折叠后重置。**Collapse All** 会折叠其他无关节点并保留当前 Session 所在的 Workspace 与 Worktree 展开。
- 当前 Session 不在可见树中时，会高亮匹配行并临时展开定位；如果行已在可见区域内，不会移动导航滚动位置，否则只移动足够显示它的位置。且不改变已保存的展开选择。
- Git Dashboard 的读取由 Host 通过 DSH 现有 `/api` transport 执行。浏览器不会执行 Git、读取
  sidecar 文件或 `.git`，也不会暴露修改 working tree 的控制项。文件 diff 会禁用外部 diff 与
  文本转换，并限制显示范围以保障安全。
- Dashboard 的在应用中打开入口只通过 DSH 官方相对 Host 路由完成应用探测、图标加载和启动；应用选择只保存在当前页面内，刷新后使用第一个可用应用，Host 返回空结果或失败时回退到编码后的 VS Code 协议链接。
- Git Dashboard 只实现 commit history、只读的**基线汇总**（可选包含一次从基线到工作区的
  新鲜 projection）、顶部的只读**未提交的改动**快照、changed files 和一次一个 unified diff。
  按请求启用时，这些 projection 会合并 staged、unstaged 和 untracked 文件，但不会写回 Git。
  Dashboard 不提供 commit、staging、reset、revert、cherry-pick、push、pull、pull request、
  graph lanes、pagination 或 syntax highlighting。
- Session 行和 Dashboard 卡片使用 DSH 原生的状态和相对时间展示。绿色完成 dot 是 DSH 对非当前
  主视图中停止的 Session 的未读提醒；打开该 Session 或再次运行时清除。冷启动时的 idle Session
  不视为已完成。提醒仍由 DSH 拥有，插件不会持久化该状态。折叠的 Workspace、Main 和 Worktree 分组会
  从完整且符合原生空白/归档可见性条件的成员中选择一个聚合 `StateDot`：等待审批（以及其他 pending interaction warning）
  优先于运行中，运行中优先于已完成。Idle Session 不会贡献分组 dot；Worktree 健康状态仍
  使用独立的前置指示器。视觉上的 Session 排序初始按最新的 `updatedAt` 值排列并只保存在浏览器本地；Main 固定为首行，Worktree 拖拽只
  更新这个本地排序投影，Main 拖拽只有在 DSH 接受后才更新原生 Workspace 顺序。
- active Worktree Session 在明确确认后可以请求名为 `worktree-full-access` 的 preset。插件
  追加该 preset，保留 DSH 现有的权限列表、默认选择与官方 Auto review 集成。它将
  DSH `danger-full-access` 与 `ask` 组合，保留审批提示，不改变 network 或 process policy。
  不可用时尽可能回退到 `workspace-write + ask`，否则显示未验证且可重试的状态。权限服务
  可以迟挂载或被替换：重试使用当前可用能力，不需要重启 Worktree Host。服务暂时缺失时
  绝不授予 Full Access，并保留用户的显式限制；它不能突破 DSH 宿主设置的 sandbox 上限。
- Session 与 Worktree 绑定及权限检查在 Host 端基于物理文件系统身份（`stat`/`realpath`）进行比较，而非单纯依赖词法路径字符串。这确保了在 Windows 与 macOS 各种路径形态下的稳健兼容（包括盘符大小写、正反斜杠、UNC 路径以及 `\\?\\` 等长路径前缀）。在 Windows 平台上，sidecar 原子持久化采用可写文件句柄同步并对目录同步保持容错（best-effort），Git CLI 集成兼容 `NUL` 空设备路径与 CRLF 换行符。
- Git 必须已安装且可在 PATH 中使用。Git 可执行文件缺失时显示安装提示且不显示命令块；插件
  不会执行 setup 或安装命令。
- Workspace 根目录缺失时，Worktree 视图仍会渲染索引中的 Worktree、Session 绑定和指令，并显示
  本地化的目录缺失状态，而不会让整个视图读取失败。该 Workspace 的 Git 读取、Worktree 创建与
  导入以及清理操作仍会被拒绝，直到目录恢复。
- 如果插件的外部索引不可用或损坏，原生 DSH Workspace 和 Session 视图保持完全可读，插件
  进入降级只读状态，绝不会使用空索引覆盖原生数据。

## 界面语言

Worktree 模式跟随 DSH 当前界面语言。入口、树、菜单、弹窗、状态、Dashboard 标签和重试提示
提供英文和中文。Workspace 名称、Session 标题、branch 和路径保留原值。错误使用本地化的问题说明与恢复指引，
未知错误附带可供排查的错误码。原始诊断信息可在 Worktree 设置中查看；插件不会将其写入 DSH 日志。

## 开发

架构、本地 DSH 联调、测试和贡献流程见：

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/RELEASING.md](docs/RELEASING.md)
- [AGENTS.md](AGENTS.md)
- [src/client/README.md](src/client/README.md)

常用的 package 检查命令：

```bash
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Lint 同时检查源码与测试文件。提交前必须修复 ESLint error。

中英文 README 的结构通过以下测试校验：

```bash
node --test test/readme-parity.test.mjs
```

## 卸载

使用 DSH CLI：

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

如果使用 DeepSeek Harness checkout，可对同一个 package name 使用
`pnpm dsh plugin --profile web remove`。

## 友情链接

- [LINUX DO](https://linux.do/) — 新的理想型社区。
