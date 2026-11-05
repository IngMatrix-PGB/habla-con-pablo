# Habla con Pablo

Agente de voz en tiempo real que responde preguntas sobre la carrera de Pablo Galeana Bailey, en español o inglés.

## Cómo funciona

```
Navegador ──POST /api/voice──▶ Servidor Astro (Node)
   │                             ├─ valida Turnstile (opcional)
   │                             ├─ límite diario por IP
   │                             └─ POST /v1/realtime/client_secrets  (llave real, solo servidor)
   │◀──── token temporal (60 s) ─┘
   │
   └──WebRTC (SDP a /v1/realtime/calls con el token)──▶ OpenAI Realtime
        ├─ audio de ida y vuelta
        └─ canal de datos "oai-events": transcripción, llamadas a herramientas, uso de tokens
```

- **Conocimiento**: `src/lib/profile.js` es la única fuente. El agente consulta herramientas (`get_experience`, `get_skills`, `get_certifications`, `get_projects`, `get_contact`) en vez de recitar un prompt gigante; las reglas le prohíben inventar.
- **Herramientas**: se ejecutan en el navegador porque solo leen datos públicos del perfil.
- **Métricas en vivo**: tiempo de conexión, latencia por turno (fin de tu voz → inicio del audio de respuesta) y su p50, interrupciones, herramientas usadas y tokens.
- **Control de costo**: 1 llamada por IP al día, máximo 5 min, `max_output_tokens` por respuesta, token que expira en 60 s.

## Correr local

```bash
npm install
cp .env.example .env   # pon tu OPENAI_API_KEY
npm run dev            # http://localhost:4321
```

```bash
npm test               # límite diario, herramientas, estadísticas
npm run build && npm start
```

## Variables

| Variable | Default | Para qué |
|---|---|---|
| `OPENAI_API_KEY` | — | Llave del servidor. Sin ella `/api/voice` responde 503. |
| `REALTIME_MODEL` | `gpt-realtime` | Modelo de voz. |
| `REALTIME_VOICE` | `marin` | Voz del agente. |
| `DAILY_CALLS_PER_IP` | `1` | Cupo diario por IP. |
| `MAX_CALL_SECONDS` | `300` | Duración máxima de la llamada. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | Anti-bots de Cloudflare. Vacías = desactivado. |

## Límites conocidos (siguientes pasos)

- El límite diario vive en memoria: se pierde al reiniciar y no se comparte entre instancias. En producción, cambiarlo por DynamoDB con TTL o Cloudflare KV (`src/lib/rate-limit.js` ya aísla la interfaz).
- El corte a los 5 min lo hace el navegador. Para forzarlo del lado servidor, usar el canal lateral (sideband) de Realtime con el `call_id` y colgar desde el backend.
- Despliegue y IaC (Terraform), panel de costo por llamada medido y el laboratorio de pronunciación ayuuk todavía no están.
