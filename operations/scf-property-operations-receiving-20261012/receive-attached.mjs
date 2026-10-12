// MIT. One attached native/merchant receiving flow over the original Property workspace.
import {createServer,request as httpRequest} from 'node:http';
import {open,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {now,need,same,hash,json,view,directory,identity,exists,readJSON,writeJSON,writeBytes,copyOriginal,member,canonical,syncParent} from './io.mjs';
const PRODUCT='stellar/scf-starforge-20261009/',NATIVE=PRODUCT+'sf30-seller-sdk/property-operations/',MCP='stellar-forge/mcp-merchant-operator/';
const load=(root,path)=>import(pathToFileURL(join(root,path)));
const describe=(name,description,properties,required,annotations={})=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations});
function sourceIdentity(state){return {schema:state.schema,createdAt:state.createdAt,activeEditionId:state.activeEditionId,
 captures:state.captures,editions:state.editions,property:state.property};}
function rpc(url,token,body){
 const raw=json(body),u=new URL(url);
 return new Promise((done,reject)=>{const chunks=[];let bytes=0;
  const req=httpRequest(u,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':raw.length,accept:'application/json, text/event-stream'}},res=>{
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){req.destroy(Object.assign(new Error('Tool inventory exceeds its bound.'),{code:'PROPERTY_RECEIVING_TOOLS'}));return;}chunks.push(chunk);});
   res.once('error',reject);res.once('end',()=>{try{need(res.statusCode===200,'PROPERTY_RECEIVING_HTTP');const result=JSON.parse(Buffer.concat(chunks));need(!result.error,'PROPERTY_RECEIVING_RPC');done(result.result);}catch(error){reject(error);}});});
  req.setTimeout(30000,()=>req.destroy(Object.assign(new Error('Original MCP inventory remains pending.'),{code:'PROPERTY_RECEIVING_TIMEOUT'})));
  req.once('error',reject);req.end(raw);
 });
}
async function receiveNativeFile(client,selection,target){
 const selected=await client.selectFile(selection),expected={bytes:selected.descriptor.bytes,sha256:selected.descriptor.sha256};
 if(await exists(target)){need(same(await identity(target),expected),'PROPERTY_RECEIVING_FILE_CHANGED');return expected;}
 await directory(join(target,'..'),{create:true});
 const stage=target+'.receiving';
 if(await exists(stage))await unlink(stage);
 const file=await open(stage,'wx',0o600);let receipt;
 try{receipt=await client.receiveFile(selection,{onChunk:bytes=>file.writeFile(bytes)});await file.sync();}
 finally{await file.close();}
 need(same(await identity(stage),expected)&&receipt.bytes===expected.bytes&&receipt.sha256===expected.sha256,'PROPERTY_RECEIVING_FILE_CHANGED');
 await copyOriginal(stage,target,expected);await unlink(stage);return expected;
}
export async function receivePropertyAttached({sourceRoot,workspaceDirectory,connectionFile,outputDirectory,createdAt,baseline,paidDelivery,journal,save,readOnly=false}){
 const [{createPropertyOperationsClient,readPropertyConnection},{MerchantPropertyWorkspaces},{propertyWorkspaceTools},
  {createMcpToolHandler},{openPropertyClient,reopenPropertyExport}]=await Promise.all([
   load(sourceRoot,NATIVE+'client.mjs'),load(sourceRoot,MCP+'property-workspace.mjs'),
   load(sourceRoot,MCP+'catalog/property-workspace.mjs'),load(sourceRoot,'stellar-forge/mcp-paid-agent/http-tools.mjs'),
   load(sourceRoot,MCP+'property-client.mjs')]);
 await directory(outputDirectory,{create:true});
 const rawReady=await readPropertyConnection(connectionFile),client=createPropertyOperationsClient({url:rawReady.url,expectedCreatedAt:createdAt});
 let merchant=null,server=null,agent=null,primary=null;
 journal.steps??={};journal.failures??=[];
 const nativeWrite=async(label,action,input)=>{
  let step=journal.steps[label];
  if(!step){step={key:'property-receiving-'+hash(Buffer.from(journal.id+':'+label)).slice(0,48),requestedAt:now()};journal.steps[label]=step;await save();}
  if(!step.prepared){need(!readOnly,'PROPERTY_RECEIVING_READ_ONLY');step.prepared=await client.prepare(action,input,{key:step.key});await save();}
  let inspected=await client.inspectPrepared(step.prepared);step.lastDisposition=inspected.disposition;await save();
  if(inspected.disposition==='DONE'){step.result=await client.invoke(step.prepared);await save();return step.result;}
  need(!readOnly&&inspected.disposition==='ABSENT_AT_ORIGINAL_REVISION','PROPERTY_RECEIVING_ORIGINAL_PENDING','Keep the exact original native request for reconciliation.');
  step.invokedAt??=now();await save();
  try{step.result=await client.invoke(step.prepared);await save();return step.result;}
  catch(error){step.error=view(error);await save();throw error;}
 };
 try{
  let state=await client.status();need(state.createdAt===createdAt,'PROPERTY_RECEIVING_WORKSPACE_CHANGED');
  need(state.editions.some(e=>e.id===baseline.editionId)&&state.captures.every(c=>c.status!=='running'),'PROPERTY_RECEIVING_SOURCE_PENDING');
  if(journal.initial){need(journal.initial.createdAt===state.createdAt&&same(journal.initial.captures,state.captures)&&same(journal.initial.editions,state.editions),'PROPERTY_RECEIVING_SOURCE_CHANGED');}
  else{journal.initial={createdAt:state.createdAt,captures:state.captures,editions:state.editions,propertyId:state.property.id};await save();}
  if(!journal.baselineId){
   need(!readOnly,'PROPERTY_RECEIVING_BASELINE_MISSING');
   const result=await nativeWrite('baseline','property.baseline.save',{edition_id:baseline.editionId,columns:baseline.columns,
    name:baseline.name??'Original HPD property receiving baseline',actor:baseline.actor,
    note:baseline.note??'Retain the complete existing HPD edition for the original Property Operations customer workflow.'});
   journal.baselineId=result.result.baseline.id;await save();
  }
  const base=await client.record('baselines',journal.baselineId);
  need(base.result.record.source.edition_id===baseline.editionId&&base.result.record.rows.length===baseline.expectedRows&&same(base.result.record.columns,baseline.columns),'PROPERTY_RECEIVING_BASELINE_CHANGED');
  await writeJSON(join(outputDirectory,'HPD_Baseline.json'),base.result.record);
  journal.bridge??={token:randomBytes(32).toString('hex'),port:null};await save();
  const alias='portfolio',metadata=join(outputDirectory,'..','merchant-state');await directory(metadata,{create:true});
  const configuration={propertyWorkspaces:{schema:'stellar-forge.property-workspaces.v1',workspaces:{
   [alias]:{label:'Original HPD Property Operations',directory:workspaceDirectory,urlFile:connectionFile,expectedCreatedAt:createdAt,expectedPropertyId:null,timeoutMs:300000}},
   files:{'paid-hpd-delivery':{path:paidDelivery.path,bytes:paidDelivery.bytes,sha256:paidDelivery.sha256,label:'Original completed paid HPD delivery'}}},exportsDirectory:metadata};
  const paid=await identity(paidDelivery.path);need(paid.bytes===paidDelivery.bytes&&paid.sha256===paidDelivery.sha256,'PROPERTY_RECEIVING_PAID_INPUT_CHANGED');
  merchant=new MerchantPropertyWorkspaces(configuration);
  const tools=propertyWorkspaceTools(describe);
  const handler=createMcpToolHandler({tools,call:(name,args)=>merchant.call(name,args)},{bearerToken:journal.bridge.token,maxRequestBytes:2*1024*1024,serverName:'starforge-property-receiving',instructions:'Original attached Property Operations receiving.'});
  server=createServer((req,res)=>{Promise.resolve(handler(req,res)).catch(error=>{if(!res.headersSent)res.writeHead(500);res.end();});});
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(journal.bridge.port??0,'127.0.0.1',done);});
  if(journal.bridge.port===null){journal.bridge.port=server.address().port;await save();}
  const endpoint='http://127.0.0.1:'+journal.bridge.port+'/mcp';
  agent=await openPropertyClient({url:endpoint,workspace:alias,tokenEnv:'PROPERTY_RECEIVING_TOKEN',environment:{PROPERTY_RECEIVING_TOKEN:journal.bridge.token}});
  const advertised=await rpc(endpoint,journal.bridge.token,{jsonrpc:'2.0',id:1,method:'tools/list',params:{}});
  const names=advertised.tools.map(t=>t.name).sort(),expected=tools.map(t=>t.name).sort();
  need(new Set(names).size===22&&same(names,expected),'PROPERTY_RECEIVING_TOOL_CATALOG');
  await writeJSON(join(outputDirectory,'MCP_Tools.json'),advertised);
  if(!journal.paidImport){
   need(!readOnly,'PROPERTY_RECEIVING_IMPORT_MISSING');
   journal.paidImport={key:'property-paid-'+hash(Buffer.from(journal.id)).slice(0,48)};await save();
  }
  if(!journal.paidImport.prepared){need(!readOnly,'PROPERTY_RECEIVING_IMPORT_MISSING');
   const result=await agent.fileImportPrepare({fileAlias:'paid-hpd-delivery',bytes:paidDelivery.bytes,sha256:paidDelivery.sha256,key:journal.paidImport.key,
    actor:baseline.actor,note:'Retain the already completed HPD paid customer delivery as source evidence. This is not a new vendor response or purchase.'});
   journal.paidImport.prepared=result.prepared;await save();
  }
  const importState=await agent.inspectRequest({prepared:journal.paidImport.prepared});
  if(importState.native.disposition!=='DONE')need(!readOnly&&importState.native.disposition==='ABSENT_AT_ORIGINAL_REVISION','PROPERTY_RECEIVING_IMPORT_PENDING');
  journal.paidImport.result=await agent.invoke({prepared:journal.paidImport.prepared});await save();
  need(journal.paidImport.result.native.result.file.sha256===paidDelivery.sha256,'PROPERTY_RECEIVING_PAID_INPUT_CHANGED');
  state=await client.status();
  const groups=['baselines','selections','contracts','requests','editions','reviews','comparisons','bindings','documents','resources'];
  const recordFiles=[],allRecords={};let invoked=0;
  for(const group of groups){
   let offset=0,total=null;const records=[];
   do{const page=await agent.records({group,offset,limit:250,expectedRevision:state.property.revision});invoked++;
    total??=page.page.total;need(page.page.total===total&&page.revision===state.property.revision,'PROPERTY_RECEIVING_INVENTORY_CHANGED');
    records.push(...page.records);offset=page.page.next;
   }while(offset!==null);
   need(records.length===total&&same(records,state.property[group]),'PROPERTY_RECEIVING_INVENTORY_CHANGED');
   allRecords[group]=[];
   for(const row of records){
    const native=await client.record(group,row.id),received=await agent.record({group,id:row.id});invoked++;
    need(same(native,received.native),'PROPERTY_RECEIVING_RECORD_CHANGED');allRecords[group].push(native.result.record);
    const name='records/'+group+'/'+member(row.id)+'.json';await writeJSON(join(outputDirectory,name),native.result.record);recordFiles.push(name);
   }
  }
  await writeJSON(join(outputDirectory,'Native_Records.json'),allRecords);
  let offset=0;const files=[];
  do{const page=await agent.files({offset,limit:250,expectedRevision:state.property.revision});files.push(...page.files);offset=page.page.next;}while(offset!==null);
  need(same(files,state.property.files),'PROPERTY_RECEIVING_FILES_CHANGED');
  for(const file of files){
   const selection={kind:'property',file:file.file,bytes:file.bytes,sha256:file.sha256};
   const native=await agent.file({selection});need(native.native.descriptor.sha256===file.sha256,'PROPERTY_RECEIVING_FILE_CHANGED');
   await receiveNativeFile(client,selection,join(outputDirectory,'native-files',member(file.file)));
  }
  await writeJSON(join(outputDirectory,'Native_Files.json'),files);
  if(!journal.query){
   need(!readOnly,'PROPERTY_RECEIVING_QUERY_MISSING');journal.query={pages:[],next:null,started:false,complete:false};await save();
  }
  while(!journal.query.complete){
   need(!readOnly,'PROPERTY_RECEIVING_QUERY_PENDING');
   const query={limit:'250',...(journal.query.next?{cursor:journal.query.next}:{})};
   journal.query.pending={query,at:now()};await save();
   const result=await agent.action({action:'dataset.query',payload:{query}});
   need(result.native.result.status===200,'PROPERTY_RECEIVING_QUERY_FAILED');
   const page=result.native.result;need(!journal.query.snapshot||page.snapshot===journal.query.snapshot,'PROPERTY_RECEIVING_SNAPSHOT_CHANGED');
   journal.query.snapshot=page.snapshot;journal.query.total??=page.body.page.total;
   need(page.body.page.total===journal.query.total&&page.body.rows.length===page.body.page.returned,'PROPERTY_RECEIVING_QUERY_CHANGED');
   const name='query/page-'+String(journal.query.pages.length).padStart(6,'0')+'.json';await writeJSON(join(outputDirectory,name),page);
   journal.query.pages.push({path:name,...await identity(join(outputDirectory,name)),returned:page.body.page.returned});
   const next=page.body.page.nextCursor;need(next===null||typeof next==='string'&&next!==journal.query.next,'PROPERTY_RECEIVING_CURSOR');
   journal.query.next=next;journal.query.started=true;journal.query.complete=next===null;delete journal.query.pending;await save();
  }
  need(journal.query.pages.reduce((n,p)=>n+p.returned,0)===journal.query.total,'PROPERTY_RECEIVING_QUERY_INCOMPLETE');
  // package.export has no idempotency key. Save its preimage and require native readback after a lost response.
  if(!journal.nativeExport){
   const current=await client.status();
   if(journal.exportRequest){
    const added=current.exports.filter(e=>!journal.exportRequest.before.includes(e.id));
    need(added.length===1,'PROPERTY_RECEIVING_EXPORT_PENDING','Reconcile the original export before any new export request.');
    journal.nativeExport=added[0];await save();
   }else{
    need(!readOnly,'PROPERTY_RECEIVING_EXPORT_MISSING');
    journal.exportRequest={before:current.exports.map(e=>e.id),createdAt:current.createdAt,propertyId:current.property.id,revision:current.property.revision,requestedAt:now()};await save();
    const result=await agent.action({action:'package.export',payload:{}});journal.nativeExport=result.native.result;await save();
   }
  }
  state=await client.status();const nativeExport=state.exports.find(e=>e.id===journal.nativeExport.id);
  need(nativeExport&&same(nativeExport,journal.nativeExport),'PROPERTY_RECEIVING_EXPORT_CHANGED');
  const prepared=await agent.exportPrepare({createdAt,selection:{kind:'source-export',exportId:nativeExport.id}});
  if(journal.receiving)need(prepared.exportId===journal.receiving.exportId&&prepared.manifestFile.sha256===journal.receiving.manifestFile.sha256,'PROPERTY_RECEIVING_EXPORT_CHANGED');
  else{journal.receiving=prepared;await save();}
  const downloadDirectory=join(outputDirectory,'customer-export');
  const downloaded=await agent.download({directory:downloadDirectory,exportId:prepared.exportId,expectedManifestSha256:prepared.manifestFile.sha256});
  const inspection=await agent.inspectDownload({directory:downloadDirectory,exportId:prepared.exportId,expectedManifestSha256:prepared.manifestFile.sha256});
  await agent.close();agent=null;
  await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));server=null;
  await merchant.close();merchant=null;
  const offline=await reopenPropertyExport({directory:downloadDirectory,exportId:prepared.exportId,expectedManifestSha256:prepared.manifestFile.sha256});
  const after=await client.status();
  need(after.createdAt===createdAt&&after.property.id===state.property.id&&same(after.property,state.property)&&same(after.captures,state.captures)&&same(after.editions,state.editions),'PROPERTY_RECEIVING_BORROWER_CHANGED_OWNER');
  const snapshot=sourceIdentity(after);
  if(journal.snapshot)need(same(journal.snapshot,snapshot),'PROPERTY_RECEIVING_REOPEN_CHANGED');else{journal.snapshot=snapshot;await save();}
  let result={schema:'stellar-forge.property-attached-receiving.v1',status:'COMPLETE',createdAt,propertyId:after.property.id,
   propertyRevision:after.property.revision,baselineId:journal.baselineId,source:journal.initial,
   paidDelivery:{bytes:paidDelivery.bytes,sha256:paidDelivery.sha256,customerId:paidDelivery.customerId,acquisitionId:paidDelivery.acquisitionId,snapshot:paidDelivery.snapshot,newPurchases:0},
   tools:{count:names.length,names,meaning:'Complete advertised catalog; the receiving methods above were invoked on the original workspace.'},
   records:groups.map(group=>({group,count:allRecords[group].length})),files:{count:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)},
   query:journal.query,nativeExport,receiving:prepared,downloaded,inspection,offline,borrowerClosedOwner:false,readOnly,
   originalVendorRequestsCreated:0,completedAt:now()};
  // This file belongs to receiving history; later read-only reopening writes a separate report.
  const report=join(outputDirectory,readOnly?'Reopened_Attached_Receiving.json':'Attached_Receiving.json');
  if(await exists(report)){const old=await readJSON(report);need(old.status==='COMPLETE'&&old.createdAt===createdAt&&old.propertyId===after.property.id&&old.propertyRevision===after.property.revision&&same(old.nativeExport,nativeExport)&&old.receiving.exportId===prepared.exportId,'PROPERTY_RECEIVING_REPORT_CHANGED');result=old;}else await writeJSON(report,result);
  const savedResult={path:report,...await identity(report),propertyId:after.property.id,revision:after.property.revision,complete:true};
  if(readOnly)journal.reopenedResult=savedResult;else journal.result=savedResult;await save();
  return {...result,report,portableFile:join(downloadDirectory,'files','starforge-socrata.json.gz'),snapshot};
 }catch(error){primary=error;journal.failures.push({...view(error),at:now()});await save().catch(()=>{});throw error;}
 finally{
  const errors=[];if(agent)try{await agent.close();}catch(e){errors.push(e);}
  if(server)try{await new Promise((done,reject)=>server.close(e=>e?reject(e):done()));}catch(e){errors.push(e);}
  if(merchant)try{await merchant.close();}catch(e){errors.push(e);}
  try{await client.close();}catch(e){errors.push(e);}
  if(errors.length){if(primary)primary.closeErrors=errors.map(view);else throw new AggregateError(errors,'The original receiving borrowers did not drain.');}
 }
}
