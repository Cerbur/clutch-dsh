# clutch-dsh plugin 发布流程

本文档定义 workspace 内所有 DSH plugin package 共用的发布生命周期。每个可发布 package 在
自己的 `docs/RELEASING.md` 中记录包参数、安装来源和该包特有的约束，不重复本文档的通用流程。
发布前应先阅读目标 package 的 `AGENTS.md` 和它自己的 `docs/RELEASING.md`。

## 角色与参数

- 发布对象是 `packages/<plugin>/` 下带 `package.json` 的 DSH plugin package。
- 每个 package 必须使用 `@cerbur/clutch-dsh-<release-name>` 命名。`<release-name>` 即 package
  short name，同时用于分支命名、worktree 命名和 release tag；例如 `clutch-dsh-worktree` 对应
  `worktree`，`clutch-dsh-discuss` 对应 `discuss`。

| 参数                                    | 含义                                        | 示例（worktree）                |
| --------------------------------------- | ------------------------------------------- | ------------------------------- |
| `<npm-package-name>`                    | package 完整名称                            | `@cerbur/clutch-dsh-worktree`   |
| `<release-name>`                        | package short name                          | `worktree`                      |
| `<version>`                             | 该 package 当前的 `package.json.version`    | `0.1.6`                         |
| `wt-<release-name>-<version>/release`   | 聚合目标版本的 release worktree             | `wt-worktree-0.1.6/release`     |
| `wt-<release-name>-<version>/<feature>` | 从 release worktree 创建的 feature worktree | `wt-worktree-0.1.6/feat-readme` |
| `<release-name>-release-<version>`      | 发布后的 annotated tag                      | `worktree-release-0.1.6`        |

`package.json.version` 是每个 package 唯一的版本源：README、市场 YAML、安装命令和本文档都不
重复写具体版本号；npm 已发布的 `name + version` 不能原地覆盖，修复必须先递增版本。

## 分支模型与门禁

worktree 组织和 clean/rebase 门禁以仓库根目录 `AGENTS.md` 为准：feature worktree 只用于编写、
验证和提交 scoped change；feature worktree 不是发布位置，禁止在其中执行 `npm pack` 或
`npm publish`。所有打包预览、手动发布和最终 release verification 都必须在 feature commit
合并后的 release worktree 中执行。

每次回合并都有干净工作区门禁：源 worktree 和目标 worktree 在合并前都必须没有 staged、
unstaged 或 untracked 改动。至少执行：

```bash
FEATURE_WORKTREE=/path/to/feature-worktree
RELEASE_WORKTREE=/path/to/release-worktree

test -z "$(git -C "$FEATURE_WORKTREE" status --porcelain=v1 --untracked-files=all)"
test -z "$(git -C "$RELEASE_WORKTREE" status --porcelain=v1 --untracked-files=all)"
```

任一检查有输出都必须停止，先把改动整理进对应 worktree 的 scoped commit 并重新验证；不能用
stash 或忽略输出代替门禁。本流程只定义顺序和门禁，不自动授权 commit、push、publish 或其他
外部系统变更，这些操作仍须获得明确授权。

## 发布日志

每个可发布 package 都维护一份仓库内的双语 `RELEASE-LOG.md`（中文段落在上、英文段落在下），
记录每个已发布版本面向用户的更新。它是基于 commit history 的发布摘要，不是第二次源码审查；
不要重新阅读实现文件来还原发布说明，也不要把 commit hash 或 subject 写入日志。每件新增、
优化、修复或删除的功能只写一句中文和一句英文。

递增 package version 或创建 feature scoped commit 之前，先根据 release branch 的提交历史更新
候选版本条目：

```bash
git log --reverse --no-merges --format='%h%x09%s' main..wt-<release-name>-<version>/release
```

`RELEASE-LOG.md` 属于仓库内文档，不要求进入 npm package files。

## 安装来源

