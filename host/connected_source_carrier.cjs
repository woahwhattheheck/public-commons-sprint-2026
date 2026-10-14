'use strict';
/** Complete original UTF-8 source carriers. Pure bytes in/out; no I/O or source execution. */
const codec = require('./connected_zip.cjs');
const gzip = require('./connected_gzip.cjs');
const hashes = require('./connected_sha256.cjs');
const SCHEMA = 'commons.complete-source-gzip/v1';
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const DEFAULT_CARRIER_BYTES = 2 * 1024 * 1024;
const need = (condition, message) => { if (!condition) throw TypeError(message); };
function capacity(value, fallback, maximum, label) {
  value ??= fallback;
  need(Number.isSafeInteger(value) && value > 0 && value <= maximum,
    'Choose a positive ' + label + ' up to ' + maximum + ' bytes');
  return value;
}
function identity(value, label) {
  need(value && Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
    typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256),
    'Retain complete ' + label + ' bytes and SHA-256');
  return {bytes:value.bytes, sha256:value.sha256};
}
function filename(value) {
  need(typeof value === 'string' && value.length && value.length <= 1024 &&
    !/[\x00-\x1f\x7f/\\]/.test(value) && value !== '.' && value !== '..',
    'Use the original ordinary source filename');
  codec.utf8(value);
  return value;
}
function assertIdentity(data, expected, label) {
  const selected = identity(expected, label);
  need(data.length === selected.bytes, label + ' byte length differs');
  const actual = hashes.sha256Bytes(data);
  need(actual.sha256 === selected.sha256, label + ' SHA-256 differs');
  return actual;
}
// Validate without constructing a second multi-megabyte source string. Keep BOMs,
// original newlines, JSON whitespace, numeric spelling and final newline exactly.
function validateUtf8(data) {
  need(data instanceof Uint8Array, 'Receive original UTF-8 source bytes');
  for (let i=0; i<data.length;) {
    const a=data[i++];
    if (a<0x80) continue;
    let rest, low=0x80, high=0xbf;
    if(a>=0xc2&&a<=0xdf) rest=1;
    else if(a>=0xe0&&a<=0xef) {rest=2;if(a===0xe0)low=0xa0;if(a===0xed)high=0x9f;}
    else if(a>=0xf0&&a<=0xf4) {rest=3;if(a===0xf0)low=0x90;if(a===0xf4)high=0x8f;}
    else throw TypeError('Original source is not complete UTF-8');
    need(i+rest<=data.length, 'Original source has truncated UTF-8');
    need(data[i]>=low&&data[i]<=high, 'Original source has invalid UTF-8');
    i++;
    for(let n=1;n<rest;n++,i++) need(data[i]>=0x80&&data[i]<=0xbf,'Original source has invalid UTF-8');
  }
  return data;
}
function limits(options={}) {
  return {
    source:capacity(options.maxSourceBytes,MAX_SOURCE_BYTES,MAX_SOURCE_BYTES,'source capacity'),
    carrier:capacity(options.maxCarrierBytes,DEFAULT_CARRIER_BYTES,MAX_SOURCE_BYTES,'carrier capacity')
  };
}
function gzipOriginal(data) {
  const compressed=gzip.deflateRawBytes(data,{huffman:'auto'}).data;
  const result=new Uint8Array(compressed.length+18);
  result.set([31,139,8,0,0,0,0,0,0,255]);
  result.set(compressed,10);
  const tail=new DataView(result.buffer,result.byteOffset,result.byteLength);
  tail.setUint32(result.length-8,codec.crc32(data),true);
  tail.setUint32(result.length-4,data.length>>>0,true);
  return result;
}
function packSourceCarrier(data, options={}) {
  const selected=limits(options), name=filename(options.filename);
  need(data instanceof Uint8Array && data.length<=selected.source,'Original source exceeds selected capacity');
  validateUtf8(data);
  const source=hashes.sha256Bytes(data), compressed=gzipOriginal(data);
  const zipped=hashes.sha256Bytes(compressed);
  const envelope={schema:SCHEMA,filename:name,sourceBytes:source.bytes,sourceSha256:source.sha256,
    gzipBytes:zipped.bytes,gzipSha256:zipped.sha256,base64:codec.base64(compressed)};
  const output=codec.utf8(JSON.stringify(envelope)+'\n');
  need(output.length<=selected.carrier,
    'Complete carrier needs '+output.length+' bytes; selected carrier capacity is '+selected.carrier+
    '. Retain the whole source and choose an appropriate existing transport or explicit capacity.');
  const carrier=hashes.sha256Bytes(output);
  return {schema:SCHEMA,data:output,source:{filename:name,...source},carrier,gzip:zipped,
    selection:{carrier,source:{filename:name,...source}}};
}
function receiveSourceCarrier(data, selection, options={}) {
  const selected=limits(options);
  need(data instanceof Uint8Array && data.length<=selected.carrier,'Complete carrier exceeds selected capacity');
  need(selection && typeof selection==='object','Select retained carrier and original source identities');
  const carrier=assertIdentity(data,selection.carrier,'Carrier');
  const original=identity(selection.source,'original source');
  const name=filename(selection.source.filename);
  need(original.bytes<=selected.source,'Original source exceeds selected capacity');
  const envelope=JSON.parse(codec.utf8Text(data));
  need(envelope && envelope.schema===SCHEMA,'Unsupported complete source carrier schema');
  need(envelope.filename===name && envelope.sourceBytes===original.bytes &&
    envelope.sourceSha256===original.sha256,'Carrier names a different original source');
  const zipped=identity({bytes:envelope.gzipBytes,sha256:envelope.gzipSha256},'gzip');
  need(zipped.bytes<=selected.carrier && typeof envelope.base64==='string' &&
    envelope.base64.length===Math.ceil(zipped.bytes/3)*4,'Incomplete or oversized carrier base64');
  const compressed=codec.fromBase64(envelope.base64);
  assertIdentity(compressed,zipped,'Gzip');
  const restored=gzip.gunzipBytes(compressed,{
    expected_bytes:original.bytes,max_output_bytes:selected.source,max_input_bytes:selected.carrier
  });
  assertIdentity(restored.data,original,'Original source');
  validateUtf8(restored.data);
  return {schema:SCHEMA,source:{filename:name,...original},carrier,gzip:zipped,
    members:restored.members,data:restored.data};
}
module.exports={SCHEMA,MAX_SOURCE_BYTES,DEFAULT_CARRIER_BYTES,validateUtf8,
  packSourceCarrier,receiveSourceCarrier};
