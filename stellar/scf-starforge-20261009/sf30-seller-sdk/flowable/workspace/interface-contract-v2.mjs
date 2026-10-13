#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MAPPING_SCHEMA = 'commons.process-interface-mapping.v1';
const SOURCE_SCHEMA = 'commons.process-interface-source.v1';
const EVIDENCE_SCHEMA = 'commons.process-interface-variable-evidence.v1';
const TYPES = new Set(['string', 'boolean', 'integer', 'long', 'double']);
const LIMIT = 1024 * 1024;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const fail = message => { throw new Error(message); };
const object = (v, label) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(label + ' must be an object');
  return v;
};
const text = (v, label, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f]/.test(v))
    fail(label + ' must be nonempty bounded text');
  return v;
};
const key = (v, label) => {
  text(v, label, 100);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(v)) fail(label + ' must be a portable field name');
  return v;
};
// JSON.parse validates grammar; this second walk rejects repeated object keys before mapping.
function rejectDuplicateKeys(source) {
  let at=0;
  const ws=()=>{while(/\s/.test(source[at]||'') && at<source.length) at++;};
  const string=()=>{
    const start=at++;
    while(at<source.length) {
      const c=source[at++];
      if(c==='\\') {at++;continue;}
      if(c==='"') return JSON.parse(source.slice(start,at));
    }
    fail('Unterminated JSON string');
  };
  const walk=()=>{
    ws();const c=source[at];
    if(c==='{'){
      at++;ws();const keys=new Set();if(source[at]==='}'){at++;return;}
      while(at<source.length){
        ws();const k=string();if(keys.has(k))fail('Repeated JSON member '+k);keys.add(k);
        ws();at++;walk();ws();if(source[at++]==='}')return;
      }
    }else if(c==='['){
      at++;ws();if(source[at]===']'){at++;return;}
      while(at<source.length){walk();ws();if(source[at++]===']')return;}
    }else if(c==='"'){string();}
    else {while(at<source.length&&!/[\s,\]}]/.test(source[at]))at++;}
  };
  walk();
}

const json = (s, label) => {
  if (typeof s !== 'string' || Buffer.byteLength(s, 'utf8') > LIMIT)
    fail(label + ' exceeds the 1 MiB source limit');
  try { const parsed=object(JSON.parse(s), label); rejectDuplicateKeys(s); return parsed; }
  catch (error) { fail(label + ': ' + error.message); }
};
const exactKeys = (o, permitted, label) => {
  for (const k of Object.keys(o)) if (!permitted.includes(k)) fail(label + ' has unknown field ' + k);
};
const longText = (v, label) => {
  if (typeof v !== 'string' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(v))
    fail(label + ' must be canonical signed-64 decimal text');
  const n = BigInt(v);
  if (n < -9223372036854775808n || n > 9223372036854775807n)
    fail(label + ' is outside signed-64 range');
  return v;
};
const doubleText = (v, label) => {
  if (typeof v !== 'string' || !/^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/.test(v) ||
      v.replace(/[-.]/g,'').replace(/^0+/,'').length > 15 || !Number.isFinite(Number(v)))
    fail(label + ' must be decimal text with at most nine integer places, six fractional places and fifteen digits');
  return v;
};
// Native losslessJson retains exact coefficient * 10^exponent values.
function expandNativeDecimal(raw, label) {
  object(raw, label);
  exactKeys(raw, ['number','exponent'], label);
  if (typeof raw.number !== 'string' || !/^(?:0|-?[1-9][0-9]{0,63})$/.test(raw.number) ||
      typeof raw.exponent !== 'string' || !/^(?:0|-?[1-9][0-9]?)$/.test(raw.exponent))
    fail(label + ' requires a bounded integer coefficient and decimal exponent');
  const exponent = Number(raw.exponent);
  if (exponent < -64 || exponent > 64) fail(label + ' exponent is outside the supported range');
  if (raw.number === '0') return '0';
  const negative = raw.number.startsWith('-'), digits = negative ? raw.number.slice(1) : raw.number;
  const point = digits.length + exponent;
  let result;
  if (point <= 0) result = '0.' + '0'.repeat(-point) + digits;
  else if (point >= digits.length) result = digits + '0'.repeat(point-digits.length);
  else result = digits.slice(0,point) + '.' + digits.slice(point);
  if (result.includes('.')) result = result.replace(/0+$/, '').replace(/\.$/, '');
  if (result.length > 128) fail(label + ' expanded decimal exceeds 128 characters');
  return (negative ? '-' : '') + result;
}
function nativeNumericValue(raw, type, label) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    raw = expandNativeDecimal(raw, label);
    if (type === 'integer') {
      if (!/^(?:0|-?[1-9][0-9]*)$/.test(raw)) fail(label + ' is not an integral native value');
      const n = BigInt(raw);
      if (n < -2147483648n || n > 2147483647n) fail(label + ' is outside signed-32 range');
      return Number(n);
    }
  }
  if (type === 'double' && typeof raw === 'number' && Number.isFinite(raw)) raw = String(raw);
  return raw;
}

