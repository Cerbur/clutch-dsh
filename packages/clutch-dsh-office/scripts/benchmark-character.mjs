import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import ts from 'typescript';
import sharp from 'sharp';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Models } from '../lib/client/scene/models.js';
import { createCharacterTemplate } from '../lib/client/scene/character/template.js';
import { createCharacterAnimation } from '../lib/client/scene/character/animation.js';
import { geometryOnlyGlb } from './export-lighting-geometry.mjs';
import { validateAsset } from './sync-asset.mjs';

// CPU-only probe: real skin/morph/clip data, no image decode, renderer or GPU timing.
// Optional baseline is an animation.ts captured from the revision being compared.
const [baselinePath, outputPath] = process.argv.slice(2);
const bytes = await readFile(new URL('../assets/models/character/deepseek.glb', import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL('../assets/models/character/deepseek.manifest.json', import.meta.url)),
);
validateAsset(manifest, bytes);
const size = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, 20 + size));
const binary = bytes.subarray(28 + size);
const stripped = geometryOnlyGlb(bytes);
const parsed = await new GLTFLoader().parseAsync(
  stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
  '',
);
const room = new Models();
const template = createCharacterTemplate(room, async () => parsed);
async function actors(factory) {
  return Promise.all(
    Array.from({ length: 4 }, async (_, seat) => {
      const owner = new Models(() => {}, true);
      const { scene, animations } = await template.instantiate(owner);
      const animation = factory(scene, animations, () => seat / 3);
      assert.ok(animation);
      owner.onDispose(() => animation.dispose());
      const meshes = [];
      scene.traverse((o) => {
        if (o instanceof T.SkinnedMesh) meshes.push(o);
      });
      return { owner, scene, meshes, animation };
    }),
  );
}
const modes = {
  idle: [1 / 30, 0, false, false],
  walk: [1 / 30, 0.48, false, false],
  search: [1 / 30, 0, false, true],
  reducedMotion: [1 / 30, 0.48, true, true],
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function measure(factory) {
  const group = await actors(factory);
  const update = (args) => {
    for (const a of group) a.animation.update(...args);
  };
  const timings = {};
  for (const [mode, args] of Object.entries(modes)) {
    for (let i = 0; i < 120; i++) update(args);
    const samples = [];
    for (let run = 0; run < 7; run++) {
      const start = performance.now();
      for (let frame = 0; frame < 300; frame++) update(args);
      samples.push((performance.now() - start) / 300);
    }
    timings[mode] = { medianMsPerFourActorUpdate: median(samples), samples };
  }
  group.forEach((a) => a.owner.dispose());
  // Count work separately, so the timing samples above do not include wrappers.
  let probes = 0;
  const original = T.SkinnedMesh.prototype.getVertexPosition;
  T.SkinnedMesh.prototype.getVertexPosition = function (...args) {
    probes++;
    return original.apply(this, args);
  };
  try {
    const counted = await actors(factory);
    timings.initializationVertexProbesFourActors = probes;
    timings.vertexProbesPerFourActorUpdate = {};
    for (const [mode, args] of Object.entries(modes)) {
      for (let i = 0; i < 30; i++) for (const a of counted) a.animation.update(...args);
      probes = 0;
      for (const a of counted) a.animation.update(...args);
      timings.vertexProbesPerFourActorUpdate[mode] = probes;
    }
    counted.forEach((a) => a.owner.dispose());
  } finally {
    T.SkinnedMesh.prototype.getVertexPosition = original;
  }
  return timings;
}
function snapshot(actor) {
  actor.scene.updateMatrixWorld(true);
  return [
    actor.scene.position.y,
    ...actor.meshes.flatMap((mesh) => [
      ...mesh.morphTargetInfluences,
      ...mesh.skeleton.bones.flatMap((bone) => bone.matrixWorld.elements),
    ]),
  ];
}
async function compare(baseline) {
  const before = await actors(baseline),
    after = await actors(createCharacterAnimation);
  let maxError = 0,
    valuesCompared = 0;
  const sequence = [
    modes.idle,
    modes.walk,
    modes.idle,
    modes.search,
    modes.walk,
    [1 / 30, -0.48, false, false],
    modes.reducedMotion,
    modes.idle,
  ];
  for (const args of sequence) {
    for (let frame = 0; frame < 120; frame++) {
      for (let seat = 0; seat < 4; seat++) {
        before[seat].animation.update(...args);
        after[seat].animation.update(...args);
        const a = snapshot(before[seat]),
          b = snapshot(after[seat]);
        assert.equal(a.length, b.length);
        for (let i = 0; i < a.length; i++) maxError = Math.max(maxError, Math.abs(a[i] - b[i]));
        valuesCompared += a.length;
      }
    }
    if (args === modes.reducedMotion) {
      before.forEach((a) => a.animation.pause());
      after.forEach((a) => a.animation.pause());
    }
  }
  before.concat(after).forEach((a) => a.owner.dispose());
  assert.ok(maxError < 1e-10, `Pose regression: ${maxError}`);
  return {
    framesPerActor: sequence.length * 120,
    actors: 4,
    valuesCompared,
    maxError,
    tolerance: 1e-10,
  };
}
let baseline;
if (baselinePath) {
  const source = (await readFile(baselinePath, 'utf8'))
    .replace("from 'three'", `from '${import.meta.resolve('three')}'`)
    .replace(
      "from './search-clip.js'",
      `from '${new URL('../lib/client/scene/character/search-clip.js', import.meta.url)}'`,
    );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  baseline = (
    await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
  ).createCharacterAnimation;
}
const report = {
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model },
  scope:
    'CPU animation update only; four template clones; no GPU/FPS/VRAM/network claim; 7 x 300 frames after 120 warmup frames',
  asset: {
    revision: manifest.revision,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    meshes: doc.meshes.length,
    primitives: doc.meshes.flatMap((m) => m.primitives).length,
    triangles: doc.meshes
      .flatMap((m) => m.primitives)
      .reduce((n, p) => n + doc.accessors[p.indices].count / 3, 0),
    materials: doc.materials.length,
    textures: doc.textures.length,
    skins: doc.skins.length,
    bones: doc.skins[0].joints.length,
    morphTargets: doc.meshes[0].weights.length,
    animations: doc.animations.map((a) => ({ name: a.name, channels: a.channels.length })),
    images: await Promise.all(
      doc.images.map(async (i) => {
        const v = doc.bufferViews[i.bufferView],
          data = binary.subarray(v.byteOffset, v.byteOffset + v.byteLength);
        const m = await sharp(data).metadata();
        return { bytes: data.length, width: m.width, height: m.height, format: m.format };
      }),
    ),
  },
  before: baseline ? await measure(baseline) : undefined,
  after: await measure(createCharacterAnimation),
  equivalence: baseline ? await compare(baseline) : undefined,
};
room.dispose();
if (outputPath) await writeFile(pathToFileURL(outputPath), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
