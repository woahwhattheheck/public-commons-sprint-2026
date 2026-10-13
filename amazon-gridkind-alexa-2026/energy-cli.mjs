#!/usr/bin/env node
// TJ Labs / GridKind — original measured-energy requests and exact complete files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {weekInputs} from './weekly.mjs';
import {energySourceInput,previewEnergySource,energyDigest,inspectEnergySource,inspectEnergyReview} from './energy-source.mjs';
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const need=(condition,message)=>{if(!condition)throw Error(message);};
export const same=(a,b)=>energyDigest(a)===energyDigest(b);
export async function readJSON(file){return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await fs.readFile(file)));}
export async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function keep(root,name,raw){
 const target=path.resolve(root,name);need(target.startsWith(path.resolve(root)+path.sep),'Artifact escapes its selected output directory.');
 const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
 if(await exists(target)){const st=await fs.lstat(target);need(st.isFile()&&!st.isSymbolicLink(),'Retain a regular original file.');need((await fs.readFile(target)).equals(bytes),'Existing complete artifact differs: '+name);}
 else{
  const temporary=target+'.partial-'+randomUUID(),h=await fs.open(temporary,'wx',0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  try{await fs.link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(target)).equals(bytes),'Concurrent original artifact differs.');}
  finally{await fs.unlink(temporary);}const d=await fs.open(path.dirname(target),'r');try{await d.sync();}finally{await d.close();}
 }
 return{file:name,path:target,bytes:bytes.length,sha256:sha(bytes)};
}
export async function verifyFile(item){
 const st=await fs.lstat(item.path);need(st.isFile()&&!st.isSymbolicLink(),'Expected retained regular file.');
 const raw=await fs.readFile(item.path);need(raw.length===item.bytes&&sha(raw)===item.sha256,'Retained artifact changed: '+item.path);return raw;
}
export function intent(body){
 if(body.action==='save-source')return{action:body.action,source:energySourceInput(body.source),previewSha256:body.previewSha256};
 need(body.action==='save-review','Choose save-source or save-review.');return{action:body.action,sourceId:body.sourceId,weekId:body.weekId,title:body.title.trim(),note:body.note??'',previewSha256:body.previewSha256};
}
export const context=state=>({householdId:state.workspace.selectedId,revision:state.workspace.revision,generation:state.workspace.generation});
export async function connection(file){
 const c=await readJSON(file),u=new URL(c.url);
 need(c.schema==='gridkind-energy-connection/v1'&&['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash,'Choose the original loopback connection.');
 need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(c.sid),'Retain the exact original gridkind_sid browser visitor.');
 return{...c,url:u.origin,identity:sha(Buffer.from(c.sid))};
}
export async function request(c,route,body){
 need(route.startsWith('/api/'),'Use the existing native application API.');
 const r=await fetch(c.url+route,{method:body?'POST':'GET',headers:{Cookie:'gridkind_sid='+c.sid,Origin:c.url,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000),redirect:'error'});
 const raw=Buffer.from(await r.arrayBuffer());let value;try{value=JSON.parse(raw.toString('utf8'));}catch{value=null;}
 if(!r.ok||value?.error){const e=Error(value?.error||'Original HTTP '+r.status);e.status=r.status;e.raw=raw;e.value=value;throw e;}
 need(value!==null,'Original response is not complete JSON. Retain the same request.');return{value,raw,status:r.status};
}
export function checkedPrepared(p,c){
 need(p?.schema==='gridkind-energy-request/v1'&&p.connection_identity===c.identity&&typeof p.operation_id==='string','Prepared request selects another original visitor or operation.');
 need(p.body?.context?.householdId===p.household_id&&p.intent_sha256===energyDigest(intent(p.body)),'Prepared request or household identity changed.');
 need(/^[a-f0-9-]{36}$/.test(p.body.requestId),'Original request ID is missing.');return p;
}
export async function prepare({c,action,source,sourceId,weekId,title,note='',operationId,requestFile}){
 const selected=action==='save-source'?{action,source:energySourceInput(source)}:{action,sourceId,weekId,title:title?.trim(),note};
 need(typeof operationId==='string'&&operationId.trim(),'Name the retained original operation.');
 if(await exists(requestFile)){const old=checkedPrepared(await readJSON(requestFile),c);const original={...intent(old.body)};delete original.previewSha256;need(old.operation_id===operationId&&same(original,selected),'Existing prepared request has different source or selection.');return old;}
 const state=(await request(c,'/api/state')).value,preview=(await request(c,'/api/energy',{...selected,action:action==='save-source'?'preview-source':'preview-review',context:context(state)})).value;
 const body={...selected,context:context(preview.state),previewSha256:preview.preview.sha256,requestId:randomUUID()};
 const p={schema:'gridkind-energy-request/v1',operation_id:operationId,connection_identity:c.identity,household_id:body.context.householdId,intent_sha256:energyDigest(intent(body)),body};
 await keep(path.dirname(path.resolve(requestFile)),path.basename(requestFile),json(p));return p;
}
export async function continueRequest({c,prepared,output}){
 const p=checkedPrepared(prepared,c),root=path.resolve(output);
 await keep(root,'Original_Request.json',json(p));
 const outcomeRoute='/api/energy/outcome?householdId='+encodeURIComponent(p.household_id)+'&requestId='+p.body.requestId;
 const found=(await request(c,outcomeRoute)).value;
 let result=found;
 if(!found.record){
  // The exact immutable intent is already durable. Each actual provider invocation
  // has its own full attempted body and complete returned bytes; no UUID replacement.
  const attempt=randomUUID();await keep(root,'attempts/'+attempt+'.request.json',json({prepared:p,at:new Date().toISOString(),state:'dispatching'}));
  try{const r=await request(c,'/api/energy',p.body);await keep(root,'attempts/'+attempt+'.response.json',r.raw);result=r.value;}
  catch(e){await keep(root,'attempts/'+attempt+'.error.json',json({message:e.message,status:e.status??null,value:e.value??null}));if(e.raw)await keep(root,'attempts/'+attempt+'.response.raw',e.raw);throw e;}
 }
 need(result.householdId===p.household_id&&result.record?.detail?.requestId===p.body.requestId&&result.record.detail.requestSha256===p.intent_sha256,'Returned native record differs from the original intent.');
 const record=result.record;
 if(record.kind==='energy-source')inspectEnergySource(record.detail.edition);
 else{
  const source=(await request(c,'/api/workspace/record?householdId='+p.household_id+'&id='+record.detail.review.binding.sourceId)).value;
  const week=(await request(c,'/api/workspace/record?householdId='+p.household_id+'&id='+record.detail.review.binding.weekId)).value;
  inspectEnergyReview(record.detail.review,source,week);
 }
 await keep(root,'Committed_Record.json',json(record));return record;
}
export async function exportRecord({c,householdId,recordId,output}){
 const record=(await request(c,'/api/workspace/record?householdId='+encodeURIComponent(householdId)+'&id='+encodeURIComponent(recordId))).value;
 need(['energy-source','energy-review'].includes(record.kind),'Choose an energy record.');
 const artifacts=[];
 for(const [format,name]of [['json','Complete_Record.json'],['source','Original_Intervals.csv'],['rows','All_Source_Rows.csv'],['html','Energy_Review.html'],...(record.kind==='energy-review'?[['csv','All_168_Hours.csv']]:[])]){
  const r=await fetch(c.url+'/api/energy/export?householdId='+encodeURIComponent(householdId)+'&recordId='+recordId+'&format='+format,{headers:{Cookie:'gridkind_sid='+c.sid},signal:AbortSignal.timeout(120000),redirect:'error'});
  need(r.ok,'Original export failed: '+r.status);artifacts.push(await keep(output,name,Buffer.from(await r.arrayBuffer())));
 }
 const backup=(await request(c,'/api/workspace/export?householdId='+encodeURIComponent(householdId))).value;
 // Export time may vary on replay; preserve the first full backup and compare immutable payload.
 const target=path.join(output,'Complete_Household.json');
 if(await exists(target)){const old=await readJSON(target);need(old.sha256===backup.sha256&&same(old.payload,backup.payload),'Household changed after the retained export; keep the earlier case and start a separately named continuation.');artifacts.push(await keep(output,'Complete_Household.json',await fs.readFile(target)));}
 else artifacts.push(await keep(output,'Complete_Household.json',json(backup)));
 return artifacts;
}

export async function ensureAuthoredWeek({read,post,input,output}){
 const selected=weekInputs(input),root=path.resolve(output);
 await keep(root,'Authored_Week_Input.json',json(selected));
 const state=await read('/api/state'),home=state.workspace.selectedId,matches=[];let offset=0;
 for(;;){const page=await read('/api/energy?kind=week&householdId='+home+'&offset='+offset);
  for(const row of page.records){const record=await read('/api/workspace/record?householdId='+home+'&id='+row.id);if(same(record.detail.report.input,selected))matches.push(record);}
  if(!page.hasMore)break;offset=page.offset+page.records.length;
 }
 need(matches.length<=1,'Multiple identical saved weeks exist. Select the intended original week ID.');
 let record=matches[0];
 if(!record){
  const file=path.join(root,'Original_Week_Request.json');let body;
  if(await exists(file))body=await readJSON(file);
  else{body={action:'plan',input:selected,context:context(state)};await keep(root,'Original_Week_Request.json',json(body));}
  need(body.context.householdId===home&&same(body.input,selected),'Original week request or household changed.');
  const result=await post('/api/week',body);record=result.record;
 }
 need(record?.kind==='week'&&same(record.detail.report.input,selected),'Original saved week differs from authored inputs.');
 await keep(root,'Saved_Authored_Week.json',json(record));return record;
}

async function main(){
 const command=process.argv[2],a={};for(let i=3;i<process.argv.length;i+=2){need(process.argv[i]?.startsWith('--')&&process.argv[i+1]!==undefined,'Every option needs a value.');a[process.argv[i].slice(2)]=process.argv[i+1];}
 if(command==='inspect'){const input=await readJSON(a.source),preview=previewEnergySource(input);await keep(path.dirname(path.resolve(a.output)),path.basename(a.output),json(preview));return;}
 const c=await connection(a.connection);
 if(command==='prepare-week'){const record=await ensureAuthoredWeek({read:async route=>(await request(c,route)).value,post:async(route,body)=>(await request(c,route,body)).value,input:await readJSON(a.input),output:path.resolve(a.output)});process.stdout.write(JSON.stringify({weekId:record.id,sha256:record.sha256})+'\n');return;}
 if(command==='catalogue'){const kind=a.kind??'week';let offset=0,rows=[];for(;;){const r=(await request(c,'/api/energy?kind='+encodeURIComponent(kind)+'&offset='+offset)).value;rows.push(...r.records);if(!r.hasMore)break;offset=r.offset+r.records.length;}process.stdout.write(JSON.stringify(rows,null,2)+'\n');return;}
 if(command==='prepare-source'||command==='prepare-review'){
  const p=await prepare({c,action:command==='prepare-source'?'save-source':'save-review',source:a.source?await readJSON(a.source):undefined,sourceId:a['source-id'],weekId:a['week-id'],title:a.title,note:a['note-file']?await fs.readFile(a['note-file'],'utf8'):'',operationId:a.operation,requestFile:path.resolve(a.request)});
  process.stdout.write(JSON.stringify({request:a.request,requestId:p.body.requestId,intentSha256:p.intent_sha256})+'\n');return;
 }
 if(command==='continue'){const record=await continueRequest({c,prepared:await readJSON(a.request),output:path.resolve(a.output)});process.stdout.write(JSON.stringify({recordId:record.id,sha256:record.sha256})+'\n');return;}
 if(command==='export'){const result=await exportRecord({c,householdId:a.household,recordId:a.record,output:path.resolve(a.output)});process.stdout.write(JSON.stringify(result,null,2)+'\n');return;}
 throw Error('Commands: inspect, catalogue, prepare-week, prepare-source, prepare-review, continue, export. See ENERGY_REVIEW.md.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
