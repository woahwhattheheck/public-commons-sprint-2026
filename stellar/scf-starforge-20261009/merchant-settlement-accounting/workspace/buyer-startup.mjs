// MIT. Buyer-issued source initialization for the original accountant workspace.
import {constants} from 'node:fs';
import {open,mkdir,lstat,link,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {basename,isAbsolute,join,resolve} from 'node:path';
import {inspectBuyerSource,buyerHash,buyerCanonical} from '../accountant/buyer-source.mjs';

export const BUYER_STARTUP_SCHEMA='stellar-forge.buyer-accounting-startup.v1';
export const BUYER_STARTUP_LIMIT=64*1024*1024;
const SHA=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const label=(value,name,max=160)=>{need(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value),'INVALID_BUYER_STARTUP','Name the '+name+'.');return value.trim();};
const absolute=value=>{need(typeof value==='string'&&isAbsolute(value)&&value===resolve(value)&&value!=='/','BUYER_STARTUP_PATH','Choose an absolute normalized original buyer file.');return value;};

export function accountingSourceMode(state){
  const mode=state.sourceMode??'merchant';
  need(mode==='merchant'||mode==='buyer','ACCOUNTING_SOURCE_MODE','This workspace has an unsupported original source mode.');
  return mode;
}

/** Buyer mode is explicit and cannot also claim unconfigured merchant inputs. */
export function buyerStartupDescriptor(directory,state){
  need(accountingSourceMode(state)==='buyer'&&object(state.sources)&&object(state.buyerStartup),
    'BUYER_STARTUP_REQUIRED','Open a buyer-issued accountant workspace.');
  const value=state.buyerStartup;
  need(value.schema===BUYER_STARTUP_SCHEMA&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.handoffId??'')&&SHA.test(value.sha256??'')&&
    Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=BUYER_STARTUP_LIMIT&&
    object(value.source)&&value.source.kind==='buyer-expense-period'&&
    value.source.reportSha256===value.sha256&&value.source.reportBytes===value.bytes&&
    object(value.source.buyer)&&object(value.summary),
    'BUYER_STARTUP_CHANGED','Retain the original issued buyer source identity.',409);
  label(value.name,'retained source');label(value.actor,'source operator',1000);
  need(typeof value.retainedAt==='string'&&Number.isFinite(Date.parse(value.retainedAt)),
    'BUYER_STARTUP_CHANGED','Retain the original source intake time.',409);
  const path=join(absolute(directory),'inputs',value.sha256+'.buyer-source.json');
  need(state.sources.buyerSourceFile===path&&Object.keys(state.sources).length===1,
    'BUYER_STARTUP_CHANGED','The original buyer source must remain inside this workspace without merchant source substitutions.',409);
  return {...structuredClone(value),path};
}

async function readOriginal(path,{expectedSha256,expectedBytes}={}){
  absolute(path);
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await file.stat();
    need(before.isFile()&&before.size>0&&before.size<=BUYER_STARTUP_LIMIT&&
      !(before.mode&0o077)&&(!process.getuid||before.uid===process.getuid()),
      'BUYER_STARTUP_FILE','Choose the original owner-private issued source file, up to 64 MiB.');
    const bytes=await file.readFile(),after=await file.stat();
    need(bytes.length===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,
      'BUYER_STARTUP_CHANGED','The original source changed while it was retained. Read its current exact edition.',409);
    const sha256=buyerHash(bytes);
    need(expectedSha256===undefined||SHA.test(expectedSha256)&&sha256===expectedSha256,
      'BUYER_STARTUP_CHANGED','The original buyer file differs from the selected SHA256.',409);
    need(expectedBytes===undefined||bytes.length===expectedBytes,
      'BUYER_STARTUP_CHANGED','The original buyer file differs from the retained byte count.',409);
    return {bytes,sha256};
  }finally{await file.close();}
}

const summarize=value=>({allocationRows:value.rows.length,
  expenseRows:value.rows.filter(row=>row.kind==='EXPENSE').length,
  creditRows:value.rows.filter(row=>row.kind==='CREDIT').length,
  outstandingReservations:value.source.buyer.outstandingReservations.length});

