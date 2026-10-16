import type { FireworksShowPreferences, FireworksSignal } from '../contract/index.js';
import { planShow } from './show-scheduler.js';
import { shellShape } from './shell-shapes.js';

/** Handle for one running show; dispose stops the loop and releases the canvas. */
export interface ShowHandle {
  dispose(): void;
}

interface ShowTheme {
  readonly fadeAlpha: number;
  readonly composite: GlobalCompositeOperation;
  readonly lightness: number;
}

const SHOW_THEMES: Record<'dark' | 'light', ShowTheme> = {
  dark: { fadeAlpha: 0.16, composite: 'lighter', lightness: 60 },
  light: { fadeAlpha: 0.22, composite: 'source-over', lightness: 46 },
};

/** Pick a palette from the page background luminance behind the overlay. */
export function detectShowTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  for (const element of [document.body, document.documentElement]) {
    const color = window.getComputedStyle(element).backgroundColor;
    const parts = color.match(/[\d.]+/g);
    if (parts === null || parts.length < 3) continue;
    if (parts.length >= 4 && Number(parts[3]) === 0) continue;
    const [r, g, b] = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? 'light' : 'dark';
  }
  return 'dark';
}

const TAU = Math.PI * 2;
const MAX_PARTICLES = 4200;
const ROCKET_G = 0.16;
const SHAPE_FORM_FRAMES = 28;
const QUIET_GRACE_MS = 300;

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const randInt = (min: number, max: number): number => Math.floor(rand(min, max + 1));
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

interface Spark {
  kind?: 'shape';
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  gravity: number;
  friction: number;
  life: number;
  decay: number;
  hue: number;
  sat: number;
  light: number;
  size: number;
  flicker: number;
  crackle: boolean;
  arm: boolean;
  streak: boolean;
  flash?: boolean;
  sx?: number;
  sy?: number;
  tx?: number;
  ty?: number;
  age?: number;
  form?: number;
  hold?: number;
}

interface Rocket {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  targetY: number;
  hue: number;
  splash: boolean;
}

/**
 * Mount one celebration show onto a transparent canvas. The show launches
 * rockets on the planned schedule inside the launch window, then reports
 * completion once every shell has burned out.
 */
