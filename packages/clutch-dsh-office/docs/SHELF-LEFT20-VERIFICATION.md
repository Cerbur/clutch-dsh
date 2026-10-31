# 双层置物架追加左移20cm验收

## 当前采用：双层置物架再左移20cm · 2026-10-28

用户追加要求只移动wall-shelf：[-.10,.15,-1.813]→[-.30,.15,-1.813]，精确再左移20cm。高度、深度、旋转与scale不变；窗户与蓝柜顶对齐、贴左墙的细缝、挂历和其他实例位置及全部GLB/manifest/材质/光机/角色路径保持。实际全场BVH只保留双墙拼角41对既有接触，无新增家具穿插。

完整25实例/40primitive按真实新位置重烘Cycles64sample Metal r31，OIDN为2026-10-28-shelf-left-shell-r32；全部source hash/布局/Three几何签名导入通过，2K RGBM8/UV20832bytes/16MiB预算保持。build/lint/布局Prettier/git diff --check、最新资源与光照定向回归96pass/0fail；本次位置微调未重复此前全量256项，二者不混称。真实 ~/.dsh-test http://127.0.0.1:3088/ 已重启并查看，最终1canvas/0alert、冷加载warn/error0。

回执sync/receipts/kitchen-layout-2026-10-28-shelf-left20-v1.json；证据sync/evidence/2026-10-28-shelf-left20/；完整验证工程kitchen/lighting/lookdev/2026-10-28-shelf-left20/厨房_场景验证.blend。catalog、双语README截图、Spec/Plan与HANDOFF已对齐，accepted为技术验收，用户视觉认可待审。此前新基线提交由用户/外部流程创建，本轮不提交/推送/发布；仅在现有release保留小范围变更。plugin-only，无DSH源码或生产profile修改。
