# 灶台模型精修验收

## 当前采用：灶台规整柜体与双炉头精修 · 2026-10-29

用户四张新参考已长期保存kitchen/stove/work/2026-10-29-refined-r1/references，并记录原图hash。主厨房原参考继续保留。用户明确授权本组件重建几何，覆盖材质阶段对此件的形体冻结；当前delivery为2026-10-29-refined-r1，hash0f7756d88da214ff51f5a4e4601bfe1dcb928c97c59b34e8610b70580347e1a2，777032bytes，31532tri/3mesh/3primitive/3material/3张1024内嵌图，40ktri/4MiB上限未放宽，旧r6/candy快照保持不可变。独立refined契约不影响旧版门轴或其他组件。

重做蓝色柜体/脚块/封板、左右各.777m等宽奶油门板与抽屉、镜像中心±1.164m、统一分缝和暖金把手；右柜不再用被横向拉伸的重建表面。双炉头为规整黑搪瓷灶面、铸铁方形框/凸支架、金色炉圈、黑顶盖和暖金旋钮；烤箱重做金属面板/拉手、内搁架及单独烟色玻璃。真实圆角/加权法线，非单纯提高贴图锐度。基础色是无摄影棚明暗的分区色板，roughness/metallic按漆、搪瓷、铸铁、裸金属、标签和瓶身独立响应；不宣称已经烘焙高模法线。源图微细石纹/透明油瓶精度仍有差异，本版瓶罐为简化静态几何。

保留加长台面3.247109664m×.999625942m、work_surface高度.891553998m、现有stove根位置/yaw、全部历史安装锚点、实际接缝cap顶点世界坐标、烟机火灶中线、桌椅/水槽/挂件/角色站位与路线、相机/曝光/practical-v2灯位。burner锚点是安装工作平面，不是炉架顶或角色手部接触点。新的柜门只是闭合静态造型，没有runtime门轴、开门/拿取、炒锅或火焰能力；不能套旧r1动作。

中文可编辑工程kitchen/stove/work/2026-10-29-refined-r1/灶台_规整柜体双炉头.blend；隐藏“可编辑零件_不导出”collection保留单件参数，runtime仅opaque图集合批、烟色玻璃及既有cap三批。脚本同work/scripts/build.py，parent-stove.glb/parent-manifest.json保留精确前版，四视图前后在同灯光/相机32sample CyclesCPU渲染。最终独立GLB回导零退化三角面/零无效法线，非继承旧验证。正式delivery冻结后再从该路径导入。

真实全场Blender BVH仅双墙41对历史拼接接触，无新增家具穿插；完整角色路径测试覆盖新实体。32实例/48primitive重新Cycles64sample Metal、OIDN烘焙，当前2026-10-29-stove-refined-shell-r42（raw r41），仅墙地面2K RGBM8，UV20832bytes/atlas16MiB预算保持，PNG2782504bytes/hash5c8f2fde5c860e184a521cb790c76120783e34882992508e604494c66e494213；全部其他厨房GLB/manifest保持。本轮仅importer增加独立revision、替换灶台及依赖光照，不通过实时材质替换掩盖模型问题。收尾发现并行角色/动画文件变化，明确列入回执externalConcurrentChanges，保留不覆盖；本轮300tests与截图对应已构建的灶台集成产物，不把之后的角色源码修改冒充已验收。

实际完整300tests/0fail，build/typecheck/lint/Prettier/workspace/patches通过；真实~/.dsh-test单间/总览/本地双角色与冰箱活动、光照加载及浏览器结果见回执browser。最终美术批准待用户，Stage3仅灶台此子项技术完成，壁钟等其余几何修正仍未完成。回执sync/receipts/kitchen-stove-2026-10-29-refined-r1.json；证据sync/evidence/2026-10-29-stove-refined/。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。
