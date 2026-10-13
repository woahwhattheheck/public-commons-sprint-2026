'use strict';
// Complete selected source, not a new sender. Runtime tools and mailbox values
// are supplied by the already connected original operator.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function loadConnectedContactProduct({configuration,tools,sourceDirectory=__dirname}={}){
 if(!configuration||configuration.schema!=='commons.connected-contact-private-configuration/v1'||
    !Array.isArray(configuration.mailboxes)||configuration.mailboxes.length!==2)
  throw Error('Select the original private coordinator and mailbox configuration.');
 const rawDirectory=path.resolve(sourceDirectory),rootStat=fs.lstatSync(rawDirectory);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||fs.realpathSync(rawDirectory)!==rawDirectory)
  throw Error('Use the complete selected source in its original real, immutable checkout directory.');
 sourceDirectory=rawDirectory;
 const mailboxes=configuration.mailboxes.map((row,index)=>{
  if(!row||row.name!==['business','secondary'][index]||typeof row.link_id!=='string'||!row.link_id||
     /[\x00-\x1f\x7f]/.test(row.link_id)||typeof row.id!=='string'||!/^\d+$/.test(row.id)||
     typeof row.email!=='string'||!/^[^@\s]+@[^@\s]+$/.test(row.email))
   throw Error('Keep the complete ordered original business and secondary mailbox identities.');
  return Object.freeze({...row});
 });
 for(const key of ['link_id','id','email']){
  const values=mailboxes.map(row=>key==='email'?row[key].toLowerCase():row[key]);
  if(new Set(values).size!==2)throw Error('The original configured mailboxes must retain distinct identities.');
 }
 const authority=configuration.authority;
 if(!authority||typeof authority.scope_id!=='string'||!authority.scope_id||
    !Array.isArray(authority.accounts)||!authority.accounts.length)
  throw Error('Select the original nonempty shared coordinator account authority.');
 const accountKeys=new Set();
 for(const account of authority.accounts){
  if(!account||typeof account.profile_id!=='string'||!/^\d+$/.test(account.profile_id)||
     typeof account.account_key!=='string'||!/^[a-f0-9]{64}$/.test(account.account_key)||
     accountKeys.has(account.account_key))
   throw Error('Every selected authority account needs its unique original account key and profile.');
  const mailbox=mailboxes.find(row=>row.id===account.profile_id);
  const expected=mailbox&&crypto.createHash('sha256').update(JSON.stringify({
    provider:'gmail',profile_id:mailbox.id,activity:'Mail sending'}),'utf8').digest('hex');
  if(!mailbox||account.account_key!==expected)
   throw Error('A selected authority account does not match its configured original Gmail identity.');
  accountKeys.add(account.account_key);
 }
 // One configured pair may use a deliberately selected single-account scope.
 // Every selected authority member is checked; unselected accounts are not added.
 const retainedAuthority=JSON.parse(JSON.stringify(authority));
 const manifestPath=path.join(sourceDirectory,'SOURCE_MANIFEST.json'),manifestStat=fs.lstatSync(manifestPath);
 if(!manifestStat.isFile()||manifestStat.isSymbolicLink())throw Error('Use the complete regular original source manifest.');
 const manifestBytes=fs.readFileSync(manifestPath);
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(manifestBytes));
 if(manifest.schema!=='commons.connected-contact-source-manifest/v1'||!Array.isArray(manifest.files))
  throw Error('Complete original source manifest required.');
 const sources={};
 for(const row of manifest.files){
  if(!row||typeof row.path!=='string'||row.path.startsWith('/')||row.path.split('/').some(x=>!x||x==='.'||x==='..')||sources[row.path]!==undefined)
   throw Error('Source manifest contains an invalid or repeated path.');
  const file=path.join(sourceDirectory,row.path),st=fs.lstatSync(file);
  if(fs.realpathSync(file)!==file)throw Error('Selected source paths must not traverse symlinked directories.');
  if(!st.isFile()||st.isSymbolicLink())throw Error('Use the selected complete regular source files.');
  const bytes=fs.readFileSync(file);
  if(bytes.length!==row.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==row.sha256)
   throw Error('Selected source bytes changed: '+row.path);
  sources[row.path]=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 }
 const required=['host/connected_first_contact.cjs','host/connected_first_contact_checkpoint.cjs',
  'host/connected_contact_local_state.py','host/connected_contact_file_state.cjs',
  'host/connected_contact_local_adoption.cjs','host/connected_first_contact_queue_drain.cjs'];
 for(const name of required)if(typeof sources[name]!=='string')throw Error('Complete source required: '+name);
 // A source directory is one immutable edition for the lifetime of this process.
 // Never clear Node's cache and silently replace modules inside a live controller.
 const custodyKey=Symbol.for('commons.connected-contact-source-custody/v1');
 const registry=globalThis[custodyKey]||(globalThis[custodyKey]=new Map());
 if(!(registry instanceof Map))throw Error('Original source custody registry changed.');
 const manifestSha=crypto.createHash('sha256').update(manifestBytes).digest('hex');
 let custody=registry.get(sourceDirectory);
 if(custody&&custody.manifestSha!==manifestSha)
  throw Error('This source directory already names a different loaded edition. Select a separate complete immutable checkout.');
 if(!custody){custody={manifestSha,modules:new Map()};registry.set(sourceDirectory,custody);}
 function selectedModule(relative){
  if(typeof sources[relative]!=='string')throw Error('Complete source required: '+relative);
  const filename=path.join(sourceDirectory,relative),resolved=require.resolve(filename);
  if(resolved!==filename)throw Error('Selected module resolved outside its original source identity.');
  const selectedSha=crypto.createHash('sha256').update(sources[relative],'utf8').digest('hex');
  const cached=require.cache[resolved],retained=custody.modules.get(resolved);
  if(cached&&(!retained||retained.module!==cached||retained.sha256!==selectedSha))
   throw Error('An already-loaded module is not the retained selected source. Reuse its original verified product or select a fresh immutable checkout.');
  if(retained&&!cached)throw Error('An original selected module was removed from the live module cache.');
  if(cached)return cached.exports;
  const value=require(resolved),loaded=require.cache[resolved];
  const current=fs.readFileSync(resolved);
  if(!loaded||crypto.createHash('sha256').update(current).digest('hex')!==selectedSha)
   throw Error('Selected source changed during module loading.');
  custody.modules.set(resolved,{module:loaded,sha256:selectedSha});
  return value;
 }
 const factory=selectedModule('host/connected_first_contact.cjs');
 const keys={hash:'host/connected_sha256.cjs',intent:'host/revenue_outbound_intent.cjs',gateway:'host/first_contact_gateway.cjs',mailboxAdmission:'host/connected_mailbox_admission.cjs',publicationPolicy:'commons-publication-policy.cjs',attachments:'host/connected_contact_attachments.cjs',deliveryCorrection:'host/contact_delivery_correction.cjs',content:'host/first_contact_content.cjs',deliveryNotices:'host/connected_delivery_notices.cjs'};
 const selected=Object.fromEntries(Object.entries(keys).map(([key,name])=>[key,sources[name]]));
 const modules=Object.freeze({...factory.loadOriginalContactModules({...selected,deliveryNoticeSources:sources}),
  mailboxes:Object.freeze(mailboxes)});
 const state=selectedModule('host/connected_contact_file_state.cjs');
 const settings={directory:configuration.directory,coordinatorId:configuration.coordinatorId,authority:retainedAuthority,
  ...(configuration.python?{python:configuration.python}:{}),source:path.join(sourceDirectory,'host/connected_contact_local_state.py')};
 const storage=state.createContactFileState(settings);
 const checkpoint=selectedModule('host/connected_first_contact_checkpoint.cjs');
 const adoption=selectedModule('host/connected_contact_local_adoption.cjs');
 const queue=selectedModule('host/connected_first_contact_queue_drain.cjs');
 const checkTools=()=>{if(!tools||typeof tools!=='object')throw Error('Supply the existing connected operator tool bindings.');};
 async function readOriginal(operationKey){return checkpoint.readConnectedContactCheckpoint({storage,operationKey,sha256Utf8:modules.sha256Utf8});}
 async function openOriginal(operationKey,options={}){
  checkTools();const received=await readOriginal(operationKey);
  return checkpoint.openConnectedContactCheckpoint({...options,tools,storage,factory,modules,
   input:received.payload.runtime_input,lease:received.metadata.operation_lease,stateKey:received.metadata.state_key,mode:'reopen'});
 }
 return Object.freeze({factory,modules,checkpoint,adoption,storage,manifest,sources,
  initialize:()=>state.initializeContactCoordinator(settings),readOriginal,openOriginal,
  createDrain:options=>{checkTools();return queue.createNativeConnectedFirstContactDrain({...options,tools,storage,carrier:factory,checkpoints:checkpoint,modules});}});
}
module.exports={loadConnectedContactProduct};
