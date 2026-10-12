// MIT. Customer acquisition/recovery uses the original SF88 Dataset and SF100 delivery.
import { join, resolve } from 'node:path';
import { readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { DatasetDelivery } from '../../sf88-operator-buyer-cli/node/dataset.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { validateDatasetQuery } from '../../sf88-operator-buyer-cli/dataset-page.mjs';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { need, canonical, clone, digest, jsonBytes, operationId, LIMITS } from './model.mjs';
import { durableDirectory, exactFile, optionalJson } from './source.mjs';
import { readGdeltMerchant, verifyGdeltSourceSet } from './merchant.mjs';
import { runGdeltPython } from './python.mjs';

function datasetIdentity(plan) {
  const {planSha256,config,...body}=plan;return body;
}
export async function prepareGdeltDataset({directory,id,kind='rows',query='',maxPages,maxTotalAtomic,maxRows=LIMITS.rows,acceptIndex=0}={}) {
  operationId(id);need(['rows','sources'].includes(kind),'Choose rows or sources.');
  need(Number.isInteger(maxPages)&&maxPages>=1&&maxPages<=4096&&Number.isInteger(maxRows)&&maxRows>=1&&maxRows<=LIMITS.rows&&
    typeof maxTotalAtomic==='string'&&/^[1-9][0-9]{0,38}$/.test(maxTotalAtomic),'Set explicit original page, row and atomic-unit spending limits.');
  const {edition,plan,offersBytes,offers}=await readGdeltMerchant(directory);
  const resource=kind==='sources'?plan.sourceResource:plan.resource,snapshot=kind==='sources'?edition.sourceSnapshot:edition.snapshot;
  const params=new URLSearchParams(query);
  need(new Set(params.keys()).size===[...params.keys()].length&&!params.has('cursor'),'Start a new acquisition from an initial query.');
  need(!params.has('snapshot')||params.get('snapshot')===snapshot,'Keep the selected immutable snapshot.');
  if(kind==='sources')need([...params.keys()].every(name=>['limit','snapshot'].includes(name)),
    'Complete source receiving requires every original source-file field and row in original order.');
  params.set('snapshot',snapshot);
  const url=new URL(resource);url.search=params.toString();url.searchParams.sort();validateDatasetQuery(url.href,{initial:true});
  const rowIndex=offers.findIndex(offer=>(typeof offer.resource==='string'?offer.resource:offer.resource.url)===resource);
  need(rowIndex>=0,'Original source offer is unavailable.');
  const prepared=prepareReview(offersBytes,{rowIndex,acceptIndex,intentId:id,url:url.href,method:'GET'});
  const config={...prepared.draft,captureBody:false};
  delete config.responseFile;
  const record={schema:'stellar-forge.gdelt-dataset-plan.v1',id,kind,editionId:edition.editionId,sourceSetId:edition.sourceSetId,
    sourceManifestSha256:edition.sourceManifestSha256,merchantPlanSha256:plan.planSha256,snapshot,url:url.href,
    limits:{maxPages,maxTotalAtomic,maxRows,maxPageBytes:LIMITS.pageBytes},configSha256:digest(config),config};
  record.planSha256=digest(datasetIdentity(record));
  const location=await durableDirectory(join(edition.directory,'customer-datasets',id));
  await withPrivateLock(location,'plan.lock',()=>exactFile(location,'plan.json',jsonBytes(record)));
  return record;
}
async function readPlan(directory,id) {
  operationId(id);
  const {edition,plan:merchant}=await readGdeltMerchant(directory);
  const plan=await readPrivateJson(join(edition.directory,'customer-datasets',id,'plan.json'),131072);
  need(plan?.schema==='stellar-forge.gdelt-dataset-plan.v1'&&plan.id===id&&plan.editionId===edition.editionId&&
    plan.planSha256===digest(datasetIdentity(plan))&&plan.configSha256===digest(plan.config)&&
    plan.merchantPlanSha256===merchant.planSha256,'Original dataset acquisition plan changed.');
  return plan;
}
async function bindOriginalDataset(dataset,plan) {
  const metadata=await dataset._metadata();
  need(metadata.source.kind==='config'&&metadata.expectedSnapshot===plan.snapshot&&canonical(metadata.limits)===canonical(plan.limits),
    'Existing original dataset uses another source or spending policy.','GDELT_DATASET_BINDING_CHANGED',409);
  const selected=await readPrivateJson(join(dataset.directory,'config.json'),65536);
  need(canonical(selected.operation)===canonical(plan.config.operation)&&canonical(selected.preparedFrom)===canonical(plan.config.preparedFrom)&&
    selected.responseFile===undefined&&selected.captureBody===false,'Existing native dataset configuration changed.','GDELT_DATASET_BINDING_CHANGED',409);
  const binding={schema:'stellar-forge.gdelt-native-dataset-binding.v1',datasetId:dataset.id,
    planSha256:plan.planSha256,editionId:plan.editionId,sourceSetId:plan.sourceSetId,
    sourceManifestSha256:plan.sourceManifestSha256,snapshot:plan.snapshot,kind:plan.kind,
    sessionDirectory:metadata.sessionDirectory,selectedConfigurationSha256:digest(selected)};
  await withPrivateLock(dataset.directory,'gdelt-binding.lock',()=>exactFile(dataset.directory,'gdelt-dataset.json',jsonBytes(binding)));
  return binding;
}
export async function createGdeltDataset({directory,buyer,id}={}) {
  need(buyer&&typeof buyer.createDataset==='function','Use the installed original SF88 Buyer.');
  const plan=await readPlan(directory,id);let dataset;
  try {dataset=await buyer.createDataset({id,config:plan.config,...plan.limits,expectedSnapshot:plan.snapshot});}
  catch(error) {
    if(error.code!=='DATASET_ALREADY_EXISTS_USE_OPEN')throw error;
    dataset=buyer.dataset(id);
    await bindOriginalDataset(dataset,plan);
    await dataset.initialize();
  }
  const binding=await bindOriginalDataset(dataset,plan);
  return {id,plan,binding,dataset};
}
export async function openGdeltDataset({directory,buyer,id}={}) {
  const plan=await readPlan(directory,id),dataset=buyer.dataset(id),binding=await bindOriginalDataset(dataset,plan);
  return {id,plan,binding,dataset};
}
export async function actGdeltDataset({directory,buyer,id,action='inspect',signal}={}) {
  need(['inspect','run','recover','deliver','accounting','finalize'].includes(action),'Select an original dataset action.');
  const {dataset,plan,binding}=await openGdeltDataset({directory,buyer,id});
  if(action==='deliver') {
    const location=await durableDirectory(join(resolve(directory),'customer-datasets',id));
    const delivery=await dataset.deliver(join(location,'delivery'),{signal});
    need(delivery.manifest.dataset.snapshot===plan.snapshot,'Original delivered dataset snapshot changed.');
    await withPrivateLock(location,'delivery.lock',()=>exactFile(location,'delivery.json',jsonBytes(delivery.report)));
    return {id,binding,report:delivery.report,manifest:delivery.manifest};
  }
  const result=await dataset[action]({signal});
  return {id,binding,...result};
}
export async function receiveGdeltSourceDelivery({report,directory,expectedCaptureId,expectedSourceSetId,python,signal}={}) {
  const delivery=await DatasetDelivery.open(report);
  need(delivery.manifest.dataset.projectedFields.join(',')===
    'capture_id,source_set_id,path,file_sha256,file_bytes,chunk_index,chunk_count,chunk_sha256,content_base64',
    'Receive the complete original source-file projection.');
  const result=await runGdeltPython('source_receive.py',{report,directory:resolve(directory),
    expectedCaptureId:expectedCaptureId??null,expectedSourceSetId:expectedSourceSetId??null},{python,signal,maxOutputBytes:2*1024*1024,timeout:300000});
  const set=await readPrivateJson(join(result.directory,'source-set.json'),80*1024*1024);
  // Reconstructing customer state consumes this same exact original source set.
  await verifyGdeltSourceSet(set,{python,signal});
  const binding={schema:'stellar-forge.gdelt-received-source-binding.v1',
    captureManifestSha256:result.captureManifestSha256,sourceSetId:result.sourceSetId,
    reviewId:result.reviewId,captureIds:result.captureIds};
  await withPrivateLock(result.directory,'gdelt-receiving.lock',()=>exactFile(result.directory,'gdelt-receiving.json',jsonBytes(binding)));
  return result;
}
export async function receiveGdeltDataset({directory,buyer,id,target,python,signal}={}) {
  const {plan}=await openGdeltDataset({directory,buyer,id});
  need(plan.kind==='sources','Choose the original complete source-file acquisition.');
  const report=await readPrivateJson(join(resolve(directory),'customer-datasets',id,'delivery.json'),4*1024*1024);
  need(report.nativeStatus?.snapshot===plan.snapshot,'Selected original source delivery changed.');
  return receiveGdeltSourceDelivery({report,directory:target,expectedCaptureId:plan.sourceManifestSha256,
    expectedSourceSetId:plan.sourceSetId,python,signal});
}
export async function reopenGdeltSources({sourceDirectory,projectDirectory,title='Received GDELT event desk',python,signal}={}) {
  const binding=await readPrivateJson(join(resolve(sourceDirectory),'gdelt-receiving.json'),65536);
  need(binding?.schema==='stellar-forge.gdelt-received-source-binding.v1'&&
    /^[a-f0-9]{64}$/.test(binding.captureManifestSha256??'')&&/^[a-f0-9]{64}$/.test(binding.sourceSetId??''),
    'Reopen the original completed receiving binding; resume source receiving first if its final response was interrupted.');
  const inspected=await runGdeltPython('source_receive.py',{mode:'inspect',directory:resolve(sourceDirectory),
    expectedCaptureId:binding.captureManifestSha256,expectedSourceSetId:binding.sourceSetId},
    {python,signal,maxOutputBytes:2*1024*1024,timeout:300000});
  need(inspected.reviewId===binding.reviewId&&canonical(inspected.captureIds)===canonical(binding.captureIds),
    'The original delivered review binding changed.');
  const set=await readPrivateJson(join(resolve(sourceDirectory),'source-set.json'),80*1024*1024);
  await verifyGdeltSourceSet(set,{python,signal});
  const review=await readPrivateJson(join(resolve(sourceDirectory),'review.json'),2*1024*1024);
  need(canonical(review.captureIds)===canonical(set.captures.map(item=>item.captureId)),'Saved review belongs to another source set.');
  const {initializeGdeltProject,readGdeltProject,importGdeltCapture,reviewGdeltCapture}=await import('./project.mjs');
  let state=await initializeGdeltProject({directory:projectDirectory,title});
  for(const capture of set.captures) {
    const id='receive-'+capture.captureId;
    await importGdeltCapture({directory:projectDirectory,id,expectedRevision:state.revision,capture,python,signal});
    state=await readGdeltProject(projectDirectory);
  }
  const result=await reviewGdeltCapture({directory:projectDirectory,id:'review-'+review.id,expectedRevision:state.revision,
    captureIds:review.captureIds,policy:review.policy,note:review.note,name:review.name});
  need(result.reviewId===review.id,'Reopened original source review changed.');
  return {schema:'stellar-forge.gdelt-customer-reopen.v1',projectId:state.id,directory:resolve(projectDirectory),
    sourceSetId:set.sourceSetId,reviewId:review.id,rows:review.rowCount,captures:set.captures.length};
}

/** Read one complete SF100 output after the original delivery verifies its manifest. */
export async function exportGdeltDatasetDelivery({directory,id,file='dataset.csv',signal}={}) {
  need(['dataset.csv','dataset.jsonl','review.html','manifest.json','semantics.json'].includes(file),'Choose an original delivered file.');
  const plan=await readPlan(directory,id);
  const report=await readPrivateJson(join(resolve(directory),'customer-datasets',id,'delivery.json'),4*1024*1024);
  const delivery=await DatasetDelivery.open(report);
  need(delivery.manifest.dataset.snapshot===plan.snapshot,'The original delivered snapshot changed.');
  need(report.outputs[file],'This delivery does not contain the selected file.','GDELT_OUTPUT_UNKNOWN',404);
  return {name:file,type:file.endsWith('.csv')?'text/csv; charset=utf-8':
    file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.jsonl')?'application/x-ndjson':'application/json',
    bytes:await delivery.file(file).bytes({limit:LIMITS.projectBytes,signal})};
}
