import * as T from 'three';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  KITCHEN_INSTANCE_GROUPS,
  kitchenAssetName,
} from '../../office/kitchen-layout.js';
import { KITCHEN_LIGHTING } from './lighting.js';
import { configureKitchenMaterial } from './area-shadow.js';
import type { Models } from './models.js';

type Triple = readonly [number, number, number];
interface BakeMesh {
  meshIndex: number;
  name?: string;
  vertexCount: number;
  /** Absent only for nonreceivers in a receiver-scoped UV sidecar. */
  offset?: number;
  geometrySignature: string;
}
export interface KitchenBakeManifest {
  schemaVersion: 1;
  revision: string;
  /** Explicit visual acceptance policy; omitted atlases retain the conservative shell-only default. */
  receiverIds?: string[];
  atlas: {
    encoding: 'RGBM';
    range: number;
    width: number;
    height: number;
    file: string;
    sha256?: string;
  };
  uv?: { file: string; bytes: number; sha256?: string; scope?: 'receivers' };
  layout: {
    positions: Record<string, Triple>;
    rotations: Record<string, number>;
    scales: Record<string, Triple>;
  };
  instances: Record<string, BakeMesh[]>;
  sources: { id: string; assetId: string; sha256: string }[];
}
type Binary = string | Uint8Array | ArrayBuffer;
export interface KitchenBakeBundle {
  /** JSON text, base64 ?inline JSON, or parsed manifest. Real assets installed by the caller. */
  manifest: string | KitchenBakeManifest;
  uv: Binary;
  diffuse: Binary;
}
interface DecodedBake {
  manifest: KitchenBakeManifest;
  uv: Uint8Array;
  diffuse: Uint8Array;
}
interface Binding {
  meshes: T.Mesh[];
  entries: BakeMesh[];
}
interface Room {
  provider: () => Promise<DecodedBake>;
  bindings: Map<string, Binding>;
  failed: boolean;
  committing: boolean;
  warned: boolean;
}
const rooms = new WeakMap<Models, Room>();
const sourceDigests = new WeakMap<ArrayBuffer, Promise<string>>();
const geometryDigests = new WeakMap<T.BufferGeometry, Promise<string>>();
let provider: (() => Promise<DecodedBake>) | undefined;
const SIGNATURE_VERSION = 'three-attributes-sha256-v1';
const PATCH = 'office-baked-diffuse-linear-r4';
/** Only large-chart shell surfaces are adopted; every source/primitive still validates as an occluder. */
export const KITCHEN_BAKED_RECEIVERS = Object.freeze(['floor', 'left-wall', 'right-wall'] as const);

/** Deferred bundles load once on first apply, caching success or failure without startup I/O. */
export function configureKitchenBake(
  bundle: KitchenBakeBundle | (() => Promise<KitchenBakeBundle>) | undefined,
): void {
  if (!bundle) {
    provider = undefined;
  } else if (typeof bundle === 'function') {
    let cached: Promise<DecodedBake> | undefined;
    provider = () => (cached ??= Promise.resolve().then(bundle).then(decodeBundle));
  } else {
    const decoded = decodeBundle(bundle);
    void decoded.catch(() => {});
    provider = () => decoded;
  }
}
function binary(input: Binary): Uint8Array {
  if (typeof input !== 'string') return input instanceof Uint8Array ? input : new Uint8Array(input);
  const decoded = atob(input);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}
