# @cerbur/clutch-dsh-office Release Log

## 0.1.0 — 2026-11-01

### 中文

#### 新增

- 新增仅通过插件实现的共享厨房会话看板，展示运行、待交互和未读完成会话，常驻气泡支持原生导航，列表不受四角色上限限制。
- 接入 Blender 鲸鱼厨房和最多四位独立行走、转身及眨眼的鲸鱼娘，支持明确标记的本地模拟预览、减少动态效果与离屏资源释放。
- 新增保留原始素材的中档轻量模型与高／中／低档对比工具，静态厨房三角面减少约 26%，并为鲸鱼娘增加柔和暗部提亮。
- npm 包包含运行所需的模型、内嵌贴图及烘焙光照资源，由插件按需提供，无需外部素材服务。

#### 优化

- 优化厨房柔和材质、暖光与烘焙墙地面，收敛窗户泛光、将烟机调整为柔和漆面并修复底板木框黑缝。
- 保持全分辨率 30 FPS 渲染与按需纹理加载，并修复 Windows 平台下的素材路径选择。

### English

#### Added

- Add a plugin-only shared kitchen Session dashboard for running, pending-interaction and unread-completed Sessions, with persistent native-navigation bubbles and a list extending beyond the four-character limit.
- Integrate the Blender whale kitchen and up to four independently walking, turning and blinking whale girls, with a labeled local preview, reduced motion and offscreen resource cleanup.
- Add medium-quality lightweight models that preserve original assets and a high/medium/low comparison tool, reduce static kitchen triangles by about 26%, and gently brighten character shadows.
- Include runtime models, embedded textures and baked lighting in the npm package, served on demand by the plugin without an external asset service.

#### Improved

- Refine soft kitchen surfaces, warm lighting and baked walls and floor, restrain window glow, give the hood a soft coated finish and fix dark seams on the wooden platform rim.
- Preserve full-resolution 30 FPS rendering and on-demand texture transport, and fix asset path selection on Windows.
