import * as T from 'three';
import { Models } from '../src/client/scene/models.js';
import { buildDeepSeek } from '../src/client/scene/character/deepseek.js';
import { turnVelocity } from '../src/client/scene/character/turn.js';
import { createKitchenLighting } from '../src/client/scene/lighting.js';
import { turnToward } from '../src/office/kitchen-layout.js';

// Local review only: original PBR/light rig, close camera, no Session/profile calls.
document.body.innerHTML = `<main style="padding:20px;font:15px system-ui;color:#223247">
  <h1>鲸鱼娘 · 转身动作预览</h1>
  <p>角色近景：小步转身与头肩领转。原地行走仅用于检查动作衔接，不改变厨房路线。</p>
  <div id="controls" style="display:flex;gap:10px;flex-wrap:wrap">
    <button id="left" disabled>向左转 90°</button><button id="right" disabled>向右转 90°</button>
    <button id="around" disabled>转身 180°</button>
    <label><input id="walk" type="checkbox">原地行走衔接</label>
    <label><input id="reduced" type="checkbox">模拟减少动态</label>
    <button id="capture">保存当前画面</button>
  </div><p id="state" role="status">加载角色…</p><div id="view"></div></main>`;
function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing preview control: ' + id);
  return node;
}
const view = element('view');
const state = element('state');
function input(id: string): HTMLInputElement {
  const node = element(id);
  if (!(node instanceof HTMLInputElement)) throw new Error('Missing preview input: ' + id);
  return node;
}
const walk = input('walk');
const reduced = input('reduced');
const buttons = ['left', 'right', 'around'].map((id) => {
  const button = element(id);
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing preview button: ' + id);
  return button;
});
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const width = Math.min(window.innerWidth - 40, 900),
  height = 540;
renderer.setSize(width, height);
view.append(renderer.domElement);
const scene = new T.Scene();
const lighting = createKitchenLighting(scene, renderer);
const camera = new T.OrthographicCamera(
  (-1.15 * width) / height,
  (1.15 * width) / height,
  1.15,
  -1.15,
  0.1,
  30,
);
camera.position.set(3, 2, 4);
camera.lookAt(0, 0.7, 0);
const room = new Models();
const owner = new Models(() => {}, true);
const model = buildDeepSeek(owner, 0, room);
scene.add(model.root);
let yaw = 0,
  target = 0,
  last: number | undefined,
  request = 0;
function turn(angle: number) {
  if (reduced.checked) return;
  target = yaw + angle;
}
buttons[0].onclick = () => turn(Math.PI / 2);
buttons[1].onclick = () => turn(-Math.PI / 2);
buttons[2].onclick = () => turn(Math.PI);
reduced.onchange = () => {
  target = yaw;
  model.animation?.pause();
};
function draw(now: number) {
  request = requestAnimationFrame(draw);
  if (last !== undefined && now - last < 1000 / 30) return;
  const delta = last === undefined ? 0 : Math.min((now - last) / 1000, 0.06);
  last = now;
  const ready = model.root.userData.assetState === 'ready';
  buttons.forEach((button) => {
    button.disabled = !ready || reduced.checked;
  });
  const previous = yaw;
  if (ready && !reduced.checked) yaw = turnToward(yaw, target, delta * 2.2);
  model.root.rotation.y = yaw;
  model.animation?.update(
    delta,
    walk.checked ? 0.48 : 0,
    reduced.checked,
    false,
    turnVelocity(previous, yaw, delta),
  );
  lighting.updateCharacterShadows(camera);
  renderer.render(scene, camera);
  state.textContent = !ready
    ? '加载角色…'
    : reduced.checked
      ? '减少动态：静止'
      : Math.abs(yaw - target) > 0.001
        ? '转身中'
        : walk.checked
          ? '原地行走'
          : '站立 · 独立眨眼';
}
element('capture').onclick = () => {
  renderer.render(scene, camera);
  void fetch('/capture', {
    method: 'POST',
    body: renderer.domElement.toDataURL('image/png').split(',')[1],
  });
};
function visibility() {
  last = undefined;
  model.animation?.pause();
  cancelAnimationFrame(request);
  if (!document.hidden) request = requestAnimationFrame(draw);
}
document.addEventListener('visibilitychange', visibility);
window.addEventListener(
  'pagehide',
  () => {
    cancelAnimationFrame(request);
    document.removeEventListener('visibilitychange', visibility);
    owner.dispose();
    room.dispose();
    lighting.dispose();
    renderer.dispose();
  },
  { once: true },
);
request = requestAnimationFrame(draw);
