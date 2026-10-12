// MIT. Original SF74 case attachment and native SF49 source-file resolution.
import {createHash} from 'node:crypto';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {parseWorkspace} from './workspace-file.mjs';
import {newCommissioning,commissioningError} from './commissioning.mjs';
import {operateCaseCommissioning,originalEditionPayload} from './case-commissioning.mjs';
import {createCaseSourceInputs} from './case-source-inputs.mjs';
import {MAX_SOURCE_BUNDLE_MANIFEST_BYTES,parseImplementationSourceManifest} from './source-bundle-reference.mjs';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
import {openSourceEditionDelivery,SOURCE_BUNDLE_REFERENCE_SCHEMA,SOURCE_DELIVERY_HTTP_BASE}
  from '../../scf_2026/sf49_data_commissioning/source-edition-delivery.mjs';

const SHA=/^[a-f0-9]{64}$/;
const CASE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const ensure=(condition,message,code='INVALID_CASE_SOURCE_DELIVERY',status=422)=>{
  if(!condition)throw commissioningError(code,message,status);
};
function sourceIdentity(value) {
  ensure(value&&SHA.test(value.bundleId)&&SHA.test(value.manifestSha256),
    'Use the complete retained source bundle identity');
  return {bundleId:value.bundleId,manifestSha256:value.manifestSha256};
}
function sameSource(a,b) {return a?.bundleId===b.bundleId&&a?.manifestSha256===b.manifestSha256;}
function descriptor(value) {
  ensure(value?.schema===SOURCE_BUNDLE_REFERENCE_SCHEMA&&ID.test(value.id)&&
    ID.test(value.caseId)&&SHA.test(value.caseRevision)&&Array.isArray(value.files),
    'Use an original prepared or received source delivery');
  sourceIdentity(value);return value;
}
function stopped(signal) {
  if(signal?.aborted)throw commissioningError('CASE_SOURCE_ABORTED','The original source operation was stopped',409);
}

/** Full native component plus saved-case composition. The original source
 * service owns transfer storage, leases, streaming and archive receiving. */
