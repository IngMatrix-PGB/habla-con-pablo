// Emite un token temporal de OpenAI Realtime para una llamada.
// La llave real (OPENAI_API_KEY) nunca sale del servidor.
import { instructions, tools } from '../../lib/agent.js';
import { createDailyLimiter } from '../../lib/rate-limit.js';
import { env, envInt } from '../../lib/env.js';

export const prerender = false;

const limiter = createDailyLimiter({ limit: envInt('DAILY_CALLS_PER_IP', 1) });

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

async function verifyTurnstile(token, ip) {
  const secret = env('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // Turnstile desactivado (desarrollo local)
  if (!token) return false;
  const form = new URLSearchParams({ secret, response: token, remoteip: ip });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

export async function POST({ request, clientAddress }) {
  const apiKey = env('OPENAI_API_KEY');
  if (!apiKey) {
    return json(503, { error: 'not_configured', message: 'Falta OPENAI_API_KEY en el servidor.' });
  }

  const ip = clientAddress || 'unknown';
  const body = await request.json().catch(() => ({}));

  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return json(403, { error: 'challenge_failed', message: 'No se pudo verificar que eres humano.' });
  }

  const quota = limiter.take(ip);
  if (!quota.allowed) {
    return json(429, {
      error: 'daily_limit',
      message: 'Ya usaste tu llamada de hoy. Vuelve mañana.',
      resetAt: quota.resetAt.toISOString(),
    });
  }

  const session = {
    type: 'realtime',
    model: env('REALTIME_MODEL', 'gpt-realtime'),
    instructions,
    tools,
    tool_choice: 'auto',
    max_output_tokens: 1024,
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: { type: 'server_vad' },
      },
      output: { voice: env('REALTIME_VOICE', 'marin') },
    },
  };

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      // El token solo sirve para abrir la llamada en los siguientes 60 s.
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session }),
    });
  } catch (err) {
    limiter.refund(ip);
    console.error('[voice] OpenAI no responde', err);
    return json(502, { error: 'upstream_unreachable', message: 'El servicio de voz no responde.' });
  }

  if (!upstream.ok) {
    limiter.refund(ip);
    const detail = await upstream.text();
    console.error('[voice] OpenAI rechazó la sesión', upstream.status, detail);
    return json(502, { error: 'upstream_error', message: 'El servicio de voz rechazó la sesión.' });
  }

  const data = await upstream.json();
  return json(200, {
    clientSecret: data.value,
    expiresAt: data.expires_at,
    model: session.model,
    maxCallSeconds: envInt('MAX_CALL_SECONDS', 300),
    remainingToday: quota.remaining,
  });
}
