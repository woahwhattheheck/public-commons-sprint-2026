// MIT. Funding-request recovery inside the original Grant MCP owner's private files.
import {constants} from 'node:fs';
import {open,mkdir,link,unlink,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const SCHEMA='stellar-forge.sf47-funding-agent-request.v1', MAX=12*1024*1024;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>JSON.stringify((function order(x){return Array.isArray(x)?x.map(order):plain(x)
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;})(v));
const same=(a,b)=>canonical(a)===canonical(b);
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(v,code,message)=>{if(!v)throw Object.assign(new Error(message),{code});};
const encoded=v=>Buffer.from(canonical(v)+'\n');
async function read(path){
  let f;try{f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{
    const before=await f.stat({bigint:true});
    need(before.isFile()&&before.size>0n&&before.size<=BigInt(MAX),'GRANT_FUNDING_FILE_INVALID','Keep a complete regular original funding file.');
    const raw=await f.readFile(),after=await f.stat({bigint:true});
    need(['dev','ino','size','mtimeNs'].every(k=>before[k]===after[k])&&BigInt(raw.length)===before.size,
      'GRANT_FUNDING_FILE_CHANGED','The original funding request or response changed while reading.');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    need(raw.equals(encoded(value)),'GRANT_FUNDING_FILE_CHANGED','Keep the exact original funding request or response bytes.');
    return value;
  }finally{await f.close();}
}
async function retain(path,value){
  const raw=encoded(value);need(raw.length<=MAX,'GRANT_FUNDING_FILE_LIMIT','The complete funding request exceeds its private receiving bound.');
  const old=await read(path);
  if(old!==null){need(same(old,value),'GRANT_FUNDING_FILE_CHANGED','This original funding file already holds another request or result.');return;}
  const temporary=path+'.'+randomUUID()+'.part';let f;
  try{
    f=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    await f.writeFile(raw);await f.sync();await f.close();f=null;
    try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;
      need(same(await read(path),value),'GRANT_FUNDING_FILE_CHANGED','A competing original file has another complete value.');}
    const directory=await open(resolve(path,'..'),constants.O_RDONLY);
    try{await directory.sync();}finally{await directory.close();}
  }finally{if(f)await f.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function originalResponse(value,prepared){
  need(plain(value)&&value.schema===SCHEMA+'.returned'&&same(value.prepared,prepared)&&plain(value.response),
    'GRANT_FUNDING_RESPONSE_CHANGED','The accepted funding response belongs to another prepared request.');
  const r=value.response,raw=Buffer.from(r.contentBase64,'base64');
  need(raw.toString('base64')===r.contentBase64&&sha(raw)===r.sha256&&r.bytes===raw.length
    &&r.status>=200&&r.status<300&&/^application\/json\b/i.test(r.mediaType)
    &&same(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),r.value),
    'GRANT_FUNDING_RESPONSE_CHANGED','The complete accepted native response no longer matches its original bytes.');
  need(r.value?.id===prepared.caseId&&r.value.action==='funding.save'&&r.value.kind==='source'
    &&r.value.version===prepared.body.expectedVersion+1
    &&r.value.funding?.revision===prepared.body.inputs.expectedRevision+1,
    'GRANT_FUNDING_RESPONSE_CHANGED','The funding result does not join the original input and successor edition.');
  return {...r,bytes:raw};
}
export async function retainGrantFundingSave({directory,client,caseId,body}){
  const {acceptedResult,...original}=body;
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(original.requestId)&&/^operation-[a-f0-9]{32}$/.test(caseId),
    'GRANT_FUNDING_REQUEST_INVALID','Keep the original case and request identifiers.');
  const base=resolve(directory),root=join(base,'cost-funding-requests');
  await mkdir(root,{recursive:true,mode:0o700});
  const st=await lstat(root);
  need(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&(await realpath(root))===root,
    'GRANT_FUNDING_DIRECTORY_CHANGED','Keep the original private funding recovery directory.');
  const id=sha(Buffer.from(caseId+'\0'+original.requestId));
  const requestPath=join(root,id+'.request.json'),returnedPath=join(root,id+'.returned.json');
  const before=await read(requestPath),returned=await read(returnedPath);
  const native=(await client.read('funding-request',{caseId,requestId:original.requestId})).value;
  need(native?.caseId===caseId&&native.requestId===original.requestId&&typeof native.caseCreatedAt==='string'
    &&typeof native.found==='boolean','GRANT_FUNDING_REQUEST_CHANGED','The original funding journal identity changed.');
  const prepared={schema:SCHEMA,caseId,caseCreatedAt:native.caseCreatedAt,body:original,
    fingerprint:sha(Buffer.from(canonical({domain:'stellar-forge.sf47-operations.v1',programId:caseId,
      body:{expectedVersion:original.expectedVersion,requestId:original.requestId,actor:original.actor,note:original.note,
        action:'funding.save',data:{inputs:original.inputs,expectedPreviewSha256:original.expectedPreviewSha256}}})))};
  if(before!==null)need(same(before,prepared),'GRANT_FUNDING_REQUEST_CHANGED',
    'Keep the original operator, case, revision, full funding input and preview when recovering this request.');
  let retained;
  if(returned!==null){
    need(before!==null,'GRANT_FUNDING_REQUEST_MISSING','The accepted response is missing its original prepared request.');
    retained=originalResponse(returned,prepared);
  }
  if(native.found){
    need(native.fingerprint===prepared.fingerprint&&native.resultSha256===sha(Buffer.from(canonical(native.result))),
      'GRANT_FUNDING_REQUEST_CHANGED','The original committed request differs from its complete prepared inputs.');
    if(retained)need(same(retained.value,native.result),'GRANT_FUNDING_RESPONSE_CHANGED','The original commitment differs from the retained accepted response.');
    if(acceptedResult!==undefined)need(same(acceptedResult,native.result),'GRANT_FUNDING_RESPONSE_CHANGED','The supplied accepted response differs from the original commitment.');
  }else need(!retained&&acceptedResult===undefined,'GRANT_FUNDING_COMMITMENT_MISSING',
    'This restored workspace lacks the accepted original funding save. Restore matching state; this request will not be resubmitted.');
  if(retained)return retained;
  await retain(requestPath,prepared);
  const response=await client.fundingSave(caseId,body);
  const record={schema:SCHEMA+'.returned',prepared,response:{value:response.value,contentBase64:response.bytes.toString('base64'),
    bytes:response.bytes.length,sha256:response.sha256,status:response.status,mediaType:response.mediaType,source:response.source,
    ...(response.filename?{filename:response.filename}:{})}};
  // Preserve the complete returned body before validating its business identity.
  await retain(returnedPath,record);originalResponse(record,prepared);
  const committed=(await client.read('funding-request',{caseId,requestId:original.requestId})).value;
  need(committed?.found&&committed.caseCreatedAt===prepared.caseCreatedAt&&committed.fingerprint===prepared.fingerprint
    &&same(committed.result,response.value),'GRANT_FUNDING_COMMITMENT_MISSING',
    'The accepted response is retained; its original commitment must be recovered before continuing.');
  return response;
}
