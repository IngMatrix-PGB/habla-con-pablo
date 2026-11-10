// Cliente de voz: WebRTC con OpenAI Realtime, transcripción, herramientas y métricas.
import { runTool, followUpInstructions, replyLanguage, AGENT_NAME } from './agent.js';
import { median } from './stats.js';
import { createRobotVoice } from './robot-voice.js';

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export function startVoiceApp() {
  const $ = (id) => document.getElementById(id);
  const ui = {
    status: $('status'),
    statusText: $('status-text'),
    hint: $('hint'),
    call: $('call'),
    callLabel: $('call-label'),
    mute: $('mute'),
    robot: $('robot'),
    timer: $('timer'),
    transcript: $('transcript'),
    turns: $('turns'),
    audio: $('remote-audio'),
    orb: $('orb'),
    m: {
      connect: $('m-connect'),
      last: $('m-last'),
      p50: $('m-p50'),
      interrupts: $('m-interrupts'),
      tools: $('m-tools'),
      tokens: $('m-tokens'),
    },
  };

  let turnstileToken = '';
  let robot = null; // efecto de voz activo
  let robotOn = true;
  try {
    robotOn = localStorage.getItem('robotVoice') !== 'off';
  } catch {}
  const renderRobot = () => {
    ui.robot.setAttribute('aria-pressed', String(robotOn));
    ui.robot.textContent = robotOn ? 'Voz: robot' : 'Voz: normal';
  };
  renderRobot();
  window.onTurnstile = (token) => (turnstileToken = token);

  let call = null; // estado de la llamada activa

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const fmtMs = (ms) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

  function setStatus(state, text) {
    ui.status.dataset.state = state;
    ui.statusText.textContent = text;
  }
  function setHint(text, isError = false) {
    ui.hint.textContent = text;
    ui.hint.classList.toggle('error', isError);
  }

  // ---------- Transcripción ----------
  const bubbles = new Map(); // item_id -> elemento
  let turnCount = 0;

  function clearEmpty() {
    ui.transcript.querySelector('.empty')?.remove();
  }
  function scrollDown() {
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }
  function bubble(itemId, role) {
    let el = bubbles.get(itemId);
    if (el) return el;
    clearEmpty();
    el = document.createElement('li');
    el.className = `msg ${role} pending`;
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = new Date().toLocaleTimeString('es-MX', { hour12: false });
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = role === 'user' ? 'tú' : AGENT_NAME.toLowerCase();
    const text = document.createElement('span');
    text.className = 'text';
    el.append(ts, who, text);
    ui.transcript.append(el);
    bubbles.set(itemId, el);
    if (role === 'user') ui.turns.textContent = `${++turnCount} ${turnCount === 1 ? 'turno' : 'turnos'}`;
    scrollDown();
    return el;
  }
  function appendText(itemId, role, delta) {
    const el = bubble(itemId, role);
    el.querySelector('.text').textContent += delta;
    scrollDown();
  }
  const history = []; // { role, text } para retomar el contexto al reanudar
  let paused = null; // { remainingSeconds, resumeUntil } tras colgar con minutos disponibles

  function finishText(itemId, role, full) {
    const el = bubble(itemId, role);
    if (full != null) el.querySelector('.text').textContent = full.trim() || '(inaudible)';
    const text = el.querySelector('.text').textContent.trim();
    if (text && text !== '(inaudible)') history.push({ role, text });
    el.classList.remove('pending');
    scrollDown();
  }
  function toolLine(name, args) {
    clearEmpty();
    const el = document.createElement('li');
    el.className = 'tool';
    const shown = args && Object.keys(args).length ? JSON.stringify(args) : '';
    el.textContent = `⚙ tool ${name}(${shown})`;
    ui.transcript.append(el);
    scrollDown();
  }

  // ---------- Visualización ----------
  const ctx2d = ui.orb.getContext('2d');
  let audioCtx = null;
  let micAnalyser = null;
  let remoteAnalyser = null;
  let raf = 0;
  const BARS = 96;
  const buf = new Uint8Array(256);

  function level(analyser) {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }

  function draw() {
    const { width: w, height: h } = ui.orb;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const line = styles.getPropertyValue('--accent-dim').trim();
    const userColor = styles.getPropertyValue('--user').trim();
    ctx2d.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.3;
    const agentLevel = level(remoteAnalyser);
    const userLevel = level(micAnalyser);
    const lv = Math.max(agentLevel, userLevel);
    const color = agentLevel >= userLevel ? accent : userColor;
    const t = performance.now() / 1000;

    ctx2d.lineCap = 'round';
    ctx2d.lineWidth = 4;
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2;
      const wobble = 0.5 + 0.5 * Math.sin(a * 5 + t * 3);
      const len = 10 + (call ? lv * 70 * (0.5 + wobble * 0.5) : 4 * wobble);
      ctx2d.strokeStyle = call ? color : line;
      ctx2d.globalAlpha = call ? 0.35 + lv * 0.65 : 0.9;
      ctx2d.beginPath();
      ctx2d.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx2d.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len));
      ctx2d.stroke();
    }
    ctx2d.globalAlpha = 1;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r - 14, 0, Math.PI * 2);
    ctx2d.strokeStyle = call ? color : line;
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
    raf = requestAnimationFrame(draw);
  }
  draw();

  function analyserFor(stream) {
    audioCtx ??= new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    return an;
  }

  // ---------- Métricas ----------
  function resetMetrics() {
    for (const el of Object.values(ui.m)) el.textContent = '—';
    ui.m.interrupts.textContent = '0';
    ui.m.tools.textContent = '0';
    ui.m.tokens.textContent = '0';
  }
  function renderMetrics() {
    if (!call) return;
    ui.m.connect.textContent = fmtMs(call.connectMs);
    ui.m.last.textContent = fmtMs(call.turnLatencies.at(-1));
    ui.m.p50.textContent = fmtMs(median(call.turnLatencies));
    ui.m.interrupts.textContent = String(call.interruptions);
    ui.m.tools.textContent = String(call.toolCalls);
    ui.m.tokens.textContent = call.tokens.toLocaleString('es-MX');
  }

  // ---------- Eventos del servidor ----------
  function send(event) {
    if (call?.dc?.readyState === 'open') call.dc.send(JSON.stringify(event));
  }

  function onEvent(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        if (call.agentSpeaking) call.interruptions++;
        call.userStoppedAt = null;
        renderMetrics();
        break;
      case 'input_audio_buffer.speech_stopped':
        call.userStoppedAt = performance.now();
        break;
      case 'input_audio_buffer.committed':
        bubble(ev.item_id, 'user');
        break;
      case 'conversation.item.input_audio_transcription.delta':
        appendText(ev.item_id, 'user', ev.delta ?? '');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        finishText(ev.item_id, 'user', ev.transcript);
        call.lastUserText = ev.transcript ?? '';
        break;
      case 'output_audio_buffer.started':
        call.agentSpeaking = true;
        if (call.userStoppedAt != null) {
          call.turnLatencies.push(performance.now() - call.userStoppedAt);
          call.userStoppedAt = null;
        }
        setStatus('live', `${AGENT_NAME} hablando`);
        renderMetrics();
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        call.agentSpeaking = false;
        setStatus('live', 'Escuchando');
        break;
      case 'response.output_audio_transcript.delta':
        appendText(ev.item_id, 'agent', ev.delta ?? '');
        break;
      case 'response.output_audio_transcript.done':
        finishText(ev.item_id, 'agent', ev.transcript);
        break;
      case 'response.function_call_arguments.done': {
        let args = {};
        try {
          args = JSON.parse(ev.arguments || '{}');
        } catch {}
        toolLine(ev.name, args);
        call.toolCalls++;
        const output = runTool(ev.name, args);
        send({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(output) },
        });
        call.needsFollowUp = args; // el idioma se decide en response.done, cuando ya llegó la transcripción
        renderMetrics();
        break;
      }
      case 'response.done': {
        const usage = ev.response?.usage;
        if (usage) call.tokens += usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
        if (call.needsFollowUp) {
          const lang = replyLanguage(call.needsFollowUp, call.lastUserText);
          call.needsFollowUp = false;
          send({ type: 'response.create', response: { instructions: followUpInstructions(lang) } });
        }
        renderMetrics();
        break;
      }
      case 'error':
        console.error('[realtime]', ev.error);
        setHint(ev.error?.message ?? 'Error en la sesión de voz.', true);
        break;
    }
  }

  // ---------- Llamada ----------
  async function start() {
    // Crear/reanudar el AudioContext dentro del clic (política de autoplay).
    audioCtx ??= new AudioContext();
    audioCtx.resume();
    ui.call.disabled = true;
    setStatus('connecting', 'Conectando');
    setHint('Pidiendo permiso para usar tu micrófono…');
    resetMetrics();

    let mic;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      fail('Necesito acceso al micrófono para conversar. Revisa los permisos del navegador.');
      return;
    }

    const t0 = performance.now();
    setHint('Abriendo la sesión…');
    let session;
    try {
      const res = await fetch(document.body.dataset.voiceApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken }),
      });
      session = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) paused = null;
        throw new Error(session.message || `Error ${res.status}`);
      }
    } catch (err) {
      mic.getTracks().forEach((tr) => tr.stop());
      fail(err instanceof TypeError ? 'No se pudo contactar al servidor de voz. Intenta más tarde.' : err.message);
      return;
    }

    const pc = new RTCPeerConnection();
    call = {
      pc,
      mic,
      dc: null,
      connectMs: null,
      turnLatencies: [],
      interruptions: 0,
      toolCalls: 0,
      tokens: 0,
      agentSpeaking: false,
      userStoppedAt: null,
      needsFollowUp: false, // args de la última herramienta cuando hay que pedir la respuesta tras ella
      lastUserText: '',
      deadline: Date.now() + (session.remainingSeconds ?? session.maxCallSeconds) * 1000,
      resumeUntil: session.resumeUntil ? Date.parse(session.resumeUntil) : null,
      tick: 0,
    };

    pc.ontrack = (e) => {
      // Chrome solo entrega audio WebRTC a Web Audio si el stream también está en un <audio>;
      // se silencia el elemento y el sonido sale por la cadena del efecto.
      ui.audio.srcObject = e.streams[0];
      ui.audio.muted = true;
      robot = createRobotVoice(audioCtx, e.streams[0], { enabled: robotOn });
      remoteAnalyser = robot.analyser;
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.connectionState) && call) {
        hangUp('Se perdió la conexión.');
      }
    };
    const micTrack = mic.getAudioTracks()[0];
    pc.addTrack(micTrack, mic);
    micAnalyser = analyserFor(mic);

    const dc = pc.createDataChannel('oai-events');
    call.dc = dc;
    dc.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch (err) {
        console.error(err);
      }
    };
    dc.onopen = () => {
      call.connectMs = performance.now() - t0;
      renderMetrics();
      setStatus('live', 'Escuchando');
      setHint('Estás en línea. Pregunta lo que quieras saber de Pablo.');
      if (session.resumed && history.length) {
        const transcript = history
          .slice(-20)
          .map((h) => `${h.role === 'user' ? 'Usuario' : AGENT_NAME}: ${h.text}`)
          .join('\n');
        send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: `Conversación previa con este usuario (la llamada se pausó y se reanudó):\n${transcript}` }],
          },
        });
        send({
          type: 'response.create',
          response: { instructions: 'En una frase breve, di que retoman donde se quedaron y pregunta si quiere seguir con el tema o preguntar otra cosa. Usa el idioma de la conversación previa.' },
        });
      } else {
        send({
          type: 'response.create',
          response: {
            instructions: `Saluda en una sola frase breve, preséntate como ${AGENT_NAME} y pregunta qué quieren saber de Pablo.`,
          },
        });
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.clientSecret}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpRes.ok) throw new Error(`El servicio de voz respondió ${sdpRes.status}`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
    } catch (err) {
      hangUp();
      fail(err.message);
      return;
    }

    ui.call.disabled = false;
    ui.call.classList.add('hangup');
    ui.callLabel.textContent = 'Pausar / colgar';
    ui.mute.disabled = false;

    const tick = () => {
      if (!call) return;
      const left = Math.max(0, Math.round((call.deadline - Date.now()) / 1000));
      ui.timer.textContent = fmtTime(left);
      if (left === 0) hangUp('Se acabaron tus minutos de hoy. ¡Gracias por conversar!');
    };
    tick();
    call.tick = setInterval(tick, 500);
  }

  function hangUp(message) {
    if (!call) return;
    clearInterval(call.tick);
    // El servidor mide el tiempo; esto solo le avisa que la sesión terminó.
    try {
      navigator.sendBeacon(`${document.body.dataset.voiceApi}/end`, new Blob(['{}'], { type: 'text/plain' }));
    } catch {}
    const left = Math.max(0, Math.round((call.deadline - Date.now()) / 1000));
    const canResume = left >= 10 && (!call.resumeUntil || Date.now() < call.resumeUntil);
    paused = canResume ? { remainingSeconds: left, resumeUntil: call.resumeUntil } : null;
    if (!message) {
      if (canResume) {
        const until = call.resumeUntil
          ? ` hasta las ${new Date(call.resumeUntil).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
          : '';
        message = `Llamada en pausa. Te quedan ${fmtTime(left)} min; puedes reanudarla${until}.`;
      } else {
        message = 'Llamada terminada. ¡Gracias por conversar!';
      }
    }
    try {
      call.dc?.close();
    } catch {}
    call.pc.getSenders().forEach((s) => s.track?.stop());
    call.pc.close();
    call.mic.getTracks().forEach((tr) => tr.stop());
    robot?.stop();
    robot = null;
    ui.audio.srcObject = null;
    micAnalyser = null;
    remoteAnalyser = null;
    for (const el of bubbles.values()) el.classList.remove('pending');
    call = null;
    setStatus('idle', paused ? 'En pausa' : 'Terminada');
    setHint(message);
    ui.call.classList.remove('hangup');
    ui.callLabel.textContent = paused ? 'Reanudar conversación' : 'Iniciar conversación';
    ui.timer.textContent = fmtTime(paused ? paused.remainingSeconds : 0);
    ui.call.disabled = false;
    ui.mute.disabled = true;
    ui.mute.setAttribute('aria-pressed', 'false');
    ui.mute.textContent = 'Silenciar micrófono';
  }

  function fail(message) {
    setStatus('error', 'Error');
    setHint(message, true);
    ui.call.disabled = false;
  }

  ui.call.addEventListener('click', () => (call ? hangUp() : start()));
  ui.robot.addEventListener('click', () => {
    robotOn = !robotOn;
    robot?.setEnabled(robotOn);
    renderRobot();
    try {
      localStorage.setItem('robotVoice', robotOn ? 'on' : 'off');
    } catch {}
  });
  ui.mute.addEventListener('click', () => {
    if (!call) return;
    const track = call.mic.getAudioTracks()[0];
    track.enabled = !track.enabled;
    ui.mute.setAttribute('aria-pressed', String(!track.enabled));
    ui.mute.textContent = track.enabled ? 'Silenciar micrófono' : 'Activar micrófono';
  });
  window.addEventListener('pagehide', () => hangUp());
}
