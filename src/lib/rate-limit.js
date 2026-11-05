// Límite de llamadas por IP y día (UTC), en memoria.
// Sirve para una sola instancia. En producción con varias instancias, cambiar el Map
// por un almacén compartido (DynamoDB con TTL o Cloudflare KV) manteniendo esta interfaz.

export function createDailyLimiter({ limit, now = () => new Date() }) {
  const used = new Map(); // `${day}|${ip}` -> llamadas

  const dayOf = (d) => d.toISOString().slice(0, 10);

  function prune(today) {
    for (const key of used.keys()) {
      if (!key.startsWith(`${today}|`)) used.delete(key);
    }
  }

  return {
    // Consume una llamada si queda cupo. Devuelve { allowed, remaining, resetAt }.
    take(ip) {
      const current = now();
      const today = dayOf(current);
      prune(today);
      const key = `${today}|${ip}`;
      const count = used.get(key) ?? 0;
      const resetAt = new Date(`${today}T00:00:00.000Z`);
      resetAt.setUTCDate(resetAt.getUTCDate() + 1);
      if (count >= limit) return { allowed: false, remaining: 0, resetAt };
      used.set(key, count + 1);
      return { allowed: true, remaining: limit - count - 1, resetAt };
    },
    // Devuelve la llamada si la sesión no se pudo abrir (falla del proveedor).
    refund(ip) {
      const key = `${dayOf(now())}|${ip}`;
      const count = used.get(key) ?? 0;
      if (count > 0) used.set(key, count - 1);
    },
  };
}
