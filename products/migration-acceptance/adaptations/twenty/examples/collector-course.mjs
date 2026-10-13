// SPDX-License-Identifier: MIT
// Complete authored HTTP-contract exercise. No external request is made.
import {collectCrmCapture} from '../collector.mjs';
import {canonical,digest,inspectCapture,prepareProviderMigration} from '../provider-input.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
const check=(ok,message)=>{if(!ok)throw Error(message);};
async function rejection(fn,part){try{await fn();}catch(e){check(String(e.message).includes(part),'Unexpected rejection: '+e.message);return String(e.message);}throw Error('Expected rejection: '+part);}
function query(entries){return Object.entries(entries).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');}
export function authoredRoutes(reference){
 const base=reference.target.baseUrl,routes={},add=(url,body)=>{check(!routes[url],'Duplicate authored route');routes[url]={status:200,body,retryAfter:null};};
 for(const kind of ['core','metadata'])add(base+'/rest/open-api/'+kind,reference.target.openapi[kind].body);
 for(const kind of ['objects','fields']){
  const rows=reference.target.metadata.before[kind].flatMap(p=>{const v=JSON.parse(p.body);return Array.isArray(v.data)?v.data:v.data[kind];});
  const size=kind==='objects'?1:10;
  for(let at=0,n=0;at<rows.length;at+=size,n++)add(base+'/rest/metadata/'+kind+'?'+query({limit:60,starting_after:n?'authored-'+kind+'-'+n:null}),JSON.stringify({data:rows.slice(at,at+size),pageInfo:{hasNextPage:at+size<rows.length,endCursor:at+size<rows.length?'authored-'+kind+'-'+(n+1):null},totalCount:rows.length})+'\n');
 }
 for(const object of reference.target.objects){
  const s=object.spec,rows=object.pages.flatMap(p=>JSON.parse(p.body).data[s.namePlural]);
  for(let at=0;at<Math.max(rows.length,1);at++){
   const next=at+1<rows.length?'authored-'+s.namePlural+'-'+(at+1):null;
   add(base+'/rest/'+encodeURIComponent(s.namePlural)+'?'+query({limit:60,depth:0,fields:s.fields.join(','),filter:s.filter??null,starting_after:at?'authored-'+s.namePlural+'-'+at:null}),JSON.stringify({data:{[s.namePlural]:rows.slice(at,at+1)},pageInfo:{hasNextPage:next!==null,endCursor:next},totalCount:rows.length})+'\n');
  }
 }
 return routes;
}
function memoryIO(reference,configuration,routes){
 const db={session:null,pages:{},attempts:[],calls:[],writes:[],result:null,clock:Date.parse(reference.startedAt),fault:null};
 const io={
  now:()=>new Date(db.clock).toISOString(),
  wait:async ms=>{db.writes.push({kind:'wait',milliseconds:ms});db.clock+=ms;},
  readSession:async()=>copy(db.session),
  saveSession:async value=>{db.session=copy(value);db.writes.push({kind:'session',state:value.state});},
  readPage:async key=>copy(db.pages[key]??null),
  savePage:async(key,value)=>{if(db.pages[key]&&canonical(db.pages[key])!==canonical(value))db.attempts.push({key,value:copy(db.pages[key])});db.pages[key]=copy(value);db.writes.push({kind:'page',key,sha256:digest(canonical(value)).sha256});if(db.fault?.kind==='save-after'&&key===db.fault.key){db.fault=null;throw Error('Authored storage acknowledgement lost');}},
  readOriginal:async path=>{const index=configuration.source.objects.findIndex(x=>x.path===path);check(index>=0,'Unexpected source path');const x=reference.source.objects[index].original;return {body:x.body,filename:x.filename};},
  request:async({url,tokenEnv})=>{
   check(tokenEnv==='TWENTY_AUTHORED_ONLY','No credential-bearing environment name is used in this interface course.');
   const call={url,tokenEnv,at:io.now()};db.calls.push(call);
   if(db.fault?.url===url){const f=db.fault;db.fault=null;if(f.kind==='disconnect'){call.error='Authored connection lost before complete response';throw Error(call.error);}if(f.kind==='429'){const response={status:429,body:'{"error":"authored rate limit; no customer request"}\n',retryAfter:f.retryAfter??'2'};call.response=copy(response);return response;}}
   const response=routes[url];check(response,'No external request is permitted: '+url);call.response=copy(response);return copy(response);
  },
  saveResult:async value=>{db.result=copy(value);db.writes.push({kind:'result',sha256:digest(canonical(value)).sha256});}
 };
 return {db,io};
}
export async function runCollectorCourse({reference,configuration,mapping}){
 check(reference.evidenceKind==='authored-reference','Use the retained explicitly authored reference only.');
 const config=copy(configuration);config.operationId='authored_collector_http_contract_20261013';config.source.system='Authored legacy JSON reference';config.source.workspaceReference=reference.source.workspaceReference;config.target.workspaceReference=reference.target.workspaceReference;config.target.tokenEnv='TWENTY_AUTHORED_ONLY';config.target.baseUrl=reference.target.baseUrl;config.target.objects=reference.target.objects.map(x=>copy(x.spec));
 const routes=authoredRoutes(reference),all=[];
 const run=async(label,action)=>{const state=memoryIO(reference,config,copy(routes));await action(state);all.push({label,...state.db});return state;};
 const baseline=await run('complete metadata and record pagination',async({db,io})=>{
  const cap=await collectCrmCapture(config,io),report=inspectCapture(cap);
  check(report.populations.filter(x=>x.side==='target').reduce((n,x)=>n+x.rows,0)===7,'All seven authored target records required.');
  check(cap.target.objects.map(x=>x.pages.length).join(',')==='2,3,2','All selected terminal pages required.');
  for(const name of ['objects','fields'])check(cap.target.metadata.before[name].length>1&&cap.target.metadata.after[name].length>1,'Both metadata scans must paginate.');
  const before=db.calls.length;check(canonical(await collectCrmCapture(config,io))===canonical(cap),'Complete resume must preserve exact result.');
  check(db.calls.length===before,'Completed resume must issue zero HTTP requests.');
  check(db.calls.every((x,i)=>i===0||Date.parse(x.at)-Date.parse(db.calls[i-1].at)>=700),'Requests must retain original 700ms pacing.');
 });
 const fieldSecond=Object.keys(routes).find(x=>x.includes('/metadata/fields?')&&x.includes('starting_after'));
 await run('HTTP429 retained and exact retry after deadline',async({db,io})=>{
  db.fault={kind:'429',url:fieldSecond,retryAfter:'2'};
  await rejection(()=>collectCrmCapture(config,io),'HTTP 429');
  const calls=db.calls.length,prior=copy(db.pages),original=copy(db.session);
  await rejection(()=>collectCrmCapture(config,io),'later retry');check(db.calls.length===calls,'Early resume must make zero HTTP calls.');
  const changed=copy(config);changed.target.workspaceReference+='-different';
  await rejection(()=>collectCrmCapture(changed,io),'different original selection');check(db.calls.length===calls,'Changed selection must not issue requests.');
  check(canonical(db.pages)===canonical(prior),'Rejected resume must preserve all original pages.');
  db.clock+=2001;await collectCrmCapture(config,io);
  check(db.calls[calls].url===fieldSecond,'Retry must use the exact original request URL.');
  check(db.attempts.some(x=>x.value.page?.status===429),'Previous provider failure must remain retained.');
  check(db.session.startedAt===original.startedAt,'Resume must preserve original interval start.');
 });
 const peopleSecond=Object.keys(routes).find(x=>x.includes('/people?')&&x.includes('starting_after'));
 await run('interrupted records resume complete selected interval',async({db,io})=>{
  db.fault={kind:'disconnect',url:peopleSecond};await rejection(()=>collectCrmCapture(config,io),'connection lost');
  const count=db.calls.length,priorSuccess=db.calls.slice(0,-1).map(x=>x.url);await collectCrmCapture(config,io);
  check(db.calls[count].url===peopleSecond,'Resume restarts only the failed original GET.');
  check(db.calls.slice(count).filter(x=>priorSuccess.includes(x.url)&&!x.url.includes('/metadata/')).length===0,'Completed original records must not be fetched again.');
 });
 await run('saved page acknowledgement lost then complete resume',async({db,io})=>{
  db.fault={kind:'save-after',key:'target/records/people/000001'};await rejection(()=>collectCrmCapture(config,io),'storage acknowledgement lost');
  const count=db.calls.length;await collectCrmCapture(config,io);
  check(!db.calls.slice(count).some(x=>x.url===peopleSecond),'Already retained full page must be reused after storage acknowledgement loss.');
 });
 await run('altered retained bytes reject before resume',async({db,io})=>{
  db.fault={kind:'disconnect',url:peopleSecond};await rejection(()=>collectCrmCapture(config,io),'connection lost');
  db.pages['target/records/people/000000'].page.body+=' ';
  const count=db.calls.length;await rejection(()=>collectCrmCapture(config,io),'Saved response bytes differ');check(db.calls.length===count,'Changed saved response must reject before another request.');
 });
 await run('nonadvancing cursor rejects with original body retained',async({db,io})=>{
  const old=routes[peopleSecond],value=JSON.parse(old.body);value.pageInfo={hasNextPage:true,endCursor:'authored-people-1'};const localRoutes=copy(routes);localRoutes[peopleSecond]={...old,body:JSON.stringify(value)+'\n'};
  const inner=memoryIO(reference,config,localRoutes);await rejection(()=>collectCrmCapture(config,inner.io),'cursor failed to advance');Object.assign(db,inner.db);check(db.pages['target/records/people/000001'],'Rejecting cursor must retain its complete source response.');
 });
 const prepared=prepareProviderMigration({capture:baseline.db.result,mapping});
 return {schema:'twenty.collector-interface-course.v1',evidenceKind:'authored-interface-exercise',externalRequests:0,nativeCliExecuted:false,statement:'Actual production collector and exact parser/hash modules executed against complete independently authored response bodies. Provider-response is the production envelope label inside these results; it is not evidence of a live CRM call.',configuration:config,sourceCapture:reference,routes,prepared,scenarios:all,summary:all.map(x=>({label:x.label,state:x.session?.state,httpCalls:x.calls.length,retainedPages:Object.keys(x.pages).length,priorAttempts:x.attempts.length,resultSha256:x.result?digest(canonical(x.result)).sha256:null}))};
}
