import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deterministicChecks, summarize, normalize } from '../evals/grade.js';
import { tools } from '../src/lib/agent.js';

const result = (over = {}) => ({
  finalText: 'Pablo trabaja hoy en ClubHub.ai como Senior Platform Engineer.',
  toolCalls: [{ turn: 0, name: 'get_experience', args: { lang: 'es' } }],
  turns: 1,
  ...over,
});
const failed = (checks) => checks.filter((k) => !k.pass).map((k) => k.name);

test('eval: pasa cuando llama la tool esperada, en el idioma correcto y menciona lo pedido', () => {
  const c = { lang: 'es', expect_tools: ['get_experience'], must_include: [['clubhub']] };
  assert.deepEqual(failed(deterministicChecks(c, result())), []);
});

test('eval: detecta tool equivocada, lang equivocado, texto faltante y respuesta larga', () => {
  const c = { lang: 'en', expect_tools: ['get_contact'], must_include: [['linkedin']] };
  const r = result({ finalText: 'palabra '.repeat(120) });
  assert.deepEqual(failed(deterministicChecks(c, r)), ['tool', 'tool_lang', 'contains', 'concise']);
});

test('eval: tool_lang solo revisa la última pregunta (el usuario pudo cambiar de idioma)', () => {
  const c = { lang: 'en' };
  const r = result({
    turns: 2,
    toolCalls: [
      { turn: 0, name: 'get_certifications', args: { lang: 'es' } },
      { turn: 1, name: 'get_skills', args: { lang: 'en' } },
    ],
  });
  assert.deepEqual(failed(deterministicChecks(c, r)), []);
});

test('eval: ignora acentos y mayúsculas al buscar texto', () => {
  assert.equal(normalize('Tecnológico del ISTMO'), 'tecnologico del istmo');
});

test('eval: falla si baja del mínimo o si falla un caso crítico', () => {
  const ok = { id: 'a', category: 'x', pass: true };
  assert.equal(summarize([ok, ok, ok, { id: 'b', category: 'x', pass: false }], { minPassRate: 0.7 }).ok, true);
  assert.equal(summarize([ok, { id: 'b', category: 'x', pass: false }], { minPassRate: 0.9 }).ok, false);
  const crit = summarize([ok, ok, ok, ok, ok, ok, ok, ok, ok, { id: 'c', category: 'x', critical: true, pass: false }], {
    minPassRate: 0.9,
  });
  assert.equal(crit.ok, false);
  assert.deepEqual(crit.criticalFailures, ['c']);
});

test('eval: los casos son válidos y solo esperan tools que existen', () => {
  const cases = JSON.parse(readFileSync(new URL('../evals/cases.json', import.meta.url), 'utf8'));
  const names = new Set(tools.map((t) => t.name));
  const ids = new Set();
  for (const c of cases) {
    assert.ok(!ids.has(c.id), `id repetido: ${c.id}`);
    ids.add(c.id);
    assert.ok(['es', 'en'].includes(c.lang), `${c.id}: lang inválido`);
    assert.ok(c.turns?.length && c.rubric, `${c.id}: faltan turns o rubric`);
    for (const t of c.expect_tools ?? []) assert.ok(names.has(t), `${c.id}: tool inexistente ${t}`);
  }
});
