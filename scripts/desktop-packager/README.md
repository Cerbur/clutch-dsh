# Desktop 本地打包器

在 Apple Silicon Mac 上从 deepseek-harness 源码生成独立的 `DeepSeek Harness.app`。应用内置 Node、pnpm、离线 seed 和桌面插件管理器；不需要系统 Node 才能启动。脚本在生成的 `Contents/Resources/app/lib/main.js` 顶层菜单中补入 Electron `editMenu`，恢复 `⌘C/V/X/A/Z`，随后执行本地 Ad-hoc 签名。

**供自己和朋友自用，不作为持续迭代功能，不承诺长期维护或兼容未来 DSH 版本。**
插件管理器是纯 Electron 外层实现，代码、页面和测试全部位于本目录；不创建
`packages/clutch-dsh-extension`，不修改其他 packages 或 DSH 已跟踪源码。
English notes: [README.en.md](README.en.md)。

## 必要环境

- macOS arm64，以及 Xcode Command Line Tools（`git`、`codesign`、`ditto`、`plutil`、Clang 和 make）。
- Python 3，供离线 seed 验证时的 node-gyp 原生模块编译使用；首次可能下载 Node 头文件。
- 满足所选 deepseek-harness 仓库 `engines.node` 的 Node.js；当前要求 `^22.19 || >=24`。
- 使用所选仓库 `packageManager` 指定的 pnpm 版本，当前为 `11.7.0`。
- 网络可访问 GitHub、Node.js 下载站和 npm registry；首次构建会下载运行时与依赖，需要数 GB 磁盘空间。
- 对安装目录有写权限；默认 `/Applications`，可用 `DSH_INSTALL_DIR` 指定其他父目录。执行前退出旧 App。

这是本地自用包，不包含 Developer ID 签名、公证或正式自动更新资格。Ad-hoc 签名不保证其他电脑的 Gatekeeper 接受它。脚本不修改 deepseek-harness 已跟踪源码：本地 seed 使用临时编译副本，保留离线安装与完整性验证，仅略去发布证书签名；菜单补丁只写入新 App。上游菜单或 seed 签名结构变化时明确报错，不静默跳过。

插件管理增强同样使用临时副本：`extension-overlay.mjs` 校验并修改 Desktop
`main.ts` 和 `project-manager.ts` 的副本，重新编译到新 App，再装入本目录的
`renderer/` 页面。增强会随每次打包默认加入；上游关键结构不匹配时停止构建，
不静默降级。桥接仅暴露给 Electron 自有的顶层 `dsh-app://shell` 管理窗口，
主 Web 页面和远程网页不能调用。

## 人类使用

### 从 GitHub 一键安装

无需 clone clutch-dsh 或 deepseek-harness。在准备好上述环境并退出旧 App 后运行：

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/desktop-packager/install.sh | bash
```

入口浅克隆 clutch-dsh 取得配套脚本，再浅克隆 deepseek-harness 进行本机构建。分支和 tag 使用 `git clone --depth 1 --single-branch`；完整 40 位 commit SHA 使用 `git fetch --depth 1` 后 detached checkout。两份临时源码退出时自动清理。这仍是源码构建，需要上述环境，并非预编译 App 下载。

不再请求 GitHub API 或下载源码压缩包。构建的 `DSH_CLIENT_COMMIT_HASH` 直接取自实际 checkout 的 HEAD，不继承其他工作区的提交号。浅克隆减少历史数据与下载步骤，实际耗时仍取决于网络和本机编译速度。

输出按五个阶段组织：获取源码 → 安装依赖 → 编译打包 → 准备运行时和离线 seed → 签名安装。每个阶段保留工具日志，失败即停止；缺少工具时直接显示工具名称。

依赖安装后会显式执行已锁定版本的 Electron 官方安装脚本，确保全新目录也有 `Electron.app`；该步骤忽略 `ELECTRON_SKIP_BINARY_DOWNLOAD`，保留 Electron 官方下载器的缓存及镜像配置，缺少产物时明确失败。

可指定安装位置和源码版本。环境变量放在管道右侧的 `bash` 前：

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/desktop-packager/install.sh \
  | DSH_INSTALL_DIR="$HOME/Applications" DSH_SOURCE_REF=master bash
```

`DSH_PACKAGER_REF` 选择 clutch-dsh 的分支、tag 或完整 40 位 commit SHA，默认 `main`；锁定版本时，把入口 URL 中的 `main` 和该变量都设成同一个 commit SHA。需要准确捕获入口下载失败和安装退出码时，使用下面的 Agent 方式。GitHub 命令要求相应版本的脚本已推送到远端。

### 本地脚本入口

在 clutch-dsh 根目录运行，传入已有源码目录（绝对或相对路径均可）：

```bash
./scripts/desktop-packager/package-desktop.sh /path/to/deepseek-harness
```

也可用 `DSH_REPO_ROOT` 传入；命令行路径优先。没有路径时，脚本浅克隆 GitHub 官方源码到 `/tmp`，执行 frozen-lockfile 安装和构建，退出时清理自己的临时源码：

```bash
./scripts/desktop-packager/package-desktop.sh
```

`DSH_SOURCE_REF` 选择 dsh 源码分支、tag 或完整 40 位 commit SHA，默认 `master`，仅在未传本地路径时使用。`DSH_DESKTOP_APP_ID` 默认 `com.clutch.dsh`。脚本在全新目录组装完整依赖、runtime 和 seed，菜单补丁成功后才签名并安装。已有 App 保存为 `DeepSeek Harness.app.previous`；若该备份已存在则停止安装，先自行移走备份再重试。失败时不会用半成品覆盖已安装 App。

