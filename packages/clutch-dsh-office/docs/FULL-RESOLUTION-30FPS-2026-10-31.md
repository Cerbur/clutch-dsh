# 全尺寸四角色 30 FPS · 2026-10-31

本轮承接 [高清修复](CLARITY-2026-10-31.md)，目标是在相同画质下消除每帧重复的静态 PBR 光照计算。
修改位于用户指定的 `wt-office-0.1.0/release`，没有提交、推送或改动 DSH profile。

## 实现与画质边界

- 保持 DPR2、八百万像素预算、全部模型/纹理、灯位/强度、阴影核、角色动画与色调映射。
- 静态厨房缓存完整分辨率的线性 HDR 颜色。每帧重建家具的原生 MSAA 深度，保留精确遮挡，
  再绘制角色、接收动态阴影的墙地面及烤箱玻璃。玻璃只混合一次。
- 静态阴影图生成时仍包含完整家具和墙地面；角色专属阴影图继续逐帧更新。
- 模型/烘焙到达、窗口缩放会让缓存失效；首次素材流式加载期间走原始完整绘制路径，
  避免每个 GLB 到达都分配大缓存。离屏重建、上下文失败与卸载仍由原有生命周期管理。
- MSAA 目标只在缓存重建期间存在，解析后复制并立即释放。3682×1900 下常驻颜色/背景掩码
  存储约 80.1 MiB；4×MSAA 重建时的缓存存储峰值估算约 480.4 MiB，之后回落。
  这是格式推算，不是操作系统显存测量，也不包含原场景、屏幕缓冲和驱动开销。
- 不支持可渲染 HDR 目标的设备保留原始完整画质渲染，不自动降清晰度或关闭阴影。

## 测量口径

使用真实 dashboard/runtime 的本地模拟四会话，Apple M1 Pro、Chromium/ANGLE Metal，
1920×1080 视口，实际绘制缓冲 3682×1900、DPR2。计时包围整个帧，包括缓存合成、深度绘制、
角色阴影与动态 PBR，不能把某个 pass 的耗时当成完整帧耗时。

上轮相同绘制缓冲：14.87 FPS，GPU 中位数 59.077 ms。
本轮最终版本首轮 30 秒：30.00 FPS，30 个一秒窗口全部 30 帧；GPU 中位数 14.597 ms、
p95 21.070 ms；帧间隔 p99 35.1 ms，超过 50.5 ms 的间隔为 0。

最终版本连续三轮各30秒：

| 轮次 | 实际 FPS | GPU 中位 / p95（ms） | 帧间隔 p99（ms） | 超过50.5ms |
| ---- | -------- | -------------------- | ---------------- | ---------- |
| 1    | 30.00    | 14.597 / 21.070      | 35.1             | 0          |
| 2    | 30.00    | 13.394 / 18.179      | 42.4             | 0          |
| 3    | 29.99    | 14.483 / 20.459      | 36.8             | 0          |

前两轮每个一秒窗口均为30帧；第三轮一秒窗口为29–31帧，存在采样窗口边界抖动。
三轮绘制缓冲始终为3682×1900，没有动态降分辨率。

完整连续采样见 [原始数据](reports/2026-10-31-full-resolution-30fps.json)。
持续 30 FPS 的结论限定于此设备、尺寸和素材就绪后的稳定场景；初次加载、缓存重建和其他
GPU/CPU 负载不在稳态承诺内。未用 Windows GPU 冒充实测。

## 同帧对照

同一次点击内不推进动画，分别输出缓存路径与原始完整渲染。相机、角色位置、动作和阴影图一致。
首组最终版本：平均 RGB 通道绝对误差 0.09054/255，最大通道差超过 8 的像素占 0.40153%。
HDR 半浮点存储与 MSAA 解析后再色调映射允许少量边缘差异；并非逐字节相同。
宽区域光照、地板和角色阴影通过同帧比较；没有降低分辨率或用截图代替动态人物。

- [缓存渲染](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/docs/reports/2026-10-31-30fps-cached.png)
- [相同姿态完整渲染](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/docs/reports/2026-10-31-30fps-reference.png)
- [量化比较](reports/2026-10-31-30fps-comparison.json)

复现：运行 `node scripts/performance-preview.mjs`，访问
`http://127.0.0.1:4191/?deviceDpr=2&sampleSeconds=30`，双击版本 Tag 进入四角色预览，
等待素材完成后采样。使用 **Save identical-frame comparison** 保存同帧图片，再运行
`node scripts/check-frame-comparison.mjs`。比较阈值为平均误差小于 0.25/255，差值超过 8 的像素
少于 0.75%；它可以检出调查中出现的地板深度合成错误。

## 检查

缓存测试覆盖完整投影初始化、精确深度、玻璃只混合一次、模型/窗口失效、流式加载、
临时 MSAA 释放、渲染失败恢复、资源归属和 HDR 不支持时的完整渲染路径。
调度、角色阴影、光照和模型生命周期同时按现有测试验证。

实际通过：

```bash
pnpm run build
pnpm run typecheck
pnpm run lint
node --test test/static-frame.test.mjs test/runtime-demand.test.mjs test/character-shadow.test.mjs test/baked-lighting.test.mjs test/lighting-resources.test.mjs test/area-shadow.test.mjs test/performance-budget.test.mjs test/character-sharing.test.mjs test/render-budget.test.mjs test/windows-assets.test.mjs
node scripts/check-frame-comparison.mjs
git diff --check
```

相关测试104项全部通过。浏览器离屏后canvas为0、返回后为1；1440×900与1920×1080
往返缩放后重新同帧对比，平均误差0.09024/255、差异超过8的像素占0.39891%，通过同一门限。
浏览器没有warn/error；截图与性能来自本地模拟四会话，未发起真实DSH任务。
空房恢复稳定后的30秒采样为0帧，缓存没有引入持续空转。
