// MIT. Original-input Principal operator receiving; never dispatches plan.execute.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openWorkspace,inspectPacket,receiveWorkspace,MAX_PACKET} from '../lib/workspace.mjs';
import {need,keys,object,identity,hash,bytes,clone,text} from '../lib/value.mjs';
import {directory,lease,writeExact,readJSON,fileDescriptor,verifyFile,confined,syncDirectory} from '../lib/files.mjs';
const SOURCE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function executingApplication(){
 const manifest=await readJSON(await confined(SOURCE_ROOT,'source-files.json'));need(manifest.schema==='principal.operator-source.v1'&&Array.isArray(manifest.files),'APPLICATION_MANIFEST_REQUIRED');
 const paths=new Set(),application=[];
 for(const member of [...manifest.files,{path:'source-files.json'}]){
  need(!paths.has(member.path),'DUPLICATE_SOURCE_PATH');paths.add(member.path);const file=await confined(SOURCE_ROOT,member.path),d=await fileDescriptor(file,member.path),data=await fs.readFile(file);
  need(data.length===d.bytes&&hash(data)===d.sha256&&(!member.sha256||(d.bytes===member.bytes&&d.sha256===member.sha256)),'EXECUTING_APPLICATION_CHANGED');
  application.push({...d,contentBase64:data.toString('base64')});
 }
 return{schema:'principal.executing-application.v1',application};
}
const phases=['01-original-inputs','02-producer-commands','03-producer-export','04-independent-receive','05-customer-continuation','06-original-request-replay','07-customer-return','08-independent-return','09-original-return-replay','10-cold-reopen'];
function inputCheck(input){
 keys(input,['schema','operationId','producerDirectory','customerDirectory','returnDirectory','producerCommands','customerCommands']);
 need(input.schema==='principal.receiving-input.v1','RECEIVING_SCHEMA');text(input.operationId,200);
 const locations=['producerDirectory','customerDirectory','returnDirectory'].map(k=>{need(typeof input[k]==='string'&&path.isAbsolute(input[k]),'ABSOLUTE_WORKSPACE_REQUIRED');return path.resolve(input[k]);});
 need(new Set(locations).size===3,'INDEPENDENT_WORKSPACES_REQUIRED');
 for(const name of ['producerCommands','customerCommands']){need(Array.isArray(input[name])&&input[name].length>0,'COMPLETE_COMMAND_COURSE_REQUIRED');const ids=new Set();for(const command of input[name]){need(object(command)&&typeof command.requestId==='string'&&!ids.has(command.requestId),'ORIGINAL_REQUEST_REQUIRED');ids.add(command.requestId);need(['source.import','config.save','plan.prepare','plan.simulate','observation.capture','note.save'].includes(command.method),'RECEIVING_NEVER_EXECUTES');}}
 need(input.producerCommands.some(c=>c.method==='source.import'),'ORIGINAL_SOURCE_IMPORT_REQUIRED');
}
function retainedPrefix(before,after){
 need(before.workspace.id===after.workspace.id&&after.workspace.revision>=before.workspace.revision,'WORKSPACE_LINEAGE');
 for(const name of ['plans','observations','notes','files','exports','history'])for(const row of before[name])need(after[name].some(value=>identity(value)===identity(row)),'ORIGINAL_HISTORY_CHANGED',{name});
}
export async function receiveCourse(input,out){
 inputCheck(input);need(path.isAbsolute(out),'ABSOLUTE_OUTPUT_REQUIRED');await directory(out);const guard=await lease(out,'principal-receiving');
 const binding=identity(input);let owners=[];
 const artifact=async relative=>{const f=await confined(out,relative);const d=await fileDescriptor(f,relative);await syncDirectory(path.dirname(f));return d;};
 const put=async(relative,value)=>{const data=Buffer.isBuffer(value)?value:bytes(value);need(data.length<=MAX_PACKET,'RECEIVING_ARTIFACT_LIMIT');const f=await confined(out,relative,true);await writeExact(f,data);return artifact(relative);};
 const read=async descriptor=>{await verifyFile(out,descriptor);return JSON.parse(await fs.readFile(await confined(out,descriptor.path),'utf8'));};
 const open=async root=>{const w=await openWorkspace({directory:root});owners.push(w);return w;};
 const close=async w=>{await w.close();owners=owners.filter(x=>x!==w);};
 async function stage(name,fn){
  const file=await confined(out,'phases/'+name+'.json',true),old=await readJSON(file,true);
  if(old){need(old.schema==='principal.receiving-phase.v1'&&old.inputSha256===binding&&old.name===name,'ORIGINAL_PHASE_CHANGED');for(const a of old.artifacts){await verifyFile(out,a);await artifact(a.path);}await syncDirectory(path.dirname(file));return old;}
  const accepted=await fn();for(const a of accepted.artifacts)await verifyFile(out,a);
  const result={schema:'principal.receiving-phase.v1',name,inputSha256:binding,...accepted};
  await writeExact(file,bytes(result));return result;
 }
 async function commands(root,selected,label){
  const w=await open(root);try{
   const results=[],artifacts=[];
   for(let i=0;i<selected.length;i++){
    const c=selected[i];artifacts.push(await put(label+'/request-'+i+'.json',c));
    const result=await w.command(c);need(result.requestId===c.requestId,'COMMAND_RESPONSE_CHANGED');
    const original=w.request(c.requestId);need(original.status==='COMPLETE'&&identity(original.envelope)===identity(c)&&identity(original.response)===identity(result),'ORIGINAL_REQUEST_RECEIPT_CHANGED');
    artifacts.push(await put(label+'/response-'+i+'.json',result));results.push(result);
   }
   return{value:{workspace:w.read().workspace,results},artifacts};
  }finally{await close(w);}
 }
 async function exported(root,relative){
  const old=await readJSON(await confined(out,relative,true),true);
  if(old){inspectPacket(old);await writeExact(await confined(out,relative),bytes(old));return{value:{packet:await artifact(relative),inspection:inspectPacket(old)},artifacts:[await artifact(relative)]};}
  const w=await open(root);try{const packet=await w.portable(),a=await put(relative,packet);return{value:{packet:a,inspection:inspectPacket(packet)},artifacts:[a]};}finally{await close(w);}
 }
 async function acceptedReceive(packetDescriptor,destination,requestId,relative){
  const packet=await read(packetDescriptor),result=await receiveWorkspace({packet,directory:destination,requestId});
  // Keep each exact observed replay bit independently. The first acceptance is
  // the selected original result; later observations never replace it.
  const observed=await put(relative+'/observations/'+identity(result)+'.json',result);
  const file=await confined(out,relative+'/accepted.json',true),old=await readJSON(file,true);
  if(old)need(old.receivedFrom.sha256===result.receivedFrom.sha256&&old.workspace.id===result.workspace.id&&old.application===result.application,'RECEIVE_IDENTITY_CHANGED');else await writeExact(file,bytes(result));
  const accepted=old??result;return{value:accepted,artifacts:[observed,await artifact(relative+'/accepted.json')]};
 }
 async function verifyComplete(result){
  need(result.schema==='principal.receiving-result.v1'&&result.inputSha256===binding&&result.operationId===input.operationId&&identity(result.phaseNames)===identity(phases)&&result.state==='COMPLETE','COMPLETE_COURSE_REQUIRED');
  for(const descriptor of result.artifacts)await verifyFile(out,descriptor);
  const executing=await executingApplication(),selectedSource=await readJSON(await confined(out,'executing-application.json'));need(identity(executing)===identity(selectedSource)&&result.applicationSha256===identity(selectedSource),'EXECUTING_APPLICATION_CHANGED');
  const full=[];for(const name of phases){const p=await readJSON(await confined(out,'phases/'+name+'.json'));need(p.name===name&&p.inputSha256===binding&&p.schema==='principal.receiving-phase.v1','COMPLETE_COURSE_REQUIRED');for(const a of p.artifacts)await verifyFile(out,a);full.push(p);}
  const first=await read(full[2].value.packet),returned=await read(full[6].value.packet);inspectPacket(first);inspectPacket(returned);retainedPrefix(first.body.workspace,returned.body.workspace);
  const coldDescriptor=full[9].artifacts.find(a=>a.path==='cold-return-state.json');need(coldDescriptor,'COLD_OBSERVATION_REQUIRED');const cold=await read(coldDescriptor);retainedPrefix(returned.body.workspace,cold);need(identity(full[9].value.workspace)===identity(cold.workspace)&&full[9].value.returnSha256===returned.sha256,'COLD_SELECTION_CHANGED');
  need(result.returnSha256===returned.sha256&&result.workspaceId===returned.body.workspace.workspace.id&&returned.body.workspace.workspace.revision>first.body.workspace.workspace.revision,'RETURN_SELECTION_CHANGED');
  need(full[0].value.applicationSha256===identity(selectedSource),'PHASE_SOURCE_BINDING_CHANGED');
  const expected=[await artifact('input.json'),await artifact('executing-application.json')];for(const p of full)expected.push(await artifact('phases/'+p.name+'.json'),...p.artifacts);const select=v=>[...new Map(v.map(a=>[a.path,a])).values()].sort((a,b)=>a.path.localeCompare(b.path));need(identity(select(result.artifacts))===identity(select(expected)),'COMPLETE_ARTIFACT_SET');
  for(const [root,packet]of [[input.customerDirectory,first],[input.returnDirectory,returned]]){
   const w=await open(root);try{retainedPrefix(packet.body.workspace,w.read());if(root===input.returnDirectory)retainedPrefix(cold,w.read());for(const request of packet.body.requests.filter(r=>r.status==='COMPLETE'))need(identity(w.request(request.id).response)===identity(request.response),'ORIGINAL_RECEIVED_REQUEST_CHANGED');}finally{await close(w);}
  }
  return result;
 }
 try{
  const executing=await executingApplication(),sourceArtifact=await put('executing-application.json',executing),applicationSha256=identity(executing);
  const original=await put('input.json',input);const completed=await readJSON(await confined(out,'complete.json'),true);if(completed)return await verifyComplete(completed);
  const done=[];
  done.push(await stage(phases[0],async()=>({value:{operationId:input.operationId,applicationSha256,runtime:{node:process.versions.node,platform:process.platform,architecture:process.arch,sqlite:process.versions.sqlite??null}},artifacts:[original,sourceArtifact]})));
  done.push(await stage(phases[1],()=>commands(input.producerDirectory,input.producerCommands,'producer')));
  done.push(await stage(phases[2],()=>exported(input.producerDirectory,'producer-workspace.json')));
  done.push(await stage(phases[3],()=>acceptedReceive(done[2].value.packet,input.customerDirectory,input.operationId+'.receive','customer-receive')));
  done.push(await stage(phases[4],()=>commands(input.customerDirectory,input.customerCommands,'customer')));
  done.push(await stage(phases[5],async()=>{
   const w=await open(input.customerDirectory);try{const before=w.read();const result=await w.command(input.producerCommands[0]);need(identity(w.read())===identity(before),'OLD_REQUEST_CHANGED_LATER_CUSTOMER');return{value:{result,preservedRevision:before.workspace.revision},artifacts:[await put('original-request-replay.json',result)]};}finally{await close(w);}
  }));
  done.push(await stage(phases[6],()=>exported(input.customerDirectory,'returned-workspace.json')));
  done.push(await stage(phases[7],()=>acceptedReceive(done[6].value.packet,input.returnDirectory,input.operationId+'.return','independent-return')));
  done.push(await stage(phases[8],async()=>{
   const w=await open(input.returnDirectory);try{const before=w.read(),results=[];for(const c of [...input.producerCommands,...input.customerCommands])results.push(await w.command(c));need(identity(w.read())===identity(before),'RETURN_REPLAY_CHANGED_HISTORY');return{value:{workspace:before.workspace,results},artifacts:[await put('returned-request-replay.json',results)]};}finally{await close(w);}
  }));
  done.push(await stage(phases[9],async()=>{
   const first=await read(done[2].value.packet),returned=await read(done[6].value.packet);retainedPrefix(first.body.workspace,returned.body.workspace);
   const w=await open(input.returnDirectory);try{
    const selected=await readJSON(await confined(out,'cold-return-state.json'),true)??w.read();
    retainedPrefix(returned.body.workspace,selected);retainedPrefix(selected,w.read());
    return{value:{workspace:selected.workspace,returnSha256:returned.sha256,inspection:inspectPacket(returned)},artifacts:[await put('cold-return-state.json',selected)]};
   }finally{await close(w);}
  }));
  const artifacts=[original,sourceArtifact];for(let i=0;i<done.length;i++){artifacts.push(await artifact('phases/'+phases[i]+'.json'),...done[i].artifacts);}
  const unique=[...new Map(artifacts.map(a=>[a.path,a])).values()];
  const result={schema:'principal.receiving-result.v1',state:'COMPLETE',operationId:input.operationId,inputSha256:binding,applicationSha256,phaseNames:phases,workspaceId:done[9].value.workspace.id,returnSha256:done[9].value.returnSha256,artifacts:unique};
  await verifyComplete(result);await put('complete.json',result);return result;
 }finally{let first;for(const w of [...owners].reverse())try{await close(w);}catch(e){first??=e;}if(!owners.length)await guard.release();if(first)throw first;}
}
