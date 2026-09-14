[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-discuss

`@cerbur/clutch-dsh-discuss` 为 DSH profile 增加 `/discuss [topic]`。它把当前 conversation
交给 bundled brainstorming workflow，帮助用户把一个想法逐步形成经过 review 的 design doc。

命令会保留在现有的 DSH conversation 中。它是一个工作流入口，不是新的 Session，也不是
独立的文档编辑器。

## 安装

### 从 npm 安装

在已安装 DSH CLI 的环境中：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
dsh web
```

如果使用 DeepSeek Harness 源码 checkout 且没有独立的 `dsh` 命令，可使用等价的
`pnpm dsh` 形式。

### 从本地 checkout 安装

先构建 package 和 DSH 源码 checkout，再用绝对路径添加 package：

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-discuss build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-discuss
pnpm dsh web
```

目标 DSH profile 必须提供这个 package 声明的 command 和 skill service。修改 `package.json`
或 `cordis.patch.yml` 后，需要重新执行绝对路径安装命令。

## 功能

| 功能                | 预览                                                                                                               | 作用                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/discuss` 入口** | <img src="assets/screenshots/discuss-mvp.svg" width="420" alt="从命令到 design doc 的 Discuss brainstorming 流程"> | 在当前 DSH conversation 中使用 `/discuss` 或 `/discuss <topic>` 开始结构化 brainstorming。流程会探索上下文、澄清问题、比较方案、取得批准、复核 spec，再进入实现计划阶段。 |

## 使用

### 开始讨论

在 DSH conversation 中不带主题执行：

```text
/discuss
```

也可以提供主题：

```text
/discuss 为受邀请用户设计一个登录流程
```

命令会启动 bundled brainstorming workflow，依次引导项目上下文探索、澄清、方案比较、设计
批准、spec 自审和用户复核。

### 查看 design doc

设计获得批准后，workflow 默认使用：

`docs/clutch/specs/YYYY-MM-DD-<topic>-design.md`

`/discuss` 本身不会创建 Session，也不会直接写文件。skill 在流程通过 review gate 后写入设计
文档；后续的 implementation planning 和编码仍是普通的 DSH workflow。

## 要求

| 组件               | 要求                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| DSH command 和 LLM | package peer range 声明的 DSH command 和 LLM service：`>=0.1.1-rc.2 <0.2.0-0`，或兼容的 `0.1.2` 系列版本。 |
| DSH skill          | package peer range 声明的 DSH skill service：`>=0.1.0-rc.8 <0.2.0-0`，或兼容的 `0.1.2` 系列版本。          |
| Cordis             | `@deepseek-ai/cordis` `>=4.0.1 <5.0.0`。                                                                   |
| Profile            | 必须提供 command、LLM 和 skill service 的 DSH profile。                                                    |

## 行为与限制

- plugin 注册一个 bundled `brainstorming` skill 和一个人类可用的 `/discuss` command，不增加
  自定义 UI、Session store 或独立持久化层。
- 不带主题时，命令启动 `/brainstorming`；带主题时，会 trim 输入，并把 brainstorming gesture
  和主题放在一条 user message 中发送。
- receiving agent 无法接受 steer message 时，命令会返回明确错误，不会错误地宣称讨论已开始。
- bundled skill 随 package 提供 visual companion 和 spec-reviewer 资源，workflow 运行时可以
  使用这些资源。
- design doc 路径属于 bundled skill contract，应保持在 `docs/clutch/specs/` 下。

## 开发

在 workspace 根目录构建、类型检查和测试：

```bash
pnpm --filter @cerbur/clutch-dsh-discuss typecheck
pnpm --filter @cerbur/clutch-dsh-discuss build
pnpm --filter @cerbur/clutch-dsh-discuss test
```

package 特有的发布和资源打包约束见 [docs/RELEASING.md](docs/RELEASING.md)。

## 卸载

使用 DSH CLI：

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-discuss
```

如果使用 DeepSeek Harness checkout，可对同一个 package name 使用
`pnpm dsh plugin --profile web remove`。

## 友情链接

- [LINUX DO](https://linux.do/) — 新的理想型社区。
