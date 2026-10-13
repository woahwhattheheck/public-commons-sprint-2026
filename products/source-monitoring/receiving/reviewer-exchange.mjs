// SPDX-License-Identifier: MIT
// Complete following review work in the original Source Monitoring programme.
// The caller owns the native console and any borrowed isolated browser.
import {spawn} from 'node:child_process';
import {constants as FS} from 'node:fs';
import {mkdir,lstat,open,readFile,link,unlink,readdir} from 'node:fs/promises';
import {resolve,join,dirname,basename,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {MonitoringClient,writeReply} from '../client.mjs';

const SCHEMA='stellar-forge.source-review-receiving.v1';
const MAX=256*1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?
  Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const need=(value,message)=>{if(!value)throw Error(message);};
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const inside=(root,path)=>{const p=relative(root,path);return p!==''&&!isAbsolute(p)&&p!=='..'&&!p.startsWith('../');};
async function directory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const st=await lstat(path);need(st.isDirectory()&&!st.isSymbolicLink(),'Use a real private receiving directory.');
  if(process.platform!=='win32')need((st.mode&0o077)===0,'The receiving directory must remain private.');
}
async function sourceFile(path,maximum=MAX){
  const before=await lstat(path,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(maximum),'Select a complete regular source file within the original limit: '+path);
  const handle=await open(path,FS.O_RDONLY|(FS.O_NOFOLLOW??0));
  try{
    const actual=await handle.stat({bigint:true});
    const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
    need(same(before,actual),'The source changed while opening: '+path);
    const raw=await handle.readFile(),after=await handle.stat({bigint:true}),named=await lstat(path,{bigint:true});
    need(same(actual,after)&&same(after,named)&&raw.length===Number(after.size),'The complete selected source changed: '+path);
    return raw;
  }finally{await handle.close();}
}
async function syncDir(path){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
async function retain(path,raw){
  if(await exists(path)){const old=await sourceFile(path,Math.max(MAX,raw.length));need(old.equals(raw),'The retained original file differs: '+path);return descriptor(path,raw);}
  await directory(dirname(path));const temporary=path+'.pending-'+randomUUID();let h;
  try{
    h=await open(temporary,'wx',0o600);await h.writeFile(raw);await h.sync();await h.close();h=null;
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;need((await sourceFile(path,Math.max(MAX,raw.length))).equals(raw),'Concurrent original receiving files differ: '+path);}
    await syncDir(dirname(path));
  }finally{if(h)await h.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return descriptor(path,raw);
}
function descriptor(path,raw){return{path,bytes:raw.length,sha256:sha(raw)};}
async function json(path){return JSON.parse((await sourceFile(path)).toString('utf8'));}
async function inspect(path,maximum=MAX){
  const before=await lstat(path,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(maximum),'Select a complete regular file within the receiving limit: '+path);
  const handle=await open(path,FS.O_RDONLY|(FS.O_NOFOLLOW??0)),hash=createHash('sha256');let count=0;
  const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
  try{
    const actual=await handle.stat({bigint:true});need(same(before,actual),'The selected file changed while opening.');
    const chunk=Buffer.allocUnsafe(1024*1024);
    for(;;){const {bytesRead}=await handle.read(chunk,0,chunk.length,count);if(!bytesRead)break;hash.update(chunk.subarray(0,bytesRead));count+=bytesRead;need(count<=maximum,'The complete receiving file grew beyond its supported size.');}
    const after=await handle.stat({bigint:true}),named=await lstat(path,{bigint:true});
    need(same(actual,after)&&same(after,named)&&count===Number(actual.size),'The complete receiving file changed while hashing.');
    return{path,bytes:count,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
async function reply(root,name,value){
  await writeReply(join(root,name+'.response.json'),value);
  await retain(join(root,name+'.http.json'),bytes({status:value.status,headers:value.headers,bytes:value.raw.length,sha256:value.sha256??sha(value.raw)}));
  return value.json;
}
async function command(client,root,name,operation,input,requestOperation='review-exchange-request'){
  const commandPath=join(root,name+'.request.json');
  await retain(commandPath,bytes(input));
  const resultPath=join(root,name+'.result.json');
  if(await exists(resultPath))return json(resultPath);
  const dispatch=join(root,name+'.dispatch.json');
  if(await exists(dispatch)){
    const recovery=await client.get(requestOperation,{requestId:input.requestId});
    const value=await reply(root,name+'.recovered-'+randomUUID(),recovery);
    need(value.requestId===input.requestId&&typeof value.committed==='boolean','The original request lookup did not identify a definite commit state: '+commandPath);
    if(value.committed){
      const original=operation==='review-exchange-issue'?value.event?.observations?.issueRequest:(value.event?.command??value.event?.request);
      need(original&&stable(original)===stable(input),'The recovered request differs from its complete retained command.');
      const result=value.result??value.event?.result;
      need(result&&result.requestId===input.requestId,'The original request has no complete selected result.');
      await retain(resultPath,bytes(result));return result;
    }
    // The authenticated original workspace reports this UUID uncommitted. Retry
    // its exact retained bytes; the native transaction owns same-UUID exclusion.
  }else await retain(dispatch,bytes({requestId:input.requestId,operation,dispatchedAt:new Date().toISOString()}));
  try{
    const native=await client.post(operation,Buffer.from(JSON.stringify(input)));
    const result=await reply(root,name,native);
    need(result.requestId===input.requestId,'The original response returned another request identity.');
    await retain(resultPath,bytes(result));return result;
  }catch(error){
    const detail=typeof error.toJSON==='function'?error.toJSON():{name:error.name,message:error.message};
    await retain(join(root,name+'.failure-'+randomUUID()+'.json'),bytes(detail));
    throw error;
  }
}
async function savedRead(client,root,name,operation,parameters){
  const path=join(root,name+'.response.json');
  return await exists(path)?json(path):reply(root,name,await client.get(operation,parameters));
}
async function frozenCommand(root,name,basis){
  const path=join(root,name+'.request.json');
  if(await exists(path)){
    const value=await json(path),{requestId,at,...old}=value;
    need(stable(old)===stable(basis),'The original authored action changed; preserve its request and select a deliberate later receiving directory.');
    return value;
  }
  const value={...basis,requestId:randomUUID(),at:new Date().toISOString()};
  await retain(path,bytes(value));return value;
}
async function native(python,workspace,args,root,name){
  const stdout=join(root,name+'.stdout.json'),stderr=join(root,name+'.stderr.txt'),done=join(root,name+'.native.json');
  if(await exists(done)){
    const saved=await json(done);
    need(saved.workspace===workspace&&stable(saved.args)===stable(args),'The native continuation selection changed.');
    const out=await inspect(stdout,128*1024*1024),err=await inspect(stderr);
    need(stable(out)===stable(saved.stdout)&&stable(err)===stable(saved.stderr),'The retained native response changed.');
    need(saved.code===0,'Original native command failed; inspect '+stderr);
    return JSON.parse((await sourceFile(stdout,128*1024*1024)).toString('utf8'));
  }
  need(!await exists(stdout)&&!await exists(stderr),'An original native child has unfinished output; reconcile that child before continuing: '+name);
  const out=await open(stdout,'wx',0o600),err=await open(stderr,'wx',0o600);
  const cli=fileURLToPath(new URL('../../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/cli.py',import.meta.url));
  let code,signal,launchError;
  try{
    const child=spawn(python,['-B',cli,'--workspace',workspace,...args],{stdio:['ignore',out.fd,err.fd],windowsHide:true});
    // Register before the first await: the original child may close immediately.
    const completion=new Promise(resolve_=>{
      child.once('error',error=>{launchError=error;});
      child.once('close',(value,why)=>{code=value;signal=why;resolve_();});
    });
    let retentionError;
    try{await retain(join(root,name+'.child.json'),bytes({workspace,args,pid:child.pid??null,createdAt:new Date().toISOString()}));}
    catch(error){retentionError=error;}
    await completion;
    if(retentionError)throw retentionError;
    await out.sync();await err.sync();
  }finally{await out.close();await err.close();}
  const receipt={workspace,args,code:code??null,signal:signal??null,launchError:launchError?{name:launchError.name,message:launchError.message}:null,
    stdout:await inspect(stdout,128*1024*1024),stderr:await inspect(stderr)};
  await retain(done,bytes(receipt));
  need(!launchError&&code===0,'The original native command needs its retained output: '+stderr);
  return JSON.parse((await sourceFile(stdout,128*1024*1024)).toString('utf8'));
}
async function inventory(root){
  const found=[];
  async function walk(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const path=join(folder,entry.name);
      if(entry.isSymbolicLink())throw Error('A receiving output became a symlink: '+path);
      if(entry.isDirectory()){
        if(entry.name==='cold-received'||entry.name==='second-received')continue;
        await walk(path);
      }else if(entry.isFile()&&!entry.name.includes('.pending-')&&entry.name!=='reviewer-exchange-complete.json'){
        found.push(await inspect(path,1024*1024*1024));
      }
    }
  }
  await walk(root);return found.sort((a,b)=>a.path.localeCompare(b.path));
}
async function completeFile(root,client,issueId,role,filename,expected){
  const path=join(root,filename);
  if(await exists(path)){
    const actual=await inspect(path);
    if(expected)need(actual.sha256===expected.sha256&&actual.bytes===expected.bytes,'The retained complete exchange file differs.');
    return actual;
  }
  const result=await client.download('review-exchange',{id:issueId,role,output:path,...(expected?{expectedSha256:expected.sha256}:{})});
  const actual=await inspect(path);
  if(expected)need(actual.sha256===expected.sha256&&actual.bytes===expected.bytes,'The downloaded complete exchange file differs.');
  return actual;
}
export async function receiveReviewerExchange({connectionFile,pythonCommand,output,selection,operateCopy=null,clientFactory=null}){
  need(selection?.schema===SCHEMA&&typeof selection.operationId==='string'&&selection.operationId.length>0,'Select the original following receiving operation and complete specification.');
  for(const value of [connectionFile,pythonCommand,output])need(typeof value==='string'&&isAbsolute(value),'Use actual absolute connection, Python and following output paths.');
  need(typeof selection.workspace==='string'&&isAbsolute(selection.workspace),'Select the exact original physical workspace.');
  need(selection.issue&&stable(Object.keys(selection.issue).sort())===stable(['cycleId','expectedVersion','caseIds','reviewer','label','actor','evidenceIds'].sort()),'Supply the complete issue basis; this receiving course retains its own original request UUID and actual time.');
  output=resolve(output);await directory(output);
  await retain(join(output,'receiving-selection.json'),bytes(selection));
  const finished=join(output,'reviewer-exchange-complete.json');
  if(await exists(finished)){
    const result=await json(finished);
    for(const item of result.artifacts){const actual=await inspect(item.path,1024*1024*1024);need(stable(actual)===stable(item),'A completed original receiving artifact changed.');}
    return result;
  }
  need(clientFactory===null||typeof clientFactory==='function','Use the original selected transport factory.');
  const clientOptions={connectionFile,expectedWorkspace:selection.workspace,timeoutMs:120000};
  const client=clientFactory?await clientFactory(clientOptions):new MonitoringClient(clientOptions);
  let clientClosed=false;
  try{
    const identity=await client.inspect();
    need(output!==identity.workspace&&!inside(identity.workspace,output),'Keep following output outside the original customer workspace.');
    await retain(join(output,'workspace-binding.json'),bytes({workspace:identity.workspace,bindingSha256:identity.bindingSha256??null}));
    const issueInput=await frozenCommand(output,'issue',selection.issue);
    const issued=await command(client,output,'issue','review-exchange-issue',issueInput);
    const issueId=issued.issueId;
    need(typeof issueId==='string','The original issue did not return its selected identity.');
    const issuedJson=await completeFile(output,client,issueId,'issued_json','Issued_Reviewer_Source.json',issued.files.find(f=>f.role==='issued_json'));
    const issuedHtml=await completeFile(output,client,issueId,'issued_html','Issued_Reviewer_Copy.html',issued.files.find(f=>f.role==='issued_html'));
    let operated=null;
    const operatedPath=join(output,'reviewer-copy-operated.json');
    if(await exists(operatedPath))operated=await json(operatedPath);
    else if(operateCopy){
      operated=await operateCopy({issueId,issuedJsonPath:issuedJson.path,issuedHtmlPath:issuedHtml.path,outputDirectory:join(output,'reviewer-copy'),selection});
      need(operated&&typeof operated.returnFile==='string','The actual reviewer operation must return its complete saved returnFile.');
      await retain(operatedPath,bytes(operated));
    }
    const returnFile=operated?.returnFile??selection.returnFile;
    if(!returnFile||!await exists(returnFile)){
      return{schema:SCHEMA,state:'ISSUED_AWAITING_REVIEWER_FILE',operationId:selection.operationId,issueId,
        issuedJson,issuedHtml,output,continuation:'Open and operate the exact issued HTML, retain the complete return file, and continue this same selected receiving directory.'};
    }
    need(isAbsolute(returnFile),'Select the actual complete reviewer return file.');
    const returnedRaw=await sourceFile(returnFile);
    const returnMedia=returnedRaw.toString('utf8').replace(/^\uFEFF/,'').trimStart().startsWith('<')?'text/html':'application/json';
    const returnDescriptor=await retain(join(output,returnMedia==='text/html'?'Returned_Reviewer_Source.html':'Returned_Reviewer_Source.json'),returnedRaw);
    const uploadPath=join(output,'return-upload.response.json');
    let uploaded;
    if(await exists(uploadPath))uploaded=await json(uploadPath);
    else uploaded=await reply(output,'return-upload',await client.upload(returnDescriptor.path,{name:basename(returnFile),media:returnMedia}));
    need(uploaded.id===returnDescriptor.sha256&&uploaded.bytes===returnDescriptor.bytes,'The original store retained different returned bytes.');
    // Object deduplication preserves its first stored name; this selected return
    // retains the actual complete incoming file name and media independently.
    const selectedReturn={sha256:uploaded.id,bytes:uploaded.bytes,name:basename(returnFile),mediaType:returnMedia};
    const previewPath=join(output,'return-preview.response.json');
    const preview=await exists(previewPath)?await json(previewPath):
      await reply(output,'return-preview',await client.post('review-exchange-return-preview',Buffer.from(JSON.stringify({file:selectedReturn}))));
    need(preview.issueId===issueId,'The complete returned file belongs to another original issue.');
    const editionId=operated?.editionId??selection.editionId??preview.selectedEditionId;
    need(typeof editionId==='string'&&preview.editions.some(item=>item.id===editionId),'Select an actual named edition in the original complete returned file.');
    const receiveInput=await frozenCommand(output,'receive',{action:'receive',actor:selection.receivingActor,body:{file:selectedReturn}});
    const received=await command(client,output,'receive','review-exchange-command',receiveInput);
    need(received.issueId===issueId&&received.returnId===returnDescriptor.sha256,'The return belongs to another original issue.');
    const comparePath=join(output,'selected-comparison.response.json');
    let comparison;
    if(await exists(comparePath))comparison=await json(comparePath);
    else comparison=await reply(output,'selected-comparison',await client.get('review-exchange-compare',{returnId:received.returnId,editionId}));
    let adoption;
    const adoptionPath=join(output,'authored-adoption.json');
    if(await exists(adoptionPath))adoption=await json(adoptionPath);
    else{
      const chosenFile=operated?.adoptionFile??selection.adoptionFile;
      if(!chosenFile||!await exists(chosenFile))return{schema:SCHEMA,state:'RETURNED_AWAITING_AUTHORED_CHOICES',operationId:selection.operationId,
        issueId,returnId:received.returnId,editionId,comparisonFile:comparePath,output,
        continuation:'Review this full original comparison, save actor and explicit all-case choices, and continue the same receiving directory.'};
      const raw=await sourceFile(chosenFile,24*1024*1024);adoption=JSON.parse(raw.toString('utf8'));
      need(adoption.actor&&adoption.choices&&stable(Object.keys(adoption.choices).sort())===stable(Object.keys(comparison.expectedCases).sort()),
        'Supply the actual adoption actor and an explicit choice for every returned case.');
      await retain(adoptionPath,raw);
    }
    const applyInput=await frozenCommand(output,'apply',{action:'apply',actor:adoption.actor,body:{
      returnId:received.returnId,editionId,reviewSha256:comparison.reviewSha256,expectedCycleVersion:comparison.cycle.version,
      expectedCases:comparison.expectedCases,choices:adoption.choices}});
    const applied=await command(client,output,'apply','review-exchange-command',applyInput);
    need(applied.issueId===issueId&&applied.returnId===received.returnId,'The original adoption returned another issue or return.');
    const historical=await savedRead(client,output,'adopted-comparison','review-exchange-compare',{
      returnId:received.returnId,editionId,adoptionRequestId:applyInput.requestId});
    const view=await savedRead(client,output,'original-exchange','review-exchange',{id:issueId});
    const archivePath=join(output,'Monitoring_Reviewer_Complete_Workspace.zip');
    if(!await exists(archivePath))await client.download('workspace',{output:archivePath});
    const archive=await inspect(archivePath,1024*1024*1024);
    const cold=join(output,'cold-received'),coldChild=join(output,'cold-import.child.json');
    const coldArgs=await exists(coldChild)?(await json(coldChild)).args:[...(!await exists(cold)?['--create']:[]),'import','--input',archivePath];
    await native(pythonCommand,cold,coldArgs,output,'cold-import');
    for(const [name,input,result]of[['issue',issueInput,issued],['receive',receiveInput,received],['apply',applyInput,applied]]){
      const actual=await native(pythonCommand,cold,['review-exchange-request','--request-id',input.requestId],output,'cold-'+name+'-request');
      need(actual.committed&&stable(actual.result??actual.event?.result)===stable(result),'The cold workspace lost the exact original '+name+' result.');
    }
    const coldView=await native(pythonCommand,cold,['review-exchange','--id',issueId],output,'cold-exchange');
    const viewId=value=>value.issueId??value.id??value.issue?.id??value.issued?.id;
    need(viewId(view)===issueId&&viewId(coldView)===issueId,'The cold workspace did not preserve the original exchange identity.');
    for(const [role,original,name] of [['issued_json',issuedJson,'Cold_Issued_Reviewer_Source.json'],['issued_html',issuedHtml,'Cold_Issued_Reviewer_Copy.html'],['returned_file',returnDescriptor,returnMedia==='text/html'?'Cold_Returned_Reviewer_Source.html':'Cold_Returned_Reviewer_Source.json']]){
      const file=join(output,name),id=role==='returned_file'?received.returnId:issueId;
      await native(pythonCommand,cold,['review-exchange-download','--id',id,'--role',role,'--output',file],output,'cold-file-'+role);
      const actual=await inspect(file);need(actual.bytes===original.bytes&&actual.sha256===original.sha256,'Cold receiving changed a complete original reviewer file.');
    }
    const coldHistory=await native(pythonCommand,cold,['review-exchange-compare','--return-id',received.returnId,'--edition-id',editionId,
      '--adoption-request-id',applyInput.requestId],output,'cold-adopted-comparison');
    const historicalCore=value=>({readOnly:value.readOnly,event:value.event,comparison:value.comparison});
    need(historical.readOnly===true&&stable(historicalCore(coldHistory))===stable(historicalCore(historical)),'The historical adopted comparison changed on receiving.');
    const followingPath=join(output,'authored-following-cycle-commands.json');let followingCommands;
    if(await exists(followingPath))followingCommands=await json(followingPath);
    else if(Array.isArray(selection.followingCycleCommands)&&selection.followingCycleCommands.length){followingCommands=selection.followingCycleCommands;await retain(followingPath,bytes(followingCommands));}
    else if(selection.followingCycleCommandsFile&&await exists(selection.followingCycleCommandsFile)){
      const raw=await sourceFile(selection.followingCycleCommandsFile,24*1024*1024);followingCommands=JSON.parse(raw.toString('utf8'));
      need(Array.isArray(followingCommands)&&followingCommands.length,'Select a nonempty complete original cycle continuation.');await retain(followingPath,raw);
    }
    if(!Array.isArray(followingCommands)||followingCommands.length===0)return{schema:SCHEMA,state:'RECEIVED_AWAITING_LATER_WORK',operationId:selection.operationId,issueId,returnId:received.returnId,editionId,receivedWorkspace:cold,archive,output,
      continuation:'Save actual original cycle continuation actions at the preselected followingCycleCommandsFile, then continue this same course and export its later complete workspace.'};
    const later=[];
    for(const [index,authored] of followingCommands.entries()){
      need(authored&&['reopen','assign','complete','signoff'].includes(authored.action)&&authored.actor&&authored.body,'Supply actual original cycle continuation actions, actors and complete bodies.');
      const name='later-cycle-'+index,path=join(output,name+'.request.json');let input;
      if(await exists(path)){
        input=await json(path);need(input.cycleId===issued.cycleId&&input.action===authored.action&&stable(input.actor)===stable(authored.actor)&&stable(input.body)===stable(authored.body),'The authored later cycle work changed.');
      }else{
        const current=await native(pythonCommand,cold,['cycle','--id',issued.cycleId],output,name+'-basis');
        input=await frozenCommand(output,name,{cycleId:issued.cycleId,expectedVersion:current.version,action:authored.action,actor:authored.actor,body:authored.body});
      }
      const result=await native(pythonCommand,cold,['cycle-command','--input',path],output,name);
      need(result.requestId===input.requestId,'The later original cycle command returned another identity.');later.push({request:input,result});
    }
    const afterLater=await native(pythonCommand,cold,['review-exchange-compare','--return-id',received.returnId,'--edition-id',editionId,'--adoption-request-id',applyInput.requestId],output,'later-original-comparison');
    need(stable(historicalCore(afterLater))===stable(historicalCore(historical)),'Later cycle work changed the original adopted comparison.');
    const coldArchive=join(output,'Monitoring_Reviewer_Received_Workspace.zip');
    await native(pythonCommand,cold,['export','--output',coldArchive],output,'cold-export');
    const second=join(output,'second-received'),secondChild=join(output,'second-import.child.json');
    const secondArgs=await exists(secondChild)?(await json(secondChild)).args:[...(!await exists(second)?['--create']:[]),'import','--input',coldArchive];
    await native(pythonCommand,second,secondArgs,output,'second-import');
    for(const [index,event]of later.entries()){
      const replay=await native(pythonCommand,second,['cycle-command','--input',join(output,'later-cycle-'+index+'.request.json')],output,'second-later-'+index);
      need(stable(replay)===stable(event.result),'The later full receiving lost an original continuation result.');
    }
    const secondHistory=await native(pythonCommand,second,['review-exchange-compare','--return-id',received.returnId,'--edition-id',editionId,'--adoption-request-id',applyInput.requestId],output,'second-original-comparison');
    need(stable(historicalCore(secondHistory))===stable(historicalCore(historical)),'Second receiving changed the original adopted comparison.');
    const result={schema:SCHEMA,state:'COMPLETE',operationId:selection.operationId,workspace:identity.workspace,receivedWorkspace:cold,
      issueId,returnId:received.returnId,editionId,adoptionRequestId:applyInput.requestId,issuedJson,issuedHtml,
      returnedFile:returnDescriptor,archive,receivedArchive:await inspect(coldArchive,1024*1024*1024),
      originalResults:{issue:issued,receive:received,apply:applied},laterCycleWork:later,secondReceivedWorkspace:second,
      browser:operated??null,visualAcceptance:'Original operator opens and uses the exact outgoing files and views the retained rendered observations.',artifacts:await inventory(output)};
    await client.close();clientClosed=true;
    await retain(finished,bytes(result));return result;
  }finally{if(!clientClosed)await client.close();}
}
export async function main(args=process.argv.slice(2)){
  const opts={};
  for(let i=0;i<args.length;i++){
    need(['--connection','--python','--output','--selection'].includes(args[i])&&!Object.hasOwn(opts,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'Use the complete named receiving arguments.');
    opts[args[i]]=args[++i];
  }
  for(const key of ['--connection','--python','--output','--selection'])need(typeof opts[key]==='string','Missing '+key);
  const selection=await json(resolve(opts['--selection']));
  const result=await receiveReviewerExchange({connectionFile:resolve(opts['--connection']),pythonCommand:resolve(opts['--python']),output:resolve(opts['--output']),selection});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(JSON.stringify({error:'SOURCE_REVIEW_RECEIVING',message:error.message})+'\n');process.exitCode=1;
});
