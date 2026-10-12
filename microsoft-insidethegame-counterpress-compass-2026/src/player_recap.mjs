// MIT. Player and half-by-half projections of the unchanged canonical event engine.
import {derive, TEAMS, validateFixture, WINDOW_SECONDS} from './engine.mjs';

export const PLAYER_RECAP_FORMAT = 'counterpress.player-recap.v1';
const ACTIONS = ['loss','pressure','regain','pass','shot'];
const ROLE_NAMES = ['loss','pressure','regain','interruption'];
const PERIODS = ['all','first','second'];
const half = second => second < 2700 ? 'first' : 'second';
const inPeriod = (second,period) => period === 'all' || half(second) === period;
const countTypes = rows => Object.fromEntries(ACTIONS.map(type=>[type,rows.filter(row=>row.type===type).length]));
const rounded = value => Math.round(value*10)/10;
const pct = (numerator,denominator) => denominator ? Math.round(100*numerator/denominator) : null;
const clone = value => JSON.parse(JSON.stringify(value));
const words = {
  en:{
    all:'Whole observed match',first:'First half',second:'Second half',allPlayers:'All observed players',
    success:'Regained after pressure',expired:'Window expired',interrupted:'Observation interrupted',
    not_attempted:'No qualifying press',pending:'Observed sequence still open',
    loss:'Possession loss',pressure:'Pressure action',regain:'Ball regain',interruption:'New loss interrupted the earlier window',
    pass:'Pass',shot:'Shot',clock:'Clock marker',watermark:'Later event-time watermark',
    player:'Player',team:'Team',actions:'Observed actions',sequences:'Distinct sequence involvements',
    pressFrequency:'Press frequency',regainEfficiency:'Resolved regain efficiency',
    outcome:'Outcome',evidence:'Original sequence evidence',frame:'Event count',event:'Event ID',
    time:'Match time',type:'Action',zone:'Pitch third',role:'Role',selection:'Selection',
    overview:'Player recap',halves:'Half-by-half team comparison',playlist:'Evidence playlist',
    source:'Complete observed source events',sourceNote:'Synthetic match · canonical event log',
    noSequences:'No loss sequences match this player and period in the observed source.',
    noPlayers:'No named player actions have been observed.',
    defensive:'Defensive',middle:'Middle',attacking:'Attacking'
  },
  es:{
    all:'Partido observado completo',first:'Primera parte',second:'Segunda parte',allPlayers:'Todos los jugadores observados',
    success:'Recuperación tras presión',expired:'Ventana agotada',interrupted:'Observación interrumpida',
    not_attempted:'Sin presión válida',pending:'Secuencia observada aún abierta',
    loss:'Pérdida de posesión',pressure:'Acción de presión',regain:'Recuperación del balón',interruption:'Una nueva pérdida interrumpió la ventana anterior',
    pass:'Pase',shot:'Disparo',clock:'Marca del reloj',watermark:'Evento posterior que cierra la ventana',
    player:'Jugador',team:'Equipo',actions:'Acciones observadas',sequences:'Participaciones en secuencias distintas',
    pressFrequency:'Frecuencia de presión',regainEfficiency:'Eficacia de recuperación resuelta',
    outcome:'Resultado',evidence:'Evidencia original de la secuencia',frame:'Número de eventos',event:'ID del evento',
    time:'Tiempo de partido',type:'Acción',zone:'Tercio del campo',role:'Papel',selection:'Selección',
    overview:'Resumen del jugador',halves:'Comparación del equipo entre partes',playlist:'Lista de secuencias',
    source:'Eventos originales observados completos',sourceNote:'Partido sintético · registro canónico de eventos',
    noSequences:'Ninguna secuencia de pérdida coincide con este jugador y esta parte en el registro observado.',
    noPlayers:'Todavía no se han observado acciones de jugadores identificados.',
    defensive:'Defensivo',middle:'Medio',attacking:'Ofensivo'
  }
};

