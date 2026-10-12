// Broadcast editing is a projection of the original event engine and saved match.
import {derive, makeSnapshot, validateFixture, TEAMS} from './engine.mjs';
import {parseCount, parseView} from './live_sessions.mjs';

export const BROADCAST_FORMAT = 'counterpress.broadcast.v1';
export const MAX_BROADCAST_CUES = 64;
const fail = message => Object.assign(new Error(message), {status: 400});
const object = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(name + ' must be an object');
  return value;
};
function string(value, limit, name, fallback = '') {
  const out = value === undefined ? fallback : value;
  if (typeof out !== 'string' || out.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(out))
    throw fail(name + ' is invalid or too long');
  return out;
}
function videoSecond(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 86400)
    throw fail(name + ' must be recording seconds from 0 to 86400');
  return Math.round(value * 1000) / 1000;
}
export function matchClock(second) {
  const tenths = Math.round(second * 10);
  return String(Math.floor(tenths / 600)).padStart(2, '0') + ':' +
    String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
}
function videoClock(second) {
  const ms = Math.round(second * 1000);
  return String(Math.floor(ms / 3600000)).padStart(2, '0') + ':' +
    String(Math.floor(ms / 60000) % 60).padStart(2, '0') + ':' +
    String(Math.floor(ms / 1000) % 60).padStart(2, '0') + '.' +
    String(ms % 1000).padStart(3, '0');
}
const ACTIONS = {
  en: {loss: 'loses possession', pressure: 'applies pressure', regain: 'wins the ball back',
    pass: 'plays a pass', shot: 'takes a shot', clock: 'match clock'},
  es: {loss: 'pierde la posesión', pressure: 'presiona', regain: 'recupera el balón',
    pass: 'da un pase', shot: 'dispara', clock: 'reloj del partido'},
};
const ZONES = {
  en: {defensive: 'defensive third', middle: 'middle third', attacking: 'attacking third'},
  es: {defensive: 'tercio defensivo', middle: 'tercio medio', attacking: 'tercio ofensivo'},
};
function eventCaption(event, view) {
  const action = ACTIONS[view.locale][event.type], at = matchClock(event.second);
  if (event.type === 'clock') return (view.locale === 'es' ? 'Reloj del partido: ' : 'Match clock: ') + at + '.';
  if (view.audience === 'analyst')
    return at + ' · ' + event.team + ' · ' + event.player + ' · ' + action + ' · ' +
      ZONES[view.locale][event.zone] + ' (' + event.id + ').';
  return event.team + ': ' + event.player + ' ' + action +
    (view.locale === 'es' ? ' a los ' : ' at ') + at + '.';
}

// An expired press only has an available result at the first original event
// strictly after its deadline. A boundary regain keeps the native inclusive rule.
function sources(match, count, view) {
  validateFixture(match.events);
  const events = match.events.slice(0, count);
  const index = new Map(events.map((event, i) => [event.id, {...event, count: i + 1}]));
  const snapshots = TEAMS.map(team => makeSnapshot(events, {...view, team}));
  const snapshot = snapshots.find(item => item.team === view.team);
  const overlays = new Map(snapshots.flatMap(item => item.overlays).map(item => [item.id, item]));
  const moments = derive(events).filter(item => item.status !== 'not_attempted').map(item => {
    const at = item.status === 'expired'
      ? events.findIndex(event => event.second > item.toSecond) + 1
      : index.get(item.evidenceIds.at(-1)).count;
    const closing = events[at - 1];
    return {key: 'moment:' + item.id, kind: 'sequence', momentId: item.id,
      eventId: closing.id, count: at, matchSecond: item.toSecond, team: item.team,
      players: [...new Set(item.evidenceIds.map(id => index.get(id)).filter(event =>
        event.type !== 'clock' && event.team === item.team).map(event => event.player))],
      status: item.status, caption: overlays.get(item.id).text, windowSeconds: 8,
      pressureCount: item.pressureCount, secondsToRecover: item.secondsToRecover,
      evidence: item.evidenceIds.map(id => index.get(id)),
      watermark: item.status === 'expired' ? index.get(closing.id) : null};
  });
  const actions = events.filter(event => event.type !== 'clock').map(event =>
    ({key: 'event:' + event.id, kind: 'event', momentId: null, eventId: event.id,
      count: index.get(event.id).count, matchSecond: event.second, team: event.team,
      players: [event.player], eventType: event.type, caption: eventCaption(event, view),
      evidence: [index.get(event.id)], watermark: null}));
  return {events, index, snapshot, moments, actions};
}

