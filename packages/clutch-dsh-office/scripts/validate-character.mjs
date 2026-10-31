/** Explicitly admit the skeletal revision without relaxing historical static budgets. */
export function validateCharacterRig(manifest, bytes, rigged) {
  const size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size).toString('utf8'));
  const bin = bytes.subarray(28 + size);
  const primitives = doc.meshes.flatMap((mesh) => mesh.primitives);
  const targets = primitives.some((p) => p.targets?.length);
  if (!rigged) {
    if (doc.skins?.length || doc.animations?.length || targets)
      throw new Error('Static character revision cannot contain skin/morph/animation');
    return;
  }
  const fail = () => {
    throw new Error('Invalid skeletal character skin, morph or independent animation contract');
  };
  const assert = (condition) => {
    if (!condition) fail();
  };
  const cache = new Map();
  const read = (index) => {
    if (cache.has(index)) return cache.get(index);
    const a = doc.accessors[index];
    assert(a && Number.isInteger(a.count) && a.count > 0 && a.count < 1000000);
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const kind = {
      5121: ['readUInt8', 1],
      5123: ['readUInt16LE', 2],
      5125: ['readUInt32LE', 4],
      5126: ['readFloatLE', 4],
    }[a.componentType];
    assert(components && kind);
    const rows = Array.from({ length: a.count }, () => Array(components).fill(0));
    const get = (viewIndex, offset, count, width, method, stride) => {
      const view = doc.bufferViews[viewIndex];
      assert(
        view?.buffer === 0 &&
          offset >= 0 &&
          count > 0 &&
          (view.byteOffset ?? 0) + view.byteLength <= bin.length,
      );
      assert(offset + (count - 1) * stride + width <= view.byteLength);
      return (row, component = 0) =>
        bin[method]((view.byteOffset ?? 0) + offset + row * stride + component * kind[1]);
    };
    if (a.bufferView !== undefined) {
      const view = doc.bufferViews[a.bufferView];
      const at = get(
        a.bufferView,
        a.byteOffset ?? 0,
        a.count,
        components * kind[1],
        kind[0],
        view?.byteStride ?? components * kind[1],
      );
      for (let i = 0; i < a.count; i++) for (let c = 0; c < components; c++) rows[i][c] = at(i, c);
    }
    if (a.sparse) {
      const sparse = a.sparse;
      const ik = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4] }[
        sparse.indices.componentType
      ];
      assert(ik && sparse.count <= a.count);
      const indices = get(
        sparse.indices.bufferView,
        sparse.indices.byteOffset ?? 0,
        sparse.count,
        ik[1],
        ik[0],
        ik[1],
      );
      const vals = get(
        sparse.values.bufferView,
        sparse.values.byteOffset ?? 0,
        sparse.count,
        components * kind[1],
        kind[0],
        components * kind[1],
      );
      let previous = -1;
      for (let i = 0; i < sparse.count; i++) {
        const target = indices(i);
        assert(target > previous && target < a.count);
        previous = target;
        for (let c = 0; c < components; c++) rows[target][c] = vals(i, c);
      }
    }
    assert(rows.every((row) => row.every(Number.isFinite)));
    cache.set(index, rows);
    return rows;
  };
  const skin = doc.skins?.[0];
  assert(
    doc.skins?.length === 1 &&
      skin.joints.length === 31 &&
      new Set(skin.joints).size === 31 &&
      skin.joints.every((i) => doc.nodes[i]),
  );
  assert(
    read(skin.inverseBindMatrices).length === 31 &&
      doc.accessors[skin.inverseBindMatrices].type === 'MAT4',
  );
  assert(
    manifest.capabilities?.rigged === true &&
      manifest.capabilities?.skinned === true &&
      manifest.capabilities?.morphTargets === true,
  );
  assert(doc.meshes.length === 1 && primitives.length === 3);
  assert(
    JSON.stringify(doc.meshes[0].extras?.targetNames) ===
      JSON.stringify(['Blink_L', 'Blink_R', 'BlinkCurve_L', 'BlinkCurve_R']),
  );
  assert(doc.meshes[0].weights?.length === 4 && doc.meshes[0].weights.every((v) => v === 0));
  const meshNodes = doc.nodes.flatMap((node, i) => (node.mesh !== undefined ? [i] : []));
  assert(meshNodes.length === 1 && doc.nodes[meshNodes[0]].skin === 0);
  for (const p of primitives) {
    const n = doc.accessors[p.attributes.POSITION].count;
    assert(
      doc.accessors[p.attributes.JOINTS_0]?.type === 'VEC4' &&
        doc.accessors[p.attributes.WEIGHTS_0]?.type === 'VEC4',
    );
    const joints = read(p.attributes.JOINTS_0),
      weights = read(p.attributes.WEIGHTS_0);
    assert(
      joints.length === n &&
        weights.length === n &&
        joints.every((row) => row.every((j) => Number.isInteger(j) && j >= 0 && j < 31)),
    );
    assert(
      weights.every(
        (row) =>
          row.every((w) => w >= 0 && w <= 1) && Math.abs(row.reduce((x, y) => x + y, 0) - 1) < 1e-5,
      ),
    );
    assert(p.targets?.length === 4);
    for (const t of p.targets)
      for (const name of ['POSITION', 'NORMAL']) {
        assert(doc.accessors[t[name]]?.type === 'VEC3' && doc.accessors[t[name]].count === n);
        read(t[name]);
      }
  }
  assert(doc.animations?.length === 2 && new Set(doc.animations.map((a) => a.name)).size === 2);
  assert(
    JSON.stringify(manifest.capabilities.animationClips) ===
      JSON.stringify(['Walk_InPlace', 'Blink']),
  );
  for (const animation of doc.animations) {
    const blink = animation.name === 'Blink';
    assert(blink || animation.name === 'Walk_InPlace');
    assert(animation.channels.length > 0);
    for (const channel of animation.channels) {
      const { node, path } = channel.target;
      assert(
        blink
          ? meshNodes.includes(node) && path === 'weights'
          : skin.joints.includes(node) && ['translation', 'rotation', 'scale'].includes(path),
      );
      const sampler = animation.samplers[channel.sampler];
      assert(
        sampler &&
          (blink
            ? (sampler.interpolation ?? 'LINEAR') === 'LINEAR'
            : ['LINEAR', 'STEP'].includes(sampler.interpolation ?? 'LINEAR')),
      );
      const times = read(sampler.input),
        output = read(sampler.output);
      assert(
        doc.accessors[sampler.input].type === 'SCALAR' &&
          times.every((row, i) => !i || row[0] > times[i - 1][0]),
      );
      assert(
        Math.abs(times[0][0] - (blink ? 0 : 1 / 30)) < 1e-6 &&
          Math.abs(times.at(-1)[0] - times[0][0] - (blink ? 7 / 30 : 1)) < 1e-6,
      );
      assert(output.length === times.length * (blink ? 4 : 1));
      if (blink) {
        assert(
          doc.accessors[sampler.output].type === 'SCALAR' &&
            output.every(([w]) => w >= 0 && w <= 1),
        );
        assert(
          output
            .slice(0, 4)
            .concat(output.slice(-4))
            .every(([w]) => w === 0),
        );
        assert(output.some(([w], i) => i % 4 < 2 && w === 1));
      } else assert(output[0].every((v, i) => Math.abs(v - output.at(-1)[i]) < 1e-6));
    }
  }
}
