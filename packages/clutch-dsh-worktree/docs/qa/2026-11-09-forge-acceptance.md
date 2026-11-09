# Forge Worktree 新会话验收

日期：2026-11-09。分支：wt-worktree/feat-dsh-worktree-forge。
DSH：0.2.2-rc.1，源码 66491b05e3；未修改上游源码。
范围仅为新建 Session，旧 Session 不补写官方记录、不迁移。

## 实机环境与方法

使用用户指定的 ~/.dsh-test web profile、3088 端口及既有 Magpie / DeepSeek V4.1 Flash 1017
模型配置。通过 DSH plugin CLI 临时安装 feature checkout，验收后恢复原来
wt_6fa66686c7af 的 worktree 插件链接与 bundle 顺序；测试服务已停止。
该 profile 原本未启用官方 Forge，因此用临时启动覆盖层挂载官方 forge、forge-github、
forge-session、worktree 与 client-ui-forge，未更改其持久配置。

验收探针调用真实 workspaceController、worktreeManager、sessionController、
workingDirectory 与 forgePanel；新建/归档/移出管理均经过插件公开服务。
完全卸载使用 DSH plugin CLI remove，停止进程后重新启动；恢复阶段断言
worktreeManager 不存在，避免把“卸载”误当作仅隐藏 UI。
每次继续对话均等待 Agent idle，并断言新增 assistant/message 包含 FORGE_ACCEPTANCE_OK，
不是仅检查 prompt 入队成功。

独立测试仓库：~/.dsh-test/forge-acceptance-20261109。
两条验收 Session（保留以便复查）：

- session-ed0fdb07-27eb-4214-90bd-8897d0f0d504：官方恢复后继续在 Worktree 对话。
- session-60056549-49ea-472e-85cd-732c3fef2d55：Continue in Project 后在源项目对话。

## 验收结果

| 场景 | 结果 |
| --- | --- |
| 一个新 Worktree 新建两条 Session | 均有官方 forgeWorktree 投影；header cwd 仍为原 Workspace |
| 创建后真实模型对话 | 通过 |
| 归档后移出管理 | 磁盘保留，官方投影保留，真实模型继续回复 |
| 完全卸载 clutch 并冷启动 | 官方记录重放，两条 Session 仍可识别原 checkout |
| 卸载后继续对话 | 真实模型回复通过 |
| 模拟 checkout 缺失 | 仅重命名本次测试目录并保留副本，不删除用户工作 |
| 官方 restoreWorktree | 重建相同分支与路径，继续模型对话通过 |
| 官方 Continue in Project | cwd 回到源 Git 根，forgeWorktree 变 null，继续模型对话通过 |
| 浏览器界面 | 卸载后无 clutch Worktree 入口；原生列表显示“在自己的工作树中”图标；会话显示完成与模型回复 |

## 老数据

验收前对现存 sessions 文件和 clutch sidecar JSON 共 676 个文件记录 SHA-256；
完成模型、卸载、恢复和浏览器验收后，676 个文件均未变化。
另只读解压 263 份既有 v4 会话日志：都没有官方 Worktree 记录，本次未补写。

其中 55 条 immutable header 指向旧 ~/.dsh-test/clutch-dsh-worktree/worktree 池；
17 条所指目录已不存在。全部旧 v4 header 路径中，57 条目录不存在（包含其他历史测试目录）。
这属于验收前状态，不把它们当作本次新增回归，也不承诺新功能自动修复它们。

使用真实原生 WorkingDirectory/Projection 服务，在未挂载持久化服务的内存 Session 中
重放两份实际旧日志：旧目录仍存在的 Session 保持原 cwd；旧目录缺失的 Session 仍给出原有
directory does not exist 错误。原始日志与 header 不变。没有向旧会话发送新消息。

## 自动化门禁

在 feature 根目录实际执行：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness \
DSH_SCHEMA_ADAPTER_ANCHOR=/Users/yuancheng/Documents/Code/deepseek-harness/packages/llm/llm-pi-ai/package.json \
  pnpm --filter @cerbur/clutch-dsh-worktree test
node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs
```

官方恢复接缝已纳入 test/native-forge-recovery.test.mjs，其 6 个上游组件场景全部通过。
最终全量结果：1,419 项通过，0 失败，0 跳过；结构、patch、lint、typecheck、build 与 README 对齐门禁均通过。
默认未指定 DSH_NATIVE_SOURCE 时会明确跳过外部接缝；本次完整验证显式指定了真实源码。
两个独立审查分别检查规范与需求；发现的目录切换后取消问题已补齐调用取消和原生 Stop 回归。
最终规范复查 0 项未解决，需求复查 0 项未解决。

## 能力边界

- 官方 Forge 必须保持启用；卸载的是 clutch 插件。
- 原生标签表示当前仍在 Worktree，Continue in Project 后会消失。
- 默认恢复池为源 Git 根的 .agents/worktrees；新 checkout 使用其 clutch 子池。
  自定义官方池时需由用户保持两者兼容。
- 新建于旧池或外部导入 checkout 的 Session 可带标签并回到项目；
  官方默认不接受这些池外路径的磁盘恢复。
- 恢复不包含未提交文件；多个等待恢复的 Session 需逐个恢复。
- 子目录 Workspace 的 Continue in Project 指向源 Git 根，权限仍由 DSH 决定。