export function recapTime(second) {
  if(second===null||second===undefined)return '—';
  const tenths=Math.round(second*10),minutes=Math.floor(tenths/600),remaining=(tenths%600)/10;
  return String(minutes)+':'+String(remaining.toFixed(1)).padStart(4,'0');
}
const labelRate = value => value===null?'—':value+'%';

function roleFor(event,window) {
  if(event.id===window.id)return 'loss';
  if(event.type==='pressure')return 'pressure';
  if(event.type==='regain')return 'regain';
  if(event.type==='loss')return 'interruption';
  return 'context';
}
function involvement(evidence) {
  const map=new Map();
  for(const event of evidence){
    if(!event.player.trim())continue;
    if(!map.has(event.player))map.set(event.player,{player:event.player,roles:[],actionCount:0,actionIds:[]});
    const item=map.get(event.player);if(!item.roles.includes(event.role))item.roles.push(event.role);
    item.actionCount++;item.actionIds.push(event.id);
  }
  return [...map.values()];
}
function narrativeForSequence(item,locale,player) {
  const l=words[locale],focus=player||item.team,time=recapTime(item.fromSecond),pressures=item.pressureCount;
  const roleText=player?item.roles.map(role=>l[role]||role).join(', '):'';
  let text;
  if(locale==='es'){
    if(item.status==='success')text='El equipo recuperó el balón en '+item.secondsToRecover+' segundos tras '+pressures+(pressures===1?' acción de presión.':' acciones de presión.');
    else if(item.status==='expired')text='Acciones de presión observadas: '+pressures+'. La ventana de ocho segundos terminó sin una recuperación registrada.';
    else if(item.status==='interrupted')text='Una nueva pérdida interrumpió la observación después de '+item.observedSeconds+' segundos; la recuperación anterior queda sin resolver.';
    else if(item.status==='pending')text='Acciones de presión observadas: '+pressures+'. El registro actual deja esta secuencia abierta.';
    else text=item.evidence.at(-1)?.type==='regain'?'Se registró una recuperación sin presión previa válida en esta ventana.':'Esta ventana cerrada no contiene una acción de presión válida.';
    if(player)text+=' Papel de '+player+': '+roleText+'.';
  }else{
    if(item.status==='success')text='The team regained the ball in '+item.secondsToRecover+' seconds after '+pressures+(pressures===1?' pressure action.':' pressure actions.');
    else if(item.status==='expired')text='Observed pressure actions: '+pressures+'. The eight-second window ended without a recorded regain.';
    else if(item.status==='interrupted')text='A new loss interrupted the observation after '+item.observedSeconds+' seconds; the earlier recovery remains unresolved.';
    else if(item.status==='pending')text='Observed pressure actions: '+pressures+'. The current event log leaves this sequence open.';
    else text=item.evidence.at(-1)?.type==='regain'?'A regain was recorded without a qualifying prior pressure in this window.':'This closed window contains no qualifying pressure action.';
    if(player)text+=' '+player+' roles: '+roleText+'.';
  }
  return {title:focus+' · '+time+' · '+l[item.status],text};
}

