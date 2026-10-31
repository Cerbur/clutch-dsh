import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as T from 'three';
import { geometryOnlyGlb } from '../scripts/export-lighting-geometry.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Models } from '../lib/client/scene/models.js';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
} from '../lib/office/kitchen-layout.js';

test('textured static stove retains worktop height, source capability limits and hood alignment', async () => {
  const roots = {};
  const owners = [];
  try {
    const manifest = JSON.parse(
      await readFile(new URL('../assets/models/kitchen/stove.manifest.json', import.meta.url)),
    );
    const refined = manifest.revision === '2026-10-29-refined-r1';
    for (const name of ['stove', 'range-hood']) {
      const bytes = await readFile(
        new URL(`../assets/models/kitchen/${name}.glb`, import.meta.url),
      );
      const owner = new Models();
      owners.push(owner);
      const { scene: root } = await new GLTFLoader().parseAsync(geometryOnlyGlb(bytes).buffer, '');
      owner.ownObject(root);
      root.position.set(...KITCHEN_PLACEMENT[name]);
      root.rotation.y = KITCHEN_ROTATION[name];
      root.scale.set(...(KITCHEN_SCALE[name] ?? [1, 1, 1]));
      root.updateMatrixWorld(true);
      roots[name] = root;
    }
    const stove = roots.stove;
    const hood = roots['range-hood'];
    assert.ok(
      Math.abs(
        stove.getObjectByName('work_surface').getWorldPosition(new T.Vector3()).y -
          0.9167539979934692,
      ) < 1e-4,
    );
    const burner = stove.getObjectByName('burner_left').getWorldPosition(new T.Vector3());
    const hobCenter = KITCHEN_PLACEMENT.stove[2] - (-0.6826309561729431 + 0.6916937828063965) / 2;
    const hoodBottom = hood.getObjectByName('hood_bottom').getWorldPosition(new T.Vector3());
    assert.ok(
      Math.abs(hobCenter - hoodBottom.z) < 1e-4,
      'hood centered over the complete hob plate, excluding side cupboards',
    );
    assert.ok(
      Math.abs(hoodBottom.y - 1.7251482009887695) < 1e-4,
      'installation height applied only once',
    );
    assert.ok(hoodBottom.y - burner.y > 0.79, 'hood clears burner and cookware');
    const hoodBounds = new T.Box3().setFromObject(hood, true);
    assert.ok(Math.abs(hoodBounds.max.z - hoodBounds.min.z - 1.3743247389793396) < 1e-5);
    assert.ok(stove.getObjectByName('灶台静态总成'));
    assert.ok(stove.getObjectByName('转角接缝台面'));
    if (refined) {
      assert.equal(stove.getObjectByName('烤箱烟色玻璃')?.isMesh, true);
      assert.equal(manifest.capabilities.staticAssembly, true);
      for (const capability of ['semanticHinges', 'animationClips', 'rigged', 'emissiveFlames'])
        assert.equal(manifest.capabilities[capability], false, capability);
    }
    for (const name of ['左柜门', '右柜门', '左抽屉', '右抽屉', '烤箱门', '蓝色火焰', '炒锅'])
      assert.equal(
        stove.getObjectByName(name),
        undefined,
        'new static source does not fake old capabilities',
      );
  } finally {
    for (const owner of owners) owner.dispose();
  }
});
