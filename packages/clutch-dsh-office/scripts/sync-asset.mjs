import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { Box3, Object3D, Vector3, Matrix4 } from 'three';

const MIB = 1024 * 1024;
export const ASSET_RULES = {
  'kitchen/floor': {
    file: 'floor.glb',
    triangles: 5000,
    bytes: 6 * MIB,
    materials: 2,
    primitives: 2,
    origin: 'floor-surface-center',
    nodes: ['厨房底板', '圆角木框', '瓷砖地面', 'floor_surface', 'front_anchor'],
  },
  'kitchen/stove': {
    file: 'stove.glb',
    triangles: 40000,
    bytes: 4 * MIB,
    materials: 5,
    primitives: 20,
    nodes: [
      '灶台总成',
      '柜体',
      '台面',
      '左柜门',
      '右柜门',
      '左抽屉',
      '右抽屉',
      '烤箱门',
      '烤箱控制面板',
      '双眼灶',
      '蓝色火焰',
      '炒锅总成',
      '炒锅',
      '锅内食材',
      '油瓶与调味瓶',
      'work_surface',
      'cook_anchor',
      'burner_left',
      'burner_right',
      'front_anchor',
    ],
    revisions: {
      '2026-10-28-candy-r1': {
        materials: 2,
        primitives: 2,
        meshes: 2,
        images: 3,
        nodes: [
          '灶台总成',
          '灶台静态总成',
          'work_surface',
          'cook_anchor',
          'burner_left',
          'burner_right',
          'front_anchor',
          'join_right',
          'counter_back_left',
          'counter_front_left',
          '转角接缝台面',
        ],
      },
      '2026-10-28-r6': {
        materials: 2,
        primitives: 2,
        meshes: 2,
        images: 3,
        nodes: [
          '灶台总成',
          '灶台静态总成',
          'work_surface',
          'cook_anchor',
          'burner_left',
          'burner_right',
          'front_anchor',
          'join_right',
          'counter_back_left',
          'counter_front_left',
          '转角接缝台面',
        ],
      },
    },
  },
  'kitchen/wall-cabinet': {
    file: 'wall-cabinet.glb',
    triangles: 10000,
    bytes: 2 * MIB,
    materials: 3,
    primitives: 10,
    origin: 'cabinet-bottom-center',
    nodes: [
      '蓝色壁柜',
      '内层板',
      '右侧板',
      '右门轴',
      '右柜门',
      '右柜门把手',
      '左侧板',
      '左门轴',
      '左柜门',
      '左柜门把手',
      '底板',
      '背板',
      '顶板',
    ],
    revisions: {
      '2026-10-28-r3': {
        triangles: 10000,
        bytes: 2097152,
        materials: 1,
        primitives: 1,
        meshes: 1,
        images: 3,
        nodes: ['蓝色壁柜', '壁柜静态总成', 'front_anchor', 'mount_rear', 'cabinet_bottom'],
      },
    },
  },
  'kitchen/range-hood': {
    file: 'range-hood.glb',
    triangles: 20000,
    bytes: 2 * MIB,
    materials: 7,
    primitives: 20,
    origin: 'floor projection of hood center; installed height already modeled',
    nodes: [
      '抽油烟机',
      '排烟罩',
      '斜面罩',
      '控制面板',
      '滤网底板',
      '滤网格栅',
      '照明灯',
      'hood_bottom',
      'mount_rear',
      '鲸鱼徽章',
    ],
    revisions: {
      '2026-10-28-normal-r1': {
        triangles: 30000,
        bytes: 4194304,
        materials: 1,
        primitives: 1,
        meshes: 1,
        images: 3,
        nodes: ['抽油烟机', '烟机静态总成', 'front_anchor', 'mount_rear', 'hood_bottom'],
      },
      '2026-10-28-r3': {
        triangles: 30000,
        bytes: 4194304,
        materials: 1,
        primitives: 1,
        meshes: 1,
        images: 3,
        nodes: ['抽油烟机', '烟机静态总成', 'front_anchor', 'mount_rear', 'hood_bottom'],
      },
    },
  },

  'kitchen/utensil-rail': {
    file: 'utensil-rail.glb',
    triangles: 20000,
    bytes: 1 * MIB,
    materials: 4,
    primitives: 4,
    origin: 'wall-plane-center-at-rail-axis',
    nodes: ['UtensilRail', '挂钩杆', '锅铲', '汤勺', '漏勺', 'wall_anchor'],
  },
  'kitchen/refrigerator': {
    file: 'refrigerator.glb',
    triangles: 30000,
    bytes: 8 * MIB,
    nodes: ['中文冰箱', '箱体', '上门', '下门'],
  },
  'kitchen/trash-can': {
    file: 'trash-can.glb',
    triangles: 20000,
    bytes: 2 * MIB,
    materials: 3,
    primitives: 6,
    meshes: 3,
    images: 0,
    nodes: ['垃圾桶', '桶身', '桶盖', '踏板'],
  },
  'kitchen/wall-shelf': {
    file: 'wall-shelf.glb',
    triangles: 55000,
    bytes: 8 * MIB,
    materials: 1,
    primitives: 1,
    origin: 'wall-rear-envelope-ground-projection',
    nodes: [
      '厨房置物架',
      '置物架_用户新原件完整网格',
      'wall_anchor',
      'top_shelf_surface',
      'lower_shelf_surface',
    ],
  },
  'kitchen/whale-mitt': {
    file: 'whale-mitt.glb',
    triangles: 10000,
    bytes: 3145728,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 3,
    origin: 'wall-plane-bottom-center',
    nodes: ['鲸鱼隔热垫挂件', '鲸鱼隔热垫静态总成', 'wall_anchor', 'front_anchor'],
  },
  'kitchen/wall-clock': {
    file: 'wall-clock.glb',
    triangles: 10000,
    bytes: 3145728,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 3,
    origin: 'wall-plane-bottom-center',
    nodes: ['鲸鱼木质壁钟', '鲸鱼壁钟静态总成', 'wall_anchor', 'front_anchor'],
  },
  'kitchen/board-cloth': {
    file: 'board-cloth.glb',
    triangles: 15000,
    bytes: 3145728,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 3,
    origin: 'wall-plane-bottom-center',
    nodes: ['board-cloth', 'board_cloth_mesh', 'wall_anchor', 'front_anchor', 'hang_anchor'],
  },
  'kitchen/wall-plant': {
    file: 'wall-plant.glb',
    triangles: 12000,
    bytes: 3145728,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 3,
    origin: 'wall-plane-bottom-center',
    nodes: ['wall-plant', 'wall_plant_mesh', 'wall_anchor', 'plant_anchor', 'front_anchor'],
  },
  'kitchen/wall-calendar': {
    file: 'wall-calendar.glb',
    triangles: 15000,
    bytes: 3145728,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 3,
    origin: 'wall-plane-bottom-center',
    nodes: ['wall-calendar', 'wall_calendar_mesh', 'wall_anchor', 'front_anchor', 'hang_anchor'],
  },
  'kitchen/window': {
    file: 'window.glb',
    triangles: 30000,
    bytes: 4 * MIB,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 3,
    origin: 'wall-plane-bottom-center',
    nodes: ['窗户', '窗户_用户原件静态总成'],
  },
  'kitchen/wall-art': {
    file: 'wall-art.glb',
    triangles: 16000,
    bytes: 2 * MIB,
    materials: 1,
    primitives: 1,
    origin: 'wall-plane-center',
    nodes: ['鲸鱼挂画', '画框与鲸鱼浮雕', 'wall_anchor', 'front_anchor'],
  },
  'kitchen/chair': {
    file: 'chair.glb',
    triangles: 20000,
    bytes: 4 * MIB,
    materials: 1,
    primitives: 1,
    origin: 'floor-center',
    nodes: ['chair', 'chair_mesh', 'seat_surface'],
  },
  'kitchen/rug': {
    file: 'rug.glb',
    triangles: 6000,
    bytes: 4 * MIB,
    materials: 1,
    primitives: 1,
    origin: 'floor-center',
    nodes: ['鲸鱼地毯', '地毯本体', 'rug_surface'],
  },
  'kitchen/table': {
    file: 'table.glb',
    triangles: 60000,
    bytes: 8 * MIB,
    materials: 1,
    nodes: ['table', 'table_mesh', 'work_surface', 'prep_anchor'],
  },
  'kitchen/storage-cabinet': {
    file: 'storage-cabinet.glb',
    triangles: 30000,
    bytes: 8 * MIB,
    materials: 1,
    nodes: [
      '置物柜',
      '柜架与层板',
      '下层收纳筐与食材',
      '中层蔬菜托盘',
      '台面调料与盆栽',
      '脚轮_左前',
      '脚轮_左后',
      '脚轮_右前',
      '脚轮_右后',
    ],
    revisions: {
      '2026-10-28-candy-r1': {
        primitives: 1,
        meshes: 1,
        nodes: ['置物柜', '置物柜_用户原件静态总成'],
      },
      '2026-10-28-r1': {
        primitives: 1,
        meshes: 1,
        nodes: ['置物柜', '置物柜_用户原件静态总成'],
      },
    },
  },
  'kitchen/left-wall': {
    file: 'left-wall.glb',
    triangles: 10000,
    bytes: 1 * MIB,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 0,
    // Rounded single-panel revision replaces the former independent trim nodes.
    nodes: ['left-wall', 'wall_panel', 'front_anchor'],
  },
  'kitchen/right-wall': {
    file: 'right-wall.glb',
    triangles: 10000,
    bytes: 1 * MIB,
    materials: 1,
    primitives: 1,
    meshes: 1,
    images: 0,
    nodes: ['right-wall', 'wall_panel', 'front_anchor'],
  },
  'kitchen/pendant-light': {
    file: 'pendant-light.glb',
    triangles: 20000,
    bytes: 4 * MIB,
    materials: 1,
    primitives: 2,
    nodes: [
      'pendant-light',
      'hanging_assembly',
      'ceiling_mount',
      'whale_shade',
      'suspension',
      'light_anchor',
    ],
  },
  'kitchen/sink-cabinet': {
    file: 'sink-cabinet.glb',
    triangles: 40000,
    bytes: 8 * MIB,
    materials: 1,
    primitives: 8,
    nodes: [
      '水槽柜',
      '柜体',
      '台面与挡水板',
      '水槽与龙头',
      '砧板与蔬菜',
      '左柜门',
      '右柜门',
      '侧柜门',
      '抽屉',
      'work_surface',
      'wash_anchor',
      'prep_anchor',
    ],
    revisions: {
      '2026-10-28-candy-r1': {
        primitives: 1,
        nodes: ['水槽柜', '水槽柜静态总成', 'work_surface', 'wash_anchor', 'prep_anchor'],
      },
      '2026-10-27-r2': {
        primitives: 1,
        nodes: ['水槽柜', '水槽柜静态总成', 'work_surface', 'wash_anchor', 'prep_anchor'],
      },
    },
  },
  'character/deepseek': {
    file: 'deepseek.glb',
    triangles: 60000,
    bytes: 8 * MIB,
    materials: 1,
    primitives: 1,
    origin: 'feet-ground-center',
    nodes: [
      'deepseek',
      'body',
      'deepseek_mesh',
      'nameplate_anchor',
      'look_anchor',
      'forward_anchor',
    ],
  },
};

