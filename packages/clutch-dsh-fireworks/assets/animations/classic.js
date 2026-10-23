// clutch_fireworks: {"version":1,"name":"鲸鱼烟花 · Whale Show","durationMs":5000}
/* global OffscreenCanvas -- Standard Canvas API provided by the animation Worker. */
// Faithful port of PR #7 and the supplied Canvas Show reference.
// Preserve its scheduler, shell parameters, simulation and transparent trail buffer.
// Only host-time seeking/compression and buffer lifetime are adapted to v1.
const TEMPLATE_THEME = 'dark'; // Preserve the reference palette and additive spark blending.
const FIREWORKS_LIMITS = {
  minDurationMs: 1500,
  maxDurationMs: 15000,
  minRatePerSec: 0.3,
  maxRatePerSec: 4,
  maxLaunches: 16,
};
let showClock = 0;
let showRandomState = 1;
function showRandom() {
  showRandomState = (Math.imul(showRandomState, 1664525) + 1013904223) >>> 0;
  return showRandomState / 4294967296;
}
const SHELL_OUTLINE = [
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
const SHELL_ANCHOR = [-0.0667, -0.6525];
/** Outline data for the splash shell. */
function shellShape() {
  return { points: SHELL_OUTLINE, anchor: SHELL_ANCHOR };
}

/**
 * Plan one show: a guaranteed first launch at t=0, then arrivals from a
 * truncated exponential (Poisson process) stream until the window closes,
 * capped at {@link FIREWORKS_LIMITS.maxLaunches}. A splash show adds one
 * finale launch at the window edge.
 */
function planShow(options) {
  const windowMs = Math.max(
    FIREWORKS_LIMITS.minDurationMs,
    Math.min(FIREWORKS_LIMITS.maxDurationMs, options.windowMs),
  );
  const ratePerSec = Math.max(
    FIREWORKS_LIMITS.minRatePerSec,
    Math.min(FIREWORKS_LIMITS.maxRatePerSec, options.ratePerSec),
  );
  const mean = 1000 / ratePerSec;
  const lo = Math.max(150, mean * 0.4);
  const hi = mean * 2.2;
  const launchAt = [0];
  let t = 0;
  while (launchAt.length < FIREWORKS_LIMITS.maxLaunches) {
    const draw = 1 - options.random();
    const gap = Math.min(hi, Math.max(lo, -mean * Math.log(draw)));
    t += gap;
    if (t >= windowMs) break;
    launchAt.push(t);
  }
  return {
    launchAt,
    splashAt: options.splash ? windowMs : undefined,
    windowMs,
  };
}

const SHOW_THEMES = {
  dark: { fadeAlpha: 0.16, composite: 'lighter', lightness: 60 },
  light: { fadeAlpha: 0.22, composite: 'source-over', lightness: 46 },
};
/** Pick a palette from the page background luminance behind the overlay. */
const TAU = Math.PI * 2;
const MAX_PARTICLES = 4200;
const ROCKET_G = 0.16;
const SHAPE_FORM_FRAMES = 28;
const QUIET_GRACE_MS = 300;
const rand = (min, max) => min + showRandom() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (list) => list[Math.floor(showRandom() * list.length)];
/**
 * Mount one celebration show onto a transparent canvas. The show launches
 * rockets on the planned schedule inside the launch window, then reports
 * completion once every shell has burned out.
 */
function createScene(ctx, initialWidth, initialHeight, onDone) {
  const drawingContext = ctx;
  let whaleFormedAt;
  const theme = SHOW_THEMES[TEMPLATE_THEME];
  const prefs = { showDurationMs: 3200, showRatePerSec: 1.5 };
  const plan = planShow({
    windowMs: prefs.showDurationMs ?? 3_200,
    ratePerSec: prefs.showRatePerSec ?? 1.5,
    splash: true,
    random: showRandom,
  });
  const launchTimes =
    plan.splashAt === undefined ? plan.launchAt : [...plan.launchAt, plan.splashAt];
  const splashFlags = launchTimes.map((_, index) =>
    plan.splashAt === undefined ? false : index === launchTimes.length - 1,
  );
  let width = initialWidth;
  let height = initialHeight;
  const rockets = [];
  const particles = [];
  const scheduled = [];
  let nextLaunch = 0;
  let startedAt = showClock;
  let quietSince;
  let finished = false;
  function resize(w, h) {
    width = w;
    height = h;
  }
  function addParticle(p) {
    if (particles.length < MAX_PARTICLES) particles.push(p);
  }
  function makeSpark(x, y, hue, opts) {
    return {
      x,
      y,
      px: x,
      py: y,
      vx: Math.cos(opts.angle) * opts.speed,
      vy: Math.sin(opts.angle) * opts.speed,
      gravity: opts.gravity,
      friction: opts.friction,
      life: 1,
      decay: opts.decay,
      hue,
      sat: opts.sat,
      light: opts.light,
      size: opts.size,
      flicker: opts.flicker,
      crackle: opts.crackle,
      arm: opts.arm,
      streak: opts.streak,
    };
  }
  function fountain(x, y, radius) {
    const L = theme.lightness;
    const power = Math.min(1.4, Math.max(0.7, radius / 170));
    for (let i = 0; i < 130; i += 1) {
      addParticle(
        makeSpark(x + rand(-3, 3), y, rand(192, 214), {
          angle: -Math.PI / 2 + rand(-0.34, 0.34),
          speed: rand(1.8, 6.2) * power,
          gravity: 0.1,
          friction: 0.992,
          decay: rand(0.008, 0.016),
          sat: rand(75, 95),
          light: L + rand(6, 20),
          size: rand(1.2, 2.2),
          flicker: 0.25,
          crackle: false,
          arm: false,
          streak: true,
        }),
      );
    }
    for (let i = 0; i < 30; i += 1) {
      addParticle(
        makeSpark(x + rand(-8, 8), y - rand(30, 90) * power, 198, {
          angle: rand(0, TAU),
          speed: rand(0.2, 1.2),
          gravity: 0.04,
          friction: 0.97,
          decay: rand(0.02, 0.04),
          sat: 22,
          light: L + 30,
          size: rand(0.8, 1.6),
          flicker: 0.6,
          crackle: false,
          arm: false,
          streak: false,
        }),
      );
    }
  }
  function splashShell(x, y) {
    whaleFormedAt = showClock + SHAPE_FORM_FRAMES * 16.667;
    const shape = shellShape();
    const radius = Math.min(width, height) * 0.19;
    for (const [ox, oy] of shape.points) {
      addParticle({
        kind: 'shape',
        x,
        y,
        px: x,
        py: y,
        vx: 0,
        vy: 0,
        gravity: 0,
        friction: 1,
        life: 1,
        decay: rand(0.012, 0.022),
        hue: showRandom() < 0.16 ? rand(183, 200) : rand(212, 232),
        sat: rand(88, 100),
        light: theme.lightness + rand(2, 10),
        size: rand(1.5, 2.3),
        flicker: rand(0.1, 0.3),
        crackle: false,
        arm: false,
        streak: false,
        sx: x + rand(-10, 10),
        sy: y + rand(-10, 10),
        tx: x + ox * radius,
        ty: y + oy * radius * 0.92,
        age: 0,
        form: SHAPE_FORM_FRAMES,
        hold: rand(4, 10),
      });
    }
    const fx = x + shape.anchor[0] * radius;
    const fy = y + shape.anchor[1] * radius * 0.92;
    scheduled.push({
      at: showClock + SHAPE_FORM_FRAMES * 16.667,
      fn: () => fountain(fx, fy, radius),
    });
  }
  function explode(x, y, hue, splash) {
    if (splash) {
      splashShell(x, y);
      return;
    }
    const scale = Math.max(0.55, Math.min(1.35, Math.min(width, height) / 900));
    const shell = rand(4, 8.5) * scale;
    const L = theme.lightness;
    addParticle({
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      gravity: 0,
      friction: 1,
      life: 1,
      decay: 0.14,
      hue,
      sat: 60,
      light: L + 25,
      size: 26 * scale,
      flicker: 0,
      crackle: false,
      arm: false,
      streak: false,
      flash: true,
    });
    const burst = (count, cfg) => {
      for (let i = 0; i < count; i += 1) {
        const angle = cfg.ring ? (i / count) * TAU + rand(-0.02, 0.02) : rand(0, TAU);
        const speed = cfg.ring
          ? shell * rand(0.94, 1.02)
          : shell * (cfg.hollow ? Math.sqrt(rand(0.55, 1)) : rand(0.15, 1));
        addParticle(
          makeSpark(x, y, cfg.hue, {
            angle,
            speed,
            gravity: cfg.gravity,
            friction: cfg.friction,
            decay: cfg.decay * rand(0.85, 1.15),
            sat: cfg.sat,
            light: cfg.light,
            size: cfg.size * rand(0.7, 1.3),
            flicker: cfg.flicker,
            crackle: cfg.crackle === true && showRandom() < 0.35,
            arm: false,
            streak: true,
          }),
        );
        const last = particles[particles.length - 1];
        if (last !== undefined && cfg.squashY !== undefined) last.vy *= cfg.squashY;
      }
    };
    const hue2 = showRandom() < 0.5 ? (hue + rand(90, 200)) % 360 : hue;
    switch (pick(['peony', 'peony', 'chrysanthemum', 'ring', 'palm', 'willow', 'double'])) {
      case 'peony':
        burst(110, {
          hue,
          hollow: true,
          gravity: 0.05,
          friction: 0.95,
          decay: 0.011,
          sat: 95,
          light: L,
          size: 2.1,
          flicker: 0.15,
        });
        burst(40, {
          hue: hue2,
          hollow: false,
          gravity: 0.05,
          friction: 0.95,
          decay: 0.013,
          sat: 90,
          light: L + 8,
          size: 1.7,
          flicker: 0.2,
        });
        break;
      case 'chrysanthemum':
        burst(130, {
          hue,
          hollow: true,
          gravity: 0.055,
          friction: 0.93,
          decay: 0.009,
          sat: 95,
          light: L,
          size: 2,
          flicker: 0.35,
          crackle: true,
        });
        break;
      case 'ring':
        burst(90, {
          hue,
          ring: true,
          gravity: 0.04,
          friction: 0.955,
          decay: 0.01,
          sat: 95,
          light: L,
          size: 2,
          flicker: 0.1,
          squashY: 0.42,
        });
        burst(14, {
          hue: hue2,
          hollow: false,
          gravity: 0.04,
          friction: 0.955,
          decay: 0.016,
          sat: 85,
          light: L + 10,
          size: 1.6,
          flicker: 0.2,
        });
        break;
      case 'palm': {
        const arms = randInt(8, 12);
        for (let a = 0; a < arms; a += 1) {
          const base = (a / arms) * TAU + rand(-0.05, 0.05);
          for (let i = 0; i < 14; i += 1) {
            addParticle(
              makeSpark(x, y, hue, {
                angle: base + rand(-0.06, 0.06),
                speed: shell * (0.35 + (i / 14) * 0.75),
                gravity: 0.05,
                friction: 0.94,
                decay: 0.008,
                sat: 95,
                light: L,
                size: 2.6,
                flicker: 0.2,
                crackle: false,
                arm: true,
                streak: true,
              }),
            );
          }
        }
        break;
      }
      case 'willow':
        burst(80, {
          hue: 42,
          hollow: true,
          gravity: 0.062,
          friction: 0.92,
          decay: 0.005,
          sat: 90,
          light: L,
          size: 1.9,
          flicker: 0.45,
        });
        break;
      case 'double':
        burst(70, {
          hue,
          ring: true,
          gravity: 0.045,
          friction: 0.95,
          decay: 0.011,
          sat: 95,
          light: L,
          size: 2,
          flicker: 0.12,
          squashY: 0.9,
        });
        burst(70, {
          hue: hue2,
          ring: true,
          gravity: 0.045,
          friction: 0.95,
          decay: 0.011,
          sat: 95,
          light: L,
          size: 2,
          flicker: 0.12,
          squashY: 0.9,
        });
        break;
    }
  }
  function launch(targetX, targetY, splash) {
    const startX = targetX + rand(-60, 60);
    const startY = height + 6;
    const rise = Math.max(60, startY - targetY);
    const vy0 = -Math.sqrt(2 * ROCKET_G * rise);
    const flight = -vy0 / ROCKET_G;
    rockets.push({
      x: startX,
      y: startY,
      px: startX,
      py: startY,
      vx: (targetX - startX) / flight,
      vy: vy0,
      targetY,
      hue: splash ? rand(208, 228) : rand(0, 360),
      splash,
    });
  }
  let last = showClock;
  function step(now, paint = true) {
    ctx = paint ? drawingContext : SILENT_CONTEXT;
    const dtMs = Math.min(50, now - last);
    last = now;
    const dt = Math.min(2.2, Math.max(0.2, dtMs / 16.667));
    while (nextLaunch < launchTimes.length && now - startedAt >= launchTimes[nextLaunch]) {
      const splash = splashFlags[nextLaunch] === true;
      launch(
        splash ? width / 2 + rand(-width * 0.08, width * 0.08) : rand(width * 0.15, width * 0.85),
        splash ? height * rand(0.22, 0.32) : height * rand(0.12, 0.45),
        splash,
      );
      nextLaunch += 1;
    }
    for (let i = scheduled.length - 1; i >= 0; i -= 1) {
      if (now >= scheduled[i].at) {
        const due = scheduled[i];
        scheduled.splice(i, 1);
        due.fn();
      }
    }
    if (paint) {
      // fade previous frames toward transparency without touching the page
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${theme.fadeAlpha})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = theme.composite;
    }
    for (let i = rockets.length - 1; i >= 0; i -= 1) {
      const r = rockets[i];
      r.px = r.x;
      r.py = r.y;
      r.vy += ROCKET_G * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      addParticle(
        makeSpark(r.x, r.y, r.hue, {
          angle: rand(0, TAU),
          speed: rand(0, 0.7),
          gravity: 0.01,
          friction: 0.95,
          decay: 0.06,
          sat: 70,
          light: theme.lightness + 18,
          size: 1.4,
          flicker: 0.5,
          crackle: false,
          arm: false,
          streak: false,
        }),
      );
      if (paint) {
        ctx.strokeStyle = `hsla(${r.hue},80%,${theme.lightness + 22}%,0.9)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(r.px, r.py);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
      }
      if (r.vy >= -0.8 || r.y <= r.targetY) {
        explode(r.x, r.y, r.hue, r.splash);
        rockets.splice(i, 1);
      }
    }
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      if (p.kind === 'shape') {
        p.age = (p.age ?? 0) + dt;
        let alpha;
        if (p.age < (p.form ?? 0)) {
          const t = p.age / (p.form ?? 1);
          const e = 1 - Math.pow(1 - t, 3);
          p.x = (p.sx ?? p.x) + ((p.tx ?? p.x) - (p.sx ?? p.x)) * e;
          p.y = (p.sy ?? p.y) + ((p.ty ?? p.y) - (p.sy ?? p.y)) * e;
          alpha = Math.min(1, t * 2.2);
        } else if (p.age < (p.form ?? 0) + (p.hold ?? 0)) {
          p.x = (p.tx ?? p.x) + rand(-0.4, 0.4);
          p.y = (p.ty ?? p.y) + rand(-0.4, 0.4);
          alpha = 1;
        } else {
          p.vy += 0.02 * dt;
          p.x = (p.tx ?? p.x) + rand(-0.5, 0.5);
          p.y += p.vy * dt;
          p.life -= p.decay * dt;
          if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
          }
          alpha = p.life;
        }
        const fl = 1 - p.flicker * showRandom();
        if (paint) {
          ctx.fillStyle = `hsla(${p.hue},${p.sat}%,${p.light}%,${Math.min(1, alpha * fl)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
        }
        continue;
      }
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.px = p.x;
      p.py = p.y;
      p.vx *= Math.pow(p.friction, dt);
      p.vy = p.vy * Math.pow(p.friction, dt) + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const flick = p.flicker > 0 ? 1 - p.flicker * showRandom() : 1;
      const alpha = Math.min(1, p.life * 1.6) * flick;
      const light = p.crackle && showRandom() < 0.12 ? p.light + 30 : p.light;
      if (p.flash === true) {
        if (paint) {
          const rr = p.size * p.life;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
          grad.addColorStop(0, `hsla(${p.hue},${p.sat}%,${light}%,${0.55 * p.life})`);
          grad.addColorStop(1, 'hsla(0,0%,0%,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, TAU);
          ctx.fill();
        }
        continue;
      }
      if (paint) {
        if (p.streak) {
          ctx.strokeStyle = `hsla(${p.hue},${p.sat}%,${light}%,${alpha})`;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = `hsla(${p.hue},${p.sat}%,${light}%,${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
        }
      }
      if (p.arm && p.life > 0.35 && showRandom() < 0.18) {
        addParticle(
          makeSpark(p.x, p.y, p.hue, {
            angle: rand(0, TAU),
            speed: rand(0.1, 0.9),
            gravity: 0.03,
            friction: 0.96,
            decay: 0.03,
            sat: 90,
            light: p.light + 6,
            size: 1.2,
            flicker: 0.4,
            crackle: false,
            arm: false,
            streak: false,
          }),
        );
      }
    }
    if (
      nextLaunch >= launchTimes.length &&
      rockets.length === 0 &&
      particles.length === 0 &&
      scheduled.length === 0
    ) {
      if (quietSince === undefined) quietSince = now;
      else if (now - quietSince >= QUIET_GRACE_MS && !finished) {
        finished = true;
        ctx.clearRect(0, 0, width, height);
        onDone();
      }
    } else {
      quietSince = undefined;
    }
  }
  startedAt = showClock;
  return {
    step,
    resize,
    stats: () => ({
      particles: particles.length,
      rockets: rockets.length,
      pending: scheduled.length,
      launched: nextLaunch,
      complete: finished,
      whaleFormedAt,
    }),
  };
}

// A no-paint pass advances the *same* particle simulation and random consumption.
// It is used to measure its complete timeline and to seek without rasterizing
// hundreds of obsolete full-screen frames. It never approximates the physics.
const NOOP = () => {};
const SILENT_CONTEXT = {
  setTransform: NOOP,
  clearRect: NOOP,
  fillRect: NOOP,
  beginPath: NOOP,
  moveTo: NOOP,
  lineTo: NOOP,
  stroke: NOOP,
  arc: NOOP,
  fill: NOOP,
  createRadialGradient: () => ({ addColorStop: NOOP }),
};
const FIXED_STEP_MS = 16.667;
// Normal playback retains the complete original buffer at host DPR. Only a
// cold seek / resize / large gap reconstructs its recent trail window. The
// discarded ideal contribution is < .024%; native 8-bit rounding can retain
// additional faint ghosts, so seek output is intentionally not bit-identical.
const TRAIL_REPLAY_TICKS = 48;
const SEEK_PIXEL_BUDGET = 2_000_000;
let trailCanvas, trailContext, scene;
let surfaceKey, playbackSeed, timeline;
let simulationTick = 0;
let trailDpr;

function sizeTrail(frame, seek) {
  trailDpr = Math.min(
    frame.dpr,
    seek ? Math.sqrt(SEEK_PIXEL_BUDGET / (frame.width * frame.height)) : frame.dpr,
  );
  trailCanvas.width = Math.max(1, Math.floor(frame.width * trailDpr));
  trailCanvas.height = Math.max(1, Math.floor(frame.height * trailDpr));
  trailContext.setTransform(trailDpr, 0, 0, trailDpr, 0, 0);
}

function resetSimulation(frame) {
  showClock = 0;
  showRandomState = frame.seed >>> 0;
  simulationTick = 0;
  trailContext.clearRect(0, 0, frame.width, frame.height);
  // clearRect keeps drawing state; do not inherit rounded spark caps on replay.
  trailContext.lineCap = 'butt';
  scene = createScene(trailContext, frame.width, frame.height, NOOP);
}
function measureTimeline(frame) {
  showClock = 0;
  showRandomState = frame.seed >>> 0;
  const probe = createScene(SILENT_CONTEXT, frame.width, frame.height, NOOP);
  // Latest launch + conservative full-height ballistic flight + the slowest
  // willow/child/fountain burn and quiet grace. Never truncate to an 8s guess.
  const flightMs = Math.sqrt((2 * (frame.height + 6)) / ROCKET_G) * FIXED_STEP_MS;
  const limit = Math.ceil((3200 + flightMs + 6000) / FIXED_STEP_MS);
  for (let tick = 1; tick <= limit; tick++) {
    showClock = tick * FIXED_STEP_MS;
    probe.step(showClock, false);
    const stats = probe.stats();
    if (stats.complete) {
      if (!Number.isFinite(stats.whaleFormedAt)) throw new Error('Whale finale did not form');
      return { endTick: tick, whaleTick: Math.ceil(stats.whaleFormedAt / FIXED_STEP_MS) };
    }
  }
  throw new Error('Fireworks simulation exceeded its completion bound');
}
function timeToTick(time) {
  // Both halves are accelerated original time, not new launch/particle timings.
  // Anchor the host midpoint on the fully formed whale, so reduced motion also
  // shows the finale; reserve the whole second half for its fountain and burnout.
  const tick =
    time <= 2500
      ? (timeline.whaleTick * Math.max(0, time)) / 2500
      : timeline.whaleTick +
        (timeline.endTick - timeline.whaleTick) * Math.min(1, (time - 2500) / 2500);
  return Math.floor(tick + 1e-9);
}
function releaseTrail() {
  if (trailCanvas) {
    trailCanvas.width = 0;
    trailCanvas.height = 0;
  }
  trailCanvas = trailContext = scene = undefined;
  surfaceKey = playbackSeed = timeline = undefined;
  simulationTick = 0;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public v1 script entry, invoked by the host Worker.
function render(frame) {
  if (frame.time >= 5000) {
    releaseTrail();
    return;
  }
  const key = [frame.width, frame.height, frame.dpr, frame.seed >>> 0].join(':');
  if (key !== surfaceKey) {
    const sameScene =
      playbackSeed === frame.seed >>> 0 &&
      surfaceKey?.split(':').slice(0, 2).join(':') === [frame.width, frame.height].join(':');
    const previousTimeline = sameScene ? timeline : undefined;
    releaseTrail();
    surfaceKey = key;
    playbackSeed = frame.seed >>> 0;
    trailCanvas = new OffscreenCanvas(1, 1);
    trailContext = trailCanvas.getContext('2d');
    if (!trailContext) throw new Error('Trail Canvas 2D unavailable');
    sizeTrail(frame, frame.time > 0);
    timeline = previousTimeline ?? measureTimeline(frame);
    resetSimulation(frame);
  }
  const target = timeToTick(frame.time);
  if (target < simulationTick) resetSimulation(frame);
  const paintFrom = target - TRAIL_REPLAY_TICKS;
  if (simulationTick < paintFrom) {
    if (trailCanvas.width * trailCanvas.height > SEEK_PIXEL_BUDGET) sizeTrail(frame, true);
    trailContext.clearRect(0, 0, frame.width, frame.height);
  }
  while (simulationTick < target) {
    simulationTick++;
    showClock = simulationTick * FIXED_STEP_MS;
    scene.step(showClock, simulationTick > paintFrom);
  }
  frame.ctx.save();
  frame.ctx.globalCompositeOperation = 'source-over';
  frame.ctx.globalAlpha = Math.max(0, Math.min(1, (5000 - frame.time) / 250));
  frame.ctx.drawImage(trailCanvas, 0, 0, frame.width, frame.height);
  frame.ctx.restore();
}
