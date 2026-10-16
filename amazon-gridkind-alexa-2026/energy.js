const $=id=>document.getElementById(id),clone=v=>JSON.parse(JSON.stringify(v));
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const stamp=v=>JSON.stringify(stable(v)),uuid=()=>crypto.randomUUID();
const SCHEMA='gridkind-energy-working/v1',LIMIT=32*1024*1024;
let state=null,work=null,busy=false,tick=0,db=null,queue=Promise.resolve(),persisted=new Map(),explicit=new Map(),proof=null,sourcePreview=null,reviewPreview=null,opened=null;
const pages={source:{kind:'energy-source',offset:0},week:{kind:'week',offset:0},review:{kind:'energy-review',offset:0}};
const sourceIds=['title','role','unit','timezone','source-url','note','map-start','map-end','map-energy','meter-kind','meter-description','load-ids'];
const reviewIds=['source-select','week-select','review-title','review-note'];
function blank(home){return {schema:SCHEMA,id:uuid(),revision:0,householdId:home,updatedAt:new Date().toISOString(),source:{filename:'',csv:'',headers:[],fields:Object.fromEntries(sourceIds.map(k=>[k,k==='role'?'user_supplied':k==='meter-kind'?'household':'']))},review:{'source-select':'','week-select':'','review-title':'','review-note':''},pending:null,history:[]};}
function notice(s){$('status').textContent=s;}function error(e){$('error').textContent=e?.message||String(e);}
function bodyText(w){return JSON.stringify(w,null,2)+'\n';}
function validate(w){
 if(!w||w.schema!==SCHEMA||typeof w.id!=='string'||!Number.isSafeInteger(w.revision)||w.revision<0||typeof w.householdId!=='string'||!w.source||!Array.isArray(w.source.headers)||!w.source.headers.every(h=>typeof h==='string')||typeof w.source.csv!=='string'||typeof w.source.filename!=='string'||!Array.isArray(w.history)||!w.review)throw Error('This complete working file has an invalid structure.');
 if(!sourceIds.every(k=>typeof w.source.fields?.[k]==='string')||!reviewIds.every(k=>typeof w.review[k]==='string'))throw Error('Working file is missing literal source or selection fields.');
 if(w.source.csv.length>1048576||new TextEncoder().encode(bodyText(w)).length>LIMIT)throw Error('Working file exceeds its complete-file limit.');
 if(w.pending){const p=w.pending;if(!p.body||!['save-source','save-review'].includes(p.body.action)||typeof p.body.requestId!=='string'||p.body.context?.householdId!==w.householdId||!/^[a-f0-9]{64}$/.test(p.intentSha256)||!Array.isArray(p.attempts))throw Error('Invalid original pending request.');}
 return w;
}
async function hash(v){const bytes=new TextEncoder().encode(stamp(v));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function intent(b){return b.action==='save-source'?{action:b.action,source:b.source,previewSha256:b.previewSha256}:{action:b.action,sourceId:b.sourceId,weekId:b.weekId,title:b.title,note:b.note??'',previewSha256:b.previewSha256};}
async function database(){if(db)return db;db=await new Promise((resolve,reject)=>{const q=indexedDB.open('gridkind-energy-working-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('copies',{keyPath:'id'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});return db;}
async function readCopy(id){const d=await database();return new Promise((resolve,reject)=>{const q=d.transaction('copies','readonly').objectStore('copies').get(id);q.onsuccess=()=>resolve(q.result??null);q.onerror=()=>reject(q.error);});}
function persist(w){
 const snap=clone(validate(w));const promise=queue.catch(()=>{}).then(async()=>{
  const d=await database(),expected=persisted.get(snap.id)??0,candidate={...snap,revision:expected+1};
  await new Promise((resolve,reject)=>{const tx=d.transaction('copies','readwrite'),s=tx.objectStore('copies'),q=s.get(snap.id);let failure;
   q.onsuccess=()=>{const current=q.result;if((current?.revision??0)!==expected){failure=Error('Another page saved this copy. Download current work, then open a retained copy explicitly.');tx.abort();return;}s.put(candidate);};
   tx.oncomplete=resolve;tx.onerror=()=>reject(failure??tx.error);tx.onabort=()=>reject(failure??tx.error??Error('Browser storage refused this save.'));
  });
  persisted.set(snap.id,candidate.revision);if(work?.id===snap.id)work.revision=candidate.revision;return candidate;
 });queue=promise;return promise;
}
function download(name,text,type='application/json'){const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
function saveWorking(){capture();const raw=bodyText(work);validate(work);download('GridKind_Energy_Working_'+work.id+'.json',raw);explicit.set(work.id,raw);notice('Complete current working file downloaded. Keep it with the original source.');}
async function durable(w=work){
 try{return await persist(w);}catch(e){if(explicit.get(w.id)===bodyText(w))return w;throw Error(e.message+' Download the complete current working file, then retry this same action. No new request was sent.');}
}
function retained(){if(work)persist(work).catch(e=>{notice('Current work remains in this page. Download its complete working file; browser retention failed.');error(e);});}
async function keepPrevious(){capture();await durable();}
function ctx(){return {householdId:state.workspace.selectedId,revision:state.workspace.revision,generation:state.workspace.generation};}
function scope(){if(work.householdId!==state.workspace.selectedId)throw Error('This copy belongs to another household. Open that household in the planner, or preserve this copy and start a new one.');}
function current(id,sequence){return work?.id===id&&tick===sequence;}
function capture(){if(!work)return;let edited=false;for(const k of sourceIds){const v=$(k).value;if(work.source.fields[k]!==v){work.source.fields[k]=v;edited=true;}}for(const k of reviewIds){const v=$(k).value;if(work.review[k]!==v){work.review[k]=v;edited=true;}}if(edited)work.updatedAt=new Date().toISOString();}
function changed(){capture();tick++;sourcePreview=null;reviewPreview=null;proof=null;$('source-preview').replaceChildren();$('review-preview').replaceChildren();retained();lock();}
function element(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;}
function table(out,titles,rows){const wrap=element('div');wrap.className='scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Scrollable measured-energy table');const t=element('table'),tr=element('tr'),head=element('thead');if(titles.length>3)t.className='wide';for(const v of titles){const th=element('th',v);th.scope='col';tr.append(th);}head.append(tr);t.append(head);const b=element('tbody');for(const a of rows){const row=element('tr');for(const v of a)row.append(element('td',v===null||v===undefined?'Not available':v));b.append(row);}t.append(b);wrap.append(t);out.append(wrap);}
function sourceView(out,e,offset=0){out.replaceChildren(element('h3',e.source.title),element('p',e.summary.rows+' records · '+e.summary.usableRows+' usable · '+e.summary.overlapRows+' overlapping · '+e.summary.invalidRows+' excluded'),element('p',e.interpretation),element('p','Original SHA-256 '+e.source.sha256));
 const rows=e.rows.slice(offset,offset+100);table(out,['Record / line','Start','End','Original energy','kWh','Issues'],rows.map(r=>[r.sourceRow+' / '+r.sourceLine,r.tokens.start,r.tokens.end,r.tokens.energy,r.exactKwh,r.issues.join('; ')||'Valid']));
 const nav=element('div');nav.className='controls';for(const [label,n,disabled]of [['Previous rows',offset-100,offset===0],['Next rows',offset+100,offset+100>=e.rows.length]]){const b=element('button',label);b.type='button';b.disabled=disabled;b.onclick=()=>sourceView(out,e,n);nav.append(b);}nav.append(element('span',(offset+1)+'–'+(offset+rows.length)+' of '+e.rows.length));out.append(nav);
}
function reviewView(out,r){out.replaceChildren(element('h3',r.title));for(const s of Object.values(r.interpretation)){const p=element('p',s);p.className='notice';out.append(p);}table(out,['Measure','Value'],Object.entries(r.totals));table(out,['Local hour','Coverage','Original rows','Observed kWh','Energy-only USD','Modeled optimized kWh','Signed difference kWh'],r.rows.map(x=>[x.date+' '+String(x.hour).padStart(2,'0')+':00',x.status,x.sourceRows.join(', '),x.observedKwh,x.observedCostUsd,x.modeledOptimizedKwh,x.differenceFromOptimizedKwh]));}
function lock(){
 const blocked=busy||!state||!work||!!work?.pending||work?.householdId!==state?.workspace?.selectedId;
 $('source-fields').disabled=blocked;$('review-fields').disabled=blocked;
 document.querySelectorAll('[data-mutation]').forEach(b=>b.disabled=blocked);
 $('save-source').disabled=blocked||!sourcePreview;$('save-review').disabled=blocked||!reviewPreview;
 for(const k of ['reload','open-working','open-copy','refresh-copies'])$(k).disabled=busy;
 $('download-working').disabled=!work;
 $('pending').hidden=!work?.pending;$('resume').disabled=busy||!work?.pending;
 $('release').hidden=!proof;$('release').disabled=busy||!proof;
 if(work?.pending)$('pending-text').textContent=work.pending.body.action+' · '+work.pending.body.requestId+' · '+(proof?'A current-page terminal rejection was observed. Reconciliation still precedes correction.':'Keep this exact request while its outcome is reconciled.');
 if(work)$('working-label').textContent='Working copy '+work.id+' · retained revision '+work.revision;
 for(const n of ['source','week','review']){const p=pages[n];$(n+'-prev').disabled=blocked||!p.offset;$(n+'-next').disabled=blocked||!p.hasMore;}
}
async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);let result;try{result=await response.json();}catch{throw Error('The server response is unreadable. Keep the original pending request.');}if(!response.ok){const e=Error(result.error||'Request failed');e.status=response.status;e.result=result;throw e;}return result;}
function adoptState(next){if(state&&stamp(ctx())!==stamp({householdId:next.workspace.selectedId,revision:next.workspace.revision,generation:next.workspace.generation})){sourcePreview=null;reviewPreview=null;}state=next;$('household').textContent=next.workspace.selectedName+' · revision '+next.workspace.revision;lock();}
async function run(fn){if(busy)return;busy=true;$('error').textContent='';lock();try{await fn();}catch(e){error(e);}finally{busy=false;lock();}}
function render(){
 for(const k of ['start','end','energy']){const sel=$('map-'+k);sel.replaceChildren(new Option('Choose exact header',''));for(const h of work.source.headers)sel.add(new Option(h,h));}
 for(const k of sourceIds)$(k).value=work.source.fields[k];
 for(const k of reviewIds)if(!k.endsWith('-select'))$(k).value=work.review[k];
 $('filename').textContent=work.source.filename||'No original CSV selected';
 $('source-preview').replaceChildren();$('review-preview').replaceChildren();$('plan-view').replaceChildren();$('saved-view').replaceChildren();$('downloads').replaceChildren();sourcePreview=null;reviewPreview=null;opened=null;lock();
}
async function catalogue(name,offset=pages[name].offset,selectId=work.review[name+'-select']){
 const home=state.workspace.selectedId,id=work.id,sequence=tick;
 const p=await api('/api/energy?householdId='+encodeURIComponent(home)+'&kind='+pages[name].kind+'&offset='+offset);
 if(!current(id,sequence)||home!==state.workspace.selectedId)return;
 pages[name]={...pages[name],...p};const select=$(name+'-select');select.replaceChildren(new Option('Choose saved '+name,''));
 for(const r of p.records)select.add(new Option('#'+r.sequence+' · '+r.label,r.id));
 if(selectId&&!p.records.some(r=>r.id===selectId))select.add(new Option('Retained selection · '+selectId,selectId));
 select.value=selectId||'';$(name+'-page').textContent=p.total?(p.offset+1)+'–'+(p.offset+p.records.length)+' of '+p.total:'No saved records';lock();
}
async function catalogues(){for(const n of ['source','week','review'])await catalogue(n);}
async function readRecord(id){scope();return api('/api/workspace/record?householdId='+encodeURIComponent(work.householdId)+'&id='+encodeURIComponent(id));}
function links(record){
 opened=record;const out=$('downloads');out.replaceChildren();out.className='download-links';
 const formats=[['source','Original CSV'],['rows','All original row references'],['json','Complete source and saved record'],['html','Readable HTML report']];if(record.kind==='energy-review')formats.push(['csv','All review hours']);
 for(const [format,label]of formats){const a=element('a',label);a.href='/api/energy/export?householdId='+encodeURIComponent(work.householdId)+'&recordId='+encodeURIComponent(record.id)+'&format='+format;a.download='';out.append(a);}
 const a=element('a','Complete household with all sources');a.href='/api/workspace/export?householdId='+encodeURIComponent(work.householdId);a.download='';out.append(a);
}
function sourceFields(){
 capture();const f=work.source.fields;return {filename:work.source.filename,title:f.title.trim(),sourceUrl:f['source-url'],note:f.note,role:f.role,unit:f.unit,timezone:f.timezone.trim(),meter:{kind:f['meter-kind'],description:f['meter-description'].trim(),loadIds:f['load-ids'].split(/\r?\n/).map(x=>x.trim()).filter(Boolean)},mapping:{start:f['map-start'],end:f['map-end'],energy:f['map-energy']},csv:work.source.csv};
}
function reviewFields(){capture();return {sourceId:work.review['source-select'],weekId:work.review['week-select'],title:work.review['review-title'].trim(),note:work.review['review-note']};}
async function complete(result,p){
 if(result.record?.detail?.requestId!==p.body.requestId||result.record.detail.requestSha256!==p.intentSha256||result.householdId!==p.body.context.householdId)throw Error('Returned outcome does not match the retained original request.');
 work.history.push({body:clone(p.body),intentSha256:p.intentSha256,attempts:clone(p.attempts),result:clone(result),receivedAt:new Date().toISOString()});work.pending=null;proof=null;
 if(result.state)adoptState(result.state);
 if(result.record.kind==='energy-source'){work.review['source-select']=result.record.id;work.review['review-title']=(result.record.label+' review').slice(0,100);}
 links(result.record);if(result.record.kind==='energy-source')sourceView($('saved-view'),result.record.detail.edition);else reviewView($('saved-view'),result.record.detail.review);
 await durable();await catalogues();notice('Saved exact '+result.record.kind+' #'+result.record.sequence+'. Complete files are available below.');
}
async function execute(){
 const p=work.pending;if(!p)return;const id=work.id,sequence=tick;
 if(await hash(intent(p.body))!==p.intentSha256)throw Error('Pending request content changed.');
 proof=null;let attempt=p.attempts.at(-1);if(!attempt||attempt.state!=='uncertain'){attempt={id:uuid(),at:new Date().toISOString(),state:'uncertain'};p.attempts.push(attempt);work.updatedAt=attempt.at;}await durable();if(!current(id,sequence)||work.pending!==p)return;
 const found=await api('/api/energy/outcome?householdId='+encodeURIComponent(p.body.context.householdId)+'&requestId='+p.body.requestId);
 if(!current(id,sequence)||work.pending!==p)return;
 if(found.record){await complete({...found,state:await api('/api/state'),replayed:true},p);return;}
 try{
  const result=await api('/api/energy',p.body);if(!current(id,sequence)||work.pending!==p){download('GridKind_Energy_Detached_Outcome_'+p.body.requestId+'.json',bodyText({request:p,result}));return;}
  attempt.state='accepted';await complete(result,p);
 }catch(e){
  if(!current(id,sequence)||work.pending!==p)throw e;
  attempt.error={message:e.message,status:e.status??null,result:e.result??null};
  const o=e.result?.energyOutcome;
  if([400,409,413].includes(e.status)&&o?.status==='not_committed'&&o.householdId===p.body.context.householdId&&o.requestId===p.body.requestId&&o.requestSha256===p.intentSha256){attempt.state='rejected';proof={requestId:p.body.requestId,attemptId:attempt.id};}
  await durable().catch(error);throw e;
 }
}
async function prepare(action){
 scope();if(work.pending)throw Error('Reconcile the original pending request first.');
 const body=action==='save-source'?{action,source:clone(sourcePreview.source),previewSha256:sourcePreview.sha256}:{action,...reviewFields(),previewSha256:reviewPreview.sha256};
 if(action==='save-source'){delete body.source.bytes;delete body.source.sha256;}
 body.context=ctx();body.requestId=uuid();const id=work.id,sequence=tick,sha=await hash(intent(body));if(!current(id,sequence))throw Error('Working selection changed before hashing.');
 work.pending={body,intentSha256:sha,attempts:[]};await execute();
}
async function release(){
 const p=work.pending,observed=proof;if(!p||!observed||observed.requestId!==p.body.requestId||observed.attemptId!==p.attempts.at(-1)?.id)throw Error('Only a current-page terminal rejection can open a corrected copy.');
 const id=work.id,sequence=tick,found=await api('/api/energy/outcome?householdId='+encodeURIComponent(p.body.context.householdId)+'&requestId='+p.body.requestId);
 if(!current(id,sequence)||proof!==observed||work.pending!==p)return;
 if(found.record){await complete({...found,state:await api('/api/state'),replayed:true},p);return;}
 await durable();const prior=clone(work);work=clone(prior);work.id=uuid();work.revision=0;work.history.push({rejectedRequest:clone(p),previousCopy:prior.id});work.pending=null;proof=null;tick++;await durable();adoptState(await api('/api/state'));render();await catalogues();notice('Original rejected request retained in its earlier copy. Preview the corrected fields before saving.');
}
async function adoptCopy(candidate){
 validate(candidate);await keepPrevious();const previous=work.id;work=clone(candidate);work.id=uuid();work.revision=0;work.history.push({openedFrom:candidate.id,previousCopy:previous,at:new Date().toISOString()});proof=null;tick++;await durable();sessionStorage.setItem('gridkind-energy-copy',work.id);render();await catalogues();
}
async function listCopies(){const d=await database(),all=await new Promise((resolve,reject)=>{const q=d.transaction('copies','readonly').objectStore('copies').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});$('copies').replaceChildren(new Option('Choose retained copy',''));for(const w of all.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)))$('copies').add(new Option(w.source?.fields?.title+' · '+w.id,w.id));}
for(const k of sourceIds)$(k).addEventListener('input',changed);
for(const k of reviewIds)$(k).addEventListener('input',()=>{capture();tick++;reviewPreview=null;proof=null;$('review-preview').replaceChildren();retained();lock();});
$('download-working').onclick=()=>{try{saveWorking();}catch(e){error(e);}};
$('refresh-copies').onclick=()=>run(listCopies);
$('open-copy').onclick=()=>run(async()=>{const candidate=await readCopy($('copies').value);if(!candidate)throw Error('Selected copy is unavailable.');await adoptCopy(candidate);});
$('open-working').onchange=()=>run(async()=>{const file=$('open-working').files[0];if(!file)return;if(file.size>LIMIT)throw Error('Working file exceeds 32 MiB.');const id=work.id,sequence=tick,raw=await file.text(),candidate=validate(JSON.parse(raw));if(!current(id,sequence))throw Error('Current work changed during file reading.');await adoptCopy(candidate);});
$('csv-file').onchange=()=>run(async()=>{
 const file=$('csv-file').files[0];if(!file)return;if(file.size>1048576)throw Error('Original CSV exceeds 1 MiB.');
 const id=work.id,sequence=tick,bytes=await file.arrayBuffer(),csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 if(!current(id,sequence))throw Error('Working copy changed during source reading.');
 const parsed=await api('/api/energy',{action:'headers',csv,context:ctx()});if(!current(id,sequence))throw Error('Selection changed during source inspection.');
 await keepPrevious();const previous=work.id;work=clone(work);work.id=uuid();work.revision=0;work.history.push({sourceReplacedFrom:previous,at:new Date().toISOString()});work.source.filename=file.name;work.source.csv=csv;work.source.headers=parsed.headers;work.source.fields.title=file.name.slice(0,100);
 for(const k of ['start','end','energy'])work.source.fields['map-'+k]=parsed.headers.find(h=>h.toLowerCase()===k)??'';
 tick++;proof=null;await durable();sessionStorage.setItem('gridkind-energy-copy',work.id);render();await catalogues();notice('Original UTF-8 CSV retained; choose exact fields and meter boundary.');
});
$('preview-source').onclick=()=>run(async()=>{scope();const id=work.id,sequence=tick,r=await api('/api/energy',{action:'preview-source',source:sourceFields(),context:ctx()});if(!current(id,sequence))return;adoptState(r.state);sourcePreview=r.preview;sourceView($('source-preview'),r.preview);});
$('save-source').onclick=()=>run(()=>prepare('save-source'));
$('preview-review').onclick=()=>run(async()=>{scope();const id=work.id,sequence=tick,r=await api('/api/energy',{action:'preview-review',...reviewFields(),context:ctx()});if(!current(id,sequence))return;adoptState(r.state);reviewPreview=r.preview;reviewView($('review-preview'),r.preview);});
$('save-review').onclick=()=>run(()=>prepare('save-review'));
$('resume').onclick=()=>run(execute);$('release').onclick=()=>run(release);
$('reload').onclick=()=>run(async()=>{await keepPrevious();adoptState(await api('/api/state'));if(work.householdId!==state.workspace.selectedId){work=blank(state.workspace.selectedId);tick++;await durable();sessionStorage.setItem('gridkind-energy-copy',work.id);render();}await catalogues();notice('Current household read; prior complete copy remains retained.');});
$('load-source').onclick=()=>run(async()=>{const r=await readRecord($('source-select').value);if(r.kind!=='energy-source')throw Error('Select an energy source.');links(r);sourceView($('saved-view'),r.detail.edition);});
$('load-week').onclick=()=>run(async()=>{const r=await readRecord($('week-select').value);if(r.kind!=='week')throw Error('Select a weekly plan.');$('plan-view').replaceChildren(element('h3',r.label),element('p','Record '+r.id+' · '+r.sha256));table($('plan-view'),['Date','Day status','Load IDs and labels'],r.detail.report.days.map((d,i)=>[d.date,d.status,r.detail.report.input.days[i].scenario.tasks.map(t=>t.id+' · '+t.label).join('; ')]));});
$('load-review').onclick=()=>run(async()=>{const r=await readRecord($('review-select').value);if(r.kind!=='energy-review')throw Error('Select a saved energy review.');links(r);reviewView($('saved-view'),r.detail.review);});
for(const name of ['source','week','review'])for(const [suffix,delta]of [['prev',-50],['next',50]])$(name+'-'+suffix).onclick=()=>run(()=>catalogue(name,Math.max(0,pages[name].offset+delta)));
await run(async()=>{adoptState(await api('/api/state'));let existing=null;try{const id=sessionStorage.getItem('gridkind-energy-copy');if(id)existing=await readCopy(id);}catch(e){error(e);}if(existing){work=validate(existing);persisted.set(work.id,work.revision);}else work=blank(state.workspace.selectedId);render();retained();try{sessionStorage.setItem('gridkind-energy-copy',work.id);}catch{}await catalogues();notice('Original source and saved plans stay separate. Begin with a meter export or reopen complete work.');});
window.addEventListener('beforeunload',e=>{if(work?.pending){e.preventDefault();e.returnValue='Keep the original pending request before closing.';}});
