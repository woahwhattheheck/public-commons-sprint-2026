// MIT. Industrial operator interface for the original weather application.
const $=id=>document.getElementById(id);
let state=null,projectId='',jobId=null,reviewId='',integrationId=null,seenProject='',currentData=null,hourOffset=0,attemptOffset=0,generation=0;
const initial=location.hash.slice(1),saved=sessionStorage.getItem('openweather-operator');
const token=initial||saved;
if(initial){sessionStorage.setItem('openweather-operator',initial);history.replaceState(null,'',location.pathname);}
const message=(text,error=false)=>{$('message').textContent=text;$('message').dataset.error=String(error);};
async function api(path,body){
  if(!token)throw new Error('Open the complete operator URL printed by the application.');
  const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await r.json();if(!r.ok)throw new Error(value.error??'The application could not complete this action');return value;
}
function action(fn,label='Saved'){
  return async event=>{
    event?.preventDefault();const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{const result=await fn();message(label);await refresh();return result;}
    catch(e){message(e.message,true);}
    finally{buttons.forEach(b=>b.disabled=false);}
  };
}
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(label,fn){const b=node('button',label);b.type='button';b.addEventListener('click',action(fn,label+' completed'));return b;}
function table(headers,rows){const wrap=node('div',undefined,'table-wrap'),t=node('table'),head=node('thead'),tr=node('tr');
  headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head);const body=node('tbody');
  for(const row of rows){const tr=node('tr');for(const v of row){const td=node('td');td.append(v instanceof Node?v:document.createTextNode(v===null||v===undefined?'—':String(v)));tr.append(td);}body.append(tr);}
  t.append(body);wrap.append(t);return wrap;
}
function choices(element,items,selected,empty){
  element.replaceChildren();if(empty!==undefined){const o=node('option',empty);o.value='';element.append(o);}
  for(const [value,label] of items){const option=node('option',label);option.value=value;element.append(option);}
  if([...element.options].some(o=>o.value===selected))element.value=selected;
}
const project=()=>state?.projects.find(p=>p.id===projectId)??null;
const needProject=()=>project()??(()=>{throw new Error('Save or select a customer project first.');})();
const needReview=()=>{needProject();if(!reviewId)throw new Error('Choose a saved data edition in Review & deliver.');return reviewId;};
const isoInput=n=>new Date(n).toISOString().slice(0,16);
const epoch=id=>{const t=Date.parse($(id).value+'Z');if(!Number.isFinite(t))throw new Error('Enter a valid UTC date and time.');return Math.floor(t/1000);};
function show(panel){document.querySelectorAll('.panel').forEach(n=>n.hidden=n.id!==panel);document.querySelectorAll('[data-panel]').forEach(n=>n.setAttribute('aria-current',n.dataset.panel===panel?'page':'false'));if(panel==='deployment')void deployment().catch(e=>message(e.message,true));}
document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.panel)));
function fillProject(p){
  if(!p){$('project-form').reset();$('project-id').readOnly=false;$('revision').textContent='New';seenProject='';return;}
  const s=p.selection;$('project-id').value=p.id;$('project-id').readOnly=true;$('project-label').value=s.label;
  for(const key of ['lat','lon','units','lang'])$(key).value=s[key]??'';
  $('key-env').value=s.keyEnv;$('max-pages').value=s.maxPages;$('timeout').value=s.timeoutMs/1000;$('revision').textContent='Revision '+p.revision;
  const schedule=p.schedule;$('schedule-enabled').checked=schedule?.enabled??false;$('schedule-interval').value=schedule?.intervalMinutes??10;
  $('schedule-hours').value=schedule?.hours??48;$('schedule-select').checked=schedule?.autoSelect??false;
  seenProject=p.id+':'+p.revision;
}
async function refresh(){
  state=await api('state');choices($('project-select'),state.projects.map(p=>[p.id,p.selection.label]),projectId,'New project');
  $('connection').textContent='Connected · '+state.projects.length+' projects · '+state.running.length+' active acquisition'+(state.running.length===1?'':'s');
  const p=project();if(p&&seenProject!==p.id+':'+p.revision)fillProject(p);
  const budget=state.account&&state.budgets[state.account.budgetId];
  $('budget-summary').textContent=budget?budget.used+' retained calls + '+budget.externalCalls+' elsewhere / '+budget.limit+' allowance':'Configure the existing account allowance.';
  $('credential-status').textContent=(state.credentials.provider?'Provider key configured':'Provider key needed')+' · '+(state.credentials.application?'Customer API configured':'Customer API token needed');
  if(p){
    choices($('review-select'),[...p.reviews].reverse().map(r=>[r.id,r.createdAt+' · '+(r.complete?'Complete':'Partial')+' · '+r.id.slice(0,12)]),reviewId||p.activeReview,'Choose an edition');
    reviewId=$('review-select').value;
    choices($('integration-select'),[...(p.integrations??[])].reverse().map(r=>[r.id,r.createdAt+' · '+r.id.slice(0,12)]),integrationId??'','Choose an integration review');
    $('active-edition').textContent=p.activeReview?'Direct API uses '+p.activeReview.slice(0,16)+'. Previous: '+(p.previousReview?.slice(0,16)??'none'):'Select a reviewed edition for the direct customer API.';
    choices($('release-package'),p.exports.filter(x=>x.state==='COMPLETE').map(x=>[x.name,x.name]),$('release-package').value,'Choose an exported package');
    const sources=p.sources.map(r=>[r.name,r.sourceUrl||'Retained file',r.sha256.slice(0,16),button('Download',()=>download('source?project='+encodeURIComponent(p.id)+'&id='+r.id,r.id+'.json'))]);
    $('source-inventory').replaceChildren(sources.length?table(['Source','Location','SHA-256',''],sources):node('p','No customer API source imported.','empty'));
    $('schedule-status').textContent=p.schedule?.enabled?'Next '+p.schedule.nextAt+(p.schedule.lastError?' · '+p.schedule.lastError:''):'Schedule is off.';
    $('client-example').textContent="import {createWeatherClient} from './client.mjs';\nconst weather = createWeatherClient({url: '"+location.origin+"', token: process.env.OPENWEATHER_APP_TOKEN});\nconst current = await weather.current('"+p.id+"');\nfor await (const hour of weather.hourly('"+p.id+"')) {\n  console.log(hour.at, hour.temperature);\n}\n";
  }
  const jobs=state.jobs.filter(j=>j.project===projectId);
  $('jobs').replaceChildren(jobs.length?table(['Acquisition','State','UTC window','Calls','Hourly pages',''],jobs.map(j=>[
    j.id.slice(0,20),j.state,new Date(j.start*1000).toISOString()+' → '+new Date(j.end*1000).toISOString(),j.attempts,j.hourlyPages+'/'+j.maxPages,
    button('Open',async()=>{jobId=j.id;attemptOffset=0;await loadJob();})])):node('p','No acquisitions in this project.','empty'));
  if(jobId){const j=jobs.find(j=>j.id===jobId);if(j)$('job-status').textContent=j.state+' · '+j.attempts+' requests · '+(j.reason??'Retained current and hourly source')+(j.retryAt?' · Retry after '+j.retryAt:'');}
}
function resetProjectView(){
  jobId=null;reviewId='';integrationId=null;currentData=null;hourOffset=0;attemptOffset=0;
  $('job-controls').hidden=true;$('data-summary').textContent='Select an acquisition or a saved data edition.';
  for(const id of ['coverage','current-data','hourly-data','source-inventory','integration-preview'])$(id).replaceChildren();
  for(const id of ['active-edition','client-example','integration-identity','integration-detail','schedule-status'])$(id).textContent='';
  for(const id of ['review-select','integration-select','release-package'])choices($(id),[],'','Choose a saved item');
}
function renderIntegration(result){
  const ready=result.ready??Boolean(result.id);integrationId=ready?result.id:null;
  $('integration-identity').textContent=ready?'Reviewed integration '+result.id:'Resolve the original source changes before export.';
  $('integration-detail').textContent=JSON.stringify(result,null,2);
  $('integration-preview').replaceChildren(result.preview?table(['Route','Public URL','Backend','Atomic price','Authentication'],result.preview.routes.map(r=>[r.method+' '+r.path,r.publicUrl,r.upstream,r.amountAtomic,(r.environment??[]).join(', ')])):node('p',JSON.stringify(result.issues)));
}
async function loadPackages(){const value=await api('packages');choices($('baseline'),value.packages.filter(p=>!p.error).map(p=>[p.name,p.name+' · '+(p.title??'API merchant')]),$('baseline').value,'Create a new merchant package');}
async function loadJob(){
  if(!jobId)throw new Error('Select an acquisition first.');
  const [job,data]=await Promise.all([api('job?job='+jobId+'&offset='+attemptOffset),api('dataset?job='+jobId+'&conflicts='+$('conflict-policy').value)]);
  currentData=data;hourOffset=0;$('job-controls').hidden=false;$('job-title').textContent=job.id;
  $('job-status').textContent=job.state+' · '+job.totalAttempts+' attempted calls · '+(job.reason??'');
  const rows=job.attempts.map(a=>[a.kind,a.state,a.status??'—',a.startedAt,a.response?button('Response',()=>download('response?job='+jobId+'&attempt='+a.id,a.id+'.json')):'No complete retained response']);
  const navigation=node('div',undefined,'form-actions');
  if(attemptOffset)navigation.append(button('Previous requests',async()=>{attemptOffset=Math.max(0,attemptOffset-100);await loadJob();}));
  if(job.nextOffset!==null)navigation.append(button('Next requests',async()=>{attemptOffset=job.nextOffset;await loadJob();}));
  navigation.append(node('span','Requests '+(attemptOffset+1)+'–'+(attemptOffset+job.attempts.length)+' of '+job.totalAttempts,'small'));
  $('attempts').replaceChildren(table(['Kind','State','HTTP','Started','Original response'],rows),navigation);
  renderData(data);
}
function renderData(data){
  const c=data.coverage;$('data-summary').textContent=data.job+' · '+c.receivedHours+' / '+c.expectedHours+' requested hourly records · '+data.acquisition.attemptedCalls+' attempted calls';
  $('coverage').replaceChildren();
  if(c.gaps.length)$('coverage').append(table(['Missing UTC start','Missing UTC end (exclusive)','Hours'],c.gaps.map(g=>[new Date(g.start*1000).toISOString(),new Date(g.end*1000).toISOString(),g.hours])));
  $('coverage').append(node('p',(c.complete?'Complete retained range.':'Partial retained range.')+' '+c.duplicateRecords+' identical overlap records; '+c.conflictingRecords+' conflicting records.'));
  const r=data.current;
  $('current-data').replaceChildren(node('h3','Current weather'));
  if(r)$('current-data').append(table(['Field','Value','Unit'],[
    ['Observed UTC',new Date(r.at*1000).toISOString(),'UTC'],['Temperature',r.temperature,data.units.temperature],['Feels like',r.feelsLike,data.units.temperature],
    ['Wind',r.windSpeed,data.units.wind],['Rain',r.rainRate,data.units.precipitation],['Snow',r.snowRate,data.units.precipitation],
    ['Humidity',r.humidity,'%'],['Conditions',r.weather?.map(w=>w.description??w.main??w.id).join(', '),'']]));
  else $('current-data').append(node('p','No retained current record.'));
  renderHours();
}
function renderHours(){
  const data=currentData;if(!data)return;
  const local=at=>data.timezone?new Intl.DateTimeFormat('en-GB',{timeZone:data.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(at*1000)):new Date(at*1000).toISOString();
  const rows=data.hourly.slice(hourOffset,hourOffset+100).map(r=>[new Date(r.at*1000).toISOString(),local(r.at),r.temperature,r.feelsLike,r.windSpeed,r.rainRate,r.snowRate,r.precipitationProbability===undefined?'—':(r.precipitationProbability*100).toFixed(0)+'%']);
  const nav=node('div',undefined,'form-actions');
  if(hourOffset)nav.append(button('Previous hours',()=>{hourOffset=Math.max(0,hourOffset-100);renderHours();}));
  if(hourOffset+100<data.hourly.length)nav.append(button('Next hours',()=>{hourOffset+=100;renderHours();}));
  nav.append(node('span','Hours '+(data.hourly.length?hourOffset+1:0)+'–'+Math.min(hourOffset+100,data.hourly.length)+' of '+data.hourly.length,'small'));
  $('hourly-data').replaceChildren(node('h3','Hourly timeline · '+(data.timezone??'UTC')),table(['UTC','Local time','Temp '+data.units.temperature,'Feels '+data.units.temperature,'Wind '+data.units.wind,'Rain mm/h','Snow mm/h','Precipitation'],rows),nav);
}
async function download(path,fallback){
  const response=await fetch('/api/'+path,{headers:{authorization:'Bearer '+token}});
  if(!response.ok){const e=await response.json();throw new Error(e.error??'Download failed');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??fallback;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function deployment(){
  const result=await api('deployment'),s=result.state??result;generation=s.generation??0;
  const releases=result.releases??result.catalog??[];
  choices($('release-select'),releases.map(r=>[r.id,r.label??r.id]),$('release-select').value||s.active,'Choose a staged release');
  $('deployment-summary').textContent='Generation '+generation+' · Selected '+(s.active??'none')+' · Previous '+(s.previous??'none');
  $('deployment-detail').textContent=JSON.stringify(result,null,2);
}
$('project-select').addEventListener('change',action(async()=>{projectId=$('project-select').value;resetProjectView();seenProject='';fillProject(project());},'Project opened'));
$('new-project').addEventListener('click',action(async()=>{projectId='';resetProjectView();$('project-select').value='';fillProject(null);show('setup');},'New project opened'));
$('project-form').addEventListener('submit',action(async()=>{
  const p=project(),id=$('project-id').value;
  await api('project',{id,expectedRevision:p?.revision??0,selection:{label:$('project-label').value,lat:Number($('lat').value),lon:Number($('lon').value),units:$('units').value,lang:$('lang').value,keyEnv:$('key-env').value,maxPages:Number($('max-pages').value),timeoutMs:Number($('timeout').value)*1000}});
  projectId=id;seenProject='';
},'Project saved'));
$('account-form').addEventListener('submit',action(async()=>api('account',{label:$('account-label').value,keyEnv:$('account-key-env').value,start:new Date(epoch('budget-start')*1000).toISOString(),end:new Date(epoch('budget-end')*1000).toISOString(),limit:Number($('budget-limit').value),externalCalls:Number($('external-calls').value)}),'Call allowance saved'));
$('source-file').addEventListener('change',async()=>{const f=$('source-file').files[0];if(!f)return;if(f.size>4*1024*1024){message('Use a source file within 4 MiB.',true);return;}$('source-text').value=await f.text();});
$('source-form').addEventListener('submit',action(async()=>{const result=await api('source',{project:needProject().id,name:$('source-name').value,specText:$('source-text').value,sourceUrl:$('source-url').value});$('source-result').hidden=false;$('source-result').textContent=JSON.stringify(result.inspection,null,2);},'Original source retained'));
$('acquire-form').addEventListener('submit',action(async()=>{
  const job=await api('acquire',{project:needProject().id,start:epoch('range-start'),end:epoch('range-end'),requestId:'weather-'+crypto.randomUUID()});
  jobId=job.id;await loadJob();
},'Acquisition started; each provider request is retained'));
$('resume-job').addEventListener('click',action(async()=>{await api('resume',{job:jobId,extraPages:Number($('extra-pages').value),acknowledgeUnknown:$('ack-unknown').checked});await loadJob();},'Saved acquisition resumed'));
$('stop-job').addEventListener('click',action(async()=>{await api('stop',{job:jobId});await loadJob();},'Stop recorded'));
$('inspect-job').addEventListener('click',action(async()=>{await loadJob();show('review');},'Retained acquisition opened'));
$('conflict-policy').addEventListener('change',()=>{if(jobId)void loadJob().catch(e=>message(e.message,true));});
$('review-form').addEventListener('submit',action(async()=>{
  if(!jobId)throw new Error('Select an acquisition first.');
  const r=await api('review',{job:jobId,notes:$('review-notes').value,acceptPartial:$('accept-partial').checked,conflicts:$('conflict-policy').value});reviewId=r.id;
},'Reviewed data edition saved'));
$('review-select').addEventListener('change',()=>{reviewId=$('review-select').value;integrationId=null;});
$('open-edition').addEventListener('click',action(async()=>{
  const review=await api('review?project='+needProject().id+'&review='+needReview());currentData=review.data;hourOffset=0;jobId=null;
  $('job-controls').hidden=true;renderData(currentData);$('review-notes').value=review.decision.notes;show('review');
},'Saved data edition opened'));
$('open-integration').addEventListener('click',action(async()=>{
  const id=$('integration-select').value;if(!id)throw new Error('Choose a saved integration review.');
  const document=await api('integration?project='+needProject().id+'&id='+id);reviewId=document.dataReview;renderIntegration(document);
},'Saved integration reopened'));
$('select-edition').addEventListener('click',action(async()=>api('select',{project:needProject().id,review:needReview(),expectedRevision:project().revision}),'Customer data edition selected'));
$('rollback-edition').addEventListener('click',action(async()=>{const p=needProject();const r=await api('rollback-data',{project:p.id,expectedReview:p.activeReview});reviewId=r.activeReview;},'Previous customer data restored'));
document.querySelectorAll('[data-download]').forEach(b=>b.addEventListener('click',action(()=>download('export?project='+needProject().id+'&review='+needReview()+'&format='+b.dataset.download,'weather-export'),'Export downloaded')));
$('backup').addEventListener('click',action(()=>download('backup','openweather-workspace-backup.json'),'Weather backup downloaded'));
$('schedule-form').addEventListener('submit',action(async()=>api('schedule',{project:needProject().id,expectedRevision:project().revision,enabled:$('schedule-enabled').checked,intervalMinutes:Number($('schedule-interval').value),hours:Number($('schedule-hours').value),autoSelect:$('schedule-select').checked}),'Schedule saved'));
$('integration-form').addEventListener('submit',action(async()=>{
  const input={project:needProject().id,review:needReview(),baseline:$('baseline').value||undefined};
  if(input.baseline)input.decisions=JSON.parse($('mapping-decisions').value||'{}');
  else Object.assign(input,{sellerServer:$('seller-url').value,payment:JSON.parse($('payment').value||'{}'),amountAtomic:{current:$('price-current').value,hourly:$('price-hourly').value}});
  const result=await api('integration/review',input);renderIntegration(result);
},'Original merchant output reviewed'));
$('export-form').addEventListener('submit',action(async()=>{if(!integrationId)throw new Error('Review the merchant output first.');await api('integration/export',{project:needProject().id,integration:integrationId,name:$('package-name').value});await loadPackages();},'Original merchant package saved'));
$('stage-form').addEventListener('submit',action(async()=>{
  const r=await api('stage',{project:needProject().id,package:$('release-package').value,id:$('release-id').value,label:$('release-label').value||undefined,port:Number($('release-port').value),facilitator:$('facilitator').value||undefined});
  generation=r.generation;await deployment();$('release-select').value=r.release.id;$('deployment-detail').textContent=JSON.stringify(r,null,2);
},'Original release staged'));
$('refresh-deployment').addEventListener('click',action(deployment,'Deployment refreshed'));
$('compare-release').addEventListener('click',action(async()=>{const r=await api('diff?release='+encodeURIComponent($('release-select').value));generation=r.generation;$('deployment-detail').textContent=JSON.stringify(r,null,2);},'Original release comparison loaded'));
$('activate-release').addEventListener('click',action(async()=>{await api('activate',{id:$('release-select').value,expectedGeneration:generation});await deployment();},'Reviewed release selected'));
$('rollback-release').addEventListener('click',action(async()=>{await api('rollback',{expectedGeneration:generation});await deployment();},'Previous original release selected'));
$('start-release').addEventListener('click',action(async()=>{await api('start-release',{expectedGeneration:generation});await deployment();},'Original seller started'));
$('stop-release').addEventListener('click',action(async()=>{await api('stop-release',{});await deployment();},'Owned seller drained and stopped'));
const day=Math.floor(Date.now()/86400000)*86400000,hour=Math.floor(Date.now()/3600000)*3600000;
$('budget-start').value=isoInput(day);$('budget-end').value=isoInput(day+86400000);$('range-start').value=isoInput(hour);$('range-end').value=isoInput(hour+48*3600000);
function estimate(){try{const hours=(epoch('range-end')-epoch('range-start'))/3600;$('range-estimate').textContent=hours>0?'At least '+(1+Math.ceil(hours/20))+' provider calls for current + '+hours+' hourly records; actual continuations govern pages.':'';}catch{}}
$('range-start').addEventListener('input',estimate);$('range-end').addEventListener('input',estimate);estimate();
let lastJobVersion='';
async function poll(){
  try{await refresh();const job=state.jobs.find(j=>j.id===jobId),version=job?job.id+':'+job.state+':'+job.attempts:'';
    if(job&&version!==lastJobVersion){lastJobVersion=version;await loadJob();}}
  catch(e){message(e.message,true);}finally{setTimeout(poll,3000);}
}
(async()=>{try{await refresh();$('field-map').replaceChildren(table(['Original provider field','Customer field','Meaning'],state.fieldMap));
  if(state.account){const b=state.budgets[state.account.budgetId];$('account-label').value=state.account.label;$('account-key-env').value=state.account.keyEnv;
    $('budget-start').value=isoInput(b.start);$('budget-end').value=isoInput(b.end);$('budget-limit').value=b.limit;$('external-calls').value=b.externalCalls;}
  await loadPackages();void poll();
}catch(e){message(e.message,true);}})();