export function normalizeBroadcast(raw, match) {
  if (raw === undefined || raw === null) return null;
  object(raw, 'Broadcast review');
  if (raw.format !== undefined && raw.format !== BROADCAST_FORMAT) throw fail('Unknown broadcast review format');
  const count = parseCount(raw.count ?? match.events.length, match.events.length);
  const view = parseView(raw.view ?? {});
  const title = string(raw.title, 100, 'Broadcast title', 'Match highlights').trim();
  if (!title) throw fail('Give the broadcast review a title');
  const notes = string(raw.notes, 4000, 'Broadcast notes');
  const recording = object(raw.recording ?? {}, 'Recording');
  const label = string(recording.label, 200, 'Recording name');
  const durationSeconds = videoSecond(recording.durationSeconds, 'Recording duration');
  if (durationSeconds === 0) throw fail('Recording duration must be greater than zero');
  const data = sources(match, count, view);
  const moments = new Map(data.moments.map(item => [item.momentId, item]));
  const seen = new Set(), input = raw.cues ?? [];
  if (!Array.isArray(input) || input.length > MAX_BROADCAST_CUES) throw fail('Choose up to 64 captions');
  const cues = input.map(item => {
    object(item, 'Caption');
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || seen.has(item.id))
      throw fail('Every caption needs a unique ID');
    seen.add(item.id);
    const at = parseCount(item.count, count), event = match.events[at - 1];
    if (!at || !event || event.id !== item.eventId) throw fail('Caption must identify its exact original event');
    const momentId = item.momentId ?? null;
    if (momentId !== null) {
      const moment = moments.get(momentId);
      if (!moment || moment.count !== at || moment.eventId !== event.id)
        throw fail('Press caption must use the original event that establishes its outcome');
    } else if (event.type === 'clock') {
      throw fail('Choose an original player action');
    }
    const caption = string(item.caption, 500, 'Caption text').trim();
    if (!caption) throw fail('Every selected caption needs text');
    const videoStart = videoSecond(item.videoStart, 'Video in point');
    const videoEnd = videoSecond(item.videoEnd, 'Video out point');
    if ((videoStart === null) !== (videoEnd === null) ||
        videoStart !== null && videoEnd <= videoStart)
      throw fail('Supply both video times, with the out point after the in point, or leave both empty');
    if (videoEnd !== null && durationSeconds !== null && videoEnd > durationSeconds)
      throw fail('Caption timing exceeds the selected recording duration');
    return {id: item.id, eventId: event.id, count: at, momentId, caption, videoStart, videoEnd};
  });
  return {format: BROADCAST_FORMAT, title, notes, count, view, recording: {label, durationSeconds}, cues};
}

export function broadcastCandidates(match, broadcast) {
  const data = sources(match, broadcast.count, broadcast.view);
  const moments = data.moments.filter(item => item.team === broadcast.view.team);
  const events = data.actions.filter(item => item.team === broadcast.view.team);
  return {moments, events,
    players: [...new Set(events.map(item => item.players[0]))].sort((a, b) => a.localeCompare(b))};
}

