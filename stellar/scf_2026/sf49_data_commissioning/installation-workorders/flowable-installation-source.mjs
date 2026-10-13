// MIT. Complete original Flowable archive inspection through its maintained receiver.
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openFlowableWorkspace} from '../../../scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/model.mjs';
import {initializationBytes as bytes} from '../../../scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {FLOWABLE_INSTALLATION_SCHEMA as SCHEMA,hash,need,identity,validateFlowableInstallationSource} from './flowable-installation-core.mjs';
const MAX_ARCHIVE=256*1024*1024,MAX_SOURCE=128*1024*1024;
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const ref=x=>({kind:x.kind,id:x.id,revision:x.revision,sha256:x.sha256});
function request(text){
 const a=hash(Buffer.from(text)).slice(0,32).split('');a[12]='4';a[16]=(8+(parseInt(a[16],16)&3)).toString(16);
 const s=a.join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
}
export async function inspectFlowableInstallationSource(archive,{programmeId,programmeRevision,expectedArchiveSha256,expectedProgrammeSha256,expectedBasisSha256,signal}={}){
 need(Buffer.isBuffer(archive)&&archive.length>0&&archive.length<=MAX_ARCHIVE&&/^[a-f0-9]{64}$/.test(expectedArchiveSha256??'')&&hash(archive)===expectedArchiveSha256,'Select the complete original Flowable archive and exact SHA-256 within 256 MiB.');
 need(typeof programmeId==='string'&&programmeId.length>0&&Number.isSafeInteger(programmeRevision)&&programmeRevision>0&&
  /^[a-f0-9]{64}$/.test(expectedProgrammeSha256??'')&&/^[a-f0-9]{64}$/.test(expectedBasisSha256??''),'Select the exact original programme revision, programme-source SHA and native basis SHA.');
 const temporary=await mkdtemp(join(tmpdir(),'flowable-installation-source-'));let workspace,primary;
 try{
  signal?.throwIfAborted();const path=join(temporary,'original.ndjson');await writeFile(path,archive,{flag:'wx',mode:0o600});
  workspace=await openFlowableWorkspace({directory:join(temporary,'receiver'),connections:[],environment:{},
   fetch:async()=>{throw Error('Source inspection uses the retained original archive.');},signal});
  const inspected=await workspace.inspectDelivery({requestId:request(expectedArchiveSha256+'\ninspect'),path,label:'Complete original Flowable customer source',signal});
  need(inspected.value.state==='INSPECTED'&&inspected.value.original.bytes===archive.length&&inspected.value.original.sha256===expectedArchiveSha256,'The original Flowable archive reader selected different bytes.');
  const sourceWorkspace=inspected.value.sourceWorkspace;
  need(sourceWorkspace?.workspaceId&&sourceWorkspace.workspaceId!==workspace.workspaceId,'Receive the original source in a distinct workspace.');
  const adopted=await workspace.adoptDelivery({requestId:request(expectedArchiveSha256+'\nadopt'),id:inspected.id,
   expectedRevision:inspected.revision,manifestSha256:inspected.value.manifestSha256,signal});
  need(adopted.value.state==='ADOPTED','Finish the original full Flowable archive adoption.');
  const programme=await workspace.readProgramme({id:programmeId,revision:programmeRevision,signal});
  need(programme.record.id===programmeId&&programme.record.revision===programmeRevision&&programme.programmeSha256===expectedProgrammeSha256&&programme.basisSha256===expectedBasisSha256,'The selected saved programme or original native outcome basis differs from this archive.');
  const record=await workspace.getRecord({kind:'programme',id:programmeId,revision:programmeRevision,signal});
  need(record.sha256===programme.record.sha256,'The selected original programme record differs.');
  const files=new Map(),media=new Map(),operations=[],references=new Map();
  const add=(name,body,type='application/json')=>{need(!files.has(name)&&body.length<=MAX_SOURCE,'Keep each complete selected file within its original source allowance.');files.set(name,body);media.set(name,type);};
  async function original(reference){
   const selected=await workspace.sourceFile({reference,signal}),raw=await bytes(selected.path,MAX_SOURCE);
   need(raw.length===reference.bytes&&hash(raw)===reference.sha256,'An original native source differs from its retained bytes.');
   return raw;
  }
  add('programme-source.json',await original(programme.source));
  add('programme-view.json',json(programme));add('programme-record.json',json(record));
  function collect(value){
   if(!value||typeof value!=='object')return;
   if(!Array.isArray(value)&&typeof value.mediaType==='string'&&/^[a-f0-9]{64}$/.test(value.sha256??'')&&Number.isSafeInteger(value.bytes)){
    const prior=references.get(value.sha256);need(!prior||prior.bytes===value.bytes,'Original source references disagree on length.');
    references.set(value.sha256,{sha256:value.sha256,bytes:value.bytes,mediaType:value.mediaType});return;
   }
   for(const part of Object.values(value))collect(part);
  }
  collect(programme);collect(record.value);
  for(const row of programme.progress.rows){
   signal?.throwIfAborted();if(!row.record)continue;
   const operation=await workspace.getRecord({kind:row.kind,id:row.record.id,revision:row.record.revision,signal});
   need(operation.sha256===row.record.sha256&&operation.kind===row.kind,'The original selected native operation changed.');
   const stem='operations/'+row.kind+'-'+operation.id+'-r'+operation.revision,recordFile=stem+'.json';
   add(recordFile,json(operation));collect(operation.value);
   const selected={key:row.key,...ref(operation),state:row.state,phase:operation.value.phase??null,recordFile};
   if(operation.value.plan&&operation.value.before){
    const review=await workspace.readReview({kind:row.kind,id:operation.id,revision:operation.revision,signal});
    selected.reviewFile=stem+'.review.json';add(selected.reviewFile,json(review));collect(review);
   }
   operations.push(selected);
  }
  for(const reference of [...references.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256))){
   signal?.throwIfAborted();const suffix=/json/.test(reference.mediaType)?'.json':/xml/.test(reference.mediaType)?'.xml':reference.mediaType.startsWith('text/')?'.txt':'.bin';
   add('native-sources/'+reference.sha256+suffix,await original(reference),reference.mediaType);
  }
  const source={schema:SCHEMA+'.source',workspaceId:sourceWorkspace.workspaceId,
   archive:{name:'flowable-workspace.ndjson',bytes:archive.length,sha256:expectedArchiveSha256,
    bodySha256:inspected.value.original.bodySha256,sourceDeliveryId:inspected.value.sourceDeliveryId},
   programme,operations,files:[...files].map(([name,body])=>identity(name,body,media.get(name))),
   completeArchiveSummary:inspected.value.summary,
   sourceContract:{receiver:'original Flowable inspectDelivery/adoptDelivery/readProgramme/readReview',
    nativeRequests:'Retained original operations only; no engine request is dispatched by source inspection.',
    edition:'Programme record, programme source and observed native basis remain separately identified.'}};
  validateFlowableInstallationSource(source);return{source,files,workspaceArchive:archive};
 }catch(error){primary=error;throw error;}
 finally{
  let closing;try{if(workspace)await workspace.close();}catch(error){closing=error;closing.retainedDirectory=temporary;}
  // A failed original close may leave its owner live. Preserve its complete
  // source and private workspace until that actual owner is drained.
  if(!closing)try{await rm(temporary,{recursive:true,force:true});}catch(error){closing=error;closing.retainedDirectory=temporary;}
  if(closing){if(primary){primary.cleanupError=closing;primary.retainedDirectory=temporary;}else throw closing;}
 }
}
