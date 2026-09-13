# @cerbur/clutch-dsh-worktree

`@cerbur/clutch-dsh-worktree` 为 DSH Web UI 增加 Git Worktree 视图，按
Workspace → Worktree → Session 组织会话，同时继续由 DSH 作为 Project/Workspace 身份、
Session 元数据、原生列表和会话历史的唯一事实来源。插件在自己的 sidecar 中保存
Worktree/Session 外部关系、创建或登记事实及用户编写的 Worktree 指令。

> **预览版：** Worktree Dashboard 是仅插件的早期 MVP 预览版。目前已接入概览、会话
> 列表与导航、Worktree 指令、新建/归档 Worktree 和在应用中打开入口；Git 详情、派生
> Worktree、设置及其他标记为**即将推出**的操作仍是占位。

## 界面截图

![中文 Worktree 侧边栏和新会话空白 Hero](assets/screenshots/screenshots-zh.png)

中文截图展示了侧边栏中的 Worktree 模式、包含 Main 和 Worktree 行的 Workspace 树，以及
新会话空白 Hero 中的只读上下文。

![英文 Worktree 创建/导入弹窗](assets/screenshots/screenshots-import.png)

导入截图展示了现有 Workspace `+` 弹窗：默认选中创建，旁边是导入 Tab，并在普通下拉框中
使用安全的示例 branch 和路径值。

![Worktree Dashboard 预览（中文界面）](assets/screenshots/screenshots-dashboard.webp)

Dashboard 截图记录了当前预览版界面：Worktree 身份、获取事实、已接入的会话与 Worktree
操作，以及明确标出的占位卡片。

## 能力

- 从 Local/Main 或 active/archived Worktree 的菜单、行内悬浮操作，或原生 Session 标题行 More actions 按钮
  左侧的快捷 Dashboard 图标打开 Dashboard，查看真实名称和 cwd、复制完整路径，并切换概览、Git
  与变更、会话、派生 Worktree 和设置。尚未接入的 MVP 卡片与操作明确标记为“即将推出”。
- 从 DSH Sidebar footer 进入 Worktree 模式，按 Workspace → Worktree → Session 浏览会话。
- 搜索 Workspace，并从已有 local branch 创建 Git Worktree 和 branch。
- 在同一个弹窗中选择导入，发现与当前 Workspace repository 关联、尚未由 sidecar 管理且绑定 branch 的 Git Worktree。第一版不展示 repository root 和 detached HEAD 条目。
- 导入只登记已有 Worktree，不移动、复制或编辑其目录；导入记录与插件创建的记录共享相同的 Session、binding、health、排序、cwd、投影、刷新和恢复流程。
- 非破坏性归档 Worktree，保留磁盘文件、活动绑定与运行时 cwd。磁盘清理（`git worktree remove`）需经二次确认，由用户自行确认使用该目录的 Session/子代理与其他任务已停止；亦支持移出插件管理并保留磁盘文件与 Session。
- 在 Main 或 active Worktree 下创建普通 Session 或 Worktree Session，并直接打开新会话。
- 对 active Worktree Session，先经明确确认，再请求命名的 `worktree-full-access` 预设。它将
  DSH 的 `danger-full-access` 与 `ask` 组合：关闭关联 Git 元数据的文件系统限制，但保留
  审批提示；网络和进程策略不变。原生 Access 菜单中的 `Worktree Full Access` 会显示
  Worktree branch 图标。
- 保留用户在 DSH 原生 Access 界面中选择的限制。如果自定义预设不可用，在可能时回退到
  `workspace-write + ask`；如果无法验证权限能力，则显示可重试的降级状态，不伪称已获得完全访问。
- 复用原生动画 `StateDot` 展示运行中的 Session，并为最近一条用户发送的 Session 消息显示
  原生相对时间；hover 或打开菜单时，右侧位置让位给已有的操作菜单。
- Dashboard 的 Session 卡片在概览预览和完整的 Session 页签中复用同样的状态或相对时间信息，
  与 Worktree 列表保持一致。
