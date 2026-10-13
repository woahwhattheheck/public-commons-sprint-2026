'use strict';
// Additive --operator module for the maintained connected-contact CLI.
// No listener, scheduler, state store or provider emulation. Operational mode
// continues one source-selected contact through its existing local coordinator.
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

const CONTINUATION_SCHEMA='commons.connected-contact-continuation/v1';
const MAX_OPERATION_REQUEST=96*1024*1024;
const RELATIONSHIP_BINDING='commons.contact.review_relationship';
const GMAIL_NAMES=Object.freeze(['mcp__codex_apps__gmail_get_profile','mcp__codex_apps__gmail_search_email_ids','mcp__codex_apps__gmail_read_email','mcp__codex_apps__gmail_batch_read_email','mcp__codex_apps__gmail_list_drafts','mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft']);
const SEND_NAMES=Object.freeze(['mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft']);
const CONTINUATION_METHODS=Object.freeze(['run','resumeRecipient','resumeRateLimited','resumeConsole','accountStatus','reconcile','receiveSent','receiveCompletedDraft','receiveDeliveryNotice','reconcileAccountAdmission']);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
function validateContinuation(s,c){
 need(plain(s)&&s.schema===CONTINUATION_SCHEMA&&s.operation_id===c.operation_id,'Select one complete original contact continuation.');
 for(const key of ['operation_key','input_sha256'])need(/^[a-f0-9]{64}$/.test(s[key]),'Retain the original contact and input identities.');
 for(const key of ['operation_lease','state_key','owner'])need(typeof s[key]==='string'&&s[key].length>0&&(key!=='owner'||s[key].length<=240)&&!/[\x00-\x1f\x7f]/.test(s[key]),'Retain the original lease, state key and owner.');
 need(typeof s.coordinator_id==='string'&&/^[a-f0-9-]{36}$/.test(s.coordinator_id)&&plain(s.authority),'Select the actual deployed original coordinator and authority.');
 need(Array.isArray(s.mailboxes)&&s.mailboxes.length===2&&s.mailboxes.every((m,i)=>plain(m)&&m.name===['business','secondary'][i]&&typeof m.link_id==='string'&&/^\d+$/.test(m.id)&&typeof m.email==='string'&&/^[^@\s]+@[^@\s]+$/.test(m.email)),'Retain both original configured mailbox identities.');
 for(const key of ['link_id','id','email'])need(new Set(s.mailboxes.map(m=>m[key])).size===2,'Original mailboxes must remain distinct.');
 need(canonical(s.mailboxes.map(m=>m.link_id).sort())===canonical(c.policy.gmail_link_ids.slice().sort()),'Foreground mailbox scope differs from the selected original pair.');
 need(plain(s.runtime_input)&&s.mailboxes.some(m=>m.link_id===s.runtime_input.link_id),'Keep the complete original runtime input and its sender.');
 need(plain(s.continuation)&&CONTINUATION_METHODS.includes(s.continuation.method)&&Array.isArray(s.continuation.args),'Select one original checkpoint method and complete original arguments.');
 const method=s.continuation.method,a=s.continuation.args;
 if(['reconcile','receiveSent','receiveCompletedDraft','receiveDeliveryNotice'].includes(method))need(a.length===1&&typeof a[0]==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(a[0]),'Select the actual original provider message ID.');
 else if(method==='resumeConsole')need(a.length===1&&plain(a[0]),'Retain the exact original console handoff.');
 else need(a.length===0,'This original continuation takes no new mutation arguments.');
 need(plain(s.organization)&&typeof s.organization.query==='string'&&s.organization.query.trim()&&s.organization.query.length<=16384&&Array.isArray(s.organization.domains)&&s.organization.domains.length>0&&s.organization.domains.every(x=>typeof x==='string'&&/^[a-z0-9.-]+$/i.test(x)),'Retain the actual organization-wide query and original reviewed domains.');
 need(SEND_NAMES.includes(s.native_binding)&&plain(s.native_arguments)&&s.native_arguments.link_id===s.runtime_input.link_id,'Retain the exact selected native message or draft arguments.');
 if(s.runtime_input.native_draft)need(s.native_binding==='mcp__codex_apps__gmail_send_draft'&&s.native_arguments.draft_id===s.runtime_input.native_draft.draft_id,'Keep the actual original draft identity.');
 else need(s.native_binding==='mcp__codex_apps__gmail_send_email'&&s.native_arguments.to===s.runtime_input.to.trim().toLowerCase()&&s.native_arguments.subject===s.runtime_input.subject&&plain(s.native_arguments.payload),'Keep the complete exact native MIME envelope.');
 return s;
}
function validateCall(name,args,c,s){
 if(c.mode==='prepare-read-only')return validateRead(name,args,c);
 need(c.mode==='continue-original'&&plain(args)&&s,'Use the selected original-contact continuation.');
 if(name==='mcp__codex_apps__github_fetch_file'){
  const files=c.policy.historical_files||[];
  need(files.some(f=>f.repository_full_name===args.repository_full_name&&f.path===args.path&&f.ref===args.ref),'Read only an explicitly selected original historical file at its immutable commit.');
  return validateRead(name,args,{policy:{repositories:[args.repository_full_name]}});
 }

 if(name===RELATIONSHIP_BINDING){
  need(Object.keys(args).length===3&&args.operation_key===s.operation_key&&args.input_sha256===s.input_sha256&&plain(args.spec),'Review this exact original company operation.');
  for(const key of ['prospect_org','opportunity_id','touchpoint','subject','body','link_id'])need(args.spec[key]===s.runtime_input[key],'The original relationship specification changed.');
  need(args.spec.to===s.runtime_input.to.trim().toLowerCase(),'The relationship review names a different recipient.');return true;
 }
 need(GMAIL_NAMES.includes(name)&&s.mailboxes.some(m=>m.link_id===args.link_id),'Only original configured Gmail reads and the selected exact send are supported.');
 if(SEND_NAMES.includes(name)){need(['run','resumeRecipient','resumeRateLimited','resumeConsole'].includes(s.continuation.method)&&name===s.native_binding&&canonical(args)===canonical(s.native_arguments),'The native invocation differs from the complete selected message and attachments.');return true;}
 const action=name.replace('mcp__codex_apps__','');
 const required={gmail_get_profile:['link_id'],gmail_search_email_ids:['link_id'],gmail_read_email:['link_id','message_id'],gmail_batch_read_email:['link_id','message_ids'],gmail_list_drafts:['link_id']}[action];
 const optional={gmail_get_profile:[],gmail_search_email_ids:['query','max_results','next_page_token','label_ids'],gmail_read_email:['format'],gmail_batch_read_email:[],gmail_list_drafts:['max_results','next_page_token']}[action];
 need(required.every(k=>Object.prototype.hasOwnProperty.call(args,k))&&Object.keys(args).every(k=>required.includes(k)||optional.includes(k)),'Original Gmail read arguments contain unknown fields.');
 if(args.message_id!==undefined)need(typeof args.message_id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(args.message_id),'Select an actual original Gmail message.');
 if(args.message_ids!==undefined)need(Array.isArray(args.message_ids)&&args.message_ids.length>0&&args.message_ids.length<=100&&args.message_ids.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(x)),'Retain every selected Gmail message ID within the native bound.');
 if(args.format!==undefined)need(args.format==='full'||args.format==='raw','Read the complete original message.');
 if(args.max_results!==undefined)need(Number.isSafeInteger(args.max_results)&&args.max_results>=1&&args.max_results<=500,'Use the complete bounded original page.');
 if(args.next_page_token!==undefined)need(typeof args.next_page_token==='string'&&args.next_page_token.length>0&&args.next_page_token.length<=8192,'Retain the complete original cursor.');
 if(args.query!==undefined)need(typeof args.query==='string'&&args.query.length<=32768,'Retain the complete original query.');
 if(args.label_ids!==undefined&&args.label_ids!==null)need(Array.isArray(args.label_ids)&&args.label_ids.every(x=>typeof x==='string'&&x.length>0),'Use actual native label IDs.');
 return true;
}

