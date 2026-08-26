# @cerbur/clutch-dsh-worktree 发布与版本同步

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

## DSH source baseline

本 package 的开发和验证以官方 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)
的当前默认分支源码 checkout 为准，不再把历史 DSH prerelease 作为运行时约束。该仓库当前
默认分支是 `master`，不是 `main`；如果 upstream 后续切换默认分支，应跟随仓库的当前默认分支。
upstream 仍是 developer preview，package 和 API contract 可能变化。

准备 DSH checkout：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git fetch origin
git pull --ff-only origin master
pnpm install
pnpm run build
```

package 的 DSH `peerDependencies` 使用 `*`，让 profile 中的 current upstream runtime 满足
安装约束；`devDependencies` 只用于当前 checkout 的本地 typecheck、build 和 test，不是发布后的
runtime 版本承诺。

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

如果使用的是 DSH 源码 checkout、系统没有独立的 `dsh` 命令，将 `dsh` 替换为 `pnpm dsh`。两种命令使用相同的 DSH plugin loader。

### Git 依赖与 pnpm 构建脚本授权

awesome-dsh-plugin 生成的 `github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree`
是源码 Git 依赖。安装时 pnpm 会执行 package 的 `prepare` 生成 `lib/`，因此这条路径不是
预构建安装。构建脚本授权属于安装方的 `pnpm-workspace.yaml`，不能由插件自身绕过。

当前 DSH profile 使用 pnpm 11 的 `allowBuilds`。首次执行 Git 安装时，pnpm 会故意拒绝
prepare，并在错误信息里打印一个包含 **包名、Git URL、解析后的 commit 和子目录 path** 的
完整 key。把那一整行复制到 profile 的 workspace 配置中，例如：

```yaml
allowBuilds:
  '@cerbur/clutch-dsh-worktree@git+https://github.com/Cerbur/clutch-dsh#<resolved-commit>&path:/packages/clutch-dsh-worktree': true
```

`<resolved-commit>`、Git URL 和 path 必须以 pnpm 错误提示打印的值为准；只写
`'@cerbur/clutch-dsh-worktree': true` 对直接 Git 依赖不够。`onlyBuiltDependencies` 也不是
当前 pnpm 11 Git prepare 使用的配置。保存后重新执行原安装命令；换了 commit 后要为新
commit 增加对应的 key。不要把这段配置写入插件 package，它应由实际信任并安装该 Git
commit 的 profile 维护者决定。

授权通过后，Git prepare 还会在 checkout 的 monorepo 中执行一次 `pnpm install`，再执行
`pnpm run build`。因此 profile 必须能访问其 registry；如果下一步报 registry DNS、镜像
或 lockfile 错误，那已经不是 `allowBuilds` 拒绝，而是依赖安装环境问题。

如果需要重新验证已发布版本，先移除 profile 中的旧 package，再重新添加：

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
```

## 开发与回合并流程

0.1.6 的 worktree 关系从 `main` 向下建立，回合并必须按以下方向进行：

```text
main
  └─ wt-worktree-0.1.6/release
       └─ wt-worktree-0.1.6/<feature-name>

feat worktree → release worktree → main
```

每次回合并前，源 worktree 和目标 worktree 都必须干净。特别是 feature merge 回 release
时，feature worktree 是硬性门禁：必须已经整理成 scoped commit，不能存在 staged、unstaged
或 untracked 改动。使用以下检查；命令没有输出才算通过：

```bash
FEATURE_WORKTREE=/path/to/feature-worktree
RELEASE_WORKTREE=/path/to/release-worktree
FEATURE_BRANCH='wt-worktree-0.1.6/<feature-name>'
RELEASE_BRANCH='wt-worktree-0.1.6/release'

test -z "$(git -C "$FEATURE_WORKTREE" status --porcelain=v1 --untracked-files=all)"
test -z "$(git -C "$RELEASE_WORKTREE" status --porcelain=v1 --untracked-files=all)"

git -C "$FEATURE_WORKTREE" rebase "$RELEASE_BRANCH"
test -z "$(git -C "$FEATURE_WORKTREE" status --porcelain=v1 --untracked-files=all)"
git -C "$RELEASE_WORKTREE" merge --no-ff "$FEATURE_BRANCH" \
  -m "merge: integrate ${FEATURE_BRANCH}"
test -z "$(git -C "$RELEASE_WORKTREE" status --porcelain=v1 --untracked-files=all)"
```

任一 clean 检查有输出都必须停止，先在对应 worktree 整理提交并重新验证；不能用 stash 或
忽略输出代替门禁。发生冲突时在 feature worktree 解决 rebase 冲突并重新运行检查；release
worktree 只合并已经通过门禁的单个 feature scoped commit。release 回合并 `main` 前，同样
要确认 release 和 `main` 两个 worktree 都干净；合并后再运行完整 release verification。

## 发布前提

发布前必须满足：

