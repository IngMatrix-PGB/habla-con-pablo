// Cloudflare Worker: emite el token temporal de OpenAI Realtime para cada llamada.
// La llave real (OPENAI_API_KEY) es un secreto del Worker y nunca llega al navegador.
import { instructions, tools } from '../src/lib/agent.js';
import { createKvLimiter } from './limiter.js';

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (status, body, cors) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
  });

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true; // desactivado (desarrollo)
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
  });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

export function buildSession(env) {
  return {
    type: 'realtime',
    model: env.REALTIME_MODEL || 'gpt-realtime',
    instructions,
    tools,
    tool_choice: 'auto',
    max_output_tokens: 1024,
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: { type: 'server_vad' },
      },
      output: { voice: env.REALTIME_VOICE || 'marin' },
    },
  };
}

export async function handleVoice(request, env, fetchImpl = fetch) {
  const cors = corsHeaders(request, env);
  if (!cors) return new Response('Origen no permitido', { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);

  if (!env.OPENAI_API_KEY) {
    return json(503, { error: 'not_configured', message: 'El servidor de voz no está configurado.' }, cors);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const body = await request.json().catch(() => ({}));

  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
    return json(403, { error: 'challenge_failed', message: 'No se pudo verificar que eres humano.' }, cors);
  }

  const limiter = createKvLimiter({ kv: env.RATE_LIMIT, limit: int(env.DAILY_CALLS_PER_IP, 1) });
  const quota = await limiter.take(ip);
  if (!quota.allowed) {
    return json(
      429,
      { error: 'daily_limit', message: 'Ya usaste tu llamada de hoy. Vuelve mañana.', resetAt: quota.resetAt.toISOString() },
      cors,
    );
  }

  const session = buildSession(env);
  let upstream;
  try {
    upstream = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      // El token solo sirve para abrir la llamada en los siguientes 60 s.
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session }),
    });
  } catch (err) {
    await limiter.refund(ip);
    console.error('[voice] OpenAI no responde', err);
    return json(502, { error: 'upstream_unreachable', message: 'El servicio de voz no responde.' }, cors);
  }

  if (!upstream.ok) {
    await limiter.refund(ip);
    console.error('[voice] OpenAI rechazó la sesión', upstream.status, await upstream.text());
    return json(502, { error: 'upstream_error', message: 'El servicio de voz rechazó la sesión.' }, cors);
  }

  const data = await upstream.json();
  return json(
    200,
    {
      clientSecret: data.value,
      expiresAt: data.expires_at,
      model: session.model,
      maxCallSeconds: int(env.MAX_CALL_SECONDS, 300),
      remainingToday: quota.remaining,
    },
    cors,
  );
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/voice') return handleVoice(request, env);
    if (pathname === '/health') return new Response('ok');
    return new Response('Not found', { status: 404 });
  },
};
