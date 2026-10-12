#!/usr/bin/env node
// MIT. Receive actual Cirrus captures and original STAC imagery through maintained controllers.
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {privateDirectory,readBytes,readJson,writeBytes,writeJson,exists,need}
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {canonicalJson,sha256} from '../provider.mjs';
import {openStacWorkspace} from '../workspace.mjs';
import {createProcessingController} from '../processing/workspace.mjs';
import {readCirrusSourceDocuments,cirrusWorkflowId} from '../processing/cirrus.mjs';
import {readProcessingHandover} from '../processing/portable.mjs';

const digest=value=>sha256(canonicalJson(value));
const now=()=>new Date().toISOString();
const same=async(path,bytes)=>{
  if(await exists(path))need((await readBytes(path,bytes.length)).equals(bytes),'CIRRUS_NATIVE_INPUT_CHANGED');
  else await writeBytes(path,bytes,{exclusive:true});
};

/** One complete actual receiving operation. The source package contains the exact
 * source connector carriers; all controller imports preserve that origin. The
 * reviewed continuation is prepared from the last original payload and consumes
 * its matching retained response. Direct provider capture remains available from
 * the same production controller's continue-page action.
 *
 * inspect is an optional same-process browser callback. It receives the reopened
 * recipient's original workspace/controller and closes before their owners close.
 */
