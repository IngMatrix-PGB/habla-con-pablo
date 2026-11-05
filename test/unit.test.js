import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDailyLimiter } from '../src/lib/rate-limit.js';
import { runTool, tools } from '../src/lib/agent.js';
import { median } from '../src/lib/stats.js';

test('el límite diario bloquea la segunda llamada y se reinicia al día siguiente', () => {
  let now = new Date('2026-11-05T10:00:00Z');
  const l = createDailyLimiter({ limit: 1, now: () => now });
  assert.equal(l.take('1.1.1.1').allowed, true);
  const second = l.take('1.1.1.1');
  assert.equal(second.allowed, false);
  assert.equal(second.resetAt.toISOString(), '2026-11-06T00:00:00.000Z');
  assert.equal(l.take('2.2.2.2').allowed, true, 'otra IP tiene su propio cupo');
  now = new Date('2026-11-06T00:00:01Z');
  assert.equal(l.take('1.1.1.1').allowed, true);
});

test('refund devuelve la llamada cuando el proveedor falla', () => {
  const l = createDailyLimiter({ limit: 1 });
  l.take('ip');
  l.refund('ip');
  assert.equal(l.take('ip').allowed, true);
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
