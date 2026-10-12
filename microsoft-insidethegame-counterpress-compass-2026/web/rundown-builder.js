// A self-contained editor panel; the host owns archive saving and authored captions.
const element = (tag, value, className = '') => {
  const item = document.createElement(tag);
  if (value !== undefined) item.textContent = value;
  if (className) item.className = className;
  return item;
};
const clock = value => {
  if (value === null || value === undefined) return '—';
  const tenths = Math.round(value * 10);
  return String(Math.floor(tenths / 600)).padStart(2, '0') + ':' +
    String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
};
const labels = {
  en: {
    context:'Full story context', heading:'Build a personalized rundown',
    intro:'Start with a draft from the observed match, review the chosen plays, then add them to your caption rundown.',
    player:'Player', allPlayers:'All observed players', period:'Match period', all:'Whole observed match',
    first:'First half', second:'Second half', focus:'Story focus', balanced:'Match story', recoveries:'Recovery highlights',
    limit:'Number of plays', generate:'Build draft', working:'Building the rundown…',
    ready:'Choose the story you want to prepare. The team, language and event limit follow the handover above.',
    add:'Add selected plays', brief:'Use story title and summary', briefHelp:'Applies the suggested title and appends the summary to your production notes.',
    selected:'selected', slots:'caption spaces available', outcomes:'Team recoveries', attempts:'resolved attempts',
    coverage:'Observed through', lastAction:'Last action', source:'Source', draft:'Suggested story',
    included:'Already in the caption rundown', reason:'Selection', evidence:'Original plays',
    view:'Open at outcome', begin:'Open before the sequence', event:'Event', available:'Outcome available',
    empty:'No completed pressing sequences match this observed selection. Choose another player or period, or advance the event limit.',
    allIncluded:'Every matching sequence is already in the caption rundown. Existing captions remain editable below.',
    full:'This handover contains 64 captions. Remove a caption below to make space for another play.',
    error:'The rundown could not be prepared.', stale:'The source selection changed. Build a draft for the current view.',
    added:'Selected plays added. Edit their captions and place their video times below.',
    applied:'Story title applied and summary added to production notes.', generated:'Draft ready for review.',
    selectionCount:(selected,total)=>selected+' of '+total+' plays selected',
    population:(eligible,included)=>eligible+' matching completed sequences · '+included+' already included',
    stats:(wins,attempts)=>wins+' / '+attempts+' resolved attempts',
    actions:{loss:'Possession lost',pressure:'Pressure action',regain:'Ball recovery',pass:'Pass',shot:'Shot',clock:'Match clock'},
  },
  es: {
    context:'Contexto completo de la historia', heading:'Crear un guion personalizado',
    intro:'Empieza con un borrador del partido observado, revisa las jugadas elegidas y añádelas al guion de subtítulos.',
    player:'Jugador', allPlayers:'Todos los jugadores observados', period:'Periodo del partido', all:'Partido observado completo',
    first:'Primera parte', second:'Segunda parte', focus:'Enfoque', balanced:'Historia del partido', recoveries:'Recuperaciones destacadas',
    limit:'Número de jugadas', generate:'Crear borrador', working:'Preparando el guion…',
    ready:'Elige la historia que quieres preparar. El equipo, idioma y límite de eventos siguen la selección de arriba.',
    add:'Añadir jugadas seleccionadas', brief:'Usar título y resumen', briefHelp:'Aplica el título sugerido y añade el resumen a las notas de producción.',
    selected:'seleccionadas', slots:'espacios disponibles', outcomes:'Recuperaciones del equipo', attempts:'intentos resueltos',
    coverage:'Observado hasta', lastAction:'Última acción', source:'Origen', draft:'Historia sugerida',
    included:'Ya está en el guion de subtítulos', reason:'Selección', evidence:'Jugadas originales',
    view:'Abrir en el resultado', begin:'Abrir antes de la secuencia', event:'Jugada', available:'Resultado disponible',
    empty:'No hay secuencias de presión resueltas para esta selección observada. Elige otro jugador o periodo, o avanza el límite de eventos.',
    allIncluded:'Todas las secuencias coincidentes ya están en el guion. Puedes seguir editando los subtítulos abajo.',
    full:'Este guion contiene 64 subtítulos. Elimina uno abajo para dejar espacio a otra jugada.',
    error:'No se ha podido preparar el guion.', stale:'La selección de origen cambió. Crea un borrador para la vista actual.',
    added:'Jugadas añadidas. Edita sus subtítulos y tiempos de vídeo abajo.',
    applied:'Título aplicado y resumen añadido a las notas de producción.', generated:'Borrador listo para revisar.',
    selectionCount:(selected,total)=>selected+' de '+total+' jugadas seleccionadas',
    population:(eligible,included)=>eligible+' secuencias resueltas coincidentes · '+included+' ya incluidas',
    stats:(wins,attempts)=>wins+' / '+attempts+' intentos resueltos',
    actions:{loss:'Pérdida de posesión',pressure:'Acción de presión',regain:'Recuperación',pass:'Pase',shot:'Disparo',clock:'Reloj del partido'},
  },
};

