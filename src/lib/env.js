// Lee variables del servidor tanto en `astro dev` (import.meta.env carga .env) como en producción (process.env).
export function env(name, fallback = '') {
  const fromVite = import.meta.env?.[name];
  const value = fromVite ?? process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function envInt(name, fallback) {
  const n = Number.parseInt(env(name, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
