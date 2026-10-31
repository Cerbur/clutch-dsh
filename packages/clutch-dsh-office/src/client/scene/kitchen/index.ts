import * as T from 'three';
import type { Models } from '../models.js';
import { buildFloor } from './floor.js';
import { buildLeftWall } from './left-wall.js';
import { buildRightWall } from './right-wall.js';
import { buildStove } from './stove.js';
import { buildTable } from './table.js';
import { buildRefrigerator } from './refrigerator.js';
import { createKitchenPalette } from './shared.js';
import { buildStorageCabinet } from './storage-cabinet.js';
import { buildSinkCabinet } from './sink-cabinet.js';
import { buildPendantLight } from './pendant-light.js';
import { buildUtensilRail } from './utensil-rail.js';
import { buildWallCabinet } from './wall-cabinet.js';
import { buildRangeHood } from './range-hood.js';
import { buildWallShelf } from './wall-shelf.js';
import { buildWallArt } from './wall-art.js';
import { buildWindow } from './window.js';
import { buildWhaleMitt } from './whale-mitt.js';
import { buildWallClock } from './wall-clock.js';
import { buildBoardCloth } from './board-cloth.js';
import { buildWallCalendar } from './wall-calendar.js';
import { buildWallPlants } from './wall-plant.js';
import { buildChairs } from './chair.js';
import { buildFloorMat } from './floor-mat.js';
import { buildRug } from './rug.js';
import { buildTrashCan } from './trash-can.js';
import { buildSpiceRack } from './spice-rack.js';
import { buildOpenCubby } from './open-cubby.js';
import { buildBlackUtensilRail } from './black-utensil-rail.js';
import { buildWallStorageBox } from './wall-storage-box.js';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
} from '../../../office/kitchen-layout.js';

/** Compose independently replaceable models. All coordinates use Y-up world units. */
export function buildKitchen(models: Models): T.Group {
  const room = new T.Group();
  room.name = 'kitchen';
  const palette = createKitchenPalette(models);
  const floor = buildFloor(models, palette);
  // Wall thickness grows outward; the existing interior planes remain fixed.
  const leftWall = buildLeftWall(models, palette);
  const rightWall = buildRightWall(models, palette);
  const stove = buildStove(models, palette);
  const table = buildTable(models, palette);
  const refrigerator = buildRefrigerator(models, palette);
  const cabinet = buildStorageCabinet(models, palette);
  const sink = buildSinkCabinet(models, palette);
  const pendant = buildPendantLight(models, palette);
  const rail = buildUtensilRail(models, palette);
  const wallCabinet = buildWallCabinet(models, palette);
  const hood = buildRangeHood(models, palette);
  const shelf = buildWallShelf(models, palette);
  const art = buildWallArt(models, palette);
  const window = buildWindow(models, palette);
  const mitt = buildWhaleMitt(models, palette);
  const clock = buildWallClock(models, palette);
  const boardCloth = buildBoardCloth(models, palette);
  const calendar = buildWallCalendar(models, palette);
  const rug = buildRug(models, palette);
  const trashCan = buildTrashCan(models, palette);
  for (const model of [
    floor,
    leftWall,
    rightWall,
    stove,
    table,
    refrigerator,
    cabinet,
    sink,
    pendant,
    rail,
    wallCabinet,
    hood,
    shelf,
    art,
    window,
    mitt,
    clock,
    boardCloth,
    calendar,
    rug,
    buildFloorMat(models, palette),
    trashCan,
    buildSpiceRack(models, palette),
    buildOpenCubby(models, palette),
    buildBlackUtensilRail(models, palette),
    buildWallStorageBox(models, palette),
  ]) {
    const position = KITCHEN_PLACEMENT[model.name as keyof typeof KITCHEN_PLACEMENT];
    model.position.set(position[0], position[1], position[2]);
    const rotation = KITCHEN_ROTATION[model.name as keyof typeof KITCHEN_ROTATION];
    if (rotation) model.rotation.y = rotation;
    const scale = KITCHEN_SCALE[model.name as keyof typeof KITCHEN_PLACEMENT];
    if (scale) model.scale.set(...scale);
    room.add(model);
  }
  room.add(buildChairs(models, palette));
  room.add(buildWallPlants(models, palette));
  return room;
}
