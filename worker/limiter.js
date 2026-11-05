// Presupuesto diario por IP: una llamada de MAX segundos que se puede pausar y reanudar
// dentro de una ventana (p. ej. 5 min de voz, reanudable durante 30 min desde que empezó).
//
// Cada IP tiene un registro por día en KV:
//   { first, used, sessions, openAt }   (tiempos en ms, used en segundos)
// - start(): abre una sesión si queda tiempo, ventana y sesiones.
// - end(): cierra la sesión y cobra el tiempo real transcurrido medido en el servidor
//   (el navegador no puede reportar menos para ganar minutos).
// - Si el navegador nunca avisa (pestaña cerrada de golpe), la siguiente start() cobra el tiempo
//   transcurrido desde que abrió, con tope en lo que quedaba.
// Total por IP y día: maxSeconds de voz, en máximo maxSessions partes, dentro de windowSeconds.
//
// KV es eventualmente consistente; para un portafolio basta. Para exactitud usar un Durable Object.

const TTL_SECONDS = 60 * 60 * 48;
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

export function createCallBudget({ kv, maxSeconds, windowSeconds, maxSessions, now = () => Date.now() }) {
  const keyFor = (ip, t) => `call:${dayOf(t)}:${ip}`;
  const load = async (key) => {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  };
  const save = (key, rec) => kv.put(key, JSON.stringify(rec), { expirationTtl: TTL_SECONDS });

  function chargeOpen(rec, t) {
    if (rec.openAt == null) return;
    const elapsed = Math.max(0, (t - rec.openAt) / 1000);
    rec.used = Math.min(maxSeconds, rec.used + elapsed);
    rec.openAt = null;
  }

  return {
    async start(ip) {
      const t = now();
      const key = keyFor(ip, t);
      const rec = (await load(key)) ?? { first: t, used: 0, sessions: 0, openAt: null };
      chargeOpen(rec, t);
      const resumeUntil = rec.first + windowSeconds * 1000;
      const remainingSeconds = Math.floor(maxSeconds - rec.used);

      let reason = null;
      if (remainingSeconds <= 0) reason = 'time_used';
      else if (rec.sessions > 0 && t > resumeUntil) reason = 'window_closed';
      else if (rec.sessions >= maxSessions) reason = 'too_many_sessions';
      if (reason) {
        await save(key, rec);
        return { allowed: false, reason, remainingSeconds: Math.max(0, remainingSeconds) };
      }

      rec.sessions += 1;
      rec.openAt = t;
      await save(key, rec);
      return { allowed: true, remainingSeconds, resumeUntil: new Date(resumeUntil).toISOString(), resumed: rec.sessions > 1 };
    },

    async end(ip) {
      const t = now();
      const key = keyFor(ip, t);
      const rec = await load(key);
      if (!rec || rec.openAt == null) return;
      chargeOpen(rec, t);
      await save(key, rec);
    },

    // Deshace la última start() cuando OpenAI no pudo abrir la sesión.
    async refund(ip) {
      const key = keyFor(ip, now());
      const rec = await load(key);
      if (!rec) return;
      rec.sessions = Math.max(0, rec.sessions - 1);
      rec.openAt = null;
      if (rec.sessions === 0 && rec.used === 0) await kv.delete(key);
      else await save(key, rec);
    },
  };
}
