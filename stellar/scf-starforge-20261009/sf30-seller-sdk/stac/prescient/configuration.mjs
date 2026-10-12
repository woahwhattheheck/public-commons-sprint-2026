// MIT. Reviewed Prescient operator configuration; original STAC data stays in its workspace.
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {readdir,unlink} from 'node:fs/promises';
import {privateDirectory,readJson,writeJson,need} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {withPrivateLock} from '../../routescan/quota.mjs';
import {canonicalJson,sha256,publicURL} from '../provider.mjs';

export const PRESCIENT_SDK={package:'prescient-sdk',version:'0.4.2',
  repository:'https://github.com/sparkgeo/prescient-sdk',commit:'895b7720b22c3047b76ecff512f6be13f1d62fc9'};
export const PROFILE_SCHEMA='starforge.prescient-profile/v1';
const STORE_SCHEMA='starforge.prescient-operator/v1';
const time=()=>new Date().toISOString();
export const configurationDigest=value=>sha256(canonicalJson(value));
const clone=value=>structuredClone(value);
const id=prefix=>prefix+'-'+randomUUID().replaceAll('-','');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const label=(value,code,max=240)=>{need(typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value),code);return value.trim();};
const identifier=value=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value),'PRESCIENT_IDENTIFIER_INVALID');return value;};
function fields(value,allowed,code){need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),code);}
function list(value,normalize,code,max=32){
  need(Array.isArray(value)&&value.length>0&&value.length<=max,code);
  const out=value.map(normalize);need(new Set(out.map(configurationDigest)).size===out.length,code);return out;
}
export function exactSourceOrigin(value){
  const parsed=new URL(publicURL(value));need(parsed.origin===value,'PRESCIENT_EXACT_ORIGIN_REQUIRED');return value;
}
/** Preserve the SDK's urljoin(base,"stac") behavior, including a path without a trailing slash. */
export function prescientCatalogEndpoint(endpoint){return new URL('stac',endpoint).href;}
export function normalizePrescientProfile(value){
  fields(value,['schema','name','endpoint','authMode','identityProvider','bindingId','allowedOrigins',
    'collections','allowedS3','maxAssetBytes','rights','refreshSkewSeconds'],'PRESCIENT_PROFILE_FIELDS_INVALID');
  need(value.schema===undefined||value.schema===PROFILE_SCHEMA,'PRESCIENT_PROFILE_SCHEMA_INVALID');
  const endpoint=publicURL(value.endpoint),url=new URL(endpoint);
  need(!url.search,'PRESCIENT_ENDPOINT_QUERY_NOT_ALLOWED');
  const authMode=value.authMode;need(['api-key','oauth'].includes(authMode),'PRESCIENT_AUTH_MODE_REQUIRED');
  let identityProvider=null;
  if(authMode==='oauth'){need(['microsoft','google'].includes(value.identityProvider),'PRESCIENT_IDENTITY_PROVIDER_REQUIRED');identityProvider=value.identityProvider;}
  else need(value.identityProvider===undefined||value.identityProvider===null,'PRESCIENT_API_KEY_IDENTITY_PROVIDER_UNUSED');
  const allowedOrigins=list(value.allowedOrigins,exactSourceOrigin,'PRESCIENT_SOURCE_ORIGINS_REQUIRED',8).sort();
  need(allowedOrigins.includes(url.origin),'PRESCIENT_CATALOG_ORIGIN_NOT_APPROVED');
  const collections=list(value.collections,v=>label(v,'PRESCIENT_COLLECTION_ID_INVALID',240),'PRESCIENT_COLLECTIONS_REQUIRED',32).sort();
  need(Array.isArray(value.allowedS3)&&value.allowedS3.length<=32,'PRESCIENT_S3_BINDINGS_INVALID');
  const allowedS3=value.allowedS3.map(row=>{
    fields(row,['bucket','prefix','region','expectedBucketOwner','requesterPays'],'PRESCIENT_S3_BINDING_FIELDS_INVALID');
    need(typeof row.bucket==='string'&&/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(row.bucket)&&
      !/^\d+\.\d+\.\d+\.\d+$/u.test(row.bucket)&&!row.bucket.includes('..'),'PRESCIENT_S3_BUCKET_INVALID');
    need(typeof row.prefix==='string'&&row.prefix.length<=1024&&!/[\u0000-\u001f\u007f]/u.test(row.prefix)&&!row.prefix.startsWith('/'),'PRESCIENT_S3_PREFIX_INVALID');
    need(typeof row.region==='string'&&/^[a-z]{2}(?:-[a-z0-9]+){1,3}-\d+$/u.test(row.region),'PRESCIENT_S3_REGION_REQUIRED');
    need(row.expectedBucketOwner===undefined||/^\d{12}$/u.test(row.expectedBucketOwner),'PRESCIENT_S3_OWNER_INVALID');
    need(typeof row.requesterPays==='boolean','PRESCIENT_REQUESTER_PAYS_REVIEW_REQUIRED');
    return {bucket:row.bucket,prefix:row.prefix,region:row.region,...(row.expectedBucketOwner===undefined?{}:{expectedBucketOwner:row.expectedBucketOwner}),requesterPays:row.requesterPays};
  }).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
  need(new Set(allowedS3.map(configurationDigest)).size===allowedS3.length,'PRESCIENT_S3_BINDING_DUPLICATE');
  need(Number.isSafeInteger(value.maxAssetBytes)&&value.maxAssetBytes>0&&value.maxAssetBytes<=2*1024**3,'PRESCIENT_ASSET_BYTE_LIMIT_REQUIRED');
  fields(value.rights,['basis','reference','purpose','allowPortableAssets'],'PRESCIENT_RIGHTS_FIELDS_INVALID');
  need(['customer-licensed','public-data'].includes(value.rights.basis)&&typeof value.rights.allowPortableAssets==='boolean','PRESCIENT_RIGHTS_REVIEW_REQUIRED');
  const rights={basis:value.rights.basis,reference:label(value.rights.reference,'PRESCIENT_RIGHTS_REFERENCE_REQUIRED',2000),
    purpose:label(value.rights.purpose,'PRESCIENT_PURPOSE_REQUIRED',2000),allowPortableAssets:value.rights.allowPortableAssets};
  const refreshSkewSeconds=value.refreshSkewSeconds??120;
  need(Number.isSafeInteger(refreshSkewSeconds)&&refreshSkewSeconds>=0&&refreshSkewSeconds<=900,'PRESCIENT_REFRESH_SKEW_INVALID');
  return {schema:PROFILE_SCHEMA,name:label(value.name,'PRESCIENT_PROFILE_NAME_REQUIRED'),endpoint,authMode,identityProvider,
    bindingId:identifier(value.bindingId),allowedOrigins,collections,allowedS3,maxAssetBytes:value.maxAssetBytes,rights,refreshSkewSeconds};
}
/** A portable profile requests access; it cannot install a receiver's credential binding. */
export function portablePrescientProfile(profile){
  const normalized=normalizePrescientProfile(profile),{bindingId,...configuration}=normalized;
  const core={schema:'starforge.prescient-portable-profile/v1',configuration,sdk:clone(PRESCIENT_SDK)};
  return {...core,sha256:configurationDigest(core)};
}
export function receivePrescientProfile(value,bindingId){
  fields(value,['schema','configuration','sdk','sha256'],'PRESCIENT_PORTABLE_PROFILE_INVALID');
  const {sha256:expected,...core}=value;
  need(value.schema==='starforge.prescient-portable-profile/v1'&&expected===configurationDigest(core),'PRESCIENT_PORTABLE_PROFILE_HASH_MISMATCH');
  need(configurationDigest(value.sdk)===configurationDigest(PRESCIENT_SDK),'PRESCIENT_SDK_SOURCE_CHANGED');
  need(plain(value.configuration)&&!Object.hasOwn(value.configuration,'bindingId'),'PRESCIENT_PORTABLE_CREDENTIAL_BINDING_FORBIDDEN');
  return normalizePrescientProfile({...value.configuration,bindingId});
}
/** Private host bindings are never accepted from an HTTP body or received package. */
export function normalizePrescientDeployment(value){
  fields(value,['bindings','pythonCommand','timeoutMs','transport','deliveryRoots','exportRoot'],'PRESCIENT_DEPLOYMENT_FIELDS_INVALID');
  need(plain(value.bindings)&&Object.keys(value.bindings).length>0,'PRESCIENT_DEPLOYMENT_BINDINGS_REQUIRED');
  const bindings=Object.create(null);
  for(const [key,row]of Object.entries(value.bindings)){
    identifier(key);fields(row,['label','envFile','pythonCommand'],'PRESCIENT_DEPLOYMENT_BINDING_INVALID');
    need(typeof row.envFile==='string'&&resolve(row.envFile)===row.envFile,'PRESCIENT_PRIVATE_ENV_FILE_ABSOLUTE');
    if(row.pythonCommand!==undefined)need(Array.isArray(row.pythonCommand)&&row.pythonCommand.length>0&&row.pythonCommand.length<=32&&row.pythonCommand.every(v=>typeof v==='string'&&v.length>0&&!v.includes('\0')),'PRESCIENT_PYTHON_COMMAND_INVALID');
    bindings[key]={label:label(row.label??key,'PRESCIENT_BINDING_LABEL_INVALID'),envFile:row.envFile,...(row.pythonCommand?{pythonCommand:row.pythonCommand}:{})};
  }
  if(value.pythonCommand!==undefined)need(Array.isArray(value.pythonCommand)&&value.pythonCommand.length>0&&value.pythonCommand.length<=32&&value.pythonCommand.every(v=>typeof v==='string'&&v.length>0&&!v.includes('\0')),'PRESCIENT_PYTHON_COMMAND_INVALID');
  if(value.exportRoot!==undefined)need(typeof value.exportRoot==='string'&&resolve(value.exportRoot)===value.exportRoot,'PRESCIENT_EXPORT_ROOT_ABSOLUTE');
  if(value.deliveryRoots!==undefined)need(Array.isArray(value.deliveryRoots)&&value.deliveryRoots.length>0&&value.deliveryRoots.length<=16&&value.deliveryRoots.every(root=>typeof root==='string'&&resolve(root)===root),'PRESCIENT_DELIVERY_ROOTS_ABSOLUTE');
  const timeoutMs=value.timeoutMs??120000;need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=900000,'PRESCIENT_RUNTIME_TIMEOUT_INVALID');
  return {...value,bindings,timeoutMs};
}
export async function openPrescientConfiguration({directory,create=true}={}){
  directory=await privateDirectory(directory,{create});
  const versions=await privateDirectory(join(directory,'versions'),{create}),locks=await privateDirectory(join(directory,'locks'),{create});
  const file=revision=>join(versions,String(revision).padStart(12,'0')+'.json');
  const snapshots=async()=> (await readdir(versions)).filter(name=>/^\d{12}\.json$/u.test(name)).sort();
  if(!(await snapshots()).length){
    need(create,'PRESCIENT_OPERATOR_NOT_FOUND');
    const initial={schema:STORE_SCHEMA,id:id('prescient'),revision:0,createdAt:time(),updatedAt:time(),
      profiles:[],reviews:[],approvals:[],approvedProfileSha256:null,operations:{},deliveryReviews:[],deliveries:[]};
    try{await writeJson(file(0),initial,{exclusive:true});}catch(e){if(e.code!=='EEXIST')throw e;}
  }
  async function read(){
    for(let retry=0;retry<8;retry++){
      const names=await snapshots();need(names.length,'PRESCIENT_OPERATOR_NOT_FOUND');
      try{const state=await readJson(join(versions,names.at(-1)),8*1024*1024);
        need(state.schema===STORE_SCHEMA,'PRESCIENT_OPERATOR_SCHEMA_INVALID');return state;
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    need(false,'PRESCIENT_CONFIGURATION_CONCURRENT_WRITER');
  }
  async function mutate(change,{expectedRevision}={}){
    return withPrivateLock(locks,'configuration.lock',async()=>{
      const state=await read();if(expectedRevision!==undefined)need(state.revision===expectedRevision,'PRESCIENT_CONFIGURATION_REVISION_CHANGED');
      const result=change(state);state.revision++;state.updatedAt=time();
      await writeJson(file(state.revision),state,{exclusive:true});
      for(const old of (await snapshots()).slice(0,-8))await unlink(join(versions,old)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      return clone(result);
    });
  }
  async function action(kind,input,{operationId,expectedRevision}={},change){
    operationId=identifier(operationId);const inputSha256=configurationDigest(input);
    return withPrivateLock(locks,'configuration.lock',async()=>{
      const state=await read(),prior=Object.hasOwn(state.operations,operationId)?state.operations[operationId]:null;
      if(prior){need(prior.kind===kind&&prior.inputSha256===inputSha256,'PRESCIENT_OPERATION_INPUT_CHANGED');return clone(prior.result);}
      if(expectedRevision!==undefined)need(state.revision===expectedRevision,'PRESCIENT_CONFIGURATION_REVISION_CHANGED');
      const result=change(state);
      state.operations[operationId]={kind,inputSha256,status:'COMPLETE',result:clone(result),completedAt:time()};
      state.revision++;state.updatedAt=time();await writeJson(file(state.revision),state,{exclusive:true});
      for(const old of (await snapshots()).slice(0,-8))await unlink(join(versions,old)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      return clone(result);
    });
  }
  return Object.freeze({
    directory,getState:read,mutate,
    async saveProfile(input,options){
      const profile=normalizePrescientProfile(input.profile),actor=label(input.actor,'PRESCIENT_REVIEWER_REQUIRED');
      return action('PROFILE_SAVE',{profile,actor},options,state=>{
        const fingerprint=configurationDigest(profile),existing=state.profiles.find(row=>row.sha256===fingerprint);
        if(existing)return existing;
        const record={id:id('profile'),sha256:fingerprint,profile,createdBy:actor,createdAt:time()};state.profiles.push(record);return record;
      });
    },
    async reviewProfile(input,options){
      const profileSha256=label(input.profileSha256,'PRESCIENT_PROFILE_REQUIRED',64),actor=label(input.actor,'PRESCIENT_REVIEWER_REQUIRED');
      return action('PROFILE_REVIEW',{profileSha256,actor},options,state=>{
        const selected=state.profiles.find(row=>row.sha256===profileSha256);need(selected,'PRESCIENT_PROFILE_NOT_FOUND');
        const core={profileSha256,profile:clone(selected.profile),sdk:clone(PRESCIENT_SDK),actor,createdAt:time()};
        const review={id:id('profile-review'),...core,sha256:configurationDigest(core)};state.reviews.push(review);return review;
      });
    },
    async approveProfile(input,options){
      const reviewId=identifier(input.reviewId),reviewSha256=label(input.reviewSha256,'PRESCIENT_REVIEW_HASH_REQUIRED',64),actor=label(input.actor,'PRESCIENT_REVIEWER_REQUIRED');
      return action('PROFILE_APPROVE',{reviewId,reviewSha256,actor},options,state=>{
        const review=state.reviews.find(row=>row.id===reviewId);need(review&&review.sha256===reviewSha256,'PRESCIENT_EXACT_CONFIGURATION_REVIEW_REQUIRED');
        const selected=state.profiles.find(row=>row.sha256===review.profileSha256);
        need(selected&&configurationDigest(selected.profile)===review.profileSha256,'PRESCIENT_REVIEWED_PROFILE_CHANGED');
        const approval={id:id('profile-approval'),profileSha256:review.profileSha256,reviewId,reviewSha256,actor,approvedAt:time()};
        state.approvals.push(approval);state.approvedProfileSha256=review.profileSha256;return approval;
      });
    },
    async approved(){
      const state=await read(),record=state.profiles.find(row=>row.sha256===state.approvedProfileSha256);
      need(record,'PRESCIENT_APPROVED_PROFILE_REQUIRED');need(configurationDigest(record.profile)===record.sha256,'PRESCIENT_APPROVED_PROFILE_CHANGED');return clone(record);
    }
  });
}
