import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { limitObjectTextures } from '../lib/client/scene/texture-budget.js';
import { Models } from '../lib/client/scene/models.js';

function bitmap(width, height) {
  return {
    width,
    height,
    closed: 0,
    close() {
      this.closed++;
    },
  };
}

function fixture(t, images) {
  const root = new T.Group();
  const geometry = new T.BoxGeometry();
  const textures = images.map((image) => new T.Texture(image));
  const materials = textures.map((map) => new T.MeshStandardMaterial({ map }));
  root.add(new T.Mesh(geometry, materials));
  const calls = [],
    outputs = [];
  t.mock.method(globalThis, 'createImageBitmap', async (image, options) => {
    calls.push({ image, options });
    const output = bitmap(options.resizeWidth, options.resizeHeight);
    outputs.push(output);
    return output;
  });
  t.after(() => {
    geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  });
  return { root, textures, materials, calls, outputs };
}

// Node has no bitmap factory. Each test replaces this placeholder via mock.method.
if (!globalThis.createImageBitmap) globalThis.createImageBitmap = () => {};

test('mixed sizes cap only oversized images, preserve aspect and use explicit decode options', async (t) => {
  const images = [bitmap(4096, 2048), bitmap(900, 1800), bitmap(1024, 1024), bitmap(512, 256)];
  const f = fixture(t, images);
  f.materials[3].normalMap = f.textures[3];
  const stats = await limitObjectTextures(f.root, { maxSize: 1024 });
  assert.deepEqual(
    f.textures.map((texture) => [texture.image.width, texture.image.height]),
    [
      [1024, 512],
      [512, 1024],
      [1024, 1024],
      [512, 256],
    ],
  );
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].options, {
    resizeWidth: 1024,
    resizeHeight: 512,
    resizeQuality: 'high',
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  assert.deepEqual(
    images.map((image) => image.closed),
    [1, 1, 0, 0],
  );
  assert.equal(stats.images, 4);
  assert.equal(stats.resized, 2);
  assert.equal(stats.failed, 0);
  assert.equal(
    stats.pixelsBefore,
    images.reduce((sum, image) => sum + image.width * image.height, 0),
  );
  assert.equal(stats.pixelsAfter, 1024 * 512 * 2 + 1024 ** 2 + 512 * 256);
});

test('shared textures, cloned Sources and independent Sources sharing one bitmap resize once', async (t) => {
  const original = bitmap(2048, 1024);
  const f = fixture(t, [original, original]);
  const clone = f.textures[0].clone();
  f.materials[0].normalMap = clone;
  f.materials[1].roughnessMap = f.textures[0];
  f.root.add(f.root.children[0].clone());
  original.close = () => {
    assert.ok(f.textures.every((texture) => texture.image === f.outputs[0]));
    assert.equal(clone.image, f.outputs[0], 'every Source is updated before original close');
    original.closed++;
  };
  const sources = [...f.textures, clone].map((texture) => texture.source);
  const stats = await limitObjectTextures(f.root);
  assert.equal(f.calls.length, 1);
  assert.equal(stats.images, 1);
  assert.equal(original.closed, 1);
  assert.equal(clone.source, f.textures[0].source);
  assert.notEqual(f.textures[0].source, f.textures[1].source);
  assert.deepEqual(
    [...f.textures, clone].map((texture) => texture.source),
    sources,
  );
  assert.ok([...f.textures, clone].every((texture) => texture.version > 0));
  clone.dispose();
});

test('resizing preserves color space, UV channel, orientation, sampler and material values', async (t) => {
  const f = fixture(t, [bitmap(2048, 2048), bitmap(2048, 2048)]);
  for (const [i, texture] of f.textures.entries()) {
    texture.colorSpace = i ? T.NoColorSpace : T.SRGBColorSpace;
    texture.flipY = false;
    texture.channel = i;
    texture.minFilter = T.LinearFilter;
    texture.magFilter = T.NearestFilter;
    texture.wrapS = T.RepeatWrapping;
    texture.wrapT = T.MirroredRepeatWrapping;
    texture.generateMipmaps = false;
    texture.premultiplyAlpha = true;
    texture.anisotropy = 8;
    texture.offset.set(0.2, 0.4);
    texture.repeat.set(2, 3);
    f.materials[i].roughness = 0.7;
  }
  const snapshot = (texture) =>
    Object.fromEntries(
      [
        'colorSpace',
        'flipY',
        'channel',
        'minFilter',
        'magFilter',
        'wrapS',
        'wrapT',
        'generateMipmaps',
        'premultiplyAlpha',
        'anisotropy',
        'offset',
        'repeat',
      ].map((key) => [key, texture[key]?.clone?.() ?? texture[key]]),
    );
  const before = f.textures.map(snapshot);
  await limitObjectTextures(f.root);
  assert.deepEqual(f.textures.map(snapshot), before);
  assert.ok(
    f.materials.every(
      (material, i) => material.map === f.textures[i] && material.roughness === 0.7,
    ),
  );
});

