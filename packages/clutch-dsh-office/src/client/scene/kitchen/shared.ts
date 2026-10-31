import * as T from 'three';
import { OFFICE_STYLE } from './style.js';
import type { Models } from '../models.js';

export function createKitchenPalette(models: Models) {
  const color = OFFICE_STYLE.palette;
  const material = (hex: string, roughness: number, metallic = 0) => {
    const value = models.material(hex, roughness);
    value.metalness = metallic;
    return value;
  };
  return {
    white: material(color.cream, 0.48),
    wall: material(color.wall, 0.65),
    wood: material(color.wood, 0.56),
    blue: material(color.cabinetBlue, 0.45),
    dark: material(color.dark, 0.5),
    metal: material(color.metal, 0.42, 0.65),
    green: material(color.leaf, 0.55),
    yellow: material(color.gold, 0.45, 0.12),
    glass: material(color.fridgeBlue, 0.42),
  };
}

export type KitchenPalette = ReturnType<typeof createKitchenPalette>;

export function plant(
  models: Models,
  parent: T.Group,
  palette: KitchenPalette,
  [x, y, z]: readonly [number, number, number],
): void {
  models.mesh(parent, new T.CylinderGeometry(0.15, 0.1, 0.2, 16), palette.wood, [x, y, z]);
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 0.4;
    const leaf = models.ball(
      parent,
      0.16,
      [x + Math.sin(angle) * 0.1, y + 0.2, z + Math.cos(angle) * 0.1],
      palette.green,
      [0.5, 1.2, 0.5],
    );
    leaf.rotation.z = Math.sin(angle) * 0.7;
  }
}
