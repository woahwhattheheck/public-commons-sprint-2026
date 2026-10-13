// MIT. Original semantic worker lifecycle for retained DCAT editions.
import { open, readFile, readdir, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { bytes, digest, readPrivate, hashPrivate, createFile, atomicJson, privateDirectory, fault, stamp }
  from '../postgres/publisher/files.mjs';
import { verifyDcatSemanticRuntimeEnvironment } from './dcat-semantic-runtime.mjs';

export const DCAT_SEMANTIC_NATIVE_SCHEMA = 'stellar-forge.dcat-semantic-native-result.v1';
export const DCAT_SEMANTIC_MAX_INPUT = 64 * 1024 * 1024;
const REQUEST_SCHEMA = 'stellar-forge.dcat-semantic-native-request.v1';
const MAX_CONTROL = 16 * 1024 * 1024, MAX_TOTAL = 2 * 1024 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const FORMATS = new Set(['turtle','nt','xml','json-ld']);
const VENDOR = fileURLToPath(new URL('./vendor/semantic-operator/', import.meta.url));
const PREPARE = fileURLToPath(new URL('./dcat_semantic_prepare.py', import.meta.url));
const VENDOR_MANIFEST_SHA = '2fff66af17de2e0c5f4c35ba0e765a3bf0ea44f8347b78f72e14c54d973286b0';
const RUNTIME_MANIFEST_SHA = '8f148b0b6a3c0ae2660d55b4c300fba76ac1f7805e4e693ff76c3b3297b0cb04';
const BASE_CLASSES = ['Catalog','Dataset','DatasetSeries'].map(x => 'http://www.w3.org/ns/dcat#' + x);
const terminal = value => ['COMPLETE','FAILED','CANCELLED','INTERRUPTED'].includes(value);
const need = (ok, code, message = code, status = 400) => { if (!ok) throw fault(code,message,status); };
const errorView = error => ({code:error?.code ?? error?.name ?? 'DCAT_SEMANTIC_FAILED',
  message:String(error?.message ?? error).slice(0,4000)});
function simple(value, name, maximum=512) {
  need(typeof value==='string' && value.length>0 && value.length<=maximum,
    'DCAT_SEMANTIC_INPUT_INVALID','Enter ' + name + '.'); return value;
}
function identifier(value) {
  need(typeof value==='string' && UUID.test(value),'DCAT_SEMANTIC_RUN_INVALID'); return value;
}
function iri(value) {
  simple(value,'an explicit absolute base/class IRI',4096);
  need(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/[\x00-\x20<>"{}|\\^`]/.test(value),
    'DCAT_SEMANTIC_IRI_INVALID','Use a complete absolute IRI without unescaped control characters.');
  let parsed;try {parsed=new URL(value);} catch {throw fault('DCAT_SEMANTIC_IRI_INVALID');}
  need(!parsed.username && !parsed.password,'DCAT_SEMANTIC_IRI_INVALID','Do not put credentials in retained IRIs.');
  return value;
}
function member(value) {
  need(typeof value==='string' && value.length>0 && !value.includes('\\') && !value.includes('\0')
    && !value.startsWith('/') && value.split('/').every(x=>x && x!=='.' && x!=='..'),
    'DCAT_SEMANTIC_PATH_INVALID');return value;
}
function integer(value,min,max,name) {
  need(Number.isSafeInteger(value) && value>=min && value<=max,
    'DCAT_SEMANTIC_LIMIT_INVALID','Choose a supported ' + name + '.');return value;
}
function descriptor(value,key,role,format) {
  need(value && typeof value==='object' && typeof value.path==='string' && isAbsolute(value.path),
    'DCAT_SEMANTIC_INPUT_INVALID','Resolve a retained local source before running.');
  need(typeof value.sha256==='string' && HASH.test(value.sha256),'DCAT_SEMANTIC_HASH_INVALID');
  integer(value.bytes,0,DCAT_SEMANTIC_MAX_INPUT,'input size');
  if(format==='rdf') { format=value.format;need(FORMATS.has(format),'DCAT_SEMANTIC_FORMAT_INVALID'); }
  return {path:resolve(value.path),entry:{key,role,format,sha256:value.sha256,bytes:value.bytes,
    source_id:simple(value.id,'a retained source ID'),revision:value.revision ?? null,
    title:simple(value.title ?? key,'a source title'),
    source_reference:value.sourceReference ?? null}};
}
function request(spec) {
  need(spec && typeof spec==='object','DCAT_SEMANTIC_REQUEST_INVALID');
  identifier(spec.runId);iri(spec.baseIRI);
  need(['require-absent','replace-root','preserve'].includes(spec.contextMode),
    'DCAT_SEMANTIC_CONTEXT_POLICY_REQUIRED','Select the explicit local root-context policy.');
  const profile=spec.profile;
  need(profile && typeof profile.id==='string' && HASH.test(profile.sha256 ?? ''),
    'DCAT_SEMANTIC_PROFILE_INVALID');
  integer(profile.revision,1,Number.MAX_SAFE_INTEGER,'profile revision');
  need(Array.isArray(spec.shapes) && spec.shapes.length>=1 && spec.shapes.length<=64,
    'DCAT_SEMANTIC_SHAPES_REQUIRED','Select one to 64 retained shape files.');
  const ontology=spec.ontologies ?? [];
  need(Array.isArray(ontology) && ontology.length<=64,'DCAT_SEMANTIC_ONTOLOGIES_INVALID');
  const selected=[descriptor(spec.catalog,'catalog','data','json'),
    descriptor(spec.context,'context','provenance','json'),
    ...spec.shapes.map((x,i)=>descriptor(x,'shape-'+String(i+1).padStart(3,'0'),'shapes','rdf')),
    ...ontology.map((x,i)=>descriptor(x,'ontology-'+String(i+1).padStart(3,'0'),'ontology','rdf'))];
  need(selected.reduce((n,x)=>n+x.entry.bytes,0)<=512*1024*1024,
    'DCAT_SEMANTIC_INPUTS_TOO_LARGE','The selected original inputs exceed 512 MiB.');
  const parameters={inference:spec.parameters?.inference ?? 'none',
    allow_infos:spec.parameters?.allow_infos ?? false,allow_warnings:spec.parameters?.allow_warnings ?? false};
  need(['none','rdfs','owlrl','both'].includes(parameters.inference)
    && typeof parameters.allow_infos==='boolean' && typeof parameters.allow_warnings==='boolean',
    'DCAT_SEMANTIC_PARAMETERS_INVALID');
  const limits={timeout_seconds:integer(spec.limits?.timeout_seconds ?? 120,5,600,'timeout'),
    memory_mib:integer(spec.limits?.memory_mib ?? 1024,256,4096,'memory limit')};
  const supplied=spec.coverageClasses ?? [];
  need(Array.isArray(supplied) && supplied.length<=256,'DCAT_SEMANTIC_COVERAGE_INVALID');
  const coverageClasses=[...new Set([...BASE_CLASSES,...supplied.map(iri)])].sort();
  return {selected,value:{schema:REQUEST_SCHEMA,runId:spec.runId,
    profile:{id:profile.id,revision:profile.revision,sha256:profile.sha256},
    baseIRI:spec.baseIRI,contextMode:spec.contextMode,parameters,limits,coverageClasses,
    engine:{manifest_sha256:VENDOR_MANIFEST_SHA,worker:'semantic_operator.worker',
      contract:'commons-semantic-native-job/1',runtime_manifest_sha256:RUNTIME_MANIFEST_SHA},
    inputs:selected.map(x=>x.entry)}};
}

function comparisonRequest(spec,root) {
  need(spec && typeof spec==='object','DCAT_SEMANTIC_COMPARISON_INVALID');
  identifier(spec.runId);
  const selected=[];
  function side(value,name) {
    need(value && typeof value==='object','DCAT_SEMANTIC_COMPARISON_SIDE_INVALID');
    identifier(value.runId);identifier(value.profileId);
    need(value.runId!==spec.runId && HASH.test(value.runSha256 ?? '')
      && HASH.test(value.profileSha256 ?? '') && HASH.test(value.nativeResultSha256 ?? ''),
      'DCAT_SEMANTIC_COMPARISON_BINDING_INVALID');
    iri(value.baseIRI);
    const selection=value.selection;
    need(selection && ['catalog','candidate'].includes(selection.kind) && UUID.test(selection.id ?? '')
      && HASH.test(selection.sha256 ?? ''),'DCAT_SEMANTIC_COMPARISON_SOURCE_INVALID');
    integer(selection.bytes,0,DCAT_SEMANTIC_MAX_INPUT,'selected catalog size');
    if(selection.kind==='candidate')need(HASH.test(selection.reviewSha256 ?? '')
      && HASH.test(selection.reportSha256 ?? ''),'DCAT_SEMANTIC_COMPARISON_SOURCE_INVALID');
    const binding={runId:value.runId,runSha256:value.runSha256,profileId:value.profileId,
      profileSha256:value.profileSha256,nativeResultSha256:value.nativeResultSha256,
      selection:{...selection},baseIRI:value.baseIRI,snapshot:{}};
    for(const [part,format,role] of [['graph','nt','snapshot'],['provenance','json','provenance']]) {
      const file=value.snapshot?.[part];
      need(file && HASH.test(file.key ?? ''),'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_INVALID');
      const input=descriptor({...file,id:value.runId+'-'+part,title:name+' original snapshot '+part,
        sourceReference:{runId:value.runId,runSha256:value.runSha256,profileId:value.profileId,
          profileSha256:value.profileSha256,selection:binding.selection}},name+'-'+part,role,format);
      input.entry.original_source_reference=input.entry.source_reference;
      input.entry.source_reference=value.baseIRI;
      selected.push(input);
      const retainedPath=member(relative(root,input.path));
      need(retainedPath.startsWith(value.runId+'/'),'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_INVALID');
      binding.snapshot[part]={path:retainedPath,key:file.key,sha256:file.sha256,bytes:file.bytes};
    }
    return binding;
  }
  const before=side(spec.before,'before'),after=side(spec.after,'after');
  const supplied=spec.parameters?.edge_predicates ?? [];
  need(Array.isArray(supplied) && supplied.length<=256,'DCAT_SEMANTIC_IMPACT_PREDICATES_INVALID');
  const parameters={edge_predicates:[...new Set(supplied.map(iri))].sort(),
    depth:integer(spec.parameters?.depth ?? 2,0,20,'impact depth'),
    node_limit:integer(spec.parameters?.node_limit ?? 100000,1,100000,'impact node limit')};
  const limits={timeout_seconds:integer(spec.limits?.timeout_seconds ?? 120,5,600,'timeout'),
    memory_mib:integer(spec.limits?.memory_mib ?? 1024,256,4096,'memory limit')};
  return {selected,value:{schema:'stellar-forge.dcat-semantic-comparison-native-request.v1',
    kind:'comparison',runId:spec.runId,before,after,parameters,limits,
    engine:{manifest_sha256:VENDOR_MANIFEST_SHA,worker:'semantic_operator.worker',
      contract:'commons-semantic-native-job/1',runtime_manifest_sha256:RUNTIME_MANIFEST_SHA},
    inputs:selected.map(x=>x.entry)}};
}
function comparisonFields(request) {
  return request?.kind==='comparison'?{kind:'comparison',before:request.before,after:request.after,
    comparison:null,impact:null}: {};
}

async function exists(path) {
  try {await lstat(path);return true;} catch(error) {if(error.code==='ENOENT')return false;throw error;}
}
async function once(path,raw) {
  try {await createFile(path,raw);} catch(error) {
    if(error.code!=='EEXIST')throw error;
    const prior=await readPrivate(path,Math.max(MAX_CONTROL,raw.length));
    need(prior.equals(raw),'DCAT_SEMANTIC_REPLAY_CHANGED','The retained operation input changed.',409);
  }
}
async function json(path,maximum=MAX_CONTROL) { return JSON.parse(await readPrivate(path,maximum)); }
async function regular(path,maximum=DCAT_SEMANTIC_MAX_INPUT) {
  const info=await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() && info.nlink===1 && info.size<=maximum,
    'DCAT_SEMANTIC_SOURCE_INVALID','Use a complete original regular source file.');
  return readFile(path);
}
async function filesUnder(root) {
  const result=[];
  async function walk(directory,prefix='') {
    for(const item of await readdir(directory,{withFileTypes:true})) {
      const name=prefix+item.name;member(name);
      need(!item.isSymbolicLink(),'DCAT_SEMANTIC_LINK_REJECTED');
      if(item.isDirectory())await walk(join(directory,item.name),name+'/');
      else {need(item.isFile(),'DCAT_SEMANTIC_SPECIAL_FILE_REJECTED');result.push(name);}
    }
  }
  await walk(root);return result.sort();
}
async function vendorIdentity() {
  const raw=await regular(join(VENDOR,'source-manifest.json'),MAX_CONTROL);
  need(digest(raw)===VENDOR_MANIFEST_SHA,'DCAT_SEMANTIC_VENDOR_CHANGED');
  const manifest=JSON.parse(raw);
  need(manifest.schema==='stellar-forge.dcat-semantic-vendor.v1' && Array.isArray(manifest.files),
    'DCAT_SEMANTIC_VENDOR_INVALID');
  const selectedRaw=await regular(join(VENDOR,'selected-runtime.json'),MAX_CONTROL);
  need(digest(selectedRaw)===RUNTIME_MANIFEST_SHA,'DCAT_SEMANTIC_RUNTIME_SELECTION_CHANGED');
  const selected=JSON.parse(selectedRaw);
  need(selected.schema==='stellar-forge.dcat-semantic-runtime.v1'
    && selected.original_manifest_sha256===VENDOR_MANIFEST_SHA
    && Array.isArray(selected.files),'DCAT_SEMANTIC_RUNTIME_SELECTION_INVALID');
  const originals=new Map(manifest.files.map(x=>[x.path,x]));
  const selectedPaths=new Set();
  for(const item of selected.files) {
    member(item.path);need(!selectedPaths.has(item.path),'DCAT_SEMANTIC_VENDOR_DUPLICATE');
    selectedPaths.add(item.path);
    const original=originals.get(item.path);
    need(original && original.sha256===item.sha256 && original.bytes===item.bytes
      && original.git_blob===item.git_blob,'DCAT_SEMANTIC_RUNTIME_SELECTION_INVALID');
    const body=await regular(join(VENDOR,item.path));
    need(body.length===item.bytes && digest(body)===item.sha256,'DCAT_SEMANTIC_VENDOR_CHANGED',
      'The selected original semantic source changed: '+item.path);
  }
  // The complete upstream tree may coexist with the installed runtime selection.
  // Any extra importable source must still be a manifest-bound original.
  for(const name of await filesUnder(VENDOR)) {
    if(name.endsWith('.pyc') || name.endsWith('.pyo'))
      throw fault('DCAT_SEMANTIC_UNSELECTED_BYTECODE','Remove unselected compiled vendor modules.');
    if(name.endsWith('.py') && !selectedPaths.has(name)) {
      const original=originals.get(name);
      need(original,'DCAT_SEMANTIC_UNSELECTED_MODULE','An undeclared Python module is present.');
      const body=await regular(join(VENDOR,name));
      need(body.length===original.bytes && digest(body)===original.sha256,
        'DCAT_SEMANTIC_VENDOR_CHANGED','An original optional Python module changed.');
    }
  }
  const prepare=await regular(PREPARE);
  return {repository:manifest.repository,commit:manifest.commit,upstreamRoot:manifest.upstream_root,
    manifestSha256:VENDOR_MANIFEST_SHA,runtimeManifestSha256:RUNTIME_MANIFEST_SHA,files:selected.files,
    preparer:{path:'dcat_semantic_prepare.py',bytes:prepare.length,sha256:digest(prepare)}};
}
async function hashFile(path) {
  const result=await hashPrivate(path,MAX_TOTAL);
  return {bytes:result.bytes,sha256:result.hash};
}
function media(name) {
  if(name.endsWith('.json'))return 'application/json';
  if(name.endsWith('.jsonld'))return 'application/ld+json';
  if(name.endsWith('.nt'))return 'application/n-triples';
  if(name.endsWith('.ttl'))return 'text/turtle';
  if(name.endsWith('.srj'))return 'application/sparql-results+json';
  if(name.endsWith('.html'))return 'text/html; charset=utf-8';
  if(name.endsWith('.csv'))return 'text/csv; charset=utf-8';
  if(name.endsWith('.rq'))return 'application/sparql-query';
  if(name.endsWith('.log')||name.endsWith('.txt'))return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
async function inventory(directory,runId,nativeRoles={}) {
  const result=[];let total=0;
  for(const name of await filesUnder(directory)) {
    if(name==='state.json'||name==='result.json'||name.endsWith('/native.lock'))continue;
    const identity=await hashFile(join(directory,name));total+=identity.bytes;
    need(total<=MAX_TOTAL,'DCAT_SEMANTIC_ARTIFACTS_TOO_LARGE','Complete retained run exceeds 2 GiB.');
    const path=runId+'/'+name,custom=nativeRoles[name] ?? {};
    result.push({key:digest(Buffer.from(path)),path,...identity,
      mediaType:custom.media_type ?? media(name),role:custom.role ?? (name.startsWith('sources/')?'original_input':'native_receipt'),
      title:custom.title ?? name,downloadName:basename(name)});
  }
  return result;
}
async function verifyNative(operation,jobRaw) {
  const state=await json(join(operation,'state.json'));
  need(state.status==='complete','DCAT_SEMANTIC_NATIVE_INCOMPLETE');
  const raw=await readPrivate(join(operation,'result.json'),MAX_CONTROL),result=JSON.parse(raw),job=JSON.parse(jobRaw);
  need(digest(raw)===state.result_sha256 && result.schema==='commons-semantic-native-result/1'
    && result.job_id===job.job_id && result.job_sha256===digest(jobRaw)
    && result.generation===state.generation && result.action===job.action,
    'DCAT_SEMANTIC_NATIVE_BINDING_CHANGED');
  integer(result.generation,1,Number.MAX_SAFE_INTEGER,'native generation');
  need(Array.isArray(result.files) && result.files.length>0,'DCAT_SEMANTIC_NATIVE_FILES_MISSING');
  const outputs=join(operation,'attempts',String(result.generation),'outputs'),seen=new Set();
  for(const item of result.files) {
    member(item.path);need(!seen.has(item.path),'DCAT_SEMANTIC_NATIVE_DUPLICATE');seen.add(item.path);
    const identity=await hashFile(join(outputs,item.path));
    need(identity.bytes===item.bytes && identity.sha256===item.sha256,'DCAT_SEMANTIC_NATIVE_OUTPUT_CHANGED');
  }
  const actual=await filesUnder(outputs);
  need(actual.length===seen.size && actual.every(x=>seen.has(x)),'DCAT_SEMANTIC_NATIVE_OUTPUT_SET_CHANGED');
  return {result,raw,outputs};
}
export function createDcatSemanticNative({root,environment=process.env}) {
  need(typeof root==='string' && isAbsolute(root),'DCAT_SEMANTIC_ROOT_INVALID');
  root=resolve(root);const active=new Map();let closed=false;
  const selectedPython=environment.SCF_DCAT_SEMANTIC_PYTHON || environment.SCF_DCAT_PYTHON || 'python3';
  const runtimeEnvironment=Object.fromEntries(['SCF_DCAT_SEMANTIC_RUNTIME',
    'SCF_DCAT_SEMANTIC_RUNTIME_SHA256','SCF_DCAT_SEMANTIC_PYTHON']
    .filter(key=>environment[key]!==undefined).map(key=>[key,environment[key]]));
  const childEnvironment={};
  for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(environment[key])childEnvironment[key]=environment[key];
  childEnvironment.PYTHONDONTWRITEBYTECODE='1';childEnvironment.PYTHONUNBUFFERED='1';

  async function completed(directory,runId) {
    const path=join(directory,'result.json');if(!await exists(path))return null;
    const raw=await readPrivate(path,MAX_CONTROL),result=JSON.parse(raw);
    need(result.schema===DCAT_SEMANTIC_NATIVE_SCHEMA && result.runId===runId && terminal(result.status)
      && Array.isArray(result.artifacts),'DCAT_SEMANTIC_RESULT_INVALID');
    const seen=new Set();
    for(const item of result.artifacts) {
      member(item.path);need(item.path.startsWith(runId+'/') && !seen.has(item.path),'DCAT_SEMANTIC_ARTIFACT_INVALID');
      seen.add(item.path);
      const info=await hashFile(join(root,item.path));
      need(info.bytes===item.bytes && info.sha256===item.sha256
        && item.key===digest(Buffer.from(item.path)),'DCAT_SEMANTIC_ARTIFACT_CHANGED');
    }
    const names=(await filesUnder(directory)).filter(x=>x!=='state.json'&&x!=='result.json'&&!x.endsWith('/native.lock'));
    need(names.length===seen.size && names.every(x=>seen.has(runId+'/'+x)),'DCAT_SEMANTIC_ARTIFACT_SET_CHANGED');
    const resultPath=runId+'/result.json';
    const receipt={key:digest(Buffer.from(resultPath)),path:resultPath,bytes:raw.length,sha256:digest(raw),
      mediaType:'application/json',role:'native_result',title:'Complete native run receipt',downloadName:'result.json'};
    return {...result,resultSha256:digest(raw),resultPath,receipts:[receipt]};
  }

  async function comparisonSide(binding,name,selected) {
    // All paths come from the selected source run's original native receipt.
    // The domain additionally verifies the saved run/profile/catalog record hashes.
    const sourceDirectory=join(root,binding.runId);
    const source=await completed(sourceDirectory,binding.runId);
    need(source && source.kind!=='comparison' && source.resultSha256===binding.nativeResultSha256,
      'DCAT_SEMANTIC_COMPARISON_RUN_CHANGED');
    const sourceRaw=await readPrivate(join(sourceDirectory,'request.json'),MAX_CONTROL);
    need(digest(sourceRaw)===source.requestSha256,'DCAT_SEMANTIC_COMPARISON_REQUEST_CHANGED');
    const original=JSON.parse(sourceRaw),catalog=original.inputs?.find(x=>x.key==='catalog');
    need(original.schema===REQUEST_SCHEMA && original.runId===binding.runId
      && original.profile?.id===binding.profileId && original.profile?.sha256===binding.profileSha256
      && original.baseIRI===binding.baseIRI && catalog?.source_id===binding.selection.id
      && catalog?.sha256===binding.selection.sha256 && catalog?.bytes===binding.selection.bytes,
      'DCAT_SEMANTIC_COMPARISON_SELECTION_CHANGED');
    for(const field of ['kind','id','sha256','bytes','reviewSha256','reportSha256']) {
      need(catalog.source_reference?.[field]===binding.selection[field],
        'DCAT_SEMANTIC_COMPARISON_SELECTION_CHANGED');
    }
    const snapshot=source.snapshot;
    need(snapshot?.schema==='commons-semantic-native-result/1' && snapshot.action==='snapshot'
      && snapshot.job_id===binding.runId+'-snapshot','DCAT_SEMANTIC_COMPARISON_SNAPSHOT_MISSING');
    const operation=join(sourceDirectory,'native-jobs','snapshot');
    const jobRaw=await readPrivate(join(operation,'job.json'),MAX_CONTROL);
    const verified=await verifyNative(operation,jobRaw);
    need(digest(bytes(verified.result))===digest(bytes(snapshot)),
      'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_CHANGED');
    for(const [part,filename,role] of [['graph','graph.nt','graph'],['provenance','provenance.json','provenance']]) {
      const nativeFile=snapshot.files.find(x=>x.path===filename && x.role===role);
      need(nativeFile,'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_MISSING');
      if(part==='graph')need(snapshot.summary?.provenance_complete===true
        && snapshot.summary?.graph_sha256===nativeFile.sha256,'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_CHANGED');
      const relative=binding.runId+'/native-jobs/snapshot/attempts/'+snapshot.generation+'/outputs/'+filename;
      const supplied=binding.snapshot[part],retained=source.artifacts.find(x=>x.path===relative);
      const input=selected.find(x=>x.entry.key===name+'-'+part);
      need(retained && input && supplied.path===relative && retained.key===supplied.key
        && retained.key===digest(Buffer.from(relative))
        && retained.sha256===supplied.sha256 && retained.bytes===supplied.bytes
        && nativeFile.sha256===supplied.sha256 && nativeFile.bytes===supplied.bytes
        && input.path===join(root,relative),'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_CHANGED');
    }
    return {profile:original.profile,baseIRI:original.baseIRI,contextMode:original.contextMode,
      context:original.inputs.find(x=>x.key==='context'),snapshotTriples:snapshot.summary.triples,
      engine:source.engine,requestSha256:source.requestSha256,nativeResultSha256:source.resultSha256};
  }

  async function finish(directory,result,roles={},handle=null) {
    // Once the native child is drained, final receipt adoption has a single
    // boundary. Later cancel requests observe that same completed receipt.
    if(handle) {
      if(handle.stopTask)await handle.stopTask;
      handle.committing=true;
      if(handle.stopKind && result.status==='COMPLETE') {
        result.status=handle.stopKind;
        result.error={code:'DCAT_SEMANTIC_STOPPED',message:handle.stopKind};
        await once(join(directory,'bridge-error.json'),bytes(result.error));
      }
    }
    result.artifacts=await inventory(directory,result.runId,roles);
    const finding=result.artifacts.find(x=>x.role==='findings'&&x.path.includes('/validation/'));
    result.findings=finding?{key:finding.key,sha256:finding.sha256,bytes:finding.bytes,schema:'commons-semantic-findings/1'}:null;
    result.completedAt=stamp();
    await once(join(directory,'result.json'),bytes(result));
    await atomicJson(directory,'state.json',{schema:'stellar-forge.dcat-semantic-native-state.v1',
      runId:result.runId,status:result.status,requestSha256:result.requestSha256,updatedAt:result.completedAt});
    return completed(directory,result.runId);
  }
  async function inspect(runId) {
    identifier(runId);
    if(active.has(runId))return {schema:DCAT_SEMANTIC_NATIVE_SCHEMA,runId,status:'RUNNING',
      phase:active.get(runId).phase,artifacts:[]};
    await privateDirectory(root,true);
    const directory=join(root,runId);await privateDirectory(directory,true);
    const result=await completed(directory,runId);if(result)return result;
    let requestSha256=null,startedAt=null,savedRequest=null;
    if(await exists(join(directory,'request.json'))) {
      const raw=await readPrivate(join(directory,'request.json'),MAX_CONTROL);
      requestSha256=digest(raw);savedRequest=JSON.parse(raw);
    }
    if(await exists(join(directory,'state.json')))startedAt=(await json(join(directory,'state.json'))).startedAt ?? null;
    return finish(directory,{schema:DCAT_SEMANTIC_NATIVE_SCHEMA,runId,status:'INTERRUPTED',
      requestSha256,engine:null,prepared:null,snapshot:null,coverage:null,validation:null,startedAt,
      ...comparisonFields(savedRequest),
      ...(savedRequest?.runtimeBinding?{runtimeBinding:savedRequest.runtimeBinding}:{}),
      error:{code:'DCAT_SEMANTIC_OWNER_INTERRUPTED',message:'The prior owner ended before a complete run receipt was retained.'}});
  }
  async function dispatch(handle,argv,cwd,logName,seconds) {
    need(selectedPython==='python3' || (typeof selectedPython==='string' && isAbsolute(selectedPython)),
      'DCAT_SEMANTIC_PYTHON_INVALID','Configure an absolute semantic Python executable.');
    if(handle.stopKind)throw fault('DCAT_SEMANTIC_STOPPED',handle.stopKind);
    const runtimeBinding=await verifyDcatSemanticRuntimeEnvironment(runtimeEnvironment,
      {expectedSha256:handle.runtimeBinding?.receiptSha256});
    need((runtimeBinding?.receiptSha256 ?? null)===(handle.runtimeBinding?.receiptSha256 ?? null)
      && (!runtimeBinding || runtimeBinding.python===selectedPython),
      'DCAT_SEMANTIC_RUNTIME_BINDING_CHANGED','The selected prepared runtime changed before native dispatch.');
    if(handle.stopKind)throw fault('DCAT_SEMANTIC_STOPPED',handle.stopKind);
    const log=await open(join(handle.directory,logName),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY
      |(constants.O_NOFOLLOW??0),0o600);
    try {
      return await new Promise((resolvePromise,reject)=>{
        let child,timeout,killTimer,failure=null;
        const stop=()=>{
          if(!child||child.exitCode!==null||child.signalCode!==null)return;
          child.kill('SIGTERM');
          if(!killTimer)killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},3000);
        };
        try {
          child=spawn(selectedPython,argv,{cwd,env:{...childEnvironment,TMPDIR:join(handle.directory,'temporary')},
            stdio:['ignore',log.fd,log.fd],shell:false});
        } catch(error) {reject(error);return;}
        handle.child=child;handle.stopChild=stop;
        child.once('error',error=>{failure=error;});
        timeout=setTimeout(()=>{failure=fault('DCAT_SEMANTIC_TIMEOUT','The original native phase exceeded its wall-time limit.');stop();},
          (seconds+5)*1000);
        child.once('close',(code,signal)=>{
          clearTimeout(timeout);clearTimeout(killTimer);handle.child=null;handle.stopChild=null;
          if(failure)reject(failure);
          else if(handle.stopKind)reject(fault('DCAT_SEMANTIC_STOPPED',handle.stopKind));
          else if(code!==0)reject(fault('DCAT_SEMANTIC_PROCESS_FAILED',
            'The original native phase ended with exit '+String(code)+' and signal '+String(signal)+'.'));
          else resolvePromise({exitCode:code,signal});
        });
        if(handle.stopKind)stop();
      });
    } finally {await log.close();}
  }
  function stop(handle,kind) {
    if(handle.committing)return Promise.resolve();
    if(handle.stopKind)return handle.stopTask ?? Promise.resolve();
    handle.stopKind=kind;
    if(!handle.accepted)return Promise.resolve();
    handle.stopTask=(async()=>{
      try {
        if(kind==='CANCELLED') {
          await once(join(handle.directory,'cancel.json'),bytes({runId:handle.runId,at:stamp(),kind}));
          if(handle.operation)await once(join(handle.operation,'cancel.json'),bytes({job_id:handle.jobId,at:stamp(),kind}));
        }
      } catch(error) {
        handle.stopError=error;
      } finally {handle.stopChild?.();}
    })();
    return handle.stopTask;
  }
  async function execute(spec,options,handle,kind) {
    const {selected,value}=kind==='comparison'?comparisonRequest(spec,root):request(spec);
    const directory=handle.directory,roles={};
    const retainedRequest=await exists(join(directory,'request.json'))
      ?await readPrivate(join(directory,'request.json'),MAX_CONTROL):null;
    if(retainedRequest) {
      // Runtime paths in an existing request are historical custody. Replaying a
      // retained result never requires the sender's interpreter to exist here.
      const saved=JSON.parse(retainedRequest);
      if(Object.hasOwn(saved,'runtimeBinding'))value.runtimeBinding=saved.runtimeBinding;
    }
    const prior=await completed(directory,spec.runId);
    if(!prior && !retainedRequest) {
      handle.runtimeBinding=await verifyDcatSemanticRuntimeEnvironment(runtimeEnvironment);
      if(handle.runtimeBinding) {
        need(handle.runtimeBinding.python===selectedPython,'DCAT_SEMANTIC_RUNTIME_BINDING_CHANGED');
        value.runtimeBinding=handle.runtimeBinding;
      }
    }
    const raw=bytes(value);
    if(prior) {need(prior.requestSha256===digest(raw),'DCAT_SEMANTIC_REPLAY_CHANGED',undefined,409);handle.committing=true;return prior;}
    if(retainedRequest) {
      need(retainedRequest.equals(raw),'DCAT_SEMANTIC_REPLAY_CHANGED',undefined,409);
      handle.committing=true;
      return finish(directory,{schema:DCAT_SEMANTIC_NATIVE_SCHEMA,runId:spec.runId,status:'INTERRUPTED',
        requestSha256:digest(raw),engine:null,prepared:null,snapshot:null,coverage:null,validation:null,
        ...comparisonFields(value),...(value.runtimeBinding?{runtimeBinding:value.runtimeBinding}:{}),
        startedAt:null,error:{code:'DCAT_SEMANTIC_PRIOR_OWNER_ENDED',
          message:'This retained run was interrupted. Create an explicitly linked retry to run the same inputs again.'}});
    }
    await once(join(directory,'request.json'),raw);handle.accepted=true;
    const result={schema:DCAT_SEMANTIC_NATIVE_SCHEMA,runId:spec.runId,status:'FAILED',
      requestSha256:digest(raw),engine:null,prepared:null,snapshot:null,coverage:null,validation:null,
      ...comparisonFields(value),...(value.runtimeBinding?{runtimeBinding:value.runtimeBinding}:{}),
      startedAt:stamp(),error:null};
    const update=async phase=>{
      handle.phase=phase;
      const state={schema:'stellar-forge.dcat-semantic-native-state.v1',runId:spec.runId,status:'RUNNING',
        phase,requestSha256:result.requestSha256,startedAt:result.startedAt,updatedAt:stamp()};
      await atomicJson(directory,'state.json',state);if(options.onUpdate)await options.onUpdate(state);
      if(handle.stopKind)throw fault('DCAT_SEMANTIC_STOPPED',handle.stopKind);
    };
    const job=async (phase,action,inputs,parameters)=>{
      await update(phase);
      const operation=join(directory,'native-jobs',phase);await privateDirectory(operation,true);
      const jobId=spec.runId+'-'+phase;
      const selectedJob={schema:'commons-semantic-native-job/1',job_id:jobId,action,
        input_storage:'workspace-content-addressed/1',inputs,parameters,limits:value.limits};
      const jobRaw=bytes(selectedJob);await once(join(operation,'job.json'),jobRaw);
      handle.operation=operation;handle.jobId=jobId;
      await dispatch(handle,['-B','-m','semantic_operator.worker','--operation',operation],VENDOR,
        phase+'.log',value.limits.timeout_seconds);
      const native=await verifyNative(operation,jobRaw);
      const loaded=native.result.summary;
      const selectedEngine=result.engine.files.find(x=>x.path==='semantic_operator/rdf_engine.py');
      need(selectedEngine && loaded?.engine_source_sha256===selectedEngine.sha256,
        'DCAT_SEMANTIC_LOADED_ENGINE_CHANGED','The native stage did not load the selected original RDF engine.');
      need(loaded?.engine_versions?.rdflib==='7.6.0' && loaded?.engine_versions?.pyshacl==='0.40.1',
        'DCAT_SEMANTIC_LOADED_DEPENDENCIES_CHANGED','The native stage did not use the original selected RDF dependencies.');
      for(const file of native.result.files) {
        roles['native-jobs/'+phase+'/attempts/'+native.result.generation+'/outputs/'+file.path]=file;
      }
      handle.operation=null;handle.jobId=null;
      return native;
    };
    try {
      await update('preparing');
      result.engine=await vendorIdentity();
      await once(join(directory,'engine-source.json'),bytes(result.engine));
      for(const name of ['sources','native-jobs','temporary','prepared'])await privateDirectory(join(directory,name),true);
      if(kind==='comparison') {
        result.sourceProfiles={before:await comparisonSide(value.before,'before',selected),
          after:await comparisonSide(value.after,'after',selected)};
      }
      for(const item of selected) {
        const body=await readPrivate(item.path,DCAT_SEMANTIC_MAX_INPUT);
        need(body.length===item.entry.bytes && digest(body)===item.entry.sha256,'DCAT_SEMANTIC_INPUT_CHANGED');
        await once(join(directory,'sources',item.entry.sha256+'.bin'),body);
      }
      if(kind==='comparison') {
        const comparison=await job('compare','compare',value.inputs,{
          before_graph_key:'before-graph',after_graph_key:'after-graph',
          before_provenance_key:'before-provenance',after_provenance_key:'after-provenance',
          ...value.parameters});
        result.comparison=comparison.result;
        const summary=comparison.result.summary;
        need(summary.graph_difference_complete===true && summary.provenance_complete===true
          && summary.before_sha256===value.before.snapshot.graph.sha256
          && summary.after_sha256===value.after.snapshot.graph.sha256,
          'DCAT_SEMANTIC_COMPARISON_OUTPUT_CHANGED');
        result.impact={summary,qualification:
          'The graph difference is complete for these two retained RDF snapshots. Impact is limited to the selected edges, depth and node limit; profile or base-IRI changes can also change RDF statements.'};
      } else {
      await dispatch(handle,['-B',PREPARE,'--request',join(directory,'request.json'),
        '--sources',join(directory,'sources'),'--output',join(directory,'prepared')],directory,
        'prepare.log',value.limits.timeout_seconds);
      result.prepared=await json(join(directory,'prepared','result.json'));
      need(result.prepared.schema==='stellar-forge.dcat-semantic-prepared.v1'
        && result.prepared.catalog_sha256===value.inputs[0].sha256
        && result.prepared.context_sha256===value.inputs[1].sha256,'DCAT_SEMANTIC_PREPARATION_CHANGED');
      const derived=await readPrivate(join(directory,'prepared','catalog.jsonld'),DCAT_SEMANTIC_MAX_INPUT);
      need(digest(derived)===result.prepared.derived.sha256 && derived.length===result.prepared.derived.bytes,
        'DCAT_SEMANTIC_PREPARATION_CHANGED');
      await once(join(directory,'sources',digest(derived)+'.bin'),derived);
      const graphSource={key:'catalog-rdf',role:'data',format:'json-ld',bytes:derived.length,
        sha256:digest(derived),source_id:value.inputs[0].source_id,revision:value.inputs[0].revision,
        title:value.inputs[0].title,source_reference:value.baseIRI,original_source_reference:value.inputs[0].source_reference};
      const snapshot=await job('snapshot','snapshot',[graphSource],{data_keys:['catalog-rdf'],mappings:[]});
      result.snapshot=snapshot.result;
      const graph=snapshot.result.files.find(x=>x.path==='graph.nt'&&x.role==='graph');
      need(graph,'DCAT_SEMANTIC_SNAPSHOT_MISSING');
      const graphRaw=await readPrivate(join(snapshot.outputs,graph.path),DCAT_SEMANTIC_MAX_INPUT);
      await once(join(directory,'sources',graph.sha256+'.bin'),graphRaw);
      const graphEntry={key:'snapshot',role:'snapshot',format:'nt',sha256:graph.sha256,bytes:graph.bytes,
        source_id:spec.runId+'-snapshot',revision:1,title:'Exact original RDF snapshot',source_reference:value.baseIRI};
      const query='SELECT ?class (COUNT(DISTINCT ?subject) AS ?count) WHERE { VALUES ?class { '
        +value.coverageClasses.map(x=>'<'+x+'>').join(' ')
        +' } OPTIONAL { ?subject <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?class . } } GROUP BY ?class ORDER BY ?class';
      const coverage=await job('coverage','query',[graphEntry],{graph_key:'snapshot',query,row_limit:1000});
      need(coverage.result.summary.result_complete===true && coverage.result.summary.truncated===false,
        'DCAT_SEMANTIC_COVERAGE_INCOMPLETE');
      const coverageFile=coverage.result.files.find(x=>x.path==='query-result.srj');
      need(coverageFile,'DCAT_SEMANTIC_COVERAGE_MISSING');
      const bindings=await json(join(coverage.outputs,coverageFile.path));
      result.coverage={kind:'snapshot-explicit-class-presence',query:coverage.result,
        classes:value.coverageClasses,bindings,snapshotTriples:snapshot.result.summary.triples,
        emptyGraph:snapshot.result.summary.triples===0,
        comprehensiveShaclTargetCoverage:{status:'unmeasured',
          reason:'Class presence does not enumerate every SHACL target or prove whole-catalogue mapping.'},
        qualification:'Native conformity applies to the selected derived graph and selected shapes only.'};
      const rdfInputs=value.inputs.filter(x=>x.role==='shapes'||x.role==='ontology').map(x=>({...x,
        original_source_reference:x.source_reference,source_reference:value.baseIRI}));
      const validation=await job('validation','validate',[graphEntry,...rdfInputs],
        {graph_key:'snapshot',shape_keys:rdfInputs.filter(x=>x.role==='shapes').map(x=>x.key),
          ontology_keys:rdfInputs.filter(x=>x.role==='ontology').map(x=>x.key),...value.parameters});
      result.validation=validation.result;
      }
      if(handle.stopKind)throw fault('DCAT_SEMANTIC_STOPPED',handle.stopKind);
      result.status='COMPLETE';
    } catch(error) {
      result.status=handle.stopKind ?? 'FAILED';result.error=errorView(error);
      if(handle.stopError)result.error.cancellationReceiptError=errorView(handle.stopError);
      // Native state, complete earlier stages and every partial output stay in place.
      await once(join(directory,'bridge-error.json'),bytes(result.error));
    } finally {handle.operation=null;handle.jobId=null;}
    return finish(directory,result,roles,handle);
  }
  function begin(spec,options={},kind='validation') {
    need(!closed,'DCAT_SEMANTIC_OWNER_CLOSED');identifier(spec?.runId);
    need(!active.has(spec.runId),'DCAT_SEMANTIC_RUN_ACTIVE','This native run already has an owner.',409);
    const handle={runId:spec.runId,directory:join(root,spec.runId),phase:'preparing',stopKind:null,
      child:null,operation:null,jobId:null,stopChild:null,promise:null,stopTask:null,committing:false,accepted:false,
      runtimeBinding:null};
    active.set(spec.runId,handle);
    const onAbort=()=>{stop(handle,'CANCELLED').catch(error=>{handle.stopError=error;handle.stopChild?.();});};
    handle.promise=(async()=>{
      await privateDirectory(root,true);await privateDirectory(handle.directory,true);
      if(options.signal?.aborted)await stop(handle,'CANCELLED');
      else options.signal?.addEventListener('abort',onAbort,{once:true});
      return execute(spec,options,handle,kind);
    })().finally(()=>{options.signal?.removeEventListener('abort',onAbort);active.delete(spec.runId);});
    return handle.promise;
  }
  function run(spec,options={}) {return begin(spec,options,'validation');}
  function compare(spec,options={}) {return begin(spec,options,'comparison');}
  async function cancel(runId) {
    identifier(runId);const handle=active.get(runId);
    if(!handle)return inspect(runId);
    await stop(handle,'CANCELLED');return handle.promise;
  }
  async function close() {
    closed=true;
    await Promise.all([...active.values()].map(async handle=>{
      await stop(handle,'INTERRUPTED');await handle.promise;
    }));
  }
  return {run,compare,inspect,cancel,close};
}
