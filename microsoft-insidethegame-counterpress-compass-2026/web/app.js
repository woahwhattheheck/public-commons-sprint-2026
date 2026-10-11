const el = id => document.getElementById(id);
const L = {
  en: {synthetic: 'SYNTHETIC MATCH · invented teams and events', scenario: 'Match situation', seed: 'Seed', dice: 'Random seed', kickoff: 'Kick off',
    noGoals: `Goals aren't part of this synthetic feed, so shots are shown instead of a scoreline.`,
    thirds: 'Highlighted third = latest event. Shading = where your club pressed most. The feed records pitch thirds, not exact positions.',
    club: 'Your club', mode: 'Mode', language: 'Language', story: 'The story so far', numbers: 'Numbers', moments: 'Key moments', feed: 'Live feed',
    aiTitle: 'Optional AI commentary (Microsoft Foundry)', aiAsk: 'Ask for commentary', aiOff: 'Not configured', aiFail: 'Commentary unavailable; match captions keep working.',
    opusTitle: 'AI match insight (optional)', opusAsk: 'Explain this moment', opusOff: 'Not configured', opusWait: 'Writing insight…', opusSlow: 'Still writing — the match stays fully usable.', opusFail: 'Insight unavailable right now; match captions keep working.', opusBusy: 'Insight is busy; try again in a little while.', opusAt: n => `Event ${n}`,
    share: 'Copy match link', shareCopied: 'Link copied. It opens this moment paused.', shareManual: 'Select and copy the link below.', shareHelp: 'Reopens this synthetic match at the selected event. The recipient needs access to this app.', shareLocal: 'Local address: the link opens only where this app is running.', badLink: 'This match link is invalid or no longer supported. A fresh match is ready.', clampedLink: 'The saved event is beyond this version of the match; showing its final event.',
    play: '▶ Play', pause: '❚❚ Pause', step: 'Next event', restart: 'Restart', ready: 'READY', live: 'LIVE', paused: 'PAUSED', ft: 'FULL TIME',
    reconnecting: 'Reconnecting…', expiredSession: 'The session expired. Resume from the last confirmed moment.', recover: 'Resume match', recovering: 'Restoring the last confirmed event…', recoverFailed: 'Recovery failed. Check your connection and try Resume match again.', outOfSync: 'Event order changed. Resume from the last confirmed event.', loading: 'Setting up match…', badSeed: 'Seed must be 1–999999.',
    shots: n => n + (n === 1 ? ' shot' : ' shots'), counterpress: 'Counterpress', waiting: 'Waiting for the next counterpress moment…', start: 'Press Play to stream the match event by event.',
    type: {pass: 'passes', loss: 'loses the ball', pressure: 'presses', regain: 'wins it back', shot: 'shoots', clock: 'clock'},
    kickoffEv: 'Kick-off', fulltimeEv: 'Full time',
    zone: {defensive: 'own third', middle: 'middle third', attacking: 'final third'},
    rows: {shots: 'Shots', share: 'Share of on-ball actions', cp: 'Counterpresses', regains: 'Won back within 8s', rate: 'Regain rate (settled)', mean: 'Avg. time to win back', unclear: 'Unclear outcome'},
    chip: {success: 'Won back', expired: 'Timed out', interrupted: 'Unclear'},
    noMoments: 'No counterpress moments yet.', reviewFilter: 'Filter moments', reviewPeriod: 'Match half', reviewPeriodAll: 'Both halves', reviewPeriodFirst: 'First half', reviewPeriodSecond: 'Second half', feedFilterTeam: 'Feed team', feedBoth: 'Both teams', feedFocus: 'Your club', feedRival: 'Opponent', feedType: 'Event type', feedTypeAll: 'All events', feedPass: 'Pass', feedLoss: 'Loss', feedPressure: 'Pressure', feedRegain: 'Regain', feedShot: 'Shot', feedClock: 'Clock', feedEmpty: 'No observed events match these filters.', reviewAll: 'All outcomes', reviewSuccess: 'Won back', reviewExpired: '8s elapsed', reviewInterrupted: 'Unclear', reviewSelected: 'Press evidence', reviewEmpty: 'No settled press windows in this view.', reviewMissing: 'No moments match this filter.', reviewObserved: 'Next observed event', reviewNoNext: 'No later event observed in this match prefix.', reviewCaution: 'The following event is context, not proof the press caused it.', reviewJump: 'Replay this outcome', reviewCount: (n,total) => n + ' of ' + total + ' observed moments', reviewEvidence: 'Recorded evidence', reviewReason: {success: (n,s) => n + ' pressure action(s); same-team regain in ' + s + 's inside the official 8s window.', expired: (n) => n + ' pressure action(s); the log passed 8s without a qualifying regain.', interrupted: (n) => n + ' pressure action(s); a new same-team loss interrupted the window, so recovery is unknown.'}, progress: (c, n) => `Event ${c} of ${n}.`, at: 'at',
    ins: {none: 'Nothing has happened yet — press Play.', front: (t, n) => `${t} are on the front foot: ${n} pressing actions in the last five minutes.`,
      even: n => `An even spell: ${n} pressing actions between the sides in the last five minutes.`, quiet: 'A quiet spell — little pressing in the last five minutes.',
      regainBest: (t, s) => `${t} win the ball back in ${s}s on average after losing it.`, noRegain: t => `${t} haven't won the ball back inside eight seconds yet.`,
      shotsLead: (t, a, b) => `${t} lead the shots ${a}–${b}.`, shotsLevel: a => `Shots are level at ${a}–${a}.`,
      rateLine: (s, r, p) => `Regain rate ${p}% (${s}/${r} settled windows).`, unclearLine: n => `${n} window(s) cut short by another loss — outcome unknown, not counted as a failure.`,
      zoneLine: z => `Most successful counterpresses: ${z}.`, pressLine: x => `${x} pressing actions per counterpress.`, rivalLine: (t, p) => `${t}: regain rate ${p}.`}},
  es: {synthetic: 'PARTIDO SINTÉTICO · equipos y jugadas inventados', scenario: 'Situación', seed: 'Semilla', dice: 'Semilla aleatoria', kickoff: 'Saque inicial',
    noGoals: 'Los goles no forman parte de este feed sintético; se muestran tiros en lugar de marcador.',
    thirds: 'Tercio resaltado = última jugada. Sombreado = donde más presionó tu club. El feed registra tercios del campo, no posiciones exactas.',
    club: 'Tu club', mode: 'Modo', language: 'Idioma', story: 'La historia hasta ahora', numbers: 'Números', moments: 'Momentos clave', feed: 'En directo',
    aiTitle: 'Comentario IA opcional (Microsoft Foundry)', aiAsk: 'Pedir comentario', aiOff: 'No configurado', aiFail: 'Comentario no disponible; los textos del partido siguen activos.',
    opusTitle: 'Análisis IA del momento (opcional)', opusAsk: 'Explicar este momento', opusOff: 'No configurado', opusWait: 'Escribiendo análisis…', opusSlow: 'Sigue escribiendo; el partido sigue disponible.', opusFail: 'Análisis no disponible ahora; los textos del partido siguen activos.', opusBusy: 'Análisis ocupado; inténtalo de nuevo en un rato.', opusAt: n => `Jugada ${n}`,
    share: 'Copiar enlace del partido', shareCopied: 'Enlace copiado. Abre esta jugada en pausa.', shareManual: 'Selecciona y copia el enlace de abajo.', shareHelp: 'Abre este partido sintético en la jugada elegida. El destinatario necesita acceso a esta aplicación.', shareLocal: 'Dirección local: el enlace solo abre donde se ejecuta esta aplicación.', badLink: 'Este enlace no es válido o ya no es compatible. Hay un partido nuevo listo.', clampedLink: 'La jugada guardada supera esta versión del partido; se muestra la última.',
    play: '▶ Reproducir', pause: '❚❚ Pausa', step: 'Siguiente jugada', restart: 'Reiniciar', ready: 'LISTO', live: 'EN DIRECTO', paused: 'PAUSA', ft: 'FINAL',
    reconnecting: 'Reconectando…', expiredSession: 'La sesión caducó. Recupera la última jugada confirmada.', recover: 'Reanudar partido', recovering: 'Recuperando la última jugada confirmada…', recoverFailed: 'No se pudo reanudar. Comprueba la conexión y vuelve a intentarlo.', outOfSync: 'El orden de jugadas cambió. Recupera la última jugada confirmada.', loading: 'Preparando partido…', badSeed: 'La semilla debe ser 1–999999.',
    shots: n => n + (n === 1 ? ' tiro' : ' tiros'), counterpress: 'Contrapresión', waiting: 'Esperando el próximo momento de contrapresión…', start: 'Pulsa Reproducir para seguir el partido jugada a jugada.',
    type: {pass: 'pasa', loss: 'pierde el balón', pressure: 'presiona', regain: 'recupera', shot: 'dispara', clock: 'reloj'},
    kickoffEv: 'Saque inicial', fulltimeEv: 'Final del partido',
    zone: {defensive: 'campo propio', middle: 'zona media', attacking: 'último tercio'},
    rows: {shots: 'Tiros', share: 'Cuota de acciones con balón', cp: 'Contrapresiones', regains: 'Recuperadas en 8s', rate: 'Tasa de recuperación (resueltas)', mean: 'Tiempo medio de recuperación', unclear: 'Resultado incierto'},
    chip: {success: 'Recuperada', expired: 'Sin recuperar', interrupted: 'Incierta'},
    noMoments: 'Aún no hay momentos de contrapresión.', reviewFilter: 'Filtrar jugadas', reviewPeriod: 'Tiempo', reviewPeriodAll: 'Ambos tiempos', reviewPeriodFirst: 'Primer tiempo', reviewPeriodSecond: 'Segundo tiempo', feedFilterTeam: 'Equipo del feed', feedBoth: 'Ambos equipos', feedFocus: 'Tu club', feedRival: 'Rival', feedType: 'Tipo de jugada', feedTypeAll: 'Todas', feedPass: 'Pase', feedLoss: 'Pérdida', feedPressure: 'Presión', feedRegain: 'Recuperación', feedShot: 'Tiro', feedClock: 'Reloj', feedEmpty: 'Ninguna jugada observada coincide con los filtros.', reviewAll: 'Todos', reviewSuccess: 'Recuperada', reviewExpired: '8s cumplidos', reviewInterrupted: 'Incierta', reviewSelected: 'Evidencia de presión', reviewEmpty: 'No hay ventanas de presión resueltas en esta vista.', reviewMissing: 'Ninguna jugada coincide con el filtro.', reviewObserved: 'Siguiente jugada observada', reviewNoNext: 'No hay jugadas posteriores observadas en este segmento.', reviewCaution: 'La siguiente jugada es contexto, no prueba de causalidad.', reviewJump: 'Reproducir este resultado', reviewCount: (n,total) => n + ' de ' + total + ' jugadas observadas', reviewEvidence: 'Evidencia registrada', reviewReason: {success: (n,s) => n + ' presión(es); recuperación del mismo equipo en ' + s + 's dentro de 8s.', expired: (n) => n + ' presión(es); pasaron 8s sin una recuperación válida.', interrupted: (n) => n + ' presión(es); otra pérdida interrumpió la ventana y el resultado es desconocido.'}, progress: (c, n) => `Jugada ${c} de ${n}.`, at: 'a los',
    ins: {none: 'Aún no ha pasado nada: pulsa Reproducir.', front: (t, n) => `${t} manda: ${n} acciones de presión en los últimos cinco minutos.`,
      even: n => `Fase igualada: ${n} acciones de presión entre ambos en los últimos cinco minutos.`, quiet: 'Fase tranquila: poca presión en los últimos cinco minutos.',
      regainBest: (t, s) => `${t} recupera el balón en ${s}s de media tras perderlo.`, noRegain: t => `${t} aún no ha recuperado el balón en menos de ocho segundos.`,
      shotsLead: (t, a, b) => `${t} gana en tiros ${a}–${b}.`, shotsLevel: a => `Igualdad en tiros: ${a}–${a}.`,
      rateLine: (s, r, p) => `Tasa de recuperación ${p}% (${s}/${r} ventanas resueltas).`, unclearLine: n => `${n} ventana(s) cortada(s) por otra pérdida: resultado desconocido, no cuenta como fallo.`,
      zoneLine: z => `Contrapresiones exitosas sobre todo en: ${z}.`, pressLine: x => `${x} acciones de presión por contrapresión.`, rivalLine: (t, p) => `${t}: tasa de recuperación ${p}.`}}
};
const S = {session: null, events: [], cursor: 0, selectedMomentId: null, es: null, conn: 0, req: 0, starting: 0, playing: false, frame: null, foundry: false, opus: false, opusKey: null, match: null, linkTimer: null, transport: 'ready', recoverable: false, recoveryBusy: false};
const t = () => L[el('locale').value] || L.en;
const view = () => ({team: el('team').value, audience: el('audience').value, locale: el('locale').value});
const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const notice = msg => { el('notice').textContent = msg || ''; };
const sideOf = (team, zone) => zone === 'middle' ? 'M' : ((zone === 'attacking') === (team === 'Harbor FC') ? 'R' : 'L');
const CENTER = {L: 175, M: 525, R: 875};