test('small maps and non-bitmap sources are no-ops, including when bitmap resizing is unavailable', async (t) => {
  const f = fixture(t, [
    bitmap(1024, 999),
    bitmap(1, 1024),
    { width: 2048, height: 2048, data: new Uint8Array(4) },
  ]);
  const before = f.textures.map((texture) => texture.image);
  await limitObjectTextures(f.root);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(
    f.textures.map((texture) => texture.image),
    before,
  );
  assert.ok(f.textures.every((texture) => texture.version === 0));
  const oversized = bitmap(4096, 4096);
  f.textures[0].image = oversized;
  const factory = globalThis.createImageBitmap;
  globalThis.createImageBitmap = undefined;
  try {
    await limitObjectTextures(f.root);
  } finally {
    globalThis.createImageBitmap = factory;
  }
  assert.equal(f.textures[0].image, oversized);
  assert.equal(oversized.closed, 0);
});

test('resize failures retain every referencing Source and permit other images to resize', async (t) => {
  const bad = bitmap(4096, 1024),
    good = bitmap(2048, 2048);
  const f = fixture(t, [bad, bad, good]);
  const factory = globalThis.createImageBitmap;
  t.mock.method(globalThis, 'createImageBitmap', (image, options) => {
    if (image === bad) return Promise.reject(new Error('decode unavailable'));
    return factory(image, options);
  });
  const stats = await limitObjectTextures(f.root);
  assert.equal(stats.failed, 1);
  assert.equal(stats.resized, 1);
  assert.equal(f.textures[0].image, bad);
  assert.equal(f.textures[1].image, bad);
  assert.equal(bad.closed, 0);
  assert.equal(good.closed, 1);
  assert.equal(f.outputs[0].closed, 0, 'successful bitmap remains owned by the parsed object');
});

test('rounding retains thin/odd aspect ratios without zero dimensions or upscaling', async (t) => {
  const f = fixture(t, [bitmap(3001, 1000), bitmap(1, 4000)]);
  await limitObjectTextures(f.root);
  assert.deepEqual(
    f.outputs.map((image) => [image.width, image.height]),
    [
      [1024, 341],
      [1, 1024],
    ],
  );
  const again = await limitObjectTextures(f.root);
  assert.equal(again.resized, 0);
  assert.equal(f.calls.length, 2);
});

test('disposal during resize closes the unowned result; Models cleans originals on late ownership', async (t) => {
  const original = bitmap(4096, 2048);
  const f = fixture(t, [original, original]);
  const models = new Models();
  let finish;
  t.mock.method(
    globalThis,
    'createImageBitmap',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const operation = limitObjectTextures(f.root, { disposed: () => models.disposed });
  models.dispose();
  const result = bitmap(1024, 512);
  finish(result);
  await operation;
  assert.equal(result.closed, 1);
  assert.equal(original.closed, 0);
  assert.equal(f.textures[0].image, original);
  assert.equal(models.ownObject(f.root), false);
  assert.equal(original.closed, 1, 'Models deduplicates the still-owned original');
});

test('already-disposed objects skip work and successful resized images remain owned for Models teardown', async (t) => {
  const first = fixture(t, [bitmap(2048, 2048)]);
  await limitObjectTextures(first.root, { disposed: () => true });
  assert.equal(first.calls.length, 0);
  const second = fixture(t, [bitmap(2048, 2048)]);
  await limitObjectTextures(second.root);
  const models = new Models();
  assert.equal(models.ownObject(second.root), true);
  models.dispose();
  assert.equal(second.outputs[0].closed, 1);
});

test('invalid limits reject before touching images', async (t) => {
  const f = fixture(t, [bitmap(2048, 2048)]);
  for (const maxSize of [0, -1, 1.5, NaN, Infinity])
    await assert.rejects(limitObjectTextures(f.root, { maxSize }), RangeError);
  assert.equal(f.calls.length, 0);
});
