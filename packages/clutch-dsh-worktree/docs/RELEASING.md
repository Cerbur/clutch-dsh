# @cerbur/clutch-dsh-worktree 发布与安装

本 package 是 DSH 的 worktree 管理 plugin。通用发布生命周期——release log 规则、worktree
门禁、npm 发布步骤、`<release-name>-release-<version>` tag 命名等——统一记录在仓库根目录的
[`docs/RELEASING.md`](../../docs/RELEASING.md)；本文档只保留本包的包参数、版本约束和安装来源，
不复制通用流程。

## 包参数

| 参数 | 值 |
| ---- | ---- |
| `<npm-package-name>` | `@cerbur/clutch-dsh-worktree` |
| `<plugin>`（workspace 目录名） | `clutch-dsh-worktree` |
| `<release-name>` | `worktree` |
| release branch / worktree 前缀 | `wt-worktree-<version>` |
| release tag | `worktree-release-<version>` |

## 版本规则

`packages/clutch-dsh-worktree/package.json` 的 `version` 是唯一版本源：

- 本地 checkout、GitHub `main` 和 npm 发布都必须来自同一个 package version；
- README、市场 YAML 和安装命令不重复写当前版本号；
- npm 已发布的 `name + version` 不能原地覆盖，发布修复必须先递增版本；
- `latest` dist-tag 是用户不指定版本时的安装版本。

检查本地版本和 npm 版本：

```bash
cd /path/to/clutch-dsh
node -p "require('./packages/clutch-dsh-worktree/package.json').version"
npm view @cerbur/clutch-dsh-worktree version --registry=https://registry.npmjs.org/
```

两条命令输出相同，才表示当前 checkout 与 npm release 对齐。

## 发布日志

Release log 的内容规则和更新时机见根目录 [`docs/RELEASING.md`](../../docs/RELEASING.md)。本包的
`RELEASE-LOG.md` 位于 package 目录下，属于仓库内文档，不要求进入 npm package files。

## DSH source baseline

本 package 的开发和验证以官方 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)
的当前默认分支源码 checkout 为准，不再把历史 DSH prerelease 作为运行时约束。该仓库当前默认分支是
`master`，不是 `main`；如果 upstream 后续切换默认分支，应跟随仓库的当前默认分支。upstream 仍是
developer preview，package 和 API contract 可能变化。

准备 DSH checkout：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git fetch origin
git pull --ff-only origin master
pnpm install
pnpm run build
```

package 的 DSH `peerDependencies` 使用不低于 compatibility floor 的范围，让 profile 中满足
公开 contract 的 current upstream runtime 满足安装
约束；`devDependencies` 只用于当前 checkout 的本地 typecheck、build 和 test，不是发布后的
runtime 版本承诺。

本 package 的最低 DSH 兼容 graph 为 `dsh-v0.1.2-rc.1`：

| 项目 | 约束 |
| ---- | ---- |
| DSH compatibility floor | `dsh-v0.1.2-rc.1` |
| package DSH peer range | 所有 `@deepseek-ai/dsh-*` peer 使用 `>=0.1.2-rc.1` |
| local validation graph | 所有对应 `@deepseek-ai/dsh-*` dev dependency 固定 `0.1.2-rc.1` |
| unsupported graph | `dsh-v0.1.1-rc.2` 及更早版本；其中已删除的 Client runtime 和可写 Workspace list 不再兼容 |
| forward compatibility | 更高版本只有在保持 Controller、Store、WorkspaceSource、Connection 和 Slot contract 时才可候选，必须重新验证 |

## 安装来源

### 本地 checkout

适合开发和验证未发布的源码。先构建 package，然后在 DSH 源码仓库根目录执行：

```bash
cd /path/to/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web
```

### npm registry

适合用户安装已发布版本：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

如果使用的是 DSH 源码 checkout、系统没有独立的 `dsh` 命令，将 `dsh` 替换为 `pnpm dsh`。两种命令
使用相同的 DSH plugin loader。

### Git 依赖与 pnpm 构建脚本授权

awesome-dsh-plugin 生成的 `github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree` 是源码 Git
依赖。安装时 pnpm 会执行 package 的 `prepare` 生成 `lib/`，因此这条路径不是预构建安装。构建脚本
授权属于安装方的 `pnpm-workspace.yaml`，不能由插件自身绕过。

当前 DSH profile 使用 pnpm 11 的 `allowBuilds`。首次执行 Git 安装时，pnpm 会故意拒绝 prepare，
并在错误信息里打印一个包含**包名、Git URL、解析后的 commit 和子目录 path**的完整 key。把那一整行
复制到 profile 的 workspace 配置中，例如：

```yaml
allowBuilds:
  '@cerbur/clutch-dsh-worktree@git+https://github.com/Cerbur/clutch-dsh#<resolved-commit>&path:/packages/clutch-dsh-worktree': true
```

`<resolved-commit>`、Git URL 和 path 必须以 pnpm 错误提示打印的值为准；只写
`'@cerbur/clutch-dsh-worktree': true` 对直接 Git 依赖不够。`onlyBuiltDependencies` 也不是当前
pnpm 11 Git prepare 使用的配置。保存后重新执行原安装命令；换了 commit 后要为新 commit 增加对应
的 key。不要把这段配置写入插件 package，它应由实际信任并安装该 Git commit 的 profile 维护者决定。

授权通过后，Git prepare 还会在 checkout 的 monorepo 中执行一次 `pnpm install`，再执行
`pnpm run build`。因此 profile 必须能访问其 registry；如果下一步报 registry DNS、镜像或 lockfile
错误，那已经不是 `allowBuilds` 拒绝，而是依赖安装环境问题。

如果需要重新验证已发布版本，先移除 profile 中的旧 package，再重新添加：

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
```

## 本包发布前提补充

在根目录通用流程的发布前提之外，本包额外要求：

- `npm whoami --registry=https://registry.npmjs.org/` 返回拥有 `@cerbur` scope 的账号，且该账号
  已完成邮箱验证和发布所需的 2FA；
- `package.json` 保留 `dsh.bundle.patch`、`publishConfig.access: "public"` 和
  `prepare: "pnpm run build"`；`packageManager` 保持项目实际使用的 pnpm 版本，不要借此升级依赖；
- 官方 DSH package 继续放在 `peerDependencies`，不要复制成 runtime `dependencies`；
- 发布前确认 DSH compatibility floor 仍为 `dsh-v0.1.2-rc.1`，并运行 package manifest、Client
  composition 和 read-only `WorkspaceSource` 回归测试；不要恢复 legacy monolithic Client runtime 或
  `WorkspaceSource.set()` 兼容分支；
- `lib/` 不提交到 Git，由 `prepare` 从当前源码生成；Git 依赖安装和打包/发布都使用同一条构建
  生命周期。若要避免 Git prepare 和 `allowBuilds`，应改走已发布的 npm tarball，而不是把构建产物
  偷偷加入 Git。

version 不一致时的处理按根目录 [`docs/RELEASING.md`](../../docs/RELEASING.md) 的表格执行，检查对象是
`@cerbur/clutch-dsh-worktree`。