// A watch link describes a synthetic match, never a live session or provider.
const MatchLink = {
  keys: ['watch', 'scenario', 'seed', 'event', 'team', 'audience', 'locale'],
  read(hash, scenarios) {
    const q = new URLSearchParams(hash.replace(/^#/, ''));
    if (!q.has('watch')) return null;
    const invalid = () => { throw new Error('invalid_match_link'); };
    if (this.keys.some(k => q.getAll(k).length !== 1) || [...q.keys()].some(k => !this.keys.includes(k)) || q.get('watch') !== '1') invalid();
    const scenario = q.get('scenario'), seed = q.get('seed'), count = q.get('event');
    if (!scenarios.includes(scenario) || !/^[1-9][0-9]{0,5}$/.test(seed) || !/^(0|[1-9][0-9]{0,6})$/.test(count)) invalid();
    const team = q.get('team'), audience = q.get('audience'), locale = q.get('locale');
    if (!['Harbor FC', 'Metro Rovers'].includes(team) || !['casual', 'analyst'].includes(audience) || !['en', 'es'].includes(locale)) invalid();
    return {scenario, seed: Number(seed), count: Number(count), team, audience, locale};
  },
  url(match, count, settings, href) {
    const url = new URL(href);
    url.username = ''; url.password = ''; url.search = '';
    url.hash = new URLSearchParams({watch: '1', scenario: match.scenario, seed: String(match.seed), event: String(count), team: settings.team, audience: settings.audience, locale: settings.locale}).toString();
    return url.href;
  }
};
function currentMatchLink() {
  if (!S.session || !S.match || !S.frame || S.frame.sessionId !== S.session.id || S.frame.count !== S.cursor) return null;
  return MatchLink.url(S.match, S.cursor, {team: S.frame.team, audience: S.frame.audience, locale: S.frame.locale}, location.href);
}
function syncMatchLink(immediate = false) {
  if (immediate && S.linkTimer) { clearTimeout(S.linkTimer); S.linkTimer = null; }
  const write = () => {
    S.linkTimer = null;
    const url = currentMatchLink();
    if (!url) return;
    try { if (location.href !== url) history.replaceState(null, '', url); } catch { /* Copy remains usable when history writes are restricted. */ }
  };
  if (immediate || !S.playing) write();
  else if (!S.linkTimer) S.linkTimer = setTimeout(write, 1000);
}
async function copyMatchLink() {
  const url = currentMatchLink();
  if (!url) return;
  const field = el('matchLink'), result = el('shareStatus');
  field.value = url;
  // Keep a native text field available even when clipboard access is denied.
  field.hidden = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
    await navigator.clipboard.writeText(url);
    result.textContent = t().shareCopied;
  } catch {
    result.textContent = t().shareManual;
    field.focus(); field.select();
  }
}

async function api(url, method = 'GET', body) {
  const r = await fetch(url, body === undefined ? {method} : {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const obj = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(obj.error || 'Request failed'), {status: r.status});
  return obj;
}
function node(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function tally(type) {
  const out = {'Harbor FC': 0, 'Metro Rovers': 0};
  for (const e of S.events) if (type ? e.type === type : e.type !== 'clock') out[e.team]++;
  return out;
}
function eventLine(e) {
  const T = t();
  if (e.type === 'clock') return e.second === 0 ? T.kickoffEv : e.second >= 5400 ? T.fulltimeEv : fmt(e.second);
  return `${e.team} · ${e.player} ${T.type[e.type]} (${T.zone[e.zone]})`;
}

function drawPitch(f) {
  const T = t(), heat = {L: 0, M: 0, R: 0};
  for (const e of S.events) if (e.type === 'pressure' && e.team === f.team) heat[sideOf(e.team, e.zone)]++;
  const max = Math.max(1, heat.L, heat.M, heat.R);
  const e = f.event && f.event.type !== 'clock' ? f.event : null;
  const now = e ? sideOf(e.team, e.zone) : null;
  for (const k of ['L', 'M', 'R']) {
    const b = el('band' + k);
    b.setAttribute('fill-opacity', (0.04 + 0.32 * heat[k] / max).toFixed(2));
    b.classList.toggle('now', k === now);
  }
  const dot = el('dot'), mark = el('marker');
  if (!e) { dot.setAttribute('visibility', 'hidden'); mark.textContent = ''; return; }
  dot.setAttribute('visibility', 'visible');
  dot.setAttribute('cx', String(CENTER[now]));
  dot.setAttribute('class', 'dot ' + (e.team === 'Harbor FC' ? 'harbor' : 'metro'));
  mark.setAttribute('x', String(CENTER[now]));
  mark.textContent = `${e.player} · ${T.type[e.type]}`;
}
function drawCue(f) {
  const T = t();
  const cue = f.overlays.filter(o => o.showAt <= f.elapsedSeconds && f.elapsedSeconds < o.hideAt).at(-1);
  if (cue) {
    el('cue').className = 'cue ' + cue.status;
    el('cueLabel').textContent = `${T.counterpress} · ${T.chip[cue.status] || cue.status} · ${fmt(cue.showAt)}`;
    el('cueText').textContent = cue.text;
    return;
  }
  el('cue').className = 'cue quiet';
  el('cueLabel').textContent = T.counterpress;
  el('cueText').textContent = f.event ? `${fmt(f.event.second)} · ${eventLine(f.event)}. ${T.waiting}` : T.start;
}
function drawStats(f) {
  const T = t(), sh = tally('shot'), all = tally();
  const total = Math.max(1, all['Harbor FC'] + all['Metro Rovers']);
  const a = f.stats, b = f.rival.stats, rv = f.rival.team;
  const sec = v => v === null ? '—' : v + 's', pct = v => v === null ? '—' : v + '%';
  el('thFocus').textContent = f.team; el('thRival').textContent = rv;
  el('shotsH').textContent = T.shots(sh['Harbor FC']); el('shotsM').textContent = T.shots(sh['Metro Rovers']);
  const rows = [[T.rows.shots, sh[f.team], sh[rv]],
    [T.rows.share, Math.round(100 * all[f.team] / total) + '%', Math.round(100 * all[rv] / total) + '%'],
    [T.rows.cp, a.counterpressAttempts, b.counterpressAttempts], [T.rows.regains, a.successes, b.successes],
    [T.rows.mean, sec(a.meanRecoverySeconds), sec(b.meanRecoverySeconds)]];
  if (f.audience === 'analyst') rows.push([T.rows.rate, pct(a.successRatePct), pct(b.successRatePct)], [T.rows.unclear, a.interruptedAttempts, b.interruptedAttempts]);
  el('stats').replaceChildren(...rows.map(([k, x, y]) => {
    const tr = node('tr'), th = node('th', '', k); th.scope = 'row';
    tr.append(th, node('td', '', String(x)), node('td', '', String(y)));
    return tr;
  }));
}
function insights(f) {
  const T = t(), ev = S.events, team = f.team, rival = f.rival.team, out = [];
  if (!ev.length) return [T.ins.none];
  const recent = ev.filter(e => e.type === 'pressure' && e.second > f.elapsedSeconds - 300);
  const a = recent.filter(e => e.team === team).length, b = recent.length - a;
  if (recent.length < 2) out.push(T.ins.quiet);
  else if (a >= b * 1.5 && a >= 3) out.push(T.ins.front(team, a));
  else if (b >= a * 1.5 && b >= 3) out.push(T.ins.front(rival, b));
  else out.push(T.ins.even(recent.length));
  const sh = tally('shot'), sf = sh[team], sr = sh[rival];
  out.push(sf === sr ? T.ins.shotsLevel(sf) : sf > sr ? T.ins.shotsLead(team, sf, sr) : T.ins.shotsLead(rival, sr, sf));
  const st = f.stats;
  if (f.audience === 'casual') {
    out.push(st.meanRecoverySeconds === null ? T.ins.noRegain(team) : T.ins.regainBest(team, st.meanRecoverySeconds));
    return out;
  }
  if (st.successRatePct !== null) out.push(T.ins.rateLine(st.successes, st.resolvedCounterpressAttempts, st.successRatePct));
  if (st.interruptedAttempts) out.push(T.ins.unclearLine(st.interruptedAttempts));
  if (f.overlays.length) out.push(T.ins.pressLine((f.overlays.reduce((s, o) => s + o.metrics.pressureCount, 0) / f.overlays.length).toFixed(1)));
  const zc = {};
  for (const o of f.overlays) if (o.status === 'success') zc[o.metrics.zone] = (zc[o.metrics.zone] || 0) + 1;
  const best = Object.entries(zc).sort((x, y) => y[1] - x[1])[0];
  if (best) out.push(T.ins.zoneLine(T.zone[best[0]]));
  const rr = f.rival.stats.successRatePct;
  out.push(T.ins.rivalLine(rival, rr === null ? '—' : rr + '%'));
  return out;
}
// Every replayed explanation is derived from original fixture IDs already
// present in the current validated event prefix. Never infer unseen plays.
function reviewEvidence(f, o) {
  const T = t(), root = el('review');
  root.replaceChildren();
  if (!o) { root.append(node('p', 'note', T.reviewEmpty)); return; }
  const known = new Set(o.evidenceIds);
  const trace = S.events.filter(e => known.has(e.id));
  const head = node('h3', '', T.reviewSelected + ' · ' + fmt(o.showAt));
  const summary = node('p', 'review-summary', o.text);
  const reason = node('p', 'review-why', T.reviewReason[o.status](o.metrics.pressureCount, o.metrics.secondsToRecover));
  const label = node('h4', '', T.reviewEvidence);
  const chain = node('ol', 'review-evidence');
  for (const e of trace) {
    const li = node('li');
    li.append(node('code', '', e.id), node('time', '', fmt(e.second)), node('span', '', eventLine(e)));
    chain.append(li);
  }
  // An expired window becomes established only when a later event advances
  // the event-time watermark strictly beyond the eight-second boundary.
  const lastId = o.evidenceIds.at(-1);
  const closingIndex = o.status === 'expired'
    ? S.events.findIndex(e => e.second > o.showAt)
    : S.events.findIndex(e => e.id === lastId);
  const afterIndex = o.status === 'expired' ? closingIndex : closingIndex + 1;
  const next = closingIndex < 0 ? null : S.events.slice(afterIndex).find(e => e.type !== 'clock');
  const observation = node('p', 'review-following', next
    ? T.reviewObserved + ': ' + next.id + ' · ' + fmt(next.second) + ' · ' + eventLine(next)
    : T.reviewNoNext);
  const caution = node('p', 'note', T.reviewCaution);
  const jump = node('button', 'review-jump', T.reviewJump);
  jump.type = 'button'; jump.disabled = closingIndex < 0;
  jump.addEventListener('click', () => { if (S.session && closingIndex >= 0) void seek(closingIndex + 1); });
  root.append(head, summary, reason, label, chain, observation, caution, jump);
}
function drawMoments(f) {
  const T = t(), filter = el('reviewFilter').value, period = el('reviewPeriod').value;
  const visible = f.overlays.filter(o => (filter === 'all' || o.status === filter) &&
    (period === 'all' || (period === 'first' ? o.showAt < 2700 : o.showAt >= 2700))).slice(-10).reverse();
  el('reviewCount').textContent = T.reviewCount(visible.length, f.overlays.length);
  if (!visible.length) {
    el('moments').replaceChildren(node('li', '', f.overlays.length ? T.reviewMissing : T.noMoments));
    reviewEvidence(f, null); return;
  }
  let selected = visible.find(o => o.id === S.selectedMomentId);
  if (!selected) { selected = visible[0]; S.selectedMomentId = selected.id; }
  el('moments').replaceChildren(...visible.map(o => {
    const li = node('li');
    const btn = node('button', 'moment-select' + (o.id === S.selectedMomentId ? ' selected' : ''));
    btn.type = 'button'; btn.setAttribute('aria-pressed', String(o.id === S.selectedMomentId));
    btn.setAttribute('aria-label', fmt(o.showAt) + ' · ' + (T.chip[o.status] || o.status) + ' · ' + o.text);
    const body = node('span');
    body.append(node('span', 'chip ' + o.status, T.chip[o.status] || o.status), document.createTextNode(o.text));
    btn.append(node('b', '', fmt(o.showAt)), body);
    btn.addEventListener('click', () => { S.selectedMomentId = o.id; if (S.frame) drawMoments(S.frame); el('review').focus(); });
    li.append(btn); return li;
  }));
  reviewEvidence(f, selected);
}

function drawFeed() {
  const choice = el('feedTeam').value, type = el('feedType').value, period = el('reviewPeriod').value;
  const focus = S.frame?.team || 'Harbor FC';
  const rows = S.events.filter(e => (choice === 'both' || (choice === 'focus' ? e.team === focus : e.team !== focus)) &&
    (type === 'all' || e.type === type) &&
    (period === 'all' || (period === 'first' ? e.second < 2700 : e.second >= 2700))).slice(-10).reverse();
  el('feed').replaceChildren(...(rows.length ? rows.map(e => {
    const li = node('li', e.team === 'Harbor FC' ? 'harbor' : 'metro');
    li.append(node('b', '', fmt(e.second)), node('span', '', eventLine(e)));
    return li;
  }) : [node('li', '', t().feedEmpty)]));
}
function drawStrip(f) {
  const marks = [node('div', 'half')];
  for (const e of S.events) {
    if (e.type === 'shot' || (e.team === f.team && (e.type === 'loss' || e.type === 'regain'))) {
      const m = node('span', e.type); m.style.left = (100 * e.second / 5400).toFixed(2) + '%'; marks.push(m);
    }
  }
  const head = node('span', 'head'); head.style.left = (100 * f.elapsedSeconds / 5400).toFixed(2) + '%'; marks.push(head);
  el('strip').replaceChildren(...marks);
}
function ui() {
  const T = t(), s = S.session;
  el('play').textContent = S.playing ? T.pause : T.play;
  el('play').setAttribute('aria-pressed', String(S.playing));
  el('share').disabled = !currentMatchLink();
  el('play').disabled = !s; el('restart').disabled = !s; el('scrub').disabled = !s;
  el('step').disabled = !s || S.cursor >= s.total;
  const st = S.playing && S.transport === 'reconnecting' ? 'reconnecting' : S.playing ? 'live' : s && S.cursor >= s.total ? 'ft' : S.cursor > 0 ? 'paused' : 'ready';
  el('state').textContent = T[st]; el('state').className = 'state ' + st;
  el('recover').textContent = T.recover;
  el('recover').hidden = !S.recoverable;
  el('recover').disabled = S.recoveryBusy || !s;
}
function opusKey() { return S.session ? [S.session.id, S.cursor, el('team').value, el('audience').value, el('locale').value].join('|') : ''; }
function apply(f) {
  S.frame = f;
  if (S.opusKey && S.opusKey !== opusKey()) { S.opusKey = null; el('opusResult').textContent = ''; }
  el('clock').textContent = fmt(f.elapsedSeconds);
  el('scrub').value = String(f.count);
  el('progress').textContent = t().progress(f.count, f.total);
  drawPitch(f); drawCue(f); drawStats(f); drawMoments(f); drawFeed(); drawStrip(f);
  el('insight').replaceChildren(...insights(f).map(x => node('li', '', x)));
  syncMatchLink();
  ui();
}
function applyI18n() {
  const T = t();
  document.documentElement.lang = el('locale').value;
  for (const n of document.querySelectorAll('[data-i18n]')) { const v = T[n.dataset.i18n]; if (typeof v === 'string') n.textContent = v; }
  el('shareHelp').textContent = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? T.shareLocal : T.shareHelp;
  el('step').textContent = T.step; el('restart').textContent = T.restart;
  el('foundry').textContent = S.foundry ? T.aiAsk : T.aiOff;
  el('opus').textContent = S.opus ? T.opusAsk : T.opusOff;
  if (S.frame) apply(S.frame); else ui();
}

function stopStream() {
  ++S.conn;
  if (S.es) { S.es.close(); S.es = null; }
  S.playing = false;
  S.transport = 'ready'; S.recoverable = false;
  syncMatchLink(true);
  ui();
}
function play() {
  const s = S.session;
  if (!s) return;
  stopStream();
  ++S.req;
  if (S.cursor >= s.total) { S.events = []; S.cursor = 0; }
  const my = ++S.conn;
  const q = new URLSearchParams({from: String(S.cursor), speed: el('speed').value, ...view()});
  const es = new EventSource(`/api/sessions/${encodeURIComponent(s.id)}/stream?${q}`);
  S.es = es; S.playing = true; ui();
  // A transport reconnection is not a new match or a new clock. Keep the last
  // validated event until the original server resumes the ordered stream.
  es.onopen = () => {
    if (my !== S.conn || S.session !== s) return;
    S.transport = 'ready'; S.recoverable = false; notice(''); ui();
  };
  es.addEventListener('frame', m => {
    if (my !== S.conn || S.session !== s) return;
    let f; try { f = JSON.parse(m.data); } catch { f = null; }
    if (!f || f.sessionId !== s.id || f.count !== S.cursor + 1 || !f.event) {
      stopStream();
      S.recoverable = true; notice(t().outOfSync); ui();
      return;
    }
    S.events.push(f.event); S.cursor = f.count; S.transport = 'ready';
    S.recoverable = false; notice(''); apply(f);
  });
  es.addEventListener('end', () => { if (my === S.conn) stopStream(); });
  es.onerror = () => {
    if (my !== S.conn || S.session !== s) return;
    if (es.readyState === EventSource.CLOSED) {
      stopStream(); S.recoverable = true; notice(t().expiredSession); ui();
    } else {
      S.transport = 'reconnecting'; S.recoverable = true;
      notice(t().reconnecting); ui();
    }
  };
}
// Operator-driven repair: refresh the exact event prefix from the original
// session. Only on an actual 404 do we re-create the same deterministic match.
async function recoverStream() {
  const s = S.session, match = S.match, count = S.cursor;
  if (!s || !match || S.recoveryBusy) return;
  stopStream();
  const token = ++S.req;
  S.recoveryBusy = true; notice(t().recovering); ui();
  try {
    const frame = await api(`/api/sessions/${encodeURIComponent(s.id)}/frame`, 'POST', {count, ...view()});
    if (token !== S.req || S.session !== s) return;
    if (frame.sessionId !== s.id || frame.count !== count || !Array.isArray(frame.events) || frame.events.length !== count) throw new Error('Invalid event prefix');
    S.events = frame.events; S.cursor = count; apply(frame);
    S.recoveryBusy = false; notice(''); play();
  } catch (e) {
    if (token !== S.req || S.session !== s) return;
    if (e.status === 404 || e.status === 410) {
      // The server discarded its ephemeral session, not the match definition.
      // Never continue a stale stream or silently replace the selected fixture.
      el('scenario').value = match.scenario; el('seed').value = String(match.seed);
      const nextStart = S.starting + 1;
      await newMatch({count});
      if (S.starting === nextStart && S.session !== s && S.frame?.sessionId === S.session?.id &&
          S.match?.scenario === match.scenario && S.match?.seed === match.seed) {
        S.recoveryBusy = false; notice(''); play();
        return;
      }
    }
    if (S.session === s || (!S.playing && S.match?.scenario === match.scenario && S.match?.seed === match.seed)) {
      S.recoverable = true; notice(t().recoverFailed);
    }
  } finally {
    S.recoveryBusy = false; ui();
  }
}
async function seek(count) {
  const s = S.session;
  if (!s) return;
  stopStream();
  const token = ++S.req;
  el('foundryResult').textContent = '';
  el('opusResult').textContent = ''; S.opusKey = null;
  try {
    const f = await api(`/api/sessions/${encodeURIComponent(s.id)}/frame`, 'POST', {count, ...view()});
    if (token !== S.req || S.session !== s || f.sessionId !== s.id) return;
    S.events = f.events; S.cursor = f.count;
    apply(f);
  } catch (e) { if (token === S.req) notice(e.status === 404 ? t().expiredSession : e.message); }
}
async function refreshView() {
  S.selectedMomentId = null;
  applyI18n();
  const resume = S.playing;
  await seek(S.cursor);
  if (resume && !S.playing) play();
}
async function newMatch({count = 0} = {}) {
  const seed = Number(el('seed').value), scenario = el('scenario').value;
  if (!Number.isInteger(seed) || seed < 1 || seed > 999999) { notice(t().badSeed); return; }
  stopStream();
  const token = ++S.starting; ++S.req;
  notice(t().loading);
  const old = S.session;
  try {
    const s = await api('/api/sessions', 'POST', {scenario, seed});
    if (token !== S.starting) { fetch('/api/sessions/' + encodeURIComponent(s.id), {method: 'DELETE'}).catch(() => {}); return; }
    if (old) fetch('/api/sessions/' + encodeURIComponent(old.id), {method: 'DELETE'}).catch(() => {});
    S.session = s; S.match = {scenario, seed}; S.events = []; S.cursor = 0; S.frame = null; S.selectedMomentId = null;
    el('matchLink').hidden = true; el('shareStatus').textContent = '';
    el('scrub').max = String(s.total);
    el('blurb').textContent = s.blurb;
    el('foundryResult').textContent = '';
    notice('');
    await seek(Math.min(count, s.total));
    if (count > s.total) notice(t().clampedLink);
  } catch (e) { if (token === S.starting) notice(e.message); }
}

async function boot() {
  const b = await api('/api/bootstrap');
  for (const sc of b.scenarios) { const o = node('option', '', sc.label); o.value = sc.id; el('scenario').append(o); }
  el('scenario').value = b.defaultScenario;
  let linked = null, invalidLink = false;
  try { linked = MatchLink.read(location.hash, b.scenarios.map(sc => sc.id)); } catch { invalidLink = true; }
  if (linked) {
    el('scenario').value = linked.scenario; el('seed').value = String(linked.seed);
    for (const id of ['team', 'audience', 'locale']) el(id).value = linked[id];
  }
  S.foundry = !!b.foundryConfigured;
  el('foundry').disabled = !S.foundry;
  S.opus = !!b.opusConfigured;
  el('opus').disabled = !S.opus;
  el('share').addEventListener('click', copyMatchLink);
  el('kickoff').addEventListener('click', newMatch);
  el('scenario').addEventListener('change', newMatch);
  el('seed').addEventListener('keydown', e => { if (e.key === 'Enter') newMatch(); });
  el('dice').addEventListener('click', () => { el('seed').value = String(1 + crypto.getRandomValues(new Uint32Array(1))[0] % 999999); newMatch(); });
  el('play').addEventListener('click', () => (S.playing ? stopStream() : play()));
  el('recover').addEventListener('click', recoverStream);
  el('reviewFilter').addEventListener('change', () => { S.selectedMomentId = null; if (S.frame) drawMoments(S.frame); });
  el('reviewPeriod').addEventListener('change', () => { S.selectedMomentId = null; if (S.frame) { drawMoments(S.frame); drawFeed(); } });
  for (const id of ['feedTeam', 'feedType']) el(id).addEventListener('change', drawFeed);
  el('step').addEventListener('click', () => { if (S.session) seek(Math.min(S.cursor + 1, S.session.total)); });
  el('restart').addEventListener('click', () => seek(0));
  el('speed').addEventListener('change', () => { if (S.playing) play(); });
  el('scrub').addEventListener('change', () => seek(Number(el('scrub').value)));
  for (const id of ['team', 'audience', 'locale']) el(id).addEventListener('change', refreshView);
  el('foundry').addEventListener('click', async () => {
    const s = S.session;
    if (!s || !S.foundry) return;
    const b2 = el('foundry'), token = S.req, cur = S.cursor, at = S.frame ? S.frame.elapsedSeconds : 0;
    b2.disabled = true; el('foundryResult').textContent = '…';
    try {
      const d = await api('/api/foundry-draft', 'POST', {sessionId: s.id, count: cur, ...view()});
      if (token === S.req && S.session === s) el('foundryResult').textContent = d.used ? `${d.label} (${t().at} ${fmt(at)}): ${d.text}` : t().aiFail;
    } catch { if (token === S.req && S.session === s) el('foundryResult').textContent = t().aiFail; }
    finally { b2.disabled = !S.foundry; }
  });
  el('opus').addEventListener('click', async () => {
    const s = S.session;
    if (!s || !S.opus) return;
    const k = opusKey(), body = {sessionId: s.id, count: S.cursor, ...view()}, btn = el('opus'), out = el('opusResult');
    const current = () => S.session === s && opusKey() === k;
    S.opusKey = k; btn.disabled = true; out.textContent = t().opusWait;
    try {
      for (let i = 0; i < 60 && current(); i++) {
        const d = await api('/api/opus-commentary', 'POST', body);
        if (!current()) return;
        if (d.state === 'ready' && d.sessionId === s.id && d.recordedCount === body.count) { out.textContent = `${t().opusAt(d.recordedCount)} · ${fmt(d.frameSecond)} · ${d.caption} ${d.text}`; return; }
        if (d.state !== 'pending') { out.textContent = t().opusFail; return; }
        if (i === 3) out.textContent = t().opusSlow;
        await new Promise(r => setTimeout(r, 3000));
      }
      if (current()) out.textContent = t().opusSlow;
    } catch (e) { if (current()) out.textContent = e.status === 429 ? t().opusBusy : t().opusFail; }
    finally { btn.disabled = !S.opus; }
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea,button') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); el('play').click(); }
    else if (e.key === 'ArrowRight') el('step').click();
  });
  addEventListener('pagehide', () => { syncMatchLink(true); if (S.session) fetch('/api/sessions/' + encodeURIComponent(S.session.id), {method: 'DELETE', keepalive: true}).catch(() => {}); });
  addEventListener('pageshow', e => {
    if (!e.persisted || !S.match) return;
    el('scenario').value = S.match.scenario; el('seed').value = String(S.match.seed);
    void newMatch({count: S.cursor}); // pagehide deleted the old session; rebuild the saved view.
  });
  applyI18n();
  await newMatch({count: linked?.count || 0});
  if (invalidLink) notice(t().badLink);
}
boot().catch(e => { el('cueText').textContent = 'Could not load the match: ' + String(e.message).slice(0, 80); });

