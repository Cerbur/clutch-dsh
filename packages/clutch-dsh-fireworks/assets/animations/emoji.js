// clutch_fireworks: {"version":1,"name":"Emoji 礼花","durationMs":3200}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Public script entry, invoked by the animation Worker.
function render(frame, fx) {
  const glyphs = ['🎉', '🌟', '✨', '🎊', '💫', '🎆', '💖', '🎈', '🏆', '🚀'];
  for (let i = 0; i < 40; i++) {
    const x = fx.random() * frame.width;
    const y = fx.random() * frame.height;
    const delay = fx.random() * 600;
    const p = fx.clamp((frame.time - delay) / 2600);
    const size = 22 + fx.random() * 26;
    const rotation = fx.random() - 0.5 + p * 2;
    fx.emoji(
      i < 10
        ? '🎉'
        : i < 15
          ? '🌟'
          : i < 20
            ? '✨'
            : glyphs[Math.floor(fx.random() * glyphs.length)],
      x,
      y + p * frame.height * 0.3,
      size * (0.75 + p * 0.65),
      Math.min(p * 10, (1 - p) * 3),
      rotation,
    );
  }
}