- 使用 DSH 原生 Session hover 详情卡片展示完整标题、相对时间和当前状态；打开 Session 操作
  菜单或拖拽行时，详情卡片让位。
- 补齐原生的等待审批、计划待审、等待回答、已完成、空闲和运行中子代理状态；插件不会复制
  原生动画实现。
- 当折叠的 Workspace、Main 或 Worktree 中存在任一未归档的活动 Session 时，在其右侧显示
  一个原生运行指示器；折叠运行状态会为 28px 指示器和 4px 文字间距预留空间，过长的 Worktree
  名称会在活动持续期间滚动；展开后恢复普通操作栏。
- 用户在 Session 中发送新消息后，该 Session 会移动到当前 Main 或 Worktree 视觉分组的队首。
  该排序只保存在浏览器本地，不修改 DSH Workspace 顺序或 Worktree sidecar。
- 从 DSH 原生 Workspace session list tab、Worktree view 或 Conversation fork 操作 fork
  Session。parent 有 active Worktree binding 时，child 会自动绑定到同一个 Worktree 并直接在
  Worktree 视图中打开；child 仍然是普通 DSH Session。
- 查看 ready、repair、active 和 detached Worktree 状态，包括可重试的操作错误。
- 通过 Main 和 Worktree 共用的选项菜单复制所选行的绝对路径；已管理 Worktree 额外通过选项菜单和
  行内悬浮操作提供 Dashboard。Worktree 分组的右侧操作栏在静止时为零宽度；折叠且有活动时会为 28px 运行指示器和 4px 文字间距
  预留空间。hover、focus 或打开 menu 时才按实际可用的 Dashboard、menu 和 Session `+` 控件占用宽度；
  过长的 Worktree 名称会在悬浮或折叠运行期间自动横向滚动，两个触发条件共用一个滚动循环，均不满足
  后回到原始位置。
  active Worktree 提供“归档 Worktree”并要求确认。
- 通过 Local 或 active Worktree 的选项菜单创建新的 Worktree。创建弹窗会以所选行的当前 branch
  为基线，并预填下一个可用的递增名称，例如 `feature-2` 或 `feature-3`；detached Worktree
  不显示该动作。
- 继续使用 DSH 原生的 Workspace rename/delete/reorder 和 Session 菜单。Worktree 可以在所属
  Workspace 内排序；顺序保存在插件 sidecar 中，Main 固定在第一位。
- 将 Workspace、Main 和 Worktree 的展开选择保存到浏览器本地存储；Session 五行溢出展开保持临时状态，并在刷新或父级折叠后重置。
- 在 Worktree Header 提供「全部折叠」按钮，支持一键折叠所有 Workspace 与 Worktree。
- 在 Worktree view 高亮 DSH 当前 Session；进入 Worktree 模式或切换当前会话时，临时展开其 Workspace/Main/Worktree 路径；只有当前行不在前五行时才展开 Session 五行溢出，随后清空隐藏它的搜索并滚动定位；这一浏览器本地行为不改变已保存的展开选择。
- 在已有 Conversation 的标题行以及新会话空白 Hero 中，以只读方式显示当前 local branch 或
  Worktree branch 上下文。
- 在普通 Worktree Session 的 Session 操作菜单中复制 Session ID。
- 在同一个 Session 的 snapshot 更新以及 Session 切换期间保持 Conversation 和 Hero 上下文
  稳定；替换读取进行时保留上一次有效上下文。
- 过长的 branch 名称在 chip 中折叠，并通过原生 hover card 展示完整值；Sidebar footer action
  对齐原生字体和排版，Sidebar 折叠后不再额外显示 `WT` 按钮。
- Worktree Session 仍出现在原始 DSH Project/Workspace 视角中；插件不复制 Session 内容，
  也不修改消息、prompt、transcript 或历史记录。

### 兼容性与前置条件

Session 重新加载兼容 DSH rc.1 的持久化 header 与新版 DSH 的 header snapshot。
Worktree Dashboard 预览版会为新 Worktree 记录获取事实，并为 active binding 注入已保存的指令。

兼容性事实表如下：

