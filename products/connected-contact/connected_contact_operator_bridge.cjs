'use strict';
// Additive --operator module for the maintained connected-contact CLI.
// No listener, scheduler, state store, provider emulation or send binding.
const SCHEMA='commons.connected-contact-tool-bridge/v1';
const PREFIX='COMMONS_CONTACT_TOOL_BRIDGE_V1 ';
const MAX_REQUEST=16384,MAX_RESPONSE=256*1024*1024,CHUNK=49152;
const READ_NAMES=Object.freeze([
 'mcp__codex_apps__github_get_repo','mcp__codex_apps__github_fetch',
 'mcp__codex_apps__github_fetch_commit','mcp__codex_apps__github_fetch_file',
 'mcp__codex_apps__github_fetch_blob','mcp__codex_apps__github_compare_commits',
 'mcp__codex_apps__github_get_user_login'
]);
const DENIED_NAMES=Object.freeze([
 'mcp__codex_apps__github_get_profile',
 'mcp__codex_apps__gmail_get_profile','mcp__codex_apps__gmail_search_email_ids',
 'mcp__codex_apps__gmail_search_emails','mcp__codex_apps__gmail_read_email',
 'mcp__codex_apps__gmail_read_email_thread','mcp__codex_apps__gmail_list_drafts',
 'mcp__codex_apps__github_create_branch','mcp__codex_apps__github_create_file',
 'mcp__codex_apps__github_update_file','mcp__codex_apps__gmail_send_email',
 'mcp__codex_apps__gmail_send_draft','mcp__codex_apps__gmail_create_draft'
]);
function need(ok,message){if(!ok)throw Object.assign(new Error(message),{code:'CONTACT_BRIDGE_SELECTION'});}
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function validateConfiguration(c){
 need(plain(c)&&c.schema===SCHEMA&&c.mode==='prepare-read-only','Use the exact read-only preparation bridge configuration.');
 need(typeof c.operation_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(c.operation_id),'Retain the original preparation operation ID.');
 need(typeof c.session_id==='string'&&/^[a-f0-9]{64}$/.test(c.session_id),'Select one original foreground invocation identity.');
 for(const k of ['source_directory','journal_directory','node_executable'])
  need(typeof c[k]==='string'&&c[k].startsWith('/')&&!/[\x00-\x1f\x7f]/.test(c[k]),'Select complete absolute Linux paths.');
 need(Array.isArray(c.argv)&&c.argv[0]==='prepare'&&c.argv.every(x=>typeof x==='string'&&!/[\x00-\x1f\x7f]/.test(x)),'Only the existing prepare CLI route is supported.');
 const args={};for(let i=1;i<c.argv.length;i+=2){need(i+1<c.argv.length&&/^--[a-z-]+$/.test(c.argv[i])&&args[c.argv[i]]===undefined,'Keep exact unique named prepare arguments.');args[c.argv[i]]=c.argv[i+1];}
 const allowed=['--config','--operator','--selection','--request','--journal','--result'];
 need(Object.keys(args).every(k=>allowed.includes(k))&&['--config','--operator','--selection','--request','--journal'].every(k=>args[k]),'Keep the complete original preparation argument selection.');
 for(const file of Object.values(args))need(file.startsWith('/')&&!file.split('/').some(x=>x==='.'||x==='..'),'Use original absolute paths without relative traversal.');
 need(args['--journal']===c.journal_directory,'Use the same original private receiving journal directory.');
 need(args['--operator']===c.source_directory+'/connected_contact_operator_bridge.cjs','Select this exact adapter inside the complete source edition.');
 need(Array.isArray(c.pins)&&c.pins.length>=4&&c.pins.length<=16,'Pin the complete private configuration, selection and source manifest.');
 const seen=new Set();for(const row of c.pins){need(plain(row)&&typeof row.path==='string'&&row.path.startsWith('/')&&!seen.has(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=MAX_RESPONSE&&/^[a-f0-9]{64}$/.test(row.sha256),'Keep unique exact original input pins.');seen.add(row.path);}
 for(const file of [args['--config'],args['--selection'],c.source_directory+'/SOURCE_MANIFEST.json',c.node_executable])need(seen.has(file),'A required original input pin is missing.');
 need(plain(c.policy)&&Array.isArray(c.policy.repositories)&&Array.isArray(c.policy.gmail_link_ids),'Select original repository and mailbox read scopes.');
 need(c.policy.repositories.length>0&&c.policy.repositories.every(x=>typeof x==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(x)&&!x.split('/').some(v=>v==='.'||v==='..')),'Use exact original source repositories.');
 need(c.policy.gmail_link_ids.every(x=>typeof x==='string'&&/^link_[A-Za-z0-9_-]+$/.test(x)),'Use exact configured mailbox links.');
 need(new Set(c.policy.repositories).size===c.policy.repositories.length&&new Set(c.policy.gmail_link_ids).size===c.policy.gmail_link_ids.length,'Read scope cannot contain duplicate identities.');
 need(Number.isSafeInteger(c.max_calls)&&c.max_calls>=1&&c.max_calls<=10000,'Select the complete preparation call bound.');
 return args;
}
function validateRead(name,args,c){
 need(READ_NAMES.includes(name)&&plain(args),'This preparation adapter admits only the seven named original Git read tools.');
 const required={
  mcp__codex_apps__github_get_repo:['repository_full_name'],
  mcp__codex_apps__github_fetch:['url'],
  mcp__codex_apps__github_fetch_commit:['repo_full_name','commit_sha'],
  mcp__codex_apps__github_fetch_file:['repository_full_name','path','ref'],
  mcp__codex_apps__github_fetch_blob:['repository_full_name','blob_sha'],
  mcp__codex_apps__github_compare_commits:['repo_full_name','base','head'],
  mcp__codex_apps__github_get_user_login:[]
 }[name];
 const optional=name==='mcp__codex_apps__github_fetch_file'?['encoding']:[];
 need(required.every(k=>typeof args[k]==='string'&&args[k].length>0&&!/[\x00-\x1f\x7f]/.test(args[k]))&&Object.keys(args).every(k=>required.includes(k)||optional.includes(k)),'Keep the complete original read-tool argument shape; no ranges, overrides or unknown fields.');
 if(name==='mcp__codex_apps__github_get_user_login')return true;
 if(name==='mcp__codex_apps__github_fetch'){
  const m=/^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/git\/ref\/heads\/([^?#]+)$/.exec(args.url);
  need(m&&c.policy.repositories.includes(m[1])&&!m[2].split('/').some(x=>x==='.'||x==='..')&&!/%(?:2e|2f|5c)/i.test(m[2]),'Only the selected original repository branch-ref GET is admitted.');
 }else{
  need(c.policy.repositories.includes(args.repository_full_name??args.repo_full_name),'The read names another original source repository.');
  if(name==='mcp__codex_apps__github_fetch_blob')need(/^[a-f0-9]{40}$/.test(args.blob_sha),'Use an exact original blob SHA.');
  if(name==='mcp__codex_apps__github_fetch_file'){
   need(/^[a-f0-9]{40}$/.test(args.ref)&&!args.path.startsWith('/')&&!args.path.includes('\\')&&!args.path.split('/').some(x=>!x||x==='.'||x==='..'),'Read the complete original file at its retained exact commit.');
   need(args.encoding===undefined||args.encoding==='utf-8'||args.encoding==='base64','Preserve the complete original file encoding.');
  }
  if(name==='mcp__codex_apps__github_fetch_commit')need(/^[a-f0-9]{40}$/.test(args.commit_sha)||/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(args.commit_sha)&&!args.commit_sha.split('/').some(x=>x==='.'||x==='..'),'Use the original commit or selected full branch ref.');
 }
 return true;
}
function createNodeBridge(){
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline'),os=require('node:os');
 need(process.platform==='linux','Use the selected Linux/WSL Linux coordinator environment.');
 const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
 function selectedPath(file,kind,mode,owned=true){
  need(path.isAbsolute(file)&&path.resolve(file)===file&&fs.realpathSync(file)===file,'Use a real original path without symlink traversal.');
  const st=fs.lstatSync(file);
  need(!st.isSymbolicLink()&&(kind==='directory'?st.isDirectory():st.isFile())&&(!owned||st.uid===process.getuid())&&(mode==null||(st.mode&0o777)===mode),'Use the original operator-owned private file or directory.');
  if(kind==='file'&&owned)need(st.nlink===1,'Private selections must retain one regular-file link.');
  return st;
 }
 const configPath=process.env.COMMONS_CONTACT_BRIDGE_CONFIG;
 need(typeof configPath==='string','Select the original private bridge configuration path.');
 const cs=selectedPath(configPath,'file',0o600);need(cs.size<=1024*1024,'Bridge configuration is oversized.');
 const configBytes=fs.readFileSync(configPath),config=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(configBytes));
 const args=validateConfiguration(config);
 selectedPath(config.source_directory,'directory');selectedPath(config.journal_directory,'directory',0o700);
 need(fs.realpathSync(__filename)===config.source_directory+'/connected_contact_operator_bridge.cjs','The adapter source selection changed.');
 need(fs.realpathSync(process.execPath)===fs.realpathSync(config.node_executable),'The selected Node runtime changed.');
 need(fs.realpathSync(process.argv[1])===config.source_directory+'/connected_contact_operator.cjs'&&JSON.stringify(process.argv.slice(2))===JSON.stringify(config.argv),'Use the exact original CLI preparation invocation.');
 function verifyPins(){
  need(digest(fs.readFileSync(configPath))===digest(configBytes),'The original private bridge configuration changed.');
  for(const row of config.pins){const runtime=row.path===config.node_executable,st=selectedPath(row.path,'file',runtime||row.path.startsWith(config.source_directory+'/')?null:0o600,!runtime);need(st.size===row.bytes&&digest(fs.readFileSync(row.path))===row.sha256,'A pinned original input changed: '+path.basename(row.path));}
 }
 verifyPins();
 const selection=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(args['--selection'])));
 need(selection.operation_id===config.operation_id,'The original preparation selection names a different operation.');
 need(!fs.existsSync(args['--request']),'The prepared output already exists; receive that exact original file instead of replaying preparation.');
 const root=path.join(config.journal_directory,config.session_id);fs.mkdirSync(root,{mode:0o700});
 function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function publish(file,bytes){const target=path.join(root,file),fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(root);}
 publish('SESSION.json',configBytes);syncDir(config.journal_directory);
 let sequence=0,pending=null,queue=Promise.resolve(),failed=false,readlineClosed=false;
 const completed=[];const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 if(typeof process.stdin.unref==='function')process.stdin.unref();
 function send(value){process.stdout.write(PREFIX+JSON.stringify(value)+'\n');}
 function fatal(message){
  if(failed)return;failed=true;
  try{publish('UNRESOLVED.json',Buffer.from(JSON.stringify({schema:SCHEMA,session_id:config.session_id,operation_id:config.operation_id,message,sequence,call_id:pending?.call_id||null})+'\n'));}catch{}
  if(pending){if(pending.fd!==undefined)try{fs.closeSync(pending.fd);}catch{};pending.reject(Object.assign(new Error(message),{code:'CONTACT_BRIDGE_OUTCOME_UNRESOLVED'}));pending=null;}
  process.exitCode=1;input.close();if(typeof process.stdin.unref==='function')process.stdin.unref();
 }
 function frame(row){
  if(plain(row)&&row.kind==='finish'){
   need(row.schema===SCHEMA&&row.session_id===config.session_id&&row.operation_id===config.operation_id&&!pending&&!failed,'Only the original completed preparation may close this owned input.');
   need(plain(row.application)&&row.application.status==='COMPLETE'&&row.application.action==='prepare'&&row.application.request_saved===true,'The original CLI completion is missing.');
   const privateConfiguration=JSON.parse(fs.readFileSync(args['--config'],'utf8'));
   need(row.application.coordinator_id===privateConfiguration.coordinatorId&&fs.existsSync(args['--request']),'The CLI completion names another coordinator or missing prepared request.');
   input.close();if(typeof process.stdin.unref==='function')process.stdin.unref();return;
  }
  need(plain(row)&&row.schema===SCHEMA&&row.session_id===config.session_id&&pending&&row.call_id===pending.call_id,'A bridge response belongs to another original call.');
  if(row.kind==='response-start'){
   need(pending.fd===undefined&&Number.isSafeInteger(row.bytes)&&row.bytes>=2&&row.bytes<=MAX_RESPONSE&&/^[a-f0-9]{64}$/.test(row.sha256),'Original full response identity required.');
   pending.size=row.bytes;pending.sha256=row.sha256;pending.received=0;pending.index=0;pending.hash=crypto.createHash('sha256');
   pending.temp=path.join(root,pending.stem+'.response.incoming');pending.fd=fs.openSync(pending.temp,'wx',0o600);
   send({schema:SCHEMA,kind:'response-progress',session_id:config.session_id,call_id:pending.call_id,next_index:0,bytes:0});return;
  }
  if(row.kind==='response-chunk'){
   need(pending.fd!==undefined&&row.index===pending.index&&typeof row.base64==='string'&&row.base64.length<=Math.ceil(CHUNK/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.base64),'Receive each complete response chunk once in original order.');
   const bytes=Buffer.from(row.base64,'base64');need(bytes.toString('base64')===row.base64&&bytes.length>0&&pending.received+bytes.length<=pending.size,'Original response bytes changed.');
   fs.writeFileSync(pending.fd,bytes);pending.hash.update(bytes);pending.received+=bytes.length;pending.index++;
   send({schema:SCHEMA,kind:'response-progress',session_id:config.session_id,call_id:pending.call_id,next_index:pending.index,bytes:pending.received});return;
  }
  need(row.kind==='response-end'&&pending.fd!==undefined&&pending.received===pending.size&&pending.hash.digest('hex')===pending.sha256,'Complete original response is missing or changed.');
  fs.fsyncSync(pending.fd);fs.closeSync(pending.fd);pending.fd=undefined;
  const raw=fs.readFileSync(pending.temp),value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));
  need(value.schema===SCHEMA&&value.session_id===config.session_id&&value.call_id===pending.call_id&&['returned','threw'].includes(value.kind),'Retain the complete actual tool outcome.');
  const final=path.join(root,pending.stem+'.response.json');fs.linkSync(pending.temp,final);fs.unlinkSync(pending.temp);syncDir(root);
  const current=pending;pending=null;completed.push({sequence:current.sequence,call_id:current.call_id,binding:current.binding,request_sha256:current.request_sha256,response_sha256:digest(raw),response_bytes:raw.length,outcome:value.kind});
  if(typeof process.stdin.unref==='function')process.stdin.unref();
  send({schema:SCHEMA,kind:'received',session_id:config.session_id,call_id:current.call_id,response_sha256:digest(raw)});
  if(value.kind==='returned')current.resolve(value.value);
  else{need(plain(value.error)&&typeof value.error.message==='string','Original tool exception is incomplete.');const error=new Error(value.error.message);for(const [key,v]of Object.entries(value.error))if(!['__proto__','constructor','prototype'].includes(key))error[key]=v;current.reject(error);}
 }
 input.on('line',line=>{try{need(line.startsWith(PREFIX),'Unexpected text on the private bridge input.');frame(JSON.parse(line.slice(PREFIX.length)));}catch{fatal('The original connected-tool response was incomplete or changed.');}});
 input.on('close',()=>{readlineClosed=true;if(pending&&!failed)fatal('Original tool stream ended before its complete response; do not replay the provider call.');});
 input.on('error',()=>fatal('Original tool stream failed; retain the same operation and source journal.'));
 function invoke(binding,args){
  const work=queue.then(()=>new Promise((resolve,reject)=>{
   try{
    need(!failed&&!readlineClosed&&!pending,'The original tool bridge is not available.');validateRead(binding,args,config);
    need(++sequence<=config.max_calls,'The selected preparation call bound was reached.');
    const selected={schema:SCHEMA,operation_id:config.operation_id,session_id:config.session_id,sequence,binding,args};
    const body=Buffer.from(JSON.stringify(selected),'utf8');need(body.length<=MAX_REQUEST,'Original read arguments exceed the complete bridge request bound.');
    const request_sha256=digest(body),call_id=request_sha256,stem=String(sequence).padStart(6,'0');
    publish(stem+'.request.json',body);pending={resolve,reject,sequence,binding,request_sha256,call_id,stem};
    if(typeof process.stdin.ref==='function')process.stdin.ref();
    send({schema:SCHEMA,kind:'call',session_id:config.session_id,call_id,bytes:body.length,sha256:request_sha256,base64:body.toString('base64')});
   }catch(error){reject(error);}
  }));queue=work.catch(()=>{});return work;
 }
 const bound=Object.fromEntries(READ_NAMES.map(name=>[name,args=>invoke(name,args)]));
 for(const name of DENIED_NAMES)bound[name]=async()=>{throw Object.assign(new Error('This original preparation bridge has no Gmail or provider-write capability.'),{code:'CONTACT_BRIDGE_READ_ONLY'});};
 send({schema:SCHEMA,kind:'hello',session_id:config.session_id,operation_id:config.operation_id,configuration_sha256:digest(configBytes),source_directory:config.source_directory,host:os.hostname(),pid:process.pid});
 process.once('beforeExit',()=>{
  if(failed||pending)return;
  try{
   verifyPins();
   const result={schema:SCHEMA,session_id:config.session_id,operation_id:config.operation_id,configuration_sha256:digest(configBytes),calls:completed,exit_code:process.exitCode||0,provider_write_invocations:0};
   publish('COMPLETE.json',Buffer.from(JSON.stringify(result,null,2)+'\n'));
   send({schema:SCHEMA,kind:'complete',session_id:config.session_id,operation_id:config.operation_id,calls:completed.length,exit_code:result.exit_code,provider_write_invocations:0});
  }catch{process.exitCode=1;fatal('The final original preparation source or bridge journal could not be verified.');}
 });
 return Object.freeze(bound);
}
let instance;
module.exports={SCHEMA,PREFIX,MAX_REQUEST,MAX_RESPONSE,CHUNK,READ_NAMES,DENIED_NAMES,validateConfiguration,validateRead,
 get tools(){return instance||(instance=createNodeBridge());}};
