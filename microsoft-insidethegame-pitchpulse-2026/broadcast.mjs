const byId=id=>document.getElementById(id);
const fields=['home-name','away-name','clock','score','moment-title','moment-text','moment-event','moment-rule','moment-expires','context-metrics','status'];
const out=Object.fromEntries(fields.map(id=>[id,byId(id)]));
const input=new URLSearchParams(location.search);
const audience=['analyst','fan'].includes(input.get('audience'))?input.get('audience'):'analyst';
const favorite=['Harbor FC','Valley FC'].includes(input.get('favorite'))?input.get('favorite'):'Harbor FC';
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
  out['moment-title'].textContent=readable(current.title,200);
  out['moment-text'].textContent=readable(current.text,420);
  out['moment-event'].textContent='SOURCE '+readable(current.eventId,64);
  out['moment-rule'].textContent='RULE '+readable(current.proof?.rule,90);
  out['moment-expires'].textContent='EXPIRES '+formatSecond(current.expiresAtSecond);
 }else{
  out['moment-title'].textContent=data.acceptedEvents?'No active highlight at this match clock':'Waiting for a synthetic match event';
  out['moment-text'].textContent='Evidence-backed graphics appear here only within their event-time window.';
  out['moment-event'].textContent='NO ACTIVE EVENT';
  out['moment-rule'].textContent='NO ACTIVE RULE';
  out['moment-expires'].textContent='ARCHIVED MOMENTS HIDDEN';
 }
 out['context-metrics'].replaceChildren(...data.scoreboard.map(team=>{
  const item=document.createElement('span');
  item.textContent=`${readable(team.team,60)} · ${team.shots??0} shots · ${team.completedPasses??0}/${team.passes??0} passes`;
  return item;
 }));
 started=true;
 status('ok',`SYNTHETIC REPLAY · ${data.acceptedEvents??0} EVENTS ACCEPTED · READ-ONLY VIEW`);
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
  status(started?'stale':'unavailable',started?'STALE · LAST GRAPHIC FROZEN · DO NOT AIR':'NO DEMO CONNECTION · NO GRAPHIC AVAILABLE');
 }finally{clearTimeout(timeout);fetching=false;}
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)status('stale','PREVIEW PAUSED · LAST GRAPHIC FROZEN');
 else refresh();
});
document.addEventListener('keydown',event=>{
 if(event.key.toLowerCase()==='c'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
  document.body.classList.toggle('contrast');
 }
});
setInterval(()=>{
 if(document.hidden)return;
 if(started&&Date.now()-lastSuccess>5500)status('stale','STALE · LAST GRAPHIC FROZEN · DO NOT AIR');
 refresh();
},1500);
refresh();
