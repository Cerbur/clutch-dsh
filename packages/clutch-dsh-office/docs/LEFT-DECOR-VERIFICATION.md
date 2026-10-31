# 四件生活收纳接入验收

## 当前采用：左墙生活收纳四件 · 2026-10-29

四件独立交付均为2026-10-29-r1：小调味架spice-rack（.74×.703457×.269506m/20313tri）、开放木格柜open-cubby（.22×.737380×.157793m/5834tri）、黑挂钩杆black-utensil-rail（.82×.625123×.138354m/10622tri）、迷你收纳盒wall-storage-box（.38×.301498×.180226m/11649tri）。各单mesh/primitive/material、三张1024内嵌图、normal .35；独立25k/10k/15k/15k面和各4MiB上限，冰箱30k/8MiB约束保持。原始用户文件逐字节保存在各source，中文可编辑工程/脚本/纹理/审核图在work/2026-10-29-r1；冻结delivery不回写accepted状态，以本回执和catalog为准。四件原拓扑/UV保留，原图明暗及重建瑕疵仍在。

摆放唯一源src/office/kitchen-layout.ts：调味架[-2.307,2.06,2.45]、黑挂杆[-2.307,1.35,2.45]在左推车上方，挂杆顶1.975m、距调味架底约85mm；窄格柜[-2.307,1.86,-.18]紧邻蓝柜，顶2.597m为低频上层收纳。三者yaw90°/scale1。收纳盒原试摆在水槽右后方被冰箱遮挡，最终[2.26,1.65,-1.807]、yaw0/scale1，顶1.9515m；右挂盆升至Y2.15，挂历维持Y1.08，三者同列、两处净距约198.5/90mm。不采用隐藏的候选位置。

为留出新收纳空间，蓝柜后移14cm至Z-.84、砧板抹布至Z-.95且保留120%尺寸；旧橙杆移备餐区[-2.307,1.63,-.36]、等比45%，避免两套全尺寸挂杆重复；左挂盆移Z1.67。其余家具/窗户/桌椅/角色站位路线、相机/曝光/softboxes/practical-v2参数及全部既有GLB/manifest字节保持。灶眼和烟机实际热柱留空：左盆位于备餐侧的非火灶区域，覆盖旧“整条台面上空一律禁挂”的粗规则，保留两个fire anchor热柱反例检查。

全场真实Blender BVH仅双墙拼角41对既有接触，无新增非地面相交。最终32实例/47primitive全部参加Cycles64samples Metal光照计算；仅墙地面接收新2K RGBM8/OIDN，采用2026-10-29-left-decor-shell-r40（raw r39），UV20832bytes、atlas16MiB预算保持，PNG2766589bytes/hash1fbf55f5adb0cdeb14ef29dae92424dd1ca3731d4641f66d59d595eaee62d5b2。家具仍实时PBR，保留四处暖光，不增加shadow map。四新件增加48418tri/8556396bytes/四次静态绘制，未做FPS或加载基准，不宣称零成本。

实际build/typecheck/lint/Prettier/workspace/patches通过，完整含真实素材库校验290tests/0fail；角色双人绕桌、冰箱往返及中断碰撞检查覆盖32实例。真实~/.dsh-test总览/单间/本地预览/离屏重建与最终资源加载结果见browser字段；最终美术认可待用户，静态挂件不具备拿取/开门动画。回执sync/receipts/kitchen-left-decor-2026-10-29-r1.json，证据sync/evidence/2026-10-29-kitchen-left-decor/，主工程kitchen/lighting/lookdev/2026-10-29-left-decor-shell-r39/厨房_Cycles光照烘焙.blend。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。
