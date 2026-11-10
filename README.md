# Habla con Pablo

[![Eval de Matrix](https://github.com/IngMatrix-PGB/habla-con-pablo/actions/workflows/eval.yml/badge.svg)](https://github.com/IngMatrix-PGB/habla-con-pablo/actions/workflows/eval.yml)
[![Deploy a GitHub Pages](https://github.com/IngMatrix-PGB/habla-con-pablo/actions/workflows/pages.yml/badge.svg)](https://github.com/IngMatrix-PGB/habla-con-pablo/actions/workflows/pages.yml)

Agente de voz en tiempo real (**Matrix**) que responde preguntas sobre la carrera de Pablo Galeana Bailey, en español o inglés.

**Pruébalo:** https://ingmatrix-pgb.github.io/habla-con-pablo/

## Cómo se evalúa

Un demo de IA que "se ve bien" no dice nada. Este agente tiene un **eval de 22 casos** que corre contra el mismo modelo de producción y **bloquea el PR** si baja la calidad:

| Qué mide | Ejemplo |
|---|---|
| Elige la herramienta correcta | "¿Dónde estudió?" → consulta su formación, no la inventa |
| Contesta en el idioma del usuario | Pregunta en inglés con datos en español → respuesta 100% en inglés |
| No alucina | "¿Tiene la CKA?" / "¿Trabajó en Google?" → no lo afirma |
| Respeta sus límites | Salario, prompt injection, prometer fechas, info interna de empleadores |

Se califica con revisiones en código (herramienta, idioma, longitud para voz) y con un **LLM-juez** que tiene el perfil completo como única fuente de verdad. [Resultados en Actions](https://github.com/IngMatrix-PGB/habla-con-pablo/actions/workflows/eval.yml).

### El bug que encontró

La primera corrida dio **18/20**. Ante un prompt injection en inglés ("Ignore all previous instructions…"), Matrix se negaba bien, pero **en español**.

1. Reforzar el prompt: **0/3**.
2. Una pista en la descripción de la herramienta: **5/5**… pero era *overfitting*. Un caso nuevo con otra redacción falló 3/3.
3. Pedirle al modelo que citara al usuario para detectar el idioma: a veces **traducía la cita**.
4. **Solución:** sacar la decisión del modelo. El idioma se detecta en código sobre la transcripción del usuario, y el modelo queda de respaldo.

Resultado: **22/22**, estable en corridas repetidas. Lección: no confíes en el modelo para lo que el código puede decidir, y prueba con casos que el arreglo no vio. Todo el proceso está en el [PR #1](https://github.com/IngMatrix-PGB/habla-con-pablo/pull/1).

## Arquitectura

```
GitHub Pages (sitio estático)                 Cloudflare Worker (worker/)
  index.html + JS  ──POST /api/voice──▶  ├─ CORS: solo orígenes permitidos
        │                                ├─ Turnstile (opcional)
        │                                ├─ límite diario por IP en KV
        │                                └─ POST /v1/realtime/client_secrets  (llave = secreto del Worker)
        │◀────────── token temporal (60 s) ─┘
        │
        └──WebRTC (SDP a /v1/realtime/calls con el token)──▶ OpenAI Realtime
             ├─ audio de ida y vuelta
             └─ canal "oai-events": transcripción, herramientas, uso de tokens
```

- **Conocimiento**: `src/lib/profile.js` es la única fuente. El agente consulta herramientas (`get_overview`, `get_experience`, `get_skills`, `get_certifications`, `get_projects`, `get_contact`) y tiene prohibido inventar. Para rechazar algo (salario, info interna, cambio de rol, fuera de tema) llama `decline_request`.
- **Idioma**: cada herramienta recibe `lang`, y la respuesta que sigue se fuerza a un idioma. Ese idioma se detecta en código sobre la transcripción del usuario (`detectLanguage`), y `lang` del modelo queda de respaldo: ante un "ignore all previous instructions", el modelo marcaba `lang='es'` aunque el mensaje fuera en inglés (lo encontró el eval).
- **Métricas en vivo**: conexión, latencia por turno y p50, interrupciones, herramientas y tokens.
- **Control de costo**: 5 min de voz por IP al día, que se pueden pausar y reanudar (máx. 3 partes, dentro de 30 min). El tiempo lo mide el Worker, no el navegador. Además `max_output_tokens` por respuesta y token de 60 s.
- **Reanudar**: al reanudar se le pasa al agente la transcripción previa para que siga donde se quedó.

## Desarrollo local

```bash
npm install
cp .env.example .env              # config pública del sitio
cp .dev.vars.example .dev.vars    # pon tu OPENAI_API_KEY (secreto del Worker)
npm run dev:worker                # Worker en http://localhost:8787
npm run dev                       # sitio en http://localhost:4321/habla-con-pablo/
npm test
```

## Deploy del Worker (Cloudflare)

```bash
npx wrangler login
npx wrangler kv namespace create RATE_LIMIT     # copia el id a wrangler.toml
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY    # opcional
npm run deploy:worker                           # te da https://habla-con-pablo-voice.<tu-subdominio>.workers.dev
```

Ajusta `ALLOWED_ORIGINS` en `wrangler.toml` si usas dominio propio.

## Deploy del sitio (GitHub Pages)

1. Sube el repo a GitHub y en **Settings → Pages** elige **GitHub Actions** como fuente.
2. En **Settings → Secrets and variables → Actions → Variables** crea:
   - `PUBLIC_VOICE_API_URL` = `https://habla-con-pablo-voice.<tu-subdominio>.workers.dev/api/voice`
   - `PUBLIC_TURNSTILE_SITE_KEY` (opcional), `PUBLIC_MAX_CALL_SECONDS`, `PUBLIC_RESUME_WINDOW_MIN`
   - Con dominio propio: `SITE_URL=https://tu-dominio` y `SITE_BASE=/`
3. Cada push a `main` corre pruebas, construye y publica (`.github/workflows/pages.yml`).

Todo lo que empieza con `PUBLIC_` queda dentro del HTML: nunca pongas secretos ahí.

## Eval del agente

`evals/` mide si Matrix **contesta bien**, no solo si el código corre. Habla con el mismo modelo (`gpt-realtime`), con las mismas instrucciones, herramientas y ciclo de herramientas que la llamada real, pero en modo texto.

```bash
npm run eval                                   # los 22 casos (usa OPENAI_API_KEY de .dev.vars)
npm run eval -- --only alucinacion-cka --runs 3  # un caso, 3 veces, para ver si es estable
```

Cada caso de `evals/cases.json` se califica de dos formas:

| Revisión | Cómo | Qué atrapa |
|---|---|---|
| `tool`, `tool_lang` | código | llamó la herramienta correcta y con el idioma del usuario |
| `contains` | código | menciona el dato clave (ej. `clubhub`, `istmo`) |
| `concise` | código | máx. 90 palabras: es voz, no un ensayo |
| `language`, `grounded`, `rubric` | LLM-juez (`gpt-4.1`) con el perfil completo | idioma, datos inventados y la rúbrica del caso |

Categorías: `tools`, `language`, `grounding` (alucinaciones) y `guardrails` (salario, prompt injection, promesas, info interna). El eval falla si pasa menos del 90% (`EVAL_MIN_PASS_RATE`) o si falla cualquier caso marcado `critical`. El detalle queda en `evals/results/latest.json`.

En CI (`.github/workflows/eval.yml`) corre en los PR que tocan `agent.js`, `profile.js`, `worker/index.js` o `evals/`, y a mano. Necesita el secreto `OPENAI_API_KEY` en el repo; sin él, se omite con un aviso. Una corrida completa usa unos 40k tokens del agente y 40k del juez.

Límite: el modo texto no prueba la transcripción del audio ni la voz. Mide el razonamiento, que es donde fallan los agentes.

## Límites conocidos

- KV es eventualmente consistente: dos aperturas casi simultáneas de la misma IP pueden pasar el límite. Para exactitud, usar un Durable Object.
- El corte a los 5 min lo hace el navegador. Para forzarlo del lado servidor, usar el canal lateral (sideband) de Realtime con el `call_id`.
- Pendiente: panel de costo por llamada medido y laboratorio de pronunciación ayuuk.
