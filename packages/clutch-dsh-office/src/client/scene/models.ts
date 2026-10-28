import * as T from 'three';
import { configureKitchenMaterial } from './area-shadow.js';

export class Models {
  readonly geometries: T.BufferGeometry[] = [];
  readonly materials: T.Material[] = [];
  private readonly textures = new Set<T.Texture>();
  private readonly releasedTextures = new WeakSet<T.Texture>();
  private readonly closedImages = new WeakSet<object>();
  private closed = false;

  constructor(
    private readonly onChange: () => void = () => {},
    private readonly dynamicShadowCaster = false,
  ) {}

  get disposed(): boolean {
    return this.closed;
  }

  invalidate(): void {
    if (!this.closed) this.onChange();
  }

  /** Take ownership of a parsed GLB, including late arrivals after scene teardown. */
  ownObject(object: T.Object3D): boolean {
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    const textures = new Set<T.Texture>();
    object.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      if (this.dynamicShadowCaster) child.layers.enable(1);
      child.castShadow = true;
      child.receiveShadow = true;
      geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        configureKitchenMaterial(material);
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof T.Texture) textures.add(value);
        }
      }
    });
    if (this.closed) {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      this.releaseTextures(textures);
      return false;
    }
    for (const geometry of geometries)
      if (!this.geometries.includes(geometry)) this.geometries.push(geometry);
    for (const material of materials)
      if (!this.materials.includes(material)) this.materials.push(material);
    for (const texture of textures) this.textures.add(texture);
    return true;
  }

  /** Register per-room atlas textures, including arrivals after teardown. */
  ownTexture(texture: T.Texture): boolean {
    if (this.textures.has(texture)) return !this.closed;
    if (this.closed) {
      this.releaseTextures([texture]);
      return false;
    }
    this.textures.add(texture);
    return true;
  }

  private releaseTextures(textures: Iterable<T.Texture>): void {
    const images = new Set<{ close(): void }>();
    for (const texture of textures) {
      if (this.releasedTextures.has(texture)) continue;
      this.releasedTextures.add(texture);
      texture.dispose();
      const image = texture.source.data;
      if (image && typeof image.close === 'function' && !this.closedImages.has(image))
        images.add(image);
    }
    for (const image of images) {
      this.closedImages.add(image);
      image.close();
    }
  }

  material(color: string, roughness = 0.72): T.MeshStandardMaterial {
    const value = new T.MeshStandardMaterial({ color, roughness });
    configureKitchenMaterial(value);
    this.materials.push(value);
    return value;
  }

  mesh(
    parent: T.Object3D,
    geometry: T.BufferGeometry,
    material: T.Material,
    position: readonly [number, number, number],
  ): T.Mesh {
    this.geometries.push(geometry);
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(...position);
    if (this.dynamicShadowCaster) mesh.layers.enable(1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(
    parent: T.Object3D,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: T.Material,
  ): T.Mesh {
    return this.mesh(parent, new T.BoxGeometry(...size), material, position);
  }

  ball(
    parent: T.Object3D,
    radius: number,
    position: readonly [number, number, number],
    material: T.Material,
    scale: readonly [number, number, number] = [1, 1, 1],
  ): T.Mesh {
    const ball = this.mesh(parent, new T.SphereGeometry(radius, 16, 12), material, position);
    ball.scale.set(...scale);
    return ball;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.releaseTextures(this.textures);
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.clear();
  }
}

export interface CharacterAppearance {
  root: T.Group;
  body: T.Object3D;
  arm?: T.Group;
  tail?: T.Group;
}

export interface WhaleGirl extends CharacterAppearance {
  readonly root: T.Group;
  readonly body: T.Group;
  readonly arm: T.Group;
  readonly tail: T.Group;
}

export function buildWhaleGirl(models: Models, seat: 0 | 1): WhaleGirl {
  const root = new T.Group();
  const body = new T.Group();
  root.add(body);
  const hair = models.material(seat === 0 ? '#85b6d6' : '#9bbfbb');
  const dress = models.material(seat === 0 ? '#779bb9' : '#7ea89f');
  const skin = models.material('#f5dfcb');
  const white = models.material('#fbf7ee');
  const eyes = models.material('#385b74');
  const cheek = models.material('#e7b8b5');
  for (const x of [-0.13, 0.13]) {
    models.mesh(body, new T.CylinderGeometry(0.075, 0.07, 0.35, 12), white, [x, 0.32, 0]);
    models.ball(body, 0.12, [x, 0.12, 0.07], dress, [0.85, 0.65, 1.3]);
  }
  models.mesh(body, new T.CylinderGeometry(0.18, 0.36, 0.57, 16), dress, [0, 0.76, 0]);
  models.ball(body, 0.25, [0, 0.76, 0.22], white, [0.85, 1.05, 0.27]);
  models.box(body, [0.48, 0.06, 0.35], [0, 0.95, 0], white);
  models.ball(body, 0.35, [0, 1.32, -0.05], hair, [1, 1.13, 0.95]);
  models.ball(body, 0.3, [0, 1.3, 0.11], skin, [0.97, 1.02, 0.8]);
  models.ball(body, 0.34, [0, 1.47, 0], hair, [1.02, 0.72, 1]);
  for (const x of [-0.1, 0.1]) {
    models.ball(body, 0.05, [x, 1.31, 0.345], eyes, [0.75, 1.25, 0.3]);
    models.ball(body, 0.016, [x - 0.008, 1.33, 0.36], white);
    models.ball(body, 0.055, [x * 1.75, 1.23, 0.31], cheek, [1, 0.45, 0.2]);
  }
  models.ball(body, 0.027, [0, 1.2, 0.351], cheek, [0.9, 0.4, 0.25]);
  for (const x of [-0.32, 0.32]) {
    models.ball(body, 0.18, [x, 1.08, -0.07], hair, [0.75, 2.1, 0.9]);
    models.ball(body, 0.07, [x, 1.32, 0.03], white);
  }
  // Tiny whale hair clip.
  models.ball(body, 0.09, [0.25, 1.49, 0.24], white, [1.15, 0.7, 0.45]);
  models.ball(body, 0.013, [0.225, 1.5, 0.28], eyes);
  const arm = new T.Group();
  arm.position.set(-0.23, 1.01, 0);
  body.add(arm);
  models.mesh(arm, new T.CylinderGeometry(0.075, 0.055, 0.34, 12), skin, [0, -0.13, 0]);
  models.ball(arm, 0.08, [0, -0.3, 0], skin);
  const other = models.mesh(
    body,
    new T.CylinderGeometry(0.075, 0.06, 0.3, 12),
    skin,
    [0.28, 0.87, 0.06],
  );
  other.rotation.z = 0.25;
  const tail = new T.Group();
  tail.position.set(0, 0.62, -0.15);
  body.add(tail);
  models.ball(tail, 0.2, [0.25, 0.03, -0.21], hair, [1.5, 0.6, 0.7]);
  for (const x of [0.39, 0.57]) {
    const lobe = models.ball(tail, 0.16, [x, 0.16, -0.25], hair, [0.7, 1.25, 0.3]);
    lobe.rotation.z = x < 0.5 ? 0.65 : -0.65;
  }
  root.scale.setScalar(0.85);
  return { root, body, arm, tail };
}
