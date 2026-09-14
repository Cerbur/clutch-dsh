# DeepSeek Harness Web 管理工具 (`dwm`)

`dwm` 是专门用于管理、构建、运行和扩展 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web 服务的 CLI 工具。

它提供了后台守护进程运行、参数记忆与持久化、一键更新构建、以及安装/卸载插件后自动平滑重启 Web 服务的能力。

---

## 核心能力

1. **管理 DSH 仓库目录 (`dwm home`)**: 配置并持久化保存本地 DeepSeek Harness 源码仓库地址。
2. **构建与更新 (`dwm update`)**: 依据 DSH 官方规范在 home 目录下通过 pnpm 构建 DSH（`pnpm install` + `pnpm run build`）。
3. **Web 服务守护与进程生命周期 (`dwm start` / `dwm down` / `dwm restart`)**:
   - `dwm start [参数...]`: 在后台启动 DSH Web 服务（等价于在 DSH home 下执行 `pnpm dsh web`），支持无脑透传启动参数。
   - `dwm down`: 优雅退出并关闭正在运行的 DSH Web 服务。
   - `dwm restart [参数...]`: 使用当时 start 的参数重启 DSH Web 服务。
4. **插件生态管理 (`dwm plugin install` / `dwm plugin remove` / `dwm plugin list`)**:
   - 支持通过 npm 包名或本地路径安装插件到 `web` profile（对应 `pnpm dsh plugin --profile web add <param>`）。
   - 安装或移除插件完成后，若 Web 服务处于启动状态则自动用先前参数重启。
5. **状态监测与日志查看 (`dwm status` / `dwm logs`)**:
   - 查看 DSH 目录有效性、当前运行 PID、运行时间、启动参数，以及查看与追踪实时日志。
6. **版本查看与切换 (`dwm version` / `dwm versions` / `dwm switch <version>`)**:
   - `dwm version`: 查看 dwm 本身版本与当前 DSH 仓库检出版本（亦支持简洁形式 `dwm -v`）。
   - `dwm versions`: 在 DSH home 下 fetch 远程最新 tags 并展示所有可用版本列表（别名：`dwm version list`）。
   - `dwm switch <version>`: 在 DSH home 下切换到指定版本/tag，清理过时依赖（执行 `pnpm install`）并重新构建包（`pnpm run build`）。
7. **一键自我升级 (`dwm upgrade`)**:
   - 通过 GitHub 执行最新的 upgrade 脚本升级当前的 `dwm` 版本。

---

## 安装与快速上手

### 方式一：通过 GitHub curl 一键安装（推荐）

在终端中执行以下命令即可全自动安装并配置：

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/install.sh | bash
```

也可以在安装时直接指定本地 DeepSeek Harness 仓库目录：

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/install.sh | bash -s -- /path/to/deepseek-harness
```

### 方式二：本地全局链接

在当前仓库检出目录下：

```bash
cd scripts/dsh-web-manager
npm link
# 或 pnpm link --global
```

### 方式三：直接执行脚本

```bash
./scripts/dsh-web-manager/bin/dwm.mjs <command>
# 或
node scripts/dsh-web-manager/bin/dwm.mjs <command>
```

---

## 详细使用指南

### 1. 设置 DSH 本地地址

设置本地 DeepSeek Harness 仓库目录：

```bash
dwm home /path/to/deepseek-harness
```

查看当前配置的 DSH 本地地址：

```bash
dwm home
# 或显式使用展示指令：
dwm home show
```

### 2. 构建与更新 DSH

在配置的 DSH 目录下执行依赖安装与完整构建：

```bash
dwm update
```

若需跳过依赖安装仅执行构建，可传 `--skip-install`：

```bash
dwm update --skip-install
```

### 3. 查看版本信息与 DSH 版本列表

查看当前 dwm 自身版本与 DSH 仓库检出版本：

```bash
dwm version
# 仅输出 dwm 自身版本（适合脚本）：
dwm -v
```