所有 package 遵循同一套安装来源约定：本地 checkout 安装适合开发与未发布验证，构建 package 后
在 DSH 源码 checkout 中执行 `pnpm dsh plugin --profile web add /absolute/path/to/package`；已
发布版本通过 npm registry 安装（`dsh plugin --profile web add <npm-package-name>`）。npm 官方
registry 与本机镜像可能存在同步延迟；发布和版本验证必须显式指定
`https://registry.npmjs.org/`，遇到短暂 404 时等待重试，不要重复发布同一版本。各 package 的
完整命令见其自身的 `docs/RELEASING.md`。

## 发布生命周期

以下步骤适用于任何 package；命令中的占位符替换为“角色与参数”表格中的实际值。

### 1. 更新 release log 与其他文档

在 feature worktree 中，先更新 `RELEASE-LOG.md`，再同步受公开行为影响的 README、README.zh、
AGENTS、计划等文档。只有文档和 release log 完成后，才能递增 package version 并创建 feature
scoped commit。

### 2. 递增版本

从 feature worktree 的 package 目录执行：

```bash
cd /path/to/feature-worktree/packages/<plugin>
npm version patch|minor|major --no-git-tag-version
```

新功能用 `minor`，兼容性破坏用 `major`，缺陷修复用 `patch`；不要手工改回已经存在于 npm 的
version，也不要手工降级。`--no-git-tag-version` 是硬性要求，版本不出现在 feature commit 之外
的任何 git tag 里。

### 3. 在 feature worktree 检查并提交

运行与改动匹配的检查，然后把全部改动整理为单个 scoped commit：

```bash
cd /path/to/feature-worktree
git status --short
git diff --check
git commit -m "<type>(<scope>): prepare release metadata"
```

commit message 必须说明改动范围；提交后 feature worktree 必须保持干净。

### 4. 按 clean/rebase/merge 门禁合并到 release worktree

确认两个 worktree 干净后，将 feature branch rebase 到最新 release branch，再在 release
worktree 中以 `--no-ff` 合并单个 scoped commit：

```bash
FEATURE_WORKTREE=/path/to/wt-<release-name>-<version>/<feature>
RELEASE_WORKTREE=/path/to/wt-<release-name>-<version>/release
FEATURE_BRANCH="wt-<release-name>-<version>/<feature>"
RELEASE_BRANCH="wt-<release-name>-<version>/release"

test -z "$(git -C "$FEATURE_WORKTREE" status --porcelain=v1 --untracked-files=all)"
test -z "$(git -C "$RELEASE_WORKTREE" status --porcelain=v1 --untracked-files=all)"

git -C "$FEATURE_WORKTREE" rebase "$RELEASE_BRANCH"
test -z "$(git -C "$FEATURE_WORKTREE" status --porcelain=v1 --untracked-files=all)"

git -C "$RELEASE_WORKTREE" merge --no-ff "$FEATURE_BRANCH" \
  -m "merge: integrate ${FEATURE_BRANCH}"
test -z "$(git -C "$RELEASE_WORKTREE" status --porcelain=v1 --untracked-files=all)"
```

发生冲突时在 feature worktree 解决并重新验证，不能跳过 rebase gate。

### 5. 在 release worktree 检查并预览 tarball

```bash
RELEASE_WORKTREE=/path/to/release-worktree
cd "$RELEASE_WORKTREE"
pnpm run check

cd "$RELEASE_WORKTREE/packages/<plugin>"
npm pack --dry-run
```

预览结果必须包含 `README.md`、`package.json`、`cordis.patch.yml` 和生成的 `lib/`；仓库内文档
（例如 `RELEASE-LOG.md`）不要求包含。打包前必须按目标 package 的说明显式完成构建；不能
假设 `npm pack` 会触发只在发布阶段运行的构建脚本。

在用户确认发布前，不要把 release worktree 合并回 `main`。

### 6. 交给用户从 release worktree 手动发布

```bash
cd "$RELEASE_WORKTREE/packages/<plugin>"
npm publish --access public --registry=https://registry.npmjs.org/
```

