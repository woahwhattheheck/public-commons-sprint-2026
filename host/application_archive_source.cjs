#!/usr/bin/env node
'use strict';
/* Complete ordinary ZIP -> original mixed-language source -> independent receiving.
 * Only trusted installed collectors run. Archive members are never imported/executed.
 */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),zlib=require('node:zlib'),{TextDecoder}=require('node:util');
const zip=require('./connected_zip.cjs'),zipReceive=require('./connected_zip_receive.cjs');
const core=require('./connected_application_archive.cjs'),io=zipReceive.receivingIO;
const MAX=256*1024*1024,MAX_ARCHIVE=128*1024*1024,MAX_SPEC=2*1024*1024;
const UTF8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const TOOL_PATHS=[
 'application_archive_source.cjs','application_archive_parser.py','connected_application_archive.cjs',
 'application_source_closure.py','application_source_bridge.cjs','python_source_closure.py',
 'source_closure_cli.cjs','connected_javascript_source_closure.cjs',
 'connected_zip.cjs','connected_zip_archive.cjs','connected_zip_receive.cjs','connected_gzip.cjs',
 'vendor/acorn-source-closure/acorn.cjs','vendor/acorn-source-closure/SOURCE.json',
 'vendor/acorn-source-closure/LICENSE','APPLICATION_ARCHIVE_SOURCE.md',
 'APPLICATION_SOURCE_CLOSURE.md','PYTHON_SOURCE_CLOSURE.md','JAVASCRIPT_SOURCE_CLOSURE.md',
 'CONNECTED_ZIP_ARCHIVE.md'
];
const fail=(code,message,detail)=>{throw Object.assign(Error(message),{code,...(detail===undefined?{}:{detail})});};
const need=(ok,message)=>{if(!ok)fail('APPLICATION_ARCHIVE_SOURCE',message);};
const identify=raw=>({bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex'),
 git_blob_sha1:crypto.createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex')});
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n','utf8');
const parse=raw=>JSON.parse(UTF8.decode(raw));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=value=>{need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Supply the retained complete original SHA-256');return value;};
const blob=raw=>({...identify(raw),contentBase64:raw.toString('base64')});
function bytes(row,maximum=MAX){
 need(row&&typeof row.contentBase64==='string'&&row.contentBase64.length<=4*Math.ceil(maximum/3),'Complete retained bytes exceed their limit');
 const raw=Buffer.from(zip.fromBase64(row.contentBase64));
 need(raw.length<=maximum&&same(identify(raw),{bytes:row.bytes,sha256:row.sha256,git_blob_sha1:row.git_blob_sha1}),'Complete retained byte identity differs');
 return raw;
}
async function exists(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function exact(file,raw){const actual=await io.readOriginal(file,Math.max(1,raw.length));need(actual.equals(raw),'Retained original file differs: '+file);}
async function publish(file,raw){need(raw.length<=MAX,'Complete output exceeds 256 MiB');await io.publishFile(path.dirname(file),path.basename(file),raw);return{path:file,...identify(raw)};}
async function toolchain(){
 const rows=[];
 for(const name of TOOL_PATHS){
  const raw=await io.readOriginal(path.join(__dirname,name),8*1024*1024);
  rows.push({path:'host/'+name,...blob(raw)});
 }
 return rows;
}
async function originalTools(rows){
 const actual=await toolchain();
 need(same(rows,actual),'Use the original complete collector/tool edition that created this archive source');
 return actual;
}
async function directoryTree(root,relative){
 core.relative(relative);let dir=root;
 for(const segment of relative.split('/')){dir=path.join(dir,segment);await io.privateDirectory(dir,true);}
 return dir;
}
async function operation(directory,intent){
 need(typeof directory==='string'&&directory,'Supply the original private operation directory');
 const root=path.resolve(directory),raw=json(intent);
 await io.privateDirectory(path.dirname(root));await io.privateDirectory(root,true);
 if(!await exists(path.join(root,'intent.json'))){
  for(const name of await fs.readdir(root)){
   need(/^\.zip-receive-[a-f0-9-]{36}\.part$/.test(name),'Nonempty directory has no matching original archive-source intent');
   const stat=await fs.lstat(path.join(root,name));need(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,'Invalid retained initial publication');
   const prefix=await io.readOriginal(path.join(root,name),raw.length);
   need(raw.subarray(0,prefix.length).equals(prefix),'Unfinished intent belongs to another operation');
  }
 }
 await publish(path.join(root,'intent.json'),raw);
 await io.privateDirectory(path.join(root,'attempts'),true);
 return root;
}
function executable(value,label){
 need(typeof value==='string'&&path.isAbsolute(value),'Select the existing absolute '+label+' executable');
 return value;
}
async function assertParserOwnersClosed(root){
 for(const name of await fs.readdir(path.join(root,'attempts'))){
  if(!name.startsWith('parser-'))continue;
  const directory=path.join(root,'attempts',name);await io.privateDirectory(directory);
  let value;
  try{value=parse(await io.readOriginal(path.join(directory,'parser-close.json'),MAX_SPEC));}catch(_){}
  if(!value||value.schema!=='commons.application-archive-parser-close.v1'||value.state!=='CLOSED'||
    !Number.isInteger(value.pid)||!Array.isArray(value.children)||
    value.children.some(x=>!Number.isInteger(x.pid)||!Number.isInteger(x.returncode))){
   fail('APPLICATION_ARCHIVE_DRAIN_UNCONFIRMED','Reconcile the original unfinished parser owner before starting another attempt.',{directory});
  }
 }
}
async function runCollector(root,args,{python,node,signal}){
 executable(python,'Python');executable(node,'Node');
 need(!signal?.aborted,'Original source operation was aborted before parser launch');
 await assertParserOwnersClosed(root);
 const dir=await fs.mkdtemp(path.join(root,'attempts','parser-'));
 await fs.chmod(dir,0o700);await io.syncDirectory(path.dirname(dir));
 const invocation=['-E','-s',path.join(__dirname,'application_archive_parser.py'),dir,'--',
  ...args,'--node',node,'--temporary-parent',dir];
 await publish(path.join(dir,'invocation.json'),json({executable:python,argv:invocation,applicationExecution:false}));
 let out,err,child,timer,escalation,abort,code,reason=null,closed,primaryError,killError;
 const stop=number=>{if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  try{process.kill(-child.pid,number);}catch(e){if(e.code!=='ESRCH')killError=e;}};
 const requestStop=why=>{
  if(reason)return;reason=why;stop('SIGTERM');
  // The unchanged bridge owns a five-second grace period. The trusted wrapper
  // independently drains every registered original child before its CLOSED receipt.
  escalation=setTimeout(()=>stop('SIGKILL'),20000);
 };
 try{
  out=await fs.open(path.join(dir,'stdout.json'),'wx',0o600);
  err=await fs.open(path.join(dir,'stderr.txt'),'wx',0o600);
  child=spawn(python,invocation,{stdio:['ignore',out.fd,err.fd],cwd:__dirname,
   env:{...process.env,PYTHONNOUSERSITE:'1'},detached:true});
  closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(c,s)=>resolve({code:c,signal:s}));});
  abort=()=>requestStop('ABORTED');signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  timer=setTimeout(()=>requestStop('TIMEOUT'),300000);
  code=await closed;
 }catch(error){primaryError=error;}
 finally{
  clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){
   requestStop('RUNNER_ERROR');if(closed)await closed.catch(error=>{primaryError??=error;});
  }
  clearTimeout(escalation);
  const cleanup=await Promise.allSettled([out,err].filter(Boolean).map(async handle=>{
   try{await handle.sync();}finally{await handle.close();}
  }));
  for(const result of cleanup)if(result.status==='rejected')primaryError??=result.reason;
 }
 let drain=null;
 if(child?.pid){
  try{drain=parse(await io.readOriginal(path.join(dir,'parser-close.json'),MAX_SPEC));}catch(error){primaryError??=error;}
  if(!drain||drain.schema!=='commons.application-archive-parser-close.v1'||drain.state!=='CLOSED'||
     drain.pid!==child.pid||!Array.isArray(drain.children)||drain.children.some(x=>!Number.isInteger(x.pid)||!Number.isInteger(x.returncode))){
   fail('APPLICATION_ARCHIVE_DRAIN_UNCONFIRMED','Original parser drain is not confirmed. Preserve and reconcile this same attempt before retrying.',
    {directory:dir,pid:child.pid,reason,...code,error:primaryError?.message,killError:killError?.message});
  }
 }
 if(primaryError||killError||reason||!code||code.signal||![0,2].includes(code.code)){
  let stderr='';if(err)stderr=(await io.readOriginal(path.join(dir,'stderr.txt'),MAX)).toString('utf8');
  fail('APPLICATION_ARCHIVE_PARSER','The original collector did not complete.',
   {reason,...code,directory:dir,drain,error:primaryError?.message,killError:killError?.message,stderr});
 }
 const raw=await io.readOriginal(path.join(dir,'stdout.json'),MAX),result=parse(raw);
 need(result&&['COMPLETE','INCOMPLETE'].includes(result.status),'The original collector returned no complete source status');
 return {result,attempt:dir,drain};
}
async function readInput(filename){
 let raw=await io.readOriginal(path.resolve(filename),MAX);
 if(raw[0]===31&&raw[1]===139){need(raw.length<=MAX_ARCHIVE,'Compressed packet exceeds 128 MiB');raw=zlib.gunzipSync(raw,{maxOutputLength:MAX});}
 need(raw.length<=MAX,'Packet exceeds 256 MiB');return {raw,packet:parse(raw)};
}
function inspectBinding(packet){
 const expected=['schema','archive','memberRoot','selection','source','tools','binding'];
 need(packet&&same(Object.keys(packet).sort(),expected.sort())&&packet.schema===core.SCHEMA,'Use the complete supported archive-source packet');
 core.relative(packet.memberRoot,true);
 const archive=bytes(packet.archive,MAX_ARCHIVE),selection=bytes(packet.selection,MAX_SPEC),sourceRaw=bytes(packet.source);
 const source=parse(sourceRaw),spec=parse(selection);
 need(same(source.selection,spec),'Retained selection differs from the original mixed collector selection');
 const view=zip.readZipArchive(archive,{maxBytes:MAX_ARCHIVE,maxEntries:8192,maxUncompressedBytes:128*1024*1024});
 // Use the same portable receiving rules before declaring the archive receivable.
 zipReceive.describeArchive(archive,{maxBytes:MAX_ARCHIVE,maxEntries:8192,maxUncompressedBytes:128*1024*1024});
 const binding=core.bindArchiveSource({archiveView:view,memberRoot:packet.memberRoot,source,identify});
 need(same(packet.binding,binding),'Archive/source relationship differs from the retained complete binding');
 return {archive,selection,sourceRaw,source,binding};
}
async function retainTools(root,rows){
 for(const row of rows){
  core.relative(row.path);const raw=bytes(row,8*1024*1024),parent=path.posix.dirname(row.path);
  const directory=parent==='.'?root:await directoryTree(root,parent);
  await publish(path.join(directory,path.posix.basename(row.path)),raw);
 }
}
async function collect({archive,expectedSha256,memberRoot,selection,directory,output,gzip=false,python,node=process.execPath,signal}={}){
 executable(python,'Python');executable(node,'Node');digest(expectedSha256);core.relative(memberRoot,true);
 need(archive&&selection&&output,'Supply archive, selection and complete output paths');
 const archiveRaw=await io.readOriginal(path.resolve(archive),MAX_ARCHIVE),selectionRaw=await io.readOriginal(path.resolve(selection),MAX_SPEC);
 need(identify(archiveRaw).sha256===expectedSha256,'Original ZIP differs from its independently retained SHA-256');
 const tools=await toolchain(),description=zipReceive.describeArchive(archiveRaw,{maxBytes:MAX_ARCHIVE,maxEntries:8192,maxUncompressedBytes:128*1024*1024});
 const root=await operation(directory,{schema:core.SCHEMA,command:'collect',archive:identify(archiveRaw),
  memberRoot,selection:identify(selectionRaw),tools:tools.map(({contentBase64,...row})=>row),python,node});
 await publish(path.join(root,'original.zip'),archiveRaw);await publish(path.join(root,'selection.json'),selectionRaw);
 const received=await zipReceive.receiveZipArchive({archive:path.join(root,'original.zip'),directory:path.join(root,'archive'),
  expectedSha256,maxBytes:MAX_ARCHIVE,maxEntries:8192,maxUncompressedBytes:128*1024*1024});
 const originalRoot=memberRoot==='.'?received.members:path.join(received.members,memberRoot);
 // readZipArchive checked all paths; the selected root must be a retained original directory.
 const view=zip.readZipArchive(archiveRaw,{maxBytes:MAX_ARCHIVE,maxEntries:8192,maxUncompressedBytes:128*1024*1024});
 const dirs=new Set(['.']);for(const e of view.entries){const p=e.path.split('/');for(let n=1;n<p.length;n++)dirs.add(p.slice(0,n).join('/'));if(e.kind==='directory')dirs.add(e.path);}
 need(dirs.has(memberRoot),'Select an existing original application directory inside the ZIP');
 const sourceFile=path.join(root,'application-source.json');
 if(!await exists(sourceFile)){
  const attempt=await fs.mkdtemp(path.join(root,'attempts','collect-'));await fs.chmod(attempt,0o700);
  const candidate=path.join(attempt,'application-source.json');
  await runCollector(root,['collect','--root',originalRoot,'--spec',path.join(root,'selection.json'),'--output',candidate],{python,node,signal});
  const raw=await io.readOriginal(candidate,MAX);await publish(sourceFile,raw);
 }
 const inspection=await runCollector(root,['inspect','--input',sourceFile],{python,node,signal});
 const sourceRaw=await io.readOriginal(sourceFile,MAX),source=parse(sourceRaw);
 const binding=core.bindArchiveSource({archiveView:view,memberRoot,source,identify});
 const packet={schema:core.SCHEMA,archive:blob(archiveRaw),memberRoot,selection:blob(selectionRaw),source:blob(sourceRaw),tools,binding};
 inspectBinding(packet);await originalTools(tools);
 await zipReceive.verifyZipReceiving({directory:path.join(root,'archive'),expectedSha256});
 const raw=json(packet);need(raw.length<=MAX,'Full original archive plus selected source exceeds 256 MiB; select a smaller complete archive');
 await publish(path.join(root,'archive-source.json'),raw);await io.privateDirectory(path.join(root,'tools'),true);await retainTools(path.join(root,'tools'),tools);
 const published=gzip?zlib.gzipSync(raw,{level:6}):raw;
 const receipt=await publish(path.resolve(output),published);
 return {schema:core.SCHEMA,status:inspection.result.status,operation:root,archive:identify(archiveRaw),
  packet:identify(raw),output:receipt,memberRoot,binding,coverage:source.coverage,applicationExecution:false};
}
async function inspect({input,directory,python,node=process.execPath,signal}={}){
 executable(python,'Python');executable(node,'Node');
 const {packet,raw}=await readInput(input),bound=inspectBinding(packet);await originalTools(packet.tools);
 const root=await operation(directory,{schema:core.SCHEMA,command:'inspect-or-receive',packet:identify(raw),python,node});
 await publish(path.join(root,'archive-source.json'),raw);
 await publish(path.join(root,'application-source.json'),bound.sourceRaw);
 const review=await runCollector(root,['inspect','--input',path.join(root,'application-source.json')],{python,node,signal});
 await originalTools(packet.tools);
 return {schema:core.SCHEMA,status:review.result.status,packet:identify(raw),directory:root,binding:bound.binding,
  coverage:bound.source.coverage,applicationExecution:false};
}
async function receive(options={}){
 options={...options,node:options.node??process.execPath};
 const result=await inspect(options);need(result.status==='COMPLETE','Resolve the original collector findings before complete receiving');
 const {packet,raw}=await readInput(options.input),bound=inspectBinding(packet);
 need(same(result.packet,identify(raw)),'Original packet changed between inspection and receiving');
 const root=result.directory;
 await publish(path.join(root,'original.zip'),bound.archive);await publish(path.join(root,'selection.json'),bound.selection);
 const archive=await zipReceive.receiveZipArchive({archive:path.join(root,'original.zip'),directory:path.join(root,'archive'),
  expectedSha256:packet.archive.sha256,maxBytes:MAX_ARCHIVE,maxEntries:8192,maxUncompressedBytes:128*1024*1024});
 const selected=await runCollector(root,['receive','--input',path.join(root,'application-source.json'),'--directory',path.join(root,'application')],options);
 await io.privateDirectory(path.join(root,'tools'),true);await retainTools(path.join(root,'tools'),packet.tools);
 await originalTools(packet.tools);
 await zipReceive.verifyZipReceiving({directory:path.join(root,'archive'),expectedSha256:packet.archive.sha256});
 const complete={schema:core.SCHEMA,status:'COMPLETE',packet:identify(raw),archive:identify(bound.archive),
  memberRoot:packet.memberRoot,binding:bound.binding,sourceDirectory:'application/source',originalArchive:'archive/archive.zip',
  originalMembers:'archive/members',toolsDirectory:'tools',applicationExecution:false};
 await publish(path.join(root,'complete.json'),json(complete));
 return {...complete,directory:root,sourceDirectory:selected.result.source_directory,archiveReceipt:archive.receipt};
}
const HELP='Ordinary ZIP application source\n\n'+
 'collect --archive ZIP --sha256 SHA --member-root ROOT_OR_DOT --selection JSON --directory PRIVATE_OPERATION --output FILE [--gzip]\n'+
 'inspect --input FILE --directory PRIVATE_RECEIVING\n'+
 'receive --input FILE --directory SAME_PRIVATE_RECEIVING\n'+
 'All commands require --python ABSOLUTE_PYTHON; --node ABSOLUTE_NODE defaults to this Node.\n'+
 'No application execution, dependency installation, network request, source rewrite or archive regeneration.\n';
