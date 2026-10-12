// Inspect the original saved explanation and match prefix. No model calls or new store.
import {ArchiveLink} from './archive.js';
import {makeSnapshot, validateFixture} from './engine.mjs';

const ARCHIVE_ID = /^[0-9a-f]{16}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSIGHT_ID = /^insight-[0-9a-f]{64}$/;
const MAX_BYTES = 512 * 1024;
const el = id => document.getElementById(id);
const make = (tag, text, className = '') => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
const WORDS = {
  en: {
    skip:'Skip to saved explanation', synthetic:'SYNTHETIC MATCH · invented teams and events',
    back:'Back to player', compare:'Compare saved matches', eyebrow:'MATCH REVIEW', heading:'Why this explanation?',
    savedOnly:'Saved answer and original plays', intro:'Open an explanation retained with a match. Follow its source plays and see which tools the workflow actually used.',
    matchAddress:'Saved match or explanation link', addressHint:'Paste a saved match link', open:'Open saved match', chooseExisting:'Choose another saved explanation',
    collection:'Or choose from this browser', chooseMatch:'Choose a saved match', retry:'Read saved match again',
    emptyHeading:'No explanation is saved in this match', emptyHelp:'Open the player to review this match. An explanation appears here after its original result has been saved with the match.',
    chooseAnswer:'Saved explanation', openPosition:'Open this match position', copy:'Copy explanation link',
    downloadMatch:'Download complete saved match', sequence:'The recorded sequence', openLoss:'Open at the loss',
    sequenceHelp:'These are the source plays in the detected counterpress. Each link opens the original player at that event.',
    workflow:'How the answer was produced', available:'Tools available to this workflow',
    availableHelp:'Availability and execution are shown separately. A tool is marked as used only when its call is present in the saved trace.',
    context:'Match context behind the answer', contextHelp:'Rebuilt from the saved event prefix at the answer’s recorded position. Later plays are not included.',
    moreContext:'Show the recorded statistics and recent plays', statistics:'Focus-club statistics', recent:'Recent recorded plays',
    time:'Time', play:'Play', player:'Player', club:'Club', precision:'Locations are pitch thirds. The event source contains no player coordinates or goal record.',
    details:'Source and workflow details', detailsHelp:'The archive retains the exact answer, source identity and call trace. Complete provider response files remain with the original workflow.',
    turns:'Recorded provider turns', turn:'Turn', decision:'Decision', receipt:'Receipt', identities:'Original identifiers',
    recordJson:'Saved explanation JSON', downloadAnswer:'Download saved explanation JSON', footer:'Counterpress Compass · Saved match analysis and replay.',
    loading:'Reading the original saved match…', ready:'Saved explanation opened. Replay and inspection use the retained match.',
    landing:'Paste a saved match link or choose a match from this browser.', badLink:'Use a saved match or explanation link from this app.',
    badArchive:'The selected response is not a complete Counterpress saved match.', tooLarge:'The saved match exceeds the supported 512KB limit.',
    missing:'That explanation is no longer in this saved review. Select another retained explanation or reopen its original match package.',
    readFailed:'The saved match could not be read. Its source and saved answer have not been changed.',
    unavailable:'Saved match unavailable', scopeMismatch:'The explanation does not match this original event prefix.',
    copyDone:'Explanation link copied.', copyFallback:'Select and copy the explanation link in the address field above.',
    toolAnswer:'SAVED TOOL-ASSISTED EXPLANATION', plainAnswer:'SAVED MATCH EXPLANATION', final:'Returned the saved explanation',
    finalHelp:'The answer above is the text retained from this run.', finalStatus:'Saved answer',
    executed:'Tool executed', viewContext:'View the recorded context', viewAnswer:'Read the saved answer',
    matchTool:'Read the match state', momentTool:'Read the latest counterpress moment', unknownTool:'Recorded tool call',
    matchToolHelp:'The workflow looked up the recorded match state: event count, match clock, club statistics and recent plays.',
    momentToolHelp:'The workflow looked up the latest detected sequence, its outcome, timing and source plays.',
    matchAvailable:'Recorded match clock, focus-club statistics and up to 30 recent events.',
    momentAvailable:'The latest detected counterpress, its evidence, outcome and recorded timing.',
    notUsed:'Not used in this answer', noTurns:'No provider-turn trace is retained in this record.',
    pressures:'Pressure actions', recovery:'Time to regain', window:'Counterpress window', observed:'Observed duration',
    focus:'Focus club', prefix:'Recorded position', audience:'Audience', language:'Answer language', casual:'Casual fan', analyst:'Analyst',
    english:'English', spanish:'Spanish', notAvailable:'Not available', sourceEvent:'Source event', sourceMoment:'Sequence starts at',
    lossWindows:'Recorded loss windows', counterpressAttempts:'Counterpress attempts', successes:'Successful regains',
    resolvedCounterpressAttempts:'Resolved attempts', interruptedAttempts:'Interrupted attempts', successRatePct:'Regains / resolved attempts',
    meanRecoverySeconds:'Mean recovery time', sourceHash:'Event-prefix SHA-256', recordId:'Saved explanation ID',
    archiveId:'Saved match ID', scenario:'Match situation', seed:'Seed', capturedAt:'Captured at', provider:'Provider',
    model:'Model', sdk:'Agent Framework version', promptVersion:'Prompt edition', workflowId:'Workflow ID',
    operation:'Original bridge operation', originalSessionId:'Original match session', count:'Recorded event count',
    frameSecond:'Original event time (seconds)', requestId:'Request', jobId:'Job', promptHash:'Prompt SHA-256',
    openPlay:'Open this play', event:'Event', recentPrefix:'These recent plays are taken only from the answer’s recorded prefix.',
    type:{loss:'Lost possession',pressure:'Applied pressure',regain:'Regained possession',pass:'Pass',shot:'Shot',clock:'Clock marker'},
    zone:{defensive:'defensive third',middle:'middle third',attacking:'attacking third'},
    seconds:n=>String(n)+' s',
    at:(n,total,time)=>'Event '+n+' / '+total+' · '+time,
    sourceScope:(s,total)=>'Based on '+s.count+' of '+total+' saved events · '+s.team+' · '+(s.audience==='analyst'?'Analyst':'Casual fan'),
    calls:(calls,turns)=>calls+' executed tool call'+(calls===1?'':'s')+' · '+turns+' recorded provider turn'+(turns===1?'':'s'),
    used:n=>'Used '+n+' time'+(n===1?'':'s')+' in this answer',
    success:(team,n,seconds,window)=>team+' lost the ball, applied pressure '+n+' time'+(n===1?'':'s')+' and regained it after '+seconds+' seconds, within the '+window+'-second window.',
    expired:(team,n,window)=>team+' applied pressure '+n+' time'+(n===1?'':'s')+' after losing the ball. The recorded event clock passed the '+window+'-second window without a regain.',
    interrupted:(team,n,seconds)=>team+' applied pressure '+n+' time'+(n===1?'':'s')+'. This observation ended after '+seconds+' seconds; the sequence outcome is unknown.',
    recentCount:(n,total)=>'Last '+n+' of '+total+' recorded events',
    evidenceCount:n=>n+' source play'+(n===1?'':'s'),
  },
  es: {
    skip:'Ir a la explicación guardada', synthetic:'PARTIDO SINTÉTICO · equipos y jugadas inventados',
    back:'Volver al reproductor', compare:'Comparar partidos guardados', eyebrow:'ANÁLISIS DEL PARTIDO', heading:'¿Por qué esta explicación?',
    savedOnly:'Respuesta guardada y jugadas originales', intro:'Abre una explicación conservada con un partido. Sigue sus jugadas de origen y consulta qué herramientas utilizó el flujo.',
    matchAddress:'Enlace al partido o a la explicación guardada', addressHint:'Pega un enlace a un partido guardado', open:'Abrir partido guardado', chooseExisting:'Elegir otra explicación guardada',
    collection:'O elige un partido de este navegador', chooseMatch:'Elegir un partido guardado', retry:'Volver a leer el partido',
    emptyHeading:'Este partido no contiene una explicación guardada', emptyHelp:'Abre el reproductor para revisar el partido. La explicación aparece aquí cuando su resultado original se guarda con el partido.',
    chooseAnswer:'Explicación guardada', openPosition:'Abrir esta posición del partido', copy:'Copiar enlace a la explicación',
    downloadMatch:'Descargar el partido guardado completo', sequence:'La secuencia registrada', openLoss:'Abrir en la pérdida',
    sequenceHelp:'Estas son las jugadas de origen de la contrapresión detectada. Cada enlace abre el reproductor original en esa jugada.',
    workflow:'Cómo se produjo la respuesta', available:'Herramientas disponibles para este flujo',
    availableHelp:'La disponibilidad y la ejecución se muestran por separado. Una herramienta figura como utilizada solo si su llamada está en el registro guardado.',
    context:'Contexto del partido detrás de la respuesta', contextHelp:'Reconstruido a partir de las jugadas guardadas hasta la posición registrada de la respuesta. No incluye jugadas posteriores.',
    moreContext:'Mostrar las estadísticas y las jugadas recientes', statistics:'Estadísticas del club seleccionado', recent:'Jugadas recientes registradas',
    time:'Tiempo', play:'Jugada', player:'Jugador', club:'Club', precision:'Las ubicaciones son tercios del campo. La fuente no contiene coordenadas de jugadores ni un registro de goles.',
    details:'Detalles del origen y del flujo', detailsHelp:'El archivo conserva la respuesta exacta, la identidad del origen y el registro de llamadas. Los archivos completos del proveedor permanecen con el flujo original.',
    turns:'Turnos del proveedor registrados', turn:'Turno', decision:'Decisión', receipt:'Recepción', identities:'Identificadores originales',
    recordJson:'JSON de la explicación guardada', downloadAnswer:'Descargar JSON de la explicación', footer:'Counterpress Compass · Análisis y reproducción de partidos guardados.',
    loading:'Leyendo el partido guardado original…', ready:'Explicación guardada abierta. La reproducción y la consulta utilizan el partido conservado.',
    landing:'Pega un enlace o elige un partido guardado en este navegador.', badLink:'Utiliza un enlace al partido o a la explicación guardada de esta aplicación.',
    badArchive:'La respuesta seleccionada no es un partido guardado completo de Counterpress.', tooLarge:'El partido guardado supera el límite de 512KB.',
    missing:'Esta explicación ya no está en el análisis guardado. Elige otra explicación o vuelve a abrir su paquete original.',
    readFailed:'No se pudo leer el partido. Su origen y la respuesta guardada no se han modificado.',
    unavailable:'Partido guardado no disponible', scopeMismatch:'La explicación no corresponde a este prefijo de jugadas original.',
    copyDone:'Enlace a la explicación copiado.', copyFallback:'Selecciona y copia el enlace en el campo de dirección de arriba.',
    toolAnswer:'EXPLICACIÓN GUARDADA CON HERRAMIENTAS', plainAnswer:'EXPLICACIÓN GUARDADA DEL PARTIDO', final:'Devolvió la explicación guardada',
    finalHelp:'La respuesta de arriba es el texto conservado de esta ejecución.', finalStatus:'Respuesta guardada',
    executed:'Herramienta ejecutada', viewContext:'Ver el contexto registrado', viewAnswer:'Leer la respuesta guardada',
    matchTool:'Consultar el estado del partido', momentTool:'Consultar la última contrapresión', unknownTool:'Llamada a herramienta registrada',
    matchToolHelp:'El flujo consultó el estado registrado: número de jugadas, reloj del partido, estadísticas del club y jugadas recientes.',
    momentToolHelp:'El flujo consultó la última secuencia detectada, su resultado, sus tiempos y las jugadas de origen.',
    matchAvailable:'Reloj registrado, estadísticas del club seleccionado y hasta 30 jugadas recientes.',
    momentAvailable:'La última contrapresión detectada, sus jugadas, resultado y tiempos registrados.',
    notUsed:'No se utilizó en esta respuesta', noTurns:'Este registro no conserva un historial de turnos del proveedor.',
    pressures:'Acciones de presión', recovery:'Tiempo de recuperación', window:'Ventana de contrapresión', observed:'Duración observada',
    focus:'Club seleccionado', prefix:'Posición registrada', audience:'Audiencia', language:'Idioma de la respuesta', casual:'Aficionado', analyst:'Analista',
    english:'Inglés', spanish:'Español', notAvailable:'No disponible', sourceEvent:'Jugada de origen', sourceMoment:'La secuencia comienza en',
    lossWindows:'Ventanas de pérdida registradas', counterpressAttempts:'Intentos de contrapresión', successes:'Recuperaciones exitosas',
    resolvedCounterpressAttempts:'Intentos resueltos', interruptedAttempts:'Intentos interrumpidos', successRatePct:'Recuperaciones / intentos resueltos',
    meanRecoverySeconds:'Tiempo medio de recuperación', sourceHash:'SHA-256 del prefijo de jugadas', recordId:'ID de la explicación guardada',
    archiveId:'ID del partido guardado', scenario:'Situación del partido', seed:'Semilla', capturedAt:'Fecha de captura', provider:'Proveedor',
    model:'Modelo', sdk:'Versión de Agent Framework', promptVersion:'Edición del prompt', workflowId:'ID del flujo',
    operation:'Operación original del puente', originalSessionId:'Sesión original del partido', count:'Número de jugadas registradas',
    frameSecond:'Tiempo de origen (segundos)', requestId:'Solicitud', jobId:'Trabajo', promptHash:'SHA-256 del prompt',
    openPlay:'Abrir esta jugada', event:'Jugada', recentPrefix:'Estas jugadas recientes proceden únicamente del prefijo registrado para la respuesta.',
    type:{loss:'Pérdida de posesión',pressure:'Acción de presión',regain:'Recuperación de posesión',pass:'Pase',shot:'Disparo',clock:'Marca de reloj'},
    zone:{defensive:'tercio defensivo',middle:'tercio medio',attacking:'tercio de ataque'},
    seconds:n=>String(n)+' s',
    at:(n,total,time)=>'Jugada '+n+' / '+total+' · '+time,
    sourceScope:(s,total)=>'Basada en '+s.count+' de '+total+' jugadas guardadas · '+s.team+' · '+(s.audience==='analyst'?'Analista':'Aficionado'),
    calls:(calls,turns)=>calls+' llamada'+(calls===1?'':'s')+' ejecutada'+(calls===1?'':'s')+' · '+turns+' turno'+(turns===1?'':'s')+' del proveedor',
    used:n=>'Se utilizó '+n+(n===1?' vez':' veces')+' en esta respuesta',
    success:(team,n,seconds,window)=>team+' perdió el balón, realizó '+n+' acciones de presión y lo recuperó a los '+seconds+' segundos, dentro de la ventana de '+window+' segundos.',
    expired:(team,n,window)=>team+' realizó '+n+' acciones de presión tras perder el balón. El reloj registrado superó la ventana de '+window+' segundos sin recuperación.',
    interrupted:(team,n,seconds)=>team+' realizó '+n+' acciones de presión. La observación terminó a los '+seconds+' segundos; se desconoce el resultado de la secuencia.',
    recentCount:(n,total)=>'Últimas '+n+' de '+total+' jugadas registradas',
    evidenceCount:n=>n+' jugada'+(n===1?'':'s')+' de origen',
  },
};
let locale = 'en', archive = null, selectedId = null, exportText = '', selectedArchiveId = null;
let generation = 0, controller = null, lastSelection = null;
const words = () => WORDS[locale] || WORDS.en;
const time = value => {
  const tenths = Math.round(value * 10), minutes = Math.floor(tenths / 600), seconds = Math.floor(tenths % 600 / 10);
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + (tenths % 10 ? '.' + tenths % 10 : '');
};
function translate(nextLocale) {
  locale = WORDS[nextLocale] ? nextLocale : 'en';
  document.documentElement.lang = locale;
  document.title = words().heading + ' · Counterpress Compass';
  for (const node of document.querySelectorAll('[data-insight-i18n]')) {
    const value = words()[node.dataset.insightI18n];
    if (typeof value === 'string') node.textContent = value;
  }
  el('matchAddress').placeholder = words().addressHint;
  const option = el('libraryMatches').options[0]; if (option?.value === '') option.textContent = words().chooseMatch;
}
function status(message, error = false) {
  el('inspectionStatus').textContent = message;
  el('inspectionStatus').classList.toggle('error', error);
}
function readSelection(hash) {
  const query = new URLSearchParams(hash.replace(/^#/, ''));
  if (!query.size) return null;
  if (query.getAll('archive').length !== 1 || !ARCHIVE_ID.test(query.get('archive') || '') ||
      query.getAll('insight').length > 1 || (query.has('insight') && !INSIGHT_ID.test(query.get('insight') || '')) ||
      [...query.keys()].some(key => !['archive', 'insight'].includes(key))) throw new Error(words().badLink);
  return {archiveId:query.get('archive'), insightId:query.get('insight') || null};
}
function explanationUrl(archiveId, insightId) {
  const url = new URL('/insight-review', location.origin);
  url.hash = new URLSearchParams({archive:archiveId, ...(insightId ? {insight:insightId} : {})}).toString();
  return url.href;
}
function selectionFromAddress(value) {
  const text = value.trim();
  if (ARCHIVE_ID.test(text)) return {archiveId:text, insightId:null};
  let url; try { url = new URL(text, location.origin); } catch { throw new Error(words().badLink); }
  if (url.origin !== location.origin || url.username || url.password || url.search) throw new Error(words().badLink);
  if (url.pathname === '/insight-review') {
    const selected = readSelection(url.hash);
    if (selected) return selected;
  }
  if (url.pathname === '/') {
    const selected = ArchiveLink.read(url.hash);
    if (selected) return {archiveId:selected.id, insightId:null};
  }
  throw new Error(words().badLink);
}
const recordView = record => ({team:record.source.team, audience:record.source.audience, locale:record.source.locale});
function replayUrl(count, view) {
  return ArchiveLink.url(selectedArchiveId, count, view, new URL('/', location.origin).href);
}
function setHash(selection) {
  history.replaceState(null, '', explanationUrl(selection.archiveId, selection.insightId));
  el('matchAddress').value = location.href;
}
async function readExport(id, signal) {
  const response = await fetch('/api/archives/' + encodeURIComponent(id) + '/export',
    {credentials:'same-origin', cache:'no-store', redirect:'error', signal});
  if (!response.ok) throw new Error(words().unavailable + ' (' + response.status + ').');
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES) {
    await response.body?.cancel(); throw new Error(words().tooLarge);
  }
  const reader = response.body?.getReader();
  let raw;
  if (reader) {
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_BYTES) { await reader.cancel(); throw new Error(words().tooLarge); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    raw = new Uint8Array(length); let offset = 0;
    for (const part of chunks) { raw.set(part, offset); offset += part.byteLength; }
  } else {
    raw = new Uint8Array(await response.arrayBuffer());
    if (raw.byteLength > MAX_BYTES) throw new Error(words().tooLarge);
  }
  const text = new TextDecoder('utf-8', {fatal:true}).decode(raw);
  const data = JSON.parse(text);
  if (!data || data.format !== 'counterpress.match.v1' || data.match?.data !== 'synthetic' ||
      typeof data.match.scenario !== 'string' || !Number.isInteger(data.match.seed) ||
      !data.review || !Array.isArray(data.review.insights) || data.review.insights.length > 24)
    throw new Error(words().badArchive);
  validateFixture(data.match.events);
  for (const record of data.review.insights) {
    if (!record || record.format !== 'counterpress.retained-insight.v1' || !INSIGHT_ID.test(record.id || '') ||
        !record.source || !record.response || typeof record.response.caption !== 'string' || typeof record.response.text !== 'string')
      throw new Error(words().badArchive);
  }
  return {data, text};
}
function contextFor(record) {
  const source = record.source, match = archive.match;
  if (source.scenario !== match.scenario || source.seed !== match.seed || !Number.isInteger(source.count) ||
      source.count < 1 || source.count > match.events.length) throw new Error(words().scopeMismatch);
  const prefix = match.events.slice(0, source.count);
  const snapshot = makeSnapshot(prefix, recordView(record));
  const moment = snapshot.overlays.at(-1);
  if (prefix.at(-1)?.id !== source.eventId || snapshot.elapsedSeconds !== source.frameSecond || moment?.id !== source.momentId)
    throw new Error(words().scopeMismatch);
  const indexed = new Map(prefix.map((event, index) => [event.id, {event, count:index + 1}]));
  const evidence = moment.evidenceIds.map(id => indexed.get(id));
  if (evidence.some(item => !item)) throw new Error(words().scopeMismatch);
  return {prefix, snapshot, moment, evidence};
}
function entry(list, label, value, wrapper = true) {
  const target = wrapper ? make('div') : list;
  target.append(make('dt', label), make('dd', value === null || value === undefined ? words().notAvailable : value));
  if (wrapper) list.append(target);
}
function sourcePlays(record, context) {
  const W = words(), {moment, evidence} = context, metrics = moment.metrics;
  el('sequenceSummary').textContent = moment.status === 'success'
    ? W.success(moment.team, metrics.pressureCount, metrics.secondsToRecover, metrics.windowSeconds)
    : moment.status === 'expired' ? W.expired(moment.team, metrics.pressureCount, metrics.windowSeconds)
    : W.interrupted(moment.team, metrics.pressureCount, metrics.observedSeconds);
  el('sequenceMetrics').replaceChildren();
  entry(el('sequenceMetrics'), W.pressures, metrics.pressureCount);
  entry(el('sequenceMetrics'), moment.status === 'success' ? W.recovery : W.observed,
    W.seconds(moment.status === 'success' ? metrics.secondsToRecover : metrics.observedSeconds));
  entry(el('sequenceMetrics'), W.window, W.seconds(metrics.windowSeconds));
  const view = recordView(record);
  el('sequenceReplay').href = replayUrl(evidence[0].count, view);
  el('sourcePlays').replaceChildren(...evidence.map(({event, count}) => {
    const row = make('li'); row.dataset.eventId = event.id; row.dataset.eventCount = String(count);
    const clock = make('time', time(event.second)); clock.dateTime = 'PT' + event.second + 'S';
    const body = make('div', undefined, 'insight-play-body');
    body.append(make('p', event.player + ' · ' + (W.type[event.type] || event.type)));
    body.append(make('p', event.team + ' · ' + (W.zone[event.zone] || event.zone), 'note'));
    const link = make('a', W.openPlay + ' · ' + event.id);
    link.href = replayUrl(count, view);
    link.setAttribute('aria-label', W.openPlay + ': ' + event.id + ', ' + time(event.second) + ', ' + event.player);
    body.append(link); row.append(clock, body); return row;
  }));
}
function toolDescription(name) {
  const W = words();
  return name === 'get_match_state' ? {title:W.matchTool, help:W.matchToolHelp, available:W.matchAvailable}
    : name === 'get_latest_moment' ? {title:W.momentTool, help:W.momentToolHelp, available:W.momentAvailable}
    : {title:W.unknownTool, help:name, available:''};
}
function workflow(record) {
  const W = words(), response = record.response;
  const calls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
  const turns = Array.isArray(response.providerTurns) ? response.providerTurns : [];
  el('workflowCount').textContent = W.calls(calls.length, turns.length);
  const rows = calls.map(call => {
    const info = toolDescription(call.name), row = make('li', undefined, 'insight-step');
    row.dataset.tool = call.name;
    row.append(make('div', W.executed, 'insight-step-status'), make('h3', info.title), make('p', info.help));
    const contextLink = make('a', W.viewContext); contextLink.href = '#contextHeading';
    contextLink.addEventListener('click', event => {
      event.preventDefault(); el('contextDetails').open = true;
      el('contextHeading').tabIndex = -1; el('contextHeading').focus({preventScroll:true});
      el('contextHeading').scrollIntoView({block:'start'});
    });
    row.append(contextLink); return row;
  });
  const final = make('li', undefined, 'insight-step');
  final.dataset.step = 'saved-answer';
  final.append(make('div', W.finalStatus, 'insight-step-status'), make('h3', W.final), make('p', W.finalHelp));
  const answerLink = make('a', W.viewAnswer); answerLink.href = '#savedAnswer';
  answerLink.addEventListener('click', event => { event.preventDefault(); el('savedAnswer').focus(); el('savedAnswer').scrollIntoView({block:'start'}); });
  final.append(answerLink); rows.push(final);
  el('executedActions').replaceChildren(...rows);
  el('availableTools').hidden = response.promptVersion !== 'cp-agent-insight-v1';
  el('toolCapabilities').replaceChildren(...['get_match_state', 'get_latest_moment'].map(name => {
    const info = toolDescription(name), count = calls.filter(call => call.name === name).length;
    const box = make('div', undefined, 'insight-capability');
    box.dataset.tool = name; box.dataset.executions = String(count);
    box.append(make('h4', info.title), make('p', count ? W.used(count) : W.notUsed),
      make('p', info.available), make('code', name));
    return box;
  }));
}
function renderContext(record, context) {
  const W = words(), source = record.source, {prefix, snapshot} = context;
  el('contextSummary').replaceChildren();
  entry(el('contextSummary'), W.focus, source.team);
  entry(el('contextSummary'), W.prefix, W.at(source.count, archive.match.events.length, time(source.frameSecond)));
  entry(el('contextSummary'), W.audience, source.audience === 'analyst' ? W.analyst : W.casual);
  entry(el('contextSummary'), W.language, source.locale === 'es' ? W.spanish : W.english);
  el('contextStats').replaceChildren();
  for (const key of ['lossWindows','counterpressAttempts','successes','resolvedCounterpressAttempts','interruptedAttempts','successRatePct','meanRecoverySeconds']) {
    let value = snapshot.stats[key];
    if (value !== null && value !== undefined) {
      if (key === 'successRatePct') value += '%';
      else if (key === 'meanRecoverySeconds') value = W.seconds(value);
    }
    entry(el('contextStats'), W[key], value);
  }
  const recent = prefix.slice(-30);
  el('recentScope').textContent = W.recentCount(recent.length, prefix.length) + '. ' + W.recentPrefix;
  el('recentPlays').replaceChildren(...recent.map(event => {
    const row = make('tr'); row.dataset.eventId = event.id;
    const clock = make('td'), link = make('a', time(event.second));
    link.href = replayUrl(prefix.findIndex(item => item.id === event.id) + 1, recordView(record));
    link.setAttribute('aria-label', W.openPlay + ' ' + event.id + ' · ' + time(event.second));
    clock.append(link); row.append(clock, make('td', W.type[event.type] || event.type), make('td', event.player), make('td', event.team));
    return row;
  }));
}
function renderDetails(record) {
  const W = words(), source = record.source, response = record.response, list = el('sourceIdentity');
  list.replaceChildren();
  for (const [label, value] of [
    [W.archiveId,selectedArchiveId],[W.recordId,record.id],[W.scenario,source.scenario],[W.seed,source.seed],
    [W.count,source.count],[W.frameSecond,source.frameSecond],[W.sourceEvent,source.eventId],[W.sourceMoment,source.momentId],
    [W.sourceHash,source.prefixSha256],[W.capturedAt,record.capturedAt],[W.provider,response.provider],[W.model,response.model],
    [W.sdk,response.sdk],[W.promptVersion,response.promptVersion],[W.workflowId,response.workflowId],
    [W.operation,response.operation],[W.originalSessionId,response.originalSessionId],
  ]) if (value !== undefined) entry(list, label, value, false);
  const turns = Array.isArray(response.providerTurns) ? response.providerTurns : [];
  el('providerTurns').replaceChildren(...(turns.length ? turns.map(turn => {
    const row = make('tr'), ids = make('td');
    for (const [label, value] of [[W.jobId,turn.jobId],[W.requestId,turn.requestId],[W.promptHash,turn.promptSha256]]) {
      if (value !== undefined) { const p = make('p', label + ': '); p.append(make('code', value)); ids.append(p); }
    }
    row.append(make('td', turn.turn), make('td', turn.decision), make('td', turn.receiptState), ids); return row;
  }) : [(() => { const row = make('tr'), cell = make('td', W.noTurns); cell.colSpan = 4; row.append(cell); return row; })()]));
  el('recordJson').textContent = JSON.stringify(record, null, 2);
}
function showRecord(id, {keepStatus = false} = {}) {
  const record = archive.review.insights.find(item => item.id === id);
  if (!record) throw new Error(words().missing);
  translate(record.source.locale);
  const context = contextFor(record);
  selectedId = record.id;
  const selection = {archiveId:selectedArchiveId, insightId:selectedId};
  lastSelection = selection; setHash(selection);
  el('insightSelect').value = selectedId;
  el('savedMatchTitle').textContent = archive.review.title || archive.match.scenario;
  el('savedMatchScope').textContent = archive.match.scenario + ' · ' + words().seed + ' ' + archive.match.seed;
  el('answerKind').textContent = record.response.toolCalls?.length ? words().toolAnswer : words().plainAnswer;
  el('answerCaption').textContent = record.response.caption;
  el('answerText').textContent = record.response.text;
  el('answerScope').textContent = words().sourceScope(record.source, archive.match.events.length) + ' · ' + time(record.source.frameSecond);
  el('answerReplay').href = replayUrl(record.source.count, recordView(record));
  el('backToPlayer').href = el('answerReplay').href;
  sourcePlays(record, context); workflow(record); renderContext(record, context); renderDetails(record);
  el('noInsights').hidden = true; el('inspection').hidden = false;
  el('inspection').setAttribute('aria-busy','false');
  if (!keepStatus) status(words().ready);
}
function populateInsights() {
  el('insightSelect').replaceChildren(...archive.review.insights.map(record => {
    const label = time(record.source.frameSecond) + ' · ' + record.source.team + ' · ' +
      record.source.locale.toUpperCase() + ' · ' + record.response.caption;
    const option = make('option', label); option.value = record.id; return option;
  }));
}
async function loadSelection(selection, {force = false} = {}) {
  if (!selection) {
    controller?.abort(); generation++; archive = null; selectedArchiveId = null; selectedId = null; exportText = ''; lastSelection = null;
    el('inspection').hidden = true; el('noInsights').hidden = true; el('retryRead').hidden = true; el('chooseExisting').hidden = true;
    el('backToPlayer').href = '/'; status(words().landing); return;
  }
  if (!force && archive && selectedArchiveId === selection.archiveId) {
    lastSelection = selection; setHash(selection);
    el('chooseExisting').hidden = true;
    if (!archive.review.insights.length) { el('noInsights').hidden = false; status(words().emptyHeading); return; }
    try { showRecord(selection.insightId || [...archive.review.insights].reverse().find(record => record.response.toolCalls?.length)?.id || archive.review.insights.at(-1).id); }
    catch(error) { el('inspection').hidden = true; el('chooseExisting').hidden = false; el('retryRead').hidden = false; status(error.message, true); }
    return;
  }
  controller?.abort(); controller = new AbortController();
  const ticket = ++generation, signal = controller.signal;
  lastSelection = selection; selectedId = null; archive = null; exportText = ''; selectedArchiveId = null;
  el('inspection').hidden = true; el('noInsights').hidden = true; el('retryRead').hidden = true; el('chooseExisting').hidden = true;
  el('inspection').setAttribute('aria-busy','true'); status(words().loading);
  setHash(selection);
  try {
    const result = await readExport(selection.archiveId, signal);
    if (ticket !== generation) return;
    archive = result.data; exportText = result.text; selectedArchiveId = selection.archiveId;
    if (!archive.review.insights.length) {
      const review = archive.review;
      translate(review.view?.locale);
      el('emptyReplay').href = replayUrl(review.cursor, review.view);
      el('backToPlayer').href = el('emptyReplay').href;
      el('noInsights').hidden = false; status(words().emptyHeading); return;
    }
    populateInsights();
    const selected = selection.insightId || [...archive.review.insights].reverse().find(record => record.response.toolCalls?.length)?.id || archive.review.insights.at(-1).id;
    showRecord(selected);
  } catch(error) {
    if (ticket !== generation || error.name === 'AbortError') return;
    el('inspection').hidden = true; el('retryRead').hidden = false;
    el('chooseExisting').hidden = !archive?.review.insights.length;
    status(error.message || words().readFailed, true);
  } finally {
    if (ticket === generation) el('inspection').setAttribute('aria-busy','false');
  }
}
function download(name, body) {
  const url = URL.createObjectURL(new Blob([body], {type:'application/json;charset=utf-8'}));
  const link = make('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readCollection() {
  let key; try { key = localStorage.getItem('counterpress.library.v1'); } catch { return; }
  if (!/^[0-9a-f]{64}$/.test(key || '')) return;
  try {
    const response = await fetch('/api/archives', {headers:{'X-Counterpress-Library':key}, credentials:'same-origin', cache:'no-store', redirect:'error'});
    if (!response.ok) return;
    const value = await response.json();
    if (!Array.isArray(value.archives)) return;
    const choices = value.archives.filter(record => ARCHIVE_ID.test(record.id || ''));
    if (!choices.length) return;
    const initial = make('option', words().chooseMatch); initial.value = '';
    el('libraryMatches').replaceChildren(initial, ...choices.map(record => {
      const option = make('option', record.title || record.scenario || record.id); option.value = record.id; return option;
    }));
    el('collectionRow').hidden = false;
  } catch { /* A readable shared match link does not depend on this browser's collection. */ }
}
el('openMatch').addEventListener('submit', event => {
  event.preventDefault();
  try { void loadSelection(selectionFromAddress(el('matchAddress').value), {force:true}); }
  catch(error) { status(error.message, true); }
});
el('libraryMatches').addEventListener('change', () => { el('openLibraryMatch').disabled = !ARCHIVE_ID.test(el('libraryMatches').value); });
el('openLibraryMatch').addEventListener('click', () => {
  const id = el('libraryMatches').value;
  if (ARCHIVE_ID.test(id)) void loadSelection({archiveId:id, insightId:null});
});
el('insightSelect').addEventListener('change', () => {
  if (!archive) return;
  try { showRecord(el('insightSelect').value); }
  catch(error) { status(error.message, true); }
});
el('retryRead').addEventListener('click', () => { if (lastSelection) void loadSelection(lastSelection, {force:true}); });
el('chooseExisting').addEventListener('click', () => { if (selectedArchiveId) void loadSelection({archiveId:selectedArchiveId, insightId:null}); });
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  const target = el('inspection').hidden ? el('inspectorHeading') : el('savedAnswer');
  target.tabIndex = -1; target.focus(); target.scrollIntoView({block:'start'});
});
el('copyExplanation').addEventListener('click', async () => {
  if (!archive || !selectedId) return;
  const url = explanationUrl(selectedArchiveId, selectedId);
  try { await navigator.clipboard.writeText(url); status(words().copyDone); }
  catch { el('matchAddress').value = url; el('matchAddress').focus(); el('matchAddress').select(); status(words().copyFallback); }
});
el('downloadMatch').addEventListener('click', () => {
  if (archive && exportText) download('counterpress-match-' + selectedArchiveId + '.json', exportText);
});
el('downloadExplanation').addEventListener('click', () => {
  const record = archive?.review.insights.find(item => item.id === selectedId);
  if (record) download('counterpress-' + record.id + '.json', JSON.stringify(record, null, 2) + '\n');
});
addEventListener('hashchange', () => {
  try { void loadSelection(readSelection(location.hash)); }
  catch(error) { controller?.abort(); generation++; el('inspection').hidden = true; status(error.message, true); }
});
addEventListener('pagehide', () => controller?.abort());
translate('en');
try { void loadSelection(readSelection(location.hash)); }
catch(error) { status(error.message, true); }
void readCollection();
