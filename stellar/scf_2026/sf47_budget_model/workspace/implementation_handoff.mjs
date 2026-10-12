// MIT. Read original SF74 implementation evidence into the existing SF47 case.
// The producer's validator and comparison engine remain authoritative.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {
  COMMISSIONING_SCHEMA, validateCommissioning, commissioningSummary,
  commissioningComparisons, commissioningReceivingMatches, commissioningReport,
  commissioningOriginalFiles, commissioningSourceBundles
} from '../../../scf-starforge-20261009/sf74-merchant-support-console/commissioning.mjs';
import {
  WORKSPACE_SCHEMA, parseWorkspace
} from '../../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs';
import {
  HANDOFF_SCHEMA, importRuntimeHandoff
} from '../../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';

export const IMPLEMENTATION_SOURCE_SCHEMA='stellar-forge.sf47-implementation-source.v1';
const MAX_INPUT=8*1024*1024,MAX_OUTPUT=16*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const canonical=value=>JSON.stringify(ordered(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const error=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const time=value=>{
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))
    throw error('IMPLEMENTATION_CUTOFF','Use an explicit UTC observation cutoff.');
  const normalized=new Date(value).toISOString();
  if(normalized!==value)throw error('IMPLEMENTATION_CUTOFF','Use a canonical UTC cutoff, including milliseconds.');
  return Date.parse(value);
};
const included=(row,cutoff)=>Date.parse(row.observedAt)<=cutoff&&Date.parse(row.recordedAt)<=cutoff;
const compareObservations=(a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||
  Date.parse(a.recordedAt)-Date.parse(b.recordedAt);

function receivingStatuses(state,observed,cutoff) {
  const superseded=new Map(observed.receiving.filter(row=>row.supersedesId).map(row=>[row.supersedesId,row.id]));
  const currentSuperseded=new Map(state.receiving.filter(row=>row.supersedesId).map(row=>[row.supersedesId,row.id]));
  const latest=new Map();
  for(const row of observed.receiving)
    if(row.editionId===state.activeEditionId&&!superseded.has(row.id))
      for(const taskId of row.taskIds){
        const key=row.kind+':'+taskId,prior=latest.get(key);
        if(!prior||compareObservations(row,prior)>=0)latest.set(key,row);
      }
  const activeTasks=new Set(state.tasks.filter(row=>!row.retired&&row.status!=='retired').map(row=>row.id));
  return state.receiving.map(row=>{
    const subjectMatches=commissioningReceivingMatches(state,row);
    const latestTaskIds=row.taskIds.filter(id=>latest.get(row.kind+':'+id)?.id===row.id);
    const effectiveTaskIds=subjectMatches?latestTaskIds.filter(id=>activeTasks.has(id)):[];
    return {id:row.id,withinCutoff:included(row,cutoff),activeEdition:row.editionId===state.activeEditionId,
      supersededBy:superseded.get(row.id)||null,currentSupersededBy:currentSuperseded.get(row.id)||null,
      subjectMatches,latestTaskIds,effectiveTaskIds,
      currentAcceptedTaskIds:row.outcome==='accepted'?effectiveTaskIds:[]};
  });
}

export async function inspectImplementationSource(raw,{asOfAt}={}) {
  if(!Buffer.isBuffer(raw))raw=Buffer.from(raw);
  if(!raw.length||raw.length>MAX_INPUT)
    throw error('IMPLEMENTATION_SOURCE_SIZE','Select a complete original implementation JSON source up to 8 MiB.',413);
  const cutoff=time(asOfAt),sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  let original;
  try{original=JSON.parse(sourceText);}catch{throw error('IMPLEMENTATION_SOURCE_INVALID','The selected original is not complete JSON.');}
  if(!plain(original))throw error('IMPLEMENTATION_SOURCE_INVALID','Select an original SF74 implementation, workspace or support handoff.');
  let state,rawState,origin={format:null,name:'',exportedAt:null,workspaceSha256:null,supportSha256:null,metadata:null};
  if(original.schema===COMMISSIONING_SCHEMA){
    rawState=original;state=await validateCommissioning(rawState);origin.format='commissioning';
  }else if(original.schema===WORKSPACE_SCHEMA){
    const workspace=await parseWorkspace(sourceText);
    rawState=original.commissioning;state=workspace.commissioning;
    origin={...origin,format:'workspace',name:workspace.name,exportedAt:workspace.savedAt,workspaceSha256:hash(sourceText)};
  }else if(original.schema===HANDOFF_SCHEMA){
    const imported=await importRuntimeHandoff(sourceText);
    const workspace=await parseWorkspace(imported.workspaceText);
    rawState=JSON.parse(imported.workspaceText).commissioning;state=workspace.commissioning;
    origin={...origin,format:'support-handoff',name:workspace.name,exportedAt:original.generatedAt,
      workspaceSha256:hash(imported.workspaceText),supportSha256:hash(imported.supportText),metadata:imported.metadata===undefined?null:clone(imported.metadata)};
  }else throw error('IMPLEMENTATION_SOURCE_KIND','Select merchant-commissioning.json, the complete merchant workspace, or the original merchant support handoff.');
  if(!state)throw error('IMPLEMENTATION_NOT_PRESENT','This original source contains no implementation record. Prepare or select it in the original Support case first.');
  const originalState=clone(rawState);delete originalState.blobs;
  const normalizedState=clone(state);delete normalizedState.blobs;
  const observed={...state,receiving:state.receiving.filter(row=>included(row,cutoff)),
    measurements:state.measurements.filter(row=>included(row,cutoff))};
  const corrected=new Map(observed.measurements.filter(row=>row.supersedesId).map(row=>[row.supersedesId,row.id]));
  const currentCorrected=new Map(state.measurements.filter(row=>row.supersedesId).map(row=>[row.supersedesId,row.id]));
  const files=Object.entries(state.blobs).map(([sha256,blob])=>({sha256,bytes:blob.bytes})).sort((a,b)=>a.sha256.localeCompare(b.sha256));
  const originalFiles=commissioningOriginalFiles(state),sourceBundles=commissioningSourceBundles(state);
  const externalFiles=originalFiles.filter(file=>!Object.hasOwn(state.blobs,file.sha256));
  const readerFiles=[
    ['./implementation_handoff.mjs','sf47/workspace/implementation_handoff.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/commissioning.mjs','sf74/commissioning.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs','sf74/workspace-file.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs','sf74/runtime-support.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/service-commitments.mjs','sf74/service-commitments.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/source-bundle-reference.mjs','sf74/source-bundle-reference.mjs'],
    ['../../../scf-starforge-20261009/sf97-merchant-revenue-ops/native-reconcile.mjs','sf97/native-reconcile.mjs'],
    ['../../../scf-starforge-20261009/sf30-seller-sdk/operations/history.mjs','sf30/operations/history.mjs'],
    ['../../../scf-starforge-20261009/sf30-seller-sdk/seller.mjs','sf30/seller.mjs'],
    ['../../../scf-starforge-20261009/sf30-seller-sdk/http-methods.mjs','sf30/http-methods.mjs']
  ];
  const reader={};
  for(const [relative,label] of readerFiles)reader[label]=hash(await readFile(new URL(relative,import.meta.url)));
  const result={schema:IMPLEMENTATION_SOURCE_SCHEMA,
    source:{sha256:hash(raw),bytes:raw.length,schema:original.schema},origin,asOfAt,
    definitionBasis:'The complete selected source snapshot. Earlier task definitions are not reconstructed from an observation cutoff.',
    originalState,state:normalizedState,files,originalFiles,sourceBundles,externalFiles,reader,
    summary:commissioningSummary(observed),currentSummary:commissioningSummary(state),
    comparisons:commissioningComparisons(observed),
    receivingStatus:receivingStatuses(state,observed,cutoff),
    measurementStatus:state.measurements.map(row=>({id:row.id,withinCutoff:included(row,cutoff),
      supersededBy:corrected.get(row.id)||null,currentSupersededBy:currentCorrected.get(row.id)||null,
      activeEdition:row.editionId===state.activeEditionId})),
    originalReportHtml:commissioningReport(state)};
  result.projectionSha256=hash(canonical(result));
  const serialized=JSON.stringify(result);
  if(Buffer.byteLength(serialized)>MAX_OUTPUT)
    throw error('IMPLEMENTATION_REVIEW_SIZE','The complete original implementation review exceeds 16 MiB. Select a supported original evidence export without removing its source history.',413);
  return result;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{
    const args=process.argv.slice(2);
    if(args.length!==2||args[0]!=='--as-of')throw error('IMPLEMENTATION_CUTOFF','Supply the selected UTC cutoff through --as-of.');
    const chunks=[];let bytes=0;
    for await(const chunk of process.stdin){
      bytes+=chunk.length;if(bytes>MAX_INPUT)throw error('IMPLEMENTATION_SOURCE_SIZE','The complete original exceeds the 8 MiB receiving bound.',413);
      chunks.push(chunk);
    }
    const result=await inspectImplementationSource(Buffer.concat(chunks),{asOfAt:args[1]});
    process.stdout.write(JSON.stringify({ok:true,result})+'\n');
  }catch(cause){
    const code=typeof cause.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(cause.code)?cause.code:'IMPLEMENTATION_SOURCE_INVALID';
    process.stdout.write(JSON.stringify({ok:false,error:{code,message:String(cause.message||'The original implementation could not be read.').slice(0,1200),status:cause.status===413?413:422}})+'\n');
    process.exitCode=2;
  }
}