async function digest(bytes: Uint8Array): Promise<string> {
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  const result = await globalThis.crypto.subtle.digest('SHA-256', data.buffer);
  return Array.from(new Uint8Array(result), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}
/** Match export-lighting-geometry.mjs: ordered descriptors and packed raw LE bytes, each followed by LF. */
export async function kitchenGeometrySignature(geometry: T.BufferGeometry): Promise<string> {
  const cached = geometryDigests.get(geometry);
  if (cached) return cached;
  const job = (async () => {
    const encoder = new TextEncoder(),
      chunks: Uint8Array[] = [encoder.encode(SIGNATURE_VERSION + '\n')];
    for (const name of ['position', 'index', 'normal', 'uv', 'uv1', 'uv2', 'uv3']) {
      const attribute = name === 'index' ? geometry.index : geometry.getAttribute(name);
      if (!attribute) {
        chunks.push(encoder.encode(JSON.stringify([name, null]) + '\n'));
        continue;
      }
      const interleaved = attribute instanceof T.InterleavedBufferAttribute;
      const data = interleaved ? attribute.data.array : attribute.array;
      const stride = interleaved ? attribute.data.stride : attribute.itemSize;
      const offset = interleaved ? attribute.offset : 0;
      const packed = new (data.constructor as T.TypedArrayConstructor)(
        attribute.count * attribute.itemSize,
      );
      for (let i = 0; i < attribute.count; i++)
        for (let j = 0; j < attribute.itemSize; j++)
          packed[i * attribute.itemSize + j] = data[i * stride + offset + j];
      chunks.push(
        encoder.encode(
          JSON.stringify([
            name,
            data.constructor.name,
            attribute.itemSize,
            attribute.count,
            attribute.normalized,
          ]) + '\n',
        ),
      );
      const bytes = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
      if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1)
        for (let start = 0; start < bytes.length; start += packed.BYTES_PER_ELEMENT)
          bytes.subarray(start, start + packed.BYTES_PER_ELEMENT).reverse();
      chunks.push(bytes, encoder.encode('\n'));
    }
    const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return digest(all);
  })();
  geometryDigests.set(geometry, job);
  return job;
}
/** Production bundle boundary: every scene instance must have exactly one current source. */
export function assertCurrentKitchenSources(
  input: KitchenBakeBundle['manifest'],
): KitchenBakeManifest {
  const manifest = parseManifest(input);
  const expected = Object.keys(KITCHEN_PLACEMENT).sort();
  const ids = manifest.sources.map((source) => source.id).sort();
  if (
    JSON.stringify(ids) !== JSON.stringify(expected) ||
    JSON.stringify(Object.keys(manifest.instances).sort()) !== JSON.stringify(expected)
  ) {
    throw new Error('incomplete current kitchen source set');
  }
  for (const source of manifest.sources) {
    if (source.assetId !== 'kitchen/' + kitchenAssetName(source.id)) {
      throw new Error('current kitchen source identity mismatch: ' + source.id);
    }
  }
  return manifest;
}

