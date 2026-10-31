# 烟机法线样板部署验收

## 阶段3A烟机样板已部署 · 2026-10-28

用户授权部署后，采用range-hood/2026-10-28-normal-r1，sha256 edf10b059844b8fd0d6f973ea442d3994c4757baf68f8ab3919c5e3c5e47eb7c，2700820bytes/28499三角形。只更新原NORMAL二进制区间，JSON和全部非NORMAL字节（位置、UV、索引、材质、3张1024图片、节点锚点）保持r3原字节。24033顶点精确映射，3个角点分裂冲突按相邻面面积折中，以保留索引；最大小区域误差3.92958°已明确记录。没有新增倒角、拓扑或材质批次。

实际最终GLB已独立Blender回导、CPU固定灯渲染，并经过独立只读字节/法线复核。烟囱三角明暗明显减轻，原图集光影、边缝和细节瑕疵仍在，不声称全部模型精修完成。其他23件源GLB和manifest、布局、路径、相机、灯光参数及runtime s1环境不改。

按完整25实例/40primitive新来源实际Cycles64sample Metal重烘r21，OIDN为2026-10-28-normal-shell-r22。2K RGBM8、PNG2880121bytes、UV20832bytes与16MiB预算保持；来源hash/Three几何签名校验通过，不套用旧光图。新增revision导入白名单保留r3与旧烟机、冰箱等独立约束。

实际build、typecheck、lint、workspace/patches、sync-asset Prettier及git diff --check通过；node --test --test-concurrency=1 test/*.test.mjs为256pass/0fail。已重启明确使用DSH_HOME=/Users/yuancheng/.dsh-test的3088测试服务，真实页面查看5空房、单间、双角色气泡、冰箱到达/回程、末间和首间重建，最终1canvas/0alert，冷加载后warn/error0。未手动切换OS减少动态，自动运动/生命周期测试通过；未做FPS/VRAM/加载时间基准。

回执sync/receipts/kitchen-range-hood-2026-10-28-normal-r1.json；实际截图和日志sync/evidence/2026-10-28-kitchen-candy-s3a/。catalog/HANDOFF/Spec/Plan已双向同步，accepted表示技术验收，最终视觉批准待用户。阶段3A烟机正式部署完成；壁钟局部法线和其余有证据的轮廓修正尚待后续，不把阶段3整体勾为完成。全程plugin-only，不改DSH源码或生产profile，不commit/push/publish。服务http://127.0.0.1:3088/保留供查看。
