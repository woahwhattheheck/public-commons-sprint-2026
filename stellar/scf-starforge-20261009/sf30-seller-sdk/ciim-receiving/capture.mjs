// MIT. Receive the original reviewed OAI capture through Proteus.
// readOaiSourceFile and page-source.py reuse the maintained OAI/XML engine.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, mkdir, rename, lstat, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { CONFIG, XML_SPEC, buildProfile, FIELD_CATALOG, DATACITE_TAGS, NESTED_LAYOUT,
  OAI_NS, OAI_DATACITE_NS, DATACITE_NS, OUTPUT_SCHEMA } from './profile.mjs';
import { renderReport } from './report.mjs';
import { DC_NS, OAI_DC_NS, DC_OUTPUT_SCHEMA, DC_FIELDS, DC_TAGS, buildDcProfile } from './dc-profile.mjs';

function familyFor(prefix) {
  if(prefix==='oai_datacite')return {name:'DataCite 4.5',namespace:DATACITE_NS,tags:DATACITE_TAGS,fields:FIELD_CATALOG,build:buildProfile,schema:OUTPUT_SCHEMA,nested:NESTED_LAYOUT};
  if(prefix==='oai_dc')return {name:'Dublin Core / agreed CIIM intake',namespace:DC_NS,tags:DC_TAGS,fields:DC_FIELDS,build:buildDcProfile,schema:DC_OUTPUT_SCHEMA,nested:{}};
  throw fail('MATCHING_PROFILE_REQUIRED','Choose the original oai_datacite or oai_dc source edition');
}

const SHA = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
const utf8 = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
const bytes = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8');
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, details });
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const fullName = (ns, name) => '{' + ns + '}' + name;

function jsonl(body, label) {
  const lines = utf8(body).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line, index) => {
    if (!line.trim()) throw fail('EMPTY_JSONL_RECORD', label + ' has an empty record', { line:index + 1 });
    let value;
    try { value = JSON.parse(line); } catch { throw fail('INVALID_JSONL', label, { line:index + 1 }); }
    if (!object(value)) throw fail('INVALID_JSONL_RECORD', label, { line:index + 1 });
    return value;
  });
}

