# Session Office 最终验收版

用户2026-10-31覆盖旧workspace多厨房MVP：一个共享厨房展示所有最近原生会话；未读完成/运行/待交互会话各一位角色，上限4，列表不限4。状态优先待确认>活跃>未读>空闲；未读归DSH所有，打开Office不清除。排除归档/空白/子agent/仅catalog行。列表完整标题、workspace、状态、更新时间、cwd及ID，按更新时间降序；气泡常驻标题+workspace+状态，可原生导航。角色使用2026-10-29-face-blink-r2原交付，游走与状态独立，不恢复被用户否决的冰箱精修。

1. [x] 原生facts与四角色稳定投影，参照notification-bell成员/状态语义。
2. [x] 单场景全宽视图、常驻可点击气泡和最近会话完整列表。
3. [x] 四角色安全游走、独立骨骼/眨眼、减少动态和离屏释放。
4. [x] 角色交付采用、双向回执、双语README。
5. [x] 构建/类型/lint/状态及导航回归，~/.dsh-test内置浏览器验收。

保持plugin-only；复用当前用户授权的release工作区，不合并/rebase脏工作区，不commit/push/publish。原厨房几何布局与灯光保持。

## 当前采用：共享会话看板 / face-blink-r2 · 2026-10-31

用户覆盖旧workspace厨房设计：Office现在为单个全宽厨房+完整最近会话列表。来自DSH原生list.ids、workspace元数据和useSessionStatus；待交互>运行>未读完成>空闲，空白/归档/subagent/catalog-only行不加入列表，运行子代理汇总到列出的父会话。运行/待交互/未读各有角色资格，最多4位按ID保留槽位，超出计数与列表均保留。列表按updatedAt降序显示完整标题/workspace/状态/时间/已知cwd/ID；没有截为4条。关系缺失标未分组，不根据路径猜测管理关系。Office不retain、不读历史、不发模型请求、不管理第二份未读；原生未读是当前Client UI事实，刷新后的重置语义跟随DSH，不能以自己的缓存伪装未读。

用户明确采用character/deepseek/2026-10-29-face-blink-r2，SHA256 eea3bc03f99ea735948a8e33c108b3ae5eb2bbb860651d4bc217421a604bc003，7172924bytes/57002tri/31骨骼/4morph/3material/4image；源工程character/deepseek/rig/2026-10-29-face-blink-r2/鲸鱼娘_修型与独立眨眼.blend。原交付GLB逐字节复用，导入器规范化manifest格式但JSON内容一致，撤下运行时cel应用，后续anime-r1仅作ready历史，不默认采用。每角色独立skeleton/mixer/随机眨眼，场景显示比例.75，源尺寸未改。游走与会话状态独立，在固定通道内停留/转身/行走，目标预留与.75m中心间距，不是任意场景通用寻路。地毯表面站立Y.054m。真实网格通道节点及中间点完整旋转共168姿态通过；旧动态骨骼路线回归仍通过，不声称新四人游走每动画帧网格对网格完备验证。

气泡始终显示完整可访问title/workspace和右侧状态，视觉长标题省略但tooltip/下方列表完整；点击通过公开ctx.uiWorkspace.openSession导航，Office本身不写已读。互相靠近时标签错开并用线指向角色。下方列表独立于WebGL错误。空闲仍有一间空厨房；离线/断连撤下陈旧角色和列表；减少动态停止游走与眨眼，离屏释放。冰箱继续用户恢复的candy-r2、光照stove-refined-shell-r42、厨房布局/相机/暖光参数保持，不重烘动态人物到静态光图。

实际~/.dsh-test内置浏览器完成：223最近会话；5个待关注会话对应4角色/+1，原生running->completionUnread；点击未读气泡正确导航并由原生清已读；Standard-mode ask_user_question待回答入场，点击返回原生问题并完成回答。五条既有隔离QA会话仅执行sleep150/sleep120、无文件操作或子代理，全部已结束。最终刷新无warn/error，1canvas/0alert；列表离屏canvas0，回顶部重建；本地预览1/4人切换通过。最终内置浏览器停留明确标注的四人模拟供用户看效果，真实列表可一键返回，刷新后原生idle列表223条。