| 组件 / Component | 最低版本 / Min Version | 说明 / Notes                                            |
| ---------------- | ---------------------- | ------------------------------------------------------- |
| DSH Client       | `>=0.1.2-rc.1`         | 依赖 Session/Workspace Controller 及 Client Store       |
| DSH Host         | `>=0.1.2-rc.1`         | 依赖 Typert Gateway `/api` 协议与 subprocess capability |
| Git              | `>=2.20.0`             | 要求支持 worktree 核心命令与 branch 发现                |
| Node.js          | `>=20.0.0`             | 推荐使用 LTS 版本                                       |

## 安装

### 从 npm 安装（推荐）

在已经安装 DSH CLI 的环境中执行：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

如果使用 `deepseek-harness` 源码 checkout、系统没有独立的 `dsh` 命令，使用等价的转发
形式：

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add @cerbur/clutch-dsh-worktree
pnpm dsh web
```

可以通过官方 registry 查看当前发布版本：

```bash
npm view @cerbur/clutch-dsh-worktree version --registry=https://registry.npmjs.org/
```

### 从 GitHub 源码安装

`awesome-dsh-plugin` 生成的源码路径为：

```bash
dsh plugin --profile web add "github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree"
```

这是源码 Git 依赖，安装时由构建脚本生成。关于 pnpm 11 的 `allowBuilds` 授权配置、本地开发与贡献者流程，详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

### 卸载

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

## 使用说明

### 打开 Worktree 模式

1. 启动 DSH Web UI，在 Sidebar footer 选择 Worktree。Worktree 模式是附加界面，不会添加
   独立的 Workspace/Worktree Tab。
2. 使用 Workspace 树搜索、展开并选择 Main 或 Worktree 视角。每组默认显示五行，更多内容
   使用 Expand more/Collapse。

![使用 Worktree 模式时的侧边栏和新会话空白 Hero](assets/screenshots/screenshots-zh.png)

上图展示了侧边栏入口以及新会话空白 Hero 中显示的视觉上下文。界面语言跟随 DSH 当前的
语言设置。

### 打开 Worktree Dashboard

Dashboard 是仅插件的预览版 MVP，不会替换 DSH 原生 Session 页面，也不会写入 DSH 管理的
Workspace/Session 数据。

在 Worktree 模式中，将鼠标悬浮到已管理 Worktree 行并点击 Dashboard 图标，或打开行的选项菜单
并选择 **Dashboard**。对于具有 ready Main 或 Worktree 上下文的当前 Session，也可以点击 Session
标题行中原生 **More actions** 按钮左侧的 Dashboard 图标。Dashboard 会临时替换 Sidebar 旁的区域
（含 Session 页面），原生会话组件保持挂载。点击**返回会话**、按 **Escape**、从 Sidebar 打开
Session 或退出 Worktree 模式，即可恢复原生页面。打开 Dashboard 不会创建或修改 Session；
Local/Main 与已管理 Worktree 行都提供行内 Dashboard 图标，当前 Session 仍可使用标题行快捷入口。
Dashboard 打开后仍可拖动 Sidebar 的宽度。

![Worktree Dashboard 预览](assets/screenshots/screenshots-dashboard.webp)

上图展示了原生 Worktree Sidebar 旁的预览版 Dashboard。已接入的控件仅覆盖 MVP 范围；
未完成的卡片仍会明确标记。

标题沿用 Worktree 行的已接受分支名称，点击标题即可直接复制分支名称。cwd 展示记录中的完整
绝对路径，复制按钮明确反馈成功或失败。如果 DSH 无法提供 Main 的当前分支，Dashboard 会标记为
无法获取且不会提供分支复制。当前分支、可用性与来源使用现有 Worktree 投影；ready 表示 Worktree 可用，**不代表**
Git 文件没有变更。归档或已清理记录仍展示记录中的路径，该路径不一定仍存在于磁盘。

五个 tab 支持左右方向键、Home 和 End。概览显示当前 Worktree 的前五个会话，会话 tab
显示完整列表；两者直接消费内存中的 sessions 和 bindings，沿用 Sidebar 排序与可见性规则，
不受 Sidebar 搜索影响。点击会话返回原生页面。新建会话离开 Dashboard，直接复用现有
create/bind/open 流程，保留空白会话复用与失败恢复。
新建 Worktree 呼出已有创建弹窗，预选当前分支和编号名称；归档 Worktree 呼出已有的非破坏性
确认框。操作沿用 Sidebar 的健康状态、归档状态和进行中操作门禁。
在 VS Code 中打开使用编码后的 `vscode://file/...` 链接打开记录中的 cwd；浏览器所在机器
须安装 VS Code 且能访问该路径，浏览器可能要求确认打开应用。链接不核验目录是否存在或
应用是否成功启动。
在 Worktree 指令卡片中点击**编辑**，可编辑、保存或清空共享指引（最多 32,000 个 UTF-16
code units）。内容保存在插件 sidecar，不写入 AGENTS.md；保存后通过 DSH `agent/pre-step`，
以独立的 `<system-reminder>` 上下文记录进入会话轨迹和下一次模型请求。
消息由 DSH 记录，不重写已有历史。
指令内容按原文插入，其中的 `{{...}}` 示例不会被当作模板变量解析。
归档保留 active binding 和指令；detached binding、清理磁盘或移出管理后停止注入。
清空或失去 binding 后，下一步追加提醒使旧指令失效。指令未变且消息仍可见时不重复注入，
重启后也会去重；压缩移除后按需重新注入。保存失败保留草稿，并发编辑会被拒绝；
取消并重新打开可加载最新内容后重试。