const value = (v, type, label) => {
  if (type === 'string') return text(v, label, 4000);
  if (type === 'double') return doubleText(v, label);
  if (type === 'boolean') {
    if (typeof v !== 'boolean') fail(label + ' must be boolean');
    return v;
  }
  if (type === 'integer') {
    if (!Number.isSafeInteger(v) || v < -2147483648 || v > 2147483647)
      fail(label + ' must be a signed-32 integer');
    return v;
  }
  return longText(v, label);
};

export function inspectMapping(mappingText) {
  const m = json(mappingText, 'mapping');
  exactKeys(m, ['schema','id','sourceSystem','sourceVersion','fields'], 'mapping');
  if (m.schema !== MAPPING_SCHEMA) fail('Unsupported mapping schema');
  key(m.id, 'mapping.id'); text(m.sourceSystem, 'mapping.sourceSystem');
  text(m.sourceVersion, 'mapping.sourceVersion');
  if (!Array.isArray(m.fields) || !m.fields.length || m.fields.length > 12)
    fail('mapping.fields requires one to twelve fields');
  const external = new Set(), native = new Set();
  for (const f of m.fields) {
    object(f, 'mapping field');
    exactKeys(f, ['external','native','type','required','meaning'], 'mapping field');
    key(f.external, 'external field'); key(f.native, 'native variable');
    if (external.has(f.external) || native.has(f.native)) fail('Duplicate mapped field or native variable');
    external.add(f.external); native.add(f.native);
    if (!TYPES.has(f.type)) fail('Unsupported mapped type ' + f.type);
    if (typeof f.required !== 'boolean') fail('Field required must be boolean');
    text(f.meaning, 'field meaning', 1000);
  }
  return { schema: MAPPING_SCHEMA, mapping: m, bytes: Buffer.byteLength(mappingText, 'utf8'), sha256: sha(mappingText) };
}

function variablesText(rows) {
  return '[' + rows.map(v => '{"name":' + JSON.stringify(v.name) +
    ',"type":' + JSON.stringify(v.type) + ',"value":' +
    (v.type === 'long' ? longText(v.value, v.name) : v.type === 'double' ? doubleText(v.value,v.name) : JSON.stringify(v.value)) + '}').join(',') + ']';
}


// Additive case/event consumers share the original exact typed mapping contract.
export const parseInterfaceJSON = json;
export const typedVariablesText = variablesText;
export function prepareMappedVariables({mappingText,values}) {
  const selected=inspectMapping(mappingText),m=selected.mapping,source={values};
  object(source.values, 'source.values');
  const allowed = new Set(m.fields.map(x => x.external));
  for (const k of Object.keys(source.values)) if (!allowed.has(k)) fail('Unmapped input field ' + k);
  const variables = [];
  for (const f of m.fields) {
    if (!own(source.values, f.external)) {
      if (f.required) fail('Missing required source field ' + f.external);
      continue;
    }
    variables.push({name:f.native,type:f.type,value:value(source.values[f.external],f.type,f.external)});
  }
  return {variables,bodyText:variablesText(variables),mapping:selected};
}

export function prepareProcessInput({mappingText, sourceText, processDefinitionId, businessKey}) {
  const selected = inspectMapping(mappingText), m = selected.mapping;
  const source = json(sourceText, 'source');
  exactKeys(source, ['schema','sourceSystem','sourceVersion','correlationId','values'], 'source');
  if (source.schema !== SOURCE_SCHEMA || source.sourceSystem !== m.sourceSystem || source.sourceVersion !== m.sourceVersion)
    fail('Source schema/system/version does not match the selected mapping');
  text(source.correlationId, 'source.correlationId');
  text(processDefinitionId, 'processDefinitionId'); text(businessKey, 'businessKey', 250);
  const {variables}=prepareMappedVariables({mappingText,values:source.values});
  const bodyText = '{"processDefinitionId":' + JSON.stringify(processDefinitionId) +
    ',"businessKey":' + JSON.stringify(businessKey) + ',"variables":' + variablesText(variables) + '}';
  return {
    schema:'commons.process-interface-prepared.v1',
    mapping:{id:m.id,bytes:selected.bytes,sha256:selected.sha256},
    source:{schema:source.schema,sourceSystem:source.sourceSystem,sourceVersion:source.sourceVersion,
      correlationId:source.correlationId,bytes:Buffer.byteLength(sourceText,'utf8'),sha256:sha(sourceText)},
    selected:{processDefinitionId,businessKey},
    nativeRequest:{method:'POST',resource:'runtime/process-instances',bodyText,sha256:sha(bodyText)},
    fieldEvidence:variables.map(v=>({name:v.name,type:v.type,value:v.value})),
    state:'PREPARED_FOR_ORIGINAL_NATIVE_REVIEW'
  };
}