fetch 远程最新 tags 并展示配置的 DSH 仓库中所有可用的 tag 版本：

```bash
dwm versions
# 或使用别名：
dwm version list
dwm version ls
```

### 4. 切换 DSH 版本并构建

将 DSH 仓库切换至指定的 tag/版本并重新构建（自动执行 `git checkout`，清理过时依赖 `pnpm install` 以及 `pnpm run build`）：

```bash
# 使用完整 tag 名称
dwm switch dsh-v0.1.5-rc.2

# 使用版本号
dwm switch 0.1.5-rc.2
dwm switch v0.1.5-rc.2

# 亦支持通过 version 子命令别名切换
dwm version switch dsh-v0.1.5-rc.2
```

如有需要，也可追加 `--skip-install` 或 `--skip-build`：

```bash
dwm switch 0.1.5-rc.2 --skip-install
```

### 5. 启动 DSH Web 服务

在后台启动 DSH Web，后续所有参数都会原样透传给 `pnpm dsh web`：

```bash
# 默认启动
dwm start

# 透传指定端口或选项
dwm start --port 3080 --no-open
```

若需要在前台终端保持交互运行，可添加 `-f` 或 `--foreground`：

```bash
dwm start -f
```

### 6. 停止 DSH Web 服务

优雅停止后台运行的 DSH Web 进程：

```bash
dwm down
# 或
dwm stop
```

### 7. 重启 DSH Web 服务

使用上一次 `dwm start` 时传入的参数重启服务：

```bash
dwm restart
```

如果希望在重启时更换参数，也可直接追加新参数：

```bash
dwm restart --port 3090
```

### 8. 安装插件

支持输入 npm 包名或本地绝对/相对路径。安装完成后，如果 Web 服务处于运行状态，会自动平滑重启：

```bash
# 本地绝对路径安装
dwm plugin install /path/to/my-plugin

# 本地相对路径安装
dwm plugin install ./packages/clutch-dsh-worktree

# npm 包名安装
dwm plugin install dshmarket
```

### 9. 移除插件

输入插件名称移除插件。移除完成后，如果 Web 服务处于运行状态，会自动重启：

```bash
dwm plugin remove @cerbur/clutch-dsh-worktree
```

### 10. 查看已安装插件

查看当前 web profile 下安装的所有插件：

```bash
dwm plugin list
```

### 11. 查看运行状态

查看 DSH 仓库目录状态、Web 运行状态、进程 PID、运行时长与最近日志：

```bash
dwm status
```

### 12. 查看日志

```bash
# 查看最近 30 行日志
dwm logs

# 查看最近 100 行并持续跟踪实时日志
dwm logs -n 100 -f
```

### 13. 升级 dwm

从 GitHub 获取并执行最新的升级脚本，升级当前的 `dwm` 版本：

```bash
dwm upgrade

# 升级到指定的 branch、tag 或 commit：
dwm upgrade --ref main
```

### 14. 指令帮助与使用说明

查看全局帮助或特定指令的详细参数与用法：

```bash
# 查看全局帮助
dwm help
# 或
dwm --help

# 查看特定指令的详细使用说明与示例
dwm help start
dwm home --help
dwm logs --help
dwm plugin --help
```

### 15. 卸载 dwm

停止运行中的 Web 服务、解除全局二进制软链接（npm / pnpm），并清理状态文件：

```bash
# 常规卸载（保留 ~/.dwm/config.json 配置文件）
dwm uninstall
# 或
dwm unlink

# 彻底清理（同时删除 ~/.dwm 目录、配置文件及日志）
dwm uninstall --purge
```

---

## 配置文件与运行状态

- 配置文件：`~/.dwm/config.json`
- 运行时状态：`~/.dwm/state.json`
- PID 记录：`~/.dwm/web.pid`
- 运行日志：`~/.dwm/logs/web.log`
- 支持通过环境变量 `$DWM_DIR` 或 `$DWM_HOME` 自定义配置与数据存放目录。
