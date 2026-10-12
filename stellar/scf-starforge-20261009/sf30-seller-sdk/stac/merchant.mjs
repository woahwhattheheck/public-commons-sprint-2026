// MIT. STAC editions on the original SF30 / SF61 / SF82 merchant and SF88 buyers.
import {constants} from 'node:fs';
import {open,realpath,lstat,rename,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalJson} from './provider.mjs';
import {withPrivateLock} from '../routescan/quota.mjs';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {datasetQueryParameters,buildDatasetSellerConfig} from '../dataset-cli.mjs';
import {assetRequestAdmission} from '../response-asset.mjs';
import {readSellerConfig,startSellerService} from '../serve.mjs';
import {compileSellerRoutes,materializeSellerRequestOffer} from '../resource-server.mjs';
import {selectServiceRoute} from '../route-path.mjs';
import {run as compileOpenApi} from '../../sf61-openapi-seller-import/cli.mjs';
import {launch as launchPilot} from '../../sf82-seller-pilot/pilot.mjs';
import {prepareReview} from '../../sf88-operator-buyer-cli/prepare.mjs';
import {validateDatasetQuery} from '../../sf88-operator-buyer-cli/dataset-page.mjs';
import {VerifiedFile} from '../../sf88-operator-buyer-cli/node/index.mjs';
import {absolute,privateDirectory,readBytes,readJson,parseJson,writeBytes,jsonBytes,
  exists,digest,object,need,intent} from '../../sf88-operator-buyer-cli/node/store.mjs';

export const STAC_EDITION_SCHEMA='scf-stac-edition/v1';
export const STAC_MERCHANT_SCHEMA='stellar-forge.stac-merchant.v1';
export const STAC_MAX_FILE_BYTES=2147483648;
export const STAC_MAX_MANIFEST_BYTES=16777216;
export const STAC_CHUNK_BYTES=1048576;
export const STAC_FIELDS=Object.freeze(['item_key','collection','item_id','datetime',
  'start_datetime','end_datetime','cloud_cover','platform','constellation','geometry_json',
  'properties_json','assets_json','links_json','decision_status','decision_note']);
