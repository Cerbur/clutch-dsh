# 阶段3A：烟机法线样板 · 2026-10-28

状态：诊断和独立样板完成，未交付采用，未部署到 ~/.dsh-test。正式场景仍为现有24源资产/25实例、r20光照。阶段3整体未完成。

## 固定条件与结果

使用正式range-hood r3，在相同正交机位、3个AREA灯、World .05、Neutral曝光0、Cycles 24采样/相同seed下渲染四份独立对照。

- baseline.png：烟囱正面与右侧有明显三角形明暗。
- no-normal-map.png：关闭Normal Map后仍有同类三角明暗，说明单独减弱贴图不能解决。
- weighted-normals.png：清理自定义分裂法线、平滑面并加面积加权法线后，三角明暗明显减轻，烟机罩反光仍连续。选作下一步采用候选。
- flat-face-normal.png：大平面改善，但倾斜罩面出现折面；不选用。

这些结果证明基础顶点/角点法线是本次异常的主要来源，不证明源贴图没有其他瑕疵。没有修改颜色或通过加灯掩盖缺陷。未新增倒角，已有轮廓先保留。

## 保护核验

Blender evaluated mesh核验：baseline与weighted-normals的顶点位置、UV、物体矩阵哈希相同，均28499三角形；角点法线哈希不同。详见素材库 kitchen/range-hood/lookdev/2026-10-28-s3a-diagnosis/protection-audit.json。正式GLB、光照和场景源码均与本轮起点哈希一致。

独立样板保存在weighted-normals.blend，仅供lookdev，不是deliveries版本。未进行最终GLB导出/字节预算审计，未生成新光照；不得把当前截图称为正式场景验收。

## 下一步顺序

1. 将烟机法线样板转为新的不可变交付revision；核验导出后的NORMAL/TANGENT、位置、UV、贴花、锚点、材质与预算。
2. 同时或随后局部修正壁钟表盘法线：现有平面部分顶点法线偏离面法线约43–56度；原色图可能仍有残留明暗，必须固定灯对照。
3. 吊柜暂不改：未发现同等级明确法线缺陷。不为扩大阶段3范围重做所有模型。
4. 采用任何源改动后，以真实新依赖重烘墙地光照，完成构建/检查和 ~/.dsh-test 实际验收再写采用回执。

技术依据：本轮四份Blender图、protection-audit.json；上一轮256tests为既有基线，本轮只做文档/lookdev，未重新运行该测试组。Blender诊断及保护审计脚本成功退出，git diff --check通过。

后续：样板已通过normal-r1/r22正式部署，见 [部署验收](KITCHEN-CANDY-S3A-VERIFICATION.md)。前文未部署为当时历史。
