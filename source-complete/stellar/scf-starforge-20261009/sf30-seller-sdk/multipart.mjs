// MIT. Native multipart decoding and exact-byte preparation for original HTTP requests.
// Public Bazaar examples remain ordinary schema values; this private model is not
// a new payment extension. File bytes never enter a discovery response.
import { createHash, randomBytes } from 'node:crypto';
import { MAX_REQUEST_BODY_BYTES } from '../sf31-buyer-client/request-body.mjs';

export { MAX_REQUEST_BODY_BYTES };
const MAX_PARTS = 128, MAX_FIELDS = 64, MAX_FIELD_BYTES = 256 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const namePattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/;
const forbidden = new Set(['__proto__','constructor','prototype']);
const fail = (code, status=422) => { throw Object.assign(new TypeError(code), {code,status}); };
const sha = data => createHash('sha256').update(data).digest('hex');
const binary = schema => schema?.type === 'string' && schema.format === 'binary';
function name(value) {
  if (typeof value !== 'string' || !namePattern.test(value) || forbidden.has(value)) fail('MULTIPART_FIELD_NAME_INVALID');
  return value;
}
function filename(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value)>255 || /[\x00-\x1f\x7f"\\/]/.test(value)) fail('MULTIPART_FILENAME_INVALID');
  return value;
}
function media(value) {
  if (typeof value !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value) || value.length>127) fail('MULTIPART_MEDIA_TYPE_INVALID');
  return value.toLowerCase();
}
/** Validate supported serialization without reducing the retained JSON Schema. */
export function compileMultipartSchema(schema) {
  if (!plain(schema) || schema.type!=='object' || !plain(schema.properties) || Object.keys(schema.properties).length>MAX_FIELDS) fail('MULTIPART_OBJECT_SCHEMA_REQUIRED');
  for (const [key,value] of Object.entries(schema.properties)) {
    name(key);
    const item = value?.type==='array' ? value.items : value;
    if (!plain(item) || !['string','number','integer','boolean','object'].includes(item.type)) fail('MULTIPART_FIELD_TYPE_UNSUPPORTED');
    if (binary(item) && ['pattern','enum','const'].some(key=>own(item,key))) fail('MULTIPART_BINARY_TEXT_ASSERTION_UNSUPPORTED');
  }
  return schema;
}
function property(schema,key) {
  if (own(schema.properties,key)) return schema.properties[key];
  if (schema.additionalProperties===false) fail('MULTIPART_FIELD_NOT_DECLARED');
  return plain(schema.additionalProperties) ? schema.additionalProperties : {type:'string'};
}
function scalar(value,schema) {
  if (Buffer.byteLength(value)>MAX_FIELD_BYTES) fail('MULTIPART_FIELD_TOO_LARGE',413);
  if (schema.type==='string') return value;
  if (schema.type==='object') {
    let parsed; try { parsed=JSON.parse(value); } catch { fail('MULTIPART_JSON_FIELD_INVALID'); }
    if (!plain(parsed)) fail('MULTIPART_OBJECT_FIELD_REQUIRED');
    return parsed;
  }
  if (schema.type==='boolean' && ['true','false'].includes(value)) return value==='true';
  if (['number','integer'].includes(schema.type) && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const result=Number(value);
    if (Number.isFinite(result) && (schema.type!=='integer'||Number.isSafeInteger(result))) return result;
  }
  fail('MULTIPART_SCALAR_FIELD_INVALID');
}
/** Decode once with Node's maintained Fetch implementation. Preserve wire bytes. */
export async function decodeMultipart(raw,contentType,schema) {
  if (schema!==undefined) compileMultipartSchema(schema);
  if (!(raw instanceof Uint8Array) || raw.length>MAX_REQUEST_BODY_BYTES) fail('REQUEST_BODY_TOO_LARGE',413);
  if (typeof contentType!=='string' || contentType.length>256 || !/^multipart\/form-data\s*;/i.test(contentType) || /[\r\n\0]/.test(contentType)) fail('MULTIPART_CONTENT_TYPE_REQUIRED',415);
  let form; try { form=await new Response(raw,{headers:{'content-type':contentType}}).formData(); }
  catch { fail('MULTIPART_BODY_INVALID',400); }
  const body=Object.create(null), files=[], fields=Object.create(null); let count=0;
  for (const [key,value] of form) {
    name(key); if (++count>MAX_PARTS) fail('MULTIPART_TOO_MANY_PARTS',413);
    const declared=schema?property(schema,key):{type:'array',items:{type:'string',...(typeof value==='string'?{}:{format:'binary'})}}, multiple=declared.type==='array', item=multiple?declared.items:declared;
    if (!multiple&&own(body,key)) fail('MULTIPART_DUPLICATE_FIELD');
    let parsed;
    if (binary(item)) {
      if (typeof value==='string') fail('MULTIPART_FILE_REQUIRED');
      const bytes=Buffer.from(await value.arrayBuffer());
      // OAS binary strings are evaluated as reversible single-byte strings.
      // The original raw body, not this validation view, is sent upstream.
      parsed=bytes.toString('latin1');
      files.push({field:key,filename:filename(value.name),contentType:media(value.type||'application/octet-stream'),bytes:bytes.length,sha256:sha(bytes)});
    } else {
      if (typeof value!=='string' && item.type!=='object') fail('MULTIPART_UNDECLARED_FILE');
      if (typeof value!=='string' && (value.size>MAX_FIELD_BYTES || media(value.type)!=='application/json')) fail('MULTIPART_JSON_FIELD_INVALID');
      parsed=scalar(typeof value==='string'?value:await value.text(),item);
      if (multiple) (fields[key]??=[]).push(parsed); else fields[key]=parsed;
    }
    if (multiple) (body[key]??=[]).push(parsed); else body[key]=parsed;
  }
  return {body,bodyPresent:true,bodyType:'form-data',rawBody:Uint8Array.from(raw),
    multipart:{contentType,bytes:raw.length,sha256:sha(raw),files,fields}};
}

