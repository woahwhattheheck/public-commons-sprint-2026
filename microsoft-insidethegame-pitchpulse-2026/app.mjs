const $=id=>document.getElementById(id);
let latest=null, busy=false;
const time=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const opts=()=>new URLSearchParams({audience:$('audience').value,favorite:$('favorite').value});
async function request(path,method='GET',payload){
 const init={method,credentials:'same-origin'};
 if(payload!==undefined){init.headers={'content-type':'application/json'};init.body=JSON.stringify(payload);}
 const r=await fetch(`${path}?${opts()}`,init);const body=await r.json();
 if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);return body;
}
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;}
function replace(target,children){target.replaceChildren(...children);}
function render(data){
 latest=data;
 $('clock').textContent=time(data.clockSecond);
 $('score').textContent=data.scoreboard.map(x=>x.goals).join(' : ');
 $('eventCount').textContent=`${data.acceptedEvents} synthetic events · ${data.replayMode==='custom'?'custom replay':`${data.demoRemaining??'?'} remaining`}`;
 const last=data.overlays.at(-1);
 $('headline').textContent=last?.title||data.headline;
 $('why').textContent=last?.text||'Advance the match to unlock traceable events.';
 $('rule').textContent=last?`Rule ${last.proof.rule} · Source ${last.eventId}`:'Rule: none';
 const stats=[];
 for(const s of data.scoreboard){
  const card=node('div','stat-row');card.append(node('h3',null,s.team),node('p',null,`${s.shots} shots · ${s.shotsOnTarget} on target`),node('p',null,`${s.completedPasses}/${s.passes} accurate passes (${s.passAccuracyPercent}%)`),node('p',null,`${s.tacklesWon} tackles won · ${s.highPressures} high pressures`));stats.push(card);
 }
 replace($('stats'),stats);
 const con=Object.entries(data.control).map(([team,value])=>node('p',null,`${team}: ${value.score.toFixed(1)} control points / 300s`));replace($('control'),con);
 const rows=data.overlays.slice().reverse().map(o=>{
  const row=node('article','overlay'),head=node('div','overlay-head');head.append(node('strong',null,o.title),node('span',null,time(o.second)));row.append(head,node('p',null,o.text),node('small',null,`RULE ${o.proof.rule} · EVENT ${o.eventId} · SOURCE ${o.proof.source}`));return row;
 });
 replace($('overlays'),rows.length?rows:[node('p',null,'No highlights yet. Advance the stream.')]);
 syncControls();
 $('explain').title=data.foundryConfigured?'Generate an optional cloud draft':'Configure Foundry credentials and FOUNDRY_DEMO_MAX_CALLS_PER_HOUR (1–24) on the server';
}
function syncControls(){
 for(const id of ['reset','audience','favorite','exportReplay','importReplay'])$(id).disabled=busy;
 $('step').disabled=busy||!latest||latest.demoRemaining===0;
 $('explain').disabled=busy||!latest?.foundryConfigured;
}
async function run(action){
 if(busy)return;
 busy=true;syncControls();
 try{await action();}catch(error){$('replayStatus').textContent=`Demo error: ${error.message}`;}
 finally{busy=false;syncControls();}
}
function act(path,method='POST'){return run(async()=>render(await request(path,method)));}
$('step').addEventListener('click',()=>act('/api/next'));
$('reset').addEventListener('click',()=>run(async()=>{
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
   if(file.size>1024*1024)throw new Error('Replay file exceeds 1 MiB');
   const replay=JSON.parse(await file.text());
   render(await request('/api/replay','POST',replay));
   $('foundryOutput').textContent='Cloud inference not attempted for imported replay.';
   $('replayStatus').textContent=`Restored ${latest.acceptedEvents} events. No model call was made.`;
  }finally{$('importReplay').value='';}
 });
});
act('/api/state','GET');
