// clutch_fireworks: {"version":1,"name":"鲸鱼烟花 · Whale Show","durationMs":5000}
// Adapted from goodcucumber's PR #7 canvas show: sampled whale, shell families,
// truncated-exponential launches, drag/gravity sparks and the anchored fountain.
// The v1 host owns playback, canvas reset, resize and cleanup. All motion/trails
// are evaluated at absolute time: no private engine, pixel buffer or frame loop.
const WHALE_OUTLINE = [
  [0.979, -0.6124],
  [0.9414, -0.5976],
  [0.9096, -0.5666],
  [0.873, -0.5417],
  [0.8304, -0.5298],
  [0.786, -0.5296],
  [0.7421, -0.5239],
  [0.7002, -0.5093],
  [0.6622, -0.4865],
  [0.6298, -0.4607],
  [0.617, -0.5031],
  [0.5932, -0.5404],
  [0.5598, -0.5694],
  [0.5206, -0.5902],
  [0.4811, -0.6104],
  [0.4482, -0.6399],
  [0.4292, -0.6798],
  [0.4151, -0.7218],
  [0.3781, -0.7292],
  [0.3565, -0.6905],
  [0.342, -0.6486],
  [0.3341, -0.6049],
  [0.332, -0.5606],
  [0.3351, -0.5163],
  [0.3432, -0.4726],
  [0.3569, -0.4304],
  [0.3763, -0.3905],
  [0.4011, -0.3537],
  [0.4307, -0.3206],
  [0.4643, -0.2916],
  [0.4968, -0.2625],
  [0.4866, -0.2197],
  [0.4729, -0.1774],
  [0.4359, -0.1731],
  [0.3965, -0.1936],
  [0.3593, -0.2177],
  [0.3245, -0.2454],
  [0.2923, -0.2759],
  [0.261, -0.3074],
  [0.2299, -0.3392],
  [0.1988, -0.3708],
  [0.167, -0.4019],
  [0.1343, -0.4319],
  [0.1001, -0.4603],
  [0.0644, -0.4866],
  [0.0274, -0.5113],
  [0.0014, -0.547],
  [-0.004, -0.5903],
  [0.0159, -0.6295],
  [0.0494, -0.6584],
  [0.0599, -0.6873],
  [0.0173, -0.6986],
  [-0.0271, -0.6986],
  [-0.0711, -0.6928],
  [-0.1143, -0.6824],
  [-0.1566, -0.6691],
  [-0.1984, -0.654],
  [-0.24, -0.6385],
  [-0.2832, -0.6339],
  [-0.3272, -0.64],
  [-0.3715, -0.6437],
  [-0.4159, -0.6449],
  [-0.4603, -0.6437],
  [-0.5045, -0.6399],
  [-0.5485, -0.6336],
  [-0.5918, -0.6239],
  [-0.6342, -0.6108],
  [-0.6754, -0.5941],
  [-0.7149, -0.5738],
  [-0.7524, -0.55],
  [-0.7877, -0.5231],
  [-0.8205, -0.4932],
  [-0.8508, -0.4607],
  [-0.8786, -0.4261],
  [-0.9038, -0.3895],
  [-0.9264, -0.3513],
  [-0.9462, -0.3115],
  [-0.9629, -0.2704],
  [-0.9766, -0.2281],
  [-0.987, -0.185],
  [-0.9944, -0.1412],
  [-0.9986, -0.097],
  [-1, -0.0526],
  [-0.9985, -0.0082],
  [-0.9945, 0.036],
  [-0.9882, 0.08],
  [-0.9795, 0.1236],
  [-0.9684, 0.1666],
  [-0.9549, 0.2089],
  [-0.939, 0.2503],
  [-0.9206, 0.2907],
  [-0.8998, 0.33],
  [-0.8768, 0.368],
  [-0.8516, 0.4045],
  [-0.8243, 0.4396],
  [-0.7951, 0.4731],
  [-0.7642, 0.505],
  [-0.7316, 0.5352],
  [-0.6977, 0.5638],
  [-0.6624, 0.5908],
  [-0.6257, 0.6159],
  [-0.5878, 0.6389],
  [-0.5485, 0.6598],
  [-0.5082, 0.6782],
  [-0.4668, 0.6943],
  [-0.4244, 0.7077],
  [-0.3814, 0.7186],
  [-0.3377, 0.7268],
  [-0.2937, 0.7323],
  [-0.2493, 0.7352],
  [-0.2049, 0.7356],
  [-0.1605, 0.7338],
  [-0.1163, 0.7304],
  [-0.0721, 0.7251],
  [-0.0284, 0.7174],
  [0.0147, 0.7066],
  [0.0568, 0.6927],
  [0.0978, 0.6755],
  [0.1373, 0.6551],
  [0.1752, 0.632],
  [0.2114, 0.6064],
  [0.2463, 0.5799],
  [0.2877, 0.5958],
  [0.3311, 0.6052],
  [0.3751, 0.6108],
  [0.4194, 0.6139],
  [0.4638, 0.6126],
  [0.5079, 0.607],
  [0.5511, 0.5971],
  [0.5824, 0.5673],
  [0.5762, 0.5257],
  [0.5365, 0.506],
  [0.4959, 0.4881],
  [0.4547, 0.4713],
  [0.4127, 0.4568],
  [0.4092, 0.4276],
  [0.4387, 0.3944],
  [0.4679, 0.3609],
  [0.496, 0.3265],
  [0.5224, 0.2908],
  [0.5467, 0.2536],
  [0.5688, 0.2151],
  [0.5888, 0.1755],
  [0.6064, 0.1347],
  [0.6221, 0.0931],
  [0.6358, 0.0509],
  [0.6477, 0.0081],
  [0.658, -0.0351],
  [0.6669, -0.0786],
  [0.6745, -0.1224],
  [0.6792, -0.1665],
  [0.6772, -0.2109],
  [0.7088, -0.2323],
  [0.7522, -0.2413],
  [0.7942, -0.2557],
  [0.834, -0.2754],
  [0.8708, -0.3001],
  [0.904, -0.3296],
  [0.9325, -0.3636],
  [0.9558, -0.4014],
  [0.9737, -0.442],
  [0.9867, -0.4844],
  [0.9953, -0.528],
  [1, -0.5722],
  [0.9823, -0.6105],
  [-0.0669, 0.4893],
  [-0.1023, 0.4624],
  [-0.1381, 0.4361],
  [-0.1744, 0.4105],
  [-0.2114, 0.386],
  [-0.2495, 0.3631],
  [-0.2893, 0.3434],
  [-0.3323, 0.3346],
  [-0.3534, 0.3684],
  [-0.343, 0.4114],
  [-0.3224, 0.4507],
  [-0.3101, 0.4915],
  [-0.3443, 0.5175],
  [-0.3882, 0.522],
  [-0.4319, 0.5146],
  [-0.4739, 0.5003],
  [-0.5125, 0.4784],
  [-0.5493, 0.4535],
  [-0.5847, 0.4267],
  [-0.6184, 0.3978],
  [-0.6504, 0.367],
  [-0.6803, 0.3342],
  [-0.7081, 0.2995],
  [-0.7336, 0.2631],
  [-0.7566, 0.2252],
  [-0.7775, 0.186],
  [-0.7965, 0.1458],
  [-0.8135, 0.1048],
  [-0.8283, 0.0629],
  [-0.8409, 0.0203],
  [-0.8511, -0.0229],
  [-0.859, -0.0666],
  [-0.8646, -0.1107],
  [-0.8677, -0.155],
  [-0.853, -0.1944],
  [-0.8103, -0.2057],
  [-0.7661, -0.2096],
  [-0.7217, -0.2084],
  [-0.6777, -0.2024],
  [-0.6342, -0.1936],
  [-0.5912, -0.1824],
  [-0.5489, -0.1688],
  [-0.5075, -0.1528],
  [-0.467, -0.1345],
  [-0.4277, -0.1139],
  [-0.3896, -0.0911],
  [-0.3528, -0.0662],
  [-0.3173, -0.0394],
  [-0.2833, -0.0108],
  [-0.2508, 0.0194],
  [-0.2198, 0.0512],
  [-0.1907, 0.0848],
  [-0.1632, 0.1196],
  [-0.1369, 0.1554],
  [-0.1114, 0.1918],
  [-0.0865, 0.2286],
  [-0.0618, 0.2655],
  [-0.0366, 0.3021],
  [-0.0106, 0.3381],
  [0.0164, 0.3734],
  [0.0446, 0.4077],
  [0.0741, 0.4409],
  [0.1052, 0.4726],
  [0.138, 0.5026],
  [0.1721, 0.531],
  [0.2077, 0.5576],
  [0.1894, 0.5679],
  [0.145, 0.5689],
  [0.1007, 0.5657],
  [0.0571, 0.5577],
  [0.015, 0.5436],
  [-0.0239, 0.5222],
  [0.0647, -0.0464],
  [0.0991, -0.0279],
  [0.0753, 0.0031],
  [0.305, 0.1115],
  [0.2624, 0.1235],
  [0.2188, 0.1174],
  [0.1814, 0.0939],
  [0.1527, 0.0606],
  [0.1444, 0.0173],
  [0.1493, -0.0267],
  [0.1319, -0.0661],
  [0.0925, -0.0851],
  [0.0493, -0.0929],
  [0.0446, -0.1299],
  [0.0829, -0.15],
  [0.1269, -0.1471],
  [0.168, -0.1306],
  [0.2032, -0.1037],
  [0.2352, -0.0729],
  [0.2634, -0.0386],
  [0.2886, -0.002],
  [0.3118, 0.0359],
  [0.3294, 0.0765],
];
const WHALE_ANCHOR = [-0.0667, -0.6525];
const TAU = Math.PI * 2;
const GLOW_COLORS = ['#f43f5e', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];
let cachedSeed;
let cachedShow;

