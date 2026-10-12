import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,rename,mkdir,stat,readdir,open} from 'node:fs/promises';
import {join} from 'node:path';

const project='/workspace/scratch/d1ccf784531e/scf-native-semantic-receiving';
const root=process.argv[2];
assert.equal(root,join(project,'operation-remaining2'));
const priorRoot=join(project,'operation-remaining1');
const priorRaw=await readFile(join(priorRoot,'results.json'));
assert.equal(createHash('sha256').update(priorRaw).digest('hex'),'31f0936d55b9a61540c8ef07e2a403fd39ead0b48d0943d6c81efa78ea5ab03d');
const prior=JSON.parse(priorRaw);
assert.equal(prior.status,'INTERRUPTED');
assert.deepEqual(prior.stages,['original-finalized-room-received','original-analysis-imported','complete-query-delivered','customer-report-published']);
const completed=stage=>prior.stages.includes(stage);
const originalRoot=join(project,'operation');
const predecessorRaw=await readFile(join(originalRoot,'results.json'));
assert.equal(createHash('sha256').update(predecessorRaw).digest('hex'),'ac457ee2bc8bb422ce0786eabc4295d8d0cda248d268ea336c7492d084b83435');
const predecessor=JSON.parse(predecessorRaw);
assert.equal(predecessor.status,'INTERRUPTED');assert.deepEqual(predecessor.stages,[]);
const closureRaw=await readFile(join(project,'source-closure-db3d.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const expectedClosureSha256=process.argv[3];
assert.match(expectedClosureSha256??'',/^[a-f0-9]{64}$/,'Pass the exact completed source-closure SHA256.');
assert.equal(sha(closureRaw),expectedClosureSha256);
const closure=JSON.parse(closureRaw),checkout=closure.sourceRoot;
assert.equal(prior.sourceClosureSha256,sha(closureRaw));
const source=join(checkout,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python'),cli=join(checkout,'stellar-forge/mcp-paid-agent/native-workspace-cli.mjs');
const database=join(originalRoot,'database');
const native=join(originalRoot,'mcp'),room='/workspace/scratch/c271b14dff0a/ckan-semantics-staged/receiving/customer-delivery';
const acquisitionId='svk-capacity-finalized-20261012-d1cc';
const semanticSha='ffdbbbdeb18432b3cc411ffb31bf75215518e9292e61d101e967abe3417ebc7c';
const dictionarySha='1f0ed80fd805c8c730226a04060747ce7106c2dee2337af7f33c5b7573770a25';
const python=process.env.SCF_SEMANTIC_PYTHON;
assert.ok(python?.startsWith('/'));
const opId=label=>sha('d1cc-native-semantic-receiving-20261012:'+label).slice(0,32);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const children=new Set();
const say=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function exists(path){try{await stat(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
async function save(name,value){
 const path=join(root,name),temporary=path+'.tmp-'+process.pid;
 await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temporary,path);
}
await mkdir(root,{recursive:true,mode:0o700});
await mkdir(join(root,'tmp'),{recursive:true,mode:0o700});
let secret=await optional(join(root,'private-environment.json'))??await optional(join(originalRoot,'private-environment.json'));
if(!secret){secret={mcpToken:randomBytes(32).toString('base64url')};await save('private-environment.json',secret);}
const token=secret.mcpToken;
const env={...process.env,PYTHONPATH:source,PYTHONDONTWRITEBYTECODE:'1',NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',
 MCP_ACCESS_TOKEN:token,TMPDIR:join(root,'tmp'),TMP:join(root,'tmp'),TEMP:join(root,'tmp')};
const result=await optional(join(root,'results.json'))??{
 ...prior,
 continuationOperation:'SCF-NATIVE-SEMANTIC-RECEIVING-20261012-D1CC-REMAINING-2',
 predecessor:{operation:prior.continuationOperation,result:join(priorRoot,'results.json'),resultSha256:sha(priorRaw),
  original:prior.predecessor,sourceClosureSha256:prior.sourceClosureSha256},
 stages:[...prior.stages],status:'RUNNING'};
delete result.error;
await save('results.json',result);
say({stage:'resuming-retained-customer',completedStages:prior.stages,predecessorSha256:sha(priorRaw),newAcquisitions:0,newProviderRequests:0,newPayments:0});

function child(command,args){
 const p=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});
 children.add(p);p.once('close',()=>children.delete(p));return p;
}
async function stop(p){
 if(!p||p.exitCode!==null||p.signalCode!==null)return;
 const done=new Promise(resolve=>p.once('close',resolve));p.kill('SIGINT');
 const timer=setTimeout(()=>p.kill('SIGKILL'),7000);try{await done}finally{clearTimeout(timer)}
}
async function command(program,args){
 const p=child(program,args);let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err=(err+b).slice(-12000));
 const code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve)});
 if(code!==0)throw new Error('Original host command failed '+code+' '+err);
 return out.trim()?JSON.parse(out):null;
}
async function listen(program,args,status){
 const p=child(program,args);let out='',err='',timer;
 p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');
 const ready=new Promise((resolve,reject)=>{
  let settled=false;
  const fail=error=>{if(!settled){settled=true;reject(error)}};
  p.stdout.on('data',chunk=>{
   if(settled)return;out+=chunk;
   if(Buffer.byteLength(out)>65536){fail(new Error('Original readiness exceeds 64 KiB'));return}
   let value;try{value=JSON.parse(out)}catch{return}
   if(!value||value.status!==status){fail(new Error('Unexpected original readiness '+status));return}
   settled=true;resolve(value);
  });
  p.stderr.on('data',chunk=>err=(err+chunk).slice(-12000));
  p.once('error',fail);p.once('close',code=>fail(new Error('Original '+status+' exited '+code+' '+err)));
 });
 try{return {process:p,value:await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Original readiness timeout '+status)),45000))])}}
 finally{clearTimeout(timer)}
}
let analysisProcess,mcpProcess,address,rpcId=0,alias='semantic_customer';
async function startAnalysis(folder){
 const service=await listen(python,['-m','stellar_forge_buyer.analysis_workspace','--database',folder,
  '--checkout',checkout,'--node',process.execPath,'serve','--port','0'],'LISTENING');
 analysisProcess=service.process;return JSON.parse(await readFile(join(folder,'analysis-launch.json'),'utf8'));
}
async function startMcp(){
 const service=await listen(process.execPath,[cli,'serve','--dir',native,'--port','0'],'NATIVE_MCP_LISTENING');
 mcpProcess=service.process;address=service.value.url;
 const initialized=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},
  clientInfo:{name:'original-semantic-dataset-customer',version:'1'}});
 assert.equal(initialized.protocolVersion,'2025-11-25');
}
async function rpc(method,params={}){
 const response=await fetch(address,{method:'POST',headers:{authorization:'Bearer '+token,
  'content-type':'application/json',accept:'application/json, text/event-stream',
  'mcp-protocol-version':'2025-11-25'},signal:AbortSignal.timeout(120000),
  body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
 assert.equal(response.status,200);
 const body=await response.json();if(body.error)throw new Error(JSON.stringify(body.error));return body.result;
}
async function call(operation,request={}){
 const response=await rpc('tools/call',{name:'sf43_discover_review_and_pay',arguments:{
  action:'analysis',analysisWorkspace:alias,analysisOperation:operation,analysisRequest:request}});
 const data=response.structuredContent??JSON.parse(response.content[0].text);
 if(response.isError)throw Object.assign(new Error(data.reason??data.code??JSON.stringify(data)),{code:data.code});
 assert.equal(data.schema,'stellar-forge.mcp-native-analysis.v1');assert.equal(data.operation,operation);
 return data.result;
}
async function registerAnalysis(name,folder){
 const record=await optional(join(native,'analysis/workspaces',name+'.json'));
 if(record){assert.equal(record.database,folder);assert.equal(record.nativeWorkspace,native);return record}
 return command(process.execPath,[cli,'analysis-register','--dir',native,'--name',name,'--database',folder]);
}
async function job(kind,label,request){
 const id=opId(label);let value;
 const retained=await optional(join(priorRoot,'job-'+label+'.json'));
 if(retained?.status==='COMPLETE'){
  value=await call('job',{id,limit:100});assert.equal(value.id,id);assert.equal(value.kind,kind);
  assert.equal(value.status,'COMPLETE');assert.deepEqual(value.result,retained.result);
  return value;
 }
 await call(kind,{id,...request});
 for(let n=0;n<600;n++){
  value=await call('job',{id,limit:100});if(value.status!=='RUNNING')break;await sleep(100);
 }
 await save('job-'+label+'.json',value);
 if(value.status!=='COMPLETE')throw new Error('Original '+kind+' '+id+' ended '+value.status+' '+value.error);
 return value;
}
async function checkpoint(stage,details){
 if(completed(stage)){assert.deepEqual(details,prior[stage]);return;}
 if(!result.stages.includes(stage))result.stages.push(stage);
 result[stage]=details;await save('results.json',result);say({stage,...details});
}
async function fileIdentity(path){
 const hash=createHash('sha256');let bytes=0;
 for await(const block of createReadStream(path)){bytes+=block.length;hash.update(block)}
 return {bytes,sha256:hash.digest('hex')};
}
async function originalInputs(){
 const files=[];
 async function walk(path){for(const item of await readdir(path,{withFileTypes:true})){
  const next=join(path,item.name);assert.equal(item.isSymbolicLink(),false);
  if(item.isDirectory())await walk(next);else if(item.isFile())files.push(next);
 }}
 await walk(room);
 const values=[];for(const path of files.sort())values.push({path,...await fileIdentity(path)});return values;
}
async function dataset(action,body={}){
 const response=await rpc('tools/call',{name:'sf43_discover_review_and_pay',
  arguments:{action,...(action==='dataset-history'?{}:{acquisitionId}),...body}});
 const data=response.structuredContent??JSON.parse(response.content[0].text);
 if(response.isError)throw new Error(data.reason??data.code??JSON.stringify(data));
 return data;
}
async function dictionaryFromDataset(){
 const parts=[];let offset=0;
 while(true){
  const value=await dataset('dataset-read',{filename:'semantics.json',byteOffset:offset,maxBytes:8192});
  const file=value.result;
  assert.equal(file.sha256,dictionarySha);assert.equal(file.byteOffset,offset);
  const data=Buffer.from(file.data,'base64');assert.equal(data.length,file.returnedBytes);
  parts.push(data);offset+=data.length;
  if(file.nextByteOffset===null)break;
  assert.equal(file.nextByteOffset,offset);
 }
 const raw=Buffer.concat(parts);assert.equal(sha(raw),dictionarySha);return raw;
}
async function dictionaryFromAnalysis(version){
 const parts=[];let offset=0;
 while(true){
  const value=await call('semantics-file',{version_id:version,sha256:dictionarySha,byteOffset:offset,maxBytes:8192});
  const file=value.file;assert.equal(file.verified,true);assert.equal(file.byteOffset,offset);
  const bytes=Buffer.from(file.data,'base64');assert.equal(bytes.length,file.returnedBytes);
  parts.push(bytes);offset+=bytes.length;
  if(file.nextByteOffset===null)break;
  assert.equal(file.nextByteOffset,offset);
 }
 const raw=Buffer.concat(parts);assert.equal(sha(raw),dictionarySha);return raw;
}
async function download(kind,build,filename){
 const record=kind==='report'?{...build.result,name:filename}:build.result.files.find(file=>file.name===filename);
 assert.ok(record);
 const retained=join(priorRoot,'downloaded',build.id,filename);
 if(await exists(retained)){assert.deepEqual(await fileIdentity(retained),{bytes:record.bytes,sha256:record.sha256});return {path:retained,...record};}
 const folder=join(root,'downloaded',build.id);await mkdir(folder,{recursive:true,mode:0o700});
 const destination=join(folder,filename);
 if(await exists(destination)){assert.deepEqual(await fileIdentity(destination),{bytes:record.bytes,sha256:record.sha256});return {path:destination,...record};}
 const temporary=destination+'.part';const output=await open(temporary,'w',0o600);let offset=0;
 try{
  while(offset<record.bytes){
   const operation=kind==='workbook'?'workbook-file':kind==='query'?'query-export-file':
    kind==='archive'?'workspace-archive-file':'file';
   const request={id:build.id,sha256:record.sha256,byteOffset:offset,maxBytes:65536};
   if(kind!=='report')request.filename=filename;
   if(kind==='workbook')request.manifest_sha256=build.result.manifest_sha256;
   if(kind==='archive')request.manifest_sha256=build.result.files.find(file=>file.name==='archive-manifest.json').sha256;
   const value=await call(operation,request),file=value.file;
   assert.equal(file.verifiedSavedFile,true);assert.equal(file.byteOffset,offset);
   assert.equal(file.sha256,record.sha256);assert.equal(file.bytes,record.bytes);
   const bytes=Buffer.from(file.data,'base64');assert.equal(bytes.length,file.returnedBytes);assert.ok(bytes.length>0);
   let written=0;while(written<bytes.length){const r=await output.write(bytes,written,bytes.length-written);assert.ok(r.bytesWritten>0);written+=r.bytesWritten}
   offset+=bytes.length;assert.equal(file.nextByteOffset,offset===record.bytes?null:offset);
  }
  await output.sync();
 }finally{await output.close()}
 assert.deepEqual(await fileIdentity(temporary),{bytes:record.bytes,sha256:record.sha256});
 await rename(temporary,destination);return {path:destination,...record};
}
async function saveQuery(name,sql){
 const state=await call('state');
 if(state.queries.some(item=>item.name===name)){
  const prior=await call('saved-query',{name});assert.equal(prior.sql,sql);assert.equal(prior.parameters_text,'[]');return prior;
 }
 return call('save-query',{name,sql,parameters_text:'[]',max_rows:100,expected_revision:0});
}
try{
 const retainedOriginalInputs=await optional(join(originalRoot,'original-inputs.json'));
 assert.ok(Array.isArray(retainedOriginalInputs)&&retainedOriginalInputs.length>0,'The first attempt retained original source custody');
 const before=await optional(join(root,'original-inputs.json'))??retainedOriginalInputs;
 assert.deepEqual(before,retainedOriginalInputs);
 await save('original-inputs.json',before);assert.deepEqual(await originalInputs(),before);
 const originalManifest=JSON.parse(await readFile(join(room,'manifest.json'),'utf8'));
 const originalDictionary=await readFile(join(room,'semantics.json'));
 assert.equal(originalManifest.dataset.rows,32);
 assert.equal(originalManifest.semantics.sha256,semanticSha);assert.equal(sha(originalDictionary),dictionarySha);
 assert.equal(originalManifest.paymentStatus,'NOT_INFERRED_FROM_SOURCE_HTTP_OR_LOCAL_HASHES');
 if(!await exists(join(native,'native-workspace.json'))){
  const previous=JSON.parse(await readFile('/workspace/scratch/d1ccf784531e/scf-native-agent-workbooks/operation/mcp/native-workspace.json','utf8'));
  await command(process.execPath,[cli,'init','--dir',native,'--workspace',previous.workspace]);
 }
 if(!completed('original-finalized-room-received')){
  const registered=await command(process.execPath,[cli,'datasets-receive','--dir',native,'--id',acquisitionId,'--room',room]);
  assert.equal(registered.status,'FINALIZED_DATASET_REGISTERED');
  assert.equal(registered.sourceFormat,'SF100_SCAN');assert.equal(registered.readOnly,true);
 }
 const launch=await startAnalysis(database);await registerAnalysis(alias,database);await startMcp();
 const tools=await rpc('tools/list'),descriptor=tools.tools.find(tool=>tool.name==='sf43_discover_review_and_pay');
 for(const op of ['dataset-semantics','semantics','semantic-compare','semantics-file','attach-dataset'])
  assert.ok(JSON.stringify(descriptor.inputSchema).includes(op),op);
 const status=await dataset('dataset-status');
 assert.equal(status.status,'COMPLETE');assert.equal(status.report.rows,32);assert.equal(status.report.pages,7);
 assert.equal(status.sourceFormat,'SF100_SCAN');
 const history=await dataset('dataset-history',{limit:100});
 assert.ok(history.records.some(row=>row.acquisitionId===acquisitionId&&row.readOnly));
 if(!completed('original-finalized-room-received')){
 const meaning=[];
 let offset=0;
 do{
  const page=await dataset('dataset-semantics',{dictionarySection:'columns',offset,limit:3,maxBytes:32768});
  assert.equal(page.semantics.sha256,semanticSha);assert.ok(Buffer.byteLength(JSON.stringify(page))<=32768);
  meaning.push(...page.items);offset=page.range.nextOffset;
 }while(offset!==null);
 assert.equal(meaning.length,JSON.parse(originalDictionary).columns.length);
 assert.deepEqual(await dictionaryFromDataset(),originalDictionary);
 const typed=[];
 offset=0;
 do{
  const page=await dataset('dataset-rows',{offset,limit:7,maxBytes:32768});
  typed.push(...page.rows);offset=page.range.nextOffset;
 }while(offset!==null);
 assert.equal(typed.length,32);
 await save('native-meaning.json',{source:status.source,columns:meaning});
 }
 await checkpoint('original-finalized-room-received',{workspaceId:launch.workspace_id,acquisitionId,
  sourceFormat:'SF100_SCAN',session:null,rows:32,pages:7,semanticSha256:semanticSha,
  dictionarySha256:dictionarySha,manifestSha256:status.source.manifestSha256,
  sourceBindingSha256:status.sourceBindingSha256,readOnly:true});

 const attachRequest={acquisition_id:acquisitionId,name:'svk_capacity',expected_revision:0};
 const attached=completed('original-analysis-imported')?await optional(join(priorRoot,'native-source.json')):await call('attach-dataset',attachRequest);
 if(completed('original-analysis-imported')){
  const current=(await call('state')).sources.find(item=>item.name===attached.name);
  assert.equal(current.revision,attached.revision);assert.deepEqual(current.expected_native,attached.expected_native);
 }
 assert.equal(attached.kind,'finalized-dataset');assert.equal(attached.source_format,'SF100_SCAN');
 assert.equal(attached.revision,1);assert.equal(attached.rows,32);
 assert.equal(attached.expected_native.sourceBindingSha256,status.sourceBindingSha256);
 if(!completed('original-analysis-imported')){
  assert.deepEqual(await call('attach-dataset',attachRequest),attached);await save('native-source.json',attached);
 }
 const imported=await job('import','original-typed-import',{source:attached.name,source_revision:1,
  columns_text:JSON.stringify({observation_id:'observation_key'})});
 const version=imported.result.version;assert.equal(version.row_count,32);
 const semantic=await call('semantics',{version_id:version.version_id,section:'mapping',limit:100,maxBytes:65536});
 assert.equal(semantic.semantic_sha256,semanticSha);
 assert.ok(semantic.items.some(column=>column.source==='observation_id'&&column.column==='observation_key'));
 assert.deepEqual(await dictionaryFromAnalysis(version.version_id),originalDictionary);
 await checkpoint('original-analysis-imported',{source:attached.name,sourceRevision:1,versionId:version.version_id,
  rows:32,semanticSha256:semanticSha,definitionSha256:semantic.definition_sha256,
  captureManifestSha256:semantic.capture_manifest_sha256,sourceColumn:'observation_id',sqlColumn:'observation_key'});

 const view='svk_observations',selected=(await call('state')).views.find(item=>item.name===view);
 if(selected)assert.equal(selected.version_id,version.version_id);
 else await call('activate',{name:view,version_id:version.version_id,expected_revision:0});
 const sql='SELECT observation_key, event_id, starts_at_sweden, starts_at_utc, bidding_zone, product, direction, price, price_unit, volume, volume_unit FROM svk_observations ORDER BY event_id, observation_key';
 const summarySql='SELECT bidding_zone, product, direction, price_unit, volume_unit, COUNT(*) AS observations FROM svk_observations GROUP BY bidding_zone, product, direction, price_unit, volume_unit ORDER BY bidding_zone, product, direction, price_unit, volume_unit';
 const recipe=await saveQuery('svk_complete_observations',sql),overview=await saveQuery('svk_observations_by_units',summarySql);
 const query=await job('query','complete-observations',{sql,parameters_text:'[]',max_rows:100,expected_views:(await call('state')).views});
 assert.equal(query.result.rows.length,32);assert.equal(query.result.truncated,false);
 const exported=await job('query-export','complete-query-output',{query_id:query.id,result_sha256:query.result.result_sha256,
  label:'SVK capacity-market observations with original semantic dictionary',formats:['jsonl','csv','sqlite']});
 const queryFiles=[];
 for(const filename of ['manifest.json','rows.jsonl','rows.csv','rows.sqlite3'])queryFiles.push(await download('query',exported,filename));
 await checkpoint('complete-query-delivered',{queryId:query.id,rows:32,resultSha256:query.result.result_sha256,
  exportId:exported.id,manifestSha256:exported.result.manifest_sha256,files:queryFiles});

 const reportName='svk_capacity_customer';
 const reportRequest={name:reportName,id:opId('report-definition'),expected_revision:0,
  title:'SVK capacity-market observations',
  introduction:'This customer report uses the complete retained 32-row SF100 room and its original semantic dictionary. The published dataset definition, selected fields, Swedish local and UTC timestamp descriptions, price units and volume units remain the source authority. The view renames observation_id to observation_key without changing its meaning. The summary groups by declared units and does not add unlike quantities. Receiving this room did not create a provider request, SF88 acquisition or payment.',
  sections:[{title:'Complete retained observations',query_name:recipe.name,query_revision:recipe.revision},
   {title:'Observations grouped by declared units',query_name:overview.name,query_revision:overview.revision}]};
 if(!completed('customer-report-published'))await call('save-report',reportRequest);
 const definition=await call('report-definition',{name:reportName,revision:1});
 const report=await job('report','customer-report',{name:reportName,revision:1,definition_sha256:definition.sha256,expected_views:(await call('state')).views});
 const publication=completed('customer-report-published')?{id:prior['customer-report-published'].publicationId}:await call('publish',{report_id:report.id,id:opId('report-publication'),
  result_sha256:report.result.result_sha256,expected_revision:0,
  note:'Reviewed the complete retained room, original dictionary and source-to-SQL mapping. Grouped counts retain price and volume units.'});
 const publicationRow=(await call('publications',{name:reportName})).publications.find(row=>row.publication.id===publication.id);
 assert.ok(publicationRow);
 const reportFiles=[];
 for(const format of ['html','json','csv']){
  const output=await job('report-export','report-'+format,{publication_id:publication.id,publication_sha256:publicationRow.sha256,format});
  reportFiles.push(await download('report',output,'customer-report.'+(format==='csv'?'zip':format)));
 }
 await checkpoint('customer-report-published',{reportId:report.id,publicationId:publication.id,
  publicationSha256:publicationRow.sha256,resultSha256:report.result.result_sha256,files:reportFiles});

 const querySource=(await call('workbook-sources',{kind:'query-export',limit:100})).items.find(item=>item.id===exported.id&&item.available!==false);
 const reportSource=(await call('workbook-sources',{kind:'report',limit:100})).items.find(item=>item.id===publication.id&&item.section===1&&item.available!==false);
 assert.ok(querySource);assert.ok(reportSource);
 const minimal=value=>Object.fromEntries(['kind','id','sha256','section'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
 const columns=[
  ['observation_key','Observation ID','text'],['event_id','Event ID','integer'],
  ['starts_at_sweden','Start (Sweden, original)','text'],['starts_at_utc','Start (UTC, original)','text'],
  ['bidding_zone','Bidding zone','text'],['product','Product','text'],['direction','Direction','text'],
  ['price','Price, exact text','decimal-text'],['price_unit','Price unit','text'],
  ['volume','Volume, exact text','decimal-text'],['volume_unit','Volume unit','text']
 ].map(([source,header,type])=>({source,header,type}));
 const summaryColumns=['bidding_zone','product','direction','price_unit','volume_unit','observations']
  .map((source,source_index)=>({source,source_index,header:source.replaceAll('_',' '),type:source==='observations'?'integer':'text'}));
 const workbookName='svk_capacity_delivery';
 const workbookRequest={name:workbookName,id:opId('workbook-definition'),expected_revision:0,
  title:'SVK capacity-market observations',
  notes:'Original 32-row finalized SF100 source; original dictionary and source-to-SQL mapping retained. Price and volume are exact text to retain precision. Timestamp text and declared units remain unchanged.',
  sheets:[{name:'Observations',source:minimal(querySource),columns},
   {name:'Unit summary',source:minimal(reportSource),columns:summaryColumns}]};
 const workbookDefinition=await call('save-workbook',workbookRequest);
 const workbook=await job('workbook','customer-workbook',{name:workbookName,revision:1,definition_sha256:workbookDefinition.definition_sha256});
 assert.equal(workbook.result.sheets.length,2);assert.ok(workbook.result.row_count>=33);
 const workbookFiles=[];
 for(const filename of ['manifest.json','workbook.xlsx','handoff.zip'])workbookFiles.push(await download('workbook',workbook,filename));
 await checkpoint('editable-workbook-delivered',{buildId:workbook.id,name:workbookName,revision:1,
  definitionSha256:workbook.result.definition_sha256,manifestSha256:workbook.result.manifest_sha256,
  sheets:2,completeSheetRows:workbook.result.row_count,originalObservations:32,files:workbookFiles});

 const archiveReview=await call('workspace-archive-review',{include_previous_backups:false,offset:0,limit:100});
 await save('archive-review.json',archiveReview);assert.equal(archiveReview.ready,true);
 const archived=await job('workspace-export','customer-workspace',{include_previous_backups:false});
 const archiveCli=join(checkout,'stellar-forge/mcp-paid-agent/native-analysis-archive-download.mjs');
 const archiveFile=archived.result.files.find(file=>file.name==='workspace.zip');
 const archiveManifest=archived.result.files.find(file=>file.name==='archive-manifest.json');
 const downloadDirectory=join(root,'portable-download');
 const portable=await command(process.execPath,[archiveCli,'download','--url',address,'--workspace',alias,
  '--id',archived.id,'--dir',downloadDirectory,'--sha256',archiveFile.sha256,
  '--manifest-sha256',archiveManifest.sha256,'--token-env','MCP_ACCESS_TOKEN']);
 assert.equal(portable.state,'COMPLETE');assert.equal(portable.archiveId,archived.id);
 const archiveFiles=portable.files.map(file=>({path:join(downloadDirectory,file.name),...file}));
 await save('portable-download.json',portable);
 await checkpoint('complete-workspace-exported',{archiveId:archived.id,files:archiveFiles});
 await stop(mcpProcess);await stop(analysisProcess);

 const archive=archiveFiles.find(file=>file.name==='workspace.zip'),received=join(root,'received-workspace');
 const receipt=await command(python,['-m','stellar_forge_buyer.workspace_archive_receive','receive',archive.path,received,
  '--operation',opId('portable-receive'),'--sha256',archive.sha256]);
 assert.equal(receipt.workspace_id,launch.workspace_id);await save('portable-receipt.json',receipt);
 const fresh=await startAnalysis(received);assert.equal(fresh.workspace_id,launch.workspace_id);
 alias='received_semantic_customer';await registerAnalysis(alias,received);await startMcp();
 const reopened=await call('state');
 assert.equal(reopened.views.find(item=>item.name===view).version_id,version.version_id);
 const sourceAlias=reopened.sources.find(item=>item.name===attached.name);
 assert.deepEqual(sourceAlias.expected_native,attached.expected_native);
 assert.deepEqual(await dictionaryFromAnalysis(version.version_id),originalDictionary);
 assert.equal((await call('job',{id:query.id,limit:100})).result.result_sha256,query.result.result_sha256);
 assert.equal((await call('job',{id:report.id})).result.result_sha256,report.result.result_sha256);
 assert.equal((await call('job',{id:workbook.id})).result.manifest_sha256,workbook.result.manifest_sha256);
 const relocatedQuery=await call('query-export-file',{id:exported.id,filename:'rows.jsonl',maxBytes:65536,
  sha256:exported.result.files.find(file=>file.name==='rows.jsonl').sha256});
 assert.equal(relocatedQuery.file.verifiedSavedFile,true);
 const relocatedWorkbook=await call('workbook-file',{id:workbook.id,filename:'manifest.json',maxBytes:65536,
  manifest_sha256:workbook.result.manifest_sha256,sha256:workbook.result.files.find(file=>file.name==='manifest.json').sha256});
 assert.equal(relocatedWorkbook.file.verifiedSavedFile,true);
 assert.deepEqual(await dictionaryFromDataset(),originalDictionary);
 await checkpoint('received-customer-reopened',{workspaceId:fresh.workspace_id,directory:received,
  versionId:version.version_id,sourceRevision:sourceAlias.revision,sourceFormat:sourceAlias.source_format,
  semanticSha256:semanticSha,dictionarySha256:dictionarySha,
  queryResultSha256:query.result.result_sha256,reportResultSha256:report.result.result_sha256,
  workbookManifestSha256:workbook.result.manifest_sha256,queryReexecuted:false,workbookRebuilt:false});
 await stop(mcpProcess);await stop(analysisProcess);
 assert.deepEqual(await originalInputs(),before);
 await checkpoint('original-custody-preserved',{files:before.length,originalRoomUnchanged:true,
  rows:32,pages:7,semanticSha256:semanticSha,sourceFormat:'SF100_SCAN',session:null,
  newAcquisitions:0,newProviderRequests:0,newPayments:0});
 result.status='COMPLETE';result.completedAt=new Date().toISOString();delete result.error;
 await save('results.json',result);
 say({status:'COMPLETE',stages:result.stages.length,originalObservations:32,workbookRows:workbook.result.row_count,
  semanticSha256:semanticSha,reportPublicationId:publication.id,workbookId:workbook.id,received});
}catch(error){
 result.status='INTERRUPTED';result.error={code:error.code??null,message:String(error.message),stack:String(error.stack)};
 await save('results.json',result);throw error;
}finally{await Promise.allSettled([...children].map(stop))}