完成后从安装目录双击 App，按 `⌘,` 打开「桌面插件」，在 npm 包输入框试用复制、粘贴、剪切、全选和撤销。实际模型对话仍需配置可用模型及凭据。

### Electron 插件管理

从 Desktop 菜单或 `⌘,` 打开独立的「桌面插件」窗口。它不占用 Web 的
「设置 → 插件」标签页，也不是一个需要另行安装的 DSH plugin。

![桌面插件管理窗口（预览数据）](assets/plugin-manager.png)

- **安装 npm 包**：输入 `@scope/plugin`、`@scope/plugin@1.2.3` 或 tag 后安装。
  再次安装同名包会更新该插件；也可用同一入口将 npm 来源切换为本地来源。
- **安装本地包**：选择已构建的包目录或 `.tgz`，也可输入绝对路径（支持空格）
  或 `file:/absolute/path/plugin.tgz`。选取路径只填入输入框，点击「安装」才执行。
  必须提供有效的 `package.json`、`dsh.bundle.patch` 和已构建导出文件。
  目录通过内置 pnpm 打包，跳过打包生命周期脚本；先自行完成构建。
- **删除**：列表只显示额外插件；点击删除并确认后卸载。核心包不显示，
  后端也拒绝通过安装、更新、删除覆盖核心包。
- **重启 runtime**：Electron 主进程停止并重建 Host，再刷新主界面。
  不调用应用重启，不关闭 Electron shell。安装和删除成功后也会执行原生 runtime
  切换；请先等待正在执行的对话结束，重启不会保证保留进行中的生成。

本地包按内容 SHA-256 保存到 `$DSH_HOME/desktop/local-packages/`，默认在
`~/.dsh/desktop/local-packages/`。安装为快照，移动或删除原目录不影响已安装版本；
修改源码后需构建并再次安装。本地包的运行时依赖不得使用 `workspace:`、
`file:` 或 `link:`，需要先发布或打包进插件。压缩包不支持符号链接、硬链接和
特殊文件；压缩大小上限 128 MiB，展开大小上限 512 MiB、最多 50,000 个条目。
依赖安装仍遵循 Desktop 的构建脚本许可策略；需要额外安装脚本的依赖可能被拒绝。

安装状态的真源仍是 Desktop profile 的 `package.json` 中的依赖与
`dsh.profile.bundles`，不是浏览器存储。快照路径会随安装和 DSH 版本升级保留，
不会被改写成 registry 版本号。卸载不会自动清除快照，原生回滚 profile 可能仍引用它。
安装 npm 包及其尚未缓存的依赖需要网络；本地包不代表其依赖一定可离线安装。

增强保留原生锁、暂存 profile、健康检查和激活回滚；卸载清单从当前活动 profile 读取，
避免读取尚无依赖的暂存目录，也不会为卸载先重装全部插件。即使目标插件的本地快照
丢失，仍可卸载它。快照通过同目录的临时文件原子替换，再次安装会校验并修复损坏的快照。
管理操作和手动重启串行执行。
失败会展示错误并允许重试；运行时已经进入健康检查阶段时，主界面可能短暂断开。
原生更新安装不在这个实验功能的协调范围内，避免同时运行应用更新和插件管理。

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

`node --test scripts/desktop-packager/install.test.mjs` 用命令替身验证管道入口、浅克隆、固定 commit、本地路径、失败退出码和临时目录清理，不执行真实构建或安装。

`node --test scripts/desktop-packager/local-app.test.mjs` 验证 Electron 下载未被跳过、安装失败传播和安装后缺少二进制时的报错。完整构建验证应不传本地源码路径，并用 `DSH_INSTALL_DIR` 指向临时目录。

全部打包器测试：

```bash
DSH_REPO_ROOT=/path/to/deepseek-harness node --test scripts/desktop-packager/*.test.mjs
```

`extension.test.mjs` 使用所选 DSH checkout 的 TypeScript、tsdown、tar 和 pnpm；
需先安装该 checkout 的依赖并构建 Desktop。测试在临时目录用真实 pnpm 验证
本地安装、卸载、健康检查失败、激活失败回滚及跨版本升级，不访问用户 profile。
另有 overlay 编译、IPC 来源限制和并发测试。

`node scripts/desktop-packager/preview.mjs` 在
[本地预览](http://127.0.0.1:43188) 展示实际管理页面，用内存数据模拟桥接；
加 `?lang=en` 查看英文，输入 `fail` 模拟安装失败。这不是 Electron 集成验证。
设计记录见 [PLAN.md](PLAN.md)。

可选的真实 Electron 集成验证：

```bash
DSH_REPO_ROOT=/path/to/deepseek-harness node scripts/desktop-packager/electron-smoke.mjs
```

需已准备好 DSH 的 mac-arm64 runtime、seed 和 Desktop 构建产物。测试使用临时
`DSH_HOME` 和 Electron userData，启动真实 Host，经实际 preload/IPC 验证插件
安装、卸载、重启后的进程和窗口状态；不访问用户 profile。默认清理测试数据，
`CLUTCH_KEEP_SMOKE=1` 可保留用于排查。这仍不替代最终签名 App 的安装验证。

仅在已完成同版本 runtime、package-set、seed 和 shell 构建时，可单独重复组装验证（完整重建仍使用上面的 shell 入口）：

```bash
DSH_INSTALL_DIR=/tmp/dsh-desktop-qa node scripts/desktop-packager/local-app.mjs assemble /path/to/deepseek-harness
```