export function mountFireworksShow(
  canvas: HTMLCanvasElement,
  signal: FireworksSignal,
  prefs: Pick<FireworksShowPreferences, 'showDurationMs' | 'showRatePerSec'>,
  onDone: () => void,
): ShowHandle {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    onDone();
    return { dispose: () => {} };
  }
  const theme = SHOW_THEMES[detectShowTheme()];
  const plan = planShow({
    windowMs: prefs.showDurationMs ?? 3_200,
    ratePerSec: prefs.showRatePerSec ?? 1.5,
    splash: signal.splash === true,
    random: Math.random,
  });
  const launchTimes =
    plan.splashAt === undefined ? plan.launchAt : [...plan.launchAt, plan.splashAt];
  const splashFlags = launchTimes.map((_, index) =>
    plan.splashAt === undefined ? false : index === launchTimes.length - 1,
  );

  let width = 0;
  let height = 0;
  const rockets: Rocket[] = [];
  const particles: Spark[] = [];
  const scheduled: { at: number; fn: () => void }[] = [];
  let nextLaunch = 0;
  let startedAt = performance.now();
  let quietSince: number | undefined;
  let finished = false;
  let raf = 0;
  let disposed = false;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function addParticle(p: Spark): void {
    if (particles.length < MAX_PARTICLES) particles.push(p);
  }

  function makeSpark(
    x: number,
    y: number,
    hue: number,
    opts: {
      angle: number;
      speed: number;
      gravity: number;
      friction: number;
      decay: number;
      sat: number;
      light: number;
      size: number;
      flicker: number;
      crackle: boolean;
      arm: boolean;
      streak: boolean;
    },
  ): Spark {
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

  function fountain(x: number, y: number, radius: number): void {
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

  function splashShell(x: number, y: number): void {
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
        hue: Math.random() < 0.16 ? rand(183, 200) : rand(212, 232),
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
      at: performance.now() + SHAPE_FORM_FRAMES * 16.667,
      fn: () => fountain(fx, fy, radius),
    });
  }

  function explode(x: number, y: number, hue: number, splash: boolean): void {
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

    const burst = (count: number, cfg: {
      hue: number; ring?: boolean; hollow?: boolean; gravity: number; friction: number;
      decay: number; sat: number; light: number; size: number; flicker: number;
      crackle?: boolean; squashY?: number;
    }): void => {
      for (let i = 0; i < count; i += 1) {
        const angle = cfg.ring ? (i / count) * TAU + rand(-0.02, 0.02) : rand(0, TAU);
        const speed = cfg.ring
          ? shell * rand(0.94, 1.02)
          : shell * (cfg.hollow ? Math.sqrt(rand(0.55, 1)) : rand(0.15, 1));
        addParticle(makeSpark(x, y, cfg.hue, {
          angle,
          speed,
          gravity: cfg.gravity,
          friction: cfg.friction,
          decay: cfg.decay * rand(0.85, 1.15),
          sat: cfg.sat,
          light: cfg.light,
          size: cfg.size * rand(0.7, 1.3),
          flicker: cfg.flicker,
          crackle: cfg.crackle === true && Math.random() < 0.35,
          arm: false,
          streak: true,
        }));
        const last = particles[particles.length - 1];
        if (last !== undefined && cfg.squashY !== undefined) last.vy *= cfg.squashY;
      }
    };

    const hue2 = Math.random() < 0.5 ? (hue + rand(90, 200)) % 360 : hue;
    switch (pick(['peony', 'peony', 'chrysanthemum', 'ring', 'palm', 'willow', 'double'] as const)) {
      case 'peony':
        burst(110, { hue, hollow: true, gravity: 0.05, friction: 0.95, decay: 0.011, sat: 95, light: L, size: 2.1, flicker: 0.15 });
        burst(40, { hue: hue2, hollow: false, gravity: 0.05, friction: 0.95, decay: 0.013, sat: 90, light: L + 8, size: 1.7, flicker: 0.2 });
        break;
      case 'chrysanthemum':
        burst(130, { hue, hollow: true, gravity: 0.055, friction: 0.93, decay: 0.009, sat: 95, light: L, size: 2, flicker: 0.35, crackle: true });
        break;
      case 'ring':
        burst(90, { hue, ring: true, gravity: 0.04, friction: 0.955, decay: 0.01, sat: 95, light: L, size: 2, flicker: 0.1, squashY: 0.42 });
        burst(14, { hue: hue2, hollow: false, gravity: 0.04, friction: 0.955, decay: 0.016, sat: 85, light: L + 10, size: 1.6, flicker: 0.2 });
        break;
      case 'palm': {
        const arms = randInt(8, 12);
        for (let a = 0; a < arms; a += 1) {
          const base = (a / arms) * TAU + rand(-0.05, 0.05);
          for (let i = 0; i < 14; i += 1) {
            addParticle(makeSpark(x, y, hue, {
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
            }));
          }
        }
        break;
      }
      case 'willow':
        burst(80, { hue: 42, hollow: true, gravity: 0.062, friction: 0.92, decay: 0.005, sat: 90, light: L, size: 1.9, flicker: 0.45 });
        break;
      case 'double':
        burst(70, { hue, ring: true, gravity: 0.045, friction: 0.95, decay: 0.011, sat: 95, light: L, size: 2, flicker: 0.12, squashY: 0.9 });
        burst(70, { hue: hue2, ring: true, gravity: 0.045, friction: 0.95, decay: 0.011, sat: 95, light: L, size: 2, flicker: 0.12, squashY: 0.9 });
        break;
    }
  }

  function launch(targetX: number, targetY: number, splash: boolean): void {
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

  let last = performance.now();

  function step(now: number): void {
    if (disposed) return;
    const dtMs = Math.min(50, now - last);
    last = now;
    const dt = Math.min(2.2, Math.max(0.2, dtMs / 16.667));

    while (nextLaunch < launchTimes.length && now - startedAt >= launchTimes[nextLaunch]!) {
      const splash = splashFlags[nextLaunch] === true;
      launch(
        splash ? width / 2 + rand(-width * 0.08, width * 0.08) : rand(width * 0.15, width * 0.85),
        splash ? height * rand(0.22, 0.32) : height * rand(0.12, 0.45),
        splash,
      );
      nextLaunch += 1;
    }

    for (let i = scheduled.length - 1; i >= 0; i -= 1) {
      if (now >= scheduled[i]!.at) {
        const due = scheduled[i]!;
        scheduled.splice(i, 1);
        due.fn();
      }
    }

    // fade previous frames toward transparency without touching the page
    ctx!.globalCompositeOperation = 'destination-out';
    ctx!.fillStyle = `rgba(0,0,0,${theme.fadeAlpha})`;
    ctx!.fillRect(0, 0, width, height);
    ctx!.globalCompositeOperation = theme.composite;

    for (let i = rockets.length - 1; i >= 0; i -= 1) {
      const r = rockets[i]!;
      r.px = r.x;
      r.py = r.y;
      r.vy += ROCKET_G * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;

      addParticle(makeSpark(r.x, r.y, r.hue, {
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
      }));

      ctx!.strokeStyle = `hsla(${r.hue},80%,${theme.lightness + 22}%,0.9)`;
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.moveTo(r.px, r.py);
      ctx!.lineTo(r.x, r.y);
      ctx!.stroke();

      if (r.vy >= -0.8 || r.y <= r.targetY) {
        explode(r.x, r.y, r.hue, r.splash);
        rockets.splice(i, 1);
      }
    }

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i]!;

      if (p.kind === 'shape') {
        p.age = (p.age ?? 0) + dt;
        let alpha: number;
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
        const fl = 1 - p.flicker * Math.random();
        ctx!.fillStyle = `hsla(${p.hue},${p.sat}%,${p.light}%,${Math.min(1, alpha * fl)})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, TAU);
        ctx!.fill();
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

      const flick = p.flicker > 0 ? 1 - p.flicker * Math.random() : 1;
      const alpha = Math.min(1, p.life * 1.6) * flick;
      const light = p.crackle && Math.random() < 0.12 ? p.light + 30 : p.light;

      if (p.flash === true) {
        const rr = p.size * p.life;
        const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        grad.addColorStop(0, `hsla(${p.hue},${p.sat}%,${light}%,${0.55 * p.life})`);
        grad.addColorStop(1, 'hsla(0,0%,0%,0)');
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, rr, 0, TAU);
        ctx!.fill();
        continue;
      }

      if (p.streak) {
        ctx!.strokeStyle = `hsla(${p.hue},${p.sat}%,${light}%,${alpha})`;
        ctx!.lineWidth = p.size;
        ctx!.lineCap = 'round';
        ctx!.beginPath();
        ctx!.moveTo(p.px, p.py);
        ctx!.lineTo(p.x, p.y);
        ctx!.stroke();
      } else {
        ctx!.fillStyle = `hsla(${p.hue},${p.sat}%,${light}%,${alpha})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, TAU);
        ctx!.fill();
      }

      if (p.arm && p.life > 0.35 && Math.random() < 0.18) {
        addParticle(makeSpark(p.x, p.y, p.hue, {
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
        }));
      }
    }

    if (nextLaunch >= launchTimes.length && rockets.length === 0 && particles.length === 0 && scheduled.length === 0) {
      if (quietSince === undefined) quietSince = now;
      else if (now - quietSince >= QUIET_GRACE_MS && !finished) {
        finished = true;
        ctx!.clearRect(0, 0, width, height);
        onDone();
      }
    } else {
      quietSince = undefined;
    }

    raf = requestAnimationFrame(step);
  }

  startedAt = performance.now();
  raf = requestAnimationFrame(step);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
