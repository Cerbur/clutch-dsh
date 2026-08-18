# clutch-dsh Package Naming Design

## Goal

将 `clutch-dsh` workspace 的可运行 package 命名改为以所属 plugin 名称为前缀。模块名由具体 plugin 功能决定，不由 workspace 强制固定后缀。

## Decision

每个可运行 package 在 `package.json` 中声明 `clutchDsh` metadata：

```json
{
  "name": "clutch-dsh-worktree-local",
  "clutchDsh": {
    "plugin": "clutch-dsh-worktree",
    "role": "provider",
    "serviceDefinition": "clutch-dsh-worktree-manager"
  }
}
```

校验规则为：

- package 目录名必须与 `package.json.name` 完全一致。
- package 名必须以 `clutchDsh.plugin + "-"` 开头。
- `clutchDsh.role` 只能是 `service-definition`、`provider` 或 `consumer`；这些是架构角色，不是模块命名后缀。
- Service Definition 的 `serviceDefinition` 必须等于自身 package name。
- Provider 和 Consumer 必须在 `dependencies` 中以精确的 `workspace:*` 依赖 `serviceDefinition`。
- `cordis.patch.yml` 的 `dsh.bundle` 必须等于 `serviceDefinition`。

例如 `clutch-dsh-worktree-manager`、`clutch-dsh-worktree-local` 和 `clutch-dsh-worktree-ui` 可以分别承担三类角色，但 `manager`、`local`、`ui` 不是通用命名要求。

## Validation Boundaries

`check-workspace.mjs` 继续校验现有 package 必需文件和 scripts，并新增目录/name、plugin 前缀、角色 metadata 和 Service Definition `workspace:*` 依赖校验。`validate-cordis-patches.mjs` 继续跳过没有 `package.json` 的规划目录，并依据 package metadata 校验 bundle，不再从目录后缀推导 `dsh-*` 或 `dsh-tool-*` 名称。

当前没有真实 runtime package，因此不会改变已有 package 的运行行为；根 workspace 的 private、文件形状、scripts、format、lint、typecheck、test 和规划目录跳过规则保持不变。

## Documentation and Scope

bootstrap plan、authoring guide、根级命名说明和相关测试同步采用上述约定。与本次命名直接相关的其他非 worktree 规划文本只更新名称示例；`packages/clutch-dsh-worktree/**` 下的插件设计文档保持不变。

## Testing

测试覆盖任意模块名的有效 Service Definition、Provider 和 Consumer；目录名/name 不一致、plugin 前缀不匹配、缺失或错误 metadata、非精确 `workspace:*` 依赖，以及 patch bundle 不匹配时必须失败。规划目录无 `package.json` 时两个 validator 仍必须成功跳过。
