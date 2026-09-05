# @cerbur/clutch-dsh-title

## 功能介绍

`@cerbur/clutch-dsh-title` 通过 DSH 原生 `@deepseek-ai/dsh-session-title` seam 和 `ctx.sessionTitle` 替换默认的 `session-title-first-prompt-llm` provider。它只从首条 eligible prompt 提取语义字段，再根据经过校验的 template 以 deterministic 方式生成最终 title。

![默认 deterministic title 流程](assets/screenshots/title-default.svg)

默认 title 形态是 `0904|配置|优化 session title 生成规则`：按 timezone 计算的 session 创建日期、LLM 选择的任务类型，以及对首次 prompt 的简短描述。

## 能力

- 提供不可修改的内置 `default` 模板，以及支持开放字段命名的用户模板。
- **设置 → 会话标题** 支持新增、编辑、删除、激活模板，或关闭自定义以使用 DSH 原生首条消息标题生成。
- 数据实时存储于 `$DSH_HOME/settings.yaml`；非法模板保留展示，当前模板非法或缺失时降级到 `default`。
- field kind 固定为 `datetime`、`literal`、`llm-enum` 和 `llm-text`。
- 所有 `llm-*` 字段合并为一次 structured JSON LLM request；`datetime` 和 `literal` 字段不依赖模型输出。
- template DSL 只支持 `${identifier}`；函数、路径、条件、表达式和代码执行都会被拒绝。
- 管理的模板非法时使用 `default`；extraction 失败、取消、超时、空输出、tool call 和非 stop finish 使用 DSH 原生 fallback。
- `maxTitleBytes`、persistence、rename pin、refresh、fork inheritance、取消和 stale-result protection 仍由 DSH 负责。
- 不批量迁移已有 session；新配置在 native service 执行 explicit refresh 时才影响重新生成。
- 本 plugin 只注册一个 native session-title provider；同一 context 不要重新启用默认 provider，也不要安装另一个 title provider。

## 安装

### npm registry

安装 package 并将它加入 DSH web profile：

```bash
npm install @cerbur/clutch-dsh-title
dsh plugin --profile web add @cerbur/clutch-dsh-title
```

package 需要 DSH runtime peer `>=0.1.2-rc.1`，包括 `@deepseek-ai/dsh-session-title`、`@deepseek-ai/dsh-session-title-llm`、`@deepseek-ai/dsh-llm` 和 `@deepseek-ai/dsh-session`。

### 源码 checkout

在本地 `clutch-dsh` checkout 中安装 workspace 依赖，然后加入 plugin 目录：

```bash
pnpm install
dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title
```

package 包含 Host 和 browser 入口，通过 `cordis.patch.yml` 和 DSH client loader 挂载。设置页面依赖原生 settings、settings UI、locale 和 API remotes；没有 settings 的 Host-only 组合保留 Cordis 配置行为。

## 详细使用

### 模板管理

打开 **设置 → 会话标题**。**新增模板** 会复制 `default`；填写唯一名称、编辑 YAML，然后 **保存**、**激活**。保存新模板不会自动激活。`default` 可以查看和选择，但不能编辑或删除。删除已选择的模板会选择 `default`。关闭 **使用标题模板** 后保留模板及选择，并调用 DSH 原生首条消息 LLM 标题生成器。

![会话标题模板管理](assets/screenshots/template-manager.png)

多行编辑器仅接受 `template` 和可选的 `fields`，不填写 `preset`。保存校验 YAML 语法、重复键、`${identifier}` 引用、字段类型、日期/时区格式和枚举/文本约束。名称为 1–64 个字母、数字、空格、下划线或连字符，以字母或数字开头。`default`、`constructor`、`prototype`、`__proto__` 为保留名称。模板文本最多 65536 个字符。字段按名称继承内置字段，覆盖时替换整个定义。

唯一数据源是 `$DSH_HOME/settings.yaml`（通常为 `~/.dsh/settings.yaml`，或 DSH settings provider 配置的文件）中的 `clutch-dsh-title` 命名空间，不使用 browser storage 或 `clutch.yaml`：

```yaml
clutch-dsh-title:
  enabled: true
  active: personal
  templates:
    personal: |
      template: '${daytime}|${desc}'
```

DSH watcher 接收外部编辑。非法模板保留展示错误、禁止激活。当前选择非法或缺失时使用 `default`；修复并保存后恢复该选择。外部 `default` 覆盖被忽略。容器配置非法时展示诊断并使用安全默认值。整个 YAML 文档损坏时，DSH 在热更新中保留最后可读取的文档。

页面发送写入前执行校验；存储 schema 有意接受外部非法条目，使其仍可修复。运行时生成再次校验。写入保留其他条目并携带 `expectedRevision`；过期保存返回 `settings/conflict`。收到外部更新后保留草稿并要求重新打开编辑器。DSH 在文件 watcher 接收外部编辑前存在竞态窗口，请避免同时手工编辑文件与页面保存。只读 settings 禁用写入。

### 既有 Cordis 配置

bundle patch 会按精确的 id/name 禁用名为 `@deepseek-ai/dsh-session-title-first-prompt-llm` 的 DSH entry，再插入 `preset: default` 的本 plugin。title subsystem 仍只有 native service。

既有 Cordis 覆盖继续支持。组合 settings 时，显式 `template`/`fields` 覆盖成为继承的可编辑 `legacy` 模板，不会修改 `default`。存储的 templates 映射替换继承的映射。模型路由和请求预算仍使用 Cordis 配置。默认 Cordis 配置如下：

```yaml
preset: default

template: '${daytime}|${type}|${desc}'

fields:
  daytime:
    kind: datetime
    source: session.createdAt
    format: MMDD
    timezone: Asia/Shanghai

  type:
    kind: llm-enum
    instruction: 判断这个 session 的任务类型
    values: [前端, 后端, 配置, 文档]

  desc:
    kind: llm-text
    instruction: 总结首次 prompt，保留具体任务含义
    maxCharacters: 32
```

field definition 按 field name 合并，但每次覆盖会替换整个 field definition。例如可以使用任意 field name 和受控的 values：

```yaml
preset: default
template: '${daytime}|${kind}|${desc}'
fields:
  kind:
    kind: llm-enum
    instruction: 判断任务是优化、功能还是修复
    values: [优化, 功能, 修复]
  desc:
    kind: llm-text
    instruction: 总结首次 prompt
    maxCharacters: 32
```

所有 LLM field 会放进一次 JSON-framed request。模型只返回字段；renderer 负责插入 deterministic 值和 literal separator。renderer 不执行 template 内容，field validation 会在渲染前 trim、清理控制字符，并校验 enum membership 或 Unicode character limit。

如果 extraction 失败，provider 会抛错，由 `ctx.sessionTitle` 使用 DSH 原生 fallback。native `rename()` 仍会 pin 用户 title，后续自动生成不能覆盖；native `refresh()` 仍是显式重新推导操作。title 和 `session/title-llm-request` event 使用 DSH persistence，并由 native fork 继承。配置变化不会重写历史 title event，也不会触发批量 rename。

同一 context 只能注册一个 provider。启用本 package 时请保持默认 provider disabled，也不要和另一个同样注册 `ctx.sessionTitle` 的 provider 组合。

package-specific release 参数见 [`docs/RELEASING.md`](docs/RELEASING.md)，公开 release history 见 [`RELEASE-LOG.md`](RELEASE-LOG.md)。