- 当前分支是待发布的 `main`，工作区没有未提交的业务改动；
- `package.json` 保留 `dsh.bundle.patch`、`publishConfig.access: "public"` 和 `prepare: "pnpm run build"`；
- `packageManager` 保持项目实际使用的 `pnpm@10.32.1`，不要借此升级依赖；
- `npm whoami --registry=https://registry.npmjs.org/` 返回拥有 `@cerbur` scope 的账号；
- npm 账号已完成邮箱验证和发布所需的 2FA；
- 官方 DSH package 继续放在 `peerDependencies`，不要复制成 runtime `dependencies`；
- `lib/` 不提交到 Git，由 `prepare` 从当前源码生成；Git 依赖安装和打包/发布都使用同一条构建生命周期。若要避免 Git prepare 和 `allowBuilds`，应改走已发布的 npm tarball，而不是把构建产物偷偷加入 Git。

## 发布流程

### 1. 递增版本

从 package 目录执行，按变更类型选择 `patch`、`minor` 或 `major`：

```bash
cd /path/to/clutch-dsh/packages/clutch-dsh-worktree
npm version patch --no-git-tag-version
```

发布新功能通常使用 `minor`，兼容性破坏使用 `major`，缺陷修复使用 `patch`。不要手工把版本改回已经存在于 npm 的版本。

### 2. 检查并预览 tarball

```bash
cd /path/to/clutch-dsh
pnpm run check

cd packages/clutch-dsh-worktree
npm pack --dry-run
```

预览结果必须包含 `README.md`、`package.json`、`cordis.patch.yml` 和 `lib/`。`pnpm pack`、`npm pack` 和 `npm publish` 都会执行 `prepare`，因此会从当前源码重新构建；Git 依赖安装也会在获取源码后执行 `prepare`，并受安装方的 `allowBuilds` 授权控制。

### 3. 先推送对应源码

```bash
cd /path/to/clutch-dsh
git status --short
git add -- packages/clutch-dsh-worktree/package.json
git commit -m "chore(worktree): release package"
git push origin main
```

GitHub `main` 上的 package version、README 和代码必须与即将发布的 tarball 一致。

### 4. 发布到官方 npm registry

即使本机默认 registry 是镜像，也要显式指定 npmjs：

```bash
cd /path/to/clutch-dsh/packages/clutch-dsh-worktree
npm publish --access public --registry=https://registry.npmjs.org/
```

### 5. 验证发布结果

```bash
npm view @cerbur/clutch-dsh-worktree name version dist-tags.latest dist.tarball repository \
  --json --registry=https://registry.npmjs.org/

LOCAL_VERSION=$(node -p "require('./package.json').version")
PUBLISHED_VERSION=$(npm view @cerbur/clutch-dsh-worktree version --registry=https://registry.npmjs.org/)
test "$LOCAL_VERSION" = "$PUBLISHED_VERSION"
```

新包在 registry 的 packument 可能比 `npm publish` 的成功响应晚几秒出现；遇到短暂 404 时等待后重试，不要再次发布同一个版本。

### 6. 合并 release 到 `main` 并创建版本 tag

npm 发布结果确认后，先将目标 release worktree 合并回 `main`，并在合并后的 `main` 上完成
最终验证。验证通过后，使用 `package.json` 的 `version` 创建 annotated tag。tag 名称直接
使用版本号，不添加 `v` 前缀；已存在的 tag 不得覆盖。

```bash
cd /path/to/clutch-dsh
VERSION=$(node -p "require('./packages/clutch-dsh-worktree/package.json').version")
RELEASE_BRANCH="wt-worktree-${VERSION}/release"

git status --short
git checkout main
git merge --no-ff "$RELEASE_BRANCH" -m "merge: release worktree ${VERSION}"
pnpm run check

test -z "$(git tag --list "$VERSION")"
git tag -a "$VERSION" -m "release: @cerbur/clutch-dsh-worktree ${VERSION}"
test "$(git rev-parse "$VERSION^{commit}")" = "$(git rev-parse HEAD)"
git show --no-patch --decorate "$VERSION"
```

只有在 release merge、合并后验证和 tag 指向检查都成功后，才按授权将 `main` 与版本 tag
推送到远端：

```bash
git push origin main "$VERSION"
```

## 版本不一致时的处理

| 状态                             | 处理                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| 本地版本 = npm 版本              | 不能再次发布；先 `npm version patch`/`minor`/`major`。                     |
| 本地版本 > npm 版本              | 运行完整校验，推送包含该版本的 `main`，再发布。                            |
| 本地版本 < npm 版本              | 不要降级 `package.json`；从 `main` 同步后递增到下一个未使用版本。          |
| npm `view` 成功但 DSH 仍装旧版本 | 检查 DSH 使用的 registry 和 profile；必要时移除后重新添加。                |
| npm 官方 registry 成功、镜像 404 | 镜像尚未同步；发布和验证使用 `https://registry.npmjs.org/`，等待镜像刷新。 |

## awesome-dsh-plugin 收录

npm 发布负责分发，awesome-dsh-plugin 负责收录和 dsh-market 发现。市场 YAML 不写版本号，也不添加 `npm:` 字段；package 的 `repository` 映射由市场自动读取。市场条目格式与提交流程见 [package README](../README.md) 和 [awesome-dsh-plugin contributing guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。
