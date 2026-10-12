// MIT. Complete retained request, frozen delivery and editable customer receiving.
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {exists,jsonBytes,digest,parseJson} from '../../node/store.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {CUSTOMER_UPDATE_LIMIT,CUSTOMER_UPDATE_FORMATS,customerFields,customerIdentifier,customerRevision,
  customerHash,customerUpdateInput,customerText,requireCustomerUpdate as need} from './contracts.mjs';
import {customerUpdateDigest,customerUpdateSame} from './context.mjs';
import {withCustomerOperation,customerDirectory,readCustomerJson,retainCustomerJson,retainCustomerBytes,
  describeCustomerFile,copyCustomerFile,inspectCustomerPortable,inspectCustomerHandover,CUSTOMER_FILE_LIMIT} from './files.mjs';
const clone=value=>structuredClone(value),stamp=()=>new Date().toISOString();
const nativeId=value=>{need(typeof value==='string'&&/^d_[a-f0-9-]{36}$/.test(value),'DOSSIER_ID_INVALID');return value;};
async function status(client,workspaceId){
  need(client&&typeof client.status==='function'&&typeof client.customerUpdates==='function','CUSTOMER_UPDATE_ORIGINAL_CLIENT_REQUIRED');
  const value=await client.status();
  need(!workspaceId||value.workspaceId===workspaceId,'CUSTOMER_UPDATE_WORKSPACE_CHANGED');return value;
}
async function optionalInput(inputFile,expected){
  if(!inputFile||!await exists(resolve(inputFile)))return;
  const body=await readResearchHostFile(resolve(inputFile),CUSTOMER_UPDATE_LIMIT);
  need(digest(body)===expected.sha256&&body.length===expected.bytes,'CUSTOMER_UPDATE_INPUT_FILE_CHANGED');
}
export async function submitCustomerUpdate({client,directory,dossierId,inputFile,input}={}){
  const selectedId=nativeId(dossierId),selectedInput=input===undefined?undefined:clone(input),selectedFile=inputFile?resolve(inputFile):null;
  need((selectedInput===undefined)!==(selectedFile===null)||selectedInput===undefined&&selectedFile===null,
    'CUSTOMER_UPDATE_SELECT_ONE_REQUEST');
  return withCustomerOperation(directory,async root=>{
    const requestPath=join(root,'request.json'),resultPath=join(root,'result.json');
    let retained;
    if(await exists(requestPath)){
      retained=(await readCustomerJson(requestPath,CUSTOMER_UPDATE_LIMIT+65536)).value;
      need(retained.schema==='sf88-research-customer-saved-request/v1'&&retained.dossierId===selectedId&&
        retained.requestSha256===customerUpdateDigest(customerUpdateInput(retained.request)),'CUSTOMER_UPDATE_RETAINED_REQUEST_CHANGED');
      if(selectedInput!==undefined)need(customerUpdateSame(customerUpdateInput(selectedInput),retained.request),'CUSTOMER_UPDATE_REQUEST_CHANGED');
      await optionalInput(selectedFile,retained.input);
      const body=await readResearchHostFile(join(root,'input.json'),CUSTOMER_UPDATE_LIMIT,{sha256:retained.input.sha256});
      need(body.length===retained.input.bytes&&customerUpdateSame(customerUpdateInput(parseJson(body)),retained.request),
        'CUSTOMER_UPDATE_RETAINED_REQUEST_CHANGED');
    }else{
      need(selectedInput!==undefined||selectedFile,'CUSTOMER_UPDATE_REQUEST_REQUIRED');
      const body=selectedFile?await readResearchHostFile(selectedFile,CUSTOMER_UPDATE_LIMIT):jsonBytes(selectedInput),
        request=customerUpdateInput(parseJson(body)),original=await status(client);
      await retainCustomerBytes(root,'input.json',body);
      retained={schema:'sf88-research-customer-saved-request/v1',workspaceId:original.workspaceId,dossierId:selectedId,
        request,requestSha256:customerUpdateDigest(request),input:{bytes:body.length,sha256:digest(body)},createdAt:stamp()};
      await retainCustomerJson(root,'request.json',retained);
    }
    if(await exists(resultPath)){
      const saved=(await readCustomerJson(resultPath,CUSTOMER_UPDATE_LIMIT+65536)).value;
      need(saved.requestSha256===retained.requestSha256&&saved.workspaceId===retained.workspaceId&&
        saved.result?.operation?.requestSha256===retained.requestSha256,'CUSTOMER_UPDATE_RETAINED_RESULT_CHANGED');
      return {...saved,reused:true,directory:root};
    }
    await status(client,retained.workspaceId);
    const result=await client.customerUpdates().review(retained.dossierId,retained.request);
    const saved={schema:'sf88-research-customer-saved-result/v1',workspaceId:retained.workspaceId,dossierId:retained.dossierId,
      requestSha256:retained.requestSha256,result,completedAt:stamp()};
    await retainCustomerJson(root,'result.json',saved);return {...saved,reused:false,directory:root};
  });
}
export async function findCustomerRecord(client,id,section,recordId,{revision,projectId}={}){
  let offset=0,selectedRevision=revision;
  for(;;){
    const page=await client.customerUpdates().list(id,{section,revision:selectedRevision,projectId,offset,limit:100});
    selectedRevision=page.revision;
    const row=page.items.find(value=>value.id===recordId);if(row)return {record:row,revision:selectedRevision};
    need(page.nextOffset!==null,'CUSTOMER_UPDATE_SELECTED_RECORD_NOT_FOUND');
    offset=page.nextOffset;
  }
}
async function exportFile(root,name,expected,produce){
  const path=join(root,name);
  if(!await exists(path))await produce(path);
  return describeCustomerFile(path,expected);
}
function sourceWorkspaceInput(value){
  if(value===undefined||value===null)return null;
  customerFields(value,['library','actor','requestId'],'CUSTOMER_UPDATE_SOURCE_WORKSPACE_FIELDS_INVALID');
  need(typeof value.library==='string'&&/^(?:original|received-[a-f0-9]{64})$/.test(value.library),
    'CUSTOMER_UPDATE_SOURCE_WORKSPACE_SELECTION_REQUIRED');
  customerText(value.actor,'CUSTOMER_UPDATE_SOURCE_ACTOR_REQUIRED',200);
  need(typeof value.requestId==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(value.requestId),'CUSTOMER_UPDATE_SOURCE_REQUEST_ID_REQUIRED');
  return clone(value);
}
export async function createCustomerHandover({client,directory,dossierId,deliveryId,revision,sourceWorkspace}={}){
  const requested={dossierId:nativeId(dossierId),deliveryId:customerIdentifier(deliveryId),
    revision:revision===undefined?null:customerRevision(revision),sourceWorkspace:sourceWorkspaceInput(sourceWorkspace)};
  return withCustomerOperation(directory,async root=>{
    const selectionPath=join(root,'selection.json');
    let retained;
    if(await exists(selectionPath)){
      retained=(await readCustomerJson(selectionPath)).value;
      need(customerUpdateSame(retained.request,requested),'CUSTOMER_UPDATE_HANDOVER_REQUEST_CHANGED');
      if(await exists(join(root,'handover.json'))){
        const completed=await inspectCustomerHandover(root);
        need(customerUpdateSame(completed.selection,retained.selection),'CUSTOMER_UPDATE_HANDOVER_SELECTION_CHANGED');
        return {...completed,reused:true};
      }
    }else{
      const original=await status(client);
      const selected=await findCustomerRecord(client,requested.dossierId,'deliveries',requested.deliveryId,
        {revision:requested.revision??undefined});
      const delivery=selected.record,work=(await findCustomerRecord(client,requested.dossierId,'work',delivery.workId,
        {revision:delivery.revision})).record;
      need(work.sha256===delivery.workSha256,'CUSTOMER_UPDATE_WORK_CHANGED');
      retained={schema:'sf88-research-customer-handover-selection/v1',request:requested,createdAt:stamp(),
        selection:{workspaceId:original.workspaceId,dossierId:requested.dossierId,revision:delivery.revision,
          projectId:delivery.projectId,delivery,work,sourceWorkspace:requested.sourceWorkspace}};
      await retainCustomerJson(root,'selection.json',retained);
    }
    const selected=retained.selection;let connected=false;
    const connect=async()=>{if(!connected){await status(client,selected.workspaceId);connected=true;}};
    const files=[];
    for(const report of selected.delivery.files){
      const file=await exportFile(root,report.name,{sha256:report.sha256,bytes:report.bytes,maximum:CUSTOMER_FILE_LIMIT},
        async path=>{await connect();await client.customerUpdates().export(selected.dossierId,{
          deliveryId:selected.delivery.id,revision:selected.revision,format:report.format,file:path,expectedSha256:report.sha256});});
      files.push({name:report.name,kind:'report',format:report.format,bytes:file.bytes,sha256:file.sha256,contentType:report.contentType});
    }
    const work=await exportFile(root,'work.review.json',{sha256:selected.work.snapshot.sha256,bytes:selected.work.snapshot.bytes,maximum:CUSTOMER_FILE_LIMIT},
      async path=>{await connect();await client.customerUpdates().export(selected.dossierId,{revision:selected.revision,
        workId:selected.work.id,format:'json',file:path,expectedSha256:selected.work.snapshot.sha256});});
    files.push({name:'work.review.json',kind:'work',bytes:work.bytes,sha256:work.sha256,contentType:'application/json; charset=utf-8'});
    const portable=await exportFile(root,'dossier.research.json.gz',{},async path=>{
      await connect();await client.customerUpdates().export(selected.dossierId,{revision:selected.revision,
        deliveryId:selected.delivery.id,format:'portable.gz',file:path});});
    await inspectCustomerPortable(portable.path,{dossierId:selected.dossierId,delivery:selected.delivery,
      expectedWork:selected.work,expectedSha256:portable.sha256,expectedBytes:portable.bytes});
    files.push({name:'dossier.research.json.gz',kind:'dossier',bytes:portable.bytes,sha256:portable.sha256,contentType:'application/gzip'});
    if(selected.sourceWorkspace){
      const source=selected.sourceWorkspace,receiptPath=join(root,'source-workspace-export.json');let receipt;
      if(await exists(receiptPath))receipt=(await readCustomerJson(receiptPath)).value;
      else{
        await connect();const epmc=client.europePmc(),list=await epmc.list({limit:1});
        need(list.selection.library===source.library,'CUSTOMER_UPDATE_SOURCE_WORKSPACE_CHANGED');
        const payload=(await readCustomerJson(join(root,'work.review.json'))).value;
        need(payload.context.brief.definition.sourcePlans.some(plan=>plan.original?.kind==='EUROPE_PMC_QUERY'&&
          plan.original.workspaceId===list.id),'CUSTOMER_UPDATE_SOURCE_WORKSPACE_UNRELATED');
        receipt=await epmc.exportWorkspace({requestId:source.requestId,actor:source.actor});
        await retainCustomerJson(root,'source-workspace-export.json',receipt);
      }
      const archive=await exportFile(root,'europe-pmc.workspace.json.gz',{sha256:receipt.sha256,bytes:receipt.bytes,maximum:128*1024*1024},
        async path=>{
          await connect();const epmc=client.europePmc(),list=await epmc.list({limit:1});
          need(list.selection.library===source.library,'CUSTOMER_UPDATE_SOURCE_WORKSPACE_CHANGED');
          await epmc.downloadWorkspace({requestId:source.requestId,file:path,expectedSha256:receipt.sha256});
        });
      files.push({name:'europe-pmc.workspace.json.gz',kind:'europe-pmc',bytes:archive.bytes,sha256:archive.sha256,contentType:'application/gzip'});
    }
    const manifest={schema:'sf88-research-customer-handover/v1',createdAt:retained.createdAt,selection:clone(selected),files};
    await retainCustomerJson(root,'handover.json',manifest);
    return {...await inspectCustomerHandover(root),reused:false};
  });
}
export async function receiveCustomerHandover({client,directory,sourceDirectory,manifestSha256,sourceActor}={}){
  if(manifestSha256!==undefined)customerHash(manifestSha256);
  const inputDirectory=sourceDirectory?resolve(sourceDirectory):null;
  return withCustomerOperation(directory,async root=>{
    const inputRoot=await customerDirectory(join(root,'input')),preparedPath=join(root,'receiving.json'),
      resultPath=join(root,'result.json'),retainedManifest=join(inputRoot,'handover.json');
    let source,prepared;
    if(await exists(retainedManifest))source=await inspectCustomerHandover(inputRoot,{manifestSha256});
    else{
      need(inputDirectory,'CUSTOMER_UPDATE_HANDOVER_SOURCE_REQUIRED');
      source=await inspectCustomerHandover(inputDirectory,{manifestSha256});
      // Complete original input files precede any original receiver mutation.
      for(const file of source.files)await copyCustomerFile(file.path,join(inputRoot,file.name),{sha256:file.sha256,bytes:file.bytes,
        maximum:file.kind==='europe-pmc'?128*1024*1024:file.kind==='dossier'?256*1024*1024:CUSTOMER_FILE_LIMIT});
      await copyCustomerFile(join(inputDirectory,'handover.json'),retainedManifest,{sha256:source.manifestSha256,
        bytes:source.manifestBytes,maximum:CUSTOMER_FILE_LIMIT});
      source=await inspectCustomerHandover(inputRoot,{manifestSha256:source.manifestSha256});
    }
    if(inputDirectory&&await exists(join(inputDirectory,'handover.json'))){
      const current=await readCustomerJson(join(inputDirectory,'handover.json'));
      need(current.sha256===source.manifestSha256,'CUSTOMER_UPDATE_HANDOVER_SOURCE_CHANGED');
    }
    if(await exists(preparedPath)){
      prepared=(await readCustomerJson(preparedPath)).value;
      need(prepared.manifestSha256===source.manifestSha256&&customerUpdateSame(prepared.selection,source.selection)&&
        (sourceActor===undefined||sourceActor===prepared.sourceActor),'CUSTOMER_UPDATE_RECEIVING_REQUEST_CHANGED');
    }else{
      const original=await status(client);
      if(source.selection.sourceWorkspace)customerText(sourceActor,'CUSTOMER_UPDATE_RECEIVING_SOURCE_ACTOR_REQUIRED',200);
      prepared={schema:'sf88-research-customer-receiving-request/v1',workspaceId:original.workspaceId,
        manifestSha256:source.manifestSha256,selection:clone(source.selection),
        sourceRequestId:randomUUID(),sourceActor:sourceActor??null,createdAt:stamp()};
      await retainCustomerJson(root,'receiving.json',prepared);
    }
    if(await exists(resultPath)){
      const saved=(await readCustomerJson(resultPath)).value;
      need(saved.manifestSha256===prepared.manifestSha256&&saved.workspaceId===prepared.workspaceId&&
        saved.dossierId===prepared.selection.dossierId&&saved.deliveryId===prepared.selection.delivery.id,
        'CUSTOMER_UPDATE_RECEIVING_RESULT_CHANGED');
      return {...saved,directory:root,reused:true};
    }
    await status(client,prepared.workspaceId);
    const dossierFile=source.files.find(row=>row.kind==='dossier'),nativePath=join(root,'native-dossier.json');let dossier;
    if(await exists(nativePath))dossier=(await readCustomerJson(nativePath)).value;
    else{
      dossier=await client.reopenFile(dossierFile.path,{expectedSha256:dossierFile.sha256});
      need(dossier.dossier?.id===source.selection.dossierId&&dossier.source?.sha256===dossierFile.sha256&&
        dossier.source.bytes===dossierFile.bytes,'CUSTOMER_UPDATE_RECEIVING_DOSSIER_CHANGED');
      await retainCustomerJson(root,'native-dossier.json',dossier);
    }
    let sourceWorkspace=null;
    const sourceFile=source.files.find(row=>row.kind==='europe-pmc');
    if(sourceFile){
      const sourcePath=join(root,'native-source-workspace.json');
      if(await exists(sourcePath))sourceWorkspace=(await readCustomerJson(sourcePath)).value;
      else{
        sourceWorkspace=await client.europePmc().restoreFile({requestId:prepared.sourceRequestId,actor:prepared.sourceActor,
          file:sourceFile.path,expectedSha256:sourceFile.sha256});
        await retainCustomerJson(root,'native-source-workspace.json',sourceWorkspace);
      }
    }
    const delivery=(await findCustomerRecord(client,source.selection.dossierId,'deliveries',source.selection.delivery.id,
      {revision:source.selection.revision})).record;
    need(customerUpdateSame(delivery,source.selection.delivery),'CUSTOMER_UPDATE_RECEIVED_DELIVERY_CHANGED');
    const reviewed=await client.customerUpdates().work(source.selection.dossierId,{workId:source.selection.work.id,
      revision:source.selection.revision,section:'overview'});
    need(reviewed.workId===source.selection.work.id&&reviewed.fingerprint===source.selection.work.contextFingerprint,
      'CUSTOMER_UPDATE_RECEIVED_WORK_CHANGED');
    const saved={schema:'sf88-research-customer-receiving-result/v1',workspaceId:prepared.workspaceId,
      manifestSha256:source.manifestSha256,dossierId:source.selection.dossierId,projectId:source.selection.projectId,
      deliveryId:delivery.id,revision:source.selection.revision,dossier,sourceWorkspace,completedAt:stamp()};
    await retainCustomerJson(root,'result.json',saved);return {...saved,directory:root,reused:false};
  });
}
export async function readCustomerOperation(directory){
  const root=await customerDirectory(directory,{create:false});
  const files={};
  for(const name of ['request.json','selection.json','receiving.json','result.json','handover.json'])
    if(await exists(join(root,name)))files[name]=(await readCustomerJson(join(root,name),CUSTOMER_UPDATE_LIMIT+1024*1024)).value;
  return {schema:'sf88-research-customer-operation-inspected/v1',directory:root,files};
}

