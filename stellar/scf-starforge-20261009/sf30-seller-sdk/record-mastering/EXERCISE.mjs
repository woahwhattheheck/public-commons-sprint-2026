// MIT. Complete original customer workflow; all working state stays in the explicitly new output directory.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
if(!process.argv[2]||!process.argv[3])throw Error('Usage: node EXERCISE.mjs SOURCE_DIRECTORY NEW_OUTPUT_DIRECTORY [ORIGINAL_SOURCE_DIRECTORY] [ORIGINAL_WORKSPACE_FILE]');
const source=resolve(process.argv[2]);const work=resolve(process.argv[3]);if(existsSync(work))throw Error('The output directory must be new.');mkdirSync(work,{recursive:true});
const {RecordMasteringClient}=await import(pathToFileURL(join(source,'client.mjs')));
const {serveWorkspace}=await import(pathToFileURL(join(source,'server.mjs')));
const {MerchantRecordMastering,readMasteringConfiguration}=await import(pathToFileURL(join(source,'mcp.mjs')));
const originalSource=process.argv[4]&&resolve(process.argv[4]);
const original=originalSource ? await import(pathToFileURL(join(originalSource,'client.mjs'))):null;
const originalArchive=process.argv[5]&&resolve(process.argv[5]);
const {createExampleWorkspace}=await import(pathToFileURL(join(source,'example-workspace.mjs')));
const received=originalArchive ? RecordMasteringClient.receive(originalArchive,join(work,'customer')) : createExampleWorkspace(join(work,'customer'));
let initialRevision;
const client=new RecordMasteringClient({directory:received.directory});
const reference=original&&new original.RecordMasteringClient({directory:received.directory});
const service=await serveWorkspace(client.workspace);const token=new URL(service.url).hash.slice(1);
let checks=0;const stages=[];const sha=b=>createHash('sha256').update(b).digest('hex');
async function call(action,input={}){const r=await fetch(service.ready.url+'/api/invoke',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({action,input})});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;}
async function write(action,input={}){const status=await call('status');const request={...input,expectedRevision:status.revision,requestId:randomUUID()};const result=await call(action,request);assert.deepEqual(await call(action,request),{...result,replayed:true});return result;}
function same(action,input={}){if(reference){assert.deepEqual(client.invoke(action,input),reference.invoke(action,input));checks++;}return client.invoke(action,input);}
function compare(){const status=same('status');for(const action of ['feeds','rules','deliveries','history'])same(action);const page=same('entities',{limit:500});for(const item of page.items)same('entity',{entityId:item.id});for(const status of ['ready','review','inactive'])same('entities',{status,limit:5});for(const query of ['00102','9007199254740993.02','ALICE','\u0000','É'])same('entities',{query,limit:3});const groups=same('groups',{limit:500});for(const g of groups.items)same('group',{groupId:g.id,limit:2});for(const feed of status.feeds)for(const edition of feed.editions)same('refresh',{editionId:edition.id,limit:2});for(const delivery of client.invoke('deliveries'))same('delivery',{deliveryId:delivery.id});stages.push({revision:status.revision,counts:status.counts});return status;}
let result;
try{
 const initial=compare();initialRevision=initial.revision;
 if(originalArchive){assert.equal(initial.id,'3b04bce9-e389-4b31-aed4-d09df1fc4c8a');assert.equal(initial.revision,22);}
 const entities=await call('entities',{limit:500});let target=entities.items.find(e=>e.status==='ready');
 await write('entity.annotate',{entityId:target.id,label:target.title,note:'Recovered customer workspace operated through its original HTTP writer.'});compare();
 let group=(await call('groups',{limit:500})).items[0];assert.ok(group);
 let members=(await call('group',{groupId:group.id,limit:100})).items.slice(0,2);assert.equal(members.length,2);
 const merge=await write('entity.merge',{groupId:group.id,entityIds:members.map(e=>e.id)});compare();
 let e=await call('entity',{entityId:merge.entityId});
 const field=Object.keys(e.fields).find(f=>e.fields[f].candidates.length);const selected=e.fields[field].candidates[0];
 await write('field.choose',{entityId:e.id,field,mode:'source',recordId:selected.recordId});compare();
 await write('field.choose',{entityId:e.id,field:'name',mode:'custom',value:'Reviewed customer'});compare();
 const split=await write('entity.split',{entityId:e.id,recordIds:[selected.recordId],label:'Separated source contact',note:'Native customer decision'});compare();
 const splitRecord=await call('entity',{entityId:split.entityId});assert.equal(splitRecord.fields[field].choice?.recordId,field==='name'?undefined:selected.recordId);
 await write('record.exclude',{recordId:selected.recordId,excluded:true,reason:'Reviewed duplicate source record'});compare();
 await write('record.exclude',{recordId:selected.recordId,excluded:false});compare();
 const billing=(await call('feeds')).find(f=>f.name==='Billing customers');
 const edition=await write('source.import',{feedId:billing.id,label:'Retained correction re-received',base64:readFileSync(join(source,'example/billing-corrections.csv')).toString('base64')});
 compare();const plan=await call('refresh',{editionId:edition.editionId,limit:1});
 await write('source.activate',{editionId:edition.editionId,planSha256:plan.planSha256});compare();
 const columns=['name','email','company','phone','balance','postal_code'];
 const delivery=await write('delivery.create',{title:'Recovered customer dataset',mode:'all',columns});compare();
 const response=await fetch(service.ready.url+'/api/delivery/'+delivery.deliveryId,{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());writeFileSync(join(work,'customer-delivery.gz'),bytes);
 const unpacked=RecordMasteringClient.unpackDelivery(join(work,'customer-delivery.gz'),join(work,'customer-files'));
 assert.equal(unpacked.rowCount,delivery.rowCount);
 const backup=await fetch(service.ready.url+'/api/backup',{headers:{Authorization:'Bearer '+token}});assert.equal(backup.status,200);
 const archive=Buffer.from(await backup.arrayBuffer());writeFileSync(join(work,'customer-workspace.gz'),archive);
 const snapshot=await call('status');const cold=RecordMasteringClient.receive(join(work,'customer-workspace.gz'),join(work,'cold-received'),sha(archive));
 assert.equal(cold.workspaceId,snapshot.id);assert.deepEqual(cold.counts,snapshot.counts);
 const coldClient=new RecordMasteringClient({directory:cold.directory});try{assert.deepEqual(coldClient.invoke('status'),snapshot);const row=coldClient.invoke('entities',{limit:1}).items[0];coldClient.invoke('entity.annotate',{entityId:row.id,label:row.title,note:'Independent receiving edit',expectedRevision:snapshot.revision,requestId:randomUUID()});assert.equal(coldClient.invoke('status').revision,snapshot.revision+1);assert.equal((await call('status')).revision,snapshot.revision);coldClient.export(join(work,'independently-edited.gz'));assert.deepEqual(coldClient.workspace.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),client.workspace.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all());}finally{coldClient.close();}
 const configFile=join(work,'connection.json');writeFileSync(configFile,JSON.stringify({schema:'stellar-forge.record-mastering.v1.connection',workspaces:{customers:{directory:'customer',label:'Customer records',exportsDirectory:'merchant-exports',receiveRoot:'merchant-received',inputs:{backup:{path:'customer-workspace.gz',sha256:sha(archive)}}}}}));
 const config=readMasteringConfiguration(configFile);const provider=new MerchantRecordMastering({recordMastering:config});
 let packet, chunks=0;try{
  const catalogue=await provider.call('merchant_mastering_workspaces');assert.equal(catalogue.workspaces.length,1);
  const status=await provider.call('merchant_mastering_query',{workspace:'customers',action:'status'});assert.deepEqual(status,snapshot);
  const expArgs={workspace:'customers',kind:'workspace',expectedRevision:status.revision,requestId:'recovered-complete-customer'};
  packet=await provider.call('merchant_mastering_export',expArgs);assert.deepEqual(await provider.call('merchant_mastering_export',expArgs),{...packet,replayed:true});
  const parts=[];let offset=0;while(offset!==null){const part=await provider.call('merchant_mastering_file_read',{workspace:'customers',sha256:packet.sha256,offset,limit:2048});const b=Buffer.from(part.base64,'base64');assert.equal(sha(b),part.chunkSha256);parts.push(b);offset=part.nextOffset;chunks++;}
  assert.equal(sha(Buffer.concat(parts)),packet.sha256);writeFileSync(join(work,'merchant-workspace.gz'),Buffer.concat(parts));
  const receiveArgs={workspace:'customers',input:'backup',name:'review-team',expectedSha256:sha(archive)};
  const first=await provider.call('merchant_mastering_receive',receiveArgs);assert.equal(first.workspaceId,snapshot.id);
  const again=await provider.call('merchant_mastering_receive',receiveArgs);assert.equal(again.replayed,true);
 }finally{await provider.close();}
 const reopened=new MerchantRecordMastering({recordMastering:config});try{const list=await reopened.call('merchant_mastering_workspaces');assert.ok(list.workspaces.some(w=>w.workspace==='customers__review-team'));}finally{await reopened.close();}
 result={schema:'stellar-forge.record-mastering.recovery.v1',workspaceId:snapshot.id,initialRevision,finalRevision:snapshot.revision,counts:snapshot.counts,deliveryId:delivery.deliveryId,deliveryRows:delivery.rowCount,oldEngineReadComparisons:checks,nativeHttp:true,portableReceive:true,independentEdit:true,merchantRestart:true,merchantChunks:chunks,merchantPacket:packet,stages};
 writeFileSync(join(work,'RECEIVING.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await service.close();reference?.close();client.close();}
