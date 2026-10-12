// MIT. Original native/Baserow source and customer input selection for the Ruby desk.
import { access, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { absolute, need, plain, regular, digest, sha, exists, directory, hashObject } from '../files.mjs';

export const NATIVE_ENTRY = 'native-dataset-lifecycle';
export const BASEROW_ENTRY = 'baserow-customer-lifecycle';
export const BASEROW_OPERATION = 'BASEROW-PUBLIC-CATALOG-CAPTURE-0D0B-20261012';
export const SOURCE_SCHEMA = 'stellar-forge.ruby-customer-source.v1';
const NATIVE_INPUT_KEYS = ['checkout','dataset_id','keys','native_manifest','node','python','room','source_key'];
const HASH = /^[a-f0-9]{64}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

export function intent(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'RUBY_CUSTOMER_IDENTIFIER');
  return value;
}
export function sourceKind(value) {
  need(value === 'native' || value === 'baserow', 'RUBY_CUSTOMER_SOURCE_KIND');
  return value;
}
export function equal(left, right) { return hashObject(left) === hashObject(right); }
export function fieldKeys(value) {
  need(Array.isArray(value) && value.length <= 64 && value.every(v => typeof v === 'string' && FIELD.test(v)) &&
    new Set(value).size === value.length, 'RUBY_CUSTOMER_KEYS');
  return [...value];
}
export function checkoutRef(value) {
  need(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value), 'RUBY_CUSTOMER_SOURCE_REF');
  return value;
}
export function selectedQuery(value = '') {
  need(typeof value === 'string' && value.length <= 65536 && !value.includes('\0'), 'RUBY_CUSTOMER_QUERY');
  return value;
}
export function separated(first, second) {
  for (const [base,target] of [[first,second],[second,first]]) {
    const part = relative(base,target);
    need(part && (isAbsolute(part) || part === '..' || part.startsWith('../')),
      'RUBY_CUSTOMER_SEPARATE_DIRECTORIES', 'Use separate original source, checkout and customer output directories.');
  }
}
export async function outputDirectory(value) {
  absolute(value);
  if (await exists(value)) await directory(value);
  else {
    need(await realpath(dirname(value)) === dirname(value), 'RUBY_CUSTOMER_OUTPUT_PARENT');
    const parent = await lstat(dirname(value));
    need(parent.isDirectory() && !parent.isSymbolicLink(), 'RUBY_CUSTOMER_OUTPUT_PARENT');
  }
  return value;
}
export async function executable(value) {
  absolute(value);
  const resolved = await realpath(value), item = await lstat(resolved);
  need(item.isFile(), 'RUBY_CUSTOMER_EXECUTABLE');
  await access(value, constants.X_OK);
  // The invoked spelling is part of Python virtual-environment selection.
  return value;
}
export async function sourceDirectory(value) {
  absolute(value);
  const info = await lstat(value);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(value) === value,
    'RUBY_CUSTOMER_CHECKOUT_DIRECTORY');
  return value;
}
async function read(path, maximum, expected) {
  const raw = await regular(path,maximum), hash = digest(raw);
  if (expected !== undefined) need(hash === sha(expected), 'RUBY_CUSTOMER_SOURCE_CHANGED',
    'Select the same original source bytes that were reviewed.', 409);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)); }
  catch { need(false,'RUBY_CUSTOMER_SOURCE_JSON'); }
  need(plain(value),'RUBY_CUSTOMER_SOURCE_JSON');
  return { raw, value, descriptor:{bytes:raw.length,sha256:hash} };
}
function descriptor(value, maximum = 256*1024*1024) {
  need(plain(value) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= maximum &&
    typeof value.sha256 === 'string' && HASH.test(value.sha256),'RUBY_CUSTOMER_SOURCE_DESCRIPTOR');
  return {bytes:value.bytes,sha256:value.sha256};
}
export async function prepareSource({kind,directory:root,expectedSha256} = {}) {
  sourceKind(kind); await directory(absolute(root));
  const name = kind === 'native' ? 'manifest.json' : 'native-result.json';
  const document = await read(join(root,name),kind === 'native' ? 4194304 : 8388608,expectedSha256);
  const value = document.value, metadata = [{name,raw:document.raw,...document.descriptor}];
  let summary, semantics = null;
  if (kind === 'native') {
    const dataset = value.dataset;
    need(value.schema === 'stellar-forge.buyer-delivery-manifest.v1' && plain(dataset) &&
      typeof dataset.name === 'string' && dataset.name && dataset.name.length <= 4096 &&
      Number.isSafeInteger(dataset.rows) && dataset.rows >= 0 && dataset.rows <= 1000000 &&
      HASH.test(dataset.snapshot) && HASH.test(dataset.originalQueryHash) &&
      Array.isArray(dataset.projectedFields) && dataset.projectedFields.length >= 1 &&
      equal(fieldKeys(dataset.projectedFields),dataset.projectedFields) &&
      Array.isArray(value.sourcePages) && value.sourcePages.length >= 1 && value.sourcePages.length <= 4096 &&
      plain(value.outputs) && HASH.test(value.chainDigest), 'RUBY_CUSTOMER_NATIVE_MANIFEST');
    for (const output of ['dataset.jsonl','dataset.csv','review.html'])
      descriptor(value.outputs[output]);
    if (value.semantics !== undefined && value.semantics !== null) {
      need(plain(value.semantics) && value.semantics.file === 'semantics.json' &&
        plain(value.outputs['semantics.json']), 'RUBY_CUSTOMER_NATIVE_SEMANTICS');
      const expected = descriptor(value.outputs['semantics.json'],2097152);
      const file = await read(join(root,'semantics.json'),2097152,expected.sha256);
      need(file.raw.length === expected.bytes, 'RUBY_CUSTOMER_SOURCE_CHANGED',undefined,409);
      metadata.push({name:'semantics.json',raw:file.raw,...file.descriptor});
      semantics = file.value;
    }
    const primary = semantics?.primaryKey;
    const keys = primary?.complete === true ? fieldKeys(primary.projected) : [];
    need(keys.every(key=>dataset.projectedFields.includes(key)), 'RUBY_CUSTOMER_NATIVE_SEMANTICS');
    summary = {name:dataset.name,rows:dataset.rows,fields:[...dataset.projectedFields],
      suggestedKeys:keys,sourcePages:value.sourcePages.length,snapshot:dataset.snapshot,
      querySha256:dataset.originalQueryHash,paymentStatus:value.paymentStatus ?? null,
      filters:dataset.filters ?? null,ranges:dataset.ranges ?? null,order:dataset.order ?? null,
      provider:semantics?.source ?? null,semanticsSchema:semantics?.schema ?? null,
      outputs:value.outputs};
  } else {
    const publication = value.publication, source = value.source;
    need(value.schema === 'stellar-forge.baserow-native-customer-journey.v1' &&
      value.operation === BASEROW_OPERATION && value.state === 'COMPLETED' && value.directory === root &&
      plain(publication) && publication.state === 'PUBLISHED' && publication.reopened === true &&
      publication.publisherDirectory === join(root,'publisher') &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(publication.runId) &&
      HASH.test(publication.snapshot) && HASH.test(publication.originalCandidateDigest) &&
      plain(source) && HASH.test(source.sha256) && HASH.test(source.captureSha256),
      'RUBY_CUSTOMER_BASEROW_RESULT');
    summary = {name:'Original Baserow publication',rows:source.rows ?? null,fields:[],
      suggestedKeys:[],operation:value.operation,sourceSha256:source.sha256,
      captureSha256:source.captureSha256,snapshot:publication.snapshot,
      candidateSha256:publication.originalCandidateDigest,runId:publication.runId,
      publisherDirectory:publication.publisherDirectory,
      sourceVersion:value.workspaceReceiving?.sourceVersion ?? null,
      recipientVersion:value.workspaceReceiving?.recipientVersion ?? null};
  }
  return {view:{schema:SOURCE_SCHEMA,kind,directory:root,manifest:{name,...document.descriptor},
    summary,metadata:{manifest:value,semantics}},metadata};
}
export async function previewSource(input) { return (await prepareSource(input)).view; }
function nativeSelected(input, out) {
  need(plain(input) && equal(Object.keys(input).sort(),NATIVE_INPUT_KEYS) &&
    Array.isArray(input.keys),'RUBY_CUSTOMER_ORIGINAL_INPUT');
  return {kind:'native',sourceDirectory:absolute(input.room),expectedSourceSha256:sha(input.native_manifest),
    outputDirectory:absolute(out),checkout:absolute(input.checkout),python:absolute(input.python),node:absolute(input.node),
    sourceKey:intent(input.source_key),datasetId:intent(input.dataset_id),keys:fieldKeys(input.keys)};
}
function baserowSelected(input, out) {
  need(input.schema === 'stellar-forge.baserow-rails-customer-input.v1' &&
    input.operation === BASEROW_OPERATION && plain(input.runtime) &&
    [undefined,null,'selected-absolute'].includes(input.runtimePathMode), 'RUBY_CUSTOMER_ORIGINAL_INPUT');
  return {kind:'baserow',sourceDirectory:absolute(input.originalRun),
    expectedSourceSha256:sha(input.originalResultSha256),outputDirectory:absolute(out),
    checkout:absolute(input.runtime.checkout),python:absolute(input.runtime.python),node:absolute(input.runtime.node),
    customerKey:intent(input.customerKey),datasetId:intent(input.datasetId),
    sourceRef:checkoutRef(input.sourceRef),query:selectedQuery(input.query)};
}
export async function originalInput(root) {
  await directory(absolute(root));
  const document = await read(join(root,'lifecycle-input.json'),4194304);
  const selected = document.value.schema === 'stellar-forge.baserow-rails-customer-input.v1' ?
    baserowSelected(document.value,root) : nativeSelected(document.value,root);
  return {selected,input:document.value,raw:document.raw,descriptor:{name:'lifecycle-input.json',...document.descriptor}};
}
export function originalArguments(selected) {
  if (selected.kind === 'native') return ['run','--out',selected.outputDirectory,'--room',selected.sourceDirectory,
    '--native-manifest-sha256',selected.expectedSourceSha256,'--source-key',selected.sourceKey,
    '--dataset-id',selected.datasetId,'--checkout',selected.checkout,'--python',selected.python,
    '--node',selected.node,...selected.keys.flatMap(key=>['--key',key])];
  return ['run','--native-run',selected.sourceDirectory,'--out',selected.outputDirectory,
    '--source-ref',selected.sourceRef,'--checkout',selected.checkout,'--python',selected.python,
    '--node',selected.node,'--customer-key',selected.customerKey,'--dataset-id',selected.datasetId,
    '--expected-original-result-sha256',selected.expectedSourceSha256,
    ...(selected.query === '' ? [] : ['--query',selected.query])];
}
export function originalEntry(selected) { return selected.kind === 'native' ? NATIVE_ENTRY : BASEROW_ENTRY; }
export function applicationDirectory(selected) {
  return join(selected.outputDirectory,selected.kind === 'native' ? 'received-application' : 'delivered-application');
}
export async function readResult(selected,{optional=false} = {}) {
  const root = absolute(selected.outputDirectory);
  const name = selected.kind === 'native' ? 'native-rails-result.json' : 'native-result.json';
  if (optional && !await exists(join(root,name))) return null;
  const original = await originalInput(root);
  need(equal(original.selected,selected),'RUBY_CUSTOMER_ORIGINAL_INPUT_CHANGED',
    'This customer output belongs to a different retained selection.',409);
  const result = await read(join(root,name),16777216), value=result.value;
  need(value.inputSha256 === original.descriptor.sha256, 'RUBY_CUSTOMER_RESULT_BINDING',undefined,409);
  let manifestName, expected, rows, fields;
  if (selected.kind === 'native') {
    need(value.schema === 'stellar-forge.ruby-native-dataset-lifecycle.v1' &&
      value.status === 'COMMITTED_AND_REOPENED' && value.sourceId === selected.expectedSourceSha256 &&
      value.receivedApplication === 'received-application' &&
      value.applicationManifest === 'application-delivery.json' && plain(value.rows),
      'RUBY_CUSTOMER_RESULT_BINDING',undefined,409);
    manifestName='application-delivery.json';expected=sha(value.applicationManifestSha256);
    rows=value.rows.rows;fields=value.rows.fields;
  } else {
    need(value.schema === 'stellar-forge.baserow-rails-customer-journey.v1' &&
      value.state === 'COMPLETED' && value.operation === BASEROW_OPERATION &&
      value.originalResultSha256 === selected.expectedSourceSha256 && value.sourceRef === selected.sourceRef &&
      value.applicationDirectory === 'delivered-application' && plain(value.operator) &&
      value.operator.file === 'operator-result.json', 'RUBY_CUSTOMER_RESULT_BINDING',undefined,409);
    manifestName='operator-result.json';expected=sha(value.operator.sha256);
    rows=value.rowCount;fields=value.fields;
  }
  need(Number.isSafeInteger(rows) && rows >= 0 && rows <= 1000000 &&
    Array.isArray(fields) && fields.length >= 1 && equal(fieldKeys(fields),fields), 'RUBY_CUSTOMER_RESULT_BINDING');
  const app=applicationDirectory(selected);
  await directory(app);
  const manifest=await read(join(app,manifestName),16777216,expected);
  need(manifest.value.schema === (selected.kind === 'native' ?
    'stellar-forge.ruby-native-dataset-application.v1' : 'stellar-forge.baserow-rails-operator-application.v1'),
    'RUBY_CUSTOMER_APPLICATION_BINDING',undefined,409);
  return {schema:'stellar-forge.ruby-customer-result.v1',directory:root,
    file:{name,...result.descriptor},input:original.descriptor,rows,fields,
    application:{directory:app,manifest:{name:manifestName,...manifest.descriptor}},original:value};
}
export async function previewExisting({directory:root} = {}) {
  const original = await originalInput(root);
  const result = await readResult(original.selected,{optional:true});
  return {schema:'stellar-forge.ruby-customer-existing.v1',directory:root,
    input:original.descriptor,selected:original.selected,entry:originalEntry(original.selected),
    argv:originalArguments(original.selected),result};
}

