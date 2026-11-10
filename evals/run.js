// Eval de Matrix: corre los casos de evals/cases.json contra el modelo real y falla si la calidad baja.
//   npm run eval                      todos los casos
//   npm run eval -- --only alucinacion-cka --runs 3
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { converse } from './realtime.js';
import { judge } from './judge.js';
import { deterministicChecks, summarize } from './grade.js';

const { values: opts } = parseArgs({
  options: {
    only: { type: 'string' },
    runs: { type: 'string', default: process.env.EVAL_RUNS ?? '1' },
    concurrency: { type: 'string', default: '4' },
  },
});

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Falta OPENAI_API_KEY (ponla en .dev.vars o en el entorno).');
  process.exit(2);
}
const model = process.env.REALTIME_MODEL || 'gpt-realtime';
const judgeModel = process.env.EVAL_JUDGE_MODEL || 'gpt-4.1';
const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? '0.9');
const runs = Math.max(1, Number.parseInt(opts.runs, 10) || 1);

const allCases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const cases = opts.only ? allCases.filter((c) => opts.only.split(',').includes(c.id)) : allCases;
if (!cases.length) {
  console.error(`No hay casos con id "${opts.only}".`);
  process.exit(2);
}

const usage = { agent: { input: 0, output: 0 }, judge: { input: 0, output: 0 } };
const add = (acc, u) => ((acc.input += u.input), (acc.output += u.output));

async function runCase(c, run) {
  const base = { id: c.id, category: c.category, critical: !!c.critical, run };
  try {
    // Un timeout o corte de red no es mala calidad: se reintenta una vez y queda registrado.
    let retried = false;
    const result = await converse({ apiKey, model, turns: c.turns }).catch((err) => {
      retried = err.message;
      return converse({ apiKey, model, turns: c.turns });
    });
    add(usage.agent, result.usage);
    const checks = deterministicChecks(c, result);
    const askJudge = () => judge({ apiKey, model: judgeModel, testCase: c, transcript: result.transcript });
    const { verdict, usage: ju } = await askJudge().catch((err) => {
      retried = `juez: ${err.message}`;
      return askJudge();
    });
    add(usage.judge, ju);
    checks.push(
      { name: 'language', pass: verdict.correct_language, detail: verdict.reason },
      { name: 'grounded', pass: verdict.grounded, detail: verdict.reason },
      { name: 'rubric', pass: verdict.meets_rubric, detail: verdict.reason },
    );
    return {
      ...base,
      pass: checks.every((k) => k.pass),
      checks,
      reply: result.finalText,
      tools: result.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.args)})`),
      transcript: result.transcript,
      ...(retried && { retried }),
    };
  } catch (err) {
    return { ...base, pass: false, checks: [{ name: 'error', pass: false, detail: err.message }], reply: '', tools: [] };
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

console.log(`Eval de Matrix: ${cases.length} casos × ${runs} corrida(s) · agente ${model} · juez ${judgeModel}\n`);
const started = Date.now();
const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, run) => [c, run]));
const results = await pool(jobs, Number(opts.concurrency) || 4, ([c, run]) => runCase(c, run));

for (const r of results) {
  const mark = r.pass ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${r.id}${runs > 1 ? ` #${r.run + 1}` : ''}${r.critical ? '  [crítico]' : ''}${r.retried ? `  (reintentado: ${r.retried})` : ''}`);
  if (!r.pass) {
    for (const k of r.checks.filter((k) => !k.pass)) console.log(`      ✗ ${k.name}: ${k.detail}`);
    if (r.tools.length) console.log(`      tools: ${r.tools.join(' → ')}`);
    if (r.reply) console.log(`      respuesta: ${r.reply.replace(/\s+/g, ' ')}`);
  }
}

const summary = summarize(results, { minPassRate });
console.log('\nPor categoría:');
for (const [cat, s] of Object.entries(summary.byCategory)) console.log(`  ${cat.padEnd(11)} ${s.pass}/${s.total}`);
console.log(
  `\nTotal: ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(0)}%, mínimo ${(minPassRate * 100).toFixed(0)}%)` +
    ` · ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
console.log(
  `Tokens: agente ${usage.agent.input} in / ${usage.agent.output} out · juez ${usage.judge.input} in / ${usage.judge.output} out`,
);
if (summary.criticalFailures.length) console.log(`Casos críticos fallidos: ${summary.criticalFailures.join(', ')}`);

const outDir = new URL('./results/', import.meta.url);
await mkdir(outDir, { recursive: true });
await writeFile(
  new URL('latest.json', outDir),
  JSON.stringify({ date: new Date().toISOString(), model, judgeModel, runs, summary, usage, results }, null, 2),
);
console.log('Detalle en evals/results/latest.json');

console.log(summary.ok ? '\nEVAL OK' : '\nEVAL FALLÓ');
process.exit(summary.ok ? 0 : 1);
