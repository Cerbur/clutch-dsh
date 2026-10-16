import { FIREWORKS_LIMITS } from '../contract/index.js';

/** Launch schedule for one show: rocket liftoff times and the optional finale. */
export interface ShowPlan {
  readonly launchAt: readonly number[];
  readonly splashAt: number | undefined;
  readonly windowMs: number;
}

/**
 * Plan one show: a guaranteed first launch at t=0, then arrivals from a
 * truncated exponential (Poisson process) stream until the window closes,
 * capped at {@link FIREWORKS_LIMITS.maxLaunches}. A splash show adds one
 * finale launch at the window edge.
 */
export function planShow(options: {
  windowMs: number;
  ratePerSec: number;
  splash: boolean;
  random: () => number;
}): ShowPlan {
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

  const launchAt: number[] = [0];
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
