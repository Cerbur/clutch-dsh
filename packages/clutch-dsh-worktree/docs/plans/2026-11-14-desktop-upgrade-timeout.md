# Desktop 升级超时诊断与修复

日期：2026-11-14。范围：`wt-worktree/feat-desktop-upgrade-timeout`。
DSH 调查基线：`ddac96760b`；只读源码，不修改 DSH 核心或已安装 profile。

## 已确认的两条阻塞链

### 升级前的 API admission drain

- `apps/desktop/src/main.ts` 的 `beforeRestart` 先 inspect，再 lock update tasks，
  最后停止 backend；此时尚未开始 Host disposal。
- `apps/desktop/src/host-process.ts` 的 `updateTasks()` 给控制请求 10 秒期限。
- `apps/desktop-host/src/update-tasks.ts` 的 `installDesktopUpdateTaskControl()`
  把所有已准入 `connection/request` 放入 pending 集合；lock 等待它们全部结束。
- 插件 `watchToolChanges` 原先空闲等待 20 秒。没有运行中的 Agent/Job 也会发生：
  先开始该读取，再 lock，10 秒内 drain 仍不能完成。依靠 disposal 唤醒会形成时序依赖。

使用真实 upstream admission controller 和插件通知 feed，以 mock timer 推进到 9999ms，
修复前测试失败：`Desktop update: task inspection timed out (10s) while draining Worktree long-poll`。
将单次空闲等待降至 5 秒后通过；不延长 Desktop deadline。revision、合并通知、共享轮询、
取消与最小范围刷新契约不变。空响应只重启通知读取，不发起 Git 或列表读取。
代价是活跃 Client 的空闲通知请求从约每 20 秒一次变为约每 5 秒一次。

### Host disposal 等待启动恢复取得锁

- Manager 启动恢复作为后台任务运行，关闭会取消 Git 并等待 recovery 与已跟踪操作。
- 默认 Sidecar shard 锁与 transaction repository/candidate 锁原先没有生命周期 signal。
  另一个存活进程持锁时，获取可等 10 秒。
- `apps/cli/src/process-shutdown.ts` 的 `createProcessShutdown()` 默认 5 秒强退。
  `apps/desktop-host/src/index.ts` 只有 disposal 完成后才发 `shutdown-complete`。
  Desktop 要求正常退出与该确认同时成立；退出码 0 本身不足以安装。

真实 Cordis Host、磁盘 Sidecar 与持锁 owner 的最小复现，在修复前两次约 5.076 秒触发：
`Desktop shutdown deadline: worktree Host did not dispose within 5 seconds`。
修复后同一反馈循环通过，并扩展覆盖 shard 与 repository 两种竞争、排在 recovery 后的请求，
以及跨进程真实 upstream shutdown controller 的 `ready → shutdown-complete → exit 0`。

## 插件修复边界

- 将 Manager lifecycle signal 传入默认 Sidecar 及 transaction 的锁；只取消 acquisition
  与 retry delay。在取得锁后、进入 callback 前再次检查取消，始终 finally 释放自己的锁。
- 不因取消撤走其他 owner 的锁，也不中断已进入 callback 的 Sidecar 持久化写入。
  Git 任务继续使用既有取消、命令 deadline 与独立的进程树清理 deadline。
- 排在 recovery 后的操作醒来时重新检查 signal，避免关闭后开始新工作。
- Host native-cleanup 的独立 repository 只读；Manager 自建带 signal 的默认 repository。
  自定义注入 Provider 的取消仍由注入方负责。
- 无持久 schema、版本号、release log、Worktree 路径、Session 或 DSH 元数据改动。
  数据保留回归逐字比较 Sidecar shard（含 active binding）与用户文件。

## 可重跑的反馈循环

