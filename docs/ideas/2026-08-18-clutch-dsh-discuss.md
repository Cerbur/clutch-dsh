# clutch-dsh-discuss

状态：Idea only

`clutch-dsh-discuss` 是一个面向需求讨论和设计产出的 planned plugin idea。用户加载 plugin 后，可以启动一个 discussion session，用引导式页面逐步澄清“要做什么”，最后把讨论结果整合成一份 design doc。

## 想解决的问题

传统 agent 或 Codex 式的 brainstorming 主要依赖连续对话。用户需要在一长段文字中理解当前讨论阶段、记住待选方向，再用自然语言回应。这个 plugin 希望把需求澄清过程变成更容易跟随的 guided session，让用户通过逐步选择和补充信息参与形成 design doc。

## 核心体验

1. 用户加载 plugin 后启动 discussion session。
2. 用户点击“讨论一个需求”，界面拉起输入框，接收需求背景、目标或已有想法。
3. 系统根据当前讨论阶段，逐步展示交互式卡片，让用户选择方向、约束、优先级或下一步关注点。
4. 用户完成若干轮选择和补充后，系统汇总讨论内容。
5. 系统生成 design doc，用户可以继续修改、补充或确认，再决定是否进入后续实现规划。

期望的体验是有明确步骤、可视化选项和阶段反馈的引导式讨论，而不是只有聊天消息流的 brainstorming。

## 初步流程

```text
加载 plugin
  -> 启动 discussion session
  -> 输入需求
  -> 交互式卡片：澄清目标 / 选择方向 / 补充约束
  -> 交互式卡片：确认范围和成功标准
  -> 汇总讨论结果
  -> 生成 design doc
  -> 用户确认或继续修改
```

## 可能的 session 阶段

以下名称只是帮助后续讨论的初始模型，不代表已经确定的接口：

- `intake`：收集需求和背景。
- `clarify`：澄清目标、用户、问题和约束。
- `explore`：展示候选方向，帮助用户比较取舍。
- `shape`：收敛范围、交互、数据流和验收标准。
- `draft`：生成 design doc 草稿。
- `review`：等待用户确认或提出修改。

## 设计边界

- 讨论过程应保留为 session，便于用户返回上下文并继续推进。
- 卡片内容应由当前讨论上下文驱动，而不是固定展示一套问卷。
- 用户既可以点击选项，也应该能够通过输入框补充无法预先枚举的内容。
- design doc 是讨论结果的结构化投影，不应丢失用户明确给出的原始约束和决策理由。
- 第一阶段重点是讨论体验和 design doc 产出，不预设直接修改代码或自动执行实现。

## Package 规划入口

按仓库的 Service Definition、Provider、Consumer 三类 package 约定，先创建不含 `package.json` 的规划目录，避免在能力边界和交互协议尚未确定前把它们实现为 runtime package：

- `packages/clutch-dsh-discuss/`：Service Definition 规划入口，未来计划包名为 `dsh-clutch-dsh-discuss`。
- `packages/clutch-dsh-discuss-local/`：Provider 规划入口，未来计划包名为 `dsh-clutch-dsh-discuss-local`。
- `packages/tool-clutch-dsh-discuss/`：Consumer 规划入口，未来计划包名为 `dsh-tool-clutch-dsh-discuss`。

职责的初步分工：

- Service Definition 提供 discussion session 的状态、交互卡片和 design doc 结果的公共 contract。
- Provider 负责 session 推进、状态持久化、候选卡片/回答校验和 design doc 组装等运行时能力；具体 tool 还是其他承载机制尚未确定。
- Consumer 负责引导式页面、输入框、交互式卡片和 design doc review 体验。

### 交互逻辑由什么承载

目前尚未决定是新增一个 tool 来实现交互式讨论逻辑，还是使用其他机制，例如：

- tool 负责推进 session，Consumer 负责渲染输入框和卡片；
- host/plugin UI 提供原生 guided session 能力，plugin 只提供状态和 schema；
- 使用事件或结构化 response，让上层 UI 根据 response type 自己渲染交互；
- 先实现最小 tool contract，再根据实际 UI 能力演进为更完整的交互协议。

这个选择需要结合 DSH/Cordis 当前可提供的 UI、tool response 和 session API 再确定。

## 其他待决策项

- 交互式卡片支持哪些类型：单选、多选、排序、文本补充、确认等。
- 卡片由模型生成、由 plugin 根据 schema 生成，还是两者结合。
- 用户跳过、返回、修改上一选择时，session 如何回退和重算后续卡片。
- design doc 是否使用仓库现有的 superpowers spec 格式，还是定义独立模板。
- design doc 生成后由谁持久化、展示和导出。
- discussion session 与普通 DSH session 的关系，以及是否需要独立的 session 类型或 metadata。
- 如何处理模型生成的候选项不完整、重复或与已有约束冲突的情况。

## 下一步

先确认 DSH/Cordis 能提供的 UI、结构化 tool response 和 session 能力，再为最小可行的 discussion session 设计 Service Definition、Provider 和 Consumer 的边界。
