[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-title

@cerbur/clutch-dsh-title 为新的 DSH Session 提供可配置、易浏览的标题。在 DSH Web 中打开
设置 → 会话标题，可以选择内置或已保存的模板，也可以创建自己的模板。

标题可以组合会话日期、固定文字、受控分类和首条 prompt 的简短描述，例如
0912 | 🚀 | add token statistics。生成结果仍显示在 DSH 原生 Session 列表中；本 package
增加标题 provider 和设置管理器，不会替换原生列表。

## 安装

### 从 npm 安装

在已安装 DSH CLI 的环境中，将 package 加入 Web profile 并启动 DSH Web：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-title
dsh web
```

如果使用 DeepSeek Harness 源码 checkout 且没有独立的 dsh 命令，可使用等价的 pnpm dsh
形式。

### 从本地 checkout 安装

package 的 lib/ 目录由构建生成，不会提交到仓库。先构建 workspace package 和 DSH 源码
checkout，再通过绝对路径添加 package：

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-title build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title
pnpm dsh web
```

修改源码、package 元数据或 cordis.patch.yml 后，需要重新构建 package，并再次执行绝对路径
添加命令。

## 功能

| 功能              | 预览                                                                                                        | 作用                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 原生 Session 标题 | <img src="assets/screenshots/session-title-list.png" width="420" alt="DSH 原生 Session 列表中的自定义标题"> | 选中的模板会自动组合日期、分类、固定文字和首条 prompt 摘要，生成紧凑标题。标题仍位于 DSH 原生 Session 列表中；plugin 不会接管该列表。    |
| 模板管理器        | <img src="assets/screenshots/title-settings.png" width="420" alt="DSH 设置中的会话标题模板管理器">          | 设置 → 会话标题支持预览、复制、编辑、保存、激活和删除，也可以在同一页面启用或关闭自定义标题生成。                                        |
| 灵活的模板字段    | —                                                                                                           | datetime 和 literal 字段以确定性方式解析，不使用模型。llm-enum 和 llm-text 是模型字段；当前模板引用的 LLM 字段会在一次结构化请求中提取。 |
| 生成统计          | —                                                                                                           | 查看生成次数、累计输入/输出/总 Token，以及可用时的最近一次生成明细。确认后可以重置已保存的统计。                                         |

## 使用

### 选择标题模板

1. 使用 dsh web 启动 DSH Web。
2. 打开设置 → 会话标题。
3. 保持使用标题模板开启，选择一行并点击激活。
4. 创建新的 Session，或对已有 Session 使用 DSH 原生的标题刷新操作。

新设置文件默认选中只读的 default 模板。新选择的格式不会改写已有标题，除非 DSH 显式
生成或刷新标题。

### 管理模板

全新的设置包含可编辑的 emoji 模板，同时保持内置 default 模板处于选中状态。emoji 模板
可以编辑或删除；删除后，在之后重新注册设置时不会自动重新出现。

- 可以复制任意一行（包括 default），打开可编辑副本。
- 为副本填写唯一名称，编辑 YAML 并点击保存。保存不会自动激活。
- 需要让已保存模板生效时，点击激活。
- 可以查看或选择 default，但不能编辑或删除。
- 删除当前激活的自定义模板后，会选择 default。
- 每一行在编辑时都会展示示例标题。示例不调用模型。

### 创建自定义模板

编辑器接受 template 和可选的 fields。模板中的
${daytime} 会从 fields.daytime 解析，${desc} 会从 fields.desc 解析：

每个 ${fieldName} 引用都会由 fields.<fieldName> 解析；它只是字段替换，不是指令或表达式。

```yaml
template: '${daytime} | ${desc}'
fields:
  daytime:
    kind: datetime
    source: session.createdAt
    format: MMDD
    timezone: Asia/Shanghai
  desc:
    kind: llm-text
    instruction: Summarize the first prompt in a few words
    maxCharacters: 32
```

确定性值使用 datetime 或 literal；受控的模型分类使用 llm-enum；简短的模型生成文本使用
llm-text。保存时会先校验 YAML 和字段定义，校验通过后模板才可以被激活。

### 刷新 / 重新生成标题

使用 DSH 原生的 Session 标题刷新操作，显式再次运行当前 provider。刷新使用当前模板和
Session 原始的 createdAt，因此仅刷新标题不会改变日期字段。

### 关闭自定义标题

在设置 → 会话标题中关闭使用标题模板。已保存的模板和选择会保留，但 DSH 会恢复使用原生
的首条 prompt 标题生成器。

### 查看生成统计

打开设置 → 会话标题，可以查看有有效用量数据的标题模型累计调用次数、输入 Token、输出
Token、总 Token，以及模型提供时的最近一次调用明细。重置需要确认。只包含确定性字段的
模板不会调用模型，也不会增加生成统计。

首条响应不可用的生成不会静默消失。package 会把 incident、拒绝原因和有界的原始响应记录在
clutch_title_diagnostics storage domain，并通过 titleStats remote namespace（getDiagnostics 和
resetDiagnostics）暴露同一份记录，每个 incident 还会写一条 warning 日志。设置面板目前只显示
Token 统计，诊断信息需要从 storage domain 读取。

## 模板参考

模板使用简单的字段替换：

| 字段类型 | 用途                                         | 是否使用模型 |
| -------- | -------------------------------------------- | ------------ |
| datetime | 使用 session.createdAt 格式化 Session 时间戳 | 否           |
| literal  | 插入固定文字                                 | 否           |
| llm-enum | 从声明的受控值中选择一个                     | 是           |
| llm-text | 生成一段简短文本                             | 是           |

使用 ${identifier} 形式的占位符。identifier 必须对应已声明的字段。占位符不支持函数、
表达式、条件、循环或任意代码。未知字段、格式错误的 YAML 和非法字段定义会在校验时被
拒绝。

## 配置

模板设置保存在 $DSH_HOME/settings.yaml 的 clutch-dsh-title 区段中。这个设置文件是模板
映射、当前模板和启用状态的 source of truth。

DSH 通常会将 ~/.dsh/settings.yaml 作为该文件的默认位置，但文档约定的 source of truth 是
$DSH_HOME/settings.yaml，而不是写死的 home 目录路径。package 不使用 browser storage，也不
使用 clutch.yaml。

通过外部方式修改设置文件后，DSH 的设置重新加载路径会读取这些修改。非法模板条目会继续
显示在设置中，便于修复，而不会被静默丢弃。

profile 配置还可以设置：

- repairAttempts：当模型返回不可用输出时，一次标题生成最多额外发起的模型调用次数。默认 1，
  可接受 0 到 3，更大的值会被拒绝。这些调用与 timeoutMs 共用同一个预算，并且绝不会用于
  传输错误、取消或超时。

## 行为与限制

- 自动标题只使用首条符合条件的用户 prompt，后续消息不会自动替换标题。
- 首条 prompt 过长时，会在配置的输入字节预算内裁剪，并尽量保留开头和结尾。原始
  Session 消息不会被修改。
- 修改模板只影响后续生成或显式刷新，不会批量重写已有标题。
- 当前激活模板缺失或非法时，设置管理器会使用内置 default 模板。
- 如果字段提取、渲染或自定义标题生成失败，DSH 会使用正常的首条 prompt 标题生成器。该
  fallback 是 DSH 自己对首条 prompt 的截断结果，因此不遵循模板。
- 模型会被要求只输出一个 JSON 对象：键集合必须精确等于声明的字段，枚举字段必须使用声明的
  字面值之一，并给出字面形状示例。当响应仍不可用时，package 会再发一次有界的纠正轮，把被
  拒绝的响应原文引用回去并说明拒绝原因，最多 repairAttempts 次额外调用。
- 只有不可用的输出会被修复。传输错误、取消或超时耗尽会保留自身错误并立即 fallback；所有
  尝试共用同一个 timeoutMs 预算。
- 每个 incident 会记录一次日志（provider、model、消息 seq、拒绝原因，以及截断到 2000 字符的
  原始响应），并持久化到 clutch_title_diagnostics storage domain（每个 incident 最多 4 条
  attempt；storage 不可用时内存最多缓存 64 条 incident）。持久化是 best effort，绝不会延迟或
  让标题生成失败。
- 标题长度限制、标题持久化、手动重命名后的 pin、刷新和取消 pin、fork 的标题事件继承、
  取消以及过期结果保护，仍由 DSH 负责。
- bundle patch 会先禁用 DSH 默认的 session-title-first-prompt-llm provider，再插入本
  provider。DSH 只允许一个 session-title provider：不要重新启用默认 provider，也不要在
  同一 profile 中安装另一个 title provider。第二次注册会被 DSH 的单 provider 约束拒绝。

## 要求

- DSH peer 包括 @deepseek-ai/dsh-settings、@deepseek-ai/dsh-storage-domain、
  @deepseek-ai/dsh-typert-protocol、@deepseek-ai/dsh-api-remotes、
  @deepseek-ai/dsh-client-locale、@deepseek-ai/dsh-client-ui-settings、
  @deepseek-ai/dsh-client-ui-slots、@deepseek-ai/dsh-client-ui-primitives、
  @deepseek-ai/dsh-llm、@deepseek-ai/dsh-session、@deepseek-ai/dsh-session-title、
  @deepseek-ai/dsh-session-title-llm、@deepseek-ai/dsh-timeout 和
  @deepseek-ai/dsh-util-values，全部要求 >=0.1.2-rc.1。
- Cordis：@deepseek-ai/cordis 4.0.1。
- Profile：提供 package 所声明的 session、session-title、LLM、settings、storage、remote
  和 browser settings service 的 DSH Web profile。

### 兼容性

通过 Cordis 配置提供的 template 和 fields 仍然兼容。当这些值来自 profile 配置时，设置页面
会将它们显示为可编辑的 legacy 行。当前设置模板管理器和 legacy 配置使用相同的校验规则。

模型路由和可选的 reasoning 设置属于 profile 级配置，不属于模板字段设置。请保持 DSH 默认
title provider 关闭，也不要将第二个 title provider 与本 package 组合。

## 开发

在 workspace 根目录构建、类型检查和测试：

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
pnpm --filter @cerbur/clutch-dsh-title test
```

package 特有的发布参数和源码安装限制见
[docs/RELEASING.md](docs/RELEASING.md)。面向用户的发布历史见
[RELEASE-LOG.md](RELEASE-LOG.md)。

## 卸载

使用 DSH CLI：

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-title
```

如果使用 DeepSeek Harness 源码 checkout，可对同一个 package name 使用 pnpm dsh plugin
--profile web remove。

## 友情链接

- [LINUX DO](https://linux.do/) — 新的理想型社区。