新建 Worktree 显示记录的创建时间和创建时所选基线分支。导入的 Worktree 显示登记时间，
不推测原始创建时间或基线；缺少这些历史事实时，Dashboard 提示**历史 Worktree 无法获取**，
不再显示“未知”。基线是创建时的分支名，
不代表当前 merge-base 或领先/落后计算，checkout 不会修改它。
Open-editor 分体按钮对齐 DSH 原生样式，并提供主机检测到的应用菜单；不可用时回退到上文
说明的 VS Code 协议链接。

Git 详情、派生 Worktree、设置及其他标记的快捷操作仍为占位。界面跟随 DSH
主题，窄屏下卡片纵向排列。Dashboard 选择状态是临时的，刷新页面后不会恢复。

### 创建 Worktree

新目录使用 `$dshHome/clutch-dsh-worktree/worktree/wt_<12-hex-characters>`
（文件夹名为 15 个字符，包含 48 位加密随机数）。
目录名、Git 登记或 sidecar 身份已被占用时自动换名重试；八个随机候选均冲突后，
依次尝试 `_1`、`_2` 等数字后缀，直到找到可用名称或取消。
已有 Worktree 的路径和 ID 保持不变；分支冲突与其他 Git 失败沿用原有错误处理。

1. 选择 Workspace，点击它旁边的 `+`，选择基线 local branch，并填写 Worktree name。默认
   branch 名称为 `dsh/<8-character-random-string>`。
2. 如果要从已有 Worktree 创建同级 Worktree，打开该 active Worktree 的选项菜单并选择
   `创建新的 Worktree`。弹窗会以当前 Worktree branch 作为基线，并为名称选择下一个可用的
   递增序号；已有名称会被跳过。
3. 目标 Worktree 路径必须是绝对路径，属于同一个 Project，且不能是 Project 根目录。相对
   路径、其他 Project 的路径或 Project 根目录都会被拒绝。
4. Git 必须已安装且可在 PATH 中使用。Git 可执行文件缺失时显示安装提示且不显示命令块；请
   安装 Git、重启 DSH 后重试。如果缺少 repository、初始 commit 或本地 branch，按照弹窗中
   的可复制 setup 命令修复后重试。插件只展示这些提示，不会执行 setup 或安装命令或编辑
   业务文件。

### 导入已有 Worktree

1. 选择 Workspace，点击旁边的 `+`，再选择 `导入` Tab。弹窗通过现有 DSH `/api` Connection
   加载该 repository 的 Git Worktree 候选项。
