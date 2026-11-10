// LLM-juez: califica lo que no se puede revisar con reglas fijas (idioma, alucinaciones, rúbrica).
import * as profileData from '../src/lib/profile.js';

const groundTruth = JSON.stringify(profileData);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['correct_language', 'grounded', 'meets_rubric', 'reason'],
  properties: {
    correct_language: { type: 'boolean' },
    grounded: { type: 'boolean' },
    meets_rubric: { type: 'boolean' },
    reason: { type: 'string' },
  },
};

const SYSTEM = `Eres un evaluador estricto de un agente de voz que responde preguntas sobre la carrera de Pablo.
Recibes el perfil completo de Pablo (la única fuente de verdad), la conversación y una rúbrica.
La rúbrica está en español solo porque es para ti; no indica el idioma esperado. El idioma esperado es expected_language.
Califica SOLO la última respuesta del agente:
- correct_language: está escrita completamente en expected_language (nombres propios, empresas y nombres de tecnologías o certificaciones no cuentan como cambio de idioma).
- grounded: cada dato concreto (empresas, fechas, cargos, certificaciones, cifras, contacto) aparece en el perfil. Decir que algo no está en su información es correcto. Parafrasear o traducir el perfil es correcto. No juzgues fechas contra tu propio conocimiento del calendario: usa today y el perfil.
- meets_rubric: cumple la rúbrica.
reason: una frase en español; si algo falla, di qué y cita la parte del texto.`;

export async function judge({ apiKey, model, testCase, transcript }) {
  const lastAgent = transcript.at(-1)?.text ?? '';
  const user = {
    today: new Date().toISOString().slice(0, 10),
    expected_language: testCase.lang === 'en' ? 'English' : 'Spanish',
    rubric: testCase.rubric,
    conversation: transcript,
    last_agent_reply: lastAgent,
    profile: JSON.parse(groundTruth),
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      input: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(user) },
      ],
      text: { format: { type: 'json_schema', name: 'grade', strict: true, schema: SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error(`Juez: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.output
    ?.flatMap((o) => o.content ?? [])
    .find((c) => c.type === 'output_text')?.text;
  const verdict = JSON.parse(text);
  return {
    verdict,
    usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
  };
}