function argumentsFor(argv){
 const command=argv.shift();if(!command||command==='help'||command==='--help')return{command:'help'};
 const allowed={collect:['archive','sha256','member-root','selection','directory','output','gzip','python','node'],
  inspect:['input','directory','python','node'],receive:['input','directory','python','node']}[command];
 need(allowed,'Choose collect, inspect or receive');const args={command};
 while(argv.length){const flag=argv.shift(),key=flag?.slice(2);need(flag?.startsWith('--')&&allowed.includes(key)&&!Object.hasOwn(args,key),'Unknown or repeated option');
  if(key==='gzip')args[key]=true;else{const value=argv.shift();need(value&&!value.startsWith('--'),'Supply the complete option value');args[key]=value;}}
 const required=command==='collect'?['archive','sha256','member-root','selection','directory','output','python']:['input','directory','python'];
 for(const key of required)need(args[key],'Missing --'+key);
 if(args.sha256){args.expectedSha256=args.sha256;delete args.sha256;}if(args['member-root']){args.memberRoot=args['member-root'];delete args['member-root'];}
 return args;
}
async function main(argv=process.argv.slice(2)){
 const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{
  const args=argumentsFor([...argv]);if(args.command==='help'){process.stdout.write(HELP);return 0;}
  const result=await({collect,inspect,receive}[args.command])({...args,signal:controller.signal});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result.status==='INCOMPLETE'?2:0;
 }catch(error){process.stderr.write(JSON.stringify({status:'ERROR',code:error.code||error.name,message:String(error.message||error),detail:error.detail},null,2)+'\n');return 1;}
 finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
module.exports={collect,inspect,receive,inspectBinding,identify,argumentsFor,main};
if(require.main===module)main().then(code=>{process.exitCode=code;});