export function exportProcessValues({mappingText, evidenceText, processInstanceId}) {
  const selected = inspectMapping(mappingText), m = selected.mapping;
  const evidence = json(evidenceText, 'native evidence');
  exactKeys(evidence, ['schema','processInstanceId','sourceReference','variables'], 'native evidence');
  if (evidence.schema !== EVIDENCE_SCHEMA) fail('Unsupported variable evidence schema');
  text(processInstanceId, 'processInstanceId');
  if (evidence.processInstanceId !== processInstanceId) fail('Native evidence belongs to another process instance');
  object(evidence.sourceReference, 'sourceReference');
  exactKeys(evidence.sourceReference, ['path','bytes','sha256','kind'], 'sourceReference');
  text(evidence.sourceReference.path, 'sourceReference.path', 2000);
  text(evidence.sourceReference.kind, 'sourceReference.kind');
  if (!Number.isSafeInteger(evidence.sourceReference.bytes) || evidence.sourceReference.bytes < 1 ||
      !/^[0-9a-f]{64}$/.test(evidence.sourceReference.sha256)) fail('Invalid original source reference');
  if (!Array.isArray(evidence.variables) || evidence.variables.length > 1000) fail('Expected bounded native variable evidence');
  const names = new Map();
  for (const v of evidence.variables) {
    object(v, 'native variable'); key(v.name, 'native variable name');
    if (names.has(v.name)) fail('Duplicate native variable evidence ' + v.name);
    names.set(v.name, v);
  }
  const values = Object.create(null), selectedVariables = [];
  for (const f of m.fields) {
    if (!names.has(f.native)) {
      if (f.required) fail('Required native variable missing: ' + f.native);
      continue;
    }
    const v = names.get(f.native);
    if (v.type !== f.type) fail('Native variable type changed for ' + f.native);
    let raw = v.value;
    if (f.type === 'long' || f.type === 'integer' || f.type === 'double')
      raw = nativeNumericValue(raw, f.type, f.native);
    values[f.external] = value(raw, f.type, f.native);
    selectedVariables.push({name:f.native,type:f.type,value:values[f.external]});
  }
  return {schema:'commons.process-interface-export.v1',state:'MAPPED_OPERATOR_SELECTED_VARIABLE_EVIDENCE',processInstanceId,
    mapping:{id:m.id,bytes:selected.bytes,sha256:selected.sha256},
    originalSource:{...evidence.sourceReference},
    evidence:{bytes:Buffer.byteLength(evidenceText,'utf8'),sha256:sha(evidenceText)},
    sourceSystem:m.sourceSystem,sourceVersion:m.sourceVersion,values,selectedVariables};
}

function read(file) {
  const data=fs.readFileSync(path.resolve(file));
  if (data.length > LIMIT) fail('Source exceeds 1 MiB: '+file);
  const result=data.toString('utf8');
  if (!Buffer.from(result,'utf8').equals(data)) fail('Invalid UTF-8: '+file);
  return result;
}

function publish(filename, body) {
  const destination=path.resolve(filename), dir=path.dirname(destination);
  fs.mkdirSync(dir,{recursive:true});
  const bytes=Buffer.from(JSON.stringify(body,null,2)+'\n','utf8');
  if (fs.existsSync(destination)) {
    if (!fs.readFileSync(destination).equals(bytes)) fail('Different existing output; select a new reviewed edition');
    return {path:destination,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),replayed:true};
  }
  const pending=path.join(dir,'.interface-'+randomUUID()+'.pending');
  try {
    const fd=fs.openSync(pending,'wx',0o600);
    try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    try {fs.linkSync(pending,destination);}
    catch(error){if(error.code!=='EEXIST'||!fs.readFileSync(destination).equals(bytes))throw error;}
    const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  } finally {if(fs.existsSync(pending))fs.unlinkSync(pending);}
  return {path:destination,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),replayed:false};
}

export function main(argv=process.argv.slice(2)) {
  const mode=argv.shift(), opts=Object.create(null);
  while(argv.length){const k=argv.shift();if(!k?.startsWith('--')||!argv.length||own(opts,k))fail('Expected unique --name value');opts[k]=argv.shift();}
  const required = mode==='import' ? ['--mapping','--source','--definition-id','--business-key','--out'] :
    mode==='export' ? ['--mapping','--evidence','--process-instance-id','--out'] : fail('Choose import or export');
  exactKeys(opts,required,'arguments');
  for(const k of required)if(!opts[k])fail('Missing '+k);
  const result=mode==='import' ? prepareProcessInput({mappingText:read(opts['--mapping']),sourceText:read(opts['--source']),
    processDefinitionId:opts['--definition-id'],businessKey:opts['--business-key']}) :
    exportProcessValues({mappingText:read(opts['--mapping']),evidenceText:read(opts['--evidence']),processInstanceId:opts['--process-instance-id']});
  process.stdout.write(JSON.stringify({state:'SAVED',...publish(opts['--out'],result)})+'\n');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){process.stderr.write(JSON.stringify({state:'INPUT_REVIEW_REQUIRED',error:error.message})+'\n');process.exitCode=2;}
}
