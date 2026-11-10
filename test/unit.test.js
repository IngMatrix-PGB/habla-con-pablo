import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCallBudget } from '../worker/limiter.js';
import { handleVoice, handleEnd } from '../worker/index.js';
import { runTool, tools } from '../src/lib/agent.js';
import { median } from '../src/lib/stats.js';

function fakeKv() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}

const ORIGIN = 'https://ingmatrix-pgb.github.io';
const baseEnv = () => ({ ALLOWED_ORIGINS: `${ORIGIN},http://localhost:4321`, OPENAI_API_KEY: 'sk-test', RATE_LIMIT: fakeKv() });
const req = (method = 'POST', origin = ORIGIN, ip = '1.1.1.1') =>
  new Request('https://w.example/api/voice', {
    method,
    headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
  });
const okFetch = async () => new Response(JSON.stringify({ value: 'ek_123', expires_at: 1 }), { status: 200 });

function budget(clock, over = {}) {
  return createCallBudget({ kv: fakeKv(), maxSeconds: 300, windowSeconds: 1800, maxSessions: 3, now: () => clock.t, ...over });
}
const T0 = Date.parse('2026-11-05T10:00:00Z');

test('presupuesto: pausar y reanudar descuenta solo lo hablado (medido en servidor)', async () => {
  const c = { t: T0 };
  const b = budget(c);
  const first = await b.start('a');
  assert.equal(first.allowed, true);
  assert.equal(first.remainingSeconds, 300);
  assert.equal(first.resumed, false);
  c.t += 60_000; // habló 1 min y colgó
  await b.end('a');
  c.t += 10 * 60_000; // 10 min en pausa no cuentan
  const second = await b.start('a');
  assert.equal(second.allowed, true);
  assert.equal(second.resumed, true);
  assert.equal(second.remainingSeconds, 240);
});

test('presupuesto: sin aviso de colgar, la siguiente llamada cobra el tiempo transcurrido', async () => {
  const c = { t: T0 };
  const b = budget(c);
  await b.start('a');
  c.t += 400_000; // cerró la pestaña de golpe y regresó: más que el total
  const again = await b.start('a');
  assert.equal(again.allowed, false);
  assert.equal(again.reason, 'time_used');
});

test('presupuesto: no se puede reanudar fuera de la ventana ni más de N veces', async () => {
  const c = { t: T0 };
  const b = budget(c);
  await b.start('a'); c.t += 5_000; await b.end('a');
  c.t += 31 * 60_000;
  assert.equal((await b.start('a')).reason, 'window_closed');

  const c2 = { t: T0 };
  const b2 = budget(c2);
  for (let i = 0; i < 3; i++) { assert.equal((await b2.start('b')).allowed, true); c2.t += 5_000; await b2.end('b'); }
  assert.equal((await b2.start('b')).reason, 'too_many_sessions');
});

test('presupuesto: otra IP y otro día empiezan de cero; refund deshace la apertura', async () => {
  const c = { t: T0 };
  const b = budget(c);
  await b.start('a'); c.t += 400_000;
  assert.equal((await b.start('a')).allowed, false);
  assert.equal((await b.start('z')).allowed, true);
  c.t = Date.parse('2026-11-06T00:00:01Z');
  assert.equal((await b.start('a')).allowed, true);
  const c3 = { t: T0 };
  const b3 = budget(c3, { maxSessions: 1 });
  await b3.start('r'); await b3.refund('r');
  assert.equal((await b3.start('r')).allowed, true);
});

test('worker: rechaza orígenes no permitidos', async () => {
  const res = await handleVoice(req('POST', 'https://evil.example'), baseEnv(), okFetch);
  assert.equal(res.status, 403);
});

test('worker: responde el preflight CORS', async () => {
  const res = await handleVoice(req('OPTIONS'), baseEnv(), okFetch);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('worker: 503 sin llave', async () => {
  const env = baseEnv();
  delete env.OPENAI_API_KEY;
  assert.equal((await handleVoice(req(), env, okFetch)).status, 503);
});

test('worker: entrega token con minutos restantes y /end cierra la sesión', async () => {
  const env = baseEnv();
  let sent;
  const spy = async (url, init) => ((sent = JSON.parse(init.body)), okFetch());
  const first = await handleVoice(req(), env, spy);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.clientSecret, 'ek_123');
  assert.equal(body.remainingSeconds, 300);
  assert.equal(body.resumed, false);
  assert.equal(sent.session.tools.length, tools.length);
  assert.equal(sent.expires_after.seconds, 60);
  const end = await handleEnd(new Request('https://w.example/api/voice/end', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '1.1.1.1' }, body: '{}' }), env);
  assert.equal(end.status, 204);
  const second = await (await handleVoice(req(), env, spy)).json();
  assert.equal(second.resumed, true);
});

test('worker: 429 cuando se acaban las partes del día', async () => {
  const env = { ...baseEnv(), MAX_SESSIONS_PER_DAY: '1' };
  assert.equal((await handleVoice(req(), env, okFetch)).status, 200);
  const res = await handleVoice(req(), env, okFetch);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).reason, 'too_many_sessions');
});

test('worker: si OpenAI falla, devuelve la llamada al cupo', async () => {
  const env = { ...baseEnv(), MAX_SESSIONS_PER_DAY: '1' };
  const bad = async () => new Response('nope', { status: 401 });
  assert.equal((await handleVoice(req(), env, bad)).status, 502);
  assert.equal((await handleVoice(req(), env, okFetch)).status, 200);
});

test('cada herramienta declarada tiene implementación', () => {
  for (const t of tools) {
    const out = runTool(t.name, {});
    assert.ok(out && !out.error, `${t.name} devolvió error`);
  }
});

test('get_experience con empresa devuelve el detalle y rechaza ids desconocidos', () => {
  assert.equal(runTool('get_experience', { company: 'gbm' }).role, 'DevOps Engineer');
  assert.ok(runTool('get_experience', { company: 'nope' }).error);
  assert.ok(runTool('no_existe').error);
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('todas las herramientas exigen el idioma y followUpInstructions lo fija', async () => {
  const { followUpInstructions } = await import('../src/lib/agent.js');
  for (const t of tools) {
    assert.deepEqual(t.parameters.required.slice(0, 1), ['lang'], t.name);
    assert.deepEqual(t.parameters.properties.lang.enum, ['es', 'en']);
  }
  assert.match(followUpInstructions('en'), /MUST be entirely in English/);
  assert.match(followUpInstructions('es'), /MUST be entirely in Spanish/);
  assert.equal(runTool('get_experience', { lang: 'en', company: 'clip' }).company, 'Clip');
});

test('get_projects sin parámetro devuelve la lista corta; con project, el detalle', () => {
  const list = runTool('get_projects', {});
  assert.ok(list.length > 0 && list.every((p) => p.id && p.name && !p.description));
  assert.ok(runTool('get_projects', { project: list[0].id }).description);
  assert.ok(runTool('get_projects', { project: 'nope' }).error);
});