/** Completed classifications and evidence are taken verbatim from derive(). */
function originalSequences(events,team,player,locale) {
  const finished=derive(events).filter(window=>window.team===team);
  const index=new Map(events.map((event,i)=>[event.id,{event,count:i+1}]));
  const finishedIds=new Set(finished.map(window=>window.id));
  const pending=events.filter(event=>event.team===team&&event.type==='loss'&&!finishedIds.has(event.id)).map(loss=>{
    const lossCount=index.get(loss.id).count;
    const pressures=events.slice(lossCount).filter(event=>event.team===team&&event.type==='pressure'&&event.second>=loss.second&&event.second<=loss.second+WINDOW_SECONDS);
    return {
      id:loss.id,team,fromSecond:loss.second,toSecond:Math.min(events.at(-1)?.second??loss.second,loss.second+WINDOW_SECONDS),
      secondsToRecover:null,zone:loss.zone,status:'pending',pressureCount:pressures.length,
      evidenceIds:[loss.id,...pressures.map(event=>event.id)]
    };
  });
  return [...finished,...pending].sort((a,b)=>a.fromSecond-b.fromSecond||a.id.localeCompare(b.id)).map(window=>{
    const sourceEvidence=window.evidenceIds.map(id=>index.get(id));
    if(sourceEvidence.some(record=>!record))throw new Error('Canonical sequence references an absent event.');
    const isPending=window.status==='pending',last=sourceEvidence.at(-1),hasClosingEvidence=last.event.id!==window.id&&last.event.type!=='pressure';
    // An expiry is visible only after the first actual strictly later event,
    // while a success/interruption closes on its original final evidence ID.
    let closingCount;
    if(isPending)closingCount=events.length;
    else if(hasClosingEvidence)closingCount=last.count;
    else closingCount=events.findIndex(event=>event.second>window.toSecond)+1;
    if(!isPending&&closingCount<1)throw new Error('A completed canonical window needs its original closing event.');
    const endEvent=closingCount?events[closingCount-1]:null;
    const evidence=sourceEvidence.map(({event,count})=>({...event,count,role:roleFor(event,window)}));
    const involvedPlayers=involvement(evidence),selected=involvedPlayers.find(item=>item.player===player);
    const roles=player?selected?.roles||[]:ROLE_NAMES.filter(role=>evidence.some(event=>event.role===role));
    const result={
      ...window,period:half(window.fromSecond),pending:isPending,
      startCount:index.get(window.id).count-1,lossCount:index.get(window.id).count,
      endCount:closingCount,endEventId:endEvent?.id??null,closureEventId:isPending?null:endEvent?.id??null,
      deadlineSecond:window.fromSecond+WINDOW_SECONDS,observedSeconds:rounded(window.toSecond-window.fromSecond),
      observedThroughSecond:endEvent?.second??null,
      evidence,involvedPlayers,roles,
      watermark:!isPending&&!hasClosingEvidence?{...endEvent,count:closingCount,role:'watermark'}:null,
      nextObserved:closingCount<events.length?{...events[closingCount],count:closingCount+1}:null
    };
    return {...result,...narrativeForSequence(result,locale,player)};
  });
}

function statsFor(windows,actions,player) {
  const selected=player===null?windows:windows.filter(window=>window.involvedPlayers.some(item=>item.player===player));
  const observedActions=player===null?actions:actions.filter(event=>event.player===player);
  const successes=selected.filter(item=>item.status==='success'),expired=selected.filter(item=>item.status==='expired');
  const pressing=selected.filter(item=>item.pressureCount>0),pending=selected.filter(item=>item.status==='pending');
  const roles=Object.fromEntries(ROLE_NAMES.map(role=>[role,selected.filter(window=>
    player===null?window.evidence.some(event=>event.role===role):window.involvedPlayers.some(item=>item.player===player&&item.roles.includes(role))).length]));
  return {
    scope:player===null?'team_loss_windows':'player_involved_windows',
    observedLosses:selected.length,closedLossWindows:selected.length-pending.length,
    pressingWindows:pressing.length,successes:successes.length,expiredAttempts:expired.length,
    interruptedAttempts:selected.filter(item=>item.status==='interrupted').length,
    notAttemptedWindows:selected.filter(item=>item.status==='not_attempted').length,pendingWindows:pending.length,
    pendingPressingWindows:pending.filter(item=>item.pressureCount>0).length,
    resolvedAttempts:successes.length+expired.length,
    pressFrequencyPct:pct(pressing.length,selected.length),
    pressFrequencyNumerator:pressing.length,pressFrequencyDenominator:selected.length,
    pressFrequencyBasis:player===null?'observed_team_loss_windows':'observed_player_involved_loss_windows',
    regainEfficiencyPct:pct(successes.length,successes.length+expired.length),
    regainEfficiencyNumerator:successes.length,regainEfficiencyDenominator:successes.length+expired.length,
    regainEfficiencyBasis:'success_and_expired_windows',
    meanRecoverySeconds:successes.length?rounded(successes.reduce((sum,item)=>sum+item.secondsToRecover,0)/successes.length):null,
    actions:countTypes(observedActions),actionCount:observedActions.length,sequenceInvolvements:selected.length,roles,
    successfulRegainActions:successes.filter(window=>player===null||window.evidence.some(event=>event.player===player&&event.role==='regain')).length,
    sequenceIds:selected.map(window=>window.id)
  };
}