/** Serialize selected local bytes once. Persist this result for every later attempt.
 * Fields use the OAS default part media types; no filename is added to JSON fields. */
export function encodeMultipart({fields={},files=[]}={}) {
  if (!plain(fields)||!Array.isArray(files)||Object.keys(fields).length+files.length>MAX_PARTS) fail('MULTIPART_INPUT_INVALID');
  const parts=[];
  for (const [key,raw] of Object.entries(fields)) {
    name(key); const values=Array.isArray(raw)?raw:[raw];
    for (const value of values) {
      if (!['string','number','boolean'].includes(typeof value)&&!plain(value)) fail('MULTIPART_FIELD_VALUE_INVALID');
      const json=plain(value), bytes=Buffer.from(json?JSON.stringify(value):String(value));
      if (bytes.length>MAX_FIELD_BYTES) fail('MULTIPART_FIELD_TOO_LARGE',413);
      parts.push({key,bytes,contentType:json?'application/json':'text/plain; charset=utf-8'});
    }
  }
  for (const file of files) {
    if (!plain(file)||Object.keys(file).some(k=>!['field','filename','contentType','bytes'].includes(k))||!(file.bytes instanceof Uint8Array)) fail('MULTIPART_FILE_INPUT_INVALID');
    name(file.field); if (own(fields,file.field)) fail('MULTIPART_FIELD_FILE_COLLISION');
    parts.push({key:file.field,filename:filename(file.filename),contentType:media(file.contentType??'application/octet-stream'),bytes:Buffer.from(file.bytes)});
  }
  if (parts.length>MAX_PARTS||parts.reduce((n,p)=>n+p.bytes.length,0)>MAX_REQUEST_BODY_BYTES) fail('REQUEST_BODY_TOO_LARGE',413);
  let boundary; do { boundary='starforge-'+randomBytes(24).toString('hex'); }
  while(parts.some(p=>p.bytes.includes(Buffer.from(boundary))));
  const chunks=[];
  for (const part of parts) chunks.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+part.key+'"'+
    (part.filename===undefined?'':'; filename="'+part.filename+'"')+'\r\nContent-Type: '+part.contentType+'\r\n\r\n'),part.bytes,Buffer.from('\r\n'));
  chunks.push(Buffer.from('--'+boundary+'--\r\n'));
  const raw=Buffer.concat(chunks);
  if (raw.length>MAX_REQUEST_BODY_BYTES) fail('REQUEST_BODY_TOO_LARGE',413);
  return {raw,contentType:'multipart/form-data; boundary='+boundary,bytes:raw.length,sha256:sha(raw)};
}
