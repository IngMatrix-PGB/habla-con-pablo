// Límite diario por IP sobre Cloudflare KV (o cualquier store con get/put/delete).
// KV es eventualmente consistente: dos llamadas casi simultáneas de la misma IP pueden pasar.
// Para un portafolio basta; si hiciera falta exactitud, usar un Durable Object.

const DAY_TTL_SECONDS = 60 * 60 * 48; // la llave expira sola

const dayOf = (d) => d.toISOString().slice(0, 10);

export function createKvLimiter({ kv, limit, now = () => new Date() }) {
  const keyFor = (ip) => `calls:${dayOf(now())}:${ip}`;

  return {
    async take(ip) {
      const current = now();
      const key = keyFor(ip);
      const count = Number((await kv.get(key)) ?? 0);
      const resetAt = new Date(`${dayOf(current)}T00:00:00.000Z`);
      resetAt.setUTCDate(resetAt.getUTCDate() + 1);
      if (count >= limit) return { allowed: false, remaining: 0, resetAt };
      await kv.put(key, String(count + 1), { expirationTtl: DAY_TTL_SECONDS });
      return { allowed: true, remaining: limit - count - 1, resetAt };
    },
    async refund(ip) {
      const key = keyFor(ip);
      const count = Number((await kv.get(key)) ?? 0);
      if (count <= 1) await kv.delete(key);
      else await kv.put(key, String(count - 1), { expirationTtl: DAY_TTL_SECONDS });
    },
  };
}