function makeShow(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const rand = (lo, hi) => lo + random() * (hi - lo);
  // PR7's bounded Poisson scheduler, compressed to leave time for the finale.
  const launchAt = [0];
  let next = 0;
  while (launchAt.length < 6) {
    next += Math.min(1144, Math.max(208, -520 * Math.log(1 - random())));
    if (next >= 1800) break;
    launchAt.push(next);
  }
  const shells = launchAt.map((at) => {
    const family = Math.floor(rand(0, 7));
    const hue = rand(0, 360);
    const hue2 = random() < 0.5 ? (hue + rand(90, 200)) % 360 : hue;
    const power = rand(0.75, 1.25);
    const arms = Math.floor(rand(8, 13));
    const count = family === 4 ? arms * 12 : 140;
    const sparks = Array.from({ length: count }, (_, i) => {
      const ring = family === 3 || family === 6;
      const palm = family === 4;
      const angle = palm
        ? (Math.floor(i / 12) / arms) * TAU + rand(-0.06, 0.06)
        : ring
          ? (i / (family === 6 ? 70 : count)) * TAU + rand(-0.02, 0.02)
          : rand(0, TAU);
      const speed =
        power *
        (palm ? 0.35 + ((i % 12) / 12) * 0.75 : ring ? rand(0.94, 1.02) : Math.sqrt(rand(0.15, 1)));
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * (family === 3 ? 0.42 : 1),
        drag: family === 5 ? 0.92 : family === 2 ? 0.93 : 0.95,
        gravity: family === 5 ? 0.062 : 0.05,
        decay: (family === 5 ? 0.005 : palm ? 0.008 : 0.011) * rand(0.85, 1.15),
        hue: family === 5 ? 42 : i < 70 ? hue : hue2,
        size: palm ? 2.3 : rand(1.3, 2.2),
        flicker: rand(0.1, 0.4),
        phase: rand(0, TAU),
        crackle: family === 2 && random() < 0.35,
      };
    });
    return {
      at,
      x: rand(0.16, 0.84),
      y: rand(0.16, 0.4),
      drift: rand(-0.06, 0.06),
      flight: rand(560, 720),
      hue,
      sparks,
    };
  });
  const whale = WHALE_OUTLINE.map(([x, y]) => ({
    x,
    y,
    sx: rand(-0.06, 0.06),
    sy: rand(-0.06, 0.06),
    hue: random() < 0.16 ? rand(183, 200) : rand(212, 232),
    size: rand(1.5, 2.3),
    phase: rand(0, TAU),
    release: rand(3350, 3470),
    life: rand(1100, 1400),
  }));
  const fountain = Array.from({ length: 160 }, (_, i) => ({
    at: 2680 + (i % 10) * 18,
    angle: -Math.PI / 2 + rand(-0.34, 0.34),
    speed: rand(1.8, 6.2),
    life: rand(950, 1450),
    hue: rand(192, 214),
    size: rand(1.1, 2.1),
    phase: rand(0, TAU),
  }));
  return { shells, whale, fountain };
}

