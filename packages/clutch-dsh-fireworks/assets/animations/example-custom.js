// clutch_fireworks: {"version":1,"name":"金色螺旋 · Custom","durationMs":4800}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public script entry, invoked by the animation Worker.
function render(frame, fx) {
  const cx = frame.width * 0.5;
  const cy = frame.height * 0.5;
  const fade = Math.min(frame.progress * 5, (1 - frame.progress) * 4);
  for (let i = 0; i < 90; i++) {
    const offset = fx.random();
    const angle = offset * Math.PI * 8 + frame.progress * Math.PI * 2;
    const radius = Math.min(frame.width, frame.height) * 0.42 * offset * fx.easeOut(frame.progress);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    fx.star(x, y, 3 + (1 - offset) * 8, i % 3 === 0 ? '#ff94c9' : '#ffcf66', fade, angle);
    fx.circle(x, y, 1.3, '#fff3d1', fade, 8);
  }
}
