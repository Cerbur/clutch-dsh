# DeepSeek Harness Desktop 一键打包器 (Desktop Packager)

本工具用于将 `deepseek-harness` 桌面客户端打包为 macOS 原生应用（Apple Silicon / `mac-arm64`），并自动安装到 `/Applications/DeepSeek Harness.app`。

生成的应用程序具备完整的：

- **内置 Node.js 24 独立运行时与 pnpm**（与系统环境隔离）
- **离线包仓库（Seed Store）**
- **内置桌面插件管理功能**（打开应用后按 `⌘,` 即可安装/管理插件）
- **本地 Ad-hoc 代码签名**（直接启动，绕过复杂的官方公证书与公证服务依赖）

---

## 必要环境要求

- **操作系统**：macOS (Apple Silicon, arm64)
- **Node.js**：`^22.19 || >=24`
- **包管理器**：`pnpm` (`>=9`)
- **编译工具**：macOS 命令行工具（自带 `codesign`、`ditto`、`git`、`curl`）

---

## 人类使用方式 (Human Guide)

### 方式 A：指定本地现有的 deepseek-harness 仓库（推荐）

如果你本地已经克隆并拉取了 `deepseek-harness` 源码（例如位于当前电脑）：

```bash
# 直接作为第一个参数传入本地仓库路径：
./scripts/desktop-packager/package-desktop.sh /path/to/deepseek-harness

# 或者通过环境变量传入：
DSH_REPO_ROOT=/path/to/deepseek-harness ./scripts/desktop-packager/package-desktop.sh
```

### 方式 B：无本地源码，自动从 GitHub 克隆打包

如果不传任何参数，脚本会自动通过 `git clone --depth 1` 将最新的官方仓库拉取至 `/tmp` 临时目录并在打包完成后自动清理：

```bash
./scripts/desktop-packager/package-desktop.sh
```

### 打包完成后：

1. 从访达（Finder）的「应用程序」或使用聚焦搜索（Spotlight）启动 **DeepSeek Harness**。
2. 进入应用后，点击菜单栏 **Application → 桌面插件…** 或直接按快捷键 **`⌘,`**，即可使用完整的插件管理器。

---

## Agent 使用方式 (Agent Guide)

如果是 AI Agent 协助用户打包或在 CI/自动化流水线中执行，建议按以下约定运行：

```bash
# 1. 优先探测用户工作区是否存在已有的 deepseek-harness 源码：
#    若存在则直接传入路径以避免重复下载大型依赖池。
./scripts/desktop-packager/package-desktop.sh "$WORKSPACE_DSH_PATH"

# 2. 若独立环境无源码，可配置代理或自定义源（若有需求）：
#    DSH_GIT_URL="https://github.com/deepseek-ai/deepseek-harness.git" \
#    ./scripts/desktop-packager/package-desktop.sh

# 3. 验证是否安装成功：
codesign --verify --deep --strict "/Applications/DeepSeek Harness.app"
```