export async function createCaseSourceDelivery({
  store,directory,environment=process.env,python=environment.SCF_PYTHON||'python3',
}) {
  ensure(store&&typeof store.read==='function'&&typeof store.save==='function',
    'Supply the original merchant case store');
  ensure(typeof directory==='string'&&isAbsolute(directory),'Use an absolute private source bundle directory');
  const root=resolve(directory),cache=new Map();
  const resolveInputs=createCaseSourceInputs({store,directory:join(root,'case-inputs')});
  async function attachBundle(args) {
    stopped(args.signal);
    ensure(CASE.test(args.caseId)&&SHA.test(args.expectedRevision)&&ID.test(args.requestId)&&
      typeof args.actor==='string'&&args.actor.trim()&&Buffer.byteLength(args.actor)<=200,
      'Use the original saved case, revision, request and operator');
    const original=descriptor(args.descriptor);
    const record=await store.read(args.caseId),workspace=await parseWorkspace(record.workspaceText);
    const state=workspace.commissioning??newCommissioning();
    const retained=state.events.find(row=>row.id===args.requestId);
    let payload;
    if(retained) {
      ensure(retained.type==='record_workorder'&&retained.result?.editionId,
        'This request belongs to another implementation operation','REQUEST_CONFLICT',409);
      const edition=state.editions.find(row=>row.id===retained.result.editionId);
      ensure(sameSource(edition?.sourceBundle,original),
        'This request belongs to another original source bundle','REQUEST_CONFLICT',409);
      // Reconstruct the exact already-recorded command before reading new source
      // files or rejecting its older case revision. The original command model
      // checks actor, payload and request digest and returns its retained result.
      payload=originalEditionPayload(state,edition.id);
    } else {
      ensure(record.revision===args.expectedRevision,
        'The case changed. Open its current saved revision before attaching this source.',
        'CASE_CONFLICT',409);
      ensure(typeof args.loadWorkorder==='function'&&isAbsolute(args.directory),
        'Use the original native workorder bridge');
      const native=await args.loadWorkorder();
      stopped(args.signal);
      const manifestBytes=await readPrivateFile(join(args.directory,'manifest.json'),MAX_SOURCE_BUNDLE_MANIFEST_BYTES);
      const manifestText=decode(manifestBytes),manifest=parseImplementationSourceManifest(manifestText);
      ensure(sha(manifestBytes)===original.manifestSha256&&manifest.bundleId===original.bundleId&&
        canonical(native.manifest)===canonical(manifest),
        'The source descriptor and original native manifest differ','SOURCE_BUNDLE_CHANGED',409);
      const inventory=[...manifest.files,{path:'manifest.json',role:'source-edition-manifest',
        bytes:manifestBytes.length,sha256:original.manifestSha256}];
      ensure(canonical(inventory)===canonical(original.files),
        'The original source inventory changed','SOURCE_BUNDLE_CHANGED',409);
      ensure(native?.summary?.bundleId===original.bundleId&&
        native.summary.manifestSha256===original.manifestSha256&&
        typeof native.inputs?.terms==='string'&&typeof native.inputs?.supportText==='string'&&
        native.source?.workspaceSha256===native.result?.packet?.runtimeSource?.workspaceSha256&&
        native.source?.supportSha256===native.result?.packet?.runtimeSource?.supportSha256,
        'The native workorder bridge returned a different original source','SOURCE_BUNDLE_CHANGED',409);
      let sourceCase=null;
      // An imported source archive may originate outside this case store. Bind
      // a saved local source only when its actual workspace and runtime agree.
      try {
        const sourceRecord=await store.read(original.caseId,original.caseRevision);
        if(sha(sourceRecord.workspaceText)===native.source.workspaceSha256&&
          typeof sourceRecord.supportText==='string'&&sha(sourceRecord.supportText)===native.source.supportSha256)
          sourceCase={id:sourceRecord.id,revision:sourceRecord.revision,
            workspaceSha256:native.source.workspaceSha256,supportSha256:native.source.supportSha256};
      } catch(error) {
        if(!['CASE_NOT_FOUND','CASE_REVISION_NOT_FOUND','INVALID_CASE_ID','ENOENT'].includes(error.code))throw error;
      }
      payload={result:native.result,inputs:{terms:native.inputs.terms,inputs:native.inputs.inputs},
        sourceCase,sourceBundle:{manifestText,runtimeBytes:Buffer.byteLength(native.inputs.supportText)}};
    }
    stopped(args.signal);
    const result=await operateCaseCommissioning(store,{id:args.caseId,expectedRevision:args.expectedRevision,
      command:{type:'record_workorder',requestId:args.requestId,actor:args.actor,
        expectedRevision:state.revision,payload}});
    return {caseId:result.case.id,revision:result.case.revision,
      commissioningRevision:result.revision,editionId:result.result.editionId,replayed:result.replayed};
  }
  const service=await openSourceEditionDelivery({directory:root,resolveInputs,attachBundle,python,environment});
  async function locate(value) {
    const original=sourceIdentity(value),key=original.manifestSha256;
    const selected=cache.get(key);
    if(selected) {
      try {
        const current=await service.get({id:selected});
        if(sameSource(current.descriptor,original))return descriptor(current.descriptor);
      } catch(error) {if(!['SF49_DELIVERY_NOT_FOUND','ENOENT'].includes(error.code))throw error;}
      cache.delete(key);
    }
    let offset=0;
    for(;;) {
      const page=await service.state({offset,limit:200});
      for(const row of page.transfers)if(sameSource(row.descriptor,original)) {
        const found=descriptor(row.descriptor);cache.set(key,found.id);return found;
      }
      if(page.nextOffset===null||page.nextOffset===undefined)break;
      ensure(Number.isSafeInteger(page.nextOffset)&&page.nextOffset>offset,
        'The original source transfer page did not advance');
      offset=page.nextOffset;
    }
    throw commissioningError('ORIGINAL_SOURCE_BUNDLE_REQUIRED',
      'Receive this case’s original source bundle in Source delivery before opening its files',404);
  }
  async function resolveBundle(value) {
    const found=await locate(value),file=await service.artifact({id:found.id,kind:'file',name:'manifest.json'});
    ensure(file.sha256===found.manifestSha256,'The original source manifest changed','SOURCE_BUNDLE_CHANGED',409);
    return {directory:dirname(file.path),descriptor:found};
  }
  async function resolveFile(value) {
    const found=await locate(value);
    ensure(typeof value.path==='string'&&value.path.length<=1024,'Select an original source member');
    const member=found.files.find(row=>row.path===value.path);
    ensure(member,'The source bundle does not declare this original file');
    const file=await service.artifact({id:found.id,kind:'file',name:value.path});
    ensure(file.sha256===member.sha256&&file.bytes===member.bytes,
      'The original source file identity changed','SOURCE_BUNDLE_CHANGED',409);
    const url=SOURCE_DELIVERY_HTTP_BASE+'/download?'+new URLSearchParams({id:found.id,kind:'file',name:value.path});
    return {...file,url,bundleId:found.bundleId,manifestSha256:found.manifestSha256};
  }
  return {directory:root,service,resolveBundle,resolveFile,close:()=>service.close()};
}