2. 第一版只列出绑定 branch、不是 repository root、且未出现在 plugin sidecar 中的 Worktree。
   detached HEAD、bare、prunable、目录缺失和 `.git` 缺失的条目会被省略。
   已管理 Worktree 的 health 与导入资格共用运行时状态映射，提交导入时重新校验；
   locked Worktree 在其他条件满足时仍可导入。
   候选项通过普通下拉框选择，每个选项先显示 branch，再显示绝对路径
   作为诊断信息。
3. 在下拉框中选择一个选项并点击 `导入 Worktree`。登记只写入 plugin sidecar，已有 Worktree 目录和 Git
   工作状态保持不变。随后会在该 Worktree cwd 创建或复用 Session，并执行与创建相同的
   `bind → open → binding refresh` 流程。
4. 同一 Workspace、同一物理路径的 active external 导入是幂等的。已经由 plugin 管理的路径
   会报错提示；无效或过期候选项在修复 repository 状态后可以重试。

### 创建 Main 和 Worktree Session

- 使用 Main 的 `+`，在 Project 根目录视角中创建普通 DSH Session。
- 使用 Worktree 的 `+`，创建或复用以该 Worktree 为运行时工作目录（`cwd`）的 Session。Session
  直接在 Worktree 视图中打开，不会短暂出现在 Main 列表中。
- 如果存在目标 cwd 完全匹配的未归档空白 Session，连接器会优先复用它。已绑定的 Session 会直接打开；
  未绑定的候选会先完成绑定再打开。否则走新建并绑定的流程，同一个 Worktree 的并发点击会合并处理。
- 如果 DSH 创建 Session 后绑定失败，Session ID 仍会保留，可用于重试或直接打开。插件绝不删除或修改已创建的 DSH Session。
- 打开 active Worktree Session 前，插件会在 DSH 风格的页面内弹窗中说明关联 Git 元数据为什么
  可能需要访问 Session 目录之外的内容。弹窗要求明确勾选风险确认；取消会保留 Session 和
  绑定关系，不改变权限，并留下可重试的待处理状态。需要切换到其他权限模式时，继续使用 DSH
  原生 Access 选择器。
- provisional blank Session 遵循 DSH 原生显示规则：只在当前选中的视角中显示，使用本地化
  的 `New Session` 文案，不显示生成的 ID，也没有 Rename、Fork 或 Archive 菜单。接受第一条
  prompt 后，它会变为普通 Session 行；隐藏 blank 行不会删除 Session 或 Worktree 绑定。

### Session 活动与排序

- Session 行复用 DSH 原生 `StateDot`：运行中的 Session 以及存在运行中子代理的 Session，使用
  右侧动画点替代相对时间。等待审批、计划待审和等待回答使用原生 warning 点；已完成 Session
  保留原生 completed 点。
- 右侧元数据使用原生紧凑时间单位（刚刚、分钟、小时、天、月、年），来源是 DSH 的
  `updatedAt`，该字段随最近一条用户消息推进；空白 New Session 不显示时间。时间只在 snapshot
  render 时按原生规则重新计算，不额外增加每分钟 ticker。
- 将鼠标悬停在 Worktree Session 行上 500 毫秒后，会打开原生详情卡片，展示完整标题、相对时间
  和状态；Session 菜单打开或行正在拖拽时不显示卡片。
- 折叠的 Workspace、Main 或 Worktree 分组，只要任一未归档成员正在运行就显示相同的原生运行点，
  即使该 Session 被搜索隐藏也会计入。展开后隐藏聚合点；hover、focus 或打开菜单时显示原有
  操作控件，并只在此时占用操作栏宽度。
- 用户发送新消息后，Session 会移动到当前 Main 或 Worktree 视觉分组队首。promotion、已观察
  时间戳和每组顺序只存在浏览器本地；手动拖动仍先调用 DSH 原生排序 API，成功后再更新本地顺序。

### Fork Worktree Session

