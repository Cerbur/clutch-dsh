import assert from 'node:assert/strict';
import sharp from 'sharp';

// Same renderer, camera, actors and animation instant; export using performance-preview.
const [
  cached = '/tmp/office-performance-scene-cached.png',
  reference = '/tmp/office-performance-scene-reference.png',
] = process.argv.slice(2);
const [a, b] = await Promise.all(
  [cached, reference].map((path) =>
    sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ),
);
assert.equal(a.info.width, b.info.width);
assert.equal(a.info.height, b.info.height);
let absoluteError = 0,
  overEight = 0,
  maximum = 0;
for (let i = 0; i < a.data.length; i += 4) {
  let peak = 0;
  for (let channel = 0; channel < 3; channel++) {
    const difference = Math.abs(a.data[i + channel] - b.data[i + channel]);
    absoluteError += difference;
    peak = Math.max(peak, difference);
  }
  if (peak > 8) overEight++;
  maximum = Math.max(maximum, peak);
}
const pixels = a.info.width * a.info.height;
const result = {
  width: a.info.width,
  height: a.info.height,
  meanAbsoluteChannelError: absoluteError / (pixels * 3),
  pixelsOverEightPercent: (overEight * 100) / pixels,
  maximumChannelError: maximum,
  // Half-float HDR storage and tone mapping after MSAA resolve can differ at edges.
  limits: { meanAbsoluteChannelError: 0.25, pixelsOverEightPercent: 0.75 },
};
console.log(JSON.stringify(result, null, 2));
assert.ok(
  result.meanAbsoluteChannelError < result.limits.meanAbsoluteChannelError,
  'broad lighting/color regression',
);
assert.ok(
  result.pixelsOverEightPercent < result.limits.pixelsOverEightPercent,
  'excessive occlusion/edge/shadow differences',
);
