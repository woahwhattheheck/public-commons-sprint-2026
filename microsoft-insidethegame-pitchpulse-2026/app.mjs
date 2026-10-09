const $=id=>document.getElementById(id);
let latest=null, busy=false, reviewSecond=null;
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
 if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);return body;
}
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;}
function replace(target,children){target.replaceChildren(...children);}
function render(data){
 latest=data;
 $('clock').textContent=time(data.clockSecond);
 $('score').textContent=data.scoreboard.map(x=>x.goals).join(' : ');
 $('eventCount').textContent=`${data.acceptedEvents} synthetic events · ${data.replayMode==='custom'?'custom replay':`${data.demoRemaining??'?'} remaining`}`;
 // An expired moment belongs in history, not on the live scoreboard.
 const last=data.activeOverlays.at(-1);
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
 const rows=data.overlays.slice().reverse().map(o=>{
  const row=node('article','overlay'),head=node('div','overlay-head');head.append(node('strong',null,o.title),node('span',null,time(o.second)));row.append(head,node('p',null,o.text),
   node('small',null,`RULE ${o.proof.rule} · EVENT ${o.eventId} · SOURCE ${o.proof.source}`),
   node('p','small',data.clockSecond>=o.expiresAtSecond
    ?`ARCHIVED · expired at ${time(o.expiresAtSecond)}`
    :`ACTIVE until ${time(o.expiresAtSecond)}`));
  if(data.clockSecond>=o.expiresAtSecond)row.classList.add('expired');
  return row;
 });
 replace($('overlays'),rows.length?rows:[node('p',null,'No highlights yet. Advance the stream.')]);
 syncControls();
 $('explain').title=data.foundryConfigured?'Generate an optional cloud draft':'Configure Foundry credentials and FOUNDRY_DEMO_MAX_CALLS_PER_HOUR (1–24) on the server';
}
function syncControls(){
 for(const id of ['reset','audience','favorite','exportReplay','importReplay'])$(id).disabled=busy;
 $('seek').disabled=busy||!latest||latest.lastLedgerSecond===0;
 $('live').disabled=busy||reviewSecond===null;
 $('step').disabled=busy||!latest||latest.demoRemaining===0;
 // A Foundry draft must reflect the latest ledger, not an unrelated scrub position.
 $('explain').disabled=busy||reviewSecond!==null||!latest?.foundryConfigured;
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
act('/api/state','GET');