从 monorepo 根构建，再从 package 目录运行；完整门禁还需继承 `DEVELOPMENT.md` 中的
唯一临时 DSH Home/TMPDIR 隔离环境：

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
```

```bash
DSH_NATIVE_SOURCE=/absolute/path/to/deepseek-harness node --test test/host-upgrade-shutdown.test.mjs test/mutation-lock-lifecycle.test.mjs test/worktree-tool-changes.test.mjs test/subprocess-git.test.mjs
```

回归同时验证通知到期、请求取消及卸载后的 waiter/listener 清理；锁取消、取得锁后准入前取消、
正常持久化完成、锁获取超时与 callback 失败后的所有权；Git 取消后等待 tree exit，
以及既有 Git timeout/cleanup deadline 行为。测试不减弱工具 schema 或安全门禁。

## 实际验证结果

2026-11-14，Node `v26.3.1`；以下 pnpm 命令均通过 `npx --yes pnpm@10.32.1`
执行，工作目录为 feature worktree 的 monorepo 根：

| 检查 | 实际命令（pnpm 参数） | 结果 |
| --- | --- | --- |
| Workspace | `run check:workspace` | 通过 |
| Cordis patches | `run check:patches` | 通过；YAML parser 对既有 `!!js` 输出 warning |
| ESLint | `--filter @cerbur/clutch-dsh-worktree lint` | 通过，包含新增测试及 IPC fixture |
| TypeScript | `--filter @cerbur/clutch-dsh-worktree typecheck` | 通过 |
| 构建 | `--filter @cerbur/clutch-dsh-worktree build` | 通过 |
| 完整测试 | `--filter @cerbur/clutch-dsh-worktree test` | 1452 通过，0 失败，0 skipped；约 106.45 秒 |

完整测试仅对子命令设置唯一临时 `TMPDIR` 与 `DSH_HOME`，同时配置
`DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness` 和该源码的
`packages/llm/llm-pi-ai/package.json` 为 `DSH_SCHEMA_ADAPTER_ANCHOR`；未覆盖 `HOME`。
新增 Host 回归全部通过：shard 竞争约 181ms、repository 竞争约 424ms、Git 清理约 20ms、
原生 admission 约 96ms（模拟时间）、真实 shutdown IPC 约 484ms。
这些是隔离 fixture 的耗时，不是生产 Desktop 升级耗时。

另单独执行 `node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs`，
1 项通过；通过 `execFileSync('git', ['diff', '--check'], ...)` 检查空白。
DSH 源码 checkout 保持干净且 HEAD 仍为 `ddac96760b`。验证过程未推送、发布或修改生产 profile。

### 相同原生接缝测试的旧版／修复版对照

另在两个独立临时目录分别构建旧版与修复版，再各运行两轮相同测试。
旧版构建输入由 `git archive` 从 `190b34872b0cb30d1aca5dd9b8f598dd9e2c1503`
提取；修复版仅替换为当前 `src/`。两边复用同一安装依赖图、同一 DSH 源码
`ddac96760b`，并复制完全相同的测试及 IPC fixture；各自生成 `lib/`，不复用当前构建产物。
原工作区源码和生产 profile 均未回退或替换。

从各临时 package 目录执行（另设置隔离 DSH Home/TMPDIR）：

```bash
DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness node --test --test-name-pattern='^native (Desktop admission|shutdown controller)' test/host-upgrade-shutdown.test.mjs
```

| 插件代码 | 轮次 | 通过／失败／跳过 | shutdown IPC 用例耗时 |
| --- | --- | --- | --- |
| 旧版 `190b348` | 1 | 0 / 2 / 0 | 5268ms |
| 旧版 `190b348` | 2 | 0 / 2 / 0 | 5247ms |
| 当前修复版 | 1 | 2 / 0 / 0 | 316ms |
| 当前修复版 | 2 | 2 / 0 / 0 | 362ms |

旧版两轮的失败均为目标症状，而非编译或依赖加载失败：

```text
admission: AssertionError: Desktop update: task inspection timed out (10s) while draining Worktree long-poll
           actual: false; expected: true
shutdown:  AssertionError: exit 0 alone is not a clean Desktop handoff
           actual: ['ready']; expected: ['ready', 'shutdown-complete']
```

admission 的错误文本是测试断言；测试使用真实准入控制器，并以模拟时钟推进到 9999ms，
此时旧版通知请求仍未结束。shutdown 使用实际时间和 upstream 默认 5000ms 强退：
旧版退出码为 0、signal 为 null 的检查通过，但缺少 clean-stop 确认的检查失败。
修复版两轮均收到 `ready → shutdown-complete` 并正常退出。
这确认上述条件下插件旧实现足以触发失败，不构成对某次历史现场的唯一根因认定。

## 上游建议与验证限制

建议 DSH API admission 区分可取消的长读取与会修改状态的请求，在 drain 前结束长读取，
继续等待写入；错误信息区分 admission timeout、Host disposal timeout 与缺失 clean-stop
确认。该建议未在本变更实施，也未向外部系统发送。

现场 host-stopped 日志和历史插件操作不能证明用户那一次升级具体经过哪条阻塞链。
这里确认的是插件能够触发的两种失败条件，以及对应修复的可重跑证据。
原生接缝使用真实 controller 和 IPC 子进程，但原生 roster 是 fixture；未运行完整 GUI、
electron-updater 或实际安装交接，未重启用户 Desktop。
已经进入的持久化 I/O、无法退出的进程树或其他插件仍可能耗尽 Host 全局关闭预算；
本次不通过缩短清理期限或延长升级期限掩盖这些情况。