function coverageFor(events,team,player,period) {
  const actions=events.filter(event=>event.type!=='clock'),periodActions=actions.filter(event=>inPeriod(event.second,period));
  const teamActions=periodActions.filter(event=>event.team===team),selected=player===null?teamActions:teamActions.filter(event=>event.player===player);
  const through=events.at(-1)?.second??null,last=actions.at(-1)?.second??null;
  return {
    eventCount:events.length,actionCount:actions.length,clockCount:events.length-actions.length,
    throughSecond:through,firstActionSecond:actions[0]?.second??null,lastActionSecond:last,
    actionSpanSeconds:actions.length?rounded(last-actions[0].second):null,
    clockTrailingSeconds:through!==null&&last!==null?rounded(through-last):null,
    periodEventCount:events.filter(event=>inPeriod(event.second,period)).length,
    periodActionCount:periodActions.length,periodFirstActionSecond:periodActions[0]?.second??null,
    periodLastActionSecond:periodActions.at(-1)?.second??null,
    teamActionCount:teamActions.length,selectedActionCount:selected.length,
    selectedFirstActionSecond:selected[0]?.second??null,selectedLastActionSecond:selected.at(-1)?.second??null,
    unattributedActionCount:periodActions.filter(event=>!event.player.trim()).length,
    terminalClockObserved:events.some(event=>event.type==='clock'&&event.second===5400),
    basis:'observed_event_rows',period
  };
}
function halfSummary(windows,events,team,player,period) {
  const selected=windows.filter(window=>inPeriod(window.fromSecond,period));
  const actions=events.filter(event=>event.team===team&&event.type!=='clock'&&inPeriod(event.second,period));
  return {teamStats:statsFor(selected,actions,null),selectedStats:statsFor(selected,actions,player),coverage:coverageFor(events,team,player,period)};
}
function compareHalves(first,second,locale) {
  const a=first.teamStats,b=second.teamStats;
  const delta=(key)=>a[key]===null||b[key]===null?null:rounded(b[key]-a[key]);
  const pressFrequencyDeltaPct=delta('pressFrequencyPct'),regainEfficiencyDeltaPct=delta('regainEfficiencyPct');
  const frequency=a.pressingWindows+'/'+a.observedLosses+' ('+labelRate(a.pressFrequencyPct)+') → '+b.pressingWindows+'/'+b.observedLosses+' ('+labelRate(b.pressFrequencyPct)+')';
  const efficiency=a.successes+'/'+a.resolvedAttempts+' ('+labelRate(a.regainEfficiencyPct)+') → '+b.successes+'/'+b.resolvedAttempts+' ('+labelRate(b.regainEfficiencyPct)+')';
  const narrative=locale==='es'?[
    'Frecuencia de presión por pérdidas observadas, primera → segunda parte: '+frequency+'.',
    'Recuperación en intentos resueltos, primera → segunda parte: '+efficiency+'.',
    'Cada secuencia se asigna a la parte de su pérdida original; las acciones se cuentan en su propio momento observado.'
  ]:[
    'Press frequency per observed loss, first → second half: '+frequency+'.',
    'Regain efficiency among resolved attempts, first → second half: '+efficiency+'.',
    'Sequences belong to the half of their original loss; actions are counted at their own observed event time.'
  ];
  return {pressFrequencyDeltaPct,regainEfficiencyDeltaPct,deltaUnit:'percentage_points',basis:'team_loss_windows',narrative};
}
function recapNarrative(selection,coverage,teamStats,selectedStats,comparison) {
  const {team,player,locale}=selection,l=words[locale],sourceTime=recapTime(coverage.throughSecond),actionTime=recapTime(coverage.lastActionSecond);
  const pressure=teamStats.pressingWindows+'/'+teamStats.observedLosses,regains=teamStats.successes+'/'+teamStats.resolvedAttempts;
  const counts=selectedStats.actions;
  if(locale==='es'){
    return [
      'Eventos observados: '+coverage.eventCount+'; acciones de fútbol: '+coverage.actionCount+'. Última acción: '+actionTime+'; último tiempo del registro: '+sourceTime+'.',
      team+': presión en '+pressure+' pérdidas observadas ('+labelRate(teamStats.pressFrequencyPct)+'); recuperación en '+regains+' intentos resueltos ('+labelRate(teamStats.regainEfficiencyPct)+').',
      player?player+': acciones propias '+selectedStats.actionCount+'; secuencias distintas con participación registrada '+selectedStats.sequenceInvolvements+'. Pérdidas '+counts.loss+', presiones '+counts.pressure+', recuperaciones '+counts.regain+', pases '+counts.pass+', disparos '+counts.shot+'.':team+': acciones observadas en '+l[selection.period].toLowerCase()+': '+selectedStats.actionCount+'.',
      'Resultados de las secuencias seleccionadas: recuperaciones tras presión '+selectedStats.successes+'; agotadas '+selectedStats.expiredAttempts+'; interrumpidas '+selectedStats.interruptedAttempts+'; abiertas '+selectedStats.pendingWindows+'; sin presión válida '+selectedStats.notAttemptedWindows+'.',
      ...(coverage.terminalClockObserved?['La marca de 90:00 es un evento del reloj; la cobertura de acciones termina en '+actionTime+'.']:[]),
      ...comparison.narrative
    ];
  }
  return [
    'Observed events: '+coverage.eventCount+'; football actions: '+coverage.actionCount+'. Latest action: '+actionTime+'; latest event-log time: '+sourceTime+'.',
    team+': pressure in '+pressure+' observed losses ('+labelRate(teamStats.pressFrequencyPct)+'); regains in '+regains+' resolved attempts ('+labelRate(teamStats.regainEfficiencyPct)+').',
    player?player+': own actions '+selectedStats.actionCount+'; distinct sequences with recorded involvement '+selectedStats.sequenceInvolvements+'. Losses '+counts.loss+', pressures '+counts.pressure+', regains '+counts.regain+', passes '+counts.pass+', shots '+counts.shot+'.':team+': observed actions in the selected period: '+selectedStats.actionCount+'.',
    'Selected sequence outcomes: regains after pressure '+selectedStats.successes+'; expired '+selectedStats.expiredAttempts+'; interrupted '+selectedStats.interruptedAttempts+'; open '+selectedStats.pendingWindows+'; without qualifying pressure '+selectedStats.notAttemptedWindows+'.',
    ...(coverage.terminalClockObserved?['The 90:00 marker is a clock event; action coverage ends at '+actionTime+'.']:[]),
    ...comparison.narrative
  ];
}

