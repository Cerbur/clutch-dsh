import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/wall-calendar.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const load = bundledAsset('wall-calendar', bytes);

/** Static wall decoration; authored bottom/rear-plane origin, no live clock/calendar. */
export function buildWallCalendar(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [0.38, 0.48, 0.06], [0, 0.24, 0.03], palette.wood);
  return load(models, fallback);
}
