# 发布记录

## 0.1.2 — 2026-09-04

### 中文

#### 优化

- 将最低支持的 DSH 版本提升至 0.1.2-rc.2，并将 peer 依赖与 DSH 0.1.2 客户端架构对齐。
- 适配 DSH 客户端拆包架构，迁移对已移除客户端运行时包的依赖，改为依赖渲染器与会话支持包。

## 0.1.1 — 2026-08-30

### 中文

#### 修复

- 将构建从通用 `prepare` 生命周期移到 npm 发布前，避免源码依赖安装时触发构建。
- 为当前 DSH 预发布版本声明显式 peer 兼容范围，避免安装时被 semver 错误拦截。

## 0.1.0 — 2026-08-30

### 中文

#### 新增

- 新增 `happy_fireworks` 工具，并在 DSH Web UI 中播放 emoji 礼花。
- 将每次礼花扩展为 40 个视觉元素，并保证 🎉、🌟 和 ✨ 的最低数量，同时提供 seeded variety。

# Release log

## 0.1.2 — 2026-09-04

### English

#### Changed

- Raise minimum supported DSH version to 0.1.2-rc.2 and align peer dependencies with DSH 0.1.2 client architecture.
- Adapt to DSH client modular architecture by migrating off retired client runtime package to renderer and session packages.

## 0.1.1 — 2026-08-30

### English

#### Fixed

- Move the build from the general `prepare` lifecycle to the npm publish step so source dependency
  installs do not trigger a build.
- Declare explicit peer ranges for the current DSH prerelease lines so semver does not reject a
  compatible host during installation.

## 0.1.0 — 2026-08-30

### English

#### Added

- Add the `happy_fireworks` tool and an emoji fireworks celebration in the DSH Web UI.
- Expand each burst to 40 visuals with guaranteed 🎉, 🌟, and ✨ minimum counts plus seeded variety.
