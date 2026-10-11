import {localizedStory} from './locale.mjs';
const $=id=>document.getElementById(id);
let latest=null, busy=false, reviewSecond=null, matchNeedsRefresh=false;
const time=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const opts=(path,method)=>{
 const params=new URLSearchParams({audience:$('audience').value,favorite:$('favorite').value});
 if(path==='/api/state'&&method==='GET'&&reviewSecond!==null)
  params.set('asOfSecond',String(reviewSecond));
 return params;
};
async function request(path,method='GET',payload){
 const init={method,credentials:'same-origin'};
 if(payload!==undefined){init.headers={'content-type':'application/json'};init.body=JSON.stringify(payload);}
 const r=await fetch(`${path}?${opts(path,method)}`,init);const body=await r.json();
 if(!r.ok)throw Object.assign(new Error(body.error||`HTTP ${r.status}`),{status:r.status});return body;
}
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;}
function replace(target,children){target.replaceChildren(...children);}
function render(data){
 latest=data;
 matchNeedsRefresh=false;
 // Presentation-only localization; the server's event ledger and proof stay canonical.
 const story=localizedStory(data,$('language').value);
 $('clock').textContent=time(data.clockSecond);
 $('score').textContent=data.scoreboard.map(x=>x.goals).join(' : ');
 $('eventCount').textContent=`${data.acceptedEvents} synthetic events · ${data.replayMode==='custom'?'custom replay':`${data.demoRemaining??'?'} remaining`}`;
 // An expired moment belongs in history, not on the live scoreboard.
 const last=story.activeOverlays.at(-1);
 $('headline').textContent=last?.title||(data.acceptedEvents?'No active highlight at this clock':'Waiting for synthetic football events');
 $('why').textContent=last?.text||'Past moments remain in the evidence ledger below.';
 $('seek').max=String(Math.max(1,data.lastLedgerSecond));
 $('seek').value=String(Math.min(data.lastLedgerSecond,reviewSecond??data.lastLedgerSecond));
 $('reviewStatus').textContent=reviewSecond===null
  ?`LATEST · ${time(data.lastLedgerSecond)} · new events remain available`
  :`READ-ONLY REVIEW · ${time(data.clockSecond)} of ${time(data.lastLedgerSecond)} · event ledger unchanged`;
 $('rule').textContent=last?`Rule ${last.proof.rule} · Source ${last.eventId}`:'Rule: none';
 const stats=[];
 for(const s of data.scoreboard){
  const card=node('div','stat-row');card.append(node('h3',null,s.team),node('p',null,`${s.shots} shots · ${s.shotsOnTarget} on target`),node('p',null,`${s.completedPasses}/${s.passes} accurate passes (${s.passAccuracyPercent}%)`),node('p',null,`${s.tacklesWon} tackles won · ${s.highPressures} high pressures`));stats.push(card);
 }
 replace($('stats'),stats);
 const con=Object.entries(data.control).map(([team,value])=>node('p',null,`${team}: ${value.score.toFixed(1)} control points / 300s`));replace($('control'),con);
 const rows=story.overlays.slice().reverse().map(o=>{
  const row=node('article','overlay'),head=node('div','overlay-head');head.append(node('strong',null,o.title),node('span',null,time(o.second)));row.append(head,node('p',null,o.text),
   node('small',null,`RULE ${o.proof.rule} · EVENT ${o.eventId} · SOURCE ${o.proof.source}`),
   node('p','small',data.clockSecond>=o.expiresAtSecond
    ?`ARCHIVED · expired at ${time(o.expiresAtSecond)}`
    :`ACTIVE until ${time(o.expiresAtSecond)}`));
  if(data.clockSecond>=o.expiresAtSecond)row.classList.add('expired');
  return row;
 });
 replace($('overlays'),rows.length?rows:[node('p',null,'No highlights yet. Advance the stream.')]);
 updateComposerClock();
 syncControls();
 $('explain').title=data.foundryConfigured?'Generate an optional cloud draft':'Configure Foundry credentials and FOUNDRY_DEMO_MAX_CALLS_PER_HOUR (1–24) on the server';
}
function syncControls(){
 for(const id of ['reset','audience','favorite','language','exportReplay','importReplay'])$(id).disabled=busy;
 $('seek').disabled=busy||!latest||latest.lastLedgerSecond===0;
 $('live').disabled=busy||(reviewSecond===null&&!matchNeedsRefresh);
 $('step').disabled=busy||pendingEvent()||!latest||latest.demoRemaining===0;
 $('reset').disabled=busy||pendingEvent();
 $('importReplay').disabled=busy||pendingEvent();
 // A Foundry draft must reflect the latest ledger, not an unrelated scrub position.
 $('explain').disabled=busy||reviewSecond!==null||!latest?.foundryConfigured;
 syncComposer();
}
async function run(action){
 if(busy)return;
 busy=true;syncControls();
 try{await action();}catch(error){$('replayStatus').textContent=`Demo error: ${error.message}`;}
 finally{busy=false;syncControls();}
}
function act(path,method='POST'){return run(async()=>{
 if(method==='POST')reviewSecond=null;
 render(await request(path,method));
});}
$('seek').addEventListener('change',()=>run(async()=>{
 reviewSecond=Number($('seek').value);
 render(await request('/api/state'));
}));
$('live').addEventListener('click',()=>run(async()=>{
 reviewSecond=null;
 render(await request('/api/state'));
}));
$('step').addEventListener('click',()=>act('/api/next'));
$('reset').addEventListener('click',()=>run(async()=>{
 reviewSecond=null;
 render(await request('/api/reset','POST'));
 $('foundryOutput').textContent='Cloud inference not attempted.';
 $('replayStatus').textContent='Only your match was restarted.';
}));
for(const key of ['audience','favorite'])$(key).addEventListener('change',()=>act('/api/state','GET'));
$('language').addEventListener('change',()=>{
 const language=$('language').value;
 document.documentElement.lang=language==='pt'?'pt-BR':language;
 // Re-render the same accepted facts: no event mutation, HTTP request or Foundry call.
 if(latest)render(latest);
});
$('explain').addEventListener('click',()=>run(async()=>{
 $('foundryOutput').textContent='Requesting a model draft…';
 try{const out=await request('/api/explain','POST');$('foundryOutput').textContent=out.text+(out.warning?`\n\n${out.warning}`:'');}
 catch(error){$('foundryOutput').textContent=`No provider draft delivered: ${error.message}`;}
}));
$('exportReplay').addEventListener('click',()=>run(async()=>{
 const replay=await request('/api/replay');
 const url=URL.createObjectURL(new Blob([JSON.stringify(replay,null,2)+'\n'],{type:'application/json'}));
 const link=node('a');link.href=url;link.download='pitchpulse-replay.json';document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 $('replayStatus').textContent=`Exported ${replay.events.length} events. Import this file to restore the same match.`;
}));
$('importReplay').addEventListener('change',()=>{
 const file=$('importReplay').files[0];if(!file)return;
 run(async()=>{
  try{
   if(file.size>2*1024*1024)throw new Error('Replay file exceeds 2 MiB');
   const replay=JSON.parse(await file.text());
   reviewSecond=null;
   render(await request('/api/replay','POST',replay));
   $('foundryOutput').textContent='Cloud inference not attempted for imported replay.';
   $('replayStatus').textContent=`Restored ${latest.acceptedEvents} events. No model call was made.`;
  }finally{$('importReplay').value='';}
 });
});

