# @cerbur/clutch-dsh-discuss 发布与安装

通用发布生命周期——release log 规则、worktree 门禁、npm 发布步骤和 release tag 规则——统一记录在仓库根目录的 [`docs/RELEASING.md`](../../../docs/RELEASING.md)。本文档只记录本 package 的参数、安装来源和特有约束。

## 包参数

| 参数                           | 值                           |
| ------------------------------ | ---------------------------- |
| `<npm-package-name>`           | `@cerbur/clutch-dsh-discuss` |
| `<plugin>`（workspace 目录名） | `clutch-dsh-discuss`         |
| `<release-name>`               | `discuss`                    |
| release branch / worktree 前缀 | `wt-discuss-<version>`       |
| release tag                    | `discuss-release-<version>`  |

`packages/clutch-dsh-discuss/package.json` 的 `version` 是唯一版本源。README、安装命令和本 package
文档不重复写当前版本号；已发布的 `name + version` 不能原地覆盖。

## DSH 依赖约束

本包以当前 release lockfile 中的 DSH/Cordis API 为开发基线，并将这些能力声明为 peer dependencies：

| Package                     | Constraint              |
| --------------------------- | ----------------------- |
| `@deepseek-ai/cordis`       | `4.0.1`                 |
| `@deepseek-ai/dsh-commands` | `>=0.1.1-rc.2 <0.2.0-0` |
| `@deepseek-ai/dsh-llm`      | `>=0.1.1-rc.2 <0.2.0-0` |
| `@deepseek-ai/dsh-skill`    | `>=0.1.0-rc.8 <0.2.0-0` |

`@deepseek-ai/dsh-skill` 是 skill registry 的实际 Service Definition 包名；它提供 `ctx.skills`
类型扩展和运行时注册服务。不要把上述 DSH package 复制为 runtime dependencies。

## 安装来源

### npm registry

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
dsh web
```

### 本地 checkout

```bash
cd /path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-discuss build

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-discuss
pnpm dsh web
```

源码安装必须使用构建后的 package 目录；如果 DSH profile 通过 Git 依赖执行构建脚本，安装方按
该 profile 的 pnpm build-script 授权规则确认 `prepublishOnly`/prepare 行为。

## 本包特有约束

- `package.json.files` 必须继续包含生成的 `lib/`、`cordis.patch.yml`、`skills/` 和 `assets/`；`README`、`RELEASE-LOG.md` 与本目录的发布说明属于仓库文档，不是运行时 skill 资源。
- `cordis.patch.yml` 必须以 `clutch-dsh-discuss` id 将 package 插入 DSH bundle，且 package 入口通过 `inject: ['commands', 'skills']` 注册 skill 后再注册 command。
- `skills/brainstorming/` 的三个资源文件必须随 package 发布；`lib/skill.js` 会在运行时从相邻的 `skills/` 目录读取 `SKILL.md`。
- 设计文档路径必须保持为 `docs/clutch/specs/`，不能恢复为 `docs/superpowers/specs/`。
- 发布前应使用 release worktree 中的隔离输出完成 build、typecheck、lint、test、workspace 和 patch 校验；不要用预存的未跟踪 `lib/` 文件替代当前源码构建结果。
