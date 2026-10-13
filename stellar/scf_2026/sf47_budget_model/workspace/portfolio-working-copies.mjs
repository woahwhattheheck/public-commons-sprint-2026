// MIT. Portable complete working sessions for the original SF47 Portfolio desk.
export const PORTFOLIO_SESSION_SCHEMA='stellar-forge.portfolio-working-session.v1';
export const PORTFOLIO_COPY_SCHEMA='stellar-forge.portfolio-working-copy.v1';
export const PORTFOLIO_WORKING_LIMITS=Object.freeze({fileBytes:128*1024*1024,sourceBytes:64*1024*1024,sources:2000,rows:20000});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const copy=v=>JSON.parse(JSON.stringify(v));
const fail=m=>{throw new Error(m);};
const check=(v,m)=>{if(!v)fail(m);};
const hex=/^[a-f0-9]{64}$/;
export function portfolioSignature(value){
 function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
 return stable(value);
}
function safe(value,depth=0){
 check(depth<=64,'Keep the complete Portfolio working file within its supported nesting.');
 if(Array.isArray(value)){check(value.length<=20000,'A working-copy list is too large.');value.forEach(v=>safe(v,depth+1));}
 else if(object(value))for(const [k,v] of Object.entries(value)){check(!['__proto__','constructor','prototype'].includes(k),'Use ordinary working-copy fields.');safe(v,depth+1);}
 else check(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value),'Retain complete ordinary JSON values.');
}
function keys(value,allowed,label){check(object(value),'Retain the complete '+label+'.');for(const k of Object.keys(value))check(allowed.includes(k),'Unexpected '+label+' field: '+k);}
function string(value,label,max=100000){check(typeof value==='string'&&value.length<=max,'Retain the original '+label+'.');}
function time(value,label){string(value,label,80);check(Number.isFinite(Date.parse(value))&&/T/.test(value),'Retain the original '+label+'.');}
function same(a,b){return portfolioSignature(a)===portfolioSignature(b);}
export function portfolioSourceMetadata(state){
 const found=new Map();
 function add(row){if(!object(row)||!/^source-[a-f0-9]{32}$/.test(row.id||''))return;
  check(hex.test(row.sha256||'')&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=PORTFOLIO_WORKING_LIMITS.sourceBytes,'Retain the source identity, exact size and digest.');
  const old=found.get(row.id);check(!old||old.sha256===row.sha256&&old.bytes===row.bytes,'The same original source ID has conflicting bytes.');if(!old)found.set(row.id,copy(row));
 }
 function scan(v,depth=0){if(!v||depth>60)return;if(Array.isArray(v)){v.forEach(x=>scan(x,depth+1));return;}if(object(v)){if(v.id&&v.sha256&&Object.hasOwn(v,'bytes'))add(v);for(const [k,x]of Object.entries(v))if(k!=='contentBase64')scan(x,depth+1);}}
 for(const value of [state.baseForecast,state.saved,state.preview,state.installationSource,state.installationCandidates])scan(value);
 for(const item of state.attachments||[])add(item.metadata);
 check(found.size<=PORTFOLIO_WORKING_LIMITS.sources,'Retain a supported original source collection.');return [...found.values()];
}
export function portfolioBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
export function portfolioUnbase64(value){
 check(typeof value==='string'&&value.length<=Math.ceil(PORTFOLIO_WORKING_LIMITS.sourceBytes/3)*4&&value.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(value),'Retain the complete original source encoding.');
 const text=atob(value),bytes=Uint8Array.from(text,c=>c.charCodeAt(0));check(portfolioBase64(bytes)===value,'Retain the original canonical source encoding.');return bytes;
}
export async function portfolioDigest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}

