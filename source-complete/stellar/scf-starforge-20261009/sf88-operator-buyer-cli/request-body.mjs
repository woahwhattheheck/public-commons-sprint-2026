// MIT. Retained local request bytes; no signer, network call or provider mutation.
import { constants } from 'node:fs';
import { open, lstat, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_REQUEST_BODY_BYTES } from '../sf31-buyer-client/request-body.mjs';
import { encodeMultipart, decodeMultipart } from '../sf30-seller-sdk/multipart.mjs';
export { MAX_REQUEST_BODY_BYTES };
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=value=>createHash('sha256').update(value).digest('hex');
export function requestBodyPin(raw) { return {bodyBytes:raw.length,bodySha256:sha(raw)}; }
export function validateRequestBodyPin(operation) {
  if (!own(operation,'bodyBytes')&&!own(operation,'bodySha256')) return;
  if (typeof operation.bodyFile!=='string'||!Number.isSafeInteger(operation.bodyBytes)||operation.bodyBytes<0||operation.bodyBytes>MAX_REQUEST_BODY_BYTES||
      typeof operation.bodySha256!=='string'||!/^[0-9a-f]{64}$/.test(operation.bodySha256)) fail('REQUEST_BODY_PIN_INVALID');
}
/** One opened descriptor prevents a path swap from changing the retained bytes. */
export async function readRequestFile(path,limit=MAX_REQUEST_BODY_BYTES,{privateFile=false}={}) {
  if (typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path) fail('REQUEST_FILE_ABSOLUTE_PATH_REQUIRED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await file.stat();
    if (!before.isFile()||before.size>limit||privateFile&&((before.mode&0o077)!==0||typeof process.getuid==='function'&&before.uid!==process.getuid())) fail('REQUEST_FILE_INVALID');
    const bytes=Buffer.alloc(before.size+1);let size=0;
    while(size<bytes.length) {const read=await file.read(bytes,size,bytes.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}
    const after=await file.stat();
    if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs) fail('REQUEST_FILE_CHANGED_DURING_READ');
    return bytes.subarray(0,size);
  } finally {await file.close();}
}
export async function readRequestBody(operation) {
  validateRequestBodyPin(operation);
  if (operation.bodyFile===undefined) return undefined;
  const raw=await readRequestFile(operation.bodyFile);
  if (own(operation,'bodySha256')&&(raw.length!==operation.bodyBytes||sha(raw)!==operation.bodySha256)) fail('REQUEST_BODY_CHANGED_SINCE_PREPARATION');
  return raw;
}
/** Create-only private bytes, durably published before a review can refer to them. */
export async function writeRequestFile(path,bytes) {
  if (typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||!(bytes instanceof Uint8Array)||bytes.length>MAX_REQUEST_BODY_BYTES) fail('REQUEST_OUTPUT_INVALID');
  const parent=dirname(path), info=await lstat(parent);
  if (!info.isDirectory()||(info.mode&0o077)!==0||await realpath(parent)!==parent) fail('REQUEST_OUTPUT_PRIVATE_DIRECTORY_REQUIRED');
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(bytes);await file.sync();}
  catch(error) {await file.close().catch(()=>{});await unlink(path).catch(()=>{});throw error;}
  await file.close();
  const directory=await open(parent,constants.O_RDONLY|constants.O_DIRECTORY);
  try {await directory.sync();} finally {await directory.close();}
}
/** Form selection is trusted local input. Only copied bytes enter the body file. */
export async function prepareMultipartFile(selection,destination) {
  if (!plain(selection)||Object.keys(selection).some(key=>!['fields','files'].includes(key))||!Array.isArray(selection.files??[])) fail('MULTIPART_SELECTION_INVALID');
  const files=[];let total=0;
  for (const file of selection.files??[]) {
    if (!plain(file)||Object.keys(file).some(key=>!['field','path','filename','contentType'].includes(key))) fail('MULTIPART_FILE_SELECTION_INVALID');
    const bytes=await readRequestFile(file.path);
    total+=bytes.length;if(total>MAX_REQUEST_BODY_BYTES)fail('REQUEST_BODY_TOO_LARGE');
    files.push({field:file.field,filename:file.filename??basename(file.path),contentType:file.contentType??'application/octet-stream',bytes});
  }
  const encoded=encodeMultipart({fields:selection.fields??{},files});
  const reviewed=await decodeMultipart(encoded.raw,encoded.contentType);
  await writeRequestFile(destination,encoded.raw);
  return {bodyFile:destination,...requestBodyPin(encoded.raw),headers:{'Content-Type':encoded.contentType},review:reviewed.multipart};
}
export async function requestBodyReview(operation,raw,offer) {
  if (raw===undefined) return null;
  const contentType=Object.entries(operation.headers??{}).find(([key])=>key.toLowerCase()==='content-type')?.[1];
  if (!/^multipart\/form-data\s*;/i.test(contentType??'')) return null;
  const schema=offer?.extensions?.bazaar?.schema?.properties?.input?.properties?.body;
  const parsed=await decodeMultipart(raw,contentType,schema);
  return parsed.multipart;
}
