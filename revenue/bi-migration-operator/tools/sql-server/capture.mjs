// Native SQL Server capture. MIT. The pinned SF30 source performs every database read.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readMssqlSourceFile, openMssqlSourceFile } from './core/mssql/config.mjs';
import { inspectMssqlCatalog } from './core/mssql/catalog.mjs';

export const DRIVER_REF='f18c68077478e1cf7063e5c38be86f0edab39d7a';
const stamp=()=>new Date().toISOString();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,v[k]])):v);
const named=/^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const origins=new Set(['sqlserver','protocol-example']);
function check(value,message){if(!value)throw new Error(message);}
async function regular(filename,maximum=64*1024*1024){
  const st=await fs.lstat(filename);check(st.isFile()&&!st.isSymbolicLink()&&st.size<=maximum,'ORIGINAL_FILE_INVALID');
  const value=await fs.readFile(filename);check(value.length<=maximum,'ORIGINAL_FILE_TOO_LARGE');return value;
}
async function write(filename,value){
  const data=typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)+'\n';
  await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const temp=filename+'.partial-'+crypto.randomUUID();
  const handle=await fs.open(temp,'wx',0o600);
  try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
  await fs.rename(temp,filename);
}
async function json(filename){return JSON.parse((await regular(filename)).toString('utf8'));}
async function exists(filename){try{await fs.lstat(filename);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function relative(root,name){
  check(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&!name.split('/').some(x=>!x||x==='.'||x==='..'),'PORTABLE_PATH_REQUIRED');
  return path.join(root,...name.split('/'));
}
async function processIdentity(pid=process.pid){
  if(process.platform==='linux'){
    try{const stat=await fs.readFile('/proc/'+pid+'/stat','utf8');return{pid,host:os.hostname(),start:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};}
    catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e;}
  }
  try{process.kill(pid,0);return{pid,host:os.hostname(),start:'native-process-present'};}catch(e){if(e.code==='ESRCH')return null;return{pid,host:os.hostname(),start:'native-process-present'};}
}
async function lock(root,jobHash){
  const file=path.join(root,'native.lock'),holder={job_sha256:jobHash,identity:await processIdentity(),nonce:crypto.randomUUID(),created_at:stamp()};
  for(let attempt=0;attempt<2;attempt++){
    try{const h=await fs.open(file,'wx',0o600);await h.writeFile(canonical(holder));await h.sync();await h.close();return async()=>{
      try{const current=await json(file);if(current.nonce===holder.nonce)await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}
    };}catch(e){
      if(e.code!=='EEXIST')throw e;
      const old=await json(file);check(old.job_sha256===jobHash,'ORIGINAL_OPERATION_LOCK_DIFFERS');
      if(old.identity?.host!==os.hostname())throw new Error('ORIGINAL_HOST_LOCK_REQUIRES_RECONCILIATION');
      const observed=await processIdentity(old.identity.pid);
      if(observed&&canonical(observed)===canonical(old.identity))throw new Error('ORIGINAL_NATIVE_PROCESS_ACTIVE');
      const after=await json(file);check(after.nonce===old.nonce,'NATIVE_LOCK_CHANGED');
      await fs.rename(file,file+'.retired-'+crypto.randomUUID());
    }
  }
  throw new Error('NATIVE_LOCK_UNAVAILABLE');
}
function cellKey(row,keys){
  const result=keys.map(k=>row[k.column]);
  check(result.every(x=>typeof x==='string'),'NONNULL_EXACT_CURSOR_REQUIRED');
  return canonical(result);
}
function publicError(error){
  const code=typeof error?.code==='string'?error.code:typeof error?.message==='string'?error.message:'NATIVE_READ_FAILED';
  return{code:/^[A-Za-z0-9_.:-]{1,180}$/.test(code)?code:'NATIVE_READ_FAILED',number:Number.isInteger(error?.number)?error.number:null};
}
export async function executeJob({jobPath,operationRoot,mode='execute',adapter=null,origin='sqlserver',afterCommit=null}={}){
  check(['execute','continue','inspect'].includes(mode),'MODE_INVALID');check(origins.has(origin),'EXECUTION_ORIGIN_INVALID');
  const jobRaw=await regular(jobPath,2*1024*1024),job=JSON.parse(jobRaw.toString('utf8')),jobHash=sha(jobRaw);
  check(job.schema==='commons-bi-sql-server-job/1'&&job.driver_ref===DRIVER_REF,'NATIVE_JOB_CONTRACT_DIFFERS');
  check(job.origin===origin,'EXECUTION_ORIGIN_DIFFERS_FROM_ORIGINAL_JOB');
  check(['catalog','preflight','capture'].includes(job.action)&&typeof job.job_id==='string','NATIVE_JOB_ACTION_INVALID');
  const inputRoot=path.dirname(path.resolve(jobPath)),root=path.resolve(operationRoot);
  await fs.mkdir(root,{recursive:true,mode:0o700});
  for(const item of job.files){
    const content=await regular(relative(inputRoot,item.path));
    check(content.length===item.bytes&&sha(content)===item.sha256,'ORIGINAL_INPUT_BYTES_DIFFER');
  }
  const sourceFile=relative(inputRoot,job.source_file),declaration=await readMssqlSourceFile(sourceFile);
  const config=declaration.config;check(sha(await regular(sourceFile))===job.source_sha256,'ORIGINAL_SOURCE_DIFFERS');
  const statePath=path.join(root,'state.json');
  let state=await exists(statePath)?await json(statePath):{
    schema:'commons-bi-sql-server-state/1',job_id:job.job_id,job_sha256:jobHash,origin,driver_ref:DRIVER_REF,
    status:'prepared',generation:0,pages:[],observations:[],events:[],rows:0,native_bytes:0,
    started_at:stamp(),updated_at:stamp(),pending:null,cursor:null,complete:false
  };
  check(state.job_sha256===jobHash&&state.job_id===job.job_id&&state.origin===origin,'CONTINUE_ORIGINAL_JOB_BYTES');
  const event=(type,detail={})=>{state.events.push({at:stamp(),type,...detail});state.updated_at=stamp();};
  const save=()=>write(statePath,state);
  if(state.status==='complete')return state;
  if(mode==='inspect')return state;
  if(mode==='execute'&&state.generation>0){check(false,'CONTINUE_EXISTING_OPERATION_EXPLICITLY');}
  const unlock=await lock(root,jobHash);
  let source=null,timer=null,canceled=false,controller=new AbortController();
  const cancel=()=>{canceled=true;controller.abort();};
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  const parent=process.ppid;
  try{
    if(state.pending){
      event('original_read_response_not_retained',{original_pending:state.pending,disposition:'Explicit continuation reads the same cursor in a new observed statement.'});
      state.pending=null;
    }
    state.generation++;state.status='running';state.native_process=await processIdentity();state.complete=false;
    event('native_continuation_started',{generation:state.generation,mode});
    await save();
    const cancelPath=path.join(root,'cancel.json');
    if(await exists(cancelPath)){
      if(mode==='continue')await fs.rename(cancelPath,cancelPath+'.prior-'+state.generation);
      else{cancel();state.status='canceled';state.pending=null;event('canceled_before_dispatch');await save();return state;}
    }
    timer=setInterval(async()=>{
      try{if(await exists(cancelPath)||process.ppid!==parent)cancel();}catch{cancel();}
    },250);
    const use=adapter??{open:openMssqlSourceFile,catalog:inspectMssqlCatalog};
    if(job.action==='catalog'){
      state.pending={kind:'catalog',table:job.table??null,started_at:stamp(),generation:state.generation};await save();
      const observed=await use.catalog(sourceFile,{environment:process.env,...(job.table?{table:job.table}:{})});
      const raw=Buffer.from(canonical(observed)+'\n');
      const filename='observations/catalog-g'+state.generation+'.json';
      await write(relative(root,filename),raw);
      state.observations.push({path:filename,bytes:raw.length,sha256:sha(raw),role:'catalog',captured_at:stamp()});
      state.catalog=observed;state.pending=null;
      state.status=canceled?'canceled':'complete';state.complete=!canceled;event(state.status);
      await save();return state;
    }
    const opened=await use.open(sourceFile,{environment:process.env});source=opened.source;
    const preflight=source.preflight(),name=job.query_name;
    check(named.test(name??'')&&Object.hasOwn(config.queries,name),'ORIGINAL_QUERY_NOT_FOUND');
    const metadata=preflight.queries?.[name]?.columns;
    check(Array.isArray(metadata)&&metadata.length===config.queries[name].columns.length,'NATIVE_QUERY_METADATA_MISSING');
    const metadataHash=sha(Buffer.from(canonical(metadata)));
    const preflightRaw=Buffer.from(canonical(preflight)+'\n'),preflightFile='observations/preflight-g'+state.generation+'.json';
    await write(relative(root,preflightFile),preflightRaw);
    state.observations.push({path:preflightFile,bytes:preflightRaw.length,sha256:sha(preflightRaw),role:'preflight',captured_at:stamp()});
    if(state.metadata_sha256)check(state.metadata_sha256===metadataHash,'QUERY_SCHEMA_CHANGED_DURING_CONTINUATION');
    if(job.expected_column_types)check(canonical(job.expected_column_types)===canonical(metadata),'REVIEWED_QUERY_SCHEMA_CHANGED');
    state.column_types=metadata;state.columns=config.queries[name].columns;state.metadata_sha256=metadataHash;state.server_version=preflight.serverVersion;
    if(job.action==='preflight'){state.status=canceled?'canceled':'complete';state.complete=!canceled;event(state.status);await save();return state;}
    const paging=job.pagination??{mode:'single'},keys=paging.keys??[];
    check(['single','keyset'].includes(paging.mode),'PAGINATION_MODE_INVALID');
    if(paging.mode==='keyset'){
      check(keys.length>0&&keys.length<=4&&new Set(keys.map(k=>k.column)).size===keys.length,'REVIEWED_CURSOR_KEYS_REQUIRED');
      check(paging.review_reference&&named.test(paging.start_parameter??''),'REVIEWED_CURSOR_CONTRACT_REQUIRED');
      for(const key of keys){
        check(named.test(key.parameter??'')&&state.columns.includes(key.column),'CURSOR_FIELD_NOT_PROJECTED');
        const column=metadata.find(x=>x.name===key.column);
        check(column&&!column.nullable&&column.encoding!=='binary','NONNULL_NONBINARY_CURSOR_REQUIRED');
        check(config.queries[name].parameters[key.parameter],'CURSOR_PARAMETER_UNDECLARED');
      }
      check(canonical(config.queries[name].orderBy.map(x=>x.column))===canonical(keys.map(k=>k.column)),'CURSOR_MUST_MATCH_COMPLETE_NATIVE_ORDER');
    }
    const maxPages=paging.max_pages??100,maxRows=paging.max_total_rows??100000,maxBytes=paging.max_total_bytes??50331648;
    check(Number.isInteger(maxPages)&&maxPages>=1&&maxPages<=1000,'CAPTURE_PAGE_LIMIT_INVALID');
    check(Number.isInteger(maxRows)&&maxRows>=1&&maxRows<=1000000,'CAPTURE_ROW_LIMIT_INVALID');
    check(Number.isInteger(maxBytes)&&maxBytes>=1024&&maxBytes<=50331648,'CAPTURE_BYTE_LIMIT_INVALID');
    const seen=new Set();
    for(const page of state.pages){
      const raw=await regular(relative(root,page.path));
      check(raw.length===page.bytes&&sha(raw)===page.sha256,'ORIGINAL_COMMITTED_PAGE_CHANGED');
      const value=JSON.parse(raw.toString('utf8'));
      if(paging.mode==='keyset')for(const row of value.rows){const key=cellKey(row,keys);check(!seen.has(key),'CURSOR_KEY_REPEATED');seen.add(key);}
    }
    while(!canceled){
      if(state.pages.length>=maxPages||state.rows>=maxRows){state.status='partial';event('capture_limit_reached');break;}
      const input=structuredClone(job.parameters??{});
      if(paging.mode==='keyset'){
        input[paging.start_parameter]=Boolean(state.cursor);
        for(const key of keys)input[key.parameter]=state.cursor?state.cursor[key.column]:null;
      }
      source.validate(name,input);
      const dispatch={id:crypto.randomUUID(),page:state.pages.length+1,input,started_at:stamp(),generation:state.generation};
      state.pending=dispatch;await save();
      let result;
      try{result=await source.query(name,input,{signal:controller.signal});}
      catch(error){if(canceled){state.status='canceled';event('native_read_canceled',{pending:dispatch});break;}throw error;}
      check(result.schema==='stellar-forge.mssql-result.v1'&&result.query===name,'NATIVE_RESULT_SCHEMA_CHANGED');
      check(canonical(result.columnTypes)===canonical(metadata)&&canonical(result.columns)===canonical(state.columns),'NATIVE_RESULT_COLUMNS_CHANGED');
      check(Array.isArray(result.rows)&&result.rowCount===result.rows.length&&typeof result.truncated==='boolean','NATIVE_ROW_COUNT_INVALID');
      const bytes=Buffer.from(canonical(result)+'\n'),filename='pages/page-'+String(dispatch.page).padStart(6,'0')+'-'+dispatch.id+'.json';
      await write(relative(root,filename),bytes);
      if(state.rows+result.rows.length>maxRows||state.native_bytes+bytes.length>maxBytes){
        state.observations.push({path:filename,bytes:bytes.length,sha256:sha(bytes),role:'excluded-limit-page',captured_at:stamp()});
        state.status='partial';event('capture_limit_reached',{excluded_page:dispatch.page});break;
      }
      if(paging.mode==='keyset'){
        check(!result.truncated||result.rows.length>0,'TRUNCATED_EMPTY_PAGE_CANNOT_CONTINUE');
        for(const row of result.rows){const key=cellKey(row,keys);check(!seen.has(key),'CURSOR_KEY_REPEATED');seen.add(key);}
        if(result.rows.length)state.cursor=Object.fromEntries(keys.map(k=>[k.column,result.rows.at(-1)[k.column]]));
      }
      state.pages.push({path:filename,bytes:bytes.length,sha256:sha(bytes),rows:result.rowCount,truncated:result.truncated,
        request:dispatch,completed_at:stamp(),cursor:structuredClone(state.cursor)});
      state.rows+=result.rowCount;state.native_bytes+=bytes.length;state.pending=null;
      event('page_committed',{page:dispatch.page,rows:result.rowCount,total_rows:state.rows,truncated:result.truncated});
      await save();
      if(afterCommit)await afterCommit(state,dispatch.page);
      if(!result.truncated){state.status='complete';state.complete=true;event('complete');break;}
      if(paging.mode==='single'){state.status='partial';event('single_page_truncated');break;}
    }
    if(canceled&&state.status==='running'){state.status='canceled';event('canceled');}
    state.completed_at=stamp();await save();return state;
  }catch(error){
    state.status=canceled?'canceled':'failed';state.error=publicError(error);state.complete=false;
    event(state.status,{error:state.error});await save();return state;
  }finally{
    if(timer)clearInterval(timer);
    if(source)await source.close().catch(()=>{});
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
    await unlock();
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.indexOf('=');return[p<0?v.slice(2):v.slice(2,p),p<0?true:v.slice(p+1)];}));
  try{
    const state=await executeJob({jobPath:args.job,operationRoot:args.operation,mode:args.mode??'execute'});
    console.log(canonical({job_id:state.job_id,status:state.status,rows:state.rows,pages:state.pages.length,complete:state.complete}));
    if(state.status==='failed')process.exitCode=1;
  }catch(e){console.error(canonical({error:publicError(e)}));process.exitCode=2;}
}