- 支持通过任意 DSH 原生 fork 入口（会话列表选项、Worktree Session 菜单或会话内的 fork 操作）分叉会话。会话历史截取、标题递增和分叉血缘完全沿用 DSH 原生行为。
- 当父 Session 拥有活跃的 Worktree 绑定时，分叉出的子 Session 会自动继承并绑定到同一 Worktree，直接在 Worktree 视图中呈现。绑定刷新期间保持当前已就绪内容可见。
- 如果子 Session 已由 DSH 创建但插件绑定失败，DSH 仍保留该子 Session，界面提供“重试绑定”与“打开已创建会话”恢复操作。后续插件初始化也会根据原生会话血缘重试可恢复的子会话，绝不会自动绑定无关的子代理。
- 分叉绑定由插件外部索引维护，不修改 DSH 原生工作区持久化存储。

### 排序与管理 Worktree

- 在所属 Workspace 内拖动 Worktree 可进行排序。自定义顺序由插件保存；Main 始终固定在第一行，Worktree 不能跨 Workspace 移动。
- 新创建或新导入的 Worktree 会插入所属 Workspace 的 Worktree 列表队头；已有 Worktree 顺序保持不变。
- 打开 Main 和 Worktree 共用的选项菜单可复制所选行的绝对路径。active Worktree 提供“复制路径”与
  “归档 Worktree”。归档 active Worktree 属于内部归档操作：完整保留磁盘目录、关联绑定与运行时 cwd，并将该 Worktree 移动到工作区底部的“已归档”（Archived）分组中。
- 工作区底部在存在已归档 Worktree 时渲染“已归档”分组，默认处于折叠状态；标题显示已归档 Worktree 总数，收起时仍然显示。每个 Workspace 维护独立的折叠状态。
- 处于 repair 状态的 active Worktree 也提供“归档 Worktree”，仅归档记录，保留磁盘文件和绑定。处于 recovery-needed 状态的记录须先完成恢复，不能直接归档。
- 对于未清理磁盘的已归档 Worktree，选项菜单提供：
  1. “取消归档”（Unarchive Worktree）：对于仅元数据标记归档且磁盘目录完好的 Worktree，可直接在菜单中点击取消归档，无需二次确认弹窗，立即恢复为活跃状态。
  2. “清理磁盘”（Clean Up Disk）：弹出二次确认弹窗（明确提示工作树路径与破坏性删除不可逆），告知插件不核验 Session/子代理活动，请用户自行确认使用该目录的任务均已停止，否则删除可能导致任务失败或数据丢失；执行真正的非强制 `git worktree remove`，成功后记录清理完成，关联绑定转为 detached，并将完全访问权限归一化为 `workspace-write + ask`。磁盘清理提交与权限后续解耦：清理成功即确认提交、关闭对话框并将状态转为已清理；权限归一化失败或刷新异常提供独立恢复，不重复执行磁盘删除。如果 Worktree 目录或其 `.git` 入口已在外部删除，确认清理只将插件记录标记为完成并解绑，不再执行 Git 删除。
  3. “移出管理”（Remove from Management）：弹出确认弹窗，删除该 Worktree 的插件记录与全部关联绑定，完整保留磁盘文件与 DSH 原生 Session；同时定向淘汰该 Worktree 的未决 fork 恢复、投影与权限提示。不需要校验 Session 活动。
- 对于已清理磁盘的 Worktree，选项菜单提供“移出管理”以彻底移除该插件记录。
- 会话活动展示仅用于信息参考，不阻断磁盘清理或移出管理。确认磁盘清理前，请自行停止所有使用该目录的任务，插件不会核验任务是否已停止。
- 删除 Workspace 只会删除 DSH 的 Workspace 登记；其目录、Session、Git Worktree 和插件数据完整保留。
- DSH 原生的 Workspace rename/delete/reorder 和 Session 菜单继续可用。Session 拖动排序限定在当前视觉 Main 或 Worktree 分组中。
- Main 分组显示当前 local branch：有分支时为 `本地（branch）`，DSH 没有返回当前分支时回退为 `本地`。如果导入的 Workspace 是 Git 仓库中的子目录，会先解析 Git 根目录，再复用与 Git 根目录相同的 branch/worktree 信息。branch 名称、路径、Workspace 名称、Session 标题以及原始错误信息保持原值。
- 已有 Session 会在标题行显示只读上下文，格式为 `Session title` → `Agent mode` → `current branch / Worktree branch`。过长值在紧凑 chip 中折叠，并通过 hover card 显示完整内容。原生标题存在且有锚点时，新会话空白 Hero 会在标题后显示 `Workspace (branch)`，并提供相同的完整值 hover card。
- Sidebar 折叠后，footer 保留原生的 icon-only action 尺寸和排版；插件不会额外绘制独立的 `WT` rail control。