const HASH=/^[a-f0-9]{64}$/;
const MIME=/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;
const PAGE_BYTES=900*1024;
const clone=value=>structuredClone(value);
export const stacHash=value=>digest(canonicalJson(value));
export const stacSame=(left,right)=>canonicalJson(left)===canonicalJson(right);
export function stacMemberPath(directory,name) {
  directory=absolute(directory);
  need(typeof name==='string'&&name.length>0&&name.length<=1024&&
    !/[\\\x00-\x1f\x7f]/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'),
  'STAC_RELATIVE_MEMBER_REQUIRED');
  const path=resolve(directory,name);
  need(path.startsWith(directory+sep),'STAC_MEMBER_OUTSIDE_DIRECTORY');
  return path;
}
export function stacFileRecord(record) {
  need(object(record)&&typeof record.path==='string'&&HASH.test(record.sha256??'')&&
    Number.isSafeInteger(record.bytes)&&record.bytes>=0&&record.bytes<=STAC_MAX_FILE_BYTES&&
    typeof record.mime==='string'&&record.mime.length<=200&&MIME.test(record.mime),
  'STAC_FILE_DESCRIPTOR_INVALID');
  stacMemberPath('/stac-descriptor',record.path);
  return record;
}
export class StacFile extends VerifiedFile {
  constructor(directory,record) {super();this.directory=absolute(directory);this.record=Object.freeze(clone(stacFileRecord(record)));}
  get path(){return stacMemberPath(this.directory,this.record.path);}
  _metadata(){return {path:this.path,bytes:this.record.bytes,sha256:this.record.sha256};}
  async *_read(options){
    need(await realpath(dirname(this.path))===dirname(this.path),'STAC_MEMBER_PARENT_CHANGED');
    yield* super._read(options);
  }
}
export async function stacRetain(path,bytes) {
  path=absolute(path);bytes=Buffer.from(bytes);
  await privateDirectory(dirname(path));
  try {await writeBytes(path,bytes,{exclusive:true});}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    need((await readBytes(path,bytes.length)).equals(bytes),'STAC_IMMUTABLE_FILE_CHANGED');
  }
}
export function validateStacManifest(manifest) {
  need(object(manifest)&&manifest.schema===STAC_EDITION_SCHEMA&&HASH.test(manifest.digest??'')&&
    Array.isArray(manifest.files)&&manifest.files.length>=3&&manifest.files.length<=16384&&
    Array.isArray(manifest.assets)&&manifest.assets.length<=manifest.files.length&&
    object(manifest.paths)&&object(manifest.capture)&&object(manifest.query),
  'STAC_EDITION_MANIFEST_INVALID');
  const core={...manifest};delete core.id;delete core.digest;
  need(stacHash(core)===manifest.digest&&manifest.id==='stac-edition-'+manifest.digest.slice(0,24),
    'STAC_EDITION_IDENTITY_CHANGED');
  const records=new Map();
  for(const record of manifest.files) {
    stacFileRecord(record);
    need(record.path!=='manifest.json'&&!records.has(record.path),'STAC_DUPLICATE_EDITION_MEMBER');
    records.set(record.path,record);
  }
  need(['csv','items','decisions'].every(key=>records.has(manifest.paths[key]))&&
    new Set(Object.values(manifest.paths)).size===Object.values(manifest.paths).length,
  'STAC_CORE_MEMBERS_MISSING');
  const assetPaths=new Set(),assetKeys=new Set();
  for(const asset of manifest.assets) {
    const file=records.get(asset.path);
    const itemKey=encodeURIComponent(asset.collection)+'/'+encodeURIComponent(asset.nativeItemId);
    const key=asset.itemId+'\0'+asset.assetKey;
    need(file&&['bytes','sha256','mime'].every(key=>asset[key]===file[key])&&
      typeof asset.collection==='string'&&asset.collection.length>0&&
      typeof asset.nativeItemId==='string'&&asset.nativeItemId.length>0&&asset.itemId===itemKey&&
      typeof asset.assetKey==='string'&&asset.assetKey.length>0&&typeof asset.href==='string'&&
      !assetPaths.has(asset.path)&&!assetKeys.has(key),'STAC_ASSET_BINDING_INVALID');
    assetPaths.add(asset.path);assetKeys.add(key);
  }
  return manifest;
}
/** Read the original exported identity. Verification streams even large rasters. */
export async function readStacEdition(editionDirectory,{verifyFiles=true}={}) {
  const directory=absolute(editionDirectory);
  need(await realpath(directory)===directory,'STAC_CANONICAL_EDITION_DIRECTORY_REQUIRED');
  const raw=await readBytes(join(directory,'manifest.json'),STAC_MAX_MANIFEST_BYTES);
  const manifest=validateStacManifest(parseJson(raw));
  if(verifyFiles)for(const record of manifest.files)await new StacFile(directory,record).verify();
  return {directory,manifest,manifestSha256:digest(raw),manifestBytes:raw.length,rawManifest:raw};
}
function location(origin,path) {
  const url=new URL(origin);
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&
    url.pathname==='/'&&origin.replace(/\/$/,'')===url.origin,'STAC_PUBLIC_ORIGIN_REQUIRED');
  need(typeof path==='string'&&/^\/[A-Za-z0-9_.~/-]+$/.test(path)&&!path.includes('//')&&
    new URL(path,url).pathname===path&&!/^\/_seller(?:\/|$)/.test(path),'STAC_APPLICATION_PATH_INVALID');
  return {origin:url.origin,path:path.replace(/\/$/,'')};
}
function paymentTerms(payment) {
  need(object(payment)&&Object.keys(payment).every(key=>
    ['scheme','network','asset','amount','payTo','maxTimeoutSeconds'].includes(key)),
  'STAC_ORIGINAL_PAYMENT_TERMS_REQUIRED');
  return clone(payment);
}
function datasetConfig(edition) {
  return {schema:'stellar-forge.csv-dataset.v1',
    file:stacMemberPath(edition.directory,edition.manifest.paths.csv),
    name:'STAC '+edition.manifest.id,
    columns:Object.fromEntries(STAC_FIELDS.map(name=>[name,{type:name==='cloud_cover'?'number':'string',
      nullable:!['item_key','collection','item_id','geometry_json','properties_json','assets_json','links_json'].includes(name)}])),
    filters:['item_key','collection','platform','constellation','decision_status'],
    ranges:['cloud_cover','datetime','start_datetime','end_datetime'],
    sorts:['cloud_cover','datetime','collection','item_id'],
    maxBytes:268435456,maxRows:1000000,maxCellChars:1048576,
    defaultLimit:50,maxLimit:250,maxPageBytes:PAGE_BYTES};
}
function fileMap(edition) {
  return edition.manifest.files.map(file=>({...clone(file),fileId:digest(file.path),
    snapshot:stacHash({editionDigest:edition.manifest.digest,path:file.path,
      bytes:file.bytes,sha256:file.sha256,mime:file.mime})}));
}
function planIdentity(plan) {
  return {schema:STAC_MERCHANT_SCHEMA,editionId:plan.editionId,editionDigest:plan.editionDigest,
    manifestSha256:plan.manifestSha256,manifestBytes:plan.manifestBytes,snapshot:plan.snapshot,
    origin:plan.origin,path:plan.path,payment:plan.payment,paths:plan.paths,files:plan.files,
    datasetConfigSha256:plan.datasetConfigSha256};
}
const resource=offer=>typeof offer.resource==='string'?offer.resource:offer.resource?.url;
async function compiledMerchant(directory,plan) {
  const output=join(directory,'merchant');
  const manifest=await readJson(join(output,'manifest.json'),1048576);
  need(manifest.schema==='stellar.open-api-seller-manifest.v1','STAC_ORIGINAL_SF61_MANIFEST_REQUIRED');
  for(const [name,key] of [['openapi.json','specSha256'],['selections.json','selectionsSha256'],
    ['bindings.json','serviceBindingsSha256']])
    need(digest(await readBytes(join(directory,'merchant-inputs',name),4194304))===manifest[key],
      'STAC_SF61_INPUT_CHANGED');
  const offersBytes=await readBytes(join(output,'offers.json'),4194304);
  const configBytes=await readBytes(join(output,'seller-service.json'),1048576);
  need(digest(offersBytes)===manifest.offersSha256&&digest(configBytes)===manifest.serviceConfigSha256,
    'STAC_SF61_OUTPUT_CHANGED');
  if(plan.offersSha256)need(plan.offersSha256===manifest.offersSha256&&
    plan.serviceConfigSha256===manifest.serviceConfigSha256,'STAC_MERCHANT_COMPILED_BINDING_CHANGED');
  const exported=parseJson(offersBytes);
  need(exported.schema==='stellar.open-api-seller-import.v1'&&Array.isArray(exported.offers)&&
    exported.offers.length===3,'STAC_THREE_NATIVE_ROUTES_REQUIRED');
  const offers=exported.offers.map(row=>row.seller);
  const expected=[plan.paths.scenes,plan.paths.edition,plan.paths.files.replace('{fileId}',plan.files[0].fileId)];
  need(expected.every(path=>offers.some(offer=>resource(offer)===plan.origin+path)),
    'STAC_COMPILED_RESOURCE_CHANGED');
  return {directory:output,manifest,offers,offersBytes,config:await readSellerConfig(join(output,'seller-service.json'))};
}
/** Staging writes only a separate merchant directory; original edition bytes remain intact. */
export async function stageStacMerchant({editionDirectory,directory,origin,path='/stac',payment}={}) {
  directory=absolute(directory);
  const edition=await readStacEdition(editionDirectory);
  need(directory!==edition.directory&&!directory.startsWith(edition.directory+sep),
    'STAC_SEPARATE_MERCHANT_DIRECTORY_REQUIRED');
  await privateDirectory(directory);
  const where=location(origin,path),terms=paymentTerms(payment);
  return withPrivateLock(directory,'merchant.lock',async()=>{
    const configBytes=jsonBytes(datasetConfig(edition));
    await stacRetain(join(directory,'dataset.json'),configBytes);
    const dataset=await loadDatasetConfig(join(directory,'dataset.json'));
    const description=dataset.describe(),base=where.path+'/'+edition.manifest.id;
    const paths={scenes:base+'/scenes',edition:base+'/edition',files:base+'/files/{fileId}'};
    await buildDatasetSellerConfig(dataset,{payment:terms,origin:where.origin,path:paths.scenes});
    const identity={schema:STAC_MERCHANT_SCHEMA,editionId:edition.manifest.id,
      editionDigest:edition.manifest.digest,manifestSha256:edition.manifestSha256,
      manifestBytes:edition.manifestBytes,snapshot:description.snapshot,...where,payment:terms,paths,
      files:fileMap(edition),datasetConfigSha256:digest(configBytes)};
    const plan={...identity,planSha256:stacHash(identity),editionDirectory:edition.directory};
    const existing=await exists(join(directory,'merchant-plan.json'))
      ?await readJson(join(directory,'merchant-plan.json'),STAC_MAX_MANIFEST_BYTES):null;
    if(existing)need(existing.planSha256===plan.planSha256&&
      stacSame(planIdentity(existing),identity)&&existing.editionDirectory===edition.directory,
    'STAC_MERCHANT_ALREADY_HAS_DIFFERENT_EDITION_OR_TERMS');
    const parameters=datasetQueryParameters(description).map(item=>({
      in:'query',name:item.name,required:false,description:item.description,
      schema:{type:item.type},...(item.example===''?{}:{example:item.example})}));
    parameters.push({in:'query',name:'snapshot',required:false,schema:{type:'string'},example:description.snapshot});
    const jsonResponse={'200':{description:'Original retained STAC edition JSON.',
      content:{'application/json':{schema:{type:'object'}}}}};
    const spec={openapi:'3.1.0',info:{title:'STAC edition merchant',version:edition.manifest.id},
      servers:[{url:where.origin+'/'}],paths:{
        [paths.scenes]:{get:{operationId:'stacScenes',summary:'Query the immutable native scene dataset.',
          parameters,responses:jsonResponse}},
        [paths.edition]:{get:{operationId:'stacEdition',summary:'Read the exact retained edition manifest.',
          responses:jsonResponse}},
        [paths.files]:{get:{operationId:'stacFile',summary:'Receive a retained member through native object chunks.',
          parameters:[{in:'path',name:'fileId',required:true,schema:{type:'string'},example:plan.files[0].fileId},
            {in:'query',name:'offset',required:false,schema:{type:'string'},example:'0'},
            {in:'query',name:'length',required:false,schema:{type:'string'},example:String(STAC_CHUNK_BYTES)}],
          responses:{'206':{description:'Exact immutable object byte window.',
            content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}},
            '200':{description:'Exact empty retained member.',
              content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}}}}}
      }};
    const selections=Object.values(paths).map(path=>({method:'GET',path,serviceName:'STAC edition',accepts:[terms]}));
    const bindings=[
      {id:'stac-scenes',method:'GET',path:paths.scenes,handler:'stacScenes',admit:'admitStacScenes'},
      {id:'stac-edition',method:'GET',path:paths.edition,handler:'stacEdition',admit:'admitStacEdition'},
      {id:'stac-file',method:'GET',path:paths.files,handler:'stacFile',admit:'admitStacFile'}];
    const input=join(directory,'merchant-inputs');
    for(const [name,value]of[['openapi.json',spec],['selections.json',selections],['bindings.json',bindings]])
      await stacRetain(join(input,name),jsonBytes(value));
    const output=join(directory,'merchant');
    if(!await exists(output)) {
      const temporary=join(directory,'.merchant-'+randomUUID());
      try {
        await compileOpenApi(['--spec',join(input,'openapi.json'),'--config',join(input,'selections.json'),
          '--service-bindings',join(input,'bindings.json'),'--out',temporary],{report:false});
        await rename(temporary,output);
      }finally{await rm(temporary,{recursive:true,force:true});}
    }
    const native=await compiledMerchant(directory,existing??plan);
    const staged={...plan,status:'STAGED',offersSha256:native.manifest.offersSha256,
      serviceConfigSha256:native.manifest.serviceConfigSha256};
    await stacRetain(join(directory,'merchant-plan.json'),jsonBytes(staged));
    return {...staged,directory,merchantDirectory:native.directory};
  });
}
export async function readStacMerchant(directory,{verifyFiles=false}={}) {
  directory=await privateDirectory(absolute(directory),{create:false});
  const plan=await readJson(join(directory,'merchant-plan.json'),STAC_MAX_MANIFEST_BYTES);
  need(plan.schema===STAC_MERCHANT_SCHEMA&&plan.status==='STAGED'&&
    plan.planSha256===stacHash(planIdentity(plan)),'STAC_MERCHANT_PLAN_CHANGED');
  const edition=await readStacEdition(plan.editionDirectory,{verifyFiles});
  const where=location(plan.origin,plan.path),base=where.path+'/'+edition.manifest.id;
  need(plan.editionId===edition.manifest.id&&plan.editionDigest===edition.manifest.digest&&
    plan.manifestSha256===edition.manifestSha256&&plan.manifestBytes===edition.manifestBytes&&
    stacSame(plan.files,fileMap(edition))&&stacSame(plan.paths,
      {scenes:base+'/scenes',edition:base+'/edition',files:base+'/files/{fileId}'}),
    'STAC_MERCHANT_EDITION_BINDING_CHANGED');
  const raw=await readBytes(join(directory,'dataset.json'),65536);
  need(digest(raw)===plan.datasetConfigSha256&&stacSame(parseJson(raw),datasetConfig(edition)),
    'STAC_NATIVE_DATASET_CONFIG_CHANGED');
  const dataset=await loadDatasetConfig(join(directory,'dataset.json'));
  need(dataset.describe().snapshot===plan.snapshot,'STAC_NATIVE_DATASET_SNAPSHOT_CHANGED');
  return {directory,plan,edition,dataset,native:await compiledMerchant(directory,plan)};
}
export function stacQueryEntries(query={}) {
  const entries=query instanceof URLSearchParams?[...query]:Object.entries(query);
  const result=new Map();
  for(const [key,value]of entries) {
    need(typeof value==='string'&&!result.has(key),'STAC_QUERY_STRINGS_REQUIRED');
    result.set(key,value);
  }
  return result;
}
const refused=(message,status=400)=>({status,body:{error:'STAC_REQUEST_INVALID',message}});
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
  a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function retainedHandle(directory,record) {
  const path=stacMemberPath(directory,record.path);
  need(await realpath(dirname(path))===dirname(path),'STAC_MEMBER_PARENT_CHANGED');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const before=await handle.stat();
    need(before.isFile()&&before.size===record.bytes,'STAC_MEMBER_LENGTH_CHANGED');
    const hash=createHash('sha256'),buffer=Buffer.alloc(STAC_CHUNK_BYTES);
    let offset=0;
    while(offset<record.bytes) {
      const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,record.bytes-offset),offset);
      need(bytesRead>0,'STAC_MEMBER_TRUNCATED');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
    }
    need(sameStat(before,await handle.stat())&&hash.digest('hex')===record.sha256,'STAC_MEMBER_CHANGED');
    await handle.close();
    return {path,stat:before,record};
  }catch(error){await handle.close().catch(()=>{});throw error;}
}
function selectedWindow(context,files) {
  const selected=files.get(context.pathParams?.fileId);
  need(selected,'STAC_SELECTED_FILE_NOT_FOUND');
  const query=stacQueryEntries(context.query);
  need([...query.keys()].every(key=>['offset','length'].includes(key)),'STAC_OBJECT_QUERY_INVALID');
  const numeric=(name,fallback)=> {
    if(!query.has(name))return fallback;
    const text=query.get(name);
    need(/^(?:0|[1-9][0-9]{0,15})$/.test(text),'STAC_OBJECT_WINDOW_INVALID');
    const value=Number(text);need(Number.isSafeInteger(value),'STAC_OBJECT_WINDOW_INVALID');return value;
  };
  const offset=numeric('offset',0),length=numeric('length',STAC_CHUNK_BYTES),total=selected.record.bytes;
  need(length>0&&length<=STAC_CHUNK_BYTES&&offset>=0&&
    (total===0?offset===0:offset<total),'STAC_OBJECT_WINDOW_OUTSIDE_FILE');
  const whole=query.size===0&&total<=STAC_CHUNK_BYTES;
  need(query.size>0||whole,'STAC_LARGE_FILE_REQUIRES_EXPLICIT_WINDOW');
  return {...selected,offset,length:Math.min(length,total-offset),whole};
}
/** Payment admission remains original SF30; only the local byte-window application is new. */
export async function createStacHandlers(directory) {
  const merchant=await readStacMerchant(directory),{plan,edition,dataset}=merchant;
  const files=new Map();
  for(const record of plan.files)files.set(record.fileId,await retainedHandle(edition.directory,record));
  const clean=context=>{
    const query=stacQueryEntries(context.query);
    if(query.has('snapshot')){need(query.get('snapshot')===plan.snapshot,'STAC_QUERY_SNAPSHOT_CHANGED');query.delete('snapshot');}
    return {...context,query:new URLSearchParams([...query])};
  };
  const handlers={
    admitStacScenes(context){try{return dataset.admit(clean(context));}catch(error){return refused(error.code??error.message);}},
    stacScenes(context){return dataset.handle(clean(context));},
    admitStacEdition(context){
      const native=assetRequestAdmission(context);if(native!==true)return native;
      try{need(stacQueryEntries(context.query).size===0,'STAC_EDITION_HAS_NO_QUERY');return true;}
      catch(error){return refused(error.code??error.message);}
    },
    stacEdition(){return {status:200,headers:{'content-type':'application/json',
      'x-content-sha256':edition.manifestSha256,'content-disposition':'attachment; filename="manifest.json"',
      'accept-ranges':'none'},body:Buffer.from(edition.rawManifest)};},
    admitStacFile(context){
      const native=assetRequestAdmission(context);if(native!==true)return native;
      try{selectedWindow(context,files);return true;}
      catch(error){return refused(error.code??error.message,error.code==='STAC_SELECTED_FILE_NOT_FOUND'?404:400);}
    },
    async stacFile(context){
      const {path,stat,record,offset,length,whole}=selectedWindow(context,files);
      need(!closed,'STAC_MERCHANT_CLOSED');
      need(await realpath(dirname(path))===dirname(path),'STAC_MEMBER_PARENT_CHANGED');
      const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try {
      need(sameStat(stat,await handle.stat()),'STAC_MEMBER_CHANGED_AFTER_START');
      const body=Buffer.alloc(length);let read=0;
      while(read<length){
        const got=await handle.read(body,read,length-read,offset+read);
        need(got.bytesRead>0,'STAC_MEMBER_TRUNCATED');read+=got.bytesRead;
      }
      need(sameStat(stat,await handle.stat()),'STAC_MEMBER_CHANGED_DURING_TRANSFER');
      const filename=basename(record.path).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,160)||'member.bin';
      return {status:whole?200:206,headers:{
        'content-type':record.mime,'content-disposition':'attachment; filename="'+filename+'"',
        'accept-ranges':'none','x-content-sha256':digest(body),
        'x-sf30-object-snapshot':record.snapshot,'x-sf30-object-bytes':String(record.bytes),
        ...(whole?{}:{'content-range':'bytes '+offset+'-'+(offset+length-1)+'/'+record.bytes})},body};
      }finally{await handle.close();}
    }
  };
  let closed=false;
  return {...merchant,handlers,maxResponseBytes:Math.max(STAC_CHUNK_BYTES,edition.manifestBytes,PAGE_BYTES),
    async close(){closed=true;}};
}
async function nativeFactoryFor({facilitator,allowLocalFacilitator=false}) {
  const url=new URL(facilitator),local=allowLocalFacilitator&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
  need((local||url.protocol==='https:')&&!url.username&&!url.password&&!url.search&&!url.hash,
    'STAC_FACILITATOR_URL_INVALID');
  const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([
    import('@x402/core/server'),import('../native-factory.mjs')]);
  const facilitatorClient=new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')});
  return compiled=>createNativeSellerServer(compiled,{facilitatorClient});
}
export async function startStacMerchant({directory,port=8423,nativeFactory,facilitator,
  allowLocalFacilitator=false,challengeOnly=false,maxInFlight=16,drainGraceMs=60000,requestTimeoutMs}={}) {
  need(!(nativeFactory&&facilitator)&&!(challengeOnly&&(nativeFactory||facilitator)),
    'STAC_ONE_NATIVE_MERCHANT_MODE_REQUIRED');
  const application=await createStacHandlers(directory);
  const config={...application.native.config,maxResponseBytes:application.maxResponseBytes};
  const start=factory=>startSellerService({config,handlers:application.handlers,port,
    nativeFactory:factory,maxInFlight,drainGraceMs,requestTimeoutMs});
  let session;
  try {
    if(nativeFactory)session=await start(nativeFactory);
    else{
      const args=['--resume',application.native.directory,'--port',String(port)];
      if(facilitator!==undefined)args.push('--facilitator',facilitator);
      if(allowLocalFacilitator)args.push('--allow-local-facilitator');
      if(challengeOnly)args.push('--challenge-only');
      session=await launchPilot(args,{serve:async forwarded=>{
        const at=forwarded.indexOf('--facilitator');
        return start(at<0?null:await nativeFactoryFor({facilitator:forwarded[at+1],
          allowLocalFacilitator:forwarded.includes('--allow-local-facilitator')}));
      }});
    }
  }catch(error){await application.close();throw error;}
  let closing;
  return {...session,editionId:application.plan.editionId,snapshot:application.plan.snapshot,
    paths:clone(application.plan.paths),publicOrigin:application.plan.origin,
    merchantDirectory:application.native.directory,
    close(){return closing??=(async()=>{try{await session.close();}finally{await application.close();}})();}};
}
export async function stacMerchantStatus(directory) {
  const {native}=await readStacMerchant(directory);
  return launchPilot(['--status',native.directory]);
}
/** Exact original SF61 offer selection. No operator credentials enter the public preparation. */
export async function prepareStacRequest(merchant,{intentId,kind='scenes',file,query={},acceptIndex=0,whole=false}={}) {
  if(typeof merchant==='string')merchant=await readStacMerchant(merchant);
  const {plan,native,dataset}=merchant;
  intent(intentId);
  need(['scenes','edition','file'].includes(kind),'STAC_REQUEST_KIND_INVALID');
  let url,expected=null,sample;
  if(kind==='scenes'){
    need(file===undefined,'STAC_DATASET_FILE_ARGUMENT_INVALID');
    url=new URL(plan.origin+plan.paths.scenes);
    const selected=stacQueryEntries(query);
    need(!selected.has('snapshot')||selected.get('snapshot')===plan.snapshot,'STAC_QUERY_SNAPSHOT_CHANGED');
    selected.set('snapshot',plan.snapshot);
    for(const [key,value]of selected)url.searchParams.set(key,value);
    url.searchParams.sort();validateDatasetQuery(url.href,{initial:true});
    const clean=new URLSearchParams(url.searchParams);clean.delete('snapshot');
    const decision=dataset.admit({query:clean});
    need(decision===true,'STAC_ORIGINAL_DATASET_QUERY_REJECTED');
    sample=plan.origin+plan.paths.scenes;
  }else{
    need(stacQueryEntries(query).size===0,'STAC_FILE_QUERY_MUST_BE_EMPTY');
    if(kind==='edition'){
      need(file===undefined,'STAC_EDITION_FILE_ARGUMENT_INVALID');
      expected={path:'manifest.json',bytes:plan.manifestBytes,sha256:plan.manifestSha256,mime:'application/json'};
      url=new URL(plan.origin+plan.paths.edition);sample=url.href;
    }else{
      expected=plan.files.find(item=>item.path===file);
      need(expected,'STAC_FILE_NOT_DECLARED');
      url=new URL(plan.origin+plan.paths.files.replace('{fileId}',expected.fileId));
      sample=plan.origin+plan.paths.files.replace('{fileId}',plan.files[0].fileId);
    }
  }
  const rowIndex=native.offers.findIndex(offer=>resource(offer)===sample);
  need(rowIndex>=0,'STAC_ORIGINAL_OFFER_NOT_FOUND');
  // The original router resolves its saved sample offer to the concrete request.
  // SF88 then reviews that exact native materialization, retaining the original
  // compiled-offer hash separately from the resolved discovery hash.
  const compiled=compileSellerRoutes(native.offers.map((offer,index)=>({id:'selection-'+index,
    offer,handler:()=>{throw new Error('STAC_OFFLINE_SELECTION_ONLY');}})));
  const selected=selectServiceRoute(compiled.routes,url.pathname,'GET');
  need(selected?.route&&selected.route.offer.resource.url===sample,'STAC_NATIVE_ROUTE_SELECTION_CHANGED');
  const resolved=materializeSellerRequestOffer(selected.route,url,selected.pathParams);
  const reviewed=prepareReview(jsonBytes({resources:[resolved]}),
    {rowIndex:0,acceptIndex,intentId,url:url.href,method:'GET'});
  const config=clone(reviewed.draft);config.captureBody=false;
  if(kind==='edition'||kind==='file'&&(expected.bytes===0||whole))
    config.responseFile={maxBytes:Math.max(1,expected.bytes),expectedBytes:expected.bytes,
      expectedSha256:expected.sha256,expectedContentType:expected.mime};
  need(!whole||kind==='file'&&expected.bytes<=STAC_CHUNK_BYTES,'STAC_WHOLE_RESPONSE_LIMIT');
  // Explicit native object sessions add their own per-chunk response options.
  if(kind==='file'&&expected.bytes>0&&!whole)delete config.responseFile;
  return {schema:'stellar-forge.stac-prepared-request.v1',kind,intentId,url:url.href,
    editionId:plan.editionId,editionDigest:plan.editionDigest,planSha256:plan.planSha256,
    offersSha256:plan.offersSha256,expected:expected?clone(expected):null,
    configSha256:digest(jsonBytes(config)),config};
}