function validateConfiguration(c){
 need(plain(c)&&c.schema===SCHEMA&&['prepare-read-only','continue-original'].includes(c.mode),'Select the exact preparation or original-contact bridge mode.');
 const operational=c.mode==='continue-original';
 need(typeof c.operation_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(c.operation_id),'Retain the original preparation operation ID.');
 need(typeof c.session_id==='string'&&/^[a-f0-9]{64}$/.test(c.session_id),'Select one original foreground invocation identity.');
 for(const k of ['source_directory','journal_directory','node_executable'])
  need(typeof c[k]==='string'&&c[k].startsWith('/')&&!/[\x00-\x1f\x7f]/.test(c[k]),'Select complete absolute Linux paths.');
 need(Array.isArray(c.argv)&&c.argv[0]===(operational?'continue':'prepare')&&c.argv.every(x=>typeof x==='string'&&!/[\x00-\x1f\x7f]/.test(x)),'Only the existing prepare CLI route is supported.');
 const args={};for(let i=1;i<c.argv.length;i+=2){need(i+1<c.argv.length&&/^--[a-z-]+$/.test(c.argv[i])&&args[c.argv[i]]===undefined,'Keep exact unique named prepare arguments.');args[c.argv[i]]=c.argv[i+1];}
 const allowed=operational?['--config','--operator','--selection','--journal','--result']:['--config','--operator','--selection','--request','--journal','--result'];
 const required=operational?['--config','--operator','--selection','--journal','--result']:['--config','--operator','--selection','--request','--journal'];
 need(Object.keys(args).every(k=>allowed.includes(k))&&required.every(k=>args[k]),'Keep the complete original preparation argument selection.');
 for(const file of Object.values(args))need(file.startsWith('/')&&!file.split('/').some(x=>x==='.'||x==='..'),'Use original absolute paths without relative traversal.');
 need(args['--journal']===c.journal_directory,'Use the same original private receiving journal directory.');
 need(args['--operator']===c.source_directory+'/connected_contact_operator_bridge.cjs','Select this exact adapter inside the complete source edition.');
 need(Array.isArray(c.pins)&&c.pins.length>=4&&c.pins.length<=16,'Pin the complete private configuration, selection and source manifest.');
 const seen=new Set();for(const row of c.pins){need(plain(row)&&typeof row.path==='string'&&row.path.startsWith('/')&&!seen.has(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=MAX_RESPONSE&&/^[a-f0-9]{64}$/.test(row.sha256),'Keep unique exact original input pins.');seen.add(row.path);}
 for(const file of [args['--config'],args['--selection'],c.source_directory+'/SOURCE_MANIFEST.json',c.node_executable])need(seen.has(file),'A required original input pin is missing.');
 need(plain(c.policy)&&Array.isArray(c.policy.repositories)&&Array.isArray(c.policy.gmail_link_ids),'Select original repository and mailbox read scopes.');
 need((operational?c.policy.repositories.length===0:c.policy.repositories.length>0)&&c.policy.repositories.every(x=>typeof x==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(x)&&!x.split('/').some(v=>v==='.'||v==='..')),'Use exact original source repositories.');
 if(operational){
  need(c.policy.historical_files===undefined||Array.isArray(c.policy.historical_files)&&c.policy.historical_files.length<=4096,'Select only the original immutable historical verification files.');
  const seenHistory=new Set();
  for(const f of c.policy.historical_files||[]){
   need(plain(f)&&Object.keys(f).length===3&&typeof f.repository_full_name==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(f.repository_full_name)&&typeof f.path==='string'&&!f.path.startsWith('/')&&!f.path.includes('\\')&&!f.path.split('/').some(x=>!x||x==='.'||x==='..')&&/^[a-f0-9]{40}$/.test(f.ref),'Preserve exact historical repository/path/commit tuples.');
   const key=canonical(f);need(!seenHistory.has(key),'Historical source identities must be unique.');seenHistory.add(key);
  }
 }
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
 if(config.mode==='prepare-read-only')need(!fs.existsSync(args['--request']),'The prepared output already exists; receive that exact original file instead of replaying preparation.');
 else validateContinuation(selection,config);
 const root=path.join(config.journal_directory,config.session_id);fs.mkdirSync(root,{mode:0o700});
 function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function publish(file,bytes){const target=path.join(root,file),fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(root);}
 publish('SESSION.json',configBytes);syncDir(config.journal_directory);
 let sequence=0,pending=null,queue=Promise.resolve(),failed=false,readlineClosed=false;
 let providerWriteInvocations=0;
 const REQUEST_CHUNK=8192;
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
  if(plain(row)&&row.kind==='request-next'){
   need(row.schema===SCHEMA&&row.session_id===config.session_id&&pending&&pending.large&&row.call_id===pending.call_id&&row.index===pending.request_index,'Continue only the exact retained large request in order.');
   if(pending.request_offset===pending.request_body.length){pending.large=false;send({schema:SCHEMA,kind:'call-end',session_id:config.session_id,call_id:pending.call_id,chunks:pending.request_index});return;}
   const bytes=pending.request_body.subarray(pending.request_offset,pending.request_offset+REQUEST_CHUNK);
   send({schema:SCHEMA,kind:'call-chunk',session_id:config.session_id,call_id:pending.call_id,index:pending.request_index,base64:bytes.toString('base64')});pending.request_offset+=bytes.length;pending.request_index++;return;
  }
  if(plain(row)&&row.kind==='finish'){
   need(row.schema===SCHEMA&&row.session_id===config.session_id&&row.operation_id===config.operation_id&&!pending&&!failed,'Only the original completed preparation may close this owned input.');
   need(plain(row.application)&&row.application.status==='COMPLETE'&&row.application.action===config.argv[0]&&(config.mode==='prepare-read-only'?row.application.request_saved===true:row.application.result_saved===true&&row.application.operation_key===selection.operation_key),'The original CLI completion is missing.');
   const privateConfiguration=JSON.parse(fs.readFileSync(args['--config'],'utf8'));
   need(row.application.coordinator_id===privateConfiguration.coordinatorId&&fs.existsSync(args[config.mode==='prepare-read-only'?'--request':'--result']),'The CLI completion names another coordinator or missing prepared request.');
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
    need(!failed&&!readlineClosed&&!pending,'The original tool bridge is not available.');validateCall(binding,args,config,selection);
    need(++sequence<=config.max_calls,'The selected preparation call bound was reached.');
    const selected={schema:SCHEMA,operation_id:config.operation_id,session_id:config.session_id,sequence,binding,args};
    const body=Buffer.from(JSON.stringify(selected),'utf8');need(body.length<=(config.mode==='continue-original'?MAX_OPERATION_REQUEST:MAX_REQUEST),'Original complete arguments exceed the selected bridge request bound.');
    if(SEND_NAMES.includes(binding))need(providerWriteInvocations===0,'This foreground continuation already emitted its one original send; reconcile its outcome.');
    const request_sha256=digest(body),call_id=request_sha256,stem=String(sequence).padStart(6,'0');
    publish(stem+'.request.json',body);
    if(SEND_NAMES.includes(binding))providerWriteInvocations++;
    pending={resolve,reject,sequence,binding,request_sha256,call_id,stem};
    if(typeof process.stdin.ref==='function')process.stdin.ref();
    if(body.length<=MAX_REQUEST)send({schema:SCHEMA,kind:'call',session_id:config.session_id,call_id,bytes:body.length,sha256:request_sha256,base64:body.toString('base64')});
    else{Object.assign(pending,{large:true,request_body:body,request_offset:0,request_index:0});send({schema:SCHEMA,kind:'call-start',session_id:config.session_id,call_id,bytes:body.length,sha256:request_sha256});}
   }catch(error){reject(error);}
  }));queue=work.catch(()=>{});return work;
 }
 const admitted=config.mode==='continue-original'?[...GMAIL_NAMES,RELATIONSHIP_BINDING,...(config.policy.historical_files?.length?['mcp__codex_apps__github_fetch_file']:[])]:READ_NAMES;
 const bound=Object.fromEntries(admitted.map(name=>[name,args=>invoke(name,args)]));
 for(const name of new Set([...READ_NAMES,...DENIED_NAMES,...GMAIL_NAMES]))if(!admitted.includes(name))bound[name]=async()=>{throw Object.assign(new Error('This selected bridge mode does not admit that provider action.'),{code:'CONTACT_BRIDGE_SCOPE'});};
 send({schema:SCHEMA,kind:'hello',session_id:config.session_id,operation_id:config.operation_id,configuration_sha256:digest(configBytes),source_directory:config.source_directory,host:os.hostname(),pid:process.pid});
 process.once('beforeExit',()=>{
  if(failed||pending)return;
  try{
   verifyPins();
   const result={schema:SCHEMA,session_id:config.session_id,operation_id:config.operation_id,configuration_sha256:digest(configBytes),calls:completed,exit_code:process.exitCode||0,provider_write_invocations:providerWriteInvocations};
   publish('COMPLETE.json',Buffer.from(JSON.stringify(result,null,2)+'\n'));
   send({schema:SCHEMA,kind:'complete',session_id:config.session_id,operation_id:config.operation_id,calls:completed.length,exit_code:result.exit_code,provider_write_invocations:providerWriteInvocations});
  }catch{process.exitCode=1;fatal('The final original preparation source or bridge journal could not be verified.');}
 });
 return Object.freeze(bound);
}
let instance;
module.exports={SCHEMA,PREFIX,MAX_REQUEST,MAX_RESPONSE,CHUNK,READ_NAMES,DENIED_NAMES,CONTINUATION_SCHEMA,MAX_OPERATION_REQUEST,RELATIONSHIP_BINDING,GMAIL_NAMES,SEND_NAMES,CONTINUATION_METHODS,canonical,validateContinuation,validateCall,validateConfiguration,validateRead,
 get tools(){return instance||(instance=createNodeBridge());}};