// The composer is a client of the existing intake API, not a second match engine.
const EVENT_OUTCOMES={pass:['complete','missed'],shot:['goal','saved','wide'],
 tackle:['won','lost'],pressure:['high','low'],possession:['held']};
const DRAFT_KEY='pitchpulse-event-draft/v1';
let eventId='', eventOperation=null, eventSaved=false, tabStorage=true;
function pendingEvent(){return Boolean(eventOperation&&!eventSaved);}
function eventError(message=''){
 $('eventError').textContent=message;$('eventError').hidden=!message;
}
function eventNotice(message){
 $('eventStatus').textContent=message+(tabStorage?'':' This browser could not retain the draft for a reload; keep this tab open.');
}
function freshEventId(){return 'ui_'+Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');}
function draftValues(){return {id:eventId,second:$('eventSecond').value,team:$('eventTeam').value,
 type:$('eventType').value,outcome:$('eventOutcome').value,player:$('eventPlayer').value,
 duration:$('eventDuration').value};}
function rememberDraft(){
 try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify({draft:draftValues(),operation:eventOperation}));}
 catch{tabStorage=false;}
}
function refreshOutcome(preferred){
 const outcomes=EVENT_OUTCOMES[$('eventType').value]||EVENT_OUTCOMES.pass;
 const selected=preferred??$('eventOutcome').value;
 $('eventOutcome').replaceChildren(...outcomes.map(value=>new Option(value,value)));
 if(outcomes.includes(selected))$('eventOutcome').value=selected;
 const possession=$('eventType').value==='possession';
 if(possession&&Number($('eventDuration').value)<1)$('eventDuration').value='1';
 $('durationField').hidden=!possession;
 $('eventDuration').disabled=!possession||busy||Boolean(eventOperation);
 $('eventDuration').required=possession;
}
function normalizeDraft(source){
 if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('Event details are missing.');
 const {id,second,team,type,outcome,player,duration=0}=source;
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(id))throw new Error('Start a new draft to receive an event ID.');
 if(!Number.isInteger(second)||second<0||second>5400)throw new Error('Use a whole match second from 0 to 5400.');
 if(!['Harbor FC','Valley FC'].includes(team)||!Object.hasOwn(EVENT_OUTCOMES,type)||!EVENT_OUTCOMES[type].includes(outcome))
  throw new Error('Choose a supported team, event and outcome.');
 if(typeof player!=='string'||player.length<1||player.length>64)throw new Error('Use a fictional player label of 1–64 characters.');
 if(!Number.isInteger(duration)||(type==='possession'?duration<1||duration>60:duration!==0))
  throw new Error('Possession requires 1–60 whole seconds; other events have no duration.');
 return {id,second,team,type,outcome,player,duration};
}
function composerPayload(){
 const draft=draftValues();
 return normalizeDraft({...draft,second:Number(draft.second),duration:draft.type==='possession'?Number(draft.duration):0});
}
function sameEvent(a,b){
 try{const left=normalizeDraft(a),right=normalizeDraft(b);return Object.keys(left).every(key=>left[key]===right[key]);}
 catch{return false;}
}
function updateComposerClock(){
 const minimum=latest?.lastLedgerSecond??0;
 $('eventSecond').min=String(minimum);
 if(eventSaved&&latest?.view.clockMode==='latest'&&!latest.provenance.acceptedEventIds.includes(eventId)){
  eventOperation=null;eventSaved=false;$('eventForm').dataset.state='draft';
  eventNotice('The current ledger no longer contains this event. Its draft is retained; add it explicitly to this match if wanted.');
  rememberDraft();
 }
 const second=Number($('eventSecond').value),type=$('eventType').value;
 $('eventId').textContent=eventId;
 $('eventPreview').textContent=`${$('eventTeam').value} · ${type} / ${$('eventOutcome').value} · ${Number.isInteger(second)&&second>=0&&second<=5400?time(second):'choose a clock'}${type==='possession'?` · ${$('eventDuration').value}s possession`:''}. Latest ledger clock: ${time(minimum)}. Adding a new event switches this ledger to custom replay.`;
}
function syncComposer(){
 const locked=busy||Boolean(eventOperation);
 $('eventFields').disabled=locked;
 $('addEvent').disabled=busy||!latest||Boolean(eventOperation);
 $('newEvent').disabled=busy||pendingEvent();
 $('reconcileEvent').hidden=!pendingEvent();$('retryEvent').hidden=!pendingEvent();
 $('reconcileEvent').disabled=busy;$('retryEvent').disabled=busy;
 $('eventDuration').disabled=locked||$('eventType').value!=='possession';
}
function startEvent(){
 eventId=freshEventId();eventOperation=null;eventSaved=false;
 $('eventSecond').value=String(latest?.lastLedgerSecond??0);
 $('eventForm').dataset.state='draft';eventError();
 refreshOutcome();updateComposerClock();rememberDraft();syncComposer();
 eventNotice('Draft ready. Add it explicitly when the fictional event details are complete.');
}
function restoreComposer(){
 let stored=null;
 try{const raw=sessionStorage.getItem(DRAFT_KEY);if(raw&&raw.length<=4096)stored=JSON.parse(raw);}
 catch{tabStorage=false;}
 const draft=stored?.draft;
 if(draft&&typeof draft.id==='string'&&/^[A-Za-z0-9_-]{1,48}$/.test(draft.id)&&
  ['second','team','type','outcome','player','duration'].every(key=>typeof draft[key]==='string')&&
  Object.hasOwn(EVENT_OUTCOMES,draft.type)&&['Harbor FC','Valley FC'].includes(draft.team)&&draft.player.length<=64){
  eventId=draft.id;
  for(const [key,id] of [['second','eventSecond'],['team','eventTeam'],['type','eventType'],['player','eventPlayer'],['duration','eventDuration']])$(id).value=draft[key];
  refreshOutcome(draft.outcome);
  try{if(stored.operation){eventOperation=normalizeDraft(stored.operation);eventId=eventOperation.id;
   // Restore the exact submitted fields, even if a stored editable draft differs.
   for(const [key,id] of [['second','eventSecond'],['team','eventTeam'],['type','eventType'],['player','eventPlayer'],['duration','eventDuration']])$(id).value=String(eventOperation[key]);
   refreshOutcome(eventOperation.outcome);
  }}catch{eventOperation=null;}
  $('eventForm').dataset.state=eventOperation?'uncertain':'draft';
  eventNotice(eventOperation?'Restored an event reference. Checking this match is read-only; no event is resent.':'Restored this tab’s unfinished event draft.');
 }else startEvent();
 updateComposerClock();syncComposer();
}
function finishEvent(snapshot,message){
 eventSaved=true;$('eventForm').dataset.state='saved';eventError();
 if(snapshot){reviewSecond=null;render(snapshot);}
 $('foundryOutput').textContent='Match events changed. No cloud narration was requested for this event.';
 eventNotice(message);rememberDraft();syncControls();
}
async function reconcileEvent(){
 if(!pendingEvent())return;
 const expected={...eventOperation};
 eventError();eventNotice('Checking the current replay for this exact event ID…');
 try{
  const replay=await request('/api/replay');
  const observed=replay.events.find(event=>event.id===expected.id);
  if(observed&&sameEvent(observed,expected)){
   let snapshot=null;
   try{reviewSecond=null;snapshot=await request('/api/state');}
   catch{matchNeedsRefresh=true;}
   if(snapshot&&!snapshot.provenance.acceptedEventIds.includes(expected.id)){
    eventOperation=null;eventSaved=false;render(snapshot);$('eventForm').dataset.state='draft';
    eventNotice('The match changed during the read. This event is absent from the latest ledger; its draft is retained for an explicit action.');
    rememberDraft();return;
   }
   finishEvent(snapshot,`Saved event ${expected.id} confirmed in this replay. No event was resent.${snapshot?'':' Use Return to latest to refresh the match view.'}`);
  }else if(observed){
   eventOperation=null;eventSaved=false;$('eventForm').dataset.state='error';
   eventError('That ID exists with different details. Start a new draft; the existing event was not changed.');
   eventNotice('Event reference conflict. Your entered details are retained.');rememberDraft();
  }else{
   $('eventForm').dataset.state='uncertain';
   eventNotice('This event is not currently in the replay. You may check again or explicitly retry the exact same event. No new ID will be generated.');
  }
 }catch(failure){
  $('eventForm').dataset.state='uncertain';
  eventError(`Could not read this replay: ${failure.message}`);
  eventNotice('The exact event is retained. Check again or explicitly retry the same event when the server is available.');
 }
 syncControls();
}
async function submitEvent(payload){
 eventOperation={...payload};eventSaved=false;rememberDraft();
 $('eventForm').dataset.state='saving';eventError();eventNotice(`Saving fictional event ${payload.id}…`);syncControls();
 try{
  const data=await request('/api/events','POST',payload);
  if(!sameEvent(data.result?.event,payload))throw new Error('The response did not confirm the submitted event.');
  finishEvent(data,`${data.result.duplicate?'Confirmed existing':'Added fictional'} event ${payload.id} at ${time(payload.second)}. ${data.result.duplicate?'No second copy was added.':'Built-in stepping is now disabled for this custom replay.'} Export replay JSON to keep the match.`);
 }catch(failure){
  if(failure.status>=400&&failure.status<500&&![408,429].includes(failure.status)){
   eventOperation=null;$('eventForm').dataset.state='error';eventError(failure.message);
   eventNotice('The server rejected the event. Your details and ID are retained for correction.');rememberDraft();
  }else{
   $('eventForm').dataset.state='uncertain';
   eventNotice('The save outcome is uncertain. Reading the replay before another action…');
   await reconcileEvent(); // Read-only recovery; never automatically POST again.
  }
 }
}
$('eventType').addEventListener('change',()=>{refreshOutcome();updateComposerClock();rememberDraft();});
$('eventForm').addEventListener('input',()=>{eventError();updateComposerClock();rememberDraft();});
$('eventForm').addEventListener('change',()=>{updateComposerClock();rememberDraft();});
$('eventForm').addEventListener('submit',event=>{
 event.preventDefault();
 if(busy||eventOperation||!latest)return;
 if(!$('eventForm').reportValidity())return;
 let payload;
 try{payload=composerPayload();if(payload.second<latest.lastLedgerSecond)throw new Error('Choose a clock at or after the latest ledger event.');}
 catch(failure){eventError(failure.message);return;}
 run(()=>submitEvent(payload));
});
$('newEvent').addEventListener('click',()=>{if(!busy&&!pendingEvent()){startEvent();$('eventSecond').focus();}});
$('reconcileEvent').addEventListener('click',()=>run(reconcileEvent));
$('retryEvent').addEventListener('click',()=>{if(pendingEvent())run(()=>submitEvent({...eventOperation}));});
restoreComposer();
run(async()=>{
 render(await request('/api/state'));
 if(pendingEvent())await reconcileEvent();
});