完整321tests/0fail/0skip；格式整理后22项核心回归通过，build/typecheck/lint/Prettier/workspace/patches通过。pnpm安装器曾重写无关锁内容，已用捕获副本哈希保护撤销自身副作用；最终锁文件仅新增Office UI Workspace导航依赖3行，其他package不动。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。回执sync/receipts/office-session-board-2026-10-31-v1.json，证据sync/evidence/2026-10-31-session-board/。技术验收通过，最终美术认可待用户；其他材质几何优化不冒充完成。

## 2026-10-31 用户补充：隐藏空闲会话

场景与下方列表统一仅展示运行、待确认/待回答/计划待审、未读完成会话；空闲行不展示。列表仍不受四角色上限限制，按更新时间降序保留完整身份信息。原生清已读或停止且无未读/待交互时，同步移除角色与列表行。顶部只显示一个活跃会话计数。此前包含全部空闲最近会话的说明和223行截图为历史。

### 空闲过滤补充验收 · 2026-10-31

统一投影 sessions 只返回 status 非 idle 的会话，场景资格、顶部计数与完整列表一致；活跃定义仍含运行、待交互及原生未读完成，列表不受四角色上限限制。清已读且无运行/待交互后行与角色同时退出。不修改DSH已读状态或查询历史。

实际重建Host/Client TypeScript与Client bundle、ESLint通过；node --test test/session-board.test.mjs test/native-slots.test.mjs test/runtime-demand.test.mjs 为22pass/0fail。真实 ~/.dsh-test 内置浏览器当前原生空闲：0行/0气泡/1canvas/0alert；本地模拟四状态：4行/4气泡；刷新后warn/error为空，最终返回真实Office页面。此前321项全套是上一轮历史结果，本轮没有重复全套素材测试。模型、灯光及布局未改，无需重烘。

回执 sync/receipts/office-session-board-2026-10-31-active-only-v1.json；证据 sync/evidence/2026-10-31-office-active-only/。plugin-only，无DSH源码、生产profile修改，无commit/push/publish。

## 2026-10-31 页面收敛（已验收）

用户指定标题“胡闹厨房”、品牌“DSH Office”并展示从package.json读取的小版本Tag；移除场景左下角色数量。底部只保留title/workspace，右侧运行显示旋转图标与执行时长，未读完成显示完成时间，待交互保持可辨状态。时间沿用notification-bell临时展示时钟：初始原生updatedAt，观察到运行结束用观察时刻；不读取历史、不伪造权威完成事件，不持久化。保留空闲过滤、4角色上限、原生导航和现有美术。

## 当前页面收敛验收 · 2026-10-31

标题为“胡闹厨房”，品牌保持“DSH Office”，小Tag从package.json版本自动构建注入（当前v0.1.0），不新增版本常量。就绪场景移除左下角色数/溢出角标，异常与连接中提示仍保留；顶部全量活跃计数不变。底部仅title/workspace，移除路径/ID/普通更新时间，行点击导航及完整可访问标题保持。运行右侧旋转指示与每秒执行时长；未读完成为勾形图标与完成时间，完整日期在提示与time.dateTime；待确认/待回答/计划待审仍显示状态。减少动态偏好停止旋转，页面隐藏时暂停展示计时器。

时间参考wt-worktree-0.1.20/feat-notification-bell的activityClocks：首次使用原生updatedAt，观察到running切换时采用观察时刻，新prompt更新时间增加会重置运行计时；相同状态和重命名不重置。未观察到结束的完成行使用原生更新时间作基准，不宣称精准Host完成时间，不retain或读取历史。缺失时间明确未知；显示时钟仅内存且已退出会话被清理。

实际Host/Client TypeScript构建、Client bundle、ESLint与格式通过；node --test test/session-board.test.mjs test/native-slots.test.mjs test/runtime-demand.test.mjs为25pass/0fail，涵盖状态切换/新运行/更新时间/缺失时间/未来时间/秒分小时及SSR紧凑字段。内置浏览器~/.dsh-test验证真实0活跃空态、四状态本地预览、旋转transform变化、执行时长推进、完成时间稳定、标题/版本/无角标、1canvas/0alert与刷新后无warn/error；本轮未启动新模型任务，真实原生running->unread导航属于前轮历史验证，勿冒充本轮重跑。

回执sync/receipts/office-session-board-2026-10-31-compact-ui-v1.json，证据sync/evidence/2026-10-31-office-compact-ui/。README截图明确为本地模拟，最终内置浏览器返回真实Office。模型/布局/灯光与面数无改动，不重烘；plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 2026-10-31 预览入口调整