### 同步在 Git 中切换的分支

外部执行 `git checkout` 后，下次 Worktree 读取显示“旧分支 → 当前分支”与分支变化提示。
刷新或打开 Worktree 菜单时会读取，插件不持续监听 Git。分离 HEAD 会明确标注。
Session binding 和运行时 cwd 保持不变，普通分支切换不会锁住整个 Workspace。

在活动或归档 Worktree 菜单中选择“采用当前分支”（`Adopt current branch`）并确认，
只更新插件记录的分支。确认期间 Git 分支或快照已变化时会拒绝操作，请刷新后重新确认。
分离 HEAD 必须先在 Git 中切换到分支；清理磁盘前必须先采用当前分支。
Git 明确证明原记录已切走时，允许用空闲的旧分支创建 Worktree；真正被 checkout 的分支仍不可用。

确认失败会在弹窗内显示错误。点击“重试”（`Retry`）重新读取当前分支和快照 token，
再确认更新后的分支变化；刷新成功前不能再次提交旧确认。如果 Worktree 已不再处于
分支漂移状态或进入分离 HEAD，弹窗会关闭。从该行创建新 Worktree 使用读到的当前分支，
无需先采用分支；分离 HEAD 不提供此操作。

`recovery-needed` 行的菜单提供“重试恢复”（`Retry recovery`），作用于所属 Workspace。
该操作只重试安全 journal 恢复，不自动采用分支、不删除未知路径、不清除未解决的身份问题。
采用分支和恢复成功后只刷新所属 Workspace，并保留现有 ready 内容。

### 理解状态与恢复提示

- 操作、权限、绑定和刷新失败统一使用 DSH 原生 toast，逐条显示；相同错误不会随每次渲染重复提示。
  toast 消失后，完整信息及原有重试/打开操作仍保留在可展开的“提示详情与恢复操作”入口。
  表单校验和 Workspace Git 初始化指引保留在对应输入附近。
- 悬停或聚焦 active Worktree 行可查看状态、路径以及目录/Git 登记缺失、分支漂移/分离 HEAD、
  恢复未完成的处理指引。打开菜单或拖动时不显示 hover 卡片。归档确认明确说明插件创建及外部
  Worktree 都保留目录、Session 绑定和 cwd；“清理磁盘”仍是独立操作。
- `ready` 表示 Worktree 可用。`cleaned` 表示磁盘清理已完成且保留 sidecar 归档条目。
  `repair` 表示 Worktree、Session、binding 或 cwd 缺失/无效。`recovery-needed` 表示 Git/sidecar
  操作或身份校验尚未解决，破坏性操作会被阻止。`detached` 表示 Git Worktree 已被移除，但关系仍然保留。active binding 指向缺失
  Worktree 时会显示明确的 repair 警告或错误，不会静默切换到其他 Worktree。
- 没有未完成 Git 事务时，目录缺失的 active 或 archived Worktree 保持 `repair`，可归档，
  不会阻断健康 Worktree 的 Session 绑定。
- Worktree health 是 Git 的运行时 projection，不写入 sidecar。Git 前置条件失败按
  Workspace 显示提示：Git 可执行文件缺失时显示安装提示且不显示命令块，缺少 repository、
  初始 commit 或本地 branch 时显示可复制的 setup 命令。Connection、Gateway 和未预期的
  Worktree domain 错误会保留为可重试错误，不会伪装为空列表。
