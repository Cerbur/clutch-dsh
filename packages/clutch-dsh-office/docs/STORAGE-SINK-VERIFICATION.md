# Storage cabinet replacement and sink fit — 2026-10-28

新版置物柜 `2026-10-28-r1` 已替换旧style-r1，29342面/4069316字节/单静态mesh+primitive+材质/3张内嵌贴图，hash `0eeb04aabea9d090ffc0dab2279c55027ae72cc54611335493f962496ef86e55`。保留原件盆栽、调料、蔬菜、筐和轮子；无旧轮轴/独立食材动作。根位置[-1.715,.024499213707168,1.55]，scale1，轮底对齐地板Y=.025。旧revision节点规则与30k/8MiB/单材质预算保留可回滚，未覆盖冻结快照。

用户明确授权水槽在导入后由场景设置大小以填满转角：采用原r2 GLB字节不变，scale[1.8667534820395086,1,1.2303512683915283]，根[-.75,.024960769226163,-1.4]，世界宽3.08m、深.80m，总高约1.35m，台面高度仍约.925m（含地板修正）。左侧接近左墙转角，右侧与冰箱约50mm缝，后侧距墙约15mm。此为明确非等比场景fit例外，整体总成包括龙头/毛巾/瓶罐同步横向拉宽，不声称重新建模或保持所有细节原始比例。manifest仍描述原始资产尺寸，场景缩放唯一源KITCHEN_SCALE，不写回GLB/Blender工程。

桌子[1.45,0,1.15]、凳Z2.03、其余16件GLB与水槽GLB/manifest、相机/CSS、冰箱行走策略保持；用户后续授权的Cycles预览灯光迁移另见光照文档与回执。扩大后的水槽参与实际变换碰撞检查；置物柜与挂杆只有粗包围重叠，实际三角面无交，不为包围盒误报移动家具或忽略断言。Blender全家具BVH仅双墙41对共同接触，其余无表面交。新源图集既有烘焙明暗/台面轻微三角明暗保留；真实页面已查看，不宣称完全去光照。

Validation: official Blender5.2.3 LTS independent import and full-scene BVH/Cycles review; 0zero-area/badUV/badNormals/mesh repairs,29342tri/1mesh/1material/3packed decoded images. `pnpm run test` (100passed including build), `pnpm run typecheck`, `pnpm run lint`; new revision/legacy rollback and budget contracts tested without changing refrigerator rules. Geometry runtime checks preserve raw asset scale while scene sizing tests verify the explicit sink transform. Real ~/.dsh-test cold reload: five idle rooms, focused kitchen, two-character preview, fridge approach, last room and returned rebuilt canvas; console/scene status in browser evidence. OS reduced-motion not manually toggled. No model requests or Session mutations.

Source textures already contain baked highlights and countertop triangular shading; accepted as current replacement without claiming those were fixed. GLB authoring remains in the Office library. Exact cabinet revision/hash/geometry/source and fit transform in `sync/receipts/kitchen-storage-cabinet-2026-10-28-r1.json` / `sync/receipts/kitchen-layout-2026-10-28-storage-sink-v1.json`. Eighteen GLBs 38,037,304 bytes; uncompressed Client 52,659,591bytes. Only cabinet adopted GLB/manifest changed, plus layout sink-fit/root heights; other17asset pairs, CSS verified unchanged; lighting separately updated to the user-selected Cycles review target. No Harness source/production profile edits or commit/push/publish.

[Updated kitchen](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-storage-sink-overview.png)
[Fridge route](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-storage-sink-search.png)