function rawProjection(s,parts,row){
 const profile=parts[0],a=profile==='base'?null:s.draft?.alternatives.find(x=>x.id===profile);
 if(!s.draft||profile!=='base'&&!a)return null;
 const p=a?{...s.draft,calendar:a.calendar??s.draft.calendar,resources:a.resources??s.draft.resources,tasks:a.tasks??s.draft.tasks,installationPlans:a.installationPlans??s.draft.installationPlans??[]}:s.draft;
 const get=name=>{const v=parts.find(x=>x.startsWith(name+':'));return v===undefined?undefined:v.slice(name.length+1);};
 const value=row.value,trim=()=>value?.trim()===''?null:value?.trim(),integer=()=>typeof value==='string'&&/^[+-]?\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
 let actual,expected,numeric=false;
 if(get('portfolioInput')!==undefined){actual=s.draft[get('portfolioInput')];expected=value;}
 else if(get('portfolioAltKey')!==undefined){if(!a)return null;actual=a[get('portfolioAltKey')];expected=value;}
 else if(get('portfolioCalendar')!==undefined){const key=get('portfolioCalendar');actual=p.calendar[key];numeric=key==='horizonDays';expected=numeric?integer():value;}
 else if(get('portfolioDates')!==undefined){actual=p.calendar[get('portfolioDates')];expected=String(value??'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean);}
 else if(get('portfolioWeekday')!==undefined){actual=p.calendar.weekdays.includes(Number(get('portfolioWeekday')));expected=row.checked;}
 else if(get('resource')!==undefined){
  const r=p.resources.find(x=>x.id===get('resource'));if(!r)return null;
  if(get('capacityDay')!==undefined){actual=r.hoursByWeekday?.[Number(get('capacityDay'))]??null;expected=trim();numeric=true;}
  else{actual=r[get('resourceKey')];expected=value;}
 }else if(get('task')!==undefined){
  const t=p.tasks.find(x=>x.id===get('task'));if(!t)return null;
  if(get('effortResource')!==undefined){if(!p.resources.some(r=>r.id===get('effortResource')))return null;actual=t.effortHours?.[get('effortResource')]??null;expected=trim();numeric=true;}
  else if(get('taskDependencies')!==undefined){actual=t.dependsOn;expected=row.values;}
  else{const key=get('taskKey');actual=t[key];numeric=['minBusinessDays','priority'].includes(key);expected=numeric?integer():['releaseDate','dueDate'].includes(key)?trim():value;}
 }else if(get('portfolioPhasePlan')!==undefined){
  const plan=(p.installationPlans||[]).find(x=>x.taskId===get('portfolioPhasePlan'));if(!plan)return null;
  if(get('phasePlanKey')!==undefined){actual=plan[get('phasePlanKey')];expected=value;}
  else{
   const phase=plan.phases.find(x=>x.phaseId===get('phaseId'));if(!phase)return null;
   if(get('phaseBoundary')!==undefined){actual=plan.deliveryPhaseIds.includes(phase.phaseId);expected=row.checked;}
   else if(get('phaseResource')!==undefined){if(!p.resources.some(r=>r.id===get('phaseResource')))return null;actual=phase.effortHours[get('phaseResource')]??null;expected=trim();numeric=true;}
   else if(get('phaseDependencies')!==undefined){check((row.values||[]).every(x=>phase.dependsOn.includes(x)),'Retain the exact selected phase predecessors.');return null;}
   else{const key=get('phaseKey');actual=phase[key];numeric=['remainingHours','minBusinessDays','priority'].includes(key);expected=['minBusinessDays','priority'].includes(key)?integer():['remainingHours','releaseDate','dueDate'].includes(key)?trim():value;}
  }
 }else if(get('portfolioInstallationChoice')!==undefined){actual=s.installationChoices[profile+'|'+get('portfolioInstallationChoice')];expected=value;if(actual===undefined)return null;}
 else return null;
 return {actual:actual??null,expected:expected??null,numeric,value,integer:parts.some(x=>/^(?:portfolioCalendar:horizonDays|taskKey:(?:priority|minBusinessDays)|phaseKey:(?:priority|minBusinessDays))$/.test(x))};
}
export function portfolioUnfinishedFields(session){
 const s=session.state,rows=[];
 for(const [key,row]of Object.entries(s.rawFields)){let parts;try{parts=JSON.parse(key);}catch{fail('Retain the original field identity.');}
  check(Array.isArray(parts)&&parts.length>1&&parts.every(x=>typeof x==='string'),'Retain complete original control identities.');
  const p=rawProjection(s,parts,row);if(!p)continue;
  check(same(p.actual,p.expected),'The retained control no longer matches its original draft: '+parts.slice(1).join(' / '));
  if(p.numeric&&String(p.value??'').trim()!==''&&!(p.integer?/^[+-]?\d+$/:/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/).test(p.value.trim()))rows.push(key);else if(p.numeric&&p.integer&&String(p.value??'').trim()!==''&&!Number.isSafeInteger(Number(p.value)))rows.push(key);
 }
 return rows;
}

export async function validatePortfolioSession(value,{caseId,originCaseId=null,validateInputs,requireComplete=false}={}){
 safe(value);keys(value,['schema','caseId','originCaseId','caseVersion','capturedAt','state'],'working session');
 check(value.schema===PORTFOLIO_SESSION_SCHEMA&&typeof caseId==='string'&&value.caseId===caseId,'Receive this working copy in its original operating case.');
 check((value.originCaseId??null)===(originCaseId??null),'Keep the original case lineage with this working copy.');
 check(Number.isSafeInteger(value.caseVersion)&&value.caseVersion>=1,'Retain the observed original case version.');time(value.capturedAt,'capture time');
 const s=value.state;keys(s,['draft','profile','resultProfile','tab','dirty','pending','lastRejected','requestNonce','sourceChoice','savedChoice','baseForecast','sourceTasks','installationCandidates','installationSource','installationChoices','preview','saved','rawFields','resourceDialogs','openDialogKey','attachments','recoveryRaw','copyName','checkpointLabel','historyChoice'],'Portfolio state');
 check(typeof validateInputs==='function','Use the original Portfolio input validator.');
 const draft=s.draft===null?null:validateInputs(s.draft);
 for(const key of ['profile','resultProfile','requestNonce','sourceChoice','savedChoice','copyName','checkpointLabel','historyChoice'])string(s[key],key,1000);
 check(['inputs','results'].includes(s.tab)&&typeof s.dirty==='boolean','Retain the selected Portfolio view.');
 check(s.profile==='base'||draft?.alternatives.some(a=>a.id===s.profile),'Retain an existing selected alternative.');
 check(s.resultProfile==='base'||draft?.alternatives.some(a=>a.id===s.resultProfile),'Retain an existing selected result alternative.');
 for(const key of ['sourceTasks','installationCandidates','attachments'])check(Array.isArray(s[key]),'Retain the complete '+key+'.');
 for(const key of ['installationChoices','rawFields','resourceDialogs'])check(object(s[key]),'Retain the complete '+key+'.');
 for(const [k,v]of Object.entries(s.installationChoices)){string(k,'installation choice key',2000);string(v,'installation choice',2000);}
 for(const [k,v]of Object.entries(s.rawFields)){string(k,'raw field identity',4000);keys(v,['value','checked','values'],'raw control');if(Object.hasOwn(v,'value'))string(v.value,'partly typed value',200000);if(Object.hasOwn(v,'checked'))check(typeof v.checked==='boolean','Retain the original check state.');if(Object.hasOwn(v,'values'))check(Array.isArray(v.values)&&v.values.every(x=>typeof x==='string'),'Retain original selected values.');}
 for(const [k,d]of Object.entries(s.resourceDialogs)){
  string(k,'resource form identity',4000);keys(d,['profile','resourceId','kind','originalDate','values'],'resource form');
  string(d.profile,'form alternative',1000);string(d.resourceId,'resource ID',1000);check(['spread','date'].includes(d.kind),'Retain the original resource form.');
  string(d.originalDate,'original capacity date',20);check(object(d.values)&&Object.keys(d.values).every(k=>['weekly','date','hours'].includes(k)),'Retain the original capacity controls.');
  for(const v of Object.values(d.values))string(v,'unfinished capacity value',10000);
 }
 check(s.openDialogKey===null||typeof s.openDialogKey==='string'&&Object.hasOwn(s.resourceDialogs,s.openDialogKey),'Retain the selected unfinished form.');
 check(s.recoveryRaw===null||typeof s.recoveryRaw==='string','Retain the exact previous recovery text.');
 for(const key of ['baseForecast','preview','saved','installationSource'])check(s[key]===null||object(s[key]),'Retain the complete '+key+'.');
 if(draft&&s.baseForecast){check(s.baseForecast.id===draft.forecastId&&s.baseForecast.sha256===draft.forecastSha256,'Keep the original saved forecast identity with this draft.');}
 for(const key of ['preview','saved'])if(s[key]){const row=s[key];check(draft&&object(row.inputs)&&same(validateInputs(row.inputs),draft),'Keep the selected '+key+' with its original complete inputs.');if(key==='saved')check(typeof row.id==='string'&&row.id===s.savedChoice,'Retain the original saved allocation selection.');}
 function pending(p,label){if(p===null)return;keys(p,['payload','createdAt','rejected','rejection'],label);time(p.createdAt,label+' creation time');check(typeof p.rejected==='boolean','Retain the original request disposition.');
  const body=p.payload;keys(body,['expectedVersion','actor','note','action','data','requestId'],'save request');check(body.action==='portfolio.save'&&Number.isSafeInteger(body.expectedVersion)&&body.expectedVersion>=1,'Retain the original Portfolio save body.');
  string(body.requestId,'original request ID',1000);check(body.requestId.length>0,'Retain the original request ID.');string(body.actor,'recording actor',300);string(body.note,'save note',12000);
  keys(body.data,['inputs','expectedPreviewSha256'],'save data');check(hex.test(body.data.expectedPreviewSha256||''),'Retain the original preview digest.');validateInputs(body.data.inputs);
  if(label==='pending save')check(draft&&same(body.data.inputs,draft),'The pending save must retain its exact original input.');
 }
 pending(s.pending,'pending save');pending(s.lastRejected,'previous rejected save');
 if(s.pending){if(s.preview)check(s.preview.previewSha256===s.pending.payload.data.expectedPreviewSha256,'Retain the original save preview.');}
 portfolioUnfinishedFields(value);
 const expected=portfolioSourceMetadata(s),seen=new Set();let total=0;
 for(const a of s.attachments){keys(a,['metadata','contentBase64'],'source attachment');const m=a.metadata;check(object(m)&&!seen.has(m.id),'Retain distinct original source attachments.');seen.add(m.id);
  const declared=expected.find(x=>x.id===m.id);check(declared&&declared.sha256===m.sha256&&declared.bytes===m.bytes,'Retain the selected original source identity.');
  if(a.contentBase64===null){check(!requireComplete,'Download the complete original bytes for '+m.filename+' before exporting.');continue;}
  const bytes=portfolioUnbase64(a.contentBase64);total+=bytes.length;check(total<=PORTFOLIO_WORKING_LIMITS.sourceBytes,'The complete source bundle exceeds the supported working-file size.');
  check(bytes.length===m.bytes&&await portfolioDigest(bytes)===m.sha256,'Original source bytes differ: '+m.filename);
 }
 if(requireComplete)check(expected.every(m=>seen.has(m.id)),'Retain every selected original source attachment in this working file.');
 return copy(value);
}
export async function completePortfolioAttachments(session,{fetchSource,validate,...options}){
 const next=copy(session),s=next.state,expected=portfolioSourceMetadata(s),old=new Map(s.attachments.map(x=>[x.metadata.id,x]));
 s.attachments=expected.map(metadata=>({metadata,contentBase64:old.get(metadata.id)?.contentBase64??null}));
 for(const item of s.attachments)if(item.contentBase64===null){
  const raw=await fetchSource(item.metadata);const bytes=raw instanceof Uint8Array?raw:new Uint8Array(raw);
  check(bytes.length===item.metadata.bytes&&await portfolioDigest(bytes)===item.metadata.sha256,'The original download differs from its retained source: '+item.metadata.filename);
  item.contentBase64=portfolioBase64(bytes);
 }
 return validate?validate(next,{requireComplete:true}):validatePortfolioSession(next,{...options,requireComplete:true});
}