export async function retainCustomerExport({client,directory,dossierId,deliveryId,workId,revision,format='json',expectedSha256}={}){
  const requested={dossierId:nativeId(dossierId),deliveryId:deliveryId??null,workId:workId??null,
    revision:revision===undefined?null:customerRevision(revision),format,expectedSha256:expectedSha256??null};
  need((requested.deliveryId===null)!==(requested.workId===null),'CUSTOMER_UPDATE_EXPORT_SELECTION_REQUIRED');
  customerIdentifier(requested.deliveryId??requested.workId);
  need(['json','md','html','csv','portable','portable.gz'].includes(format)&&
    (requested.workId===null||format==='json'),'CUSTOMER_UPDATE_EXPORT_FORMAT_INVALID');
  if(expectedSha256!==undefined)customerHash(expectedSha256);
  return withCustomerOperation(directory,async root=>{
    const selectionPath=join(root,'export.json'),resultPath=join(root,'result.json');let retained;
    if(await exists(selectionPath)){
      retained=(await readCustomerJson(selectionPath)).value;
      need(customerUpdateSame(retained.request,requested),'CUSTOMER_UPDATE_EXPORT_REQUEST_CHANGED');
    }else{
      const original=await status(client),section=requested.workId?'work':'deliveries';
      const selected=(await findCustomerRecord(client,requested.dossierId,section,requested.workId??requested.deliveryId,
        {revision:requested.revision??undefined})).record;
      const file=requested.workId?{name:selected.id+'.review.json',contentType:'application/json; charset=utf-8',...selected.snapshot}:
        format.startsWith('portable')?{name:selected.id+'.dossier.json'+(format==='portable.gz'?'.gz':''),
          contentType:format==='portable.gz'?'application/gzip':'application/json; charset=utf-8'}:
          selected.files.find(row=>row.format===format);
      need(file,'CUSTOMER_UPDATE_EXPORT_FILE_NOT_FOUND');
      if(expectedSha256!==undefined&&file.sha256)need(file.sha256===expectedSha256,'CUSTOMER_UPDATE_EXPECTED_FILE_CHANGED');
      retained={schema:'sf88-research-customer-export-selection/v1',request:requested,workspaceId:original.workspaceId,
        selected,file,createdAt:stamp()};
      await retainCustomerJson(root,'export.json',retained);
    }
    if(await exists(resultPath)){
      const saved=(await readCustomerJson(resultPath)).value;
      need(saved.requestSha256===customerUpdateDigest(requested)&&saved.workspaceId===retained.workspaceId,
        'CUSTOMER_UPDATE_EXPORT_RESULT_CHANGED');
      await describeCustomerFile(join(root,retained.file.name),{sha256:saved.file.sha256,bytes:saved.file.bytes});
      return {...saved,file:{...saved.file,path:join(root,retained.file.name)},directory:root,reused:true};
    }
    const file=await exportFile(root,retained.file.name,{
      sha256:retained.file.sha256??requested.expectedSha256??undefined,bytes:retained.file.bytes},
      async path=>{await status(client,retained.workspaceId);await client.customerUpdates().export(requested.dossierId,{
        ...(requested.deliveryId?{deliveryId:requested.deliveryId}:{workId:requested.workId}),
        revision:retained.selected.revision,format:requested.format,file:path,
        ...(retained.file.sha256||requested.expectedSha256?{expectedSha256:retained.file.sha256??requested.expectedSha256}:{})});});
    if(requested.format.startsWith('portable'))await inspectCustomerPortable(file.path,{
      dossierId:requested.dossierId,delivery:retained.selected,expectedSha256:file.sha256,expectedBytes:file.bytes});
    const result={schema:'sf88-research-customer-export-result/v1',workspaceId:retained.workspaceId,
      requestSha256:customerUpdateDigest(requested),selection:retained.selected,
      file:{name:file.name,bytes:file.bytes,sha256:file.sha256,contentType:retained.file.contentType},completedAt:stamp()};
    await retainCustomerJson(root,'result.json',result);return {...result,file:{...result.file,path:file.path},directory:root,reused:false};
  });
}
