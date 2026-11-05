// Lluvia de código de fondo: binario, hex y símbolos de shell. Ligera y pausada si el usuario
// pide menos movimiento o la pestaña no está visible.
const GLYPHS = '01010101abcdef0123456789{}[]<>/$#=;:'.split('');

export function startRain(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const size = 16;
  let cols = 0;
  let drops = [];
  let last = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(innerWidth / size);
    drops = Array.from({ length: cols }, () => Math.random() * -innerHeight / size);
    ctx.fillStyle = '#030604';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || t - last < 55) return; // ~18 fps basta para el fondo
    last = t;
    ctx.fillStyle = 'rgba(3, 6, 4, 0.12)';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.font = `${size - 2}px 'JetBrains Mono', monospace`;
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * size;
      const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      ctx.fillStyle = Math.random() < 0.04 ? '#c8ffd9' : '#1fae5a';
      ctx.fillText(ch, i * size, y);
      if (y > innerHeight && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
  }

  function drawStatic() {
    ctx.font = `${size - 2}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#145c33';
    for (let i = 0; i < cols; i++) {
      for (let y = 0; y < innerHeight; y += size * 3) {
        if (Math.random() < 0.15) ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * size, y);
      }
    }
  }

  resize();
  addEventListener('resize', () => {
    resize();
    if (reduce.matches) drawStatic();
  });
  if (reduce.matches) drawStatic();
  else requestAnimationFrame(frame);
}
