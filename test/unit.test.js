import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKvLimiter } from '../worker/limiter.js';
import { handleVoice } from '../worker/index.js';
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

test('límite KV: bloquea la segunda llamada y se reinicia al día siguiente', async () => {
  let now = new Date('2026-11-05T10:00:00Z');
  const l = createKvLimiter({ kv: fakeKv(), limit: 1, now: () => now });
  assert.equal((await l.take('a')).allowed, true);
  const second = await l.take('a');
  assert.equal(second.allowed, false);
  assert.equal(second.resetAt.toISOString(), '2026-11-06T00:00:00.000Z');
  assert.equal((await l.take('b')).allowed, true, 'otra IP tiene su propio cupo');
  now = new Date('2026-11-06T00:00:01Z');
  assert.equal((await l.take('a')).allowed, true);
});

test('límite KV: refund devuelve la llamada', async () => {
  const l = createKvLimiter({ kv: fakeKv(), limit: 1 });
  await l.take('a');
  await l.refund('a');
  assert.equal((await l.take('a')).allowed, true);
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

test('worker: entrega token y aplica el límite diario', async () => {
  const env = baseEnv();
  let sent;
  const spy = async (url, init) => ((sent = JSON.parse(init.body)), okFetch());
  const first = await handleVoice(req(), env, spy);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.clientSecret, 'ek_123');
  assert.equal(sent.session.tools.length, tools.length);
  assert.equal(sent.expires_after.seconds, 60);
  assert.equal((await handleVoice(req(), env, spy)).status, 429);
});

test('worker: si OpenAI falla, devuelve la llamada al cupo', async () => {
  const env = baseEnv();
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
