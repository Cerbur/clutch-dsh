# 共享会话看板实际验证

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

## 当前页面收敛验收 · 2026-10-31

标题为“胡闹厨房”，品牌保持“DSH Office”，小Tag从package.json版本自动构建注入（当前v0.1.0），不新增版本常量。就绪场景移除左下角色数/溢出角标，异常与连接中提示仍保留；顶部全量活跃计数不变。底部仅title/workspace，移除路径/ID/普通更新时间，行点击导航及完整可访问标题保持。运行右侧旋转指示与每秒执行时长；未读完成为勾形图标与完成时间，完整日期在提示与time.dateTime；待确认/待回答/计划待审仍显示状态。减少动态偏好停止旋转，页面隐藏时暂停展示计时器。

时间参考wt-worktree-0.1.20/feat-notification-bell的activityClocks：首次使用原生updatedAt，观察到running切换时采用观察时刻，新prompt更新时间增加会重置运行计时；相同状态和重命名不重置。未观察到结束的完成行使用原生更新时间作基准，不宣称精准Host完成时间，不retain或读取历史。缺失时间明确未知；显示时钟仅内存且已退出会话被清理。

实际Host/Client TypeScript构建、Client bundle、ESLint与格式通过；node --test test/session-board.test.mjs test/native-slots.test.mjs test/runtime-demand.test.mjs为25pass/0fail，涵盖状态切换/新运行/更新时间/缺失时间/未来时间/秒分小时及SSR紧凑字段。内置浏览器~/.dsh-test验证真实0活跃空态、四状态本地预览、旋转transform变化、执行时长推进、完成时间稳定、标题/版本/无角标、1canvas/0alert与刷新后无warn/error；本轮未启动新模型任务，真实原生running->unread导航属于前轮历史验证，勿冒充本轮重跑。

回执sync/receipts/office-session-board-2026-10-31-compact-ui-v1.json，证据sync/evidence/2026-10-31-office-compact-ui/。README截图明确为本地模拟，最终内置浏览器返回真实Office。模型/布局/灯光与面数无改动，不重烘；plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

### 版本Tag预览入口验收 · 2026-10-31

本地预览按钮已移除；版本Tag双击进入/退出，单击不切换。内置浏览器~/.dsh-test实际验证：页头0按钮、单击仍为真实会话、双击显示4个模拟角色与4行、再次双击退出；最终1canvas/0alert，刷新后无warn/error。Client构建/类型/lint/格式通过，25项相关回归通过。模型与灯光未变。回执sync/receipts/office-session-board-2026-10-31-preview-tag-v1.json，证据sync/evidence/2026-10-31-office-preview-tag/。plugin-only，无commit/push/publish。
