// MIT. Whole customer-delivery continuation inside the existing native Research programme.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {exists} from '../../node/store.mjs';
import {customerFields,customerActor,customerBrief,customerList,customerText,requireCustomerUpdate as need} from './contracts.mjs';
import {customerUpdateDigest,customerUpdateSame} from './context.mjs';
import {withCustomerOperation,customerDirectory,retainCustomerJson,readCustomerJson,inspectCustomerHandover} from './files.mjs';
import {submitCustomerUpdate,createCustomerHandover,receiveCustomerHandover,findCustomerRecord} from './operator.mjs';
const clone=value=>structuredClone(value);
function selectedCase(value){
  customerFields(value,['schema','name','dossierId','actor','baseline','update','correction','sourceWorkspace','receivingSourceActor']);
  need(value.schema==='sf88-research-customer-delivery-case/v1'&&/^d_[a-f0-9-]{36}$/.test(value.dossierId),
    'CUSTOMER_UPDATE_ORIGINAL_CASE_REQUIRED');
  customerText(value.name,'CUSTOMER_UPDATE_CASE_NAME_REQUIRED',240);customerActor(value.actor);
  for(const name of ['baseline','update','correction']){
    const stage=value[name];customerFields(stage,['brief','briefReason','request','requestRevision','requestRevisionReason',
      'intakes','records','review','delivery','deliveryEvent','expectedChangeCounts'],'CUSTOMER_UPDATE_CASE_STAGE_INVALID');
    need(stage.request&&stage.review&&stage.delivery,'CUSTOMER_UPDATE_CASE_STAGE_REQUIRED');
    customerList(stage.intakes,'CUSTOMER_UPDATE_ORIGINAL_INTAKES_REQUIRED',100);
    need(stage.intakes.length>0,'CUSTOMER_UPDATE_ORIGINAL_INTAKES_REQUIRED');
    customerList(stage.records??[],'CUSTOMER_UPDATE_NATIVE_RECORDS_INVALID',1000);
  }
  customerBrief(value.baseline.brief);customerBrief(value.update.brief);
  customerText(value.update.briefReason,'CUSTOMER_UPDATE_BRIEF_REASON_REQUIRED',20000);
  need(value.update.requestRevision,'CUSTOMER_UPDATE_CHANGED_REQUEST_REQUIRED');
  customerText(value.update.requestRevisionReason,'CUSTOMER_UPDATE_REQUEST_REASON_REQUIRED',20000);
  return clone(value);
}
export async function runResearchCustomerDelivery({sender,receiver,directory,caseDefinition}={}){
  const selected=selectedCase(caseDefinition),caseSha256=customerUpdateDigest(selected);
  need(sender&&receiver&&typeof sender.metadata==='function'&&typeof receiver.metadata==='function',
    'CUSTOMER_UPDATE_EXISTING_NATIVE_CLIENTS_REQUIRED');
  return withCustomerOperation(directory,async root=>{
    await retainCustomerJson(root,'case.json',selected);
    const finalPath=join(root,'result.json');
    if(await exists(finalPath)){
      const saved=(await readCustomerJson(finalPath)).value;
      need(saved.caseSha256===caseSha256,'CUSTOMER_UPDATE_NATIVE_CASE_CHANGED');
      await inspectCustomerHandover(join(root,'delivery'));
      await inspectCustomerHandover(join(root,'correction-delivery'));
      return {...saved,reused:true};
    }
    const senderIdentity=await sender.status(),receiverIdentity=await receiver.status();
    await retainCustomerJson(root,'workspaces.json',{sender:senderIdentity.workspaceId,receiver:receiverIdentity.workspaceId,dossierId:selected.dossierId});
    const steps=await customerDirectory(join(root,'steps'));
    async function save(label,client,action,build){
      const directory=await customerDirectory(join(steps,label)),requestPath=join(directory,'request.json');
      if(await exists(requestPath))return (await submitCustomerUpdate({client,directory,dossierId:selected.dossierId})).result;
      const current=await client.metadata(selected.dossierId),data=await build(current.revision,directory);
      const request={requestId:'customer-'+label+'-'+randomUUID(),expectedRevision:current.revision,actor:clone(selected.actor),action,data};
      return (await submitCustomerUpdate({client,directory,dossierId:selected.dossierId,input:request})).result;
    }
    async function updateRequest(label,client,recipe,projectId,briefId,kind,previousDeliveryId){
      let result=await save(label+'-request',client,'request-update',async()=>({
        projectId,definition:{...clone(recipe.request),briefId,kind,previousDeliveryId}
      }));
      if(recipe.requestRevision)result=await save(label+'-request-revision',client,'revise-request',async()=>({
        projectId,cycleId:result.operation.result.updateRequest.cycleId,
        expectedRequestEditionId:result.operation.result.updateRequest.id,
        definition:{...clone(recipe.requestRevision),briefId,kind,previousDeliveryId},
        reason:recipe.requestRevisionReason
      }));
      return result.operation.result.updateRequest;
    }
    async function work(label,client,recipe,projectId,requested){
      const intakeIds=[];
      for(let index=0;index<recipe.intakes.length;index++){
        const result=await save(label+'-intake-'+String(index+1).padStart(3,'0'),client,'attach-intake',async()=>({
          ...clone(recipe.intakes[index]),projectId,cycleId:requested.cycleId,requestEditionId:requested.id
        }));
        intakeIds.push(result.operation.result.intake.id);
      }
      const selection={intakeIds,records:clone(recipe.records??[])};
      const reviewed=await save(label+'-work',client,'review-work',async(revision,directory)=>{
        const input={revision,projectId,cycleId:requested.cycleId,requestEditionId:requested.id,selection},
          preview=await client.customerUpdates().preview(selected.dossierId,input);
        if(recipe.expectedChangeCounts)for(const [key,value]of Object.entries(recipe.expectedChangeCounts))
          need(preview.changeCounts[key]===value,'CUSTOMER_UPDATE_ACTUAL_SOURCE_CHANGE_COUNTS_DIFFER');
        await retainCustomerJson(directory,'preview-'+revision+'-'+preview.fingerprint+'.json',preview);
        return {...clone(recipe.review),projectId,cycleId:requested.cycleId,requestEditionId:requested.id,
          selection,fingerprint:preview.fingerprint};
      });
      const frozen=reviewed.operation.result.work;
      const delivered=await save(label+'-delivery',client,'publish-delivery',async()=>({
        ...clone(recipe.delivery),projectId,workId:frozen.id,expectedWorkSha256:frozen.sha256
      }));
      const delivery=delivered.operation.result.delivery;
      if(recipe.deliveryEvent)await save(label+'-response',client,'record-delivery',async()=>({
        ...clone(recipe.deliveryEvent),projectId,deliveryId:delivery.id
      }));
      return {request:requested,work:frozen,delivery};
    }
    const created=await save('baseline-project',sender,'create-project',async()=>({brief:clone(selected.baseline.brief)})),
      projectId=created.operation.result.project.id,baselineBrief=created.operation.result.brief;
    const baselineRequest=await updateRequest('baseline',sender,selected.baseline,projectId,baselineBrief.id,'BASELINE',null);
    const baseline=await work('baseline',sender,selected.baseline,projectId,baselineRequest);
    const revised=await save('update-brief',sender,'revise-brief',async()=>({
      projectId,expectedBriefId:baselineBrief.id,brief:clone(selected.update.brief),reason:selected.update.briefReason
    }));
    const updatedBrief=revised.operation.result.brief;
    const updateRequested=await updateRequest('update',sender,selected.update,projectId,updatedBrief.id,'UPDATE',baseline.delivery.id);
    const update=await work('update',sender,selected.update,projectId,updateRequested);
    const handover=await createCustomerHandover({client:sender,directory:join(root,'delivery'),dossierId:selected.dossierId,
      deliveryId:update.delivery.id,sourceWorkspace:selected.sourceWorkspace});
    const received=await receiveCustomerHandover({client:receiver,directory:join(root,'receiving'),sourceDirectory:handover.directory,
      manifestSha256:handover.manifestSha256,sourceActor:selected.receivingSourceActor});
    need(received.dossierId===selected.dossierId&&received.projectId===projectId&&received.deliveryId===update.delivery.id,
      'CUSTOMER_UPDATE_NATIVE_RECEIVING_IDENTITY_CHANGED');
    const correctionRequest=await updateRequest('correction',receiver,selected.correction,projectId,updatedBrief.id,'CORRECTION',update.delivery.id);
    const correction=await work('correction',receiver,selected.correction,projectId,correctionRequest);
    const correctionHandover=await createCustomerHandover({client:receiver,directory:join(root,'correction-delivery'),
      dossierId:selected.dossierId,deliveryId:correction.delivery.id});
    const replayPath=join(root,'original-request-replays.json');let replays;
    if(await exists(replayPath))replays=(await readCustomerJson(replayPath)).value;
    else{
      const first=(await readCustomerJson(join(steps,'baseline-project','request.json'))).value.request,
        later=(await readCustomerJson(join(steps,selected.correction.requestRevision?'correction-request-revision':'correction-request','request.json'))).value.request;
      const original=await sender.customerUpdates().review(selected.dossierId,first),
        receiving=await receiver.customerUpdates().review(selected.dossierId,later);
      need(original.duplicate===true&&original.operation.id===created.operation.id&&original.dossier.revision>=update.delivery.revision&&
        receiving.duplicate===true&&receiving.operation.result.updateRequest.id===correctionRequest.id&&
        receiving.dossier.revision>=correction.delivery.revision,'CUSTOMER_UPDATE_ORIGINAL_NATIVE_REPLAY_CHANGED');
      replays={original,receiving};await retainCustomerJson(root,'original-request-replays.json',replays);
    }
    const result={schema:'sf88-research-customer-delivery-native-result/v1',caseSha256,name:selected.name,directory:root,
      source:{workspaceId:senderIdentity.workspaceId,dossierId:selected.dossierId},receiver:{workspaceId:receiverIdentity.workspaceId},
      projectId,baseline,update,correction,
      delivery:{directory:handover.directory,manifestSha256:handover.manifestSha256,files:handover.manifest.files},
      receiving:received,correctionDelivery:{directory:correctionHandover.directory,manifestSha256:correctionHandover.manifestSha256,
        files:correctionHandover.manifest.files},replays,completedAt:new Date().toISOString()};
    await retainCustomerJson(root,'result.json',result);return {...result,reused:false};
  });
}
