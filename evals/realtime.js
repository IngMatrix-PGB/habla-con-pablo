// Conversa con Matrix por la API Realtime en modo texto: mismo modelo, instrucciones, herramientas
// y ciclo de herramientas que la llamada de voz (src/lib/voice-client.js), sin audio.
import { buildSession } from '../worker/index.js';
import { AGENT_NAME, runTool, followUpInstructions } from '../src/lib/agent.js';

const MAX_TOOL_ROUNDS = 4;

function textSession(model) {
  const { audio, ...session } = buildSession({ REALTIME_MODEL: model });
  return { ...session, output_modalities: ['text'] };
}

function connect(apiKey, model) {
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const waiting = [];
  const backlog = [];
  let failure = null;

  const deliver = (ev) => {
    const i = waiting.findIndex((w) => w.type === ev.type);
    if (i >= 0) waiting.splice(i, 1)[0].resolve(ev);
    else backlog.push(ev);
  };
  const failAll = (err) => {
    failure = err;
    for (const w of waiting.splice(0)) w.reject(err);
  };

  ws.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'error') failAll(new Error(`Realtime: ${ev.error?.message ?? JSON.stringify(ev.error)}`));
    else deliver(ev);
  };
  ws.onerror = () => failAll(new Error('No se pudo conectar a la API Realtime'));

  return {
    send: (obj) => ws.send(JSON.stringify(obj)),
    next(type, timeoutMs) {
      if (failure) return Promise.reject(failure);
      const i = backlog.findIndex((e) => e.type === type);
      if (i >= 0) return Promise.resolve(backlog.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout esperando ${type}`)), timeoutMs);
        waiting.push({
          type,
          resolve: (ev) => (clearTimeout(timer), resolve(ev)),
          reject: (err) => (clearTimeout(timer), reject(err)),
        });
      });
    },
    close: () => ws.close(),
  };
}

function readResponse(response) {
  const calls = [];
  let text = '';
  for (const item of response.output ?? []) {
    if (item.type === 'function_call') calls.push(item);
    if (item.type === 'message') {
      for (const part of item.content ?? []) text += part.text ?? part.transcript ?? '';
    }
  }
  return { calls, text: text.trim() };
}

export async function converse({ apiKey, model, turns, timeoutMs = 60_000 }) {
  const rt = connect(apiKey, model);
  const usage = { input: 0, output: 0 };
  const toolCalls = [];
  const transcript = [];

  const respond = async (response) => {
    rt.send(response ? { type: 'response.create', response } : { type: 'response.create' });
    const done = await rt.next('response.done', timeoutMs);
    if (done.response.status === 'failed') {
      throw new Error(`Respuesta fallida: ${JSON.stringify(done.response.status_details)}`);
    }
    usage.input += done.response.usage?.input_tokens ?? 0;
    usage.output += done.response.usage?.output_tokens ?? 0;
    return readResponse(done.response);
  };

  try {
    await rt.next('session.created', timeoutMs);
    rt.send({ type: 'session.update', session: textSession(model) });
    await rt.next('session.updated', timeoutMs);

    // El mismo saludo con el que arranca la llamada real.
    const greeting = await respond({
      instructions: `Saluda en una sola frase breve, preséntate como ${AGENT_NAME} y pregunta qué quieren saber de Pablo.`,
    });
    transcript.push({ role: 'agent', text: greeting.text });

    let finalText = '';
    for (const [turn, userText] of turns.entries()) {
      transcript.push({ role: 'user', text: userText });
      rt.send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: userText }] },
      });

      let res = await respond();
      for (let round = 0; res.calls.length && round < MAX_TOOL_ROUNDS; round++) {
        let lang = 'es';
        for (const call of res.calls) {
          let args = {};
          try {
            args = JSON.parse(call.arguments || '{}');
          } catch {}
          const output = runTool(call.name, args);
          toolCalls.push({ turn, name: call.name, args, output });
          rt.send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) },
          });
          lang = args.lang === 'en' ? 'en' : 'es';
        }
        res = await respond({ instructions: followUpInstructions(lang) });
      }
      finalText = res.text;
      transcript.push({ role: 'agent', text: finalText });
    }

    return { finalText, toolCalls, transcript, usage, turns: turns.length };
  } finally {
    rt.close();
  }
}