发布命令必须由用户手动执行，且当前目录必须属于 release worktree；agent 不代替用户执行
`npm publish`。发布完成后由用户通知 agent 继续验证。发布前提（npm 账号、2FA、`prepare` 或
`prepublishOnly`、`publishConfig` 等）以目标 package 的 `docs/RELEASING.md` 为准。

### 7. 验证发布结果

```bash
cd "$RELEASE_WORKTREE/packages/<plugin>"
npm view <npm-package-name> name version dist-tags.latest dist.tarball repository \
  --json --registry=https://registry.npmjs.org/

LOCAL_VERSION=$(node -p "require('./package.json').version")
PUBLISHED_VERSION=$(npm view <npm-package-name> version --registry=https://registry.npmjs.org/)
test "$LOCAL_VERSION" = "$PUBLISHED_VERSION"
```

新发布的 packument 可能比 `npm publish` 的成功响应晚几秒出现；遇到短暂 404 时等待后重试，
不要再次发布同一个版本。

### 8. 合并 release 回 `main` 并创建 release tag

npm 发布结果确认后，先将 release worktree 合并回 `main`，并在合并后的 `main` 上完成最终
验证：

```bash
cd /path/to/clutch-dsh
VERSION=$(node -p "require('./packages/<plugin>/package.json').version")
RELEASE_BRANCH="wt-<release-name>-${VERSION}/release"

git status --short
git checkout main
git merge --no-ff "$RELEASE_BRANCH" -m "merge: release <release-name> ${VERSION}"
pnpm run check
```

验证通过后创建 annotated tag。tag 名称固定为 `<release-name>-release-<version>`：前半部分是
package short name，后半部分是合并进 `main` 后该 package 的 `package.json` 版本；例如
`clutch-dsh-worktree` 发布 `0.1.6` 时的 tag 就是 `worktree-release-0.1.6`。tag 名不添加 `v`
前缀或其他变体；已存在的 tag 不得覆盖。

```bash
PLUGIN_NAME="<release-name>" # clutch-dsh-worktree 对应 worktree
TAG="${PLUGIN_NAME}-release-${VERSION}"

test -z "$(git tag --list "$TAG")"
git tag -a "$TAG" -m "release: <npm-package-name> ${VERSION}"
test "$(git rev-parse "$TAG^{commit}")" = "$(git rev-parse HEAD)"
git show --no-patch --decorate "$TAG"
```

只有在 release merge、合并后验证和 tag 指向检查都成功后，才按明确授权将 `main` 与该 release
tag 推送到远端：

```bash
git push origin main "$TAG"
```

push 之后如有需要，回到目标 package 的 `docs/RELEASING.md` 完成该包特有的收尾验证。

## 版本不一致时的处理

针对单个 `<npm-package-name>` 检查本地与 registry 状态；其他 package 是否有未发布版本与本次
发布无关：

| 状态                             | 处理                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 本地版本 = npm 版本              | 不能再次发布；先按变更类型用 `npm version <type> --no-git-tag-version` 递增，`<type>` 取 patch、minor 或 major。 |
| 本地版本 > npm 版本              | 运行完整校验，推送包含该版本的 `main`，再发布。                                                                  |
| 本地版本 < npm 版本              | 不要降级 `package.json`；从 `main` 同步后递增到下一个未使用版本。                                                |
| npm `view` 成功但 DSH 仍装旧版本 | 检查 DSH 使用的 registry 和 profile；必要时移除后重新添加。                                                      |
| npm 官方 registry 成功、镜像 404 | 镜像尚未同步；等待刷新后再重新安装验证。                                                                         |

## 多 package 同步

- 各 package 独立走上述完整生命周期，独立维护 worktree、release 分支、发布和 tag，不强求
  版本号一致，也不互相等待。
- 如果一次改动同时影响多个 package，root/workspace 级共享代码先用 `base/feat-<feature>`
  分支合并回 `main`；之后每个受影响 package 再各自开 release/feature worktree 发布。
- 新增可发布 package 时，在该 package 目录内新建 `docs/RELEASING.md`，列出包参数表中的五个
  实际值和该包特有约束，并在开头引用本文档；不要复制完整流程。