function sparkPosition(spark, age, power) {
  const drag = spark.drag;
  const travel = (1 - Math.pow(drag, age)) / (1 - drag);
  return [
    spark.vx * power * travel,
    spark.vy * power * travel + (spark.gravity * (age - travel)) / (1 - drag),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public v1 script entry, invoked by the host Worker.
function render(frame, fx) {
  if (!cachedShow || cachedSeed !== frame.seed) {
    cachedSeed = frame.seed;
    cachedShow = makeShow(frame.seed);
  }
  const { width, height, time, ctx } = frame;
  const unit = Math.min(width, height);
  const scale = Math.max(0.35, Math.min(1.35, unit / 900));
  const endFade = fx.clamp((5000 - time) / 350);
  if (time <= 0 || time >= 5000) return;
  // Source-over saturated cores plus navy rims remain legible on both themes;
  // the v1 frame intentionally has no DOM/theme access. Never paint a backdrop.
  const dot = (x, y, size, hue, alpha) => {
    if (alpha <= 0) return;
    // A fixed palette/radius reuses the host's bounded glow sprites instead of
    // rebuilding per-particle shadows. The saturated core/rim stays crisp on light pages.
    const glowColor =
      hue >= 183 && hue <= 232 ? '#3b82f6' : GLOW_COLORS[Math.floor(hue / 60) % GLOW_COLORS.length];
    fx.circle(x, y, 2.5, glowColor, alpha * endFade * 0.4, 6);
    ctx.globalAlpha = alpha * endFade;
    ctx.fillStyle = 'hsl(' + hue + ' 92% 58%)';
    ctx.strokeStyle = 'hsl(' + hue + ' 85% 29%)';
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
    ctx.stroke();
  };
  const rocket = (at, flight, x, y, drift, hue) => {
    const p = (time - at) / flight;
    if (p <= 0 || p >= 1) return;
    const position = (t) => [
      x + drift * (1 - t),
      height + 6 - (height + 6 - y) * (1 - (1 - t) ** 2),
    ];
    // Reconstruct a short trail rather than retaining previous canvas pixels.
    for (let i = 4; i >= 0; i--) {
      const t = Math.max(0, p - i * 0.035);
      const a = position(Math.max(0, t - 0.05));
      const b = position(t);
      fx.line(a[0], a[1], b[0], b[1], 'hsl(' + hue + ' 85% 48%)', 1.8, (1 - i / 5) * endFade);
    }
    const tip = position(p);
    dot(tip[0], tip[1], 2.3, hue, fx.clamp(p * 10));
  };
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const shell of cachedShow.shells) {
    const x = shell.x * width;
    const y = shell.y * height;
    rocket(shell.at, shell.flight, x, y, shell.drift * width, shell.hue);
    const age = (time - shell.at - shell.flight) / 8;
    if (age <= 0) continue;
    for (const spark of shell.sparks) {
      const life = 1 - age * spark.decay;
      if (life <= 0) continue;
      const p = sparkPosition(spark, age, 6 * scale);
      const previous = sparkPosition(spark, Math.max(0, age - 2.5), 6 * scale);
      const flicker = 1 - spark.flicker * (0.5 + 0.5 * Math.sin(age * 1.7 + spark.phase));
      const alpha = Math.min(1, life * 1.6) * flicker;
      fx.line(
        x + previous[0],
        y + previous[1],
        x + p[0],
        y + p[1],
        'hsl(' + spark.hue + ' 90% 48%)',
        spark.size * scale,
        alpha * endFade,
      );
      dot(x + p[0], y + p[1], Math.max(0.65, spark.size * scale), spark.hue, alpha);
      if (spark.crackle && life > 0.2)
        dot(x + p[0] + Math.sin(age) * 3, y + p[1] + Math.cos(age) * 3, 0.8, 45, alpha * 0.6);
    }
  }
  // The finale is unconditional, not a random splash roll or a tool parameter.
  const cx = width * 0.5;
  const cy = height * 0.38;
  const radius = unit * 0.25;
  rocket(1800, 600, cx, cy, 0, 215);
  if (time > 2400) {
    const form = fx.easeOut((time - 2400) / 280);
    for (const point of cachedShow.whale) {
      const fall = Math.max(0, time - point.release);
      const alpha = fx.clamp((time - 2400) / 120) * fx.clamp(1 - fall / point.life);
      const x = cx + (point.sx + (point.x - point.sx) * form) * radius;
      const y =
        cy + (point.sy + (point.y * 0.92 - point.sy) * form) * radius + (fall / 120) ** 2 * scale;
      dot(
        x,
        y,
        point.size * Math.max(0.65, scale),
        point.hue,
        alpha * (0.88 + 0.12 * Math.sin(time / 45 + point.phase)),
      );
    }
    const ax = cx + WHALE_ANCHOR[0] * radius;
    const ay = cy + WHALE_ANCHOR[1] * radius * 0.92;
    for (const spark of cachedShow.fountain) {
      const elapsed = time - spark.at;
      if (elapsed <= 0 || elapsed >= spark.life) continue;
      const t = elapsed / 8;
      const power = Math.min(1.4, radius / 170);
      const travel = (1 - Math.pow(0.992, t)) / 0.008;
      const x = ax + Math.cos(spark.angle) * spark.speed * power * travel;
      const y = ay + Math.sin(spark.angle) * spark.speed * power * travel + 0.05 * t * t * power;
      dot(
        x,
        y,
        spark.size * Math.max(0.6, scale),
        spark.hue,
        (1 - elapsed / spark.life) * (0.8 + 0.2 * Math.sin(time / 35 + spark.phase)),
      );
    }
  }
  ctx.restore();
}
