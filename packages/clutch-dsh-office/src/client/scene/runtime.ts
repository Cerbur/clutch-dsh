import * as T from 'three';
import './baked-assets.js';
import { kitchenActorGroundY } from '../../office/kitchen-layout.js';
import { planAction } from '../../office/actions.js';
import {
  createKitchenMotion,
  advanceKitchenMotion,
  type KitchenMotion,
} from '../../office/kitchen-motion.js';
import {
  ROAM_SCALE,
  createRoamingMotion,
  advanceRoamingMotion,
  type RoamingMotion,
} from '../../office/roaming.js';
import type { Actor } from '../../office/types.js';
import { Models, type CharacterAppearance } from './models.js';
import { buildKitchen } from './kitchen/index.js';
import { createKitchenCamera, resizeKitchenCamera } from './camera.js';
import { buildDeepSeek } from './character/deepseek.js';
import { createKitchenLighting } from './lighting.js';
import { createKitchenRenderGuard } from './render-failure.js';

export interface SceneRuntime {
  update(actors: readonly Actor[]): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface LiveActor {
  motion: KitchenMotion;
  roaming?: RoamingMotion;
  model: CharacterAppearance;
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
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new T.Scene();
  let lighting: ReturnType<typeof createKitchenLighting>;
  try {
    lighting = createKitchenLighting(scene, renderer);
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
  const camera = createKitchenCamera();
  const models = new Models(() => schedule(true));
  scene.add(buildKitchen(models));
  const actors = new Map<string, LiveActor>();
  let width = 1;
  let height = 1;
  let visible = true;
  let disposed = false;
  let failed = false;
  let frame = 0;
  const frameInterval = 1000 / 30;
  let last: number | undefined;
  let elapsed = 0;
  let characterShadowsDirty = true;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clock = new T.Vector3();
  const renderGuard = createKitchenRenderGuard(
    {
      debug: renderer.debug,
      render(renderScene, renderCamera) {
        if (actors.size || characterShadowsDirty) {
          lighting.updateCharacterShadows(renderCamera);
          characterShadowsDirty = false;
        }
        renderer.render(renderScene, renderCamera);
      },
    },
    () => {
      failed = true;
      cancelAnimationFrame(frame);
      frame = 0;
      onFailure('webgl');
    },
  );

  const draw = (now: number) => {
    frame = 0;
    if (disposed || failed || !visible || document.hidden) return;
    // Keep the timestamp of the last *drawn* frame: skipped RAFs must not slow motion.
    if (
      actors.size &&
      !reduced.matches &&
      last !== undefined &&
      now - last < frameInterval - 1e-6
    ) {
      frame = requestAnimationFrame(draw);
      return;
    }
    const delta = last === undefined ? 0 : Math.min((now - last) / 1000, 0.06);
    last = now;
    elapsed += delta;
    for (const live of actors.values()) {
      const { model, actor } = live;
      const plan = planAction(actor.activity, (actor.seat % 2) as 0 | 1);
      const previousPosition = live.roaming?.position ?? live.motion.position;
      if (actor.roaming) {
        live.roaming = advanceRoamingMotion(
          live.roaming ?? createRoamingMotion(actor.seat),
          [...actors.values()]
            .filter((p) => p !== live)
            .flatMap((p) => (p.roaming ? [p.roaming] : [])),
          delta,
          reduced.matches,
          model.animation?.walkSpeed ?? 0.48,
        );
      } else {
        live.motion = advanceKitchenMotion(
          live.motion,
          plan,
          delta,
          reduced.matches,
          model.animation?.walkSpeed,
        );
      }
      const { position, yaw, moving } = live.roaming ?? live.motion;
      model.root.position.set(
        position[0],
        kitchenActorGroundY(
          position,
          actor.roaming ? 0.054 : model.animation ? 0.025 : 0.04,
          model.animation ? 0 : 0.012,
        ),
        position[1],
      );
      model.root.rotation.y = yaw;
      const motion = reduced.matches ? 0 : Math.sin(elapsed * (moving ? 10 : 3));
      if (model.animation) {
        const speed =
          delta > 0
            ? Math.hypot(position[0] - previousPosition[0], position[1] - previousPosition[1]) /
              delta
            : 0;
        model.animation.update(
          delta,
          !actor.roaming && live.motion.phase === 'retreat' ? -speed : speed,
          reduced.matches,
          !actor.roaming &&
            plan.pose === 'search' &&
            live.motion.phase === 'idle' &&
            !live.motion.returning,
        );
      } else {
        const baseY =
          (model.body.userData.officeBaseY as number | undefined) ?? model.body.position.y;
        model.body.userData.officeBaseY = baseY;
        model.body.position.y = baseY + (moving ? Math.abs(motion) * 0.045 : motion * 0.012);
        if (model.arm) {
          model.arm.rotation.x = moving
            ? motion * 0.4
            : plan.pose === 'cook'
              ? 1.1 + motion * 0.25
              : plan.pose === 'search'
                ? -1.1
                : 0;
          model.arm.rotation.z = plan.pose === 'wait' ? -1.3 : 0.15;
        }
        if (model.tail) model.tail.rotation.z = motion * 0.08;
      }
      clock
        .set(position[0], actor.roaming ? 1.62 * ROAM_SCALE + 0.025 : 1.62, position[1])
        .project(camera);
      live.bubble.style.left = `${((clock.x + 1) * width) / 2}px`;
      live.bubble.style.top = `${((1 - clock.y) * height) / 2}px`;
    }
    const labels = [...actors.values()].map((live) => live.bubble);
    for (let i = 0; i < labels.length; i++) {
      const bubble = labels[i];
      const sourceTop = Number.parseFloat(bubble.style.top);
      let top = sourceTop;
      const left = Number.parseFloat(bubble.style.left);
      for (let j = 0; j < i; j++) {
        const other = labels[j];
        if (
          Math.abs(left - Number.parseFloat(other.style.left)) < 195 &&
          Math.abs(top - Number.parseFloat(other.style.top)) < 56
        )
          top = Number.parseFloat(other.style.top) - 59;
      }
      top = Math.max(70, top);
      bubble.style.top = `${top}px`;
      bubble.style.setProperty?.('--co-leader-height', `${Math.max(12, sourceTop - top + 12)}px`);
      bubble.style.left = `${Math.max(Math.min(125, width / 2), Math.min(width - Math.min(125, width / 2), left))}px`;
    }
    if (!renderGuard.render(scene, camera)) return;
    if (actors.size && !reduced.matches) frame = requestAnimationFrame(draw);
    else last = undefined;
  };
  const schedule = (staticShadows = false) => {
    characterShadowsDirty = true;
    // Only room asset arrivals alter static occluders; actors have their own map.
    if (staticShadows) renderer.shadowMap.needsUpdate = true;
    if (!frame && !disposed && !failed && visible && !document.hidden)
      frame = requestAnimationFrame(draw);
  };
  const pause = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = undefined;
    for (const live of actors.values()) live.model.animation?.pause();
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
    resizeKitchenCamera(camera, aspect);
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
    update(input) {
      const next = [...new Map(input.map((actor) => [actor.id, actor])).values()].slice(0, 4);
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
        const actorModels = new Models(() => schedule(), true);
        const model = buildDeepSeek(actorModels, actor.seat);
        if (actor.roaming) model.root.scale.setScalar(ROAM_SCALE);
        const bubble = container.querySelector<HTMLElement>(`[data-seat="${actor.seat}"]`);
        if (!bubble) {
          actorModels.dispose();
          continue;
        }
        const motion = createKitchenMotion((actor.seat % 2) as 0 | 1);
        const roaming = actor.roaming ? createRoamingMotion(actor.seat) : undefined;
        model.root.position.set(motion.position[0], 0.04, motion.position[1]);
        model.root.rotation.y = motion.yaw;
        scene.add(model.root);
        actors.set(actor.id, { model, actor, models: actorModels, bubble, motion, roaming });
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
      renderGuard.dispose();
      lighting.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
