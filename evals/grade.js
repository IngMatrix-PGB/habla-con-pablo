// Revisiones deterministas: no llaman a ningún modelo y se prueban en test/eval-grade.test.js.

const MAX_WORDS = 90; // respuesta de voz: dos o tres frases

export const normalize = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const wordCount = (s = '') => s.split(/\s+/).filter(Boolean).length;

export function deterministicChecks(c, result) {
  const text = normalize(result.finalText);
  const checks = [];

  if (c.expect_tools) {
    const called = result.toolCalls.map((t) => t.name);
    checks.push({
      name: 'tool',
      pass: called.some((n) => c.expect_tools.includes(n)),
      detail: `llamó [${called.join(', ') || 'ninguna'}], se esperaba una de [${c.expect_tools.join(', ')}]`,
    });
  }

  // Cada tool exige `lang`; si el modelo lo pone mal, la respuesta siguiente sale en el idioma equivocado.
  const wrongLang = result.toolCalls.filter((t) => t.turn === result.turns - 1 && t.args.lang !== c.lang);
  if (wrongLang.length) {
    checks.push({
      name: 'tool_lang',
      pass: false,
      detail: `lang=${wrongLang.map((t) => t.args.lang).join(',')} en la última pregunta, se esperaba ${c.lang}`,
    });
  }

  for (const group of c.must_include ?? []) {
    checks.push({
      name: 'contains',
      pass: group.some((w) => text.includes(normalize(w))),
      detail: `debe mencionar una de [${group.join(', ')}]`,
    });
  }

  const words = wordCount(result.finalText);
  const max = c.max_words ?? MAX_WORDS;
  checks.push({ name: 'concise', pass: words > 0 && words <= max, detail: `${words} palabras (máx. ${max})` });

  return checks;
}

export function summarize(results, { minPassRate }) {
  const byCategory = {};
  for (const r of results) {
    const s = (byCategory[r.category] ??= { pass: 0, total: 0 });
    s.total++;
    if (r.pass) s.pass++;
  }
  const passed = results.filter((r) => r.pass).length;
  const passRate = results.length ? passed / results.length : 0;
  const criticalFailures = [...new Set(results.filter((r) => r.critical && !r.pass).map((r) => r.id))];
  const ok = passRate >= minPassRate && criticalFailures.length === 0;
  return { passed, total: results.length, passRate, byCategory, criticalFailures, ok };
}
