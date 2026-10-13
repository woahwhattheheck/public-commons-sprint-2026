// MIT. Closed routes into the unchanged original Measurements HTTP owner.
export const BASE='/api/measurement-workspace';
const rows=[];
function add(name,method,route,{query=[],replay='never',effect=method==='GET'?'read':'write',note=''}={}) {
 rows.push(Object.freeze({name,method,route,query:Object.freeze(query),replay:method==='GET'?'read':replay,effect,note}));
}
const filters=['stationId','parameter','from','to','state','kind','q','eligible','offset','limit','expected_revision'];
add('summary','GET','');add('snapshot','GET','/snapshot',{query:filters});add('records','GET','/records',{query:filters});
add('record','GET','/records/:id');add('source','GET','/sources/:id');add('source-original','GET','/sources/:id/original');add('source-rejected','GET','/sources/:id/rejected');
add('source-preview','POST','/preview',{replay:'read',effect:'read'});add('source-import','POST','/imports',{replay:'exact'});
add('station-mapping','PUT','/stations/:id/mapping',{note:'Original revision CAS; an uncertain response must be reconciled before a new decision.'});
add('record-review','PUT','/records/:id/review',{note:'Original revision CAS; an uncertain response must be reconciled before a new decision.'});
add('records-csv','GET','/export.csv',{query:filters});add('exports','GET','/exports',{query:['offset','limit']});add('export','GET','/exports/:id');
add('workspace-export','GET','/portable');add('workspace-receive','POST','/receive',{note:'Original empty-workspace receive only. Reconcile a lost response with summary/intake; never overwrite an advanced workspace.'});
add('calibration','POST','/calibration');add('paired-loads','POST','/paired-loads');
add('provider-query','POST','/provider-query',{replay:'read',effect:'read',note:'Construct the original provider query; no network source acquisition.'});
add('provider-fetch','POST','/provider-fetch',{replay:'read',effect:'read',note:'Original bounded provider acquisition only; exact response and preview retained. No automatic import.'});
add('native-catalogue','GET','/native-observations/catalogue');add('native-source','GET','/native-observations/imports/:id',{query:['expected_revision']});
add('intakes','GET','/intake');add('intake-inspect','POST','/intake/inspect',{replay:'read',effect:'read'});
add('intake-source-lineages','GET','/intake/source-lineages/:id');add('intake-original','GET','/intake/:id/original');add('intake-validate-working','POST','/intake/validate-working',{replay:'read',effect:'read'});
add('intake-copy','POST','/intake/copy',{replay:'exact'});
add('intake-save','PUT','/intake/:id',{replay:'exact'});add('intake','GET','/intake/:id');add('intake-export','GET','/intake/:id/export');add('intake-editions','GET','/intake/:id/editions');
add('intake-preview','POST','/intake/:id/preview',{replay:'read',effect:'read'});add('intake-import','POST','/intake/:id/import',{replay:'exact'});
add('benchmark-catalogue','GET','/benchmarks/catalogue');add('benchmark-project','GET','/benchmarks/project');add('benchmark-study','GET','/benchmarks/studies/:id');add('benchmark-draft','GET','/benchmarks/drafts/:id');add('benchmark-request','GET','/benchmarks/requests/:id');
for(const op of ['preview','save','abandon','drafts','receive'])add('benchmark-'+op,'POST','/benchmarks/'+op,{replay:op==='preview'?'read':'exact',effect:op==='preview'?'read':'write'});
for(const file of ['report.html','rows.csv','periods.csv'])add('benchmark-'+file,'GET','/benchmarks/studies/:id/'+file);
add('reconciliation','GET','/reconciliation');add('reconciliation-groups','GET','/reconciliation/groups',{query:['source_ids','mode','q','offset','limit']});
add('reconciliation-group','GET','/reconciliation/groups/:id');add('reconciliation-decide','POST','/reconciliation/decide');
add('reconciliation-reports','GET','/reconciliation/reports');add('reconciliation-report-save','POST','/reconciliation/reports');add('reconciliation-report','GET','/reconciliation/reports/:id');
for(const file of ['report.html','report.csv'])add('reconciliation-'+file,'GET','/reconciliation/reports/:id/'+file);
add('flow-catalogue','GET','/flow/catalogue');add('flow-study','GET','/flow/studies/:id');
for(const op of ['inspect','preview','save','receive','compare'])add('flow-'+op,'POST','/flow/'+op,{replay:['inspect','preview','compare'].includes(op)?'read':'exact',effect:['inspect','preview','compare'].includes(op)?'read':'write'});
for(const file of ['bundle','report.html','daily.csv','periods.csv','samples.csv'])add('flow-'+file,'GET','/flow/studies/:id/'+file);
add('load-catalogue','GET','/flow/load-catalogue');add('load-result','GET','/flow/load-results/:id');add('load-preview','POST','/flow/load-preview',{replay:'read',effect:'read'});add('load-save','POST','/flow/load-save',{replay:'exact'});
for(const file of ['bundle','report.html','daily.csv','periods.csv','context.csv','annual.csv'])add('load-'+file,'GET','/flow/load-results/:id/'+file);
add('collections','GET','/collections');add('collection-preview','POST','/collections/preview',{replay:'read',effect:'read'});add('collection-receive','POST','/collections/receive');
add('collection-publish','POST','/collections/:id/publish');add('collection-edition','GET','/collections/:id/editions/:edition');add('collection-bundle','GET','/collections/:id/editions/:edition/bundle');
add('collection-member','GET','/collections/:id/editions/:edition/:member');
add('handbacks','GET','/handbacks');add('handback-preview','POST','/handbacks/preview',{replay:'read',effect:'read'});add('handback-publish','POST','/handbacks');add('handback-receive','POST','/handbacks/receive');
add('handback','GET','/handbacks/:id');add('handback-view','GET','/handbacks/:id/view');add('handback-bundle','GET','/handbacks/:id/bundle');add('handback-member','GET','/handbacks/:id/files',{query:['name']});
add('large-intakes','GET','/large/intakes');add('large-intake-begin','POST','/large/intakes');add('large-intake','GET','/large/intakes/:id');add('large-intake-configure','PUT','/large/intakes/:id');add('large-intake-chunk','PUT','/large/intakes/:id/chunks');
for(const op of ['prepare','commit','receive'])add('large-intake-'+op,'POST','/large/intakes/:id/'+op);
add('large-sources','GET','/large/sources');add('large-source','GET','/large/sources/:id');add('large-source-chunk','GET','/large/sources/:id/files/:file/:offset');
add('large-editions','GET','/large/editions');add('large-export','POST','/large/editions');add('large-edition','GET','/large/editions/:id');add('large-edition-chunk','GET','/large/editions/:id/files/:file/:offset');
export const OPERATIONS=Object.freeze(rows);
const index=new Map(rows.map(x=>[x.name,x]));
function need(ok,message){if(!ok)throw Object.assign(new TypeError(message),{code:'MEASUREMENT_OPERATION_INVALID'});}
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function resolveOperation(input){
 need(plain(input)&&Object.keys(input).every(k=>['operation','params','body'].includes(k)),'Use an operation, params and optional original body.');
 const op=index.get(input.operation);need(op,'Choose one declared native Measurements operation.');
 const params=input.params??{};need(plain(params),'Operation params must be an object.');
 const names=[...op.route.matchAll(/:([a-z]+)/g)].map(m=>m[1]),allowed=new Set([...names,...op.query]);
 need(Object.keys(params).every(k=>allowed.has(k)),'Unknown parameter for '+op.name+'.');
 let route=op.route.replace(/:([a-z]+)/g,(_,k)=>{
  const v=params[k];need(typeof v==='string'||Number.isSafeInteger(v),'Supply original '+k+'.');
  const value=String(v);need(value.length>0&&value.length<=2048&&!/[\u0000-\u001f\u007f]/.test(value),'Invalid original '+k+'.');
  if(k==='member'){const parts=value.split('/');need(parts.every(p=>p&&p!=='.'&&p!=='..'),'Choose a regular original member path.');return parts.map(encodeURIComponent).join('/');}
  need(value!=='.'&&value!=='..'&&!/[\\/]/.test(value),'Choose a single original '+k+'.');return encodeURIComponent(value);
 });
 const query=new URLSearchParams();
 for(const key of op.query)if(Object.hasOwn(params,key)){
  const value=params[key];need(typeof value==='string'||typeof value==='boolean'||Number.isFinite(value)||key==='source_ids'&&Array.isArray(value),'Invalid original query value.');
  const text=key==='source_ids'&&Array.isArray(value)?JSON.stringify(value):String(value);need(text.length<=8192,'Query value exceeds native client limit.');query.set(key,text);
 }
 if(op.method==='GET')need(input.body===undefined,'Read operations do not accept an ignored body.');
 else need(plain(input.body),'Supply the complete original JSON body.');
 const suffix=query.toString();
 const replay=['flow-save','load-save'].includes(op.name)&&!input.body?.expected_id?'never':op.replay;
 return Object.freeze({...op,replay,path:BASE+route+(suffix?'?'+suffix:''),body:op.method==='GET'?null:input.body});
}
