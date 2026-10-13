// MIT. Original full workspace export/adoption and exact history-report reopening.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,link,unlink,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {openFlowableWorkspace} from './model.mjs';
import {readFlowableHistoryAnalysis,createFlowableHistoryBundle,inspectFlowableHistoryBundle} from './history-analysis.mjs';
import {renderFlowableHistoryOutputs} from './history-report.mjs';
const need=(v,m)=>{if(!v)throw Error(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
function request(operation,label){const h=sha(operation+':history:'+label);return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
async function retain(path,bytes){
 const content=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 try{const existing=await readFile(path);need(existing.equals(content),'Different bytes already occupy '+path);return{path,bytes:content.length,sha256:sha(content)};}catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=path+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.pending';let handle;
 try{handle=await open(temp,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;
  try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await readFile(path)).equals(content),'Concurrent different delivery bytes');}
  const directory=await open(resolve(path,'..'),'r');try{await directory.sync();}finally{await directory.close();}
 }finally{if(handle)await handle.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 return{path,bytes:content.length,sha256:sha(content)};
}
export async function receiveFlowableHistory({source,receiver,input,operation,out}){
 need(typeof operation==='string'&&operation.length>0&&operation.length<=200,'Supply one retained history operation');
 const [left,right]=await Promise.all([source.view(),receiver.view()]);
 need(typeof left.workspaceId==='string'&&left.workspaceId&&typeof right.workspaceId==='string'&&right.workspaceId&&left.workspaceId!==right.workspaceId,'Use two distinct original workspace identities');
 out=resolve(out);await mkdir(out,{recursive:true,mode:0o700});
 const frozen={schema:'stellar-forge.flowable-history-receiving-input.v1',operation,sourceWorkspaceId:left.workspaceId,receivingWorkspaceId:right.workspaceId,input};
 await retain(join(out,'original-input.json'),json(frozen));
 const selected=await readFlowableHistoryAnalysis({workspace:source,input}),bundle=createFlowableHistoryBundle(selected);
 const outputs=renderFlowableHistoryOutputs(bundle.text);
 const report=await retain(join(out,'history.history.json'),bundle.text),html=await retain(join(out,'history.html'),outputs.html);
 const csv={};for(const kind of ['processes','tasks','activities'])csv[kind]=await retain(join(out,'history-'+kind+'.csv'),outputs.csv[kind]);
 const delivery=await source.exportWorkspace({requestId:request(operation,'export'),label:selected.report.title+' original source and history'});
 const nativeFile=await source.deliveryFile({id:delivery.id}),nativeBytes=await readFile(nativeFile.path);
 need(nativeBytes.length===nativeFile.bytes&&sha(nativeBytes)===nativeFile.sha256,'Original workspace export changed');
 const archive=await retain(join(out,'original-workspace.ndjson'),nativeBytes);
 const staged=await receiver.stageDelivery(createReadStream(archive.path),{requestId:request(operation,'inspect'),filename:'Original history-analysis workspace'});
 const manifest=await receiver.readSource({reference:staged.value.manifest});
 const adoptionPath=join(out,'original-adoption-input.json');let adoptionInput;
 try{adoptionInput=JSON.parse(await readFile(adoptionPath,'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;adoptionInput={requestId:request(operation,'adopt'),id:staged.id,expectedRevision:staged.revision,manifestSha256:staged.value.manifest.sha256};await retain(adoptionPath,json(adoptionInput));}
 need(adoptionInput.requestId===request(operation,'adopt')&&adoptionInput.id===staged.id&&adoptionInput.manifestSha256===staged.value.manifest.sha256,'Saved adoption input belongs to a different original archive');
 const adopted=await receiver.adoptDelivery(adoptionInput);
 need(adopted.value.state==='ADOPTED','Original workspace receiving has not completed');
 const saved=await receiver.getRecord({kind:'portfolio',id:selected.record.id,revision:selected.record.revision});
 need(saved.sha256===selected.record.sha256,'The received original capture revision changed');
 const reopened=await readFlowableHistoryAnalysis({workspace:receiver,input}),receivedBundle=createFlowableHistoryBundle(reopened);
 need(receivedBundle.sha256===bundle.sha256&&receivedBundle.text===bundle.text,'The received history report does not reproduce its original complete source');
 inspectFlowableHistoryBundle(receivedBundle.text);
 const receipt={schema:'stellar-forge.flowable-history-receiving.v1',operation,sourceWorkspaceId:left.workspaceId,receivingWorkspaceId:right.workspaceId,
  portfolio:{kind:saved.kind,id:saved.id,revision:saved.revision,sha256:saved.sha256},report,html,csv,archive,
  originalExport:{kind:delivery.kind,id:delivery.id,revision:delivery.revision,sha256:delivery.sha256},
  receiving:{kind:adopted.kind,id:adopted.id,revision:adopted.revision,sha256:adopted.sha256},
  manifest:manifest.reference,reportSha256:bundle.sha256,sourceInventory:selected.record.value.inventory,state:'RECEIVED'};
 await retain(join(out,'receiving.json'),json(receipt));return receipt;
}
export async function runFlowableHistoryCLI(argv=process.argv.slice(2)){
 const args={};for(let i=0;i<argv.length;i+=2){need(argv[i]?.startsWith('--')&&argv[i+1]&&!Object.hasOwn(args,argv[i]),'Use distinct --name value pairs');args[argv[i]]=argv[i+1];}
 const allowed=['--workspace','--receiver','--selection','--operation','--out','--bundle'];for(const key of Object.keys(args))need(allowed.includes(key),'Unknown option '+key);
 if(args['--bundle']){need(Object.keys(args).length===1,'Use --bundle alone for inspection');const result=inspectFlowableHistoryBundle(await readFile(resolve(args['--bundle']),'utf8'));return{schema:result.schema,bytes:result.bytes,sha256:result.sha256,report:result.report};}
 for(const key of ['--workspace','--receiver','--selection','--operation','--out'])need(args[key],'Missing '+key);
 const source=await openFlowableWorkspace({directory:resolve(args['--workspace'])});let receiver,primary;
 try{receiver=await openFlowableWorkspace({directory:resolve(args['--receiver'])});
  const receipt=await receiveFlowableHistory({source,receiver,input:JSON.parse(await readFile(resolve(args['--selection']),'utf8')),operation:args['--operation'],out:args['--out']});
  // Close/reopen the actual receiving workspace before reporting the retained result.
  await receiver.close();receiver=await openFlowableWorkspace({directory:resolve(args['--receiver'])});
  const saved=await receiver.getRecord(receipt.portfolio);need(saved.sha256===receipt.portfolio.sha256,'Cold receiving changed the original capture');
  const bundle=inspectFlowableHistoryBundle(await readFile(receipt.report.path,'utf8'));
  const selection=JSON.parse(await readFile(resolve(args['--selection']),'utf8'));
  const reopened=createFlowableHistoryBundle(await readFlowableHistoryAnalysis({workspace:receiver,input:selection}));
  need(reopened.sha256===bundle.sha256,'Cold receiving changed the complete report');return receipt;
 }catch(error){primary=error;throw error;}
 finally{const settled=await Promise.allSettled([source.close(),receiver?.close()]);const failed=settled.find(x=>x.status==='rejected');if(failed&&!primary)throw failed.reason;}
}
