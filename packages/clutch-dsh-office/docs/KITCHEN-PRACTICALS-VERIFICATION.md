# 四处厨房暖光验收

## 当前采用：四处局部暖光 · 2026-10-29

按厨房主参考新增烟机下方、双层架下方、窗户、鲸鱼吊灯四处暖光。参数唯一源src/office/kitchen-practicals.ts（kitchen-warm-practicals-v2），编译后导出同一JSON供Blender，不手工维护两份灯位。烟机26W/1.12×.26m、层架22W/1.22×.12m、窗户16W/.78×.46m，线性色分别[1,.53,.22]/[1,.55,.24]/[1,.64,.32]；鲸鱼灯16W等效point、linear[1,.57,.25]、运行时范围1.6m，按light_anchor下移7cm置于不透明灯罩下方。

窗格用根局部坐标发光蒙版，不新建悬浮面片、不把木框/整物件涂黄。实际四窗格射线测得前表面深.097m，凸木框>.15m；采用depth≤.115m、|X|≤.455m、Y .10–.68m，linear[1,.64,.27]×.9发光。Four-pane真实GLB回归验证四块窗格均发光、木框不发光，原PBR/UV/贴图/材质批次保持。r35/r36初试蒙版只点亮部分窗格，为历史候选，不作为采用版本。

保留全部源GLB及manifest、28实例布局/几何签名、主三softbox、弱正面面光、相机、Neutral曝光1、s1反射与既有角色路线。Three新增3RectArea+1Point，合计7Rect/4shadow-only Spot/1Point；原前三面光与四阴影proxy排序保持，shadow shader只给前三光采样对应贴图，新增三光不借用角色shadow。点光由场景rig单一拥有，组件不重复创建。无新增shadow map，无额外模型贴图或绘制实例；多四盏灯增加BRDF成本，未做FPS/VRAM/加载基准。

按完整场景真实Cycles64samples Metal重烘r37，OIDN降噪采用2026-10-29-practical-shell-r38。仅墙地面漫反射接收2K RGBM8新图，UV20832bytes/atlas16MiB预算保持，PNG2852348bytes/hash5d596e85b1fdbc810ff122123b2434b58a43756243d6185b46bec65347d735ae。家具及角色接受实时暖光、镜面/发光保留，烘焙墙地面漫反射不再重复加实时光。Blender的面积/点光和Three等效标定在阴影、点光半径/距离截断上有引擎差异，不声称逐像素相同。窗户仍为不透明装饰总成，无墙洞、室外、透射或bloom。

实际build/typecheck/lint与源代码/测试Prettier通过，全套node --test --test-concurrency=1 test/*.test.mjs为264pass/0fail。真实 ~/.dsh-test 总览/单间/本地角色与找食材/离屏重建结果见回执browser字段和截图，最终1canvas/0alert、冷刷新后warn/error0。测试服务启动保留当时已有额外测试patch，未改其文件或其他插件。阶段3其余壁钟法线/几何工作仍待后续，本轮为灯光增强；最终美术认可待用户。

回执sync/receipts/kitchen-lighting-2026-10-29-practicals-v1.json；证据sync/evidence/2026-10-29-kitchen-practicals/；可编辑主工程kitchen/lighting/lookdev/2026-10-29-practical-shell-r37/厨房_Cycles光照烘焙.blend，脚本归kitchen/lighting/scripts。Spec/Plan、双语README、光照规范、catalog与四组件HANDOFF双向对齐。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。http://127.0.0.1:3088/保留运行。
