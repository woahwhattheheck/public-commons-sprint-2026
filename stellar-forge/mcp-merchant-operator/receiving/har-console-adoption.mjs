#!/usr/bin/env node
// MIT. Original merchant MCP receiving using an already completed HAR console result.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {openRefresh,saveRefreshReview} from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/refresh.mjs';
import {readRegular,readRevision,saveReview,digest} from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/store.mjs';
import {canonical} from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/model.mjs';
import {startWorkspace} from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs';
import {readPackage} from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/model.mjs';
import {initializeHarWorkspaceMerchant} from '../config.mjs';
import {startMerchantMcp} from '../serve.mjs';
import {openMerchantFileClient} from '../retained-download.mjs';
import {downloadHarExport} from '../har-download.mjs';

const encode=v=>JSON.stringify(v,null,2)+'\n';
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const check=(value,message)=>{if(!value)throw new Error(message);};
async function write(path,value){await writeFile(path,value,{flag:'wx',mode:0o600});}

export async function receiveHarAgent({consoleResult,output}) {
  const resultBytes=await readRegular(resolve(consoleResult),4*1024*1024),input=parse(resultBytes);
  check(input.operation==='AF825-HAR-CONSOLE-20261012'&&input.selected?.kind==='refresh','Select the original completed HAR console result.');
  const original=await openRefresh(input.receivingDirectory),saved=await readRevision(original.candidate,input.selected.revision);
  check(original.manifest.operationId===input.selected.id,'The original received source differs from the selected result.');
  const packageOriginal=await readPackage(dirname(input.merchant.directory),basename(input.merchant.directory));
  const planBytes=await readRegular(join(packageOriginal.folder,'merchant-plan.json'),4*1024*1024);
  output=resolve(output);await mkdir(output,{mode:0o700});
  const senderParent=join(output,'sender'),receiverParent=join(output,'receiver');
  await mkdir(senderParent,{mode:0o700});await mkdir(receiverParent,{mode:0o700});
  const planFile=join(output,'original-plan.json');await write(planFile,planBytes);
  await write(join(output,'original-selection.json'),encode({consoleResult:resolve(consoleResult),resultSha256:digest(resultBytes),
    selected:input.selected,originalPacket:input.receivingDirectory,planSha256:digest(planBytes),openApiSha256:digest(Buffer.from(packageOriginal.specText))}));
  const environment={HAR_NATIVE_MCP_TOKEN:randomBytes(32).toString('hex'),MCP_CLIENT_ORIGINS:''};
  const operations=[];let sender,receiver,mcp,client;
  const call=async(name,args={})=>{
    const value=await client.call(name,args);operations.push({name,workspace:args.workspace??null,
      selection:args.selection??null,state:value.state??value.native?.state??null});return value;
  };
  async function all(name,args,first) {
    let page=first??await call(name,args),rows=[...page.items];
    while(page.nextOffset!==null){page=await call(name,{...args,offset:page.nextOffset,expectedSnapshot:page.snapshot});rows.push(...page.items);}
    return rows;
  }
  try {
    sender=await startWorkspace({parent:senderParent,noSignals:true});receiver=await startWorkspace({parent:receiverParent,noSignals:true});
    const senderUrl=join(output,'sender-url.txt'),receiverUrl=join(output,'receiver-url.txt');
    await write(senderUrl,sender.url+'\n');await write(receiverUrl,receiver.url+'\n');
    const connection=join(output,'har-connection.json'),terms={kind:'merchant-plan',path:planFile,sha256:digest(planBytes)};
    await write(connection,encode({schema:'stellar-forge.har-workspace-connection.v1',workspaces:{
      sender:{projectsDirectory:senderParent,consoleUrlFile:senderUrl,
        files:{candidate:{kind:'capture',path:join(original.candidate.root,'source.har'),sha256:original.candidate.manifest.sourceSha256},
          decisions:{kind:'decisions',path:join(original.candidate.root,'reviews',saved.revision+'.json'),sha256:saved.revision},continued_decisions:{kind:'decisions',path:join(output,'continued-decisions.json')},terms},
        imports:{previous:{kind:'capture',directory:original.previous.root}},
        destinations:{handover:{directory:join(output,'complete-receiving-source')}}},
      receiver:{projectsDirectory:receiverParent,consoleUrlFile:receiverUrl,files:{terms}}
    }}));
    const configured=await initializeHarWorkspaceMerchant({directory:join(output,'merchant-mcp'),connection});
    mcp=await startMerchantMcp({configPath:configured.configuration,port:0,tokenEnv:'HAR_NATIVE_MCP_TOKEN',environment});
    const endpoint=mcp.url,port=Number(new URL(endpoint).port);
    client=await openMerchantFileClient({url:endpoint,tokenEnv:'HAR_NATIVE_MCP_TOKEN',environment,errorPrefix:'HAR'});
    const declared=await call('merchant_har_workspaces');check(declared.workspaces.length===2,'The original factory did not register both declared workspaces.');
    await call('merchant_har_status',{workspace:'sender'});
    const previous=await call('merchant_har_adopt',{workspace:'sender',source:'previous',label:'Original previous source'});
    const before={...previous.native.selection,revision:original.manifest.lineage.previousReviewSha256};
    const file=await call('merchant_har_files',{workspace:'sender',file:'candidate'});
    const ingested=await call('merchant_har_ingest',{workspace:'sender',file:'candidate',expectedSha256:file.sha256,previous:before,label:'Original next capture'});
    check(ingested.native.selection.id===original.manifest.operationId,'MCP intake changed the original refresh lineage.');
    const chosen=await call('merchant_har_decisions_save',{workspace:'sender',selection:ingested.native.selection,file:'decisions',expectedSha256:saved.revision});
    check(chosen.native.revision===saved.revision,'MCP decision save changed the original immutable revision.');
    const selection=chosen.native.selection;
    await call('merchant_har_library',{workspace:'sender',limit:1});
    await call('merchant_har_inspect',{workspace:'sender',selection,limit:1});
    const groups=await all('merchant_har_groups',{workspace:'sender',selection,limit:1});
    const reviews=await all('merchant_har_review',{workspace:'sender',selection,limit:1});
    const changes=await all('merchant_har_changes',{workspace:'sender',selection,limit:1});
    const prepared=await call('merchant_har_source',{workspace:'sender',selection,limit:1});
    const sourceRows=await all('merchant_har_source',{workspace:'sender',selection,limit:1},prepared);
    check(reviews.length===saved.review.operations.length&&groups.length===original.candidate.inventory.groups.length,'Native inventory pagination lost source records.');
    const args={workspace:'sender',selection,file:'terms',expectedSha256:digest(planBytes)};
    await call('merchant_har_preview',args);
    const savedPackage=await call('merchant_har_save',{...args,name:'agent-merchant'});
    const replay=await call('merchant_har_save',{...args,name:'agent-merchant'});
    check(replay.native.reused===true&&savedPackage.native.folder===replay.native.folder,'Completed save did not recover the original package.');
    const loaded=await call('merchant_har_load',{workspace:'sender',name:'agent-merchant'});
    check(loaded.native.specText===packageOriginal.specText&&canonical(loaded.native.plan)===canonical(packageOriginal.plan),'MCP native package changed source or exact plan.');
    const carried=await call('merchant_har_plan',{workspace:'sender',selection,packageName:'agent-merchant'});
    const originalPrices=new Map(packageOriginal.plan.operations.map(row=>[row.method.toUpperCase()+' '+row.path,row.amountAtomic]));
    check(carried.preserved===sourceRows.length&&carried.plan.operations.every(row=>originalPrices.get(row.method+' '+row.path)===row.amountAtomic),'Original browser carry changed an exact approved route price.');
    await call('merchant_har_packages',{workspace:'sender',limit:1});
    const copied=await call('merchant_har_copy',{workspace:'sender',selection,destination:'handover'});
    const copyReplay=await call('merchant_har_copy',{workspace:'sender',selection,destination:'handover'});
    check(copyReplay.reused===true&&copied.state==='COMPLETE','Complete source copy did not reopen.');
    // Continue the actual copied source in both ownership directions, keeping
    // the original merchant's exact selected revision for the remaining journey.
    const copyDirectory=join(output,'complete-receiving-source'),receiverReview=structuredClone(saved.review);
    receiverReview.version='receiving-copy-revision';
    const receiverReviewFile=join(output,'receiving-copy-review.json');await write(receiverReviewFile,encode(receiverReview));
    const receivingOnly=await saveRefreshReview(copyDirectory,receiverReviewFile);
    const senderReview=structuredClone(saved.review);senderReview.version='sender-copy-revision';
    const continuedBytes=Buffer.from(encode(senderReview));await write(join(output,'continued-decisions.json'),continuedBytes);
    const nextReview=await call('merchant_har_decisions_save',{workspace:'sender',selection,file:'continued_decisions',expectedSha256:digest(continuedBytes)});
    const senderSource=await openRefresh(join(senderParent,'.har-captures','refresh',selection.id));
    const prior=(await readRevision(senderSource.previous,senderSource.manifest.lineage.previousReviewSha256)).review;
    prior.version='previous-copy-revision';
    const priorFile=join(output,'previous-copy-review.json');await write(priorFile,encode(prior));
    const previousAdditional=await saveReview(senderSource.previous.root,priorFile);
    const copyContinued=await call('merchant_har_copy',{workspace:'sender',selection,destination:'handover'});
    await call('merchant_har_copy',{workspace:'sender',selection:nextReview.native.selection,destination:'handover'});
    const receivedSource=await openRefresh(copyDirectory);
    await readRevision(receivedSource.candidate,selection.revision);
    await readRevision(receivedSource.candidate,nextReview.native.revision);
    await readRevision(receivedSource.candidate,receivingOnly.revision);
    await readRevision(receivedSource.previous,previousAdditional.revision);
    check(copyContinued.reused===true,'Later immutable reviews did not continue in the original receiving directory.');
    const copyContinuation={directory:copyDirectory,originalReview:selection.revision,
      senderReview:nextReview.native.revision,receivingOnlyReview:receivingOnly.revision,
      previousAdditionalReview:previousAdditional.revision};
    const adopted=await call('merchant_har_receive',{workspace:'receiver',fromWorkspace:'sender',selection});
    const receivingSelection=adopted.native.selection;
    const receivedPackage=await call('merchant_har_save',{workspace:'receiver',selection:receivingSelection,file:'terms',expectedSha256:digest(planBytes),name:'received-merchant'});
    const receiving=await readPackage(receiverParent,'received-merchant');
    check(receiving.specText===packageOriginal.specText&&canonical(receiving.plan)===canonical(packageOriginal.plan),'Independent receiving changed the original package.');
    const exports=[];
    for(const kind of ['reviewer','openapi','decisions','comparison'])
      exports.push(await call('merchant_har_export',{workspace:'sender',selection,kind}));
    await sender.close();sender=null;
    const chosenExport=exports.find(v=>v.manifest.kind==='reviewer'),downloadDirectory=join(output,'received-review');
    let interrupted=false;
    try{
      await downloadHarExport({url:endpoint,exportId:chosenExport.exportId,directory:downloadDirectory,
        tokenEnv:'HAR_NATIVE_MCP_TOKEN',environment,chunkSize:4096,onProgress:()=>{
          if(!interrupted){interrupted=true;throw Object.assign(new Error('Retained receiving continuation'),{code:'HAR_RECEIVING_CONTINUATION'});}
        }});
    }catch(error){if(error.code!=='HAR_RECEIVING_CONTINUATION')throw error;}
    check(interrupted,'The original retained download did not reach a durable receiving prefix.');
    await mcp.close();mcp=null;
    mcp=await startMerchantMcp({configPath:configured.configuration,port,tokenEnv:'HAR_NATIVE_MCP_TOKEN',environment});
    check(mcp.url===endpoint,'The receiving restart changed the selected download endpoint.');
    client=await openMerchantFileClient({url:endpoint,tokenEnv:'HAR_NATIVE_MCP_TOKEN',environment,errorPrefix:'HAR'});
    const downloaded=await downloadHarExport({url:endpoint,exportId:chosenExport.exportId,directory:downloadDirectory,
      tokenEnv:'HAR_NATIVE_MCP_TOKEN',environment,chunkSize:4096,expectedManifestSha256:chosenExport.manifestSha256});
    check(downloaded.resumed&&downloaded.resumedBytes>0,'The original downloader did not resume its retained prefix.');
    const originalFile=chosenExport.manifest.files[0],receivedBytes=await readRegular(join(downloadDirectory,originalFile.name),128*1024*1024,true);
    check(digest(receivedBytes)===originalFile.sha256,'The complete reviewer bytes changed after source shutdown and MCP restart.');
    const exportedOpenApi=exports.find(v=>v.manifest.kind==='openapi');
    await downloadHarExport({url:endpoint,exportId:exportedOpenApi.exportId,directory:join(output,'received-openapi'),
      tokenEnv:'HAR_NATIVE_MCP_TOKEN',environment,expectedManifestSha256:exportedOpenApi.manifestSha256});
    check((await readRegular(join(output,'received-openapi','openapi.json'),4*1024*1024,true)).equals(Buffer.from(packageOriginal.specText)),'Downloaded OpenAPI differs from the original native package.');
    await call('merchant_har_exports',{workspace:'sender',limit:1});
    await call('merchant_har_load',{workspace:'receiver',name:'received-merchant'});
    const sourceFiles={};
    for(const file of ['../har-workspace.mjs','../har-export.mjs','../har-download.mjs','../sf61-connection.mjs','../config.mjs','../operator.mjs','../serve.mjs'])
      sourceFiles[file]=digest(await readFile(new URL(file,import.meta.url)));
    const result={operation:'AF825-HAR-AGENT-WORKSPACE-20261012',node:process.version,platform:process.platform,
      directory:output,originalConsoleResult:resolve(consoleResult),sourceFiles,operations,
      selection,receivingSelection,copyContinuation,groups:groups.length,reviewOperations:reviews.length,changes:changes.length,
      merchant:{directory:receivedPackage.native.folder,routes:receiving.manifest.preview.routes,planSha256:digest(planBytes)},
      exports:exports.map(v=>({exportId:v.exportId,manifestSha256:v.manifestSha256,kind:v.manifest.kind,files:v.manifest.files})),
      resumed:downloaded,sourceConsoleClosed:true};
    await mcp.close();mcp=null;await receiver.close();receiver=null;
    await write(join(output,'result.json'),encode(result));return result;
  }catch(error){
    await write(join(output,'failure.json'),encode({operation:'AF825-HAR-AGENT-WORKSPACE-20261012',node:process.version,
      error:String(error.stack??error),operations}));throw error;
  }finally{
    const closed=await Promise.allSettled([mcp?.close(),receiver?.close(),sender?.close()]);
    const failures=closed.filter(v=>v.status==='rejected').map(v=>v.reason);
    if(failures.length)throw new AggregateError(failures,'Original receiving hosts did not finish closing.');
  }
}
export async function main(args=process.argv.slice(2)){
  const values=new Map();
  for(let i=0;i<args.length;i+=2){
    if(!['--console-result','--out'].includes(args[i])||values.has(args[i])||!args[i+1])throw new TypeError('Use --console-result ORIGINAL_RESULT.json --out NEW_PRIVATE_DIRECTORY');
    values.set(args[i],args[i+1]);
  }
  if(values.size!==2)throw new TypeError('Use --console-result ORIGINAL_RESULT.json --out NEW_PRIVATE_DIRECTORY');
  const result=await receiveHarAgent({consoleResult:values.get('--console-result'),output:values.get('--out')});
  process.stdout.write(encode(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(String(error.stack??error)+'\n');process.exitCode=1;});
