# @cerbur/clutch-dsh-worktree 开发与贡献指南

本文档为 `@cerbur/clutch-dsh-worktree` 插件的开发者和贡献者提供完整的开发环境准备、源码构建、测试验证、调试以及发布前检查指引。

关于插件的架构设计与实现原理，请参阅 [ARCHITECTURE.md](ARCHITECTURE.md)。
关于 Agent 维护指令与关键约束，请参阅 [../AGENTS.md](../AGENTS.md)。
关于通用与本包的发布流程，请参阅 [RELEASING.md](RELEASING.md) 及根目录 [../../../docs/RELEASING.md](../../../docs/RELEASING.md)。

---

## 1. 环境前置要求

- **Node.js**: `>=20.0.0`（推荐使用 LTS 版本）
- **pnpm**: 遵循 monorepo 根目录 `packageManager` 指定版本（pnpm 11+）
- **Git**: `>=2.20.0`（需要支持 worktree 核心命令与 branch 发现）

---

## 2. 准备 Upstream DSH 源码 Checkout

本插件的本地开发、调试与全量联调以官方 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness) 的源码 checkout 为准。

> **注意：** Upstream 仓库当前的默认分支为 `master`（而非 `main` 或历史 prerelease 分支）。后续若官方切换默认分支，应跟从最新默认分支。最低兼容版本基线为 `dsh-v0.1.2-rc.1`。

克隆并构建 upstream DSH：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git fetch origin
git checkout master
pnpm install
pnpm run build
```

---

## 3. 本地源码构建与安装

### 3.1 构建插件包

在 `clutch-dsh` monorepo 根目录执行：

```bash
cd /path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build
```

### 3.2 将本地插件添加到 DSH Profile

使用绝对路径将构建出的插件包注册至 DSH 的 web profile 中：

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web --dump-config
```

`--dump-config` 输出应包含插件的 bundle 层。如 profile 中残留有旧的未加 scope 安装，先将其移除：

```bash
pnpm dsh plugin --profile web remove clutch-dsh-worktree
```

启动 DSH Web 服务以验证插件功能：

```bash
pnpm dsh web
```

### 3.3 开发迭代与重载

修改代码后，重新构建插件并重启 DSH：

```bash
cd /path/to/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /path/to/deepseek-harness
pnpm dsh web
```

> **提示：** 修改了 `package.json`、`cordis.patch.yml` 或 profile bundle 成员后，需重新执行一次 `plugin add`。

### 3.4 卸载本地插件

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

---

## 4. GitHub 源码安装与 pnpm 构建授权

当通过 `awesome-dsh-plugin` 插件市场条目安装源码时，安装命令如下：

```bash
dsh plugin --profile web add "github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree"
```

这是源码 Git 依赖而非预构建 npm 包，其 `prepare` 生命周期会运行 `pnpm run build` 生成 `lib/`。

当前 DSH profile 采用 pnpm 11 的 `allowBuilds` 机制：首次执行 Git 安装时，pnpm 会主动拦截构建并输出包含**包名、Git URL、已解析 commit 和子目录 path** 的完整 key。

请将该完整 key 写入 profile 的 `pnpm-workspace.yaml` 中：

```yaml
allowBuilds:
  '@cerbur/clutch-dsh-worktree@git+https://github.com/Cerbur/clutch-dsh#<resolved-commit>&path:/packages/clutch-dsh-worktree': true
```

**注意事项：**
1. 必须使用 pnpm 错误提示输出的精确字符串。仅配置包名对直接 Git 依赖无效。
2. `onlyBuiltDependencies` 不是当前 pnpm 11 Git prepare 所用的配置项。
3. 当仓库有新提交时，解析后的 commit hash 改变，需要对应添加新 key。
4. 授权成功后，Git prepare 会在下载的 monorepo 内执行 `pnpm install` 和 `pnpm run build`，因此构建机器必须能正常连接所配置的 npm registry。

---

## 5. 校验与测试命令

在提交任何改动前，必须在 monorepo 根目录下运行并通过以下全部检查：

```bash
cd /path/to/clutch-dsh

# 1. Workspace 结构与一致性检查
pnpm run check:workspace

# 2. Cordis patch 校验
pnpm run check:patches

# 3. TypeScript 类型检查
pnpm --filter @cerbur/clutch-dsh-worktree typecheck

# 4. 插件包构建
pnpm --filter @cerbur/clutch-dsh-worktree build

# 5. 单元测试与集成测试
pnpm --filter @cerbur/clutch-dsh-worktree test
```

### README 双语结构与格式校验

插件包含自动化测试以保证中英文 README 结构严格对齐：

```bash
cd /path/to/clutch-dsh/packages/clutch-dsh-worktree
node --test test/readme-parity.test.mjs
pnpm exec prettier --check README.md README.zh.md test/readme-parity.test.mjs
```

### Monorepo 全局检查

```bash
cd /path/to/clutch-dsh
pnpm run check
```

---

## 6. 贡献者工作流与门禁

1. **分支与 Worktree 规范**：遵循根目录 `AGENTS.md` 的 release/feature worktree 模型。所有修改必须在 feature worktree 中完成。
2. **提交与门禁**：
   - 合并前必须 rebase 到最新 release 基线；
   - 必须通过 clean worktree 检查（无任何 staged、unstaged、untracked 文件）；
   - 严禁从 feature worktree 执行 `npm publish`。
3. **禁止提交的文件**：
   - `lib/` 构建产物（由 `prepare` 自动生成）
   - `coverage/` 测试覆盖率报告
   - 本地临时 sidecar 数据（如 `$dshHome/clutch-dsh-worktree/`）
   - 个人本地凭据与环境文件
4. **文档同步要求**：
   - 公开行为或参数变动时，必须同步更新 `README.md` 与 `README.zh.md`；
   - 架构或生命周期变动时，必须同步更新 `docs/ARCHITECTURE.md` 与 `AGENTS.md`；
   - 发布前必须在 `RELEASE-LOG.md` 中追加中英文更新摘要。

---

## 7. 插件市场（awesome-dsh-plugin）元数据规范

向 `awesome-dsh-plugin` 提交插件时，分类使用 `git`，并保持与包定义一致：

```yaml
category: git
description:
  en: Adds a Worktree view to DSH Web UI that groups Sessions by Git worktree while keeping DSH as the source of truth.
  zh: 为 DSH Web UI 增加按 Git Worktree 组织 Session 的视角，同时继续由 DSH 管理原始 Project/Workspace 和 Session 数据。
```

外部准入指标（如 GitHub 仓库 topic `dsh-plugin`、仓库注册时间、commit 数量等）由市场维护规范决定。
