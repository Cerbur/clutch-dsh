import * as T from 'three';

export class Models {
  readonly geometries: T.BufferGeometry[] = [];
  readonly materials: T.Material[] = [];

  material(color: string, roughness = 0.72): T.MeshStandardMaterial {
    const value = new T.MeshStandardMaterial({ color, roughness });
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
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

export function buildKitchen(models: Models): T.Group {
  const room = new T.Group();
  const white = models.material('#f3f0e8');
  const wall = models.material('#e9e3d7');
  const wood = models.material('#d5b99a');
  const blue = models.material('#acc7d4');
  const dark = models.material('#4b6069');
  const metal = models.material('#a8b8bc', 0.35);
  const green = models.material('#95b69b');
  const yellow = models.material('#f2cf87');
  models.box(room, [5.7, 0.22, 4.7], [0, -0.15, 0], wood);
  models.box(room, [5.5, 0.05, 4.5], [0, 0, 0], white);
  models.box(room, [5.5, 2.9, 0.12], [0, 1.45, -2.2], wall);
  models.box(room, [0.12, 2.9, 4.4], [-2.7, 1.45, 0], wall);
  // Tile joints are geometry so the whitebox needs no external textures.
  for (let x = -2.4; x < 2.7; x += 0.6) models.box(room, [0.012, 0.005, 4.4], [x, 0.028, 0], wall);
  for (let z = -1.8; z < 2.2; z += 0.6) models.box(room, [5.4, 0.005, 0.012], [0, 0.029, z], wall);
  // Rear worktop with separate burners for two sessions.
  models.box(room, [3.7, 0.9, 0.8], [-0.65, 0.49, -1.68], white);
  models.box(room, [3.85, 0.09, 0.9], [-0.65, 0.98, -1.65], wood);
  for (const x of [-1.95, -1.2, -0.45, 0.3]) {
    models.box(room, [0.69, 0.72, 0.035], [x, 0.5, -1.25], blue);
    models.box(room, [0.22, 0.035, 0.06], [x, 0.74, -1.21], metal);
  }
  for (const x of [-1.35, 0.05]) {
    models.mesh(room, new T.CylinderGeometry(0.26, 0.26, 0.045, 24), dark, [x, 1.045, -1.6]);
    models.mesh(room, new T.CylinderGeometry(0.28, 0.18, 0.12, 24), metal, [x, 1.12, -1.6]);
    models.ball(room, 0.16, [x, 1.17, -1.6], green, [1, 0.25, 1]);
    models.box(room, [0.07, 0.05, 0.38], [x, 1.12, -1.22], dark);
  }
  models.box(room, [2.7, 0.13, 0.65], [-0.75, 2.25, -1.91], wood);
  for (let i = 0; i < 4; i++)
    models.mesh(room, new T.CylinderGeometry(0.18, 0.14, 0.055, 20), white, [
      0.12,
      2.35 + i * 0.052,
      -1.88,
    ]);
  models.box(room, [0.8, 0.52, 0.5], [-1.55, 2.52, -1.92], blue);
  // Refrigerator and its whale face.
  models.box(room, [1.05, 1.95, 0.98], [1.93, 1, -1.5], blue);
  models.box(room, [0.99, 1.12, 0.04], [1.93, 1.39, -0.99], white);
  models.box(room, [0.99, 0.65, 0.04], [1.93, 0.44, -0.99], blue);
  models.box(room, [0.055, 0.38, 0.07], [1.57, 1.47, -0.94], metal);
  models.ball(room, 0.19, [2.03, 1.42, -0.94], blue, [1, 0.65, 0.16]);
  for (const x of [1.96, 2.1]) models.ball(room, 0.018, [x, 1.45, -0.9], dark);
  // Window on the left wall.
  models.box(room, [0.04, 1.05, 1.2], [-2.62, 1.9, -0.35], wood);
  models.box(room, [0.045, 0.88, 1.03], [-2.59, 1.9, -0.35], models.material('#d6e6e8'));
  models.box(room, [0.05, 0.05, 1.05], [-2.55, 1.9, -0.35], white);
  models.box(room, [0.05, 0.91, 0.05], [-2.55, 1.9, -0.35], white);
  // Front preparation island leaves walking space between stations.
  models.box(room, [2.05, 0.75, 0.65], [0.6, 0.45, 1.55], blue);
  models.box(room, [2.2, 0.12, 0.8], [0.6, 0.9, 1.55], wood);
  models.box(room, [0.6, 0.04, 0.36], [0.45, 0.98, 1.55], white);
  for (const x of [0.3, 0.5, 0.67]) models.ball(room, 0.075, [x, 1.05, 1.55], yellow);
  models.mesh(room, new T.CylinderGeometry(0.15, 0.11, 0.2, 16), white, [1.27, 1.06, 1.54]);
  const plant = (x: number, y: number, z: number) => {
    models.mesh(room, new T.CylinderGeometry(0.15, 0.1, 0.2, 16), wood, [x, y, z]);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 0.4;
      const leaf = models.ball(
        room,
        0.16,
        [x + Math.sin(angle) * 0.1, y + 0.2, z + Math.cos(angle) * 0.1],
        green,
        [0.5, 1.2, 0.5],
      );
      leaf.rotation.z = Math.sin(angle) * 0.7;
    }
  };
  plant(1.93, 2.07, -1.5);
  plant(-0.75, 2.42, -1.9);
  // Whale-shaped floor mat and wall motif.
  models.ball(room, 0.55, [-1.55, 0.04, 1.15], blue, [1.35, 0.025, 0.72]);
  const fin = models.ball(room, 0.22, [-0.86, 0.04, 1.18], blue, [1, 0.06, 0.6]);
  fin.rotation.y = 0.7;
  models.ball(room, 0.035, [-1.85, 0.06, 1.2], dark);
  return room;
}

export interface WhaleGirl {
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
