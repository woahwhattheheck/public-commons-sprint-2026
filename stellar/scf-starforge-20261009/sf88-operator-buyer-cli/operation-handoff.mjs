// MIT — Portable private inputs for the original merchant operation and buyer.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { InputError, need, operation } from './config.mjs';
import { prepareReview } from './prepare.mjs';
import { loadOperationTicket, operationTicketView, parseOperationTicketBytes } from './operation-ticket.mjs';
import { MAX_REQUEST_BODY_BYTES, requestBodyPin } from './request-body.mjs';

export const OPERATION_HANDOFF_SCHEMA = 'stellar-forge.operation-handoff.v1';
export const OPERATION_HANDOFF_MAX_BYTES = 4*Math.ceil(MAX_REQUEST_BODY_BYTES/3)+2*1024*1024;
const limits = {ticket:16384, body:MAX_REQUEST_BODY_BYTES, discovery:1048576};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const sha256 = raw => createHash('sha256').update(raw).digest('hex');
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const shape = (value, keys) => plain(value) && Object.keys(value).length === keys.length &&
  Object.keys(value).every(key => keys.includes(key));
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
const path = value => {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0'),
    'OPERATION_HANDOFF_CANONICAL_PATH_REQUIRED');
  return value;
};

async function privateBytes(filename, limit) {
  path(filename);
  let file;
  try {
    need(process.platform !== 'win32' && await realpath(filename) === filename,
      'OPERATION_HANDOFF_PRIVATE_POSIX_FILE_REQUIRED');
    file = await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
    const info = await file.stat();
    need(info.isFile() && (info.mode&0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid()),
      'OPERATION_HANDOFF_PRIVATE_FILE_REQUIRED');
    need(info.size <= limit,'OPERATION_HANDOFF_FILE_TOO_LARGE');
    const raw = Buffer.alloc(limit+1); let size=0;
    while (size<raw.length) {
      const {bytesRead}=await file.read(raw,size,raw.length-size,size);
      if (!bytesRead) break;
      size+=bytesRead;
    }
    need(size<=limit,'OPERATION_HANDOFF_FILE_TOO_LARGE');
    return raw.subarray(0,size);
  } catch(error) {
    if (error instanceof InputError) throw error;
    throw new InputError('OPERATION_HANDOFF_FILE_UNREADABLE');
  } finally { await file?.close(); }
}

async function syncDirectory(directory) {
  const file=await open(directory,constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}
async function writePrivate(filename, raw) {
  const file=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
function decode(raw) {
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)); }
  catch { throw new InputError('OPERATION_HANDOFF_JSON_INVALID'); }
}
function packed(raw, limit) {
  need(raw instanceof Uint8Array && raw.byteLength<=limit,'OPERATION_HANDOFF_FILE_TOO_LARGE');
  raw=Buffer.from(raw);
  return {sha256:sha256(raw),base64:raw.toString('base64')};
}
function unpacked(value, limit) {
  need(shape(value,['sha256','base64']) && /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.base64==='string' && value.base64.length<=4*Math.ceil(limit/3),
    'OPERATION_HANDOFF_FILE_INVALID');
  const raw=Buffer.from(value.base64,'base64');
  need(raw.length<=limit && raw.toString('base64')===value.base64 && sha256(raw)===value.sha256,
    'OPERATION_HANDOFF_FILE_CHANGED');
  return raw;
}

function unpackHandoff(value) {
  need(shape(value,['schema','intentId','url','headers','ticketHeader','rowIndex','files']) &&
    value.schema===OPERATION_HANDOFF_SCHEMA && shape(value.files,Object.keys(limits)),
    'OPERATION_HANDOFF_SCHEMA_INVALID');
  // null represents an absent body; a packed zero-byte file remains present.
  return Object.fromEntries(Object.entries(limits).map(([name,limit])=>[name,name==='body'&&value.files.body===null?null:unpacked(value.files[name],limit)]));
}
function prepareHandoff(value, directory, acceptIndex, {files=unpackHandoff(value),requireCurrent=true}={}) {
  const paths={ticket:join(directory,'operation-ticket.json'),body:join(directory,'request.body'),
    discovery:join(directory,'offers.json'),headers:join(directory,'request.headers.json'),config:join(directory,'review.json')};
  const prepared=prepareReview(files.discovery,{rowIndex:value.rowIndex,acceptIndex,
    intentId:value.intentId,url:value.url,method:'POST',...(files.body===null?{}:{bodyFile:paths.body,...requestBodyPin(files.body)}),headers:value.headers,
    ticketFile:paths.ticket,ticketHeader:value.ticketHeader});
  const ticket=parseOperationTicketBytes(files.ticket,prepared.draft.operation,{requireCurrent});
  return {...prepared,files,paths,ticket};
}