/** Recognize only the original lifecycle command forms; retain their literal argv. */
export function matchesOriginalArguments(entry,argv,selected,{allowReopen=false} = {}) {
  if (!Array.isArray(argv) || argv.some(v=>typeof v!=='string') || argv.length===0) return false;
  const words=[...argv], command=words.shift(), values={}, keys=[];
  const native=entry===NATIVE_ENTRY;
  if (!native && entry!==BASEROW_ENTRY) return false;
  const names=native ?
    {'--out':'outputDirectory','--room':'sourceDirectory','--native-manifest-sha256':'expectedSourceSha256',
     '--source-key':'sourceKey','--dataset-id':'datasetId','--checkout':'checkout','--python':'python','--node':'node'} :
    {'--native-run':'sourceDirectory','--out':'outputDirectory','--source-ref':'sourceRef','--checkout':'checkout',
     '--python':'python','--node':'node','--customer-key':'customerKey','--dataset-id':'datasetId','--query':'query',
     '--directory':'directory','--expected-original-result-sha256':'expectedSourceSha256'};
  while(words.length) {
    const key=words.shift(), value=words.shift();
    if(value===undefined)return false;
    if(native && key==='--key'){keys.push(value);continue;}
    if(!Object.hasOwn(names,key) || !native && Object.hasOwn(values,names[key]))return false;
    values[names[key]]=value;
  }
  if(allowReopen && (native && command==='reopen' || !native && ['resume','reopen'].includes(command)))
    return keys.length===0 && Object.keys(values).length===1 &&
      (native ? values.outputDirectory : values.directory)===selected.outputDirectory;
  if(command!=='run' || selected.kind!==(native?'native':'baserow'))return false;
  const expected={...selected};delete expected.kind;
  if(native){delete expected.keys;if(!equal(keys,selected.keys))return false;}
  else {if(values.directory!==undefined)return false;values.query ??='';values.expectedSourceSha256 ??=selected.expectedSourceSha256;}
  return equal(values,expected);
}
