const el = id => document.getElementById(id);
const controls = ['team','audience','locale'];
let timeline = [];
let current = 0;
let timer = null;
let loaded = false;
let renderSerial = 0;
let draftSerial = 0;

function fmt(s) { return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(Math.floor(s % 60)).padStart(2,'0'); }
async function json(url, body) {
  const r = await fetch(url, body === undefined ? undefined : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const obj = await r.json();
  if (!r.ok) throw Error(obj.error || 'Request failed');
  return obj;
}
function requestBody() {return {count:current, team:el('team').value, audience:el('audience').value, locale:el('locale').value};}
function stop() {if (timer !== null) {clearInterval(timer);timer=null;el('play').textContent='Auto-play';}}
function drawTimeline() {
  const root = el('events');
  root.replaceChildren();
  timeline.slice(0,current).slice(-8).forEach((event,i,shown)=>{
    const li = document.createElement('li');
    if (shown.length - 1 === i) li.className='current';
    const at = document.createElement('b');at.textContent=fmt(event.second);
    const info = document.createElement('span');
    info.textContent=event.team + ' · ' + event.type.toUpperCase() + (event.player?' / '+event.player:'') + ' · '+event.zone;
    li.append(at,info);root.append(li);
  });
}
async function render() {
  if (!loaded) return;
  // User selection, not network completion order, determines the visible frame.
  const serial = ++renderSerial;
  ++draftSerial;
  el('foundryResult').textContent='';
  el('next').disabled = current >= timeline.length;
  el('progress').style.width=(100*current/timeline.length)+'%';
  const e = timeline[current-1];
  el('frame').textContent = e?`${current}/${timeline.length}  ·  ${fmt(e.second)}  ·  ${e.id.toUpperCase()}`:`0/${timeline.length} · Waiting for kickoff`;
  drawTimeline();
  try {
    const state = await json('/api/analyze',requestBody());
    if (serial !== renderSerial) return;
    el('attempts').textContent=String(state.stats.counterpressAttempts);
    el('successes').textContent=String(state.stats.successes);
    el('seconds').textContent=state.stats.meanRecoverySeconds===null?'—':state.stats.meanRecoverySeconds+'s';
    const rate=state.stats.successRatePct===null?'—':state.stats.successRatePct+'%';
    el('resolution').textContent=`Resolved-window success rate: ${rate} (${state.stats.successes}/${state.stats.resolvedCounterpressAttempts}); interrupted / unknown: ${state.stats.interruptedAttempts}.`;
    const eventTime = state.elapsedSeconds;
    const cue = state.overlays.filter(x=>x.showAt<=eventTime && eventTime<x.hideAt).at(-1);
    el('overlay').textContent=cue?cue.text:'No new confirmed counterpress outcome at this event.';
    el('overlay').className=cue?'':'no-overlay';
    el('evidence').textContent=cue?'EVIDENCE: '+cue.evidenceIds.join(' → ')+' · '+cue.provenance:'Cues distinguish resolved windows from interrupted observations with unknown outcomes.';
  } catch (err) {
    if (serial !== renderSerial) return;
    stop();el('overlay').textContent='Offline replay error: '+String(err.message).slice(0,80);
  }
}
async function boot(){
  const source=await json('/api/bootstrap');
  timeline=source.events;loaded=true;
  el('foundry').disabled=!source.foundryConfigured;
  el('foundry').textContent=source.foundryConfigured?'Request optional Foundry draft':'Foundry not configured';
  el('next').addEventListener('click',()=>{if(current<timeline.length){current++;render();}});
  el('reset').addEventListener('click',()=>{stop();current=0;render();});
  el('play').addEventListener('click',()=>{
    if(timer!==null){stop();return;}
    if(current===timeline.length)current=0;
    el('play').textContent='Pause';
    timer=setInterval(()=>{if(current>=timeline.length){stop();return;}current++;render();},900);
  });
  for (const c of controls) el(c).addEventListener('change',render);
  el('foundry').addEventListener('click',async()=>{
    const b=el('foundry'); b.disabled=true;b.textContent='Requesting…';
    const frameSerial = renderSerial;
    const serial = ++draftSerial;
    try {
      const d=await json('/api/foundry-draft',requestBody());
      if (serial === draftSerial && frameSerial === renderSerial) el('foundryResult').textContent=d.label+': '+d.text;
    } catch(e) {
      if (serial === draftSerial && frameSerial === renderSerial) el('foundryResult').textContent='Optional draft unavailable; canonical evidence unaffected.';
    } finally {b.disabled=false;b.textContent='Request optional Foundry draft';}
  });
  await render();
}
boot().catch(e=>{el('overlay').textContent='Fixture bootstrap failed: '+String(e.message);});
