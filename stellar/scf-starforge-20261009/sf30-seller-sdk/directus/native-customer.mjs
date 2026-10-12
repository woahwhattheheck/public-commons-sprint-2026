#!/usr/bin/env node
// MIT. One original Directus service through native editing, edition refresh and customer receiving.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile,rename,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openDirectusWorkspace,receiveDirectusWorkspace} from './workspace.mjs';
import {performDirectusOperation} from './operations.mjs';
import {prepareDirectusMerchant,startDirectusMerchant,publishDirectusMerchant} from './merchant.mjs';
import {reviewDirectusBuyer,prepareDirectusBuyer,receiveDirectusBuyer,inspectDirectusDelivery} from './customer.mjs';
import {datasetControl} from '../dataset-refresh/service.mjs';
import {X402BuyerClient} from '../../sf31-buyer-client/buyer.mjs';
import {prepareBuyerResponseFile} from '../../sf31-buyer-client/response-file.mjs';
import {executeWithEvidence} from '../../sf82-checkout-evidence/evidence.mjs';
import {createDatasetSession,runDatasetSession,inspectDatasetSession} from '../../sf88-operator-buyer-cli/dataset-session.mjs';
import {createAttemptWireRecorder} from '../../sf88-operator-buyer-cli/attempt-wire.mjs';
import {saveExact,copyExact,exists,digest,identity,privateDirectory,readJson,acquireWorkspace} from '../dspace/merchant-files.mjs';

