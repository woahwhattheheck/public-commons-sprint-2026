// MIT. Whole native repository merchant/customer receiving with original sources.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {openDspaceWorkspace} from '../workspace.mjs';
import {prepareDspaceMerchant,startDspaceMerchant,publishDspaceMerchant,readDspaceMerchant} from '../merchant.mjs';
import {reviewDspaceBuyer,prepareDspaceBuyer,receiveDspaceBuyer,inspectDspaceDelivery} from '../customer.mjs';
import {datasetControl} from '../../dataset-refresh/service.mjs';
import {X402BuyerClient} from '../../../sf31-buyer-client/buyer.mjs';
import {prepareBuyerResponseFile} from '../../../sf31-buyer-client/response-file.mjs';
import {executeWithEvidence} from '../../../sf82-checkout-evidence/evidence.mjs';
import {createDatasetSession,runDatasetSession,inspectDatasetSession,recoverDatasetSession} from '../../../sf88-operator-buyer-cli/dataset-session.mjs';
import {saveExact,exists,digest,identity} from '../merchant-files.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((rows,v,i,a)=>i%2?rows:[...rows,[v,a[i+1]]],[]));
if(!args['--workspace']||!args['--out']||!args['--demo-payment'])throw new TypeError('--workspace ORIGINAL --out PRIVATE_RUN --demo-payment ORIGINAL_PUBLIC_DEMO_TERMS.json');
const directory=resolve(args['--out']),original=resolve(args['--workspace']);
await mkdir(directory,{recursive:true,mode:0o700});
const workspace=await openDspaceWorkspace({directory:original});
let merchant,freeServer,requests=0,signatures=0;
const phases=await exists(join(directory,'progress.json'))?JSON.parse(await readFile(join(directory,'progress.json'),'utf8')).phases:[];
const record=async(name,details)=>{if(phases.some(phase=>phase.name===name))return;phases.push({name,...details});await writeFile(join(directory,'progress.json'),JSON.stringify({phases},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({phase:name,...details}));};
const operation=async(action,id,input)=>{
  try{const previous=workspace.operation(id);return previous.result;}
  catch(e){if(e.code!=='DSPACE_OPERATION_MISSING')throw e;}
  return workspace.dispatch(action,{...input,actor:'F47A native repository receiving',operationId:id,expectedRevision:workspace.state().revision});
};
try{
  const state=workspace.state(),editionId=args['--edition']??state.selected_edition_id;
  const edition=workspace.read('editions',editionId,{limit:100});
  const reviewId=args['--review']??state.reviews.filter(r=>r.edition_id===editionId&&r.decision==='approved').at(-1)?.id;
  assert.equal(edition.row_count,45);assert.equal(edition.records.length,45);
  const payment=JSON.parse(await readFile(args['--demo-payment'],'utf8'));
  const origin='https://repository-dataset.example',resourcePath='/repository-data';
  const input={workspace,editionId,editionSha256:edition.sha256,reviewId,
    directory:join(directory,'merchant-package'),versionDirectory:join(directory,'versions'),payment,origin,path:resourcePath};
  const prepared=await prepareDspaceMerchant(input);
  const repeated=await prepareDspaceMerchant(input);
  assert.equal(repeated.dataset.executionSha256,prepared.dataset.executionSha256);
  await record('approved-merchant-package',{rows:prepared.row_count,snapshot:prepared.snapshot,source_files:prepared.sourceFiles.length,
    source_bytes:prepared.sourceFiles.reduce((n,v)=>n+v.bytes,0),execution_sha256:prepared.dataset.executionSha256});
  merchant=await startDspaceMerchant({directory:input.directory,stageDirectory:join(directory,'native-stage'),runtime:{port:0}});
  const query={limit:'7'},offer=await reviewDspaceBuyer({directory:input.directory,seller:merchant.url,query});
  const buyer=await prepareDspaceBuyer({directory:input.directory,seller:merchant.url,query,
    intentId:'f47a-dspace-cohort-customer-20261012',acceptIndex:0,offerSha256:offer.offerSha256,destination:join(directory,'prepared-buyer.json')});
  assert.equal(buyer.snapshot,edition.snapshot);
  await record('original-seller-and-offer',{mode:merchant.mode,offer_sha256:offer.offerSha256,configuration_sha256:buyer.configSha256});
  freeServer=createServer(merchant.versions.wrapRequest(async(req,res)=>{
    requests++;
    const query=new URL(req.url,'http://127.0.0.1').searchParams;
    const context={query};
    const admitted=await merchant.versions.admit(context,{allowSnapshot:true});
    const response=admitted===true?await merchant.versions.handle(context,{allowSnapshot:true}):admitted;
    res.writeHead(response.status,response.headers);res.end(JSON.stringify(response.body));
  }));
  freeServer.listen(0,'127.0.0.1');await once(freeServer,'listening');
  const local='http://127.0.0.1:'+freeServer.address().port;
  const native=new X402BuyerClient({fetchImpl:(url,options)=>{const u=new URL(url);return fetch(local+u.pathname+u.search,options);}});
  async function executeFreePage(cfg,{signal}={}){
    const writer=await prepareBuyerResponseFile(cfg.responseFile);let saved,evidence;
    const originalBuyer={async call(options){
      const result=await native.call({...options,approve:async()=>{throw Error('This original local source returns free pages.');},
        sign:async()=>{signatures++;throw Error('Unexpected signer invocation.');}});
      saved=await writer.save(result,{signal});return result;
    }};
    try{evidence=await executeWithEvidence({buyer:originalBuyer,call:{...cfg.operation,signal},
      outputDir:cfg.evidenceDir,captureBody:false});}finally{await writer.abort();}
    assert.equal(evidence.error,null);
    return {mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:cfg.operation.intentId,status:evidence.result.status,
      httpStatus:evidence.result.httpStatus,sellerReportedSettlement:evidence.result.settlement,evidencePath:evidence.evidencePath,
      originalOutcomeReport:evidence.report,operatorReservation:null,responseFile:{status:'SAVED',...saved},
      interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
  }
  const buyerConfig={...buyer.config,operator:{python:'/usr/bin/python3',actor:'F47A-source-receiving',service:'repository-native',
    policy:join(directory,'unused-policy.json'),ledger:join(directory,'unused-ledger.sqlite')},
    signerModule:join(directory,'unused-signer.mjs'),evidenceDir:directory,captureBody:false};
  await saveExact(join(directory,'native-buyer-config.json'),buyerConfig);
  const session=join(directory,'buyer-session');
  if(!await exists(join(session,'session.json')))await createDatasetSession({directory:session,configPath:join(directory,'native-buyer-config.json'),
    maxPages:100,maxTotalAtomic:'1000000',expectedSnapshot:edition.snapshot});
  const initial=await inspectDatasetSession(session);
  if(initial.completedPages<2){
    const controller=new AbortController();
    await runDatasetSession(session,{executePage:executeFreePage,emitPageSummaries:false,signal:controller.signal,
      onPage:report=>{if(report.completedPages>=2)controller.abort();}});
  }
  const prefix=await inspectDatasetSession(session);
  const firstBytes=await readFile(prefix.pages[0].responsePath);
  await record('original-buyer-prefix',{pages:prefix.completedPages,rows:prefix.acquiredRows,first_page_sha256:digest(firstBytes)});
  const choice=edition.selection.filter((_,index)=>index!==1);
  const next=await operation('save-edition','f47a-merchant-curated-edition',{
    name:edition.name,mode:edition.mode,selection:choice,metadataFields:edition.metadataFields,
    rights:edition.rights,previousEditionId:edition.id});
  const nextReview=await operation('review-edition','f47a-merchant-curated-review',{
    editionId:next.edition.id,editionSha256:next.edition.sha256,decision:'approved',
    comment:'Internal repository dataset demonstration: retain the actual linked researcher and select44 original objects. This curated successor excludes one original publication without changing the saved source or metadata arrays.'});
  const successor=await prepareDspaceMerchant({...input,editionId:next.edition.id,editionSha256:next.edition.sha256,
    reviewId:nextReview.review.id,directory:join(directory,'merchant-package-curated')});
  const current=await datasetControl(input.versionDirectory,'status');
  const publication=await publishDspaceMerchant({directory:successor.directory,expectedSnapshot:current.current,expectedRevision:current.revision});
  assert.equal(publication.snapshot,successor.snapshot);
  await operation('record-publication','f47a-merchant-curated-publication',{editionId:next.edition.id,publication});
  await record('native-generation-publication',{before:edition.snapshot,after:publication.snapshot,rows:successor.row_count});
  const acquired=await runDatasetSession(session,{executePage:executeFreePage,emitPageSummaries:false});
  assert.equal(acquired.status,'COMPLETE');assert.equal(acquired.acquiredRows,45);assert.equal(acquired.snapshot,edition.snapshot);
  assert.deepEqual(await readFile(acquired.pages[0].responsePath),firstBytes);
  assert.deepEqual([...new Set(acquired.pages.map(p=>p.nativeBuyerStatus))],['NO_PAYMENT_REQUIRED']);
  await record('complete-original-cohort-acquisition',{pages:acquired.completedPages,rows:acquired.acquiredRows,
    snapshot:acquired.snapshot,observed_status:'NO_PAYMENT_REQUIRED'});
  const beforeRecovery=requests,last=String(acquired.completedPages).padStart(6,'0');
  if(!phases.some(phase=>phase.name==='original-completed-file-recovery'))
    await unlink(join(session,'pages',last,'result.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const recovered=await recoverDatasetSession(session);
  assert.equal(recovered.status,'COMPLETE');assert.equal(requests,beforeRecovery);
  await record('original-completed-file-recovery',{pages:recovered.completedPages,recovered:recovered.pages.at(-1).recoveredFromOriginalFiles});
  const delivery=await receiveDspaceBuyer({directory:input.directory,sessionDirectory:session,
    destination:join(directory,'customer-delivery'),includeSourceCaptures:true});
  const rows=(await readFile(join(delivery.directory,'dataset/dataset.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(rows,edition.records.map(v=>v.row));
  const metadataTotal=rows.reduce((n,row)=>n+Object.values(JSON.parse(row.metadata_json)).reduce((n,v)=>n+v.length,0),0);
  assert.equal(metadataTotal,1230);
  const publicationRow=rows.find(row=>row.item_uuid==='0157eef4-2dc8-4ddd-8124-94cdabc15f6e');
  assert.equal(JSON.parse(publicationRow.metadata_json)['dc.contributor.author'].length,85);
  const repeatedDelivery=await receiveDspaceBuyer({directory:input.directory,sessionDirectory:session,
    destination:delivery.directory,includeSourceCaptures:true});
  assert.equal(repeatedDelivery.manifest.sha256,delivery.manifest.sha256);assert.equal(requests,beforeRecovery);
  await record('whole-native-customer-receiving',{rows:rows.length,metadata_values:metadataTotal,files:delivery.manifest.files.length,
    delivery_sha256:delivery.manifest.sha256,bytes:delivery.bytes,first_publication_authors:85});
  freeServer.closeAllConnections();await new Promise(r=>freeServer.close(r));freeServer=null;
  await merchant.close();merchant=null;
  merchant=await startDspaceMerchant({directory:input.directory,stageDirectory:join(directory,'native-stage'),runtime:{port:0}});
  const reopened=await datasetControl(input.versionDirectory,'status');
  assert.equal(reopened.current,successor.snapshot);
  await datasetControl(input.versionDirectory,'activate',{snapshot:edition.snapshot,expectedSnapshot:reopened.current,expectedRevision:reopened.revision});
  assert.equal(merchant.versions.status().current,edition.snapshot);
  const portable=await inspectDspaceDelivery(delivery.directory);
  assert.equal(portable.manifest.sha256,delivery.manifest.sha256);
  await record('native-restart-and-retained-edition-selection',{restarted_snapshot:reopened.current,
    selected_snapshot:merchant.versions.status().current,portable_page_chain:portable.native.chain});
  const result={status:'PASS',finished_at:new Date().toISOString(),workspace_id:workspace.state().id,
    edition_id:edition.id,edition_sha256:edition.sha256,snapshot:edition.snapshot,phases,
    native_http_requests_this_process:requests,native_signatures_this_process:signatures,delivery:delivery.directory,
    delivery_sha256:delivery.manifest.sha256,source_package:input.directory};
  await writeFile(join(directory,'MERCHANT_CUSTOMER_RESULT.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result));
}finally{
  if(freeServer){freeServer.closeAllConnections();await new Promise(r=>freeServer.close(r));}
  await merchant?.close();await workspace.close();
}