function assertLayout(manifest: KitchenBakeManifest): void {
  const actual = {
    positions: KITCHEN_PLACEMENT,
    rotations: KITCHEN_ROTATION,
    scales: KITCHEN_SCALE,
  };
  for (const slot of ['positions', 'rotations', 'scales'] as const) {
    const baked = manifest.layout[slot] as Record<string, number | Triple>;
    const current = actual[slot] as Record<string, number | Triple>;
    if (JSON.stringify(Object.keys(baked).sort()) !== JSON.stringify(Object.keys(current).sort()))
      throw new Error('stale layout ' + slot);
    for (const key of Object.keys(current)) {
      const a = Array.isArray(baked[key]) ? (baked[key] as Triple) : [baked[key] as number];
      const b = Array.isArray(current[key]) ? (current[key] as Triple) : [current[key] as number];
      if (
        a.length !== b.length ||
        a.some((value, i) => !Number.isFinite(value) || Math.abs(value - b[i]) > 1e-8)
      )
        throw new Error('stale layout ' + slot + '/' + key);
    }
  }
}
function parseManifest(input: KitchenBakeBundle['manifest']): KitchenBakeManifest {
  return typeof input === 'string'
    ? JSON.parse(
        input.trimStart().startsWith('{') ? input : new TextDecoder().decode(binary(input)),
      )
    : input;
}
async function decodeBundle(bundle: KitchenBakeBundle): Promise<DecodedBake> {
  const manifest = parseManifest(bundle.manifest);
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.revision ||
    manifest.atlas.encoding !== 'RGBM' ||
    !Number.isFinite(manifest.atlas.range) ||
    manifest.atlas.range <= 0 ||
    !Number.isInteger(manifest.atlas.width) ||
    !Number.isInteger(manifest.atlas.height) ||
    manifest.atlas.width <= 0 ||
    manifest.atlas.height <= 0 ||
    !Array.isArray(manifest.sources)
  )
    throw new Error('unsupported bake manifest');
  assertLayout(manifest);
  const compact = manifest.uv?.scope === 'receivers';
  if (manifest.uv?.scope !== undefined && !compact) throw new Error('unsupported UV scope');
  if (compact && manifest.receiverIds === undefined)
    throw new Error('receiver-scoped UV requires explicit receiverIds');
  const uv = binary(bundle.uv),
    diffuse = binary(bundle.diffuse);
  if (uv.byteLength % 4 || (manifest.uv && manifest.uv.bytes !== uv.byteLength))
    throw new Error('invalid UV sidecar length');
  if (
    diffuse.byteLength < 24 ||
    new DataView(diffuse.buffer, diffuse.byteOffset).getUint32(0) !== 0x89504e47
  )
    throw new Error('invalid atlas PNG');
  const png = new DataView(diffuse.buffer, diffuse.byteOffset);
  if (png.getUint32(16) !== manifest.atlas.width || png.getUint32(20) !== manifest.atlas.height)
    throw new Error('atlas dimensions mismatch');
  const ids = manifest.sources.map((source) => source.id);
  if (new Set(ids).size !== ids.length || ids.length !== Object.keys(manifest.instances).length)
    throw new Error('incomplete bake source list');
  if (
    manifest.receiverIds !== undefined &&
    (!Array.isArray(manifest.receiverIds) ||
      !manifest.receiverIds.length ||
      new Set(manifest.receiverIds).size !== manifest.receiverIds.length ||
      manifest.receiverIds.some((id) => !ids.includes(id)))
  )
    throw new Error('invalid bake receiver selection');
  const spans: { offset: number; end: number }[] = [];
  for (const source of manifest.sources) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256) || !source.assetId.startsWith('kitchen/'))
      throw new Error('invalid source hash');
    const entries = manifest.instances[source.id];
    const needsUV = !compact || manifest.receiverIds!.includes(source.id);
    if (
      !entries?.length ||
      entries.some(
        (entry, i) =>
          entry.meshIndex !== i ||
          !Number.isInteger(entry.vertexCount) ||
          entry.vertexCount <= 0 ||
          entry.vertexCount % 3 ||
          (needsUV
            ? typeof entry.offset !== 'number' ||
              !Number.isInteger(entry.offset) ||
              entry.offset < 0 ||
              entry.offset % 4 ||
              entry.offset + entry.vertexCount * 4 > uv.byteLength
            : 'offset' in entry) ||
          !/^[a-f0-9]{64}$/.test(entry.geometrySignature),
      )
    )
      throw new Error('invalid primitive UV records: ' + source.id);
    if (compact && needsUV)
      for (const entry of entries)
        spans.push({ offset: entry.offset!, end: entry.offset! + entry.vertexCount * 4 });
  }
  if (compact) {
    spans.sort((a, b) => a.offset - b.offset);
    let end = 0;
    for (const span of spans) {
      if (span.offset !== end) throw new Error('UV spans overlap or have non-contiguous offsets');
      end = span.end;
    }
    if (end !== uv.byteLength) throw new Error('UV sidecar has unreferenced trailing bytes');
  }
  const checks = [];
  if (manifest.uv?.sha256)
    checks.push(
      digest(uv).then((value) => {
        if (value !== manifest.uv!.sha256) throw new Error('UV checksum mismatch');
      }),
    );
  if (manifest.atlas.sha256)
    checks.push(
      digest(diffuse).then((value) => {
        if (value !== manifest.atlas.sha256) throw new Error('atlas checksum mismatch');
      }),
    );
  await Promise.all(checks);
  return { manifest, uv, diffuse };
}
function fail(models: Models, room: Room, reason: unknown): void {
  room.failed = true;
  if (!room.warned && !models.disposed) {
    room.warned = true;
    console.warn(
      'Office: baked kitchen disabled; using realtime lighting.',
      reason instanceof Error ? reason.message : reason,
    );
  }
}
/** COLOR=false stores E/pi; override AFTER native AO, preserving all specular and emissive terms. */
export function configureBakedKitchenMaterial(
  material: T.MeshStandardMaterial,
  atlas: T.Texture,
  range: number,
): void {
  configureKitchenMaterial(material);
  material.lightMap = atlas;
  material.lightMapIntensity = 1;
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey;
  const fraction = KITCHEN_LIGHTING.dynamicShadow.directFraction;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    const include = '#include <aomap_fragment>';
    if (!shader.fragmentShader.includes(include)) throw new Error(PATCH + ': missing AO include');
    const main = 'void main() {';
    if (!shader.fragmentShader.includes(main)) throw new Error(PATCH + ': missing main');
    shader.uniforms.officeBakeAtlasSize = {
      value: new T.Vector2(atlas.image?.width ?? 1, atlas.image?.height ?? 1),
    };
    // RGBM must be decoded before interpolation: filtering RGB and multiplier separately darkens seams.
    const sampling = [
      '#ifdef USE_LIGHTMAP',
      'uniform vec2 officeBakeAtlasSize;',
      'vec3 officeDecodeRGBM(vec4 value) { return value.rgb * value.a * ' +
        range.toFixed(8) +
        '; }',
      'vec3 officeSampleBakedDiffuse(vec2 uv) {',
      'vec2 pixel = uv * officeBakeAtlasSize - 0.5;',
      'vec2 base = floor(pixel);',
      'vec2 fraction = fract(pixel);',
      'vec2 texel = 1.0 / officeBakeAtlasSize;',
      'vec2 low = 0.5 * texel;',
      'vec2 high = vec2(1.0) - low;',
      'vec3 c00 = officeDecodeRGBM(texture2D(lightMap, clamp((base + vec2(0.5, 0.5)) * texel, low, high)));',
      'vec3 c10 = officeDecodeRGBM(texture2D(lightMap, clamp((base + vec2(1.5, 0.5)) * texel, low, high)));',
      'vec3 c01 = officeDecodeRGBM(texture2D(lightMap, clamp((base + vec2(0.5, 1.5)) * texel, low, high)));',
      'vec3 c11 = officeDecodeRGBM(texture2D(lightMap, clamp((base + vec2(1.5, 1.5)) * texel, low, high)));',
      'return mix(mix(c00, c10, fraction.x), mix(c01, c11, fraction.x), fraction.y);',
      '}',
      '#endif',
    ].join('\n');
    shader.fragmentShader = shader.fragmentShader.replace(main, sampling + '\n' + main);
    const override = [
      '// ' + PATCH + ': calibrated white-Lambert radiance E/pi, no extra PI.',
      '#ifdef USE_LIGHTMAP',
      'vec3 officeBakedRGB = officeSampleBakedDiffuse(vLightMapUv);',
      '#if defined(USE_SHADOWMAP) && (defined(SHADOWMAP_TYPE_PCF) || defined(SHADOWMAP_TYPE_PCF_SOFT)) && NUM_SPOT_LIGHT_SHADOWS == 4 && NUM_SPOT_LIGHTS == 4 && NUM_SPOT_LIGHT_MAPS == 0',
      'officeBakedRGB *= receiveShadow ? mix(' +
        (1 - fraction).toFixed(8) +
        ', 1.0, kitchenAreaVisibility(',
      'spotShadowMap[3], spotLightShadows[3].shadowMapSize,',
      'spotLightShadows[3].shadowIntensity, spotLightShadows[3].shadowBias,',
      'spotLightShadows[3].shadowRadius, vSpotLightCoord[3])) : 1.0;',
      '#endif',
      'reflectedLight.directDiffuse = vec3(0.0);',
      'reflectedLight.indirectDiffuse = officeBakedRGB * material.diffuseColor;',
      '#endif',
    ].join('\n');
    shader.fragmentShader = shader.fragmentShader.replace(include, include + '\n' + override);
  };
  material.customProgramCacheKey = function () {
    return previousKey.call(this) + '|' + PATCH + '/' + range + '/' + fraction;
  };
  material.userData.officeBakedLighting = true;
  material.needsUpdate = true;
}
async function commit(models: Models, room: Room, bake: DecodedBake): Promise<void> {
  room.committing = true;
  const image = await createImageBitmap(
    new Blob([new Uint8Array(bake.diffuse).buffer], { type: 'image/png' }),
    {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    },
  );
  const atlas = new T.Texture(image);
  atlas.name = 'office-baked-diffuse/' + bake.manifest.revision;
  atlas.flipY = false;
  atlas.colorSpace = T.NoColorSpace;
  atlas.channel = 1;
  atlas.generateMipmaps = false;
  atlas.minFilter = atlas.magFilter = T.NearestFilter;
  atlas.needsUpdate = true;
  if (!models.ownTexture(atlas)) return;
  if (image.width !== bake.manifest.atlas.width || image.height !== bake.manifest.atlas.height)
    throw new Error('decoded atlas dimensions mismatch');
  if (models.disposed || room.failed) return;
  assertLayout(bake.manifest);
  const staging = new T.Group();
  const receivers = new Set<string>(bake.manifest.receiverIds ?? KITCHEN_BAKED_RECEIVERS);
  const prepared: {
    mesh: T.Mesh;
    geometry: T.BufferGeometry;
    material: T.Material | T.Material[];
  }[] = [];
  try {
    for (const [id, binding] of room.bindings) {
      if (!receivers.has(id)) continue;
      binding.meshes.forEach((mesh, i) => {
        const entry = binding.entries[i];
        if (entry.offset === undefined) throw new Error('missing receiver UV offset: ' + id);
        const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (sourceMaterials.some((source) => !(source instanceof T.MeshStandardMaterial)))
          throw new Error('unsupported static material');
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        const holder = new T.Mesh<T.BufferGeometry, T.Material | T.Material[]>(geometry, []);
        staging.add(holder);
        const view = new DataView(
          bake.uv.buffer,
          bake.uv.byteOffset + entry.offset,
          entry.vertexCount * 4,
        );
        const uv = new Uint16Array(entry.vertexCount * 2);
        for (let j = 0; j < uv.length; j++) uv[j] = view.getUint16(j * 2, true);
        geometry.setAttribute('uv1', new T.Uint16BufferAttribute(uv, 2, true));
        const materials: T.Material[] = [];
        holder.material = materials;
        for (const source of sourceMaterials) {
          const material = source.clone() as T.MeshStandardMaterial;
          materials.push(material);
          configureBakedKitchenMaterial(material, atlas, bake.manifest.atlas.range);
        }
        const material = Array.isArray(mesh.material) ? materials : materials[0];
        holder.material = material;
        prepared.push({ mesh, geometry, material });
      });
    }
  } catch (error) {
    staging.traverse((node) => {
      if (node instanceof T.Mesh) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material])
          material.dispose();
      }
    });
    throw error;
  }
  if (!models.ownObject(staging)) return;
  for (const item of prepared) {
    item.mesh.geometry = item.geometry;
    item.mesh.material = item.material;
    item.mesh.userData.officeBakedLighting = bake.manifest.revision;
  }
  models.invalidate();
}
/** Static GLB only, after component afterLoad; wait for every source before replacing any meshes. */
export async function applyKitchenBake(
  models: Models,
  name: string,
  root: T.Object3D,
  bytes: ArrayBuffer,
): Promise<void> {
  if (!provider || name === 'deepseek' || models.disposed) return;
  let room = rooms.get(models);
  if (!room) {
    room = { provider, bindings: new Map(), failed: false, committing: false, warned: false };
    rooms.set(models, room);
  }
  if (room.failed || room.committing) return;
  try {
    const bake = await room.provider();
    if (models.disposed || room.failed) return;
    assertLayout(bake.manifest);
    const ids = KITCHEN_INSTANCE_GROUPS[name]
      ? KITCHEN_INSTANCE_GROUPS[name]
      : [name === 'floor-surface' ? 'floor' : name === 'right-wall-surface' ? 'right-wall' : name];
    let sourceHash = sourceDigests.get(bytes);
    if (!sourceHash) {
      sourceHash = digest(new Uint8Array(bytes));
      sourceDigests.set(bytes, sourceHash);
    }
    for (const id of ids) {
      const source = bake.manifest.sources.find((record) => record.id === id);
      if (!source || source.sha256 !== (await sourceHash))
        throw new Error('source GLB hash mismatch: ' + id);
      const instance = ids.length === 1 ? root : root.getObjectByName(id);
      if (!instance) throw new Error('missing instance: ' + id);
      const meshes: T.Mesh[] = [];
      instance.traverse((node) => {
        if (node instanceof T.Mesh) meshes.push(node);
      });
      const entries = bake.manifest.instances[id];
      if (meshes.length !== entries.length) throw new Error('primitive count mismatch: ' + id);
      for (const [i, mesh] of meshes.entries()) {
        const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count;
        if (
          mesh instanceof T.SkinnedMesh ||
          Object.keys(mesh.geometry.morphAttributes).length ||
          count !== entries[i].vertexCount ||
          (await kitchenGeometrySignature(mesh.geometry)) !== entries[i].geometrySignature
        )
          throw new Error('geometry signature mismatch: ' + id + '/' + i);
      }
      room.bindings.set(id, { meshes, entries });
    }
    if (
      !models.disposed &&
      !room.failed &&
      !room.committing &&
      room.bindings.size === bake.manifest.sources.length
    )
      await commit(models, room, bake);
  } catch (error) {
    fail(models, room, error);
  }
}
export function rejectKitchenBake(models: Models, reason: unknown): void {
  if (!provider || models.disposed) return;
  let room = rooms.get(models);
  if (!room) {
    room = { provider, bindings: new Map(), failed: false, committing: false, warned: false };
    rooms.set(models, room);
  }
  fail(models, room, reason);
}