async function atomic(path, body) {
  await mkdir(dirname(path), { recursive:true, mode:0o700 });
  const temporary = path + '.writing-' + randomUUID();
  try {
    const handle=await open(temporary,'wx',0o600);
    try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary,path);
    const directory=await open(dirname(path),'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary,{force:true}); }
}

async function checkedMember(retained, name) {
  const descriptor = retained.files.find(item => item.file === name);
  if (!descriptor) throw fail('SOURCE_MEMBER_NOT_DECLARED', name);
  const body = await readFile(join(retained.root, name));
  if (body.length !== descriptor.bytes || digest(body) !== descriptor.sha256)
    throw fail('SOURCE_MEMBER_CHANGED', name);
  return body;
}

export function nativeChildren(node, tag) {
  if (!object(node)) throw fail('NATIVE_NODE_SHAPE', 'A converted XML node must be an object', { tag });
  const direct = own(node, tag) ? node[tag] : [];
  if (!Array.isArray(direct)) throw fail('NATIVE_CHILD_ARRAY', 'Native XML child values must remain arrays', { tag });
  const mixed = node['@mixed'] ?? [];
  if (!Array.isArray(mixed)) throw fail('NATIVE_MIXED_ARRAY', 'Native mixed content must remain an ordered array');
  const nested = [];
  for (const part of mixed) {
    if (!object(part)) throw fail('NATIVE_MIXED_NODE', 'Unexpected mixed-content representation');
    if (own(part, tag)) {
      if (!Array.isArray(part[tag])) throw fail('NATIVE_CHILD_ARRAY', tag);
      nested.push(...part[tag]);
    }
  }
  if (direct.length && nested.length)
    throw fail('AMBIGUOUS_NATIVE_CHILDREN', 'The same children occur in direct and mixed representations', { tag });
  return direct.length ? direct : nested;
}

function tagName(names, expanded) {
  const spellings = names.elements[expanded];
  if (!Array.isArray(spellings) || spellings.length !== 1)
    throw fail('XML_TAG_BINDING_REQUIRED', 'Use one exact namespace-qualified tag spelling per property', {
      expandedName:expanded, spellings:spellings ?? []
    });
  return spellings[0];
}
function optionalTag(names, ns, name) {
  const values = names.elements[fullName(ns, name)];
  if (!values) return null;
  return tagName(names, fullName(ns, name));
}
function childrenNamed(node, names, ns, name) {
  const tag = optionalTag(names, ns, name);
  return tag === null ? [] : nativeChildren(node, tag);
}
function requiredOne(values, what) {
  if (values.length !== 1) throw fail('ORIGINAL_CARDINALITY', what + ' must occur exactly once', { count:values.length });
  return values[0];
}
function packedChildren(node) { return node[2].filter(value => Array.isArray(value)); }
function packedPath(node, names) {
  let values = [node];
  for (const name of names) values = values.flatMap(item => packedChildren(item).filter(child => child[0] === name));
  return values;
}
function coalesce(tokens) {
  const out = [];
  for (const token of tokens) {
    if (typeof token === 'string' && typeof out.at(-1) === 'string') out[out.length - 1] += token;
    else out.push(token);
  }
  return out;
}

// This checks original XML text/attribute semantics and repeated-child counts
// against the ACTUAL converter. Raw XML bytes remain in the original capture.
export function verifyNativeNode(packed, native, names, location = '') {
  if (!Array.isArray(packed) || packed.length !== 3 || !object(native))
    throw fail('NATIVE_SOURCE_NODE_MISMATCH', location);
  const attributes = native['@attributes'] ?? {};
  if (!object(attributes)) throw fail('NATIVE_ATTRIBUTES', location);
  const expectedAttributes = {};
  for (const [expanded, value] of Object.entries(packed[1])) {
    const spellings = names.attributes[expanded];
    const key = spellings?.length === 1 ? spellings[0] : expanded;
    if (!own(attributes, key) || attributes[key] !== value)
      throw fail('NATIVE_ATTRIBUTE_CHANGED', 'An original attribute changed during conversion', { location, expanded, key });
    expectedAttributes[key] = value;
  }
  for (const key of Object.keys(attributes)) {
    if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
    if (!own(expectedAttributes, key))
      throw fail('NATIVE_ATTRIBUTE_ADDED', 'Unexpected converted attribute', { location, key });
  }
  const sourceChildren = packedChildren(packed);
  const byName = new Map();
  for (const child of sourceChildren) {
    const tag = tagName(names, child[0]);
    if (!byName.has(tag)) byName.set(tag, []);
    byName.get(tag).push(child);
  }
  for (const [tag, expected] of byName) {
    const actual = nativeChildren(native, tag);
    if (actual.length !== expected.length)
      throw fail('NATIVE_REPEAT_CHANGED', 'A repeated XML element was dropped or added', { location, tag, expected:expected.length, actual:actual.length });
    for (let index = 0; index < expected.length; index++)
      verifyNativeNode(expected[index], actual[index], names, location + '/' + tag + '[' + (index + 1) + ']');
  }
  const presentChildKeys = new Set(Object.keys(native).filter(key => !key.startsWith('@')));
  for (const part of native['@mixed'] ?? []) {
    for (const key of Object.keys(part)) if (key !== '@content') presentChildKeys.add(key);
  }
  for (const key of presentChildKeys) {
    if (!byName.has(key)) throw fail('NATIVE_ELEMENT_ADDED', 'Unexpected converted child element', { location, key });
  }
  const sourceTokens = coalesce(packed[2].map(item => typeof item === 'string' ? item : {tag:tagName(names, item[0])}));
  if (own(native, '@mixed')) {
    const nativeTokens = [];
    for (const part of native['@mixed']) {
      if (own(part, '@content')) {
        if (typeof part['@content'] !== 'string') throw fail('NATIVE_TEXT_TYPE', location);
        nativeTokens.push(part['@content']);
      }
      for (const [tag, values] of Object.entries(part)) {
        if (tag === '@content') continue;
        if (!Array.isArray(values)) throw fail('NATIVE_MIXED_CHILDREN', location);
        for (const _ of values) nativeTokens.push({tag});
      }
    }
    if (!isDeepStrictEqual(sourceTokens, coalesce(nativeTokens)))
      throw fail('NATIVE_MIXED_CONTENT_CHANGED', 'Ordered original XML text/elements changed during conversion', { location });
  } else {
    const text = packed[2].filter(item => typeof item === 'string').join('');
    const converted = own(native, '@content') ? native['@content'] : '';
    if (typeof converted !== 'string' || text !== converted)
      throw fail('NATIVE_TEXT_CHANGED', 'Original XML whitespace or text changed during conversion', { location });
    if (text && sourceChildren.length)
      throw fail('NATIVE_MIXED_CONTENT_MISSING', 'Text and elements require the native mixed-content representation', { location });
  }
}

function nativeRecordList(page, original) {
  const names = original.records[0]?.names;
  if (!names) {
    if (original.records.length === 0) return [];
    throw fail('ORIGINAL_NAMESPACE_BINDING', 'The original parser must retain namespace spellings');
  }
  // The envelope may use a prefix not repeated inside a record. The original
  // read adapter also returns envelope spellings, so no local-name guess is made.
  const rootTag = original.envelopeNames?.[fullName(OAI_NS, 'OAI-PMH')];
  const containerTag = original.envelopeNames?.[fullName(OAI_NS, original.page.verb)];
  if (typeof rootTag !== 'string' || typeof containerTag !== 'string')
    throw fail('ORIGINAL_ENVELOPE_BINDING', 'Retain original OAI envelope tag spellings');
  const root = requiredOne(nativeChildren(page, rootTag), 'OAI-PMH');
  const container = requiredOne(nativeChildren(root, containerTag), original.page.verb);
  const recordTag = tagName(names, fullName(OAI_NS, 'record'));
  const records = nativeChildren(container, recordTag);
  if (records.length !== original.records.length)
    throw fail('NATIVE_RECORD_COUNT_CHANGED', 'Original and native converted OAI page counts differ');
  return records;
}

export function prepareInput({ observation, original, record, retained, request }) {
  const family=familyFor(retained.capture.selection.metadataPrefix);
  if (original.observationId !== observation.id || original.semanticHash !== observation.semanticHash ||
      original.ordinal !== observation.ordinal || original.identifier !== observation.identifier ||
      original.datestamp !== observation.datestamp || original.status !== observation.status ||
      !isDeepStrictEqual(original.setSpecs, observation.setSpecs))
    throw fail('CURRENT_OBSERVATION_CHANGED', 'This record does not match the current reviewed edition', { identifier:observation.identifier });
  verifyNativeNode(original.node, record, original.names, 'record[' + observation.ordinal + ']');
  const header = requiredOne(childrenNamed(record, original.names, OAI_NS, 'header'), 'OAI header');
  const metadata = childrenNamed(record, original.names, OAI_NS, 'metadata');
  let schemaVersions = [], datacentreSymbols = [], resources = [], packedResources = [];
  if (observation.status === 'active' && observation.metadataPrefix === 'oai_datacite') {
    const wrapper = requiredOne(childrenNamed(requiredOne(metadata, 'OAI metadata'), original.names, OAI_DATACITE_NS, 'oai_datacite'), 'OAI DataCite wrapper');
    schemaVersions = childrenNamed(wrapper, original.names, OAI_DATACITE_NS, 'schemaVersion');
    datacentreSymbols = childrenNamed(wrapper, original.names, OAI_DATACITE_NS, 'datacentreSymbol');
    const payload = requiredOne(childrenNamed(wrapper, original.names, OAI_DATACITE_NS, 'payload'), 'DataCite payload');
    resources = childrenNamed(payload, original.names, DATACITE_NS, 'resource');
    requiredOne(resources, 'DataCite resource');
    packedResources = packedPath(original.node, [
      fullName(OAI_NS,'metadata'), fullName(OAI_DATACITE_NS,'oai_datacite'),
      fullName(OAI_DATACITE_NS,'payload'), fullName(DATACITE_NS,'resource')
    ]);
    requiredOne(packedResources, 'Original DataCite namespace resource');
  } else if (observation.status === 'active' && observation.metadataPrefix === 'oai_dc') {
    resources=childrenNamed(requiredOne(metadata,'OAI metadata'),original.names,OAI_DC_NS,'dc');
    requiredOne(resources,'OAI Dublin Core metadata');
    packedResources=packedPath(original.node,[fullName(OAI_NS,'metadata'),fullName(OAI_DC_NS,'dc')]);
    requiredOne(packedResources,'Original Dublin Core namespace resource');
  } else if (observation.status !== 'deleted' || metadata.length) {
    throw fail('OAI_STATE_CONFLICT', 'Use an explicit original active or deleted OAI observation');
  }
  const tagNames = {};
  for (const name of family.tags) {
    const exact = optionalTag(original.names, family.namespace, name);
    tagNames[name] = exact;
  }
  return {
    tagNames, packedResources, family,
    input: {
      observation:structuredClone(observation), record, header,
      about:childrenNamed(record,original.names,OAI_NS,'about'),
      schemaVersions, datacentreSymbols, resources,
      provenance: {
        sourceSchema:retained.config.schema,
        sourceSha256:retained.sourceHash,
        captureSha256:digest(retained.captureBytes),
        repository:retained.capture.repository,
        selection:retained.capture.selection,
        edition:retained.capture.edition,
        build:retained.capture.build,
        requestId:request.id,
        requestObservedAt:request.observedAt,
        requestVerb:request.verb,
        page:request.response,
        ordinal:observation.ordinal,
        namespaces:original.names,
        stateRule:'Only an original explicit deleted header withdraws a record; selection absence does not delete.'
      }
    }
  };
}

function exactNode(mapped, original, location) {
  if (!object(mapped) || !isDeepStrictEqual(mapped.original, original))
    throw fail('MAPPED_ORIGINAL_CHANGED', 'The mapping must retain its exact original native node', {location});
  for (const [nativeKey, mappedKey] of [['@attributes','attributes'],['@content','content'],['@mixed','mixed']]) {
    if (own(original, nativeKey)) {
      if (!own(mapped, mappedKey) || !isDeepStrictEqual(mapped[mappedKey], original[nativeKey]))
        throw fail('MAPPED_VALUE_CHANGED', 'A mapped XML value changed', {location, mappedKey});
    } else if (own(mapped, mappedKey) && mapped[mappedKey] !== null) {
      throw fail('MAPPED_ABSENCE_CHANGED', 'An absent XML value was replaced', {location, mappedKey});
    }
  }
}
function resourceNodes(resource, tagNames, path) {
  let nodes = [resource];
  for (const name of path.split('/')) {
    if (own(tagNames,name) && tagNames[name] === null) return [];
    const tag = tagNames[name] ?? name;
    nodes = nodes.flatMap(node => nativeChildren(node, tag));
  }
  return nodes;
}
function verifySubfields(mapped, original, packed, layout, tagNames, location) {
  for (const [field, declaration] of Object.entries(layout)) {
    const native = resourceNodes(original,tagNames,declaration.path.join('/'));
    const expanded = packedPath(packed,declaration.path.map(name=>fullName(DATACITE_NS,name)));
    if (native.length !== expanded.length)
      throw fail('DATACITE_NAMESPACE_CONTEXT','A familiar tag belongs to another namespace',{location,field});
    const values = mapped[field];
    if (!Array.isArray(values) || values.length !== native.length)
      throw fail('MAPPED_SUBPROPERTY_COUNT','A repeated DataCite subproperty changed',{location,field,expected:native.length,actual:values?.length});
    for (let index=0; index<values.length; index++) {
      const path=location+'/'+field+'/'+index;
      exactNode(values[index],native[index],path);
      if (declaration.fields) verifySubfields(values[index],native[index],expanded[index],declaration.fields,tagNames,path);
    }
  }
}

export function verifyMapped(output, input, tagNames, packedResources, family) {
  if (!object(output) || output.schema !== family.schema ||
      output.identifier !== input.observation.identifier || output.status !== input.observation.status ||
      output.datestamp !== input.observation.datestamp ||
      !isDeepStrictEqual(output.observation, input.observation) ||
      !isDeepStrictEqual(output.originalRecord, input.record) ||
      !isDeepStrictEqual(output.oaiHeader, input.header) ||
      !isDeepStrictEqual(output.sourceAbout, input.about) ||
      !isDeepStrictEqual(output.setSpecs, input.observation.setSpecs) ||
      !isDeepStrictEqual(output.wrapper?.schemaVersions, input.schemaVersions) ||
      !isDeepStrictEqual(output.wrapper?.datacentreSymbols, input.datacentreSymbols) ||
      !isDeepStrictEqual(output.provenance, input.provenance))
    throw fail('MAPPED_RECORD_CHANGED', 'The native mapped result lost its original record or identity');
  if (!Array.isArray(output.resources) || output.resources.length !== input.resources.length)
    throw fail('MAPPED_RESOURCE_COUNT', 'Preserve all native resources');
  const issues = [], counts = {};
  for (let index = 0; index < input.resources.length; index++) {
    const source = input.resources[index], mapped = output.resources[index];
    exactNode(mapped, source, 'resources/' + index);
    for (const field of family.fields) {
      const originals = resourceNodes(source, tagNames, field.xml);
      const expanded = packedPath(packedResources[index],field.xml.split('/').map(name=>fullName(family.namespace,name)));
      if (originals.length !== expanded.length) throw fail('DATACITE_NAMESPACE_CONTEXT','A familiar tag belongs to another namespace',{field:field.field});
      const values = mapped[field.field];
      if (!Array.isArray(values) || values.length !== originals.length)
        throw fail('MAPPED_PROPERTY_COUNT', 'A complete property group changed during mapping', {field:field.field,expected:originals.length,actual:values?.length});
      counts[field.field] = (counts[field.field] ?? 0) + values.length;
      for (let n = 0; n < values.length; n++) {
        const location='resources/' + index + '/' + field.field + '/' + n;
        exactNode(values[n], originals[n], location);
        if (family.nested[field.field]) verifySubfields(values[n],originals[n],expanded[n],family.nested[field.field],tagNames,location);
        for (const attribute of field.requiredAttributes ?? []) {
          if (typeof values[n].attributes?.[attribute] !== 'string' || !values[n].attributes[attribute].length)
            issues.push({severity:'warning',code:'SOURCE_REQUIRED_ATTRIBUTE',field:field.field,index:n,attribute,
              message:'The original '+family.name+' property lacks its required attribute.'});
        }
      }
      if (values.length < field.minimum || field.maximum !== null && values.length > field.maximum)
        issues.push({severity:'warning',code:'SOURCE_PROPERTY_CARDINALITY',field:field.field,count:values.length,
          minimum:field.minimum,maximum:field.maximum,message:field.rule??('Retained source cardinality differs from '+family.name+'.')});
    }
  }
  return {counts,issues};
}

export function createPageReader({oaiDirectory,python='python3',script=new URL('./page-source.py', import.meta.url)}) {
  return async ({body,request}) => {
    const args = [script instanceof URL ? script.pathname : String(script),
      '--oai-directory', resolve(oaiDirectory), '--request-id', request.id,
      '--verb', request.verb, '--max-bytes', String(Math.max(1,body.length))];
    const child = spawn(python,args,{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    const output=[], errors=[]; let total=0;
    child.stdout.on('data',chunk=>{ total+=chunk.length; if(total>256*1024*1024)child.kill();else output.push(chunk); });
    child.stderr.on('data',chunk=>{if(errors.reduce((n,x)=>n+x.length,0)<32768)errors.push(chunk);});
    const completion = new Promise((res,rej)=>{ child.on('error',rej); child.on('close',code=>code===0?res():rej(fail('ORIGINAL_PAGE_READER',Buffer.concat(errors).toString('utf8'),{exit:code}))); });
    child.stdin.on('error',()=>{}); child.stdin.end(body);
    await completion;
    return JSON.parse(utf8(Buffer.concat(output)));
  };
}

async function saveBody(directory, name, body, compressed=false) {
  const stored = compressed ? gzipSync(body,{level:6,mtime:0}) : body;
  await atomic(join(directory,name),stored);
  return {file:name,bytes:body.length,sha256:digest(body),storedBytes:stored.length,storedSha256:digest(stored),encoding:compressed?'gzip':'identity'};
}
async function loadBody(directory, descriptor) {
  if(!object(descriptor)||typeof descriptor.file!=='string'||
     descriptor.file.startsWith('/')||descriptor.file.includes('\\')||
     descriptor.file.split('/').some(part=>!part||part==='.'||part==='..')||
     !['gzip','identity'].includes(descriptor.encoding)||
     !SHA.test(descriptor.sha256??'')||!SHA.test(descriptor.storedSha256??'')||
     !Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||descriptor.bytes>256*1024*1024||
     !Number.isSafeInteger(descriptor.storedBytes)||descriptor.storedBytes<0||descriptor.storedBytes>256*1024*1024)
    throw fail('RETAINED_MEMBER_DESCRIPTOR','Use the original result member descriptor');
  const path=join(directory,descriptor.file),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.mode&0o077||stat.size!==descriptor.storedBytes)
    throw fail('RETAINED_RESULT_CHANGED',descriptor.file);
  const stored = await readFile(path);
  if (stored.length!==descriptor.storedBytes || digest(stored)!==descriptor.storedSha256)
    throw fail('RETAINED_RESULT_CHANGED',descriptor.file);
  const body = descriptor.encoding==='gzip' ? gunzipSync(stored,{maxOutputLength:256*1024*1024}) : stored;
  if(body.length!==descriptor.bytes || digest(body)!==descriptor.sha256)throw fail('RETAINED_RESULT_CHANGED',descriptor.file);
  return body;
}

// transform(spec,input,{config}) must return {body:Buffer, runtime:<exact engine
// identity>}. The body is the ACTUAL Proteus result, not a substitute evaluator.
export async function transformCapture({sourceFile,oaiSourceModule,pageReader,transform,
  directory,operationId,receiving={},onProgress=()=>{}}) {
  if(!safeId(operationId)||typeof transform!=='function'||typeof pageReader!=='function')
    throw fail('TRANSFORM_OPTIONS','Supply an operation ID and the original/native readers');
  const sourceModuleUrl=pathToFileURL(resolve(oaiSourceModule));
  const {readOaiSourceFile}=await import(sourceModuleUrl);
  const storageModuleUrl=new URL('../postgres/publisher/files.mjs',sourceModuleUrl);
  const {acquireWorkspace,privateDirectory}=await import(storageModuleUrl);
  directory=resolve(directory);await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory);
  try {
  const retained=await readOaiSourceFile(sourceFile,{loadDataset:false});
  const family=familyFor(retained.capture.selection.metadataPrefix);
  const observations=jsonl(await checkedMember(retained,retained.capture.recordsFile),'records.jsonl');
  const requests=jsonl(await checkedMember(retained,retained.capture.requestsFile),'requests.jsonl');
  const requestMap=new Map();for(const request of requests){
    if(requestMap.has(request.id))throw fail('DUPLICATE_REQUEST','The original capture repeats a request ID');
    requestMap.set(request.id,request);
  }
  const identities=new Set(),ids=new Set(),groups=new Map();let active=0,deleted=0;
  for(const observation of observations){
    if(!object(observation)||!SHA.test(observation.sourceId??'')||!SHA.test(observation.semanticHash??'')||
       !Number.isSafeInteger(observation.ordinal)||observation.ordinal<1||
       observation.repositoryId!==retained.capture.repository.id||
       observation.metadataPrefix!==retained.capture.selection.metadataPrefix||
       typeof observation.identifier!=='string'||!observation.identifier.length||
       !['active','deleted'].includes(observation.status))
      throw fail('ORIGINAL_OBSERVATION_SHAPE','Invalid current source observation');
    const identity=JSON.stringify([observation.repositoryId,observation.identifier]);
    if(identities.has(identity)||ids.has(observation.id))throw fail('DUPLICATE_CURRENT_IDENTITY',observation.identifier);
    identities.add(identity);ids.add(observation.id);
    observation.status==='active'?active++:deleted++;
    const request=requestMap.get(observation.requestId);
    if(!request||request.state!=='PARSED'||!['ListRecords','GetRecord'].includes(request.verb)||
       request.response?.sha256!==observation.sourceId||
       request.response?.xmlSourceId!==observation.sourceId)
      throw fail('ORIGINAL_REQUEST_BINDING','Current observation is not bound to its original parsed page',{identifier:observation.identifier});
    if(!groups.has(request.id))groups.set(request.id,{request,observations:[]});
    groups.get(request.id).observations.push(observation);
  }
  if(active!==retained.capture.edition.activeRecords||deleted!==retained.capture.edition.deletedRecords)
    throw fail('ORIGINAL_EDITION_COUNT','Current source state counts differ from the reviewed edition');
  if(deleted&&retained.capture.repository.identify.deletedRecord==='no')
    throw fail('ORIGINAL_DELETION_POLICY','An explicit deletion conflicts with the original repository declaration');
  const configuration=bytes(CONFIG),xmlSpecification=bytes(XML_SPEC);
  if (!object(transform.runtime)) throw fail('NATIVE_RUNTIME_REQUIRED','The native adapter must provide its exact runtime identity before a run or resume');
  const binding={sourceSha256:retained.sourceHash,captureSha256:digest(retained.captureBytes),
    storageSourceSha256:digest(await readFile(storageModuleUrl)),
    profileSourceSha256:digest(await readFile(new URL('./profile.mjs',import.meta.url))),
    dcProfileSourceSha256:digest(await readFile(new URL('./dc-profile.mjs',import.meta.url))),
    controllerSourceSha256:digest(await readFile(new URL('./capture.mjs',import.meta.url))),
    reportSourceSha256:digest(await readFile(new URL('./report.mjs',import.meta.url))),
    pageReaderSourceSha256:digest(await readFile(new URL('./page-source.py',import.meta.url))),
    runtime:transform.runtime,
    configurationSha256:digest(configuration),xmlSpecificationSha256:digest(xmlSpecification),
    observationSha256:digest(await checkedMember(retained,retained.capture.recordsFile))};
  let state;
  try {state=JSON.parse(utf8(await readFile(join(directory,'operation.json'))));}
  catch(error){if(error.code!=='ENOENT')throw error;state={schema:'tjl.ciim.transform-operation.v1',operationId,binding,status:'running',pages:{},profiles:{},receiving};}
  if(state.schema!=='tjl.ciim.transform-operation.v1'||state.operationId!==operationId||
     !object(state.pages)||!object(state.profiles)||!isDeepStrictEqual(state.binding,binding)||
     !isDeepStrictEqual(state.receiving,receiving))
    throw fail('OPERATION_BINDING_CHANGED','Resume the same source, profile configuration and receiving target');
  if(Object.keys(state.pages).some(id=>!groups.has(id)))
    throw fail('RETAINED_PAGE_SET_CHANGED','A checkpoint names a page outside the current reviewed edition');
  for(const [identity,descriptor] of Object.entries(state.profiles)){
    if(!SHA.test(identity)||descriptor.file!=='profiles/'+identity+'.json')
      throw fail('RETAINED_PROFILE_BINDING','Use the original generated profile member');
    const profile=await loadBody(directory,descriptor);
    if(digest(profile)!==identity)throw fail('RETAINED_PROFILE_CHANGED',identity);
    JSON.parse(utf8(profile));
  }
  state.status='running';delete state.result;
  await atomic(join(directory,'operation.json'),bytes(state));
  await atomic(join(directory,'config.json'),configuration);
  await atomic(join(directory,'xml-to-json.spec.json'),xmlSpecification);
  const completeRecords=[],issues=[],propertyCounts={},runtimeIdentities=new Map();
  for(const {request,observations:current} of groups.values()){
    let pageState=state.pages[request.id];
    if(pageState){
      if(pageState.requestId!==request.id||pageState.requestSha256!==digest(bytes(request))||
         !isDeepStrictEqual(pageState.page,request.response)||!isDeepStrictEqual(pageState.runtime,binding.runtime)||
         pageState.conversion?.file!=='native-pages/'+request.response.sha256+'.json.gz'||
         pageState.mapped?.file!=='mapped-pages/'+request.id+'.jsonl.gz'||
         !Array.isArray(pageState.profiles)||new Set(pageState.profiles).size!==pageState.profiles.length||
         pageState.profiles.some(id=>!own(state.profiles,id))||
         !Array.isArray(pageState.issues)||!object(pageState.propertyCounts))
        throw fail('RETAINED_PAGE_BINDING','The original page, profile or runtime checkpoint changed',{requestId:request.id});
      JSON.parse(utf8(await loadBody(directory,pageState.conversion)));
      const records=jsonl(await loadBody(directory,pageState.mapped),'retained mapped records');
      if(records.length!==current.length||!isDeepStrictEqual(records.map(r=>r.observation.id),current.map(r=>r.id)))
        throw fail('RETAINED_CURRENT_SET_CHANGED','Retained mapped page differs from its original selected observations');
      completeRecords.push(...records);
      issues.push(...pageState.issues);for(const [key,count]of Object.entries(pageState.propertyCounts))propertyCounts[key]=(propertyCounts[key]??0)+count;
      runtimeIdentities.set(JSON.stringify(pageState.runtime),pageState.runtime);
      onProgress({stage:'page-reopened',requestId:request.id,records:records.length});continue;
    }
    const raw=await checkedMember(retained,request.response.path);
    if(digest(raw)!==request.response.sha256)throw fail('ORIGINAL_PAGE_HASH','Original page differs from its response');
    const original=await pageReader({body:raw,request});
    if(original.schema!=='tjl.ciim.original-oai-page.v1'||original.page.errors?.length)
      throw fail('ORIGINAL_OAI_RESPONSE','Use an original successfully parsed OAI page');
    const conversion=await transform(XML_SPEC,{rawXml:utf8(raw)},{config:CONFIG});
    if(!Buffer.isBuffer(conversion.body)||!isDeepStrictEqual(conversion.runtime,transform.runtime))throw fail('NATIVE_TRANSFORM_RESPONSE','Retain exact result bytes and engine identity');
    const conversionFile=await saveBody(directory,'native-pages/'+request.response.sha256+'.json.gz',conversion.body,true);
    const converted=JSON.parse(utf8(conversion.body));
    const convertedRecords=nativeRecordList(converted,original);
    const mapped=[],pageIssues=[],pageCounts={},pageProfiles=new Set();
    let runtime=conversion.runtime;
    for(const observation of current){
      const parsed=original.records[observation.ordinal-1],record=convertedRecords[observation.ordinal-1];
      if(!parsed||!record)throw fail('ORIGINAL_ORDINAL','Original one-based record ordinal is missing');
      const prepared=prepareInput({observation,original:parsed,record,retained,request});
      const spec=family.build(prepared.tagNames),specBytes=bytes(spec),specSha=digest(specBytes);
      pageProfiles.add(specSha);
      if(!state.profiles[specSha]){
        state.profiles[specSha]=await saveBody(directory,'profiles/'+specSha+'.json',specBytes);
      }
      const transformed=await transform(spec,prepared.input,{config:CONFIG});
      if(!Buffer.isBuffer(transformed.body)||!isDeepStrictEqual(transformed.runtime,runtime))
        throw fail('NATIVE_RUNTIME_CHANGED','The converter and property mapping must use the same native runtime');
      let result,checked;
      try {
        result=JSON.parse(utf8(transformed.body));
        checked=verifyMapped(result,prepared.input,prepared.tagNames,prepared.packedResources,prepared.family);
      } catch(error) {
        error.nativeBody=transformed.body;
        error.details={...(error.details??{}),nativeRecord:{
          identifier:observation.identifier,observationId:observation.id,
          requestId:request.id,pageSha256:observation.sourceId,specSha256:specSha
        }};
        throw error;
      }
      mapped.push(result);
      for(const issue of checked.issues)pageIssues.push({...issue,identifier:observation.identifier,observationId:observation.id,pageSha256:observation.sourceId});
      for(const [key,count]of Object.entries(checked.counts))pageCounts[key]=(pageCounts[key]??0)+count;
      onProgress({stage:'record-mapped',identifier:observation.identifier,records:completeRecords.length+mapped.length,total:observations.length});
    }
    const mappedBody=Buffer.concat(mapped.map(bytes));
    const mappedFile=await saveBody(directory,'mapped-pages/'+request.id+'.jsonl.gz',mappedBody,true);
    pageState={requestId:request.id,requestSha256:digest(bytes(request)),page:request.response,
      conversion:conversionFile,mapped:mappedFile,profiles:[...pageProfiles],
      runtime,propertyCounts:pageCounts,issues:pageIssues};
    state.pages[request.id]=pageState;
    await atomic(join(directory,'operation.json'),bytes(state));
    completeRecords.push(...mapped);issues.push(...pageIssues);
    for(const [key,count]of Object.entries(pageCounts))propertyCounts[key]=(propertyCounts[key]??0)+count;
    runtimeIdentities.set(JSON.stringify(runtime),runtime);
  }
  const byId=new Map(completeRecords.map(record=>[record.observation.id,record]));
  const ordered=observations.map(observation=>byId.get(observation.id));
  if(ordered.some(value=>!value)||byId.size!==observations.length)throw fail('FULL_RESULT_COVERAGE','The complete original edition must be present');
  const full=await saveBody(directory,'records.jsonl.gz',Buffer.concat(ordered.map(bytes)),true);
  const finalSource=await readOaiSourceFile(sourceFile,{loadDataset:false});
  if(finalSource.sourceHash!==retained.sourceHash||!finalSource.captureBytes.equals(retained.captureBytes))
    throw fail('SOURCE_CHANGED_DURING_TRANSFORM','The source changed during native mapping');
  const manifest={
    schema:'tjl.ciim.metadata-delivery.v1',profileFamily:family.name,operationId,status:'complete',binding,
    source:{schema:retained.config.schema,repository:retained.capture.repository,
      selection:retained.capture.selection,edition:retained.capture.edition,build:retained.capture.build,
      file:retained.sourceFile,inventory:retained.files},
    profiles:Object.values(state.profiles),configuration:{file:'config.json',sha256:binding.configurationSha256},
    xmlSpecification:{file:'xml-to-json.spec.json',sha256:binding.xmlSpecificationSha256},
    receiving,records:full,counts:{records:ordered.length,active,deleted,properties:propertyCounts},
    runtime:[...runtimeIdentities.values()],issues,
    pages:Object.values(state.pages).map(({issues,propertyCounts,...page})=>page)
  };
  const reportBody=Buffer.from(renderReport({manifest,records:ordered}),'utf8');
  manifest.report=await saveBody(directory,'review.html',reportBody);
  await atomic(join(directory,'manifest.json'),bytes(manifest));
  state.status='complete';state.result={file:'manifest.json',sha256:digest(bytes(manifest))};
  await atomic(join(directory,'operation.json'),bytes(state));
  onProgress({stage:'complete',records:ordered.length,active,deleted});
  await rm(join(directory,'failure.json'),{force:true});
  return {manifest,records:ordered,directory};
  } catch(error) {
    const failure={schema:'tjl.ciim.receiving-failure.v1',operationId,
      code:error.code??'RECEIVING_ERROR',message:error.message,details:error.details??{}};
    if(error.nativeBody)failure.nativeBody=await saveBody(directory,'native-error-body.bin.gz',Buffer.from(error.nativeBody),true);
    try { await atomic(join(directory,'failure.json'),bytes(failure)); }
    catch(preservationError) {
      error.details={...(error.details??{}),failurePreservation:{code:preservationError.code,message:preservationError.message}};
    }
    throw error;
  } finally { await release(); }
}
