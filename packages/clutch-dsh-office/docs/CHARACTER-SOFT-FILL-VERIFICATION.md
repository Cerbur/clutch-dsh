# 鲸鱼娘专属提亮 · 2026-10-31

用户保留当前中档厨房交付，只调整角色明亮度。`character/soft-fill.ts`与`deepseek.ts`
接入角色专属漫反射增益和同底色暗部补偿，保留原PBR光影hook；参数及取舍见
[美术规范](ART-DIRECTION.md)与[光照规范](LIGHTING-DESIGN.md)。

角色源仍为`2026-10-29-face-blink-r2`，SHA256
`eea3bc03f99ea735948a8e33c108b3ae5eb2bbb860651d4bc217421a604bc003`。
原GLB、骨骼、形态键、动画及静态厨房图集保持，不新增光源、贴图或绘制批次。
这是人物美术补偿，有意减轻暗部；不宣称物理GI或FPS收益。

实际通过：

```sh
npm run build
npm run typecheck
npm run lint
node --test test/character-animation.test.mjs test/character-shadow.test.mjs test/character-toon.test.mjs test/practical-lighting.test.mjs test/runtime-demand.test.mjs test/scene-runtime.test.mjs
```

相关回归31passed/0failed/0skipped，非重新执行厨房全套素材测试。
本地预览`http://127.0.0.1:4190/`检查单人/四人、走动和不同朝向，真实浏览器shader编译正常，
warn/error为空。最终截图为四位模拟角色，见双语README的角色行；未操作真实DSH会话。
构建需要指定release工作区的写入权限，已在授权环境通过。

素材库回执：`sync/receipts/character-soft-fill-2026-10-31-v1.json`。
未安装profile、commit、push或publish；用户最终视觉认可待确认。
