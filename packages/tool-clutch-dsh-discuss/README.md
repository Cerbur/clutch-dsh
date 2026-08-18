# tool-clutch-dsh-discuss

这是 `clutch-dsh-discuss` 的 Consumer 规划入口，未来计划包名为 `dsh-tool-clutch-dsh-discuss`。

当前目录只保存基础说明，尚未包含 `package.json`、`cordis.patch.yml`、`tsconfig.json`、`src` 或可运行实现。

## 初步职责

- 提供“讨论一个需求”的入口。
- 拉起需求输入框并展示当前 discussion session 阶段。
- 渲染交互式卡片，支持选择、补充和确认。
- 让用户返回、修改或跳过前一步讨论。
- 展示、编辑和确认最终 design doc。

## 依赖边界

Consumer 未来只依赖 `clutch-dsh-discuss` 的 Service Definition contract；不直接实现 session 持久化、卡片决策逻辑或 design doc 组装。

## 相关记录

- [clutch-dsh-discuss idea](../../docs/ideas/2026-08-18-clutch-dsh-discuss.md)
