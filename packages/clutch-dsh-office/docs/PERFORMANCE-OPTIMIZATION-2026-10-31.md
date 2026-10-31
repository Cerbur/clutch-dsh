# Office 性能优化交付 · 2026-10-31

> 以下帧率是第一轮低分辨率策略的历史测量。后续用户要求提高全尺寸清晰度，
> 当前已改为 DPR2／八百万像素预算（CSS 分辨率下限），不能沿用下文约30FPS的结论。
> 最新画质与性能见 [全尺寸验证](CLARITY-2026-10-31.md)。

位置：`wt-office-0.1.0/release`。基线 `cc59bb3`；原性能分析及两份原始数据保持不变。
代码、派生素材、双语说明、可复现测量工具和回归测试已在同一 worktree 中完成。
本轮没有 commit、push、publish 或安装到 DSH profile。

## 实测结果

本机 M1 Pro、内置浏览器 WebGL2/Metal，1088×950 视口，模拟 Retina DPR2。
使用真实 OfficeDashboard/runtime/生产描述符加载路径；2秒预热、8秒采样。
GPU来自异步timer query，CPU包含帧内同步工作；不是原生DSH整页或跨设备性能保证。
最终两个四人样本开始/结束时均无loading或fallback。

浏览器实测四人→一人→空房→重新四人：单人29.99FPS，空房8秒0帧；重新四人保持
50个几何资源、92个纹理资源和4套骨架。另通过工具隐藏/显示Office触发真实
IntersectionObserver释放，canvas计数0→1，重建角色后无加载回退。

| 指标              |       本轮修复前 |     最终四人样本 |
| ----------------- | ---------------: | ---------------: |
| GPU每帧中位耗时   |         50.57 ms | 25.34 / 24.03 ms |
| 实际绘制FPS       |            17.74 |    29.61 / 30.12 |
| GPU P95           |         58.26 ms | 34.60 / 31.84 ms |
| 材质纹理估算      |       482.67 MiB |       234.67 MiB |
| 活跃几何属性      |        28.39 MiB |        15.25 MiB |
| 活跃形态键属性    |        23.87 MiB |         5.97 MiB |
| Three几何资源计数 |              322 |               50 |
| 骨架数            |                4 |                4 |
| 画布像素          |        1,922,490 |          999,649 |
| 厨房GLB传输体积   | 48,101,520 bytes | 34,919,592 bytes |

纹理估算按尺寸、格式、mipmap和上传共享关系计算，不包含帧缓冲、阴影等全部GPU开销，
不是操作系统显存读数。最终画布DPR约1.082，来自一百万像素上限；文字仍为CSS原分辨率。
8秒窗口的边界计数可能略超过30，调度目标为平均30FPS。原报告较早的四人样本为19.9FPS、
GPU46.8ms；本轮前后采用重新采样的基线，系统其他工作未完全隔离。

## 已完成的处理

- **阴影与像素**：16次软阴影采样降为8次平衡采样，保留半径和接收面深度修正。
  四个零强度Spot继续提供阴影图，只跳过不贡献照明的原生BRDF计算。DPR上限1.25，
  画布最多一百万像素。保留软阴影、暖光、人物落地阴影与墙地Cycles光照。
- **帧调度**：采用固定截止时间推进30FPS节奏，动画delta仍按真实已绘制帧间隔计算。
  回归复现：刷新间隔仅比60Hz短0.01ms时，旧实现两秒只画41帧；修复后恢复目标节奏。
  空闲、减少动态、隐藏、离屏、失效和错误后的取消机制继续通过回归。
- **角色复用**：每房间一次加载/解析模板，四人共享几何、形态键属性、材质和贴图。
  每人拥有独立骨架、形态键权重、mixer和眨眼。额外修正SkeletonUtils按网格克隆骨架的
  行为，三网格重新共用该角色自己的骨架。模板由房间持有，演员退出仅释放个人资源。
- **白模释放**：厨房成功替换时立即释放旧白模几何，保留其他物件仍使用的公共palette；
  角色白模独立持有并整体释放。避免几何资源一直保留到整个房间销毁。
- **纹理显存**：小道具512px，大表面和角色1024px；共享Source/bitmap仍去重释放。
- **纹理传输**：独立28个transport GLB，PNG无损转WebP，JPEG原字节保留。
  自动逐像素核验图片、逐字节核验几何和Meshopt压缩流，并验证材质/UV/层级。
  构建校验原始/派生hash，运行时验证实际传输hash与旧bake源对应，再校验所有几何签名。
  光照来源保持同一物理场景，r56继续有效，不通过改hash伪造重烘。
- **包体**：npm只包含transport GLB和角色，排除重复的原始/optimized厨房GLB。
  `npm pack --dry-run --json --ignore-scripts`核验29个GLB，压缩约57.52MB，解压约64.73MB；
  原报告对应约70.54MB／77.88MB。发布前仍需正常release门禁。
- **构建一致性**：Office Client的Session controller类型绑定本包直接依赖，避免锁文件中
  新旧DSH传递依赖的品牌类型冲突；与既有Cordis/slots路径约束一致，没有修改其他plugin。

## 几何与合批取舍

复核了报告点名的植物、桌子、层架和置物柜及现有low候选。在原误差边界内，植物和
置物柜medium/low面数相同；桌子low可少11,678面、层架少1,200面，合计仅占静态场景约3.2%。
桌子medium已因薄面使用更严格0.0005误差，low候选采用0.001，不能当成同等轮廓质量。
本轮保持已确认的399,911个静态三角形、布局、UV、材质和光照来源，改进共享与生命周期。
四人主画面仍627,969面、62次绘制，含动态阴影855,977面、74次绘制；不声称本轮继续减面。
当前CPU较轻，单GLB/大规模合批没有测量支持，维持按需加载和组件边界。

## 验证与复现

- `pnpm run build`、`pnpm run typecheck`、`pnpm run lint`通过。
- 全套 `node --test --test-concurrency=1 test/*.test.mjs`：336项，332通过、4项素材库条件跳过、0失败。
- `OFFICE_ASSET_LIBRARY=/Users/yuancheng/Documents/blender/office node --test test/left-decor.test.mjs`：
  10项通过，包括前述4项条件测试。
- 最后追加帧调度、骨架去重和来源校验后，受影响的8个测试文件重新运行：82项通过，0失败。
  没有把分次执行描述成一次完整340项跑完。
- `pnpm run check:workspace`、`pnpm run check:patches`通过；后者保留既有`!!js` YAML警告。
- `pnpm install --frozen-lockfile`补齐依赖后，根workspace的worktree包prepare因其既有DSH类型
  冲突失败；该包未修改。Office自身的最终build/typecheck/lint全部通过。
- `git diff --check`与本次改动的Prettier检查通过。

在Office包目录运行 `node scripts/performance-preview.mjs`，打开
`http://127.0.0.1:4191/?deviceDpr=2`。固定视口1088×950，双击版本Tag，选择人数后点击
`Sample 8 seconds`。样本保存到`/tmp/office-performance-new-samples.json`；`Save scene`导出当前
画布到`/tmp/office-performance-scene.png`。工具只绑定127.0.0.1，使用模拟Session，不访问用户会话。

最终原始样本与画布截图在本目录`reports/2026-10-31-performance-optimized.json`及
`reports/2026-10-31-performance-optimized.png`。首次四人baseline摘要见本表，前轮原始分析数据不覆盖。

取舍：小道具近距离放大细节减少，八次采样阴影边缘可能较粗；WebP解码是新增浏览器要求。
截图和本机性能验证不代表用户最终美术批准，也不代表手机设备可稳定30FPS。
