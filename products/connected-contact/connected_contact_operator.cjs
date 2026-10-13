#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadConnectedContactProduct}=require('./connected_contact_product.cjs');
const MAX=256*1024*1024;
function privateText(file){
 const target=path.resolve(file),st=fs.lstatSync(target);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||typeof process.getuid==='function'&&st.uid!==process.getuid()||
    (st.mode&0o777)!==0o600||st.size>MAX)throw Error('Use an operator-owned mode 0600 regular private input.');
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(target));
}
function privateJSON(file){try{return JSON.parse(privateText(file));}catch{throw Error('A complete selected private JSON input is required.');}}
function savePrivate(file,value){
 const target=path.resolve(file),bytes=Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
 if(bytes.length>MAX)throw Error('Complete private result exceeds 256 MiB.');
 if(fs.existsSync(target)){if(privateText(target)!==bytes.toString('utf8'))throw Error('An existing private result differs.');return;}
 const pending=target+'.writing-'+crypto.randomUUID(),fd=fs.openSync(pending,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(pending,target);const dir=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 catch(error){if(error.code!=='EEXIST'||privateText(target)!==bytes.toString('utf8'))throw error;}
 finally{fs.unlinkSync(pending);}
}
async function main(argv=process.argv.slice(2)){
 const action=argv.shift(),args={};
 while(argv.length){const key=argv.shift();if(!/^--[a-z-]+$/.test(key)||!argv.length||args[key]!==undefined)throw Error('Use complete unique named arguments.');args[key]=argv.shift();}
 if(!['initialize','verify','prepare','receive','inspect'].includes(action)||!args['--config'])
  throw Error('Usage: node connected_contact_operator.cjs initialize|verify|prepare|receive|inspect --config PRIVATE.json [--operator EXISTING.cjs] [--selection PRIVATE.json] [--request PRIVATE.json] [--result PRIVATE.json] [--operation KEY] [--journal PRIVATE_DIRECTORY]');
 const configuration=privateJSON(args['--config']);let tools;
 if(args['--operator']){
  const selected=path.resolve(args['--operator']),st=fs.lstatSync(selected);
  if(!st.isFile()||st.isSymbolicLink())throw Error('Use the original reviewed connected operator module.');
  const operator=require(selected);tools=operator.tools;
  if(!tools||typeof tools!=='object')throw Error('The existing operator module must export its actual connected tools.');
 }
 const product=loadConnectedContactProduct({configuration,tools});
 const record=async event=>{
  if(!args['--journal'])throw Error('Use the original private receiving journal directory.');
  const dir=path.resolve(args['--journal']),st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o777)!==0o700||
     typeof process.getuid==='function'&&st.uid!==process.getuid())
   throw Error('Use the operator-owned mode 0700 receiving journal directory.');
  const bytes=JSON.stringify(event),id=crypto.createHash('sha256').update(bytes,'utf8').digest('hex');
  savePrivate(path.join(dir,id+'.json'),event);
 };
 if(['prepare','receive'].includes(action)&&!args['--journal'])throw Error('Prepare and receive require the same private --journal directory.');
 let result;
 if(action==='initialize')result=await product.initialize();
 if(action==='verify')result=await product.storage.verify();
 if(action==='prepare'){
  if(!tools||!args['--selection']||!args['--request'])throw Error('Prepare requires original tools, explicit private selection, and a retained request path.');
  const selected=privateJSON(args['--selection']);
  result=await product.adoption.prepareConnectedContactAdoption({tools,storage:product.storage,
   factory:product.factory,modules:{...product.modules,admission:product.modules.mailboxAdmission,checkpoint:product.checkpoint},
   sha256Utf8:product.modules.sha256Utf8,classifyReturnedGmailRateLimit:product.factory.classifyReturnedGmailRateLimit,
   classifyReturnedSendRateLimit:product.factory.classifyReturnedSendRateLimit,
   operationId:selected.operation_id,accounts:selected.accounts,contacts:selected.contacts,checkpoints:selected.checkpoints,originalJournals:selected.originalJournals,
   ownerHandoff:selected.ownerHandoff,observedAt:selected.observed_at,githubRefAction:selected.githubRefAction,githubActorAction:selected.githubActorAction,record});
  savePrivate(args['--request'],result);
 }
 if(action==='receive'){
  if(!args['--request']||!args['--result'])throw Error('Receive requires the exact retained private request and result paths.');
  result=await product.adoption.receivePreparedConnectedContactAdoption({storage:product.storage,prepared:privateJSON(args['--request']),record});
  savePrivate(args['--result'],result);
 }
 if(action==='inspect'){
  if(!args['--operation'])throw Error('Select the original operation key.');
  const r=await product.readOriginal(args['--operation']);
  result={kind:r.location.kind,operation_key:r.metadata.operation_key,revision:r.metadata.revision,
   input_sha256:r.metadata.input_sha256,payload_sha256:r.metadata.payload.sha256,
   active:r.metadata.active?{owner:r.metadata.active.owner,expires_at:r.metadata.active.expires_at}:null,
   events:r.payload.journal.events.length,transports:r.payload.transports.map(t=>({binding:t.binding,state:t.state})),
   outcome:r.payload.journal.outcome?.status||null};
 }
 if(args['--result']&&action!=='receive')savePrivate(args['--result'],result);
 // Source intake and initialization never invoke a contact method or drain.
 process.stdout.write(JSON.stringify({status:'COMPLETE',action,coordinator_id:product.storage.coordinatorId,
  ...(result?.operation_key?{operation_key:result.operation_key}:{}),
  ...(args['--request']&&action==='prepare'?{request_saved:true}:{}),
  ...(args['--result']?{result_saved:true}:{})})+'\n');
}
module.exports={main,privateJSON,savePrivate};
if(require.main===module)main().catch(error=>{process.stderr.write((error.code||'CONTACT_OPERATOR_FAILED')+': '+error.message+'\n');process.exitCode=1;});