/** Copies original bytes only. No merchant paths, signer, policy or executable
 * settings enter this document. The receiving buyer chooses a payment option. */
export function createOperationHandoff({draft,discoveryBytes,ticketBytes,bodyBytes}) {
  const op=operation(draft?.operation), source=draft.preparedFrom;
  need(op.method==='POST' && op.ticketFile && source &&
    source.discoveryFileSha256===sha256(discoveryBytes),'OPERATION_HANDOFF_PREPARED_REQUEST_REQUIRED');
  const present=op.bodyFile!==undefined;
  need(present?bodyBytes instanceof Uint8Array:bodyBytes==null,'OPERATION_HANDOFF_BODY_PRESENCE_MISMATCH');
  if (op.bodySha256!==undefined) need(bodyBytes.length===op.bodyBytes&&sha256(bodyBytes)===op.bodySha256,'OPERATION_HANDOFF_BODY_CHANGED');
  const value={schema:OPERATION_HANDOFF_SCHEMA,intentId:op.intentId,url:op.url,
    headers:op.headers,ticketHeader:op.ticketHeader,rowIndex:source.rowIndex,
    files:{ticket:packed(ticketBytes,limits.ticket),body:present?packed(bodyBytes,limits.body):null,
      discovery:packed(discoveryBytes,limits.discovery)}};
  const prepared=prepareHandoff(value,dirname(path(op.ticketFile)),source.acceptIndex);
  need(canonical(prepared.draft.operation.expect)===canonical(op.expect),'OPERATION_HANDOFF_OFFER_CHANGED');
  need(json(value).length<=OPERATION_HANDOFF_MAX_BYTES,'OPERATION_HANDOFF_FILE_TOO_LARGE');
  return value;
}

function view(prepared, filename, raw) {
  const op=prepared.draft.operation;
  return {handoffPath:filename,handoffSha256:sha256(raw),handoffBytes:raw.length,
    intentId:op.intentId,sellerUrl:op.url,method:op.method,acceptedTerms:op.expect,
    requestHeaderNames:Object.keys(op.headers),bodyPresent:prepared.files.body!==null,bodyBytes:prepared.files.body?.length??0,
    bodySha256:sha256(prepared.files.body??new Uint8Array()),operationTicket:operationTicketView(prepared.ticket),
    sourceFileSha256:sha256(prepared.files.discovery)};
}

/** Read-only native selection for receiving operator interfaces. The bearer and
 * raw body never enter the returned view; every option uses prepareReview. */
export async function inspectOperationHandoff({file,directory,acceptIndex,requireCurrent=true}) {
  path(directory);
  need(typeof requireCurrent==='boolean','OPERATION_HANDOFF_REVIEW_MODE_INVALID');
  const raw=await privateBytes(file,OPERATION_HANDOFF_MAX_BYTES),value=decode(raw),files=unpackHandoff(value);
  const choices=[]; let first,firstError,selected;
  for (let index=0;index<32;index++) {
    try {
      const prepared=prepareHandoff(value,directory,index,{files,requireCurrent});
      first??=prepared;
      if(index===acceptIndex) selected=prepared;
      choices.push({acceptIndex:index,acceptedTerms:prepared.draft.operation.expect});
    } catch(error) {
      if(error.code==='DISCOVERY_ACCEPT_NOT_FOUND') break;
      firstError??=error;
      choices.push({acceptIndex:index,error:error instanceof InputError?error.code:'OPERATION_HANDOFF_REVIEW_FAILED'});
    }
  }
  if(!first) throw firstError??new InputError('DISCOVERY_ACCEPT_NOT_FOUND');
  if(acceptIndex!==undefined) {
    need(Number.isSafeInteger(acceptIndex)&&acceptIndex>=0,'EXPLICIT_SELECTION_INDEX_REQUIRED');
    selected??=prepareHandoff(value,directory,acceptIndex,{files,requireCurrent});
  }
  const prepared=selected??first;
  return {...view(prepared,file,raw),acceptedTerms:selected?.draft.operation.expect??null,
    acceptIndex:acceptIndex??null,choices,requestHeaders:prepared.draft.operation.headers,
    configSha256:selected?.configSha256??null};
}

/** Exact body attachment for the receiving operator; no ticket is returned. */
export async function readOperationHandoffBody({file}) {
  const raw=await privateBytes(file,OPERATION_HANDOFF_MAX_BYTES);
  return unpackHandoff(decode(raw)).body;
}

