// Efecto "voz robot" con Web Audio, aplicado en el navegador a la voz que llega de OpenAI.
// Cadena: modulación en anillo (portadora ~55 Hz) + eco metálico muy corto (filtro peine),
// mezclado con un poco de la voz original para que se entienda.
//
//   fuente ─┬─ dry ───────────────────────────────┐
//           └─ ring (gain modulado por oscilador) ─┼─ comb (delay+feedback) ─ wet ─┐
//                                                                                 ├─ compresor ─ salida
//                                                  └───────────────────────────────┘

export function createRobotVoice(ctx, stream, { enabled = true } = {}) {
  const source = ctx.createMediaStreamSource(stream);

  const dry = ctx.createGain();
  const ring = ctx.createGain();
  ring.gain.value = 0; // el oscilador mueve la ganancia entre -1 y 1
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = 55;
  carrier.connect(ring.gain);
  carrier.start();

  const comb = ctx.createDelay(0.05);
  comb.delayTime.value = 0.009;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  comb.connect(feedback).connect(comb);

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 140;

  const wet = ctx.createGain();
  const out = ctx.createDynamicsCompressor();
  out.threshold.value = -18;
  out.ratio.value = 4;
  const master = ctx.createGain();
  master.gain.value = 1.15;

  source.connect(dry).connect(out);
  source.connect(ring).connect(highpass).connect(comb).connect(wet).connect(out);
  highpass.connect(wet); // también la señal modulada sin eco
  out.connect(master).connect(ctx.destination);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  function setEnabled(on) {
    const t = ctx.currentTime;
    dry.gain.setTargetAtTime(on ? 0.3 : 1, t, 0.05);
    wet.gain.setTargetAtTime(on ? 0.75 : 0, t, 0.05);
  }
  setEnabled(enabled);

  return {
    analyser,
    setEnabled,
    stop() {
      try {
        carrier.stop();
      } catch {}
      source.disconnect();
      master.disconnect();
    },
  };
}