移除页头本地预览/返回真实会话按钮，改为双击版本Tag切换；单击不触发，双击再次退出。Tag保持小标签外观，提示“双击切换本地预览”；模拟模式仍明确标注，1–4角色控制与模拟行禁止导航保留。其余会话规则、模型、灯光与布局不变。

### 版本Tag预览入口验收 · 2026-10-31

本地预览按钮已移除；版本Tag双击进入/退出，单击不切换。内置浏览器~/.dsh-test实际验证：页头0按钮、单击仍为真实会话、双击显示4个模拟角色与4行、再次双击退出；最终1canvas/0alert，刷新后无warn/error。Client构建/类型/lint/格式通过，25项相关回归通过。模型与灯光未变。回执sync/receipts/office-session-board-2026-10-31-preview-tag-v1.json，证据sync/evidence/2026-10-31-office-preview-tag/。plugin-only，无commit/push/publish。

## 蓝白条纹脚垫接入 · 2026-10-31（技术验收通过）

新增独立kitchen/floor-mat/2026-10-29-r1，原尺寸1.35×.77×.018m、1900tri、单批次/材质两图，不替换鲸鱼地毯。先以[1.4,.0255,-.37]/yaw0/scale1试摆冰箱前，按实际BVH审阅。既有家具/角色路线/站位/相机与practical-v2暖光冻结；薄垫是可走地面，原较高roaming支撑保持，低脚底接近垫边时按保守鞋底范围提升到垫最高面+1mm，非IK。完整静态依赖签名和墙地面光照重烘后才能接入测试验收；旧r38提示是历史，实际沿用当前r42基线。

## 蓝白条纹脚垫 · 2026-10-31（技术验收通过）

独立采用kitchen/floor-mat/2026-10-29-r1，原GLB 1427356bytes/hashc4c982fcbe133b70cb3e534bc5a2a66186f0ea3f1b06695289af9b37f035059f，1900tri/1mesh/1primitive/1material/两张1024嵌图。6000tri/4MiB独立上限，冰箱30k/8MiB预算不变。原织物roughness约.70、metallic0、normal.50、coat0与原几何/贴图保持；不替换鲸鱼地毯。最终Three位置[1.4,.0255,-.37]、yaw0、scale1，垫最高面Y.0435m，底面距地板约.5mm；既有家具、站位/路线、相机、暖光及全部既有模型文件不动。

薄垫为可走地面，不添加导航阻挡。kitchenActorGroundY按垫的半宽.675/半深.385加保守鞋底触及范围.35m提供最高面+1mm支撑；现有roaming根高.054m不降低，旧低脚底路径接近垫沿时整体抬高，程序白模另保留12mm起伏余量。这是防穿插支撑，不是逐足IK或精确踩踏形变，垫边有小幅保守提前抬高。真实骨骼角色冰箱往返/停留/转身/中断与四人通道网格回归均通过；当前共享会话UI不恢复历史的单间/找食材按钮，浏览器验证双人/四人游走，旧冰箱动作通过Node实际模型检查。

Blender全场BVH只有双墙41对历史拼角接触，无新增家具穿插。33实例/49primitive按现有r42几何基线和practical-v2灯位重新Cycles64sample CPU烘焙r47、OIDN为2026-10-31-floor-mat-shell-r48；仅三墙地面receiver、2K RGBM8、UV20832bytes与16MiB atlas预算保持。运行时家具仍PBR，新垫增加1900tri/一绘制批/两图及1.36MiB源数据，不宣称无性能成本。

实际build/TypeScript/lint/格式通过；全套330项首跑329通过，唯一失败为旧生产GLB数量28的断言；新增独立脚垫后门禁改为29并断言脚垫仅注册一次，该项单独重跑1pass/0fail。修改仅测试期待，不改产品或放宽JS/贴图预算，未重复四分钟全套。补充接触/runtime14项通过，初轮组件/角色几何92项通过。完整日志保留，不能将首跑描述为330项一次全绿。

真实~/.dsh-test内置浏览器查看新垫/暖光、双击Tag预览四人/双人、离开Office时canvas0、返回重建canvas1、0alert，最终刷新后无warn/error。最终留真实活跃会话页面，空闲0人仍显示完整厨房。回执sync/receipts/kitchen-floor-mat-2026-10-29-r1.json，证据sync/evidence/2026-10-31-floor-mat/。组件原delivery不改，ready指交付阶段，current采用以catalog和本回执为准；最终美术审阅待用户。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。