/** Create-only receiver. The original review config is written last, after all
 * private inputs are durable; an interrupted import never exposes a ready config. */
export async function importOperationHandoff({file,directory,acceptIndex}) {
  path(directory);
  const raw=await privateBytes(file,OPERATION_HANDOFF_MAX_BYTES), value=decode(raw);
  const prepared=prepareHandoff(value,directory,acceptIndex);
  const parent=dirname(directory);
  need(await realpath(parent)===parent && (await stat(parent)).isDirectory(),
    'OPERATION_HANDOFF_PARENT_REQUIRED');
  try { await mkdir(directory,{mode:0o700}); }
  catch(error) { throw new InputError(error.code==='EEXIST'?'OPERATION_HANDOFF_DESTINATION_EXISTS':'OPERATION_HANDOFF_DESTINATION_UNAVAILABLE'); }
  try {
    for (const name of Object.keys(limits)) if (prepared.files[name]!==null) await writePrivate(prepared.paths[name],prepared.files[name]);
    await writePrivate(prepared.paths.headers,json(prepared.draft.operation.headers));
    await loadOperationTicket(prepared.draft.operation,{requireCurrent:true});
    await syncDirectory(directory);
    await writePrivate(prepared.paths.config,prepared.data);
    await syncDirectory(directory); await syncDirectory(parent);
  } catch(error) {
    await rm(directory,{recursive:true,force:true});
    await syncDirectory(parent);
    throw error instanceof InputError ? error : new InputError('OPERATION_HANDOFF_IMPORT_FAILED');
  }
  return {mode:'OFFLINE_OPERATION_IMPORTED',...view(prepared,file,raw),
    directory,configPath:prepared.paths.config,configSha256:prepared.configSha256,
    sourceStatus:'SAVED_UNVERIFIED_DISCOVERY',
    next:'Review this config; use the original workspace or inbox and attach your own operator settings'};
}

/** Supports the original offline issuer as well as the merchant workspace. */
export async function exportOperationHandoff({configFile,discoveryFile,out}) {
  const draft=decode(await privateBytes(configFile,65536)), op=operation(draft.operation);
  const ticket=await loadOperationTicket(op,{requireCurrent:true});
  need(ticket,'OPERATION_HANDOFF_PREPARED_REQUEST_REQUIRED');
  const value=createOperationHandoff({draft,ticketBytes:ticket.sourceBytes,
    bodyBytes:op.bodyFile===undefined?undefined:await privateBytes(op.bodyFile,limits.body),
    discoveryBytes:await privateBytes(discoveryFile,limits.discovery)});
  const raw=json(value), destination=path(out), parent=dirname(destination), info=await stat(parent);
  need(await realpath(parent)===parent && info.isDirectory() && (info.mode&0o077)===0 &&
    (typeof process.getuid!=='function' || info.uid===process.getuid()),'OPERATION_HANDOFF_PRIVATE_PARENT_REQUIRED');
  try { await writePrivate(destination,raw); await syncDirectory(parent); }
  catch(error) { throw new InputError(error.code==='EEXIST'?'OPERATION_HANDOFF_DESTINATION_EXISTS':'OPERATION_HANDOFF_EXPORT_FAILED'); }
  return {mode:'OFFLINE_OPERATION_EXPORTED',...view(prepareHandoff(value,parent,draft.preparedFrom.acceptIndex),destination,raw),
    next:'Transfer this private file to the intended buyer, then import with an explicit payment option'};
}

export function handoffArguments(args, direction) {
  const keys=direction==='import'?['--file','--dir','--accept']:['--config','--discovery','--out'];
  need(args.length===keys.length*2,'OPERATION_HANDOFF_FLAGS_REQUIRED');
  const flags=new Map();
  for (let i=0;i<args.length;i+=2) {
    need(keys.includes(args[i]) && !flags.has(args[i]) && typeof args[i+1]==='string' && args[i+1].length,
      'OPERATION_HANDOFF_FLAGS_REQUIRED');
    flags.set(args[i],args[i+1]);
  }
  if (direction==='export') return {configFile:flags.get('--config'),discoveryFile:flags.get('--discovery'),out:flags.get('--out')};
  const accept=flags.get('--accept');
  need(/^(0|[1-9][0-9]*)$/.test(accept) && Number.isSafeInteger(Number(accept)),'EXPLICIT_SELECTION_INDEX_REQUIRED');
  return {file:flags.get('--file'),directory:flags.get('--dir'),acceptIndex:Number(accept)};
}