/** Read and validate one original private issued file without creating a workspace. */
export async function inspectBuyerStartupFile(path,options={}){
  const original=await readOriginal(path,options);
  const inspected=inspectBuyerSource(original.bytes);
  return {...original,inspected,summary:summarize(inspected)};
}

/** Called only while the original Store owns its existing writer lease. */
export async function initializeBuyerStartup(directory,{buyerSourceFile,buyerSourceSha256,buyerSourceName,buyerOperator}){
  const actor=label(buyerOperator,'source operator',1000);
  const original=await readOriginal(buyerSourceFile,{expectedSha256:buyerSourceSha256});
  const inspected=inspectBuyerSource(original.bytes);
  const name=label(buyerSourceName??basename(buyerSourceFile),'retained source');
  const inputs=join(directory,'inputs');await mkdir(inputs,{recursive:true,mode:0o700});
  const st=await lstat(inputs);
  need(st.isDirectory()&&!st.isSymbolicLink()&&!(st.mode&0o077),'BUYER_STARTUP_DIRECTORY','Use the original private input directory.');
  const path=join(inputs,original.sha256+'.buyer-source.json');
  const pending=join(inputs,'.'+original.sha256+'.'+randomUUID()+'.pending');
  const file=await open(pending,'wx',0o600);
  try{
    try{await file.writeFile(original.bytes);await file.sync();}finally{await file.close();}
    try{await link(pending,path);}
    catch(error){if(error.code!=='EEXIST')throw error;await readOriginal(path,{expectedSha256:original.sha256,expectedBytes:original.bytes.length});}
    const folder=await open(inputs,'r');try{await folder.sync();}finally{await folder.close();}
  }finally{await rm(pending,{force:true});}
  return {sourceMode:'buyer',sources:{buyerSourceFile:path},
    buyerStartup:{schema:BUYER_STARTUP_SCHEMA,handoffId:randomUUID(),name,actor,retainedAt:new Date().toISOString(),
      sha256:original.sha256,bytes:original.bytes.length,source:inspected.source,summary:summarize(inspected)}};
}

/** Recovery uses this same validation on authenticated staged original bytes. */
export function validateBuyerStartupBytes(directory,state,bytes){
  const descriptor=buyerStartupDescriptor(directory,state);
  need(Buffer.isBuffer(bytes)&&bytes.length===descriptor.bytes&&buyerHash(bytes)===descriptor.sha256,
    'BUYER_STARTUP_CHANGED','Retain the complete original issued buyer source.',409);
  const inspected=inspectBuyerSource(bytes);
  need(buyerCanonical(inspected.source)===buyerCanonical(descriptor.source)&&
    buyerCanonical(summarize(inspected))===buyerCanonical(descriptor.summary),
    'BUYER_STARTUP_CHANGED','The retained source description differs from its original issued bytes.',409);
  return {descriptor,bytes,inspected};
}

/** Reopening consumes the retained original; it never depends on the former import path. */
export async function readBuyerStartup(directory,state,{buyerSourceFile,buyerSourceSha256}={}){
  const descriptor=buyerStartupDescriptor(directory,state);
  const original=await readOriginal(descriptor.path,{expectedSha256:descriptor.sha256,expectedBytes:descriptor.bytes});
  const checked=validateBuyerStartupBytes(directory,state,original.bytes);
  if(buyerSourceFile!==undefined)await readOriginal(buyerSourceFile,{expectedSha256:descriptor.sha256,expectedBytes:descriptor.bytes});
  need(buyerSourceSha256===undefined||buyerSourceSha256===descriptor.sha256,
    'BUYER_STARTUP_CHANGED','Reopen this workspace with its retained buyer source identity.',409);
  return checked;
}

export function buyerStartupView(directory,state){
  if(accountingSourceMode(state)!=='buyer')return null;
  const descriptor=buyerStartupDescriptor(directory,state);
  const handoffs=(state.accountantHandoffs??[]).filter(row=>row.source?.kind==='buyer-expense-period'&&row.source.reportSha256===descriptor.sha256)
    .map(row=>({id:row.id,name:row.name,actor:row.actor,createdAt:row.createdAt,
      rowCount:row.rowCount,returnedRevisions:row.revisions.length}));
  return {...descriptor,handoffs};
}