/** Build a deterministic recap of exactly this already-observed source prefix. */
export function buildPlayerRecap(events,{team=TEAMS[0],player=null,period='all',locale='en'}={}) {
  validateFixture(events);
  if(!TEAMS.includes(team)||!PERIODS.includes(period)||!['en','es'].includes(locale))throw new TypeError('Choose an observed team, match period and supported language.');
  if(player!==null&&(typeof player!=='string'||!player.trim()||player.length>48||/[<>]/.test(player)))throw new TypeError('Choose a player label from the observed source.');
  const source=clone(events),teamActions=source.filter(event=>event.team===team&&event.type!=='clock'),playerNames=[...new Set(teamActions.filter(event=>event.player.trim()).map(event=>event.player))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
  const players=playerNames.map(name=>{const actions=teamActions.filter(event=>event.player===name);return {player:name,team,actionCount:actions.length,actions:countTypes(actions),firstActionSecond:actions[0].second,lastActionSecond:actions.at(-1).second};});
  const windows=originalSequences(source,team,player,locale);
  const first=halfSummary(windows,source,team,player,'first'),second=halfSummary(windows,source,team,player,'second');
  const selected=halfSummary(windows,source,team,player,period),comparison=compareHalves(first,second,locale);
  const selection={team,player,period,locale,playerObserved:player===null||playerNames.includes(player)};
  const sequences=windows.filter(window=>inPeriod(window.fromSecond,period)&&(player===null||window.involvedPlayers.some(item=>item.player===player)));
  const observedActions=source.map((event,i)=>({...event,count:i+1})).filter(event=>event.team===team&&event.type!=='clock'&&inPeriod(event.second,period)&&(player===null||event.player===player));
  return {
    format:PLAYER_RECAP_FORMAT,selection,windowSeconds:WINDOW_SECONDS,
    players,...selected,first,second,comparison,sequences,observedActions,sourceEvents:source,
    narrative:recapNarrative(selection,selected.coverage,selected.teamStats,selected.selectedStats,comparison),
    labels:{...words[locale]},provenance:'SYNTHETIC MATCH · CANONICAL EVENT LOG'
  };
}

export function playerRecapJson(recap) {
  if(recap?.format!==PLAYER_RECAP_FORMAT)throw new TypeError('Export a complete player recap.');
  return JSON.stringify(recap,null,2)+'\n';
}

const htmlEscape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function htmlTable(headers,rows) {
  return '<div class="table-wrap"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+htmlEscape(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((value,i)=>'<'+(i?'td':'th scope="row"')+'>'+htmlEscape(value)+'</'+(i?'td':'th')+'>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function eventsHtml(events,l,{source=false}={}) {
  const heads=[l.frame,l.event,l.time,l.team,l.player,l.type,l.zone,...(source?[]:[l.role])];
  return '<div class="table-wrap"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+htmlEscape(x)+'</th>').join('')+'</tr></thead><tbody>'+
    events.map((event,i)=>'<tr'+(source?' id="event-'+htmlEscape(event.id)+'"':'')+'><td>'+htmlEscape(event.count??i+1)+'</td><th scope="row">'+(source?htmlEscape(event.id):'<a href="#event-'+htmlEscape(event.id)+'">'+htmlEscape(event.id)+'</a>')+'</th><td>'+htmlEscape(recapTime(event.second))+'</td><td>'+htmlEscape(event.team)+'</td><td>'+htmlEscape(event.player||'—')+'</td><td>'+htmlEscape(l[event.type]||event.type)+'</td><td>'+htmlEscape(l[event.zone]||event.zone)+'</td>'+(source?'':'<td>'+htmlEscape(l[event.role]||event.role||'—')+'</td>')+'</tr>').join('')+'</tbody></table></div>';
}

/** Standalone human-readable report with complete original event rows and links. */
export function playerRecapHtml(recap,{title=null,scenario=null,seed=null}={}) {
  if(recap?.format!==PLAYER_RECAP_FORMAT)throw new TypeError('Export a complete player recap.');
  const {selection,coverage,teamStats,selectedStats,first,second}=recap,l=words[selection.locale],spanish=selection.locale==='es';
  const heading=title||(selection.player?l.overview+' · '+selection.player:l.overview+' · '+selection.team);
  const statNames=spanish?{
    observedLosses:'Pérdidas observadas',pressingWindows:'Ventanas con presión observada',resolvedAttempts:'Intentos resueltos',
    successes:'Recuperaciones tras presión',expiredAttempts:'Ventanas agotadas',interruptedAttempts:'Observaciones interrumpidas',
    notAttemptedWindows:'Ventanas sin presión válida',pendingWindows:'Ventanas abiertas',meanRecoverySeconds:'Recuperación media (s)'
  }:{
    observedLosses:'Observed loss windows',pressingWindows:'Windows with observed pressure',resolvedAttempts:'Resolved attempts',
    successes:'Regains after pressure',expiredAttempts:'Expired windows',interruptedAttempts:'Interrupted observations',
    notAttemptedWindows:'Windows without qualifying pressure',pendingWindows:'Open windows',meanRecoverySeconds:'Mean recovery (s)'
  };
  const contextRows=[
    [l.pressFrequency,teamStats.pressingWindows+'/'+teamStats.observedLosses,labelRate(teamStats.pressFrequencyPct)],
    [l.regainEfficiency,teamStats.successes+'/'+teamStats.resolvedAttempts,labelRate(teamStats.regainEfficiencyPct)],
    ...Object.entries(statNames).map(([key,label])=>[label,teamStats[key]??'—',''])
  ];
  const halves=htmlTable([spanish?'Medida':'Measure',l.first,l.second],[
    [l.pressFrequency,first.teamStats.pressingWindows+'/'+first.teamStats.observedLosses+' · '+labelRate(first.teamStats.pressFrequencyPct),second.teamStats.pressingWindows+'/'+second.teamStats.observedLosses+' · '+labelRate(second.teamStats.pressFrequencyPct)],
    [l.regainEfficiency,first.teamStats.successes+'/'+first.teamStats.resolvedAttempts+' · '+labelRate(first.teamStats.regainEfficiencyPct),second.teamStats.successes+'/'+second.teamStats.resolvedAttempts+' · '+labelRate(second.teamStats.regainEfficiencyPct)],
    ...Object.entries(statNames).map(([key,label])=>[label,first.teamStats[key]??'—',second.teamStats[key]??'—']),
    [l.actions,first.selectedStats.actionCount,second.selectedStats.actionCount],
    [l.sequences,first.selectedStats.sequenceInvolvements,second.selectedStats.sequenceInvolvements]
  ]);
  const personal=htmlTable([l.type,l.actions],ACTIONS.map(type=>[l[type],selectedStats.actions[type]]))+
    htmlTable([l.role,l.sequences],ROLE_NAMES.map(role=>[l[role],selectedStats.roles[role]]));
  const sequenceList=recap.sequences.map(item=>{
    const closure=item.pending?(spanish?'El clip termina en el último evento observado; la secuencia sigue abierta.':'The clip ends at the latest observed event; this sequence remains open.'):
      item.watermark?(spanish?'Cierre observado en el primer evento estrictamente posterior a la ventana.':'Observed closure is the first event strictly later than the window.'):
      (spanish?'Cierre en el último evento de evidencia original.':'Closure is the final original evidence event.');
    const range=(spanish?'Reproducción: prefijo ':'Replay: prefix ')+item.startCount+' → '+item.endCount+' · '+(spanish?'evento final ':'ending event ')+(item.endEventId||'—');
    return '<section class="sequence" id="sequence-'+htmlEscape(item.id)+'"><h3>'+htmlEscape(item.title)+'</h3><p>'+htmlEscape(item.text)+'</p><p class="meta">'+htmlEscape(range)+'</p><p>'+htmlEscape(closure)+'</p>'+eventsHtml(item.evidence,l)+(item.watermark?'<h4>'+htmlEscape(l.watermark)+'</h4>'+eventsHtml([item.watermark],l):'')+'</section>';
  }).join('');
  const sourceMeta=[coverage.eventCount+' '+(spanish?'eventos':'events'),coverage.actionCount+' '+(spanish?'acciones':'actions'),
    (spanish?'última acción ':'last action ')+recapTime(coverage.lastActionSecond),(spanish?'último tiempo ':'through ')+recapTime(coverage.throughSecond),
    ...(scenario!==null?[(spanish?'escenario ':'scenario ')+scenario]:[]),...(seed!==null?[(spanish?'semilla ':'seed ')+seed]:[])].join(' · ');
  const basis=spanish?'La frecuencia usa todas las pérdidas observadas como denominador, incluidas las ventanas aún abiertas. La eficacia usa únicamente recuperaciones tras presión y ventanas agotadas; las interrupciones, las ventanas abiertas y la ausencia de presión se cuentan por separado. La participación en una secuencia no atribuye por sí misma la recuperación al jugador.':
    'Press frequency uses all observed losses as its denominator, including still-open windows. Regain efficiency uses only successes and expired windows; interruptions, open windows and unattempted windows remain separate. Involvement in a sequence does not by itself attribute the regain to that player.';
  const css=':root{font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#202124;background:#fff}body{max-width:1180px;margin:0 auto;padding:2rem}h1{font-size:2rem;line-height:1.2}h2{font-size:1.4rem;margin-top:2rem}h3{font-size:1.1rem}a{color:inherit;overflow-wrap:anywhere}.meta,.basis{color:#565b60;font-size:.9rem}header{border-bottom:1px solid #ccd0d3;padding-bottom:1rem}.table-wrap{max-width:100%;overflow:auto;margin:1rem 0;border:1px solid #d6d9dc}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{text-align:left;vertical-align:top;padding:.55rem .65rem;border-bottom:1px solid #e2e4e6;overflow-wrap:anywhere}thead{background:#eceeef}tbody th{font-weight:600}.sequence{padding:1rem 0;border-top:1px solid #ccd0d3}.sequence h3{scroll-margin-top:1rem}nav ul{padding-left:1.25rem}summary{cursor:pointer;font-weight:700}button{font:inherit;padding:.5rem .8rem;background:#fff;border:1px solid #a5aaae;border-radius:3px}@media(max-width:600px){body{padding:1rem}h1{font-size:1.6rem}table{font-size:.8rem}th,td{padding:.4rem}}@media print{@page{margin:15mm}body{max-width:none;padding:0;font-size:10pt}.table-wrap{overflow:visible}table{table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}h2,h3,h4{break-after:avoid}details{display:block}details>summary{display:none}details>*{display:block}nav{display:none}}';
  return '<!doctype html>\n<html lang="'+htmlEscape(selection.locale)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+htmlEscape(heading)+' — Counterpress Compass</title><style>'+css+'</style></head><body><header><p class="meta">Counterpress Compass · '+htmlEscape(l.sourceNote)+'</p><h1>'+htmlEscape(heading)+'</h1><p>'+htmlEscape(selection.team+' · '+(selection.player||l.allPlayers)+' · '+l[selection.period])+'</p><p class="meta">'+htmlEscape(sourceMeta)+'</p></header><section><h2>'+htmlEscape(l.overview)+'</h2>'+recap.narrative.map(text=>'<p>'+htmlEscape(text)+'</p>').join('')+'<p class="basis">'+htmlEscape(basis)+'</p></section><section><h2>'+htmlEscape(l.team+' · '+selection.team)+'</h2>'+htmlTable([spanish?'Medida':'Measure',spanish?'Cuenta':'Count',spanish?'Tasa':'Rate'],contextRows)+'</section><section><h2>'+htmlEscape((selection.player||l.allPlayers)+' · '+l.actions)+'</h2>'+personal+'</section><section><h2>'+htmlEscape(l.halves)+'</h2>'+halves+'</section><section><h2>'+htmlEscape(l.playlist)+'</h2><nav aria-label="'+htmlEscape(l.playlist)+'"><ul>'+recap.sequences.map(item=>'<li><a href="#sequence-'+htmlEscape(item.id)+'">'+htmlEscape(item.title)+'</a></li>').join('')+'</ul></nav>'+(sequenceList||'<p>'+htmlEscape(l.noSequences)+'</p>')+'</section><details open><summary>'+htmlEscape(l.source)+'</summary>'+eventsHtml(recap.sourceEvents,l,{source:true})+'</details></body></html>\n';
}