- 权限状态会明确显示为完全访问、回退到 `workspace-write`、保留用户限制、能力未验证、
  等待确认或可重试的设置失败，不会静默折叠为空列表或伪造成功。
- 已经 ready 的视角刷新时会保留当前 projection，直到替换数据可用。同一个 Session 的
  snapshot 更新不会清空上下文，也不会触发重复读取；没有缓存视角时，首次进入和显式 Retry
  可以显示 loading 状态。

## 界面语言

Worktree 模式跟随 DSH 当前界面语言。语言偏好由 DSH 管理；插件不增加独立的语言设置。
Worktree 入口、Workspace → Worktree → Session 树、菜单、弹窗、状态和重试提示均提供中文
和 English 文案。

Workspace 名称、Session 标题、branch 名称、路径以及 DSH/Host 返回的原始错误信息保持不变，
便于诊断和继续使用 DSH 原生数据。Main 分组在 English 中本地化为 `Local (branch)`，中文
为 `本地（branch）`；没有返回当前 branch 时分别回退为 `Local`/`本地`。

## 数据边界与当前限制

DSH 管理原始 Project/Workspace 身份和根目录、Session 身份和元数据、原生 Project/Session
列表、消息、prompt、transcript 和历史记录。插件不会复制或重写这些内容。插件的外部索引
位于 DSH host 的 plugin data directory 或独立 sidecar 存储中，只能包含以下关系事实：

- `projectId`、`worktreeId` 和 `sessionId` 映射关系；
- 绝对 Worktree 路径、branch 和生命周期状态；
- Worktree 来源（`plugin` 或 `external`）；
- binding 状态和 schema version。

索引不会写入 Project 工作树或 DSH 原始数据目录，也不会保存 `projectRoot` 副本或任何
Session 内容。如果 sidecar 不可用或损坏，原生 Project/Session 视角仍然可读，插件进入
degraded/read-only 状态；不能用空索引覆盖 DSH 原生列表。

Session 活动仅用于信息展示，不阻断磁盘清理或移出管理。确认磁盘清理前，请自行停止所有使用该目录的任务，插件不会核验任务是否已停止。
原生活动变化或重新打开归档菜单会刷新所属 Workspace 并保留 ready 内容。

一个 Session 最多绑定一个 active Worktree，一个 Worktree 可以绑定多个 Session。Session
重复绑定同一个 Worktree 是幂等的，绑定两个 active Worktree 会产生 conflict。没有 binding、
使用 Main binding 或处于 detached binding 的 Session 使用 Project 根目录作为 cwd；active
Worktree binding 使用对应的 Worktree 路径。cwd 在每次执行时派生，不会写回 DSH Session 元数据。

创建 Worktree 时先创建 Git Worktree，再记录外部关系；sidecar 写入失败时会尽可能清理刚创建的
Git Worktree。创建 Session 时先调用 DSH 原生 API，再写入 binding；binding 失败不会删除或修改
已创建的 Session。

Worktree Session 视图通过前端视图投影呈现绑定的 Worktree 上下文，不修改 DSH 原生 Workspace 持久化数据。

权限变更只使用 DSH 公共的 per-Session 权限服务。插件不会写入消息、prompt、transcript、Workspace 数据或 Session
metadata，也不能扩大运行 DSH 的宿主沙箱边界。

空白 Hero 上下文只用于展示。由于当前 upstream DSH source checkout 没有 additive Hero
headline slot，它的位置依赖原生 DOM 锚点；锚点不可用时浮层会消失，未来有正式 DSH slot 时应迁移到该 slot。

关于详细的领域模型、生命周期迁移、恢复保证与开发贡献流程，请参阅：

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 权威架构设计、生命周期与恢复不变量
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 本地开发、测试验证与贡献指南
- [docs/RELEASING.md](docs/RELEASING.md) — 发布参数与版本规则
- [AGENTS.md](AGENTS.md) — Coding Agent 维护说明
- [src/client/README.md](src/client/README.md) — 浏览器客户端集成与界面接缝
