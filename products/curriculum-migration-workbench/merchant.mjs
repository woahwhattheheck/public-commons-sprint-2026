// MIT. Borrow the existing Curriculum Application; never start another store owner.
import {open,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {RetainedFileReads} from '../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {createCurriculumMigrationClient} from './client.mjs';
import {curriculumMigrationTools} from './catalog.mjs';
import {need,HASH,UUID,canonical,absolute,jsonFile,realDirectory,sha} from './contract.mjs';
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/,MAXIMUM=160*1024*1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const topCollections=new Set(['editions','cases','assets','history']),caseCollections=new Set(['runs','decisions','curriculumPlans','curriculumDecisions']);
function exact(value,keys,required=[]){need(plain(value)&&Object.keys(value).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'PARAMS');}
const definitions=new Map(curriculumMigrationTools((name,_description,properties,required)=>({name,properties,required})).map(v=>[v.name,v]));
export async function readCurriculumMigrationConfiguration(file){
 file=absolute(file);const value=await jsonFile(file,2*1024*1024,{privateOnly:true});
 exact(value,['schema','stores','files','storageDirectory'],['schema','stores','storageDirectory']);
 need(value.schema==='stellar-forge.curriculum-migration-workspaces.v1'&&plain(value.stores)&&Object.keys(value.stores).length>=1&&Object.keys(value.stores).length<=32,'CONFIGURATION');
 const configuration={schema:value.schema,storageDirectory:resolve(dirname(file),value.storageDirectory),stores:Object.create(null),files:Object.create(null)};
 await realDirectory(configuration.storageDirectory,{privateOnly:true});
 for(const[alias,v]of Object.entries(value.stores)){
  need(ALIAS.test(alias),'ALIAS');exact(v,['label','connectionFile','storeId','storeDirectory','timeoutMs'],['connectionFile','storeId','storeDirectory']);
  need(UUID.test(v.storeId)&&typeof v.connectionFile==='string'&&typeof v.storeDirectory==='string','CONFIGURATION');
  need(v.timeoutMs===undefined||Number.isSafeInteger(v.timeoutMs)&&v.timeoutMs>=1&&v.timeoutMs<=3600000,'TIMEOUT');
  configuration.stores[alias]={label:v.label??alias,connectionFile:resolve(dirname(file),v.connectionFile),storeId:v.storeId,storeDirectory:resolve(dirname(file),v.storeDirectory),timeoutMs:v.timeoutMs??300000};
 }
 need(value.files===undefined||plain(value.files)&&Object.keys(value.files).length<=1000,'CONFIGURATION');
 for(const[alias,v]of Object.entries(value.files??{})){
  need(ALIAS.test(alias),'ALIAS');exact(v,['path','bytes','sha256','label'],['path','bytes','sha256']);
  need(typeof v.path==='string'&&HASH.test(v.sha256)&&Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=128*1024*1024,'FILE');
  configuration.files[alias]={path:resolve(dirname(file),v.path),bytes:v.bytes,sha256:v.sha256,label:v.label??alias};
 }
 return configuration;
}
function basis(row,expected){need(plain(expected)&&row.workspaceId===expected.workspaceId&&row.revision===expected.revision&&row.snapshotSha256===expected.snapshotSha256,'BRANCH_CHANGED');}
function summary(row){const{snapshot,...value}=row;return value;}
export class MerchantCurriculumMigration{
 #configuration;#reads=new RetainedFileReads({errorPrefix:'CURRICULUM_MIGRATION',maxImmutableFileBytes:MAXIMUM});
 #pending=new Set();#closing=false;#closePromise;
 constructor(config){this.#configuration=config.curriculumMigration===undefined?undefined:JSON.parse(canonical(config.curriculumMigration));}
 get summary(){const c=this.#configuration;return{configured:Boolean(c),closing:this.#closing,
  stores:Object.entries(c?.stores??{}).map(([alias,v])=>({alias,label:v.label,storeId:v.storeId,storeDirectory:v.storeDirectory,connection:'ORIGINAL_PRIVATE_FILE'})),
  files:Object.entries(c?.files??{}).map(([alias,v])=>({alias,label:v.label,bytes:v.bytes,sha256:v.sha256})),...this.#reads.summary};}
 #scope(args){need(typeof args.branchId==='string'&&args.branchId.length>0,'BRANCH');return canonical({alias:args.store,storeId:args.storeId,storeDirectory:absolute(args.storeDirectory),branchId:args.branchId});}
 async #file(client,args){
  const selected=args.selection;exact(selected,['kind','options','assetId','path','bytes','sha256'],['kind']);
  need(['workspace','report','sdkFile','sourceEdition','response','case','asset','history','applicationSource'].includes(selected.kind),'FILE_KIND');
  const want=selected.bytes===undefined&&selected.sha256===undefined?undefined:{bytes:selected.bytes,sha256:selected.sha256};
  const dir=await mkdtemp(join(this.#configuration.storageDirectory,'curriculum-read-')),path=join(dir,'content');let writer,reader;
  try{
   writer=await open(path,'wx',0o600);let position=0;
   const write=async chunk=>{let at=0;while(at<chunk.length){const r=await writer.write(chunk,at,chunk.length-at,position+at);need(r.bytesWritten>0,'FILE_WRITE');at+=r.bytesWritten;}position+=chunk.length;need(position<=MAXIMUM,'FILE_CAPACITY');};
   const selection={id:args.branchId,expected:args.expected};let result,name,type='application/json';
   if(selected.kind==='asset'){
    result=await client.downloadAsset({...selection,assetId:selected.assetId},write,want);name='Curriculum_Original_Asset.txt';type=result.mediaType;
   }else if(selected.kind==='applicationSource'){
    basis(await client.branch(args.branchId),args.expected);
    result=await client.downloadApplicationSource(selected.path,write,want);name=selected.path.split('/').at(-1);type=result.mediaType;
   }else if(selected.kind==='history'){
    const rows=[];let total=null;for await(const page of client.history(selection)){if(total===null)total=page.total;need(total===page.total,'HISTORY_CHANGED');rows.push(...page.items);}
    need(rows.length===total,'HISTORY_INCOMPLETE');const value={...selection,total,items:rows},raw=Buffer.from(canonical(value));
    need(raw.length<=MAXIMUM,'FILE_CAPACITY');result={bytes:raw.length,sha256:sha(raw)};
    if(want)need(result.bytes===want.bytes&&result.sha256===want.sha256,'FILE_CHANGED');
    await write(raw);name='Curriculum_Complete_Command_History.json';
   }else{
    result=await client.download({...selection,kind:selected.kind,options:selected.options??{}},write,want);
    name=selected.kind==='sdkFile'?selected.options?.path:'Curriculum_'+selected.kind+'.json';type=result.mediaType;
   }
   need(result.bytes===position,'FILE_INCOMPLETE');await writer.sync();await writer.close();writer=null;
   reader=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);await unlink(path);await rmdir(dir);const handle=reader;reader=null;
   return{readonlyFileHandle:handle,bytes:result.bytes,sha256:result.sha256,name,type};
  }finally{
   const errors=[];for(const closer of [()=>writer?.close(),()=>reader?.close(),()=>unlink(path),()=>rmdir(dir)])try{await closer();}catch(error){if(error.code!=='ENOENT')errors.push(error);}
   if(errors.length)throw new AggregateError(errors,'Original file cleanup incomplete.');
  }
 }
 async #run(name,args){
  if(name==='merchant_curriculum_migration_stores')return this.summary;
  const c=this.#configuration,selected=c?.stores?.[args.store];need(selected,'STORE_NOT_CONFIGURED');
  need(args.storeId===selected.storeId&&absolute(args.storeDirectory)===selected.storeDirectory,'STORE_CHANGED');
  const action=name.slice('merchant_curriculum_migration_'.length);
  if(action==='file_release'){await this.#reads.release(this.#scope(args),args.readId);return{released:true,readId:args.readId};}
  const client=createCurriculumMigrationClient(selected);
  try{
   if(action==='state')return{identity:await client.state(),branches:await client.branches()};
   if(action==='request')return await client.request(args.requestId);
   const selection={id:args.branchId,expected:args.expected};
   if(action==='branch'||action==='records'){
    const row=await client.branch(args.branchId);basis(row,args.expected);const w=row.snapshot;
    if(action==='branch')return{...summary(row),name:w.name,counts:Object.fromEntries([...topCollections].map(k=>[k,w[k].length])),
     editions:w.editions.map(e=>({id:e.id,name:e.name??null,provenance:e.provenance})),
     assets:w.assets.map(({content,...asset})=>({...asset,bytes:Buffer.byteLength(content),sha256:sha(content)}))};
    need(topCollections.has(args.collection)||caseCollections.has(args.collection),'COLLECTION');
    let items;if(topCollections.has(args.collection))items=w[args.collection];else{const selectedCase=w.cases.find(x=>x.id===args.caseId);need(selectedCase,'CASE');items=selectedCase[args.collection]??[];}
    const offset=args.offset??0,limit=args.limit??100;need(Number.isSafeInteger(offset)&&offset>=0&&offset<=items.length&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'PAGE');
    return{...selection,collection:args.collection,...(caseCollections.has(args.collection)?{caseId:args.caseId}:{}),total:items.length,offset,nextOffset:offset+limit<items.length?offset+limit:null,items:items.slice(offset,offset+limit)};
   }
   if(action==='history')return await client.historyPage({...selection,offset:args.offset??0,limit:args.limit??100});
   if(action==='command')return await client.command({...selection,requestId:args.requestId,command:args.command});
   if(action==='report')return await client.report({...selection,kind:args.kind,options:args.options??{}});
   if(action==='receive'||action==='import_file'){
    const file=c.files[args.fileAlias];need(file&&file.bytes===args.bytes&&file.sha256===args.sha256,'FILE_CHANGED');
    if(action==='receive')return await client.receiveFile({id:args.branchId,label:args.label,origin:args.origin??{},requestId:args.requestId},file.path,file);
    const command={...selection,requestId:args.requestId,command:args.command};
    if(args.command?.kind==='addAsset')return await client.importAssetFile(command,file.path,file);
    if(args.command?.kind==='saveResponse')return await client.importResponseFile(command,file.path,file);
    if(args.command?.kind==='addEdition')return await client.importEditionFile(command,file.path,file);
    need(false,'FILE_COMMAND');
   }
   if(action==='file_read')return await this.#reads.read({scope:this.#scope(args),key:canonical({expected:args.expected,selection:args.selection}),kind:'CURRICULUM_MIGRATION',directory:c.storageDirectory,
    expectedSha256:args.expectedSha256,offset:args.offset??0,limit:args.limit??65536,readId:args.readId,load:()=>this.#file(client,args)});
   need(false,'TOOL');
  }finally{await client.close();}
 }
 call(name,args={}){
  need(!this.#closing,'CLOSING');const def=definitions.get(name);need(def,'TOOL');exact(args,Object.keys(def.properties),def.required);
  const frozen=JSON.parse(canonical(args)),promise=Promise.resolve().then(()=>this.#run(name,frozen));this.#pending.add(promise);promise.then(()=>this.#pending.delete(promise),()=>this.#pending.delete(promise));return promise;
 }
 close(){this.#closing=true;return this.#closePromise??=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})().catch(error=>{this.#closePromise=null;throw error;});}
}
