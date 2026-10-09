import {STORY_LANGUAGES, localizeMoment} from './locale.mjs';
const byId=id=>document.getElementById(id);
const fields=['home-name','away-name','clock','score','moment-title','moment-text','moment-event','moment-rule','moment-expires','context-metrics','status'];
const out=Object.fromEntries(fields.map(id=>[id,byId(id)]));
const input=new URLSearchParams(location.search);
const audience=['analyst','fan'].includes(input.get('audience'))?input.get('audience'):'analyst';
const favorite=['Harbor FC','Valley FC'].includes(input.get('favorite'))?input.get('favorite'):'Harbor FC';
const language=STORY_LANGUAGES.includes(input.get('language'))?input.get('language'):'en';
document.documentElement.lang=language;
const STRINGS=Object.freeze({
  "en": {
    "studio": "STUDIO OUTPUT",
    "synthetic": "SYNTHETIC REPLAY · FICTIONAL TEAMS · NOT LIVE",
    "clock": "MATCH CLOCK",
    "moment": "RULE-EXPLAINED MOMENT",
    "context": "EVENT-SOURCED / NOT PREDICTIVE",
    "disclaimer": "All names and events fictional · No Premier League data · No cloud narration",
    "hintPress": "Press",
    "hintBefore": "for high contrast · Window capture in the",
    "hintProfile": "same browser profile",
    "hintAfter": "as the control tab",
    "skip": "Skip to current moment",
    "ariaMain": "Fictional football match graphics",
    "ariaScore": "Score and match clock",
    "ariaProof": "Evidence trace",
    "ariaContext": "Event-derived match context",
    "title": "PitchPulse — Broadcast-safe synthetic evidence view",
    "source": "SOURCE",
    "rule": "RULE",
    "expires": "EXPIRES",
    "shots": "shots",
    "passes": "passes",
    "noHighlight": "No active highlight at this match clock",
    "waiting": "Waiting for a synthetic match event",
    "emptyExplanation": "Evidence-backed graphics appear here only within their event-time window.",
    "noEvent": "NO ACTIVE EVENT",
    "noRule": "NO ACTIVE RULE",
    "archived": "ARCHIVED MOMENTS HIDDEN",
    "ok": "SYNTHETIC REPLAY · {count} EVENTS ACCEPTED · READ-ONLY VIEW",
    "stale": "STALE · LAST GRAPHIC FROZEN · DO NOT AIR",
    "unavailable": "NO DEMO CONNECTION · NO GRAPHIC AVAILABLE",
    "paused": "PREVIEW PAUSED · LAST GRAPHIC FROZEN",
    "connecting": "CONNECTING TO LOCAL DEMO",
    "hintNoEvents": "No accepted events yet.",
    "hintOpen": "Open the original PitchPulse tab in this browser profile, then press Next event."
  },
  "es": {
    "studio": "SALIDA DE ESTUDIO",
    "synthetic": "REPETICIÓN SINTÉTICA · EQUIPOS FICTICIOS · NO EN DIRECTO (NOT LIVE)",
    "clock": "RELOJ DEL PARTIDO",
    "moment": "MOMENTO EXPLICADO POR REGLAS",
    "context": "DERIVADO DE EVENTOS / NO PREDICTIVO",
    "disclaimer": "Nombres y eventos ficticios · Sin datos de la Premier League · Sin narración en la nube",
    "hintPress": "Pulsa",
    "hintBefore": "para alto contraste · Captura la ventana en el",
    "hintProfile": "mismo perfil del navegador",
    "hintAfter": "que la pestaña de control",
    "skip": "Ir al momento actual",
    "ariaMain": "Gráficos de un partido de fútbol ficticio",
    "ariaScore": "Marcador y reloj del partido",
    "ariaProof": "Rastro de evidencia",
    "ariaContext": "Contexto del partido derivado de eventos",
    "title": "PitchPulse — Vista sintética para emisión",
    "source": "FUENTE",
    "rule": "REGLA",
    "expires": "CADUCA",
    "shots": "tiros",
    "passes": "pases",
    "noHighlight": "No hay un momento destacado activo en este instante",
    "waiting": "Esperando un evento de partido sintético",
    "emptyExplanation": "Los gráficos basados en evidencia solo aparecen durante la ventana temporal del evento.",
    "noEvent": "SIN EVENTO ACTIVO",
    "noRule": "SIN REGLA ACTIVA",
    "archived": "MOMENTOS ARCHIVADOS OCULTOS",
    "ok": "REPETICIÓN SINTÉTICA · {count} EVENTOS ACEPTADOS · SOLO LECTURA",
    "stale": "OBSOLETO · ÚLTIMO GRÁFICO CONGELADO · NO EMITIR",
    "unavailable": "SIN CONEXIÓN A LA DEMOSTRACIÓN · SIN GRÁFICO",
    "paused": "VISTA EN PAUSA · ÚLTIMO GRÁFICO CONGELADO",
    "connecting": "CONECTANDO A LA DEMOSTRACIÓN LOCAL",
    "hintNoEvents": "Aún no hay eventos aceptados.",
    "hintOpen": "Abre PitchPulse original en este perfil del navegador y pulsa Siguiente evento."
  },
  "pt": {
    "studio": "SAÍDA DE ESTÚDIO",
    "synthetic": "REPLAY SINTÉTICO · EQUIPES FICTÍCIAS · NÃO AO VIVO (NOT LIVE)",
    "clock": "RELÓGIO DO JOGO",
    "moment": "MOMENTO EXPLICADO POR REGRAS",
    "context": "BASEADO EM EVENTOS / NÃO PREDITIVO",
    "disclaimer": "Nomes e eventos fictícios · Sem dados da Premier League · Sem narração em nuvem",
    "hintPress": "Pressione",
    "hintBefore": "para alto contraste · Capture a janela no",
    "hintProfile": "mesmo perfil do navegador",
    "hintAfter": "que a aba de controle",
    "skip": "Ir para o momento atual",
    "ariaMain": "Gráficos de uma partida de futebol fictícia",
    "ariaScore": "Placar e relógio do jogo",
    "ariaProof": "Trilha de evidências",
    "ariaContext": "Contexto da partida derivado de eventos",
    "title": "PitchPulse — Exibição sintética para transmissão",
    "source": "FONTE",
    "rule": "REGRA",
    "expires": "EXPIRA",
    "shots": "finalizações",
    "passes": "passes",
    "noHighlight": "Nenhum destaque ativo neste instante do jogo",
    "waiting": "Aguardando evento de jogo sintético",
    "emptyExplanation": "Gráficos baseados em evidências aparecem apenas na janela temporal do evento.",
    "noEvent": "SEM EVENTO ATIVO",
    "noRule": "SEM REGRA ATIVA",
    "archived": "MOMENTOS ARQUIVADOS OCULTOS",
    "ok": "REPLAY SINTÉTICO · {count} EVENTOS ACEITOS · SOMENTE LEITURA",
    "stale": "DESATUALIZADO · ÚLTIMO GRÁFICO CONGELADO · NÃO TRANSMITIR",
    "unavailable": "SEM CONEXÃO COM A DEMONSTRAÇÃO · SEM GRÁFICO",
    "paused": "PRÉVIA PAUSADA · ÚLTIMO GRÁFICO CONGELADO",
    "connecting": "CONECTANDO À DEMONSTRAÇÃO LOCAL",
    "hintNoEvents": "Ainda não há eventos aceitos.",
    "hintOpen": "Abra o PitchPulse original neste perfil do navegador e pressione Próximo evento."
  }
});
const copy=STRINGS[language];
document.title=copy.title;
const staticLabels={
 'broadcast-studio':'studio','broadcast-synthetic':'synthetic','broadcast-clock-label':'clock',
 'broadcast-moment-label':'moment','broadcast-context-label':'context','broadcast-disclaimer':'disclaimer',
 'broadcast-hint-press':'hintPress','broadcast-hint-before':'hintBefore',
 'broadcast-hint-profile':'hintProfile','broadcast-hint-after':'hintAfter',
 'broadcast-skip':'skip'
};
for(const [id,key] of Object.entries(staticLabels))byId(id).textContent=copy[key];
const ariaLabels={
 'broadcast-main':'ariaMain','broadcast-scoreboard':'ariaScore',
 'broadcast-proof':'ariaProof','broadcast-context':'ariaContext'
};
for(const [id,key] of Object.entries(ariaLabels))byId(id).setAttribute('aria-label',copy[key]);
out.status.textContent=copy.connecting;
out['moment-title'].textContent=copy.waiting;
out['moment-text'].textContent=copy.hintOpen;
out['context-metrics'].textContent=copy.hintNoEvents;
const view=new URLSearchParams({audience,favorite});
let fetching=false,lastSuccess=0,started=false;
const formatSecond=n=>Number.isSafeInteger(n)&&n>=0?`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:'--:--';
const readable=(v,max=180)=>String(v??'').slice(0,max);
function status(kind,text){
 document.body.classList.toggle('stale',kind==='stale');
 document.body.classList.toggle('unavailable',kind==='unavailable');
 out.status.textContent=text;
}
function paint(data){
 if(!Array.isArray(data.scoreboard)||!Array.isArray(data.activeOverlays)||!Number.isSafeInteger(data.clockSecond))throw new Error('Incomplete view');
 const [home,away]=data.scoreboard;
 if(!home||!away)throw new Error('Incomplete scoreboard');
 out['home-name'].textContent=readable(home.team,60);
 out['away-name'].textContent=readable(away.team,60);
 out.score.textContent=`${home.goals??'?'} — ${away.goals??'?'}`;
 out.clock.textContent=formatSecond(data.clockSecond);
 // Only display current, unexpired moments: the historical ledger belongs to the main app.
 const current=data.activeOverlays.filter(m=>Number.isSafeInteger(m.expiresAtSecond)&&m.expiresAtSecond>data.clockSecond).at(-1);
 if(current){
  // Presentation-only; never alter active source moment, proof, score or event IDs.
  const presentation=localizeMoment(current,{audience,favorite},language);
  out['moment-title'].textContent=readable(presentation.title,200);
  out['moment-text'].textContent=readable(presentation.text,420);
  out['moment-event'].textContent=copy.source+' '+readable(current.eventId,64);
  out['moment-rule'].textContent=copy.rule+' '+readable(current.proof?.rule,90);
  out['moment-expires'].textContent=copy.expires+' '+formatSecond(current.expiresAtSecond);
 }else{
  out['moment-title'].textContent=data.acceptedEvents?copy.noHighlight:copy.waiting';
  out['moment-text'].textContent=copy.emptyExplanation;
  out['moment-event'].textContent=copy.noEvent;
  out['moment-rule'].textContent=copy.noRule;
  out['moment-expires'].textContent=copy.archived;
 }
 out['context-metrics'].replaceChildren(...data.scoreboard.map(team=>{
  const item=document.createElement('span');
  item.textContent=`${readable(team.team,60)} · ${team.shots??0} ${copy.shots} · ${team.completedPasses??0}/${team.passes??0} ${copy.passes}`;
  return item;
 }));
 started=true;
 status('ok',copy.ok.replace('{count}',String(data.acceptedEvents??0)));
}
async function refresh(){
 if(fetching||document.hidden)return;
 fetching=true;
 const abort=new AbortController();
 const timeout=setTimeout(()=>abort.abort(),4500);
 try{
  const response=await fetch('/api/state?'+view.toString(),{credentials:'same-origin',cache:'no-store',signal:abort.signal});
  if(!response.ok)throw new Error('Unreachable state');
  paint(await response.json());
  lastSuccess=Date.now();
 }catch{
  status(started?'stale':'unavailable',started?copy.stale:copy.unavailable);
 }finally{clearTimeout(timeout);fetching=false;}
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)status('stale',copy.paused);
 else refresh();
});
document.addEventListener('keydown',event=>{
 if(event.key.toLowerCase()==='c'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
  document.body.classList.toggle('contrast');
 }
});
setInterval(()=>{
 if(document.hidden)return;
 if(started&&Date.now()-lastSuccess>5500)status('stale',copy.stale);
 refresh();
},1500);
refresh();