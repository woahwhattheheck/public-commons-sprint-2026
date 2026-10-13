/** Native file/HTTP carrier for the original supplier workbook workflow. */
import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalJSON,serializeWorkspace,reopenWorkspace,ReportError} from './supplier-report.mjs';
import {
  WORKBOOK_SCHEMA, RETURN_SCHEMA, PREVIEW_SCHEMA, DELIVERY_SCHEMA,
  createReviewWorkbookModel,reviewWorkbookReturn,applyWorkbookReturn,
  recoverWorkbookReturn,createWorkbookDelivery,receiveWorkbookDelivery
} from './review-workbook.mjs';

const IO='conapi.supplier-review-workbook-io.v1';
const REVIEW_PACKET='conapi.supplier-review-workbook-selection.v1';
const LIMIT=96*1024*1024, OUTPUT_LIMIT=256*1024*1024;
const XLSX_LIMIT=64*1024*1024;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=text=>Buffer.from(text,'utf8');
const fail=(code,message,details={})=>{throw new ReportError(code,message,details);};
const check=(condition,code,message,details)=>{if(!condition)fail(code,message,details);};
function json(buffer,label) {
  check(buffer.length<=OUTPUT_LIMIT,'WORKBOOK_SIZE',label+' exceeds the supported file size.');
  let text;
  try {text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}
  catch {fail('WORKBOOK_JSON_INVALID',label+' must be complete UTF-8.');}
  try {return JSON.parse(text);}
  catch {fail('WORKBOOK_JSON_INVALID',label+' must be complete JSON.');}
}
function pythonPath(supplied) {
  const value=supplied || process.env.CONAPI_WORKBOOK_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  check(typeof value==='string' && value && !value.includes('\0'),'WORKBOOK_RUNTIME_INVALID','Select the installed Analysis Python executable.');
  return value;
}
function fromBase64(value) {
  check(typeof value==='string' && value.length<=Math.ceil(XLSX_LIMIT/3)*4 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
    'WORKBOOK_FILE_INVALID','The complete XLSX must use canonical base64 within 64 MiB.');
  const result=Buffer.from(value,'base64');
  check(result.length>0 && result.length<=XLSX_LIMIT && result.toString('base64')===value,
    'WORKBOOK_FILE_INVALID','The complete XLSX must use canonical base64 within 64 MiB.');
  return result;
}
function conversion(request,{python,onChild}={}) {
  const body=bytes(canonicalJSON({schema:IO,...request}));
  check(body.length<=LIMIT,'WORKBOOK_SIZE','Workbook conversion input exceeds 96 MiB.');
  const script=fileURLToPath(new URL('./review_workbook.py',import.meta.url));
  return new Promise((resolve,reject)=>{
    const child=spawn(pythonPath(python),[script],{
      stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1'}
    });
    onChild?.(child);
    const chunks=[],errors=[];let count=0,errorCount=0,failed;
    const stop=error=>{if(!failed)failed=error;child.kill('SIGTERM');};
    child.stdout.on('data',chunk=>{
      count+=chunk.length;
      if(count>OUTPUT_LIMIT)stop(new ReportError('WORKBOOK_SIZE','The complete converter output exceeds 256 MiB.'));
      else chunks.push(chunk);
    });
    child.stderr.on('data',chunk=>{errorCount+=chunk.length;if(errorCount<=65536)errors.push(chunk);});
    child.once('error',error=>{
      failed=new ReportError(error.code==='ENOENT'?'WORKBOOK_RUNTIME_MISSING':'WORKBOOK_IO_FAILED',
        error.code==='ENOENT'?'The configured Analysis Python executable is unavailable. Set CONAPI_WORKBOOK_PYTHON to its existing executable.':error.message);
    });
    child.stdin.once('error',error=>{if(!failed)failed=new ReportError('WORKBOOK_IO_FAILED',error.message);});
    child.once('close',code=>{
      if(failed){reject(failed);return;}
      if(code!==0){
        let error;
        try{error=JSON.parse(Buffer.concat(errors).toString('utf8').trim());}catch{}
        reject(new ReportError(error?.error || 'WORKBOOK_IO_FAILED',error?.message || 'Workbook conversion ended before returning a complete result.'));return;
      }
      try {resolve(json(Buffer.concat(chunks),'Workbook conversion result'));}
      catch(error){reject(error);}
    });
    child.stdin.end(body);
  });
}
export async function exportReviewWorkbook(workspace,{python}={}) {
  const model=createReviewWorkbookModel(workspace);
  const result=await conversion({action:'write',model},{python});
  check(result?.schema===IO && result.action==='write' && result.file,
    'WORKBOOK_IO_INVALID','The converter returned another operation.');
  const content=fromBase64(result.file.contentBase64);
  check(content.length===result.file.bytes && sha(content)===result.file.sha256,
    'WORKBOOK_FILE_CHANGED','The created workbook does not match its complete converter receipt.');
  return {schema:IO,action:'write',workbookId:model.workbookId,basisSha256:model.basisSha256,
    workspaceSha256:model.workspaceSha256,comparisonId:model.comparisonId,revision:model.revision,
    file:result.file};
}
export async function readReviewWorkbook(content,{python}={}) {
  check(Buffer.isBuffer(content) && content.length>0 && content.length<=XLSX_LIMIT,
    'WORKBOOK_SIZE','Choose a nonempty returned XLSX within 64 MiB.');
  const result=await conversion({action:'read',contentBase64:content.toString('base64'),sha256:sha(content)},{python});
  check(result?.schema===RETURN_SCHEMA && result.file?.bytes===content.length && result.file.sha256===sha(content),
    'WORKBOOK_FILE_CHANGED','The parsed return does not match its complete original XLSX.');
  return result;
}
function response(res,status,value) {
  const body=bytes(canonicalJSON(value)+'\n');
  res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Content-Length':body.length,
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(body);
}
function localRequest(req) {
  const host=req.headers.host;
  check(typeof host==='string','WORKBOOK_ORIGIN','The original local host is required.');
  let origin;
  try{origin=new URL('http://'+host);}catch{fail('WORKBOOK_ORIGIN','Invalid local host.');}
  check(['127.0.0.1','localhost','[::1]'].includes(origin.hostname) &&
    Number(origin.port || 80)===req.socket.localPort && origin.pathname==='/' && !origin.username && !origin.password,
    'WORKBOOK_ORIGIN','Use the original loopback workbook workspace address.');
  check(!req.headers.origin || req.headers.origin===origin.origin,'WORKBOOK_ORIGIN','Use the same original workspace origin.');
  check(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),
    'WORKBOOK_ORIGIN','Use the same original workspace origin.');
  if(req.method==='POST')check(req.headers['x-conapi-workbook']==='1' &&
    /^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''),
    'WORKBOOK_ORIGIN','Use the original workbook JSON request.');
}
async function body(req) {
  const size=Number(req.headers['content-length']);
  check(!Number.isFinite(size) || size<=LIMIT,'WORKBOOK_SIZE','Workbook input exceeds 96 MiB.');
  let length=0;const chunks=[];
  for await(const chunk of req){
    length+=chunk.length;
    check(length<=LIMIT,'WORKBOOK_SIZE','Workbook input exceeds 96 MiB.');
    chunks.push(chunk);
  }
  return json(Buffer.concat(chunks),'Workbook request');
}
export function createWorkbookHost({python}={}) {
  let active=null,closing=false;
  const route=new Set(['/api/workbook/status','/api/workbook/write','/api/workbook/read']);
  return {
    async handle(req,res) {
      let pathname;
      try{pathname=new URL(req.url,'http://127.0.0.1').pathname;}catch{return false;}
      if(!route.has(pathname))return false;
      try{
        localRequest(req);
        if(pathname==='/api/workbook/status'){
          check(req.method==='GET','WORKBOOK_METHOD','Use GET for workbook status.');
          response(res,200,{schema:IO,status:closing?'closing':active?'converting':'ready',maximumXlsxBytes:XLSX_LIMIT,
            dependency:'The installed Analysis Python environment with openpyxl'});return true;
        }
        check(req.method==='POST','WORKBOOK_METHOD','Use POST for workbook conversion.');
        check(!closing,'WORKBOOK_HOST_CLOSING','The original workbook host is closing.');
        check(!active,'WORKBOOK_CONVERSION_BUSY','Another accepted workbook conversion is still running. Retry this same file after it completes.');
        // Reserve before reading the stream; a second request cannot race the
        // expensive original converter or retain an unbounded queued body.
        let settle;
        active=new Promise(resolve=>{settle=resolve;});
        try {
          const input=await body(req);
          check(input && typeof input==='object' && !Array.isArray(input),'WORKBOOK_JSON_INVALID','A complete workbook request is required.');
          let result;
          if(pathname==='/api/workbook/write'){
            check(typeof input.workspace==='string','WORKBOOK_JSON_INVALID','Select the complete original workspace.');
            result=await exportReviewWorkbook(input.workspace,{python});
          }else{
            const data=fromBase64(input.contentBase64);
            check(input.sha256===sha(data),'WORKBOOK_FILE_CHANGED','The request differs from the retained return hash.');
            result=await readReviewWorkbook(data,{python});
          }
          response(res,200,result);
        }finally{const complete=settle;active=null;complete();}
      }catch(error){
        const code=error.code || 'WORKBOOK_IO_FAILED';
        const status=code==='WORKBOOK_ORIGIN'?403:code==='WORKBOOK_METHOD'?405:
          ['WORKBOOK_CONVERSION_BUSY','WORKBOOK_HOST_CLOSING'].includes(code)?409:
          code==='WORKBOOK_SIZE'?413:code==='WORKBOOK_RUNTIME_MISSING'?503:code==='WORKBOOK_IO_FAILED'?500:422;
        if(!res.headersSent)response(res,status,{schema:IO,status,error:{code,message:error.message,details:error.details || {}}});
        else res.destroy(error);
      }
      return true;
    },
    async close(){closing=true;if(active)await active;}
  };
}
async function fileRead(filename,maximum=OUTPUT_LIMIT) {
  const location=path.resolve(filename),before=await fs.lstat(location);
  check(before.isFile()&&!before.isSymbolicLink(),'WORKBOOK_FILE_INVALID','Use an original regular file.',{path:location});
  check(before.size<=maximum,'WORKBOOK_SIZE','The selected file exceeds its supported size.',{path:location});
  const data=await fs.readFile(location),after=await fs.lstat(location);
  check(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,
    'WORKBOOK_FILE_CHANGED','The selected file changed while it was being read.',{path:location});
  return {path:location,data,sha256:sha(data),bytes:data.length};
}
async function exists(filename){try{return await fs.lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDir(directory){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function atomicWrite(filename,data,{force=false,expectedSha256}={}) {
  const target=path.resolve(filename),existing=await exists(target);
  if(existing){
    check(force&&existing.isFile()&&!existing.isSymbolicLink(),'WORKBOOK_OUTPUT_EXISTS','Choose a new regular output or explicitly use --force.',{path:target});
    check(expectedSha256!==undefined && (await fileRead(target)).sha256===expectedSha256,
      'WORKBOOK_OUTPUT_CHANGED','The selected output changed before replacement.',{path:target});
  }else check(expectedSha256===undefined,'WORKBOOK_OUTPUT_CHANGED','The selected output disappeared before replacement.',{path:target});
  const temporary=path.join(path.dirname(target),'.'+path.basename(target)+'.'+randomUUID()+'.tmp');
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
  try{
    // Recheck after the complete temporary file is durable.
    if(existing){
      check((await fileRead(target)).sha256===expectedSha256,'WORKBOOK_OUTPUT_CHANGED','The output changed before replacement.');
      await fs.rename(temporary,target);
    }else{
      await fs.link(temporary,target);await fs.unlink(temporary);
    }
    await syncDir(path.dirname(target));
  }catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
  return {path:target,bytes:data.length,sha256:sha(data)};
}
async function writeDirectory(directory,files,manifest) {
  const target=path.resolve(directory);
  check(!await exists(target),'WORKBOOK_OUTPUT_EXISTS','Choose a new receiving directory.',{path:target});
  const temporary=path.join(path.dirname(target),'.'+path.basename(target)+'.'+randomUUID()+'.receiving');
  await fs.mkdir(temporary,{mode:0o700});
  try{
    const names=new Set();
    for(const file of files){
      check(typeof file.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.name)&&file.name!=='manifest.json'&&!names.has(file.name),
        'WORKBOOK_DELIVERY_INVALID','Delivery member names must be unique portable leaf names.');
      names.add(file.name);
      const data=file.encoding==='base64'?Buffer.from(file.content,'base64'):bytes(file.content);
      check(data.length===file.bytes&&sha(data)===file.sha256,'WORKBOOK_DELIVERY_CHANGED','A complete delivery member differs from its manifest.');
      const handle=await fs.open(path.join(temporary,file.name),'wx',0o600);
      try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
    }
    const handle=await fs.open(path.join(temporary,'manifest.json'),'wx',0o600);
    try{await handle.writeFile(canonicalJSON(manifest)+'\n');await handle.sync();}finally{await handle.close();}
    await syncDir(temporary);
    // The destination must be absent; a concurrent receiving destination must
    // not be silently replaced (rename into an existing nonempty dir fails).
    check(!await exists(target),'WORKBOOK_OUTPUT_EXISTS','The receiving destination appeared during preparation.');
    await fs.rename(temporary,target);await syncDir(path.dirname(target));
  }catch(error){
    await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{});throw error;
  }
  return target;
}
function member(name,content){const data=bytes(content);return {name,encoding:'utf-8',bytes:data.length,sha256:sha(data),content};}
async function readDirectory(directory,schema) {
  const root=path.resolve(directory),stat=await fs.lstat(root);
  check(stat.isDirectory()&&!stat.isSymbolicLink(),'WORKBOOK_DELIVERY_INVALID','Select the original regular receiving directory.');
  const manifest=json((await fileRead(path.join(root,'manifest.json'))).data,'Receiving manifest');
  check(manifest.schema===schema&&Array.isArray(manifest.files),'WORKBOOK_DELIVERY_INVALID','Select the matching original receiving manifest.');
  const names=new Set(),files=[];
  for(const entry of manifest.files){
    check(typeof entry.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)&&entry.name!=='manifest.json'&&!names.has(entry.name),
      'WORKBOOK_DELIVERY_INVALID','Receiving member names must be unique portable leaf names.');
    names.add(entry.name);
    const actual=await fileRead(path.join(root,entry.name));
    check(actual.bytes===entry.bytes&&actual.sha256===entry.sha256,'WORKBOOK_DELIVERY_CHANGED','An original receiving member changed.',{name:entry.name});
    check(entry.encoding==='utf-8'||entry.encoding==='base64','WORKBOOK_DELIVERY_INVALID','Unsupported receiving member encoding.');
    const content=entry.encoding==='base64'?actual.data.toString('base64'):new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(actual.data);
    files.push({...entry,content});
  }
  const actualNames=(await fs.readdir(root)).sort(),expectedNames=['manifest.json',...names].sort();
  check(canonicalJSON(actualNames)===canonicalJSON(expectedNames),'WORKBOOK_DELIVERY_CHANGED','Keep the exact receiving member inventory.');
  return {root,manifest,files};
}
async function readDelivery(directory,{python}={}) {
  const saved=await readDirectory(directory,DELIVERY_SCHEMA);
  const {manifestSha256,...manifest}=saved.manifest;
  const packet={schema:DELIVERY_SCHEMA,manifest,manifestSha256,files:saved.files};
  const received=await receiveWorkbookDelivery(packet,{readWorkbook:contentBase64=>readReviewWorkbook(fromBase64(contentBase64),{python})});
  return {packet,received};
}
export async function workbookDeliveryMembers(directory,workspace,{python}={}) {
  const {packet,received}=await readDelivery(directory,{python});
  const selected=reopenWorkspace(serializeWorkspace(workspace));
  const recovered=recoverWorkbookReturn(selected,received.operation);
  check(recovered.status==='ALREADY_APPLIED','WORKBOOK_DELIVERY_NOT_APPLIED',
    'Adopt this prepared workbook operation before attaching its delivery to the supplier export.');
  return [
    {filename:'workbook-return.packet.json',content:canonicalJSON(packet)+'\n'},
    {filename:'workbook-return.xlsx',content:Buffer.from(received.contentBase64,'base64')}
  ];
}
function argumentsFor(argv) {
  const [command,...rest]=argv,options={};
  for(let i=0;i<rest.length;i++){
    const name=rest[i];
    check(/^--[a-z][a-z-]*$/.test(name)&&!own(options,name.slice(2)),'WORKBOOK_ARGUMENT','Use unique named workbook options.');
    const key=name.slice(2);
    if(['force','finalize'].includes(key))options[key]=true;
    else {check(i+1<rest.length&&!rest[i+1].startsWith('--'),'WORKBOOK_ARGUMENT','Supply a value for '+name+'.');options[key]=rest[++i];}
  }
  return {command,options};
}
function required(options,key){check(typeof options[key]==='string'&&options[key],'WORKBOOK_ARGUMENT','Supply --'+key+'.');return options[key];}
function allowed(options,names){for(const key of Object.keys(options))check(names.includes(key),'WORKBOOK_ARGUMENT','Unknown workbook option --'+key+'.');}
async function workspaceRead(filename) {
  const file=await fileRead(filename);
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(file.data);
  return {...file,report:reopenWorkspace(text),text};
}
export async function workbookMain(argv) {
  const {command,options}=argumentsFor(argv);
  if(command==='workbook-export'){
    allowed(options,['workspace','out','python','force']);
    const original=await workspaceRead(required(options,'workspace'));
    const out=path.resolve(required(options,'out'));
    check(out!==original.path,'WORKBOOK_ARGUMENT','Use a separate XLSX output path.');
    const existing=await exists(out),prior=existing?await fileRead(out):null;
    const result=await exportReviewWorkbook(original.report,{python:options.python});
    const receipt=await atomicWrite(out,fromBase64(result.file.contentBase64),{force:!!options.force,expectedSha256:prior?.sha256});
    return {status:'WORKBOOK_EXPORTED',...receipt,workbookId:result.workbookId,basisSha256:result.basisSha256,revision:original.report.revision};
  }
  if(command==='workbook-review'){
    allowed(options,['workspace','returned','out-dir','resolutions','reviewed-at','python']);
    const original=await workspaceRead(required(options,'workspace')),returned=await fileRead(required(options,'returned'),XLSX_LIMIT);
    const parsed=await readReviewWorkbook(returned.data,{python:options.python});
    const resolutions=options.resolutions?json((await fileRead(options.resolutions)).data,'Conflict choices'):{};
    const preview=reviewWorkbookReturn(original.report,parsed,{resolutions,...(options['reviewed-at']?{reviewedAt:options['reviewed-at']}:{})});
    const files=[
      {name:'returned.xlsx',encoding:'base64',bytes:returned.bytes,sha256:returned.sha256,content:returned.data.toString('base64')},
      member('return.json',canonicalJSON(parsed)+'\n'),member('review.json',canonicalJSON(preview)+'\n'),
      member('before.workspace.json',serializeWorkspace(original.report))
    ];
    const manifest={schema:REVIEW_PACKET,planSha256:preview.planSha256,files:files.map(({content,...item})=>item)};
    const directory=await writeDirectory(required(options,'out-dir'),files,manifest);
    return {status:preview.canApply?'WORKBOOK_REVIEW_READY':'WORKBOOK_REVIEW_CONFLICTS',directory,preview};
  }
  if(command==='workbook-apply'){
    allowed(options,['workspace','review-dir','operation','out','delivery-dir','force','finalize','python']);
    const original=await workspaceRead(required(options,'workspace'));
    const review=await readDirectory(required(options,'review-dir'),REVIEW_PACKET);
    const index=new Map(review.files.map(file=>[file.name,file]));
    check(index.size===4&&['returned.xlsx','return.json','review.json','before.workspace.json'].every(name=>index.has(name)),
      'WORKBOOK_REVIEW_CHANGED','Keep the full original review selection.');
    const parsed=JSON.parse(index.get('return.json').content),preview=JSON.parse(index.get('review.json').content);
    check(preview.planSha256===review.manifest.planSha256,'WORKBOOK_REVIEW_CHANGED','The reviewed selection differs from its manifest.');
    const actualReturned=await readReviewWorkbook(fromBase64(index.get('returned.xlsx').content),{python:options.python});
    check(canonicalJSON(actualReturned)===canonicalJSON(parsed),'WORKBOOK_RETURN_XLSX_CHANGED',
      'The actual returned XLSX cells differ from this retained review selection. Review the original returned workbook again.');
    const delivery=path.resolve(required(options,'delivery-dir')),out=path.resolve(required(options,'out')),operationId=required(options,'operation');
    const previousOut=await exists(out)?await fileRead(out):null;
    if(previousOut&&!options.force)fail('WORKBOOK_OUTPUT_EXISTS','Use a new output or explicitly use --force.');
    let operation,packet,next,status;
    if(await exists(delivery)){
      const prior=await readDelivery(delivery,{python:options.python});
      check(prior.received.operation.operationId===operationId &&
        prior.received.operation.preview.planSha256===preview.planSha256 &&
        prior.received.operation.request.finalizeOutput===!!options.finalize &&
        canonicalJSON(prior.received.operation.input)===canonicalJSON(parsed) &&
        prior.received.contentBase64===index.get('returned.xlsx').content,
        'WORKBOOK_OPERATION_CHANGED','This delivery directory belongs to another original operation or review.');
      const recovered=recoverWorkbookReturn(original.report,prior.received.operation);
      operation=recovered.operation;packet=prior.packet;next=recovered.report;status=recovered.status;
    }else{
      operation=applyWorkbookReturn(original.report,parsed,preview,{operationId,finalizeOutput:!!options.finalize});
      packet=await createWorkbookDelivery(operation,index.get('returned.xlsx').content);
      await writeDirectory(delivery,packet.files,{...packet.manifest,manifestSha256:packet.manifestSha256});
      next=reopenWorkspace(operation.afterWorkspace);status='APPLIED';
    }
    // Original selected file is compared after the durable receiving result,
    // before its pure original workspace is adopted. A retry uses this result.
    check((await fileRead(original.path)).sha256===original.sha256,
      'WORKBOOK_REVIEW_CHANGED','The original saved workspace changed before adoption. Its prepared return remains in the delivery directory.');
    const receipt=await atomicWrite(out,bytes(serializeWorkspace(next)),{force:!!options.force,expectedSha256:previousOut?.sha256});
    return {status,operationId,deliveryDirectory:delivery,workspace:receipt,receipt:operation.receipt};
  }
  if(command==='workbook-receive'){
    allowed(options,['packet','delivery-dir','out-dir','python']);
    check(!!options.packet!==!!options['delivery-dir'],'WORKBOOK_ARGUMENT','Select one --packet or --delivery-dir.');
    let packet,received;
    if(options.packet){
      packet=json((await fileRead(options.packet)).data,'Workbook receiving packet');
      received=await receiveWorkbookDelivery(packet,{readWorkbook:contentBase64=>readReviewWorkbook(fromBase64(contentBase64),{python:options.python})});
    }else ({packet,received}=await readDelivery(options['delivery-dir'],{python:options.python}));
    const directory=await writeDirectory(required(options,'out-dir'),packet.files,{...packet.manifest,manifestSha256:packet.manifestSha256});
    return {status:'WORKBOOK_RECEIVED',directory,operationId:received.operation.operationId,
      comparisonId:received.report.comparisonId,revision:received.report.revision,workspace:path.join(directory,'workspace.json')};
  }
  fail('WORKBOOK_ARGUMENT','Use workbook-export, workbook-review, workbook-apply or workbook-receive.');
}
