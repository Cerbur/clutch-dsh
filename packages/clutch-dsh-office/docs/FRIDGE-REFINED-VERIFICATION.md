# 冰箱本体鲸鱼精修及绿植保护验收

## 当前采用：冰箱本体与鲸鱼精修、原绿植精确保护 · 2026-10-30

用户四张新参考归kitchen/refrigerator/work/2026-10-29-refined-r1/references，hash入清单；主厨房参考不替换。新采用2026-10-29-refined-r1，hash4b9c6615a097d5cddf93e8c60742621377153437cdb7fd4a9eb36a30b3669ce4，2696828bytes/26848tri/5mesh/5primitive/2material/6内嵌图。仍30ktri/8MiB，旧candy-r2及更早delivery保留。真实Blender重建平整圆角壳、上下门、银色弧形把手、规整便笺与鲸鱼磁贴、圆润鲸鱼主体/连续白肚皮/黑眼高光/粉色腮红/侧鳍/翘尾/喷水饰。非仅调粗糙度或假装修复贴图，未做微细肚皮刻线，便笺与照片是简化造型而非逐像素重现参考。

用户明确要求绿植不变，原参考图陶土盆栽9300tri单独保护：顶点/索引/UV/法线/材质参数/三张原嵌图逐字节复用，root/top/plant世界变换原样，花盆/叶片没有重拓扑、缩放、改色或移动。原图集保留供盆栽，新增本体鲸鱼共享的三张1024图；GLB原字节拼接脚本scripts/merge-plant.py重定位资源索引，plant-protection.json与测试使用真实parent证明内容相等。上下门原local-Y右铰链translation及extras原JSON精确保留；新门板为各pivot子mesh，仍闭合静态展示，无内胆/开门活动交付。源工程kitchen/refrigerator/work/2026-10-29-refined-r1/中文冰箱_本体鲸鱼精修.blend，隐藏可编辑零件保留。

原盆栽位置不动；新壳顶约低于盆底1mm，鲸鱼缩至90%并移到不碰原叶片的位置，独立最终GLB审阅证实plant与壳/门/鲸鱼零表面交。新白肚皮通过连续球面UV底色呈现，没有拼接半球接缝。原盆栽旧贴图里的光影与形体瑕疵按用户要求保留，不宣称去光照；新壳/鲸鱼色板不烘焙摄影棚明暗。同机位/同灯光32sampleCPU四视图前后已实际渲染，独立回导零退化三角面/零无效法线。

房间布局、冰箱根坐标、水槽/垃圾桶/吊灯位置、桌椅与角色站位/路线、相机/曝光和practical-v2灯位保持。全厨房真实BVH仅双墙41对历史共同面，无新增家具相交。完整32实例/48primitive按新几何重烘Cycles64sampleCPU/OIDN，采用2026-10-29-fridge-refined-shell-r46（raw r45，r43 Metal未完成候选不采用），仅墙地面2K RGBM8，UV20832bytes/atlas16MiB预算保持；atlas2790317bytes/hash285e64ebd46634725dd256d68d07ee3c913a471e1724192175399b559d004b53。其他厨房GLB及manifest字节保持；并行角色/动画变化仅列入回执、不覆盖或归因本轮。新增三张模型贴图有内存成本，未做FPS/VRAM基准，不宣称零开销。

实际完整316tests/0fail（含真实parent植物字节/材质/变换与铰链校验）、build/typecheck/lint/Prettier/workspace/patches通过，真实~/.dsh-test页面加载/双角色与冰箱预览/控制台结果见browser。早期启动曾有冰箱与光图请求超时，临时诊断证实Host已完成读取；随后重载成功，根因未确认，不宣称已修复传输。临时诊断已移除，未改超时阈值或DSH源码，最终构建重启后无回退告警。此为技术验收，最终美术认可待用户。Spec/Plan只将冰箱本子项完成，其他Stage3几何工作不冒充完成。revision和证据目录保留开始制作的2026-10-29，技术验收于2026-10-30完成。回执sync/receipts/kitchen-refrigerator-2026-10-29-refined-r1.json；证据sync/evidence/2026-10-29-fridge-refined/。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 用户撤回冰箱精修：恢复前一版 · 2026-10-30

用户明确不接受本体/鲸鱼精修外观，当前恢复refrigerator/2026-10-28-candy-r2（SHA256 250242b0f81f83e1efbf1ac82f686eb464dfcba89b0ed2ff13138bda49e6b6c4），同时恢复与旧冰箱几何相符的2026-10-29-stove-refined-shell-r42光照。只撤回本轮冰箱，不撤回已精修灶台、新挂件、当前布局、暖光参数或并行角色动画改动。

2026-10-29-refined-r1及r46光图为已撤回候选，前一节技术测试通过不代表用户美术认可；不能再次默认采用。精修Blender工程和不可变交付保留为历史，catalog当前采用与插件资源恢复旧版。仅依赖被撤回形体的新增测试从当前回归移出，原文归sync/evidence/2026-10-30-fridge-rollback/rejected-refinement-test.mjs.txt，原candy材质回归恢复。不得自动回滚其他改动。当前回执sync/receipts/kitchen-refrigerator-2026-10-30-rollback-v1.json。全程plugin-only，无commit/push/publish。
