# Desktop 本地打包器

在 Apple Silicon Mac 上从 deepseek-harness 源码生成独立的 `DeepSeek Harness.app`。应用内置 Node、pnpm、离线 seed 和桌面插件管理器；不需要系统 Node 才能启动。脚本在生成的 `Contents/Resources/app/lib/main.js` 顶层菜单中补入 Electron `editMenu`，恢复 `⌘C/V/X/A/Z`，随后执行本地 Ad-hoc 签名。

## 必要环境

- macOS arm64，以及 Xcode Command Line Tools（`git`、`codesign`、`ditto`、`plutil`、Clang 和 make）。
- Python 3，供离线 seed 验证时的 node-gyp 原生模块编译使用；首次可能下载 Node 头文件。
- 满足所选 deepseek-harness 仓库 `engines.node` 的 Node.js；当前要求 `^22.19 || >=24`。
- 使用所选仓库 `packageManager` 指定的 pnpm 版本，当前为 `11.7.0`。
- 网络可访问 GitHub、Node.js 下载站和 npm registry；首次构建会下载运行时与依赖，需要数 GB 磁盘空间。
- 对安装目录有写权限；默认 `/Applications`，可用 `DSH_INSTALL_DIR` 指定其他父目录。执行前退出旧 App。

这是本地自用包，不包含 Developer ID 签名、公证或正式自动更新资格。Ad-hoc 签名不保证其他电脑的 Gatekeeper 接受它。脚本不修改 deepseek-harness 已跟踪源码：本地 seed 使用临时编译副本，保留离线安装与完整性验证，仅略去发布证书签名；菜单补丁只写入新 App。上游菜单或 seed 签名结构变化时明确报错，不静默跳过。

## 人类使用

### 从 GitHub 一键安装

无需 clone clutch-dsh 或 deepseek-harness。在准备好上述环境并退出旧 App 后运行：

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/desktop-packager/install.sh | bash
```

入口下载 clutch-dsh 的 GitHub 压缩包取得配套脚本，再下载 deepseek-harness 源码压缩包进行本机构建，不创建 Git 工作区。两份临时源码退出时自动清理。这仍是源码构建，需要上述 Node、pnpm、Python 和编译工具，并非预编译 App 下载。

可指定安装位置和源码版本。环境变量放在管道右侧的 `bash` 前：

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/desktop-packager/install.sh \
  | DSH_INSTALL_DIR="$HOME/Applications" DSH_SOURCE_REF=master bash
```

`DSH_PACKAGER_REF` 选择 clutch-dsh 的分支、tag 或 commit，默认 `main`；锁定版本时，把入口 URL 中的 `main` 和该变量都设成同一个 commit SHA。需要准确捕获入口下载失败和安装退出码时，使用下面的 Agent 方式。GitHub 命令要求相应版本的脚本已推送到远端。

### 本地脚本入口

在 clutch-dsh 根目录运行，传入已有源码目录（绝对或相对路径均可）：

```bash
./scripts/desktop-packager/package-desktop.sh /path/to/deepseek-harness
```

也可用 `DSH_REPO_ROOT` 传入；命令行路径优先。没有路径时，脚本下载 GitHub 官方源码压缩包到 `/tmp`，执行 frozen-lockfile 安装和构建，退出时清理自己的临时源码：

```bash
./scripts/desktop-packager/package-desktop.sh
```

`DSH_SOURCE_REF` 选择 dsh 源码分支、tag 或 commit，默认 `master`，仅在未传本地路径时使用，替代旧的 `DSH_GIT_URL`。`DSH_DESKTOP_APP_ID` 默认 `com.clutch.dsh`。脚本在全新目录组装完整依赖、runtime 和 seed，菜单补丁成功后才签名并安装。已有 App 保存为 `DeepSeek Harness.app.previous`；若该备份已存在则停止安装，先自行移走备份再重试。失败时不会用半成品覆盖已安装 App。

完成后从安装目录双击 App，按 `⌘,` 打开「桌面插件」，在 npm 包输入框试用复制、粘贴、剪切、全选和撤销。实际模型对话仍需配置可用模型及凭据。

## Agent 使用

没有本地项目时，先将入口下载到临时文件，再执行，以便分别判断下载与构建失败。可在执行前检查下载内容；用 commit SHA 固定入口与辅助脚本版本：

```bash
(
  set -euo pipefail
  installer_dir="$(mktemp -d /tmp/dsh-install-entry-XXXXXX)"
  trap 'rm -rf -- "$installer_dir"' EXIT
  curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/desktop-packager/install.sh \
    -o "$installer_dir/install.sh"
  bash "$installer_dir/install.sh"
)
```

需要复用本地 dsh 源码时，可给 `bash "$installer_dir/install.sh"` 追加源码路径。入口会透传该参数及 `DSH_INSTALL_DIR` 等环境变量，构建子进程不读取管道 stdin。

先确认宿主架构、Node/pnpm 版本、源码位置和旧 App 已退出。优先传入已有仓库；保留其未提交改动，不为打包重置源码。首次构建和 npm 下载可能耗时较长，保留日志并等待命令退出；非零退出不能报告打包成功。若宿主沙箱阻止网络、进程或安装目录写入，按工具审批流程申请对应权限。

验证时可使用临时安装目录，避免覆盖用户 App：

```bash
DSH_INSTALL_DIR=/tmp/dsh-desktop-qa ./scripts/desktop-packager/package-desktop.sh /path/to/deepseek-harness
DSH_REPO_ROOT=/path/to/deepseek-harness node --test scripts/desktop-packager/patch-edit-menu.test.mjs
codesign --verify --deep --strict '/tmp/dsh-desktop-qa/DeepSeek Harness.app'
```

测试包含真实编译产物、补丁幂等性、嵌套菜单与不支持结构拒绝。签名检查不能替代 UI 验证：启动最终 App，确认主界面、`⌘,` 插件窗口和输入框快捷键，回报实际执行的检查。

`node --test scripts/desktop-packager/install.test.mjs` 用本地压缩包与命令替身验证管道入口、源码压缩包、本地路径、失败退出码和临时目录清理，不执行真实构建或安装。

仅在已完成同版本 runtime、package-set、seed 和 shell 构建时，可单独重复组装验证（完整重建仍使用上面的 shell 入口）：

```bash
DSH_INSTALL_DIR=/tmp/dsh-desktop-qa node scripts/desktop-packager/local-app.mjs assemble /path/to/deepseek-harness
```