export function createRundownBuilder({root, context, request, append, applyBrief, replayUrl}) {
  let sourceKey = '', archiveId = '', locale = 'en', version = 0, loading = false;
  let proposal = null, selected = new Set(), statusKey = 'ready', statusText = '';
  const refs = {}, localized = [], rows = new Map();
  const W = () => labels[locale] || labels.en;
  const label = (tag, key, className = '') => {
    const item = element(tag, '', className); localized.push([item, key]); return item;
  };
  const heading = label('h2','heading'); heading.id = 'rundownHeading';
  root.setAttribute('aria-labelledby', heading.id);
  const intro = label('p','intro','note'), fields = element('div',undefined,'rundown-fields');
  for (const key of ['player','period','focus','limit']) {
    const group = element('label'), text = label('span',key), select = element('select');
    select.id = 'rundown-' + key; refs[key] = select; group.append(text,select); fields.append(group);
    select.onchange = () => { invalidate('ready'); sync(); };
  }
  const toolbar = element('div',undefined,'toolbar'), generate = label('button','generate');
  generate.type = 'button'; generate.className = 'primary'; toolbar.append(generate);
  const scope = element('p',undefined,'note metric'), status = element('p',undefined,'note');
  status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const preview = element('div',undefined,'rundown-preview'); preview.hidden = true;
  root.replaceChildren(heading,intro,fields,toolbar,scope,status,preview);
  const add = label('button','add'), brief = label('button','brief');
  add.type = brief.type = 'button';
  const selectionCount = element('p',undefined,'note metric'), briefHelp = label('p','briefHelp','note');
  const population = element('p',undefined,'note metric');
  function signature(value) {
    if (!value) return '';
    return JSON.stringify([value.id,value.broadcast.count,value.broadcast.view.team,
      value.broadcast.view.audience,value.broadcast.view.locale]);
  }
  function setOptions(select, options, value) {
    select.replaceChildren(...options.map(([key,title]) => {
      const item = element('option',title); item.value = key; return item;
    }));
    if (options.some(([key]) => String(key) === String(value))) select.value = value;
  }
  function invalidate(message) {
    version++; loading = false; proposal = null; selected.clear(); rows.clear();
    preview.hidden = true; preview.replaceChildren(); statusKey = message; statusText = '';
  }
  function choice() {
    return {player:refs.player.value || null, period:refs.period.value, focus:refs.focus.value, limit:Number(refs.limit.value)};
  }
  function showStatus(key, message = '') { statusKey = key; statusText = message; status.textContent = message || W()[key] || ''; }
  function existingIds(value) { return new Set(value.broadcast.cues.map(item => item.momentId).filter(Boolean)); }
  function updateControls(value) {
    const disabled = loading || !!value?.busy, existing = value ? existingIds(value) : new Set();
    const slots = value ? Math.max(0,64-value.broadcast.cues.length) : 0;
    for (const [id,row] of rows) {
      const included = existing.has(id);
      if (included) selected.delete(id);
      row.checkbox.checked = selected.has(id); row.checkbox.disabled = disabled || included;
      row.included.hidden = !included;
    }
    for (const select of Object.values(refs)) select.disabled = disabled;
    generate.disabled = disabled || !value || slots === 0;
    add.disabled = disabled || !proposal || !selected.size || selected.size > slots;
    brief.disabled = disabled || !proposal;
    if (proposal) population.textContent = W().population(proposal.counts.eligible,
      proposal.eligibleMomentIds.filter(id => existing.has(id)).length);
    selectionCount.textContent = W().selectionCount(selected.size,proposal?.cues.length || 0) +
      ' · ' + slots + ' ' + W().slots;
    status.textContent = statusText || W()[statusKey] || '';
  }
  function renderPreview(value) {
    const word = W(); rows.clear();
    if (!proposal) { preview.hidden = true; return; }
    preview.hidden = false;
    const title = element('h3',proposal.title), narrative = element('div',undefined,'rundown-brief');
    for (const paragraph of proposal.narrative.slice(0,3)) narrative.append(element('p',paragraph));
    if (proposal.narrative.length > 3) {
      const detail = element('details'), summary = element('summary',word.context);
      detail.append(summary);
      for (const paragraph of proposal.narrative.slice(3)) detail.append(element('p',paragraph));
      narrative.append(detail);
    }
    const method = element('p',proposal.method,'note');
    const summary = element('div',undefined,'rundown-summary');
    summary.append(element('p',word.outcomes+' · '+word.stats(proposal.teamStats.successes,proposal.teamStats.resolvedAttempts),'metric'),
      element('p',word.coverage+' '+clock(proposal.source.observedThroughSecond)+' · '+word.lastAction+' '+clock(proposal.source.lastActionSecond),'metric'));
    const list = element('ol',undefined,'rundown-list');
    for (const item of proposal.cues) {
      const row = element('li'), selectLabel = element('label',undefined,'rundown-choice');
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(item.momentId);
      const name = element('span',item.title); selectLabel.append(checkbox,name);
      const caption = element('p',item.caption), reason = element('p',word.reason+' · '+item.reason,'note');
      const included = element('p',word.included,'note'); included.hidden = true;
      const actions = element('div',undefined,'source-actions');
      for (const [at,text] of [[item.startCount,word.begin],[item.count,word.view]]) {
        const link = element('a',text); link.href = replayUrl(at,item.team); link.target = '_blank'; link.rel = 'noopener'; actions.append(link);
      }
      const details = element('details'), detailHeading = element('summary',word.evidence), evidence = element('ol',undefined,'evidence');
      for (const event of item.evidence) evidence.append(element('li',clock(event.second)+' · '+event.id+' · '+event.player+' · '+word.actions[event.type]));
      if (item.watermark) evidence.append(element('li',word.available+' '+clock(item.watermark.second)+' · '+item.watermark.id));
      details.append(detailHeading,evidence); row.append(selectLabel,caption,reason,included,actions,details); list.append(row);
      rows.set(item.momentId,{checkbox,included});
      checkbox.onchange = () => {
        if (checkbox.checked) selected.add(item.momentId); else selected.delete(item.momentId);
        updateControls(context());
      };
    }
    const controls = element('div',undefined,'toolbar rundown-apply'); controls.append(add,brief);
    preview.replaceChildren(title,narrative,summary,method,population,list,selectionCount,controls,briefHelp);
    if (!proposal.cues.length) {
      const key = !proposal.counts.remainingSlots ? 'full' : proposal.counts.eligible && !proposal.counts.available ? 'allIncluded' : 'empty';
      list.append(element('li',word[key],'note'));
    }
    localize(); updateControls(value);
  }
  function localize() {
    for (const [item,key] of localized) item.textContent = W()[key];
  }
  function sync() {
    const value = context();
    if (!value) { root.hidden = true; return; }
    root.hidden = false;
    const next = signature(value), newArchive = archiveId !== value.id, changedSource = sourceKey !== next;
    if (changedSource) {
      const old = {player:refs.player.value,period:refs.period.value,focus:refs.focus.value,limit:refs.limit.value};
      const hadProposal = !!proposal;
      invalidate(hadProposal ? 'stale' : 'ready');
      sourceKey = next; archiveId = value.id; locale = value.broadcast.view.locale;
      const prefix = value.match.events.slice(0,value.broadcast.count);
      const players = [...new Set(prefix.filter(event=>event.team===value.broadcast.view.team&&event.type!=='clock'&&event.player.trim()).map(event=>event.player))]
        .sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
      const preferred = newArchive ? value.recap?.player || '' : old.player;
      setOptions(refs.player,[['',W().allPlayers],...players.map(player=>[player,player])],preferred);
      setOptions(refs.period,['all','first','second'].map(key=>[key,W()[key]]),newArchive ? value.recap?.period || 'all' : old.period);
      setOptions(refs.focus,['balanced','recoveries'].map(key=>[key,W()[key]]),newArchive ? (value.recap?.outcome==='success'?'recoveries':'balanced') : old.focus);
      setOptions(refs.limit,[3,5,8,12].map(count=>[String(count),String(count)]),newArchive ? '5' : old.limit);
      const last = prefix.filter(event=>event.type!=='clock').at(-1);
      scope.textContent = value.broadcast.view.team+' · '+W().event+' '+value.broadcast.count+'/'+value.match.events.length+
        ' · '+W().lastAction+' '+clock(last?.second);
      localize();
    }
    updateControls(value);
  }
  generate.onclick = async () => {
    sync(); const value = context();
    if (!value || value.busy || loading) return;
    const selection = choice(), atSource = sourceKey, own = ++version;
    loading = true; showStatus('working'); updateControls(value);
    try {
      const result = await request({id:value.id,broadcast:JSON.parse(JSON.stringify(value.broadcast)),selection});
      if (own !== version || signature(context()) !== atSource) return;
      proposal = result; selected = new Set(result.cues.map(item=>item.momentId));
      renderPreview(context()); showStatus('generated');
    } catch (error) {
      if (own === version) showStatus('error',error.message || W().error);
    } finally { if (own === version) { loading = false; sync(); } }
  };
  add.onclick = () => {
    const value = context();
    if (!proposal || !value || value.busy || loading || signature(value) !== sourceKey) return;
    const existing = existingIds(value), items = proposal.cues.filter(item=>selected.has(item.momentId)&&!existing.has(item.momentId));
    if (!items.length) return;
    try { append(items); showStatus('added'); updateControls(context()); }
    catch (error) { showStatus('error',error.message || W().error); }
  };
  brief.onclick = () => {
    const value = context();
    if (!proposal || !value || value.busy || loading || signature(value) !== sourceKey) return;
    try { applyBrief({title:proposal.title,brief:proposal.brief}); showStatus('applied'); updateControls(context()); }
    catch (error) { showStatus('error',error.message || W().error); }
  };
  localize(); root.hidden = true;
  return {sync};
}
