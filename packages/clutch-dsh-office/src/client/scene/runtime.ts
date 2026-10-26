import * as T from 'three';
import { advancePosition, planAction } from '../../office/actions.js';
import type { Actor } from '../../office/types.js';
import { Models, buildKitchen, buildWhaleGirl, type WhaleGirl } from './models.js';

export interface SceneRuntime {
  update(actors: readonly Actor[]): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface LiveActor {
  model: WhaleGirl;
  actor: Actor;
  models: Models;
  bubble: HTMLElement;
}

/** Owns one WebGL context; consumes presentation facts without touching DSH. */
export function createKitchenRuntime(
  container: HTMLElement,
  onFailure: (kind: 'webgl' | 'contextLost') => void,
): SceneRuntime {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor('#e6eef1', 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-4, 4, 4, -4, 0.1, 80);
  camera.position.set(7, 6.4, 8.5);
  camera.lookAt(0, 0.8, 0);
  const models = new Models();
  scene.add(buildKitchen(models));
  scene.add(new T.AmbientLight('#fff8ea', 2));
  const sun = new T.DirectionalLight('#fff1d6', 3.2);
  sun.position.set(1, 7, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
  sun.shadow.bias = -0.001;
  scene.add(sun);
  const fill = new T.DirectionalLight('#bcd9ed', 1.5);
  fill.position.set(-4, 4, -3);
  scene.add(fill);
  const actors = new Map<string, LiveActor>();
  let width = 1;
  let height = 1;
  let visible = true;
  let disposed = false;
  let failed = false;
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clock = new T.Vector3();

  const draw = (now: number) => {
    frame = 0;
    if (disposed || failed || !visible || document.hidden) return;
    const delta = last === 0 ? 0 : Math.min((now - last) / 1000, 0.06);
    last = now;
    elapsed += delta;
    for (const live of actors.values()) {
      const { model, actor } = live;
      const plan = planAction(actor.activity, actor.seat);
      const position = advancePosition(
        [model.root.position.x, model.root.position.z],
        plan.target,
        reduced.matches ? 100 : delta,
      );
      const moving = Math.hypot(position[0] - plan.target[0], position[1] - plan.target[1]) > 0.03;
      model.root.position.set(position[0], 0.04, position[1]);
      model.root.rotation.y = plan.pose === 'search' ? 1.3 : -0.35;
      const motion = reduced.matches ? 0 : Math.sin(elapsed * (moving ? 10 : 3));
      model.body.position.y = moving ? Math.abs(motion) * 0.045 : motion * 0.012;
      model.arm.rotation.x = moving
        ? motion * 0.4
        : plan.pose === 'cook'
          ? 1.1 + motion * 0.25
          : plan.pose === 'search'
            ? -1.1
            : 0;
      model.arm.rotation.z = plan.pose === 'wait' ? -1.3 : 0.15;
      model.tail.rotation.z = motion * 0.08;
      clock.set(position[0], 1.62, position[1]).project(camera);
      live.bubble.style.left = `${((clock.x + 1) * width) / 2}px`;
      live.bubble.style.top = `${((1 - clock.y) * height) / 2}px`;
    }
    renderer.render(scene, camera);
    if (!reduced.matches) frame = requestAnimationFrame(draw);
  };
  const schedule = () => {
    if (!frame && !disposed && !failed && visible && !document.hidden)
      frame = requestAnimationFrame(draw);
  };
  const pause = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };
  const visibility = () => {
    pause();
    schedule();
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    failed = true;
    pause();
    onFailure('contextLost');
  };
  const resize = new ResizeObserver(() => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    const vertical = Math.max(3.45, 3.8 / aspect);
    camera.left = -vertical * aspect;
    camera.right = vertical * aspect;
    camera.top = vertical;
    camera.bottom = -vertical;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    schedule();
  });
  container.prepend(renderer.domElement);
  resize.observe(container);
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', visibility);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  schedule();

  return {
    update(next) {
      const keep = new Set(next.map((actor) => actor.id));
      for (const [id, live] of actors) {
        if (keep.has(id)) continue;
        scene.remove(live.model.root);
        live.models.dispose();
        actors.delete(id);
      }
      for (const actor of next) {
        const current = actors.get(actor.id);
        if (current) {
          current.actor = actor;
          continue;
        }
        const actorModels = new Models();
        const model = buildWhaleGirl(actorModels, actor.seat);
        const bubble = container.querySelector<HTMLElement>(`[data-seat="${actor.seat}"]`);
        if (!bubble) {
          actorModels.dispose();
          continue;
        }
        model.root.position.set(actor.seat === 0 ? -1.7 : 0, 0.04, 0.7);
        scene.add(model.root);
        actors.set(actor.id, { model, actor, models: actorModels, bubble });
      }
      schedule();
    },
    setVisible(value) {
      visible = value;
      pause();
      schedule();
    },
    dispose() {
      disposed = true;
      pause();
      resize.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', visibility);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      for (const actor of actors.values()) actor.models.dispose();
      actors.clear();
      models.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
