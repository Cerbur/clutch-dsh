# clutch-dsh-discuss-local

这是 `clutch-dsh-discuss` 的 Provider 规划入口，未来计划包名为 `dsh-clutch-dsh-discuss-local`。

当前目录只保存基础说明，尚未包含 `package.json`、`cordis.patch.yml`、`tsconfig.json`、`src` 或可运行实现。

## 初步职责

- 推进 discussion session 的状态变化。
- 保存和恢复讨论上下文及用户选择。
- 校验用户输入与交互式卡片回答。
- 根据讨论结果组装 design doc。
- 与 DSH/Cordis 的 session、tool 或其他交互承载机制对接。

## 暂不确定的边界

交互逻辑究竟由新增 tool 承载，还是由 host/plugin UI、事件或结构化 response 承载，尚未决定。Provider 不应在这个阶段提前锁定具体实现。

## 相关记录

- [clutch-dsh-discuss idea](../../docs/ideas/2026-08-18-clutch-dsh-discuss.md)