export function inspectGlb(bytes) {
  if (
    bytes.length < 28 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length ||
    bytes.readUInt32LE(16) !== 0x4e4f534a
  )
    throw new Error('Invalid GLB 2 container');
  const size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size).toString('utf8'));
  if (
    doc.buffers?.some((value) => value.uri) ||
    doc.images?.some((value) => !Number.isInteger(value.bufferView))
  )
    throw new Error('Delivery must contain only embedded buffers and images');
  if (doc.cameras?.length || doc.extensions?.KHR_lights_punctual)
    throw new Error('Remove studio cameras/lights');
  if (doc.extensionsRequired?.length)
    throw new Error('Compressed/required extensions need a separate integration');
  const primitives = doc.meshes.flatMap((mesh) => mesh.primitives);
  if (
    primitives.some(
      (p) => (p.mode ?? 4) !== 4 || p.attributes.NORMAL === undefined || p.indices === undefined,
    )
  )
    throw new Error('Expected indexed triangles with normals');
  const triangles = primitives.reduce((sum, p) => sum + doc.accessors[p.indices].count / 3, 0);
  const binHeader = 20 + size;
  if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error('Missing GLB binary chunk');
  const binStart = binHeader + 8;
  // Measure final vertex bytes through the scene transforms, not merely declared extrema.
  const objects = doc.nodes.map((node) => {
    const object = new Object3D();
    if (node.matrix) object.applyMatrix4(new Matrix4().fromArray(node.matrix));
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  doc.nodes.forEach((node, i) =>
    (node.children ?? []).forEach((child) => objects[i].add(objects[child])),
  );
  const scene = new Object3D();
  doc.scenes[doc.scene ?? 0].nodes.forEach((i) => scene.add(objects[i]));
  scene.updateMatrixWorld(true);
  const bounds = new Box3();
  const point = new Vector3();
  for (let i = 0; i < doc.nodes.length; i++) {
    const node = doc.nodes[i];
    if (node.mesh === undefined) continue;
    for (const primitive of doc.meshes[node.mesh].primitives) {
      const accessor = doc.accessors[primitive.attributes.POSITION];
      if (accessor.type !== 'VEC3' || accessor.componentType !== 5126 || accessor.sparse)
        throw new Error('Expected dense float32 positions');
      const view = doc.bufferViews[accessor.bufferView];
      const start = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const stride = view.byteStride ?? 12;
      for (let j = 0; j < accessor.count; j++) {
        const offset = start + j * stride;
        point.set(
          bytes.readFloatLE(offset),
          bytes.readFloatLE(offset + 4),
          bytes.readFloatLE(offset + 8),
        );
        if (!point.toArray().every(Number.isFinite)) throw new Error('Non-finite GLB geometry');
        bounds.expandByPoint(point.applyMatrix4(objects[i].matrixWorld));
      }
    }
  }
  const size3 = bounds.getSize(new Vector3());
  return {
    triangles,
    primitives: primitives.length,
    meshes: doc.meshes.length,
    materials: doc.materials?.length ?? 0,
    images: doc.images?.length ?? 0,
    nodes: doc.nodes.map((node) => node.name),
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    dimensions: { width: size3.x, height: size3.y, depth: size3.z },
    nodePositions: Object.fromEntries(
      doc.nodes.map((node, i) => [node.name, objects[i].getWorldPosition(new Vector3()).toArray()]),
    ),
  };
}

export function validateAsset(manifest, bytes) {
  const baseRule = ASSET_RULES[manifest.assetId];
  const rule = baseRule && { ...baseRule, ...baseRule.revisions?.[manifest.revision] };
  const origin = rule?.origin ?? 'floor-center';
  if (
    manifest.schemaVersion !== 1 ||
    !rule ||
    manifest.status !== 'ready' ||
    manifest.file !== rule.file ||
    manifest.coordinates?.up !== '+Y' ||
    manifest.coordinates?.forward !== '+Z' ||
    manifest.coordinates?.unit !== 'meter' ||
    manifest.coordinates?.origin !== origin
  )
    throw new Error('Unsupported asset delivery contract');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== manifest.sha256) throw new Error('GLB hash does not match the delivery manifest');
  const facts = inspectGlb(bytes);
  for (const key of ['triangles', 'primitives', 'meshes', 'materials', 'images']) {
    if (manifest.geometry[key] === undefined) continue;
    if (facts[key] !== manifest.geometry[key]) throw new Error(`GLB ${key} differs from manifest`);
  }
  if (manifest.bytes !== undefined && manifest.bytes !== bytes.length)
    throw new Error('GLB byte size differs from manifest');
  const budget = manifest.budgets ?? manifest.budget ?? {};
  if (
    facts.triangles > Math.min(rule.triangles, budget.triangles ?? rule.triangles) ||
    bytes.length > Math.min(rule.bytes, budget.bytes ?? rule.bytes) ||
    (rule.materials !== undefined && facts.materials > rule.materials) ||
    (rule.primitives !== undefined && facts.primitives > rule.primitives) ||
    (rule.meshes !== undefined && facts.meshes > rule.meshes) ||
    (rule.images !== undefined && facts.images > rule.images)
  )
    throw new Error(`${manifest.assetId} budget exceeded`);
  for (const name of new Set([...rule.nodes, ...(manifest.requiredNodes ?? [])])) {
    if (!facts.nodes.includes(name)) throw new Error(`Missing required node: ${name}`);
  }
  const close = (actual, expected, label) => {
    if (!Number.isFinite(expected) || Math.abs(actual - expected) > 0.0001)
      throw new Error(`GLB ${label} differs from manifest`);
  };
  for (const side of ['min', 'max']) {
    if (!manifest.bounds?.[side] || manifest.bounds[side].length !== 3)
      throw new Error('Missing delivery bounds');
    facts.bounds[side].forEach((value, i) =>
      close(value, manifest.bounds[side][i], `bounds.${side}.${i}`),
    );
  }
  if (manifest.dimensions) {
    for (const key of ['width', 'height', 'depth'])
      close(facts.dimensions[key], manifest.dimensions[key], `dimensions.${key}`);
  }
  for (const [node, expected] of Object.entries(manifest.anchors ?? {})) {
    if (!facts.nodePositions[node]) throw new Error(`Missing anchor: ${node}`);
    facts.nodePositions[node].forEach((value, i) =>
      close(value, expected[i], `anchor.${node}.${i}`),
    );
  }
  return { assetId: manifest.assetId, revision: manifest.revision, sha256: hash, ...facts };
}

export async function syncAsset(manifestPath, output) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const rule = ASSET_RULES[manifest.assetId];
  if (!rule || manifest.file !== rule.file) throw new Error('Unsupported asset delivery contract');
  const bytes = await readFile(join(dirname(manifestPath), rule.file));
  const result = validateAsset(manifest, bytes);
  const stem = rule.file.slice(0, -4);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${stem}.glb.next`), bytes);
  await writeFile(
    join(output, `${stem}.manifest.json.next`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await rename(join(output, `${stem}.glb.next`), join(output, `${stem}.glb`));
  await rename(join(output, `${stem}.manifest.json.next`), join(output, `${stem}.manifest.json`));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input)
    throw new Error('Usage: node scripts/sync-asset.mjs /absolute/delivery/manifest.json');
  const manifestPath = resolve(input);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  const assetDirectory = manifest.assetId.split('/').slice(0, -1);
  const output = join(packageRoot, 'assets', 'models', ...assetDirectory);
  process.stdout.write(JSON.stringify(await syncAsset(manifestPath, output), null, 2) + '\n');
}
