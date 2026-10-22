// clutch_fireworks: {"version":1,"name":"星空烟花 · Starburst","durationMs":4200}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public script entry, invoked by the animation Worker.
function render(frame, fx) {
  const colors = ['#ff5cba', '#ffd56b', '#76e7ff', '#bc97ff', '#91ffba'];
  for (let b = 0; b < 7; b++) {
    const cx = frame.width * (0.1 + fx.random() * 0.8);
    const cy = frame.height * (0.16 + fx.random() * 0.5);
    const delay = b * 360;
    const p = fx.clamp((frame.time - delay) / 1900);
    const radius = Math.min(frame.width, frame.height) * (0.15 + fx.random() * 0.12);
    for (let j = 0; j < 48; j++) {
      const angle = (j / 48) * Math.PI * 2;
      const reach = radius * fx.easeOut(p);
      const x = cx + Math.cos(angle) * reach;
      const y = cy + Math.sin(angle) * reach + p * p * 90;
      const opacity = p === 0 ? 0 : (1 - p) * 0.95;
      fx.line(
        x - Math.cos(angle) * 14 * p,
        y - Math.sin(angle) * 14 * p,
        x,
        y,
        colors[b % colors.length],
        2.2,
        opacity,
      );
      fx.circle(x, y, 2.5 * (1 - p), colors[b % colors.length], opacity, 10);
    }
  }
}
