# Kitchen 新组件与糖果感阶段2B验收

## 新组件与全场材质阶段2B · 技术验收通过 / 待用户视觉审阅

2026-10-28：完成两个新原件识别（877fc508为壁柜、d6351445为烟机）、source原件归档及r3独立静态交付。烟机仅按实测火灶平板1.374324739m宽对齐，排除两侧柜；source宽.910972118，场景localX scale1.508635348，中心WorldZ.636263588。保留加长灶台3.247m、L形薄收口、桌椅及角色站位。

窗户采用独立window/candy-r2，原尺寸1.049972×.743585×.260559m、scale1、位置[-.68,1.39,-1.808]。首轮穿插已修复，层架上移14cm至rootY.39以给窗留空间；吊柜[-2.113,1.86,-.7]，挂画[.9,2.79,-1.813]，吊灯[1.95,.6,-1.48]。真实Blender全场BVH只有双墙拼角41对接触，其余家具表面无相交；完整角色往返/中断/转身/减少动态路径测试通过。窗片不透明，无墙洞/透光/室外/开窗动画，也未新增窗光。

全场阶段2分材质推广：14个材质后代（含保留冰箱样板和字节不变地毯审查revision）独立核验所有accessor含COLOR、geometry/UV/节点/材质分配、原baseColor字节保持。新烟机/吊柜是用户授权的几何替换。木、布、金属、叶、食物、皮肤眼睛和图案保护；地板、双墙与已采用冻结GLB逐字节一致。最终26材质/34primitive/47图片，未增加任一既有组件的材质/图片/批次。原色图烘焙明暗、局部三角棱角仍在，第三步几何修形未做。

19实例/34primitive按冻结三AREA、World.05、相机/曝光真实Cycles64sample Metal烘焙r17、OIDN为r18，运行时s1环境/第四前面光保持。仅三墙地接收者2K RGBM8，atlas2709174bytes、UV20832bytes、RGBA16MiB；源GLB42809224bytes(40.83MiB)，Client2004019bytes。二进制白名单按需加载、1024模型贴图、PMREM128、空房按需/角色30FPS、离屏释放保持。新增Physical响应有shader成本，未测FPS/加载耗时，不宣称性能零成本。

实际命令：pnpm --filter @cerbur/clutch-dsh-office build/typecheck/lint；node --test --test-concurrency=1 test/*.test.mjs（235passed/0failed）；pnpm run check:workspace、check:patches（通过，保留既有!!js YAML警告）、git diff --check。材质独立审计与两位只读集成复核无阻断问题。真实~/.dsh-test已安装、重启3088：5空房、单间、双角色气泡、走到冰箱及返回、末间与首间离屏重建通过；最终1canvas/0alert，冷刷新后12:03UTC起warn/error为0。服务重启前旧HMR多Three与连接中断日志为历史，未算成冷加载结果。OS减少动态未手动切换，自动路径/生命周期测试通过。

回执 `sync/receipts/kitchen-candy-s2b-2026-10-28.json`；证据 `sync/evidence/2026-10-28-kitchen-candy-s2b/`；全场验证工程 `kitchen/lighting/lookdev/2026-10-28-kitchen-candy-layout/厨房_最终材质场景验证.blend`。Spec/Plan、美术语言/JSON、光照规范、catalog和各组件HANDOFF已双向同步。阶段2B技术通过与用户视觉认可分开，最终美术批准待用户；阶段3未开始。全程plugin-only，主checkout和DSH源码干净；工作在既有dirty release，不commit/push/publish，不改生产profile。http://127.0.0.1:3088/保留供查看。

## 采用资产

- `character/deepseek` · `2026-10-28-candy-r1` · `0cfeed80dcc1734cbb5f3a334d7785c9dfd97de713371683ec57985740663535`
- `kitchen/stove` · `2026-10-28-candy-r1` · `b97069a377a6e1246b587158c45a32ed4a3faa770807afde11ac4c842ec004de`
- `kitchen/right-wall` · `2026-10-27-r3` · `7a4cd1f93ee2ddef33328f2805614d08166d28924807a4acf4459682ea28b1f5`
- `kitchen/wall-art` · `2026-10-28-candy-r1` · `1ae5f88bd832a03829685ee05d9a028c50230bc455a4dd78e9a8a4b30149145d`
- `kitchen/table` · `2026-10-28-candy-r1` · `27f4c21585f3114ac6211be996f149a06c72ecae936637753b42a11591fee290`
- `kitchen/floor` · `2026-10-27-r2` · `4c4044eead24f761e41ea65c4112c49459b884737e6b367619931d9a87aac006`
- `kitchen/left-wall` · `2026-10-27-r4` · `a41c9d34da7460c1a4d4da7d7af4665c563bb7828c7aa0753930f8ee4263365b`
- `kitchen/trash-can` · `2026-10-28-candy-r1` · `9a24be020e981a3df752a7ab72c8202d10c5dd1d3edc193c7d58464e49cf2401`
- `kitchen/wall-cabinet` · `2026-10-28-r3` · `480782fd3883df8e248d6277964450bb8bed78f45064b8b90697fc1a8888309c`
- `kitchen/rug` · `2026-10-28-candy-r1` · `8fe26d0aa137f095a0f52a4d0388fedf9f2bb84a92d5456d6c294f9ca87dc235`
- `kitchen/chair` · `2026-10-28-candy-r1` · `0de38d12fb92007c962a972ec7a5be2caa09118e0023e1ab0f8fdc7419aee1ba`
- `kitchen/utensil-rail` · `2026-10-28-candy-r1` · `585846f480de89c41a5e44d00e2553559ba387b92d267eb2def843e9a00802ed`
- `kitchen/range-hood` · `2026-10-28-r3` · `4fcc05cf0604169f4d12f7be0182b05271b6c31a7f416e9d4c13bbea9366b5a5`
- `kitchen/storage-cabinet` · `2026-10-28-candy-r1` · `d6ee04d7c0b7676b7bf38ba51123771af04711c2663c104d2d40d3a1db4a6e64`
- `kitchen/pendant-light` · `2026-10-28-candy-r1` · `ad416bd4fbcc532c42769524c13491192d2a64600b32ece6d8f419af0c59b353`
- `kitchen/refrigerator` · `2026-10-28-candy-r2` · `250242b0f81f83e1efbf1ac82f686eb464dfcba89b0ed2ff13138bda49e6b6c4`
- `kitchen/wall-shelf` · `2026-10-28-candy-r1` · `4be2626ad122877997e60576552e0bcda2538744528f9184fc2607dae026cee5`
- `kitchen/sink-cabinet` · `2026-10-28-candy-r1` · `4a481ac8d4659c601b829475558e3178a1d3f2ee5ca7f2a073a73129138ae2f0`
- `kitchen/window` · `2026-10-28-candy-r2` · `c9b8eef09df5d96654ba0fa9a53096cc4371bd521052041ed1fca52b0c39e035`