export function createBroadcastReport(match, review) {
  const broadcast = normalizeBroadcast(review.broadcast ?? {
    title: review.title || 'Match highlights', count: review.cursor ?? match.events.length,
    view: review.view, cues: [],
  }, match);
  const data = sources(match, broadcast.count, broadcast.view);
  const candidates = new Map([...data.moments, ...data.actions].map(item => [item.key, item]));
  const cues = broadcast.cues.map(cue => ({
    ...candidates.get(cue.momentId ? 'moment:' + cue.momentId : 'event:' + cue.eventId), ...cue,
    matchClock: matchClock(candidates.get(cue.momentId ? 'moment:' + cue.momentId : 'event:' + cue.eventId).matchSecond),
    availableAtMatchClock: matchClock(match.events[cue.count - 1].second),
    video: cue.videoStart === null ? null : {
      in: videoClock(cue.videoStart), out: videoClock(cue.videoEnd),
      durationSeconds: Math.round((cue.videoEnd - cue.videoStart) * 1000) / 1000},
  }));
  return {
    format: 'counterpress.broadcast-report.v1', generatedAt: new Date().toISOString(), broadcast,
    source: {title: review.title, scenario: match.scenario, seed: match.seed, data: 'synthetic',
      count: broadcast.count, total: match.events.length,
      observedThroughSecond: data.events.at(-1)?.second ?? null,
      lastActionSecond: data.events.filter(event => event.type !== 'clock').at(-1)?.second ?? null},
    stats: data.snapshot.stats, cues, timedCues: cues.filter(cue => cue.video !== null).length,
    matchNotes: review.notes || '',
  };
}

