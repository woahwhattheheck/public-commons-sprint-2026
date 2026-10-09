const $=id=>document.getElementById(id);
let latest=null;
const time=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const opts=()=>new URLSearchParams({audience:$('audience').value,favorite:$('favorite').value});
async function request(path,method='GET'){
 const r=await fetch(`${path}?${opts()}`,{method});const body=await r.json();
 if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);return body;
}
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;}
function replace(target,children){target.replaceChildren(...children);}
function render(data){
 latest=data;
 $('clock').textContent=time(data.clockSecond);
 $('score').textContent=data.scoreboard.map(x=>x.goals).join(' : ');
 $('eventCount').textContent=`${data.acceptedEvents} synthetic events · ${data.demoRemaining??'?'} remaining`;
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
 $('step').disabled=data.demoRemaining===0;
 $('explain').disabled=!data.foundryConfigured;
 $('explain').title=data.foundryConfigured?'Generate an optional cloud draft':'Set FOUNDRY_ENDPOINT, FOUNDRY_DEPLOYMENT and FOUNDRY_API_KEY on the server';
}
async function act(path,method='POST'){
 try{render(await request(path,method));}catch(e){$('foundryOutput').textContent=`Demo error: ${e.message}`;}
}
$('step').addEventListener('click',()=>act('/api/next'));
$('reset').addEventListener('click',()=>{$('foundryOutput').textContent='Cloud inference not attempted.';act('/api/reset');});
for(const key of ['audience','favorite'])$(key).addEventListener('change',()=>act('/api/state','GET'));
$('explain').addEventListener('click',async()=>{
 $('foundryOutput').textContent='Requesting a model draft…';
 try {const out=await request('/api/explain','POST');$('foundryOutput').textContent=out.text+(out.warning?`\n\n${out.warning}`:'');}
 catch(e){$('foundryOutput').textContent=`No provider draft delivered: ${e.message}`;}
});
act('/api/state','GET');