export async function runDirectusCustomer({input,directory,token=process.env.DIRECTUS_TOKEN}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||!/^[A-Za-z0-9_.:-]{8,100}$/.test(input.operationId??'')||
      typeof input.collection!=='string'||typeof input.item!=='string'||typeof input.patchJson!=='string'||
      !Array.isArray(input.fields)||!input.fields.length||!input.rights||!input.payment)
    throw new TypeError('Use an original operationId, API baseUrl, isolated collection/item, exact patchJson, selected fields, rights and public payment terms.');
  input={...input,baseUrl:input.baseUrl??process.env.DIRECTUS_BASE_URL};
  if(typeof input.baseUrl!=='string'||!input.baseUrl)throw new TypeError('Set the original Directus API baseUrl before starting this customer operation.');
  directory=resolve(directory);await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory);
  let workspace,merchant,freeServer;
  const intent={schema:'stellar-forge.directus-native-customer-intent.v1',input,directory};
  const operationId=phase=>'customer-'+digest(Buffer.from(input.operationId+'\n'+phase)).slice(0,48);
  const output=join(directory,'CUSTOMER_RESULT.json'),progress=join(directory,'progress.json');
  const connection={baseUrl:input.baseUrl,token};
  const actor=input.actor??'Directus native customer';
  let requests=0,signatures=0;
  const phases=[];
  async function record(name,result){
    const prior=phases.find(p=>p.name===name);
    if(prior)return prior;
    const entry={name,recorded_at:new Date().toISOString(),...result};phases.push(entry);
    const temporary=progress+'.partial-'+randomUUID();
    try{
      await writeFile(temporary,JSON.stringify({schema:'stellar-forge.directus-native-customer-progress.v1',operationId:input.operationId,phases},null,2)+'\n',{flag:'wx',mode:0o600});
      const handle=await open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
      await rename(temporary,progress);
      const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
    }catch(error){throw error;}
    process.stdout.write(JSON.stringify({phase:name,...result})+'\n');return entry;
  }
  async function mutate(action,phase,value){
    const id=operationId(phase);let previous;
    try{previous=workspace.operation(id);}catch(error){if(error.code!=='DIRECTUS_OPERATION_MISSING')throw error;}
    return workspace.dispatch(action,{...value,actor,operationId:id,expectedRevision:previous?.input.expectedRevision??workspace.revision()});
  }
  const native=(action,phase,value)=>performDirectusOperation({workspace,connection,action,input:{...value,actor,operationId:operationId(phase)}});
  async function edition(source,phase,{previousEditionId,nativeOperationIds=[]}={}){
    const saved=await mutate('save-edition',phase,{name:input.name??'Directus customer collection',mode:'collection',
      selection:[{sourceId:source.id,sourceSha256:source.sha256,collection:input.collection}],
      metadataFields:input.fields,rights:input.rights,...(previousEditionId?{previousEditionId}:{}),nativeOperationIds});
    const reviewed=await mutate('review-edition',phase+'-review',{editionId:saved.edition.id,editionSha256:saved.edition.sha256,
      decision:'approved',comment:input.reviewComment??'Review the selected original collection fields, native schema, attribution and distribution basis for this customer run.'});
    return {edition:workspace.get('editions',saved.edition.id),review:reviewed.review};
  }
  try{
    await saveExact(join(directory,'customer-intent.json'),intent);
    if(await exists(output)){const result=await readJson(output,8*1024*1024);await inspectDirectusDelivery(result.delivery);return {...result,replayed:true};}
    if(await exists(progress)){const saved=await readJson(progress,8*1024*1024);assert.equal(saved.operationId,input.operationId);phases.push(...saved.phases);}
    workspace=await openDirectusWorkspace({directory:join(directory,'workspace')});
    const originalCapture=await native('capture','capture-before',{collection:input.collection,query:input.query??{},name:'Original '+input.collection,pageSize:input.capturePageSize??100});
    const initial=await edition(originalCapture.source,'edition-before');
    if(initial.edition.row_count<3)throw new Error('Use an isolated native customer collection with at least three rows for a continuing paginated acquisition.');
    await record('original-native-capture',{source:originalCapture.source,snapshot:initial.edition.snapshot,rows:initial.edition.row_count});
    const draft=await native('draft-create','create-version',{collection:input.collection,item:input.item,key:'sf30-'+digest(Buffer.from(input.operationId)).slice(0,24),name:'Customer edition'});
    const versionId=draft.native.versionId;
    await native('draft-save','save-version',{versionId,patchJson:input.patchJson});
    const comparison=await native('draft-compare','compare-version',{versionId});
    const promoted=await native('draft-promote','promote-version',{versionId,mainHash:comparison.native.mainHash,expectedVersionSha256:comparison.native.versionSha256});
    assert.equal(String(promoted.native.item),input.item);
    const editedCapture=await native('capture','capture-after',{collection:input.collection,query:input.query??{},name:'Updated '+input.collection,pageSize:input.capturePageSize??100});
    const successor=await edition(editedCapture.source,'edition-after',{previousEditionId:initial.edition.id,
      nativeOperationIds:['create-version','save-version','compare-version','promote-version'].map(operationId)});
    const compared=await mutate('compare-editions','compare-editions',{beforeId:initial.edition.id,afterId:successor.edition.id});
    assert.ok(compared.comparison.counts.changed>=1,'The original native patch must change at least one selected customer field.');
    await record('native-draft-promoted',{versionId,item:promoted.native.item,item_sha256:promoted.native.itemSha256,
      before_snapshot:initial.edition.snapshot,after_snapshot:successor.edition.snapshot,comparison:compared.comparison.counts});
    const source=workspace.get('sources',editedCapture.source.id),target=source.items.find(item=>String(item.key)===input.item);
    assert.ok(target,'The promoted item must appear in the complete native recapture.');
    await record('exact-value-projection',{fields:input.fields,native_fields:source.native_schema.fields.filter(f=>input.fields.includes(f.field)),
      sample:Object.fromEntries(input.fields.map(field=>[field,target.values[field]??{state:'missing'}]))});
    const origin=input.origin??'https://directus-customer.example',resourcePath=input.resourcePath??'/directus-data';
    const packageInput={workspace,editionId:initial.edition.id,editionSha256:initial.edition.sha256,reviewId:initial.review.id,
      directory:join(directory,'merchant-package'),versionDirectory:join(directory,'versions'),payment:input.payment,origin,path:resourcePath};
    const prepared=await prepareDirectusMerchant(packageInput),repeated=await prepareDirectusMerchant(packageInput);
    assert.equal(repeated.dataset.executionSha256,prepared.dataset.executionSha256);
    merchant=await startDirectusMerchant({directory:prepared.directory,stageDirectory:join(directory,'native-stage'),runtime:{port:0}});
    const query={limit:'2'},offer=await reviewDirectusBuyer({directory:prepared.directory,seller:merchant.url,query});
    const buyer=await prepareDirectusBuyer({directory:prepared.directory,seller:merchant.url,query,intentId:operationId('buyer'),
      acceptIndex:input.acceptIndex??0,offerSha256:offer.offerSha256,destination:join(directory,'prepared-buyer.json')});
    await record('original-merchant-offer',{merchant_mode:merchant.mode,snapshot:prepared.snapshot,
      execution_sha256:prepared.dataset.executionSha256,offer_sha256:offer.offerSha256,source_files:prepared.sourceFiles.length});
    // This local source uses the original running version store's free HTTP response
    // path. SF31 and SF88 still retain the original per-page buyer and response files.
    freeServer=createServer(merchant.versions.wrapRequest(async(req,res)=>{
      try{
        requests++;const context={query:new URL(req.url,'http://127.0.0.1').searchParams};
        const admitted=await merchant.versions.admit(context,{allowSnapshot:true});
        const response=admitted===true?await merchant.versions.handle(context,{allowSnapshot:true}):admitted;
        res.writeHead(response.status,response.headers);res.end(JSON.stringify(response.body));
      }catch(error){if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
    }));
    freeServer.listen(0,'127.0.0.1');await once(freeServer,'listening');
    const local='http://127.0.0.1:'+freeServer.address().port;
    const transport=async(url,options)=>{
      const u=new URL(url),response=await fetch(local+u.pathname+u.search,options);
      // The original logical resource maps to this running local version store.
      // Preserve the actual response stream/status/headers under that resource URL.
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
    };
    async function executeFreePage(cfg,{signal}={}){
      const writer=await prepareBuyerResponseFile(cfg.responseFile);let saved,evidence,wire;
      const buyer={async call(options){
        wire=await createAttemptWireRecorder({cfg,body:undefined,fetchImpl:transport,signal});
        const nativeBuyer=new X402BuyerClient({fetchImpl:wire.fetch});
        const result=await nativeBuyer.call({...options,approve:async()=>{throw new Error('This source returns a native free page.');},
          sign:async()=>{signatures++;throw new Error('The free source requested a signer.');}});
        saved=await writer.save(result,{signal});return result;
      }};
      try{evidence=await executeWithEvidence({buyer,call:{...cfg.operation,signal},outputDir:cfg.evidenceDir,captureBody:false});}
      finally{try{await writer.abort();}finally{await wire?.close();}}
      assert.equal(evidence.error,null);
      return {mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:cfg.operation.intentId,status:evidence.result.status,
        httpStatus:evidence.result.httpStatus,sellerReportedSettlement:evidence.result.settlement,evidencePath:evidence.evidencePath,
        originalOutcomeReport:evidence.report,operatorReservation:null,responseFile:{status:'SAVED',...saved},interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
    }
    const buyerConfig={...buyer.config,operator:{python:input.python??'/usr/bin/python3',actor,service:'directus-native-customer',
      policy:join(directory,'free-source-policy.json'),ledger:join(directory,'free-source-ledger.sqlite')},
      signerModule:join(directory,'free-source-signer.mjs'),evidenceDir:directory,captureBody:false};
    await saveExact(join(directory,'native-buyer-config.json'),buyerConfig);
    const session=join(directory,'buyer-session');
    if(!await exists(join(session,'session.json')))await createDatasetSession({directory:session,configPath:join(directory,'native-buyer-config.json'),
      maxPages:Math.ceil(initial.edition.row_count/2)+2,maxTotalAtomic:input.maxTotalAtomic??'1000000',expectedSnapshot:initial.edition.snapshot});
    const initialSession=await inspectDatasetSession(session);
    if(!initialSession.completedPages){
      const controller=new AbortController();
      await runDatasetSession(session,{executePage:executeFreePage,emitPageSummaries:false,signal:controller.signal,
        onPage:report=>{if(report.completedPages>=1)controller.abort();}});
    }
    const prefix=await inspectDatasetSession(session),firstBytes=await readFile(prefix.pages[0].responsePath);
    await record('original-buyer-prefix',{pages:prefix.completedPages,rows:prefix.acquiredRows,first_page_sha256:digest(firstBytes),
      logical_resource:origin+resourcePath,actual_loopback_source:local,wire_headers:'original-sf88-attempt-recorder'});
    const nextPackage=await prepareDirectusMerchant({...packageInput,directory:join(directory,'merchant-package-refreshed'),
      editionId:successor.edition.id,editionSha256:successor.edition.sha256,reviewId:successor.review.id});
    let savedPublication;
    try{savedPublication=workspace.operation(operationId('record-publication'));}
    catch(error){if(error.code!=='DIRECTUS_OPERATION_MISSING')throw error;}
    let publication;
    if(savedPublication){
      const retained=savedPublication.result?.publication;
      assert.equal(savedPublication.input.action,'record-publication');
      assert.equal(retained?.edition_id,successor.edition.id);assert.equal(retained?.edition_sha256,successor.edition.sha256);
      publication=retained.publication;assert.equal(publication.snapshot,successor.edition.snapshot);
    }else{
      const current=await datasetControl(packageInput.versionDirectory,'status');
      publication=await publishDirectusMerchant({directory:nextPackage.directory,expectedSnapshot:current.current,expectedRevision:current.revision});
      await mutate('record-publication','record-publication',{editionId:successor.edition.id,publication});
    }
    const acquired=await runDatasetSession(session,{executePage:executeFreePage,emitPageSummaries:false});
    assert.equal(acquired.status,'COMPLETE');assert.equal(acquired.snapshot,initial.edition.snapshot);assert.equal(acquired.acquiredRows,initial.edition.row_count);
    assert.deepEqual(await readFile(acquired.pages[0].responsePath),firstBytes);
    assert.deepEqual([...new Set(acquired.pages.map(page=>page.nativeBuyerStatus))],['NO_PAYMENT_REQUIRED']);
    await record('original-edition-acquisition-after-refresh',{pages:acquired.completedPages,rows:acquired.acquiredRows,
      purchased_snapshot:acquired.snapshot,current_snapshot:publication.snapshot,native_status:'NO_PAYMENT_REQUIRED'});
    const delivery=await receiveDirectusBuyer({directory:prepared.directory,sessionDirectory:session,destination:join(directory,'customer-delivery'),includeSourceCaptures:true});
    const text=await readFile(join(delivery.directory,'dataset/dataset.jsonl'),'utf8');
    const rows=text.trim()?text.trim().split('\n').map(line=>JSON.parse(line)):[];
    assert.deepEqual(rows,initial.edition.records.map(record=>record.row));
    const requestsBefore=requests,repeatedDelivery=await receiveDirectusBuyer({directory:prepared.directory,sessionDirectory:session,destination:delivery.directory,includeSourceCaptures:true});
    assert.equal(repeatedDelivery.manifest.sha256,delivery.manifest.sha256);assert.equal(requests,requestsBefore);
    await record('complete-customer-data-room',{files:delivery.manifest.files.length,rows:rows.length,delivery_sha256:delivery.manifest.sha256});
    const project=await workspace.exportFile('project');
    await copyExact(project.path,join(directory,'Directus_Complete_Project.sqlite3'),project);
    const originalState=workspace.state(),received=await receiveDirectusWorkspace({file:project.path,directory:join(directory,'received-workspace')});
    try{
      assert.equal(received.state().id,originalState.id);assert.equal(received.state().revision,originalState.revision);
      assert.equal(received.state()['native-events'].length,originalState['native-events'].length);
      const page=await received.query(successor.edition.id,{limit:'2'});assert.equal(page.status,200);
      await record('complete-editable-project-receiving',{workspace_id:originalState.id,revision:originalState.revision,
        native_events:originalState['native-events'].length,project_sha256:project.sha256,project_bytes:project.bytes});
    }finally{await received.close();}
    freeServer.closeAllConnections();await new Promise(resolve=>freeServer.close(resolve));freeServer=null;
    await merchant.close();merchant=null;
    merchant=await startDirectusMerchant({directory:prepared.directory,stageDirectory:join(directory,'native-stage'),runtime:{port:0}});
    const selectionFile=join(directory,'native-selection-intent.json');
    let selection;
    if(await exists(selectionFile))selection=await readJson(selectionFile,1024*1024);
    else{
      const beforeSelection=await datasetControl(packageInput.versionDirectory,'status');
      assert.equal(beforeSelection.current,successor.edition.snapshot);
      selection={schema:'stellar-forge.directus-native-customer-selection.v1',operationId:input.operationId,
        versionDirectory:packageInput.versionDirectory,previousSnapshot:beforeSelection.current,
        previousRevision:beforeSelection.revision,snapshot:initial.edition.snapshot};
      await saveExact(selectionFile,selection);
    }
    assert.equal(selection.schema,'stellar-forge.directus-native-customer-selection.v1');assert.equal(selection.operationId,input.operationId);
    assert.equal(selection.versionDirectory,packageInput.versionDirectory);assert.equal(selection.previousSnapshot,successor.edition.snapshot);
    assert.equal(selection.snapshot,initial.edition.snapshot);assert.ok(Number.isSafeInteger(selection.previousRevision));
    let selected=await datasetControl(packageInput.versionDirectory,'status');
    if(selected.current===selection.previousSnapshot&&selected.revision===selection.previousRevision){
      await datasetControl(packageInput.versionDirectory,'activate',{snapshot:selection.snapshot,
        expectedSnapshot:selection.previousSnapshot,expectedRevision:selection.previousRevision});
      selected=await datasetControl(packageInput.versionDirectory,'status');
    }
    assert.equal(selected.current,selection.snapshot);assert.equal(selected.revision,selection.previousRevision+1);
    assert.equal(merchant.versions.status().current,initial.edition.snapshot);
    const portable=await inspectDirectusDelivery(delivery.directory);assert.equal(portable.manifest.sha256,delivery.manifest.sha256);
    await record('native-restart-and-edition-selection',{restarted_snapshot:selection.previousSnapshot,selected_snapshot:selected.current,
      previous_revision:selection.previousRevision,selected_revision:selected.revision,delivered_page_chain:portable.native.chain});
    assert.equal(signatures,0);
    const result={schema:'stellar-forge.directus-native-customer-result.v1',status:'PASS',finished_at:new Date().toISOString(),
      operationId:input.operationId,workspace_id:workspace.state().id,native_server:source.server,collection:input.collection,
      source_before:originalCapture.source,source_after:editedCapture.source,versionId,
      snapshot:initial.edition.snapshot,successor_snapshot:successor.edition.snapshot,delivery:delivery.directory,
      delivery_sha256:delivery.manifest.sha256,project:join(directory,'Directus_Complete_Project.sqlite3'),project_sha256:project.sha256,
      original_free_http_requests_this_process:requests,original_native_signatures_this_process:signatures,phases};
    await saveExact(output,result);return result;
  }finally{
    try{if(freeServer){freeServer.closeAllConnections();await new Promise(resolve=>freeServer.close(resolve));}}
    finally{try{await merchant?.close();}finally{try{await workspace?.close();}finally{await release();}}}
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),flags={};
  if(args.length%2)throw new TypeError('Use --input ORIGINAL_CUSTOMER.json --out PRIVATE_RUN_DIRECTORY.');
  for(let i=0;i<args.length;i+=2){if(!['--input','--out'].includes(args[i])||flags[args[i]])throw new TypeError('Use --input and --out once.');flags[args[i]]=args[i+1];}
  if(!flags['--input']||!flags['--out'])throw new TypeError('Use --input ORIGINAL_CUSTOMER.json --out PRIVATE_RUN_DIRECTORY.');
  const input=JSON.parse(await readFile(resolve(flags['--input']),'utf8'));
  runDirectusCustomer({input,directory:flags['--out']}).then(result=>process.stdout.write(JSON.stringify(result)+'\n'),
    error=>{process.stderr.write(JSON.stringify({error:error.code??'DIRECTUS_CUSTOMER_FAILURE',message:error.message,stack:error.stack})+'\n');process.exitCode=1;});
}
