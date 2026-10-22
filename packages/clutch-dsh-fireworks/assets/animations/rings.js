// clutch_fireworks: {"version":1,"name":"极光光环 · Aurora","durationMs":3600}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public script entry, invoked by the animation Worker.
function render(frame, fx) {
  const colors = ['#64e5eb', '#a38aff', '#ff87d4'];
  for (let i = 0; i < 6; i++) {
    const x = frame.width * (0.15 + fx.random() * 0.7);
    const y = frame.height * (0.18 + fx.random() * 0.65);
    const p = fx.clamp((frame.time - i * 320) / 1800);
    const radius = Math.min(frame.width, frame.height) * 0.3 * fx.easeOut(p);
    fx.ring(x, y, radius, colors[i % 3], 4 * (1 - p), p === 0 ? 0 : (1 - p) * 0.8);
    for (let j = 0; j < 12; j++) {
      const a = (j * Math.PI) / 6 + p;
      fx.star(
        x + Math.cos(a) * radius,
        y + Math.sin(a) * radius,
        4 + (1 - p) * 8,
        colors[i % 3],
        p === 0 ? 0 : 1 - p,
        a,
      );
    }
  }
}