const html = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
const jsonScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function broadcastVtt(report) {
  const cues = report.cues.filter(cue => cue.video !== null).slice().sort((a, b) =>
    a.videoStart - b.videoStart || a.videoEnd - b.videoEnd || a.id.localeCompare(b.id));
  if (!cues.length) throw fail('Set video in and out points for at least one caption');
  return 'WEBVTT\n\n' + cues.map(cue => cue.id + '\n' +
    videoClock(cue.videoStart) + ' --> ' + videoClock(cue.videoEnd) + '\n' +
    cue.caption.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim()).map(line => line.replace(/[&<>]/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'})[char])).join('\n') + '\n').join('\n');
}

export function broadcastHtml(report, matchPackage) {
  const spanish = report.broadcast.view.locale === 'es';
  const W = spanish ? {
    heading:'Guion de emisión', source:'Partido sintético', events:'Jugadas originales',
    match:'Reloj del partido', video:'Tiempo del vídeo', untimed:'Sin programar',
    notes:'Notas de producción', evidence:'Jugadas de esta selección', download:'Descargar partido editable',
    captions:'Descargar subtítulos temporizados', replay:'Revisar el partido original',
    play:'Reproducir jugadas', pause:'Pausa', prev:'Anterior', next:'Siguiente',
    ready:'Elige una jugada para revisarla.', at:'Jugada', of:'de', team:'Equipo',
    player:'Jugador', action:'Acción', zone:'Tercio', method:'El porcentaje usa recuperaciones / intentos resueltos.',
    observed:'Jugadas observadas', last:'Última acción observada', stats:'Resumen del equipo',
    attempts:'Intentos de presión', success:'Recuperaciones', resolved:'Intentos resueltos', rate:'Porcentaje de recuperación',
    import:'Importa el archivo descargado en Counterpress para editarlo y abrir el reproductor completo.',
    timing:'Los tiempos del vídeo son decisiones editoriales y se conservan separados del reloj del partido.',
  } : {
    heading:'Broadcast handover', source:'Synthetic match', events:'Original events',
    match:'Match clock', video:'Video time', untimed:'Unscheduled',
    notes:'Production notes', evidence:'Events behind this selection', download:'Download editable match',
    captions:'Download timed captions', replay:'Review the original match',
    play:'Play events', pause:'Pause', prev:'Previous', next:'Next',
    ready:'Choose an event to review.', at:'Event', of:'of', team:'Team',
    player:'Player', action:'Action', zone:'Third', method:'The rate uses successful regains / resolved attempts.',
    observed:'Observed events', last:'Last observed action', stats:'Team summary',
    attempts:'Press attempts', success:'Successful regains', resolved:'Resolved attempts', rate:'Regain rate',
    import:'Import the downloaded file in Counterpress to edit it and open the complete match player.',
    timing:'Video times are editorial selections and stay separate from the match clock.',
  };
  const displayTime = second => second === null ? '—' : matchClock(second);
  const rows = events => events.map(event => '<tr><td>' + html(matchClock(event.second)) +
    '</td><td>' + html(event.id) + '</td><td>' + html(event.team) + '</td><td>' + html(event.player) + '</td><td>' +
    html(ACTIONS[report.broadcast.view.locale][event.type]) + '</td><td>' +
    html(ZONES[report.broadcast.view.locale][event.zone]) + '</td></tr>').join('');
  const cues = report.cues.map((cue, i) =>
    '<article><h2>' + String(i + 1).padStart(2, '0') + ' · ' + html(cue.caption) + '</h2>' +
    '<p>' + html(cue.team) + ' · ' + html(W.match) + ' ' + html(cue.matchClock) + ' · ' + html(W.video) + ' ' +
    html(cue.video ? cue.video.in + ' – ' + cue.video.out : W.untimed) + '</p>' +
    '<button class="jump" type="button" data-count="' + cue.count + '">' + html(W.at) + ' ' + cue.count + '</button>' +
    '<details><summary>' + html(W.evidence) + '</summary><div class="table"><table><thead><tr><th>' +
    html(W.match) + '</th><th>ID</th><th>' + html(W.team) + '</th><th>' + html(W.player) + '</th><th>' + html(W.action) +
    '</th><th>' + html(W.zone) + '</th></tr></thead><tbody>' + rows(cue.evidence) +
    (cue.watermark ? rows([cue.watermark]) : '') + '</tbody></table></div></details></article>').join('');
  const payload = {package: matchPackage, report, words: W, actions: ACTIONS[report.broadcast.view.locale],
    vtt: report.timedCues ? broadcastVtt(report) : null};
  return '<!doctype html>\n<html lang="' + report.broadcast.view.locale + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + html(report.broadcast.title) +
    '</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#202020;background:#f4f4f4;margin:0}main{max-width:980px;padding:28px;margin:auto}header,section,article{background:#fff;border:1px solid #ccc;padding:22px;margin-bottom:18px}h1{font-size:30px;line-height:1.2}h2{font-size:20px}p{white-space:pre-wrap;overflow-wrap:anywhere}button,input{font:inherit}button{background:#eee;border:1px solid #777;border-radius:3px;padding:8px 12px;cursor:pointer;margin:4px}button:focus-visible,input:focus-visible{outline:3px solid #111;outline-offset:3px}table{border-collapse:collapse;width:100%;text-align:left;font-size:14px}th,td{padding:8px;border-bottom:1px solid #ddd;vertical-align:top}.table{overflow:auto}input[type=range]{width:100%;min-width:0}.toolbar{display:flex;flex-wrap:wrap;gap:6px}.metric{font-variant-numeric:tabular-nums}#eventCaption{min-height:2em;font-size:20px}details{margin-top:14px}summary{cursor:pointer}@media(max-width:560px){main{padding:12px}header,section,article{padding:16px}h1{font-size:25px}}@media print{button,input,#replay{display:none}body{background:#fff}main{max-width:none;padding:0}header,section,article{break-inside:avoid}}</style></head><body><main><header><p>COUNTERPRESS / COMPASS · ' +
    html(W.heading) + '</p><h1>' + html(report.broadcast.title) + '</h1><p>' + html(report.source.title) +
    ' · ' + html(W.source) + ' · ' + html(report.broadcast.view.team) + '</p><p>' +
    html(W.observed) + ': ' + report.source.count + ' / ' + report.source.total + ' · ' + html(W.match) +
    ': ' + displayTime(report.source.observedThroughSecond) + ' · ' + html(W.last) + ': ' +
    displayTime(report.source.lastActionSecond) + '</p><div class="toolbar"><button id="download" type="button">' +
    html(W.download) + '</button><button id="vtt" type="button"' + (report.timedCues ? '' : ' disabled') + '>' +
    html(W.captions) + '</button></div><p>' + html(W.import) + '</p></header><section><h2>' + html(W.stats) +
    '</h2><div class="table"><table><thead><tr><th>' + html(W.attempts) + '</th><th>' + html(W.success) +
    '</th><th>' + html(W.resolved) + '</th><th>' + html(W.rate) + '</th></tr></thead><tbody><tr><td>' +
    report.stats.counterpressAttempts + '</td><td>' + report.stats.successes + '</td><td>' +
    report.stats.resolvedCounterpressAttempts + '</td><td>' +
    (report.stats.successRatePct === null ? '—' : report.stats.successRatePct + '%') +
    '</td></tr></tbody></table></div><p>' + html(W.method) + '</p></section><section id="replay"><h2>' + html(W.replay) +
    '</h2><div class="toolbar"><button id="prev" type="button">' + html(W.prev) + '</button><button id="play" type="button">' +
    html(W.play) + '</button><button id="next" type="button">' + html(W.next) + '</button></div><input id="cursor" type="range" min="0" max="' +
    matchPackage.match.events.length + '" value="0" aria-label="' + html(W.at) + '"><p id="eventPosition" class="metric"></p>' +
    '<p id="eventCaption"></p></section>' +
    (report.broadcast.notes ? '<section><h2>' + html(W.notes) + '</h2><p>' + html(report.broadcast.notes) + '</p></section>' : '') +
    cues + '<footer><p>' + html(W.timing) + '</p><p>Counterpress Compass · ' +
    html(report.generatedAt.slice(0, 10)) + '</p></footer></main><script id="handover" type="application/json">' +
    jsonScript(payload) + '</script><script>' +
    "const data=JSON.parse(document.getElementById('handover').textContent),events=data.package.match.events,W=data.words;" +
    "const el=id=>document.getElementById(id);let at=0,timer=null;" +
    "function clock(s){const t=Math.round(s*10);return String(Math.floor(t/600)).padStart(2,'0')+':'+String(Math.floor(t/10)%60).padStart(2,'0')+'.'+t%10;}" +
    "function stop(){clearTimeout(timer);timer=null;el('play').textContent=W.play;}" +
    "function show(n){at=Math.min(events.length,Math.max(0,n));el('cursor').value=at;const e=events[at-1];el('prev').disabled=!at;el('next').disabled=at===events.length;el('eventPosition').textContent=W.at+' '+at+' '+W.of+' '+events.length+(e?' · '+clock(e.second)+' · '+e.id:'');const cues=data.report.cues.filter(c=>c.count===at);el('eventCaption').textContent=cues.length?cues.map(c=>c.caption).join('\\n'):e?e.team+' · '+e.player+' · '+data.actions[e.type]:W.ready;}" +
    "function advance(){if(at>=events.length){stop();return;}show(at+1);const gap=at<events.length?events[at].second-events[at-1].second:0;timer=setTimeout(advance,Math.round(Math.min(1800,240+Math.max(0,gap)*30)/4));}" +
    "el('play').onclick=()=>{if(timer){stop();return;}if(at===events.length)show(0);el('play').textContent=W.pause;advance();};" +
    "el('prev').onclick=()=>{stop();show(at-1);};el('next').onclick=()=>{stop();show(at+1);};el('cursor').oninput=()=>{stop();show(Number(el('cursor').value));};" +
    "for(const button of document.querySelectorAll('.jump'))button.onclick=()=>{stop();show(Number(button.dataset.count));el('replay').scrollIntoView({block:'start'});};" +
    "function download(body,type,name){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}" +
    "el('download').onclick=()=>download(JSON.stringify(data.package,null,2)+'\\n','application/json','counterpress-broadcast-match.json');" +
    "el('vtt').onclick=()=>download(data.vtt,'text/vtt','counterpress-broadcast.vtt');addEventListener('pagehide',stop);show(0);" +
    '</script></body></html>\n';
}