export async function runCirrusReceivingJourney({
  directory,stacHandoverFile,sourcePackageFile,operationId='cirrus-native-b710-20261012',
  actor='B710 processing operator',inspect
}={}){
  directory=await privateDirectory(resolve(directory));
  const sourceBytes=await readBytes(resolve(sourcePackageFile),64*1024*1024);
  const handoverBytes=await readBytes(resolve(stacHandoverFile),256*1024*1024);
  const packageDocument=JSON.parse(sourceBytes),bundle=JSON.parse(handoverBytes);
  const documents=readCirrusSourceDocuments(sourceBytes);
  need(bundle.schema==='scf-stac-handover/v1','CIRRUS_NATIVE_ORIGINAL_STAC_HANDOVER_REQUIRED');
  const firstPage=documents.find(value=>Array.isArray(value.document?.items)&&value.document.items.length);
  need(firstPage,'CIRRUS_NATIVE_RUN_CAPTURE_REQUIRED');
  const workflowId=cirrusWorkflowId(firstPage.document.items[0]),query=new URL(firstPage.url).searchParams;
  const since=query.get('since'),state=query.get('state'),pageSize=Number(query.get('limit'));
  const originalEdition=bundle.editions.find(value=>value.status==='COMPLETE'||value.state==='COMPLETE');
  need(originalEdition,'CIRRUS_NATIVE_COMPLETED_STAC_EDITION_REQUIRED');
  const input={schema:'scf-stac-cirrus-native-plan/v1',operationId,actor,
    sourcePackageSha256:sha256(sourceBytes),stacHandoverSha256:sha256(handoverBytes),
    stacHandoverDigest:bundle.digest,stacEditionId:originalEdition.id,
    workflowId,since,state,pageSize};
  const planPath=join(directory,'plan.json');
  if(await exists(planPath))need(digest(await readJson(planPath))===digest(input),'CIRRUS_NATIVE_PLAN_CHANGED');
  else await writeJson(planPath,input,{exclusive:true});
  await same(join(directory,'source-package.json'),sourceBytes);
  await same(join(directory,'original-stac-handover.json'),handoverBytes);
  const op=name=>sha256(operationId+':'+name).slice(0,32);
  let scenes,processing,receivedScenes,receivedProcessing;
  try{
    scenes=await openStacWorkspace({directory:join(directory,'scenes'),endpoint:bundle.endpoint});
    const sceneReceipt=await scenes.importHandover(bundle);
    const nativeScene=await scenes.getEdition(originalEdition.id);
    processing=await createProcessingController({stacWorkspace:scenes,directory:join(directory,'processing'),
      config:{handoverDirectory:join(directory,'exports'),
        deployment:{id:packageDocument.deployment.id,title:'Earth Search Cirrus processing',
          baseUrl:packageDocument.deployment.baseUrl,dialect:'cirrus-state',
          metricsUrl:packageDocument.deployment.metricsUrl,pageSize},
        source:{bodyBase64:sourceBytes.toString('base64'),metadata:{
          url:packageDocument.deployment.baseUrl,status:null,capturedAt:null}}}});
    const saved=await processing.getState();
    const deployment=saved.deployments.find(value=>value.source.sha256===input.sourcePackageSha256);
    need(deployment,'CIRRUS_NATIVE_DEPLOYMENT_NOT_RETAINED');
    const invoke=(name,inputValue,operationName)=>processing.actions[name]({
      input:inputValue,operationId:op(operationName??name),stacWorkspace:scenes});
    const read=(name,value)=>processing.reads[name]({query:value,stacWorkspace:scenes});
    const inventory=await invoke('prepare-inventory',{deploymentKey:deployment.key},'inventory');
    async function receiveKnownPages(editionId){
      while(true){
        const opened=await read('edition',{editionId});
        const pending=opened.edition.tasks.find(task=>task.next&&['PENDING','RUNNING','PAUSED'].includes(task.state));
        if(!pending)return opened;
        const record=documents.find(value=>value.url===pending.next.url);
        need(record,'CIRRUS_NATIVE_MATCHING_CAPTURE_REQUIRED');
        await invoke('import-page',{editionId,taskId:pending.id,bodyBase64:record.body.toString('base64'),metadata:record.metadata},
          'page-'+sha256(record.url));
      }
    }
    await receiveKnownPages(inventory.id);
    const inventoryModel=await read('inventory',{editionId:inventory.id});
    const review=await invoke('review',{inventoryId:inventory.id,workflowIds:[workflowId],since,state,
      stacEditionId:originalEdition.id,details:['summary'],logs:false,actor,
      note:'Review native Cirrus processing alongside the original received scene edition; retain exact native identity comparisons.'},'review');
    const history=await invoke('prepare-capture',{reviewId:review.id},'history');
    await receiveKnownPages(history.id);
    const before=await read('edition',{editionId:history.id});
    const task=before.edition.tasks.find(value=>value.kind==='runs'&&value.scope.workflowId===workflowId);
    need(task,'CIRRUS_NATIVE_RUN_TASK_REQUIRED');
    const firstCapture=task.pages.find(value=>value.request.url===firstPage.url);
    need(firstCapture,'CIRRUS_NATIVE_FIRST_PAGE_REQUIRED');
    await invoke('prepare-continuation',{editionId:history.id,taskId:task.id,
      expectedCaptureSha256:firstCapture.sha256},'continuation');
    await receiveKnownPages(history.id);
    const originalRuns=await read('runs',{editionId:history.id}),statistics=await read('statistics',{editionId:history.id});
    const associations=await read('associations',{editionId:history.id});
    const openedHistory=await read('edition',{editionId:history.id});
    const expectedRuns=documents.filter(value=>Array.isArray(value.document?.items))
      .flatMap(value=>value.document.items).filter(value=>cirrusWorkflowId(value)===workflowId);
    const expectedById=new Map(expectedRuns.map(value=>[value.payload_id,value]));
    need(originalRuns.runs.length===expectedById.size&&originalRuns.runs.every(value=>
      canonicalJson(value.latest)===canonicalJson(expectedById.get(value.latest.payload_id))),
      'CIRRUS_NATIVE_ORIGINAL_RUNS_CHANGED');
    const exported=await invoke('export-handover',{editionIds:[history.id],includeStacAssets:true},'export');
    const packed=await read('handover',{exportId:exported.exportId});
    const packedBytes=Buffer.from(packed.contentBase64,'base64');
    await same(join(directory,'cirrus-native.processing.json.gz'),packedBytes);
    await readProcessingHandover({directory:exported.completeDirectory});
    receivedScenes=await openStacWorkspace({directory:join(directory,'received-scenes'),endpoint:bundle.endpoint});
    receivedProcessing=await createProcessingController({stacWorkspace:receivedScenes,directory:join(directory,'received-processing'),
      config:{receivingDirectory:join(directory,'received-inputs'),handoverDirectory:join(directory,'received-exports')}});
    const receive=()=>receivedProcessing.actions['import-handover']({input:{bodyBase64:packed.contentBase64},
      operationId:op('receive'),stacWorkspace:receivedScenes});
    const receipt=await receive(),repeatedReceipt=await receive();
    need(receipt.id===repeatedReceipt.id&&receipt.digest===exported.manifest.digest,'CIRRUS_NATIVE_RECEIPT_CHANGED');
    await receivedProcessing.close();receivedProcessing=null;
    await receivedScenes.close();receivedScenes=null;
    receivedScenes=await openStacWorkspace({directory:join(directory,'received-scenes'),create:false});
    receivedProcessing=await createProcessingController({stacWorkspace:receivedScenes,directory:join(directory,'received-processing'),
      config:{receivingDirectory:join(directory,'received-inputs'),handoverDirectory:join(directory,'received-exports')}});
    const receivedRead=(name,value)=>receivedProcessing.reads[name]({query:value,stacWorkspace:receivedScenes});
    const receivedRuns=await receivedRead('runs',{editionId:history.id});
    const receivedStatistics=await receivedRead('statistics',{editionId:history.id});
    const receivedAssociations=await receivedRead('associations',{editionId:history.id});
    const receivedNativeScene=await receivedScenes.getEdition(originalEdition.id);
    need(canonicalJson(receivedRuns)===canonicalJson(originalRuns)&&canonicalJson(receivedStatistics)===canonicalJson(statistics)&&
      canonicalJson(receivedAssociations)===canonicalJson(associations),'CIRRUS_NATIVE_RECEIVING_CHANGED');
    need(canonicalJson(receivedNativeScene.items)===canonicalJson(nativeScene.items),'CIRRUS_NATIVE_SCENES_CHANGED');
    const browser=inspect?await inspect({workspace:receivedScenes,processing:receivedProcessing,editionId:history.id,
      inventoryId:inventory.id,outputDirectory:join(directory,'browser')}):null;
    const transitions=statistics.statistics.at(-1)?.document.state_transitions??{};
    const result={schema:'scf-stac-cirrus-native-result/v1',operationId,status:'COMPLETE',completedAt:now(),input,
      nativeScene:{editionId:originalEdition.id,items:nativeScene.items.length,sourceReceipt:sceneReceipt,
        assets:nativeScene.assets.filter(value=>value.status==='COMPLETE').map(value=>({
          itemId:value.itemId,assetKey:value.assetKey,bytes:value.bytes,sha256:value.sha256}))},
      processing:{deploymentKey:deployment.key,inventoryId:inventory.id,editionId:history.id,
        workflows:inventoryModel.chains.find(value=>value.kind==='instances').records.length,
        runs:originalRuns.runs.length,payloadIds:originalRuns.runs.map(value=>value.latest.payload_id),
        tasks:openedHistory.edition.tasks.map(value=>({id:value.id,kind:value.kind,state:value.state,pages:value.pages.length,
          coverage:value.coverage??null,continuations:value.continuations??[]})),
        workflowCounts:statistics.summaries.map(value=>value.document),
        statisticPeriods:Object.fromEntries(Object.entries(transitions).map(([name,periods])=>[name,periods.length])),
        exactNativeAssociationCandidates:associations.proposals.runs.reduce((count,value)=>count+value.candidates.length,0)},
      receiving:{manifestDigest:exported.manifest.digest,files:exported.manifest.files.length,bytes:exported.manifest.bytes,
        packedBytes:packedBytes.length,packedSha256:sha256(packedBytes),receipt,repeatReceiptId:repeatedReceipt.id,
        reopenedRuns:receivedRuns.runs.length,reopenedScenes:receivedNativeScene.items.length},
      browser};
    await writeJson(join(directory,'result.json'),result);
    return {directory,result,exportDirectory:exported.completeDirectory,packedPath:join(directory,'cirrus-native.processing.json.gz')};
  }catch(error){
    await writeJson(join(directory,'last-error.json'),{at:now(),code:error.code??null,message:String(error.message??error).slice(0,2000)});
    throw error;
  }finally{
    await receivedProcessing?.close();await receivedScenes?.close();await processing?.close();await scenes?.close();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args={};
  for(let i=2;i<process.argv.length;i+=2){need(process.argv[i].startsWith('--')&&process.argv[i+1],'CIRRUS_NATIVE_ARGUMENT_REQUIRED');args[process.argv[i].slice(2)]=process.argv[i+1];}
  const opened=await runCirrusReceivingJourney({directory:args.directory,stacHandoverFile:args['stac-handover'],
    sourcePackageFile:args['source-package'],operationId:args['operation-id'],actor:args.actor});
  process.stdout.write(JSON.stringify(opened.result,null,2)+'\n');
}
