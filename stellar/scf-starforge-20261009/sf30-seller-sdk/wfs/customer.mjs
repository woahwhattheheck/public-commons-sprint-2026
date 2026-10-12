// MIT. WFS customer acquisition, recovery and original SF100 source receiving.
import { join, resolve, basename, extname } from 'node:path';
import { readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { DatasetDelivery } from '../../sf88-operator-buyer-cli/node/dataset.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { validateDatasetQuery } from '../../sf88-operator-buyer-cli/dataset-page.mjs';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { need, canonical, clone, digest, hash, jsonBytes, operationId, LIMITS } from './model.mjs';
import { durableDirectory, exactFile, optionalJson } from './source.mjs';
import { readWfsMerchant, SOURCE_COLUMNS } from './merchant.mjs';
import { inspectWfsProjectBundle, receiveWfsProject } from './portable.mjs';
import { runWfsPython } from './python.mjs';

const SOURCE_BYTES=128*1024*1024;
const PLAN='stellar-forge.wfs-dataset-plan.v1';
const SHA=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const retained=(directory,name,value)=>exactFile(join(directory,name),jsonBytes(value));
function datasetIdentity(plan){const{planSha256,config,...body}=plan;return body;}
function requireBuyer(buyer){need(buyer&&typeof buyer.dataset==='function','Use the installed original SF88 Buyer.');}

/** Prepare an explicitly capped original immutable dataset acquisition. */
export async function prepareWfsDataset({directory,id,kind='rows',query='',maxPages,maxTotalAtomic,
  maxRows=LIMITS.rows,acceptIndex=0}={}) {
  operationId(id);need(['rows','sources'].includes(kind),'Choose rows or sources.');
  need(Number.isInteger(maxPages)&&maxPages>=1&&maxPages<=4096&&
    Number.isInteger(maxRows)&&maxRows>=1&&maxRows<=LIMITS.rows&&
    typeof maxTotalAtomic==='string'&&/^[1-9][0-9]{0,38}$/.test(maxTotalAtomic),
    'Set explicit original page, row and atomic-unit spending limits.');
  need(typeof query==='string'||query instanceof URLSearchParams,'Use the original query string.');
  const {edition,plan,offersBytes,offers}=await readWfsMerchant(directory);
  const resource=kind==='sources'?plan.sourceResource:plan.resource;
  const snapshot=kind==='sources'?edition.sourceSnapshot:edition.snapshot;
  const params=new URLSearchParams(query);
  need(new Set(params.keys()).size===[...params.keys()].length&&!params.has('cursor'),
    'Start a new acquisition from an initial query.');
  need(!params.has('snapshot')||params.get('snapshot')===snapshot,'Keep the selected immutable snapshot.');
  if(kind==='sources')need([...params.keys()].every(name=>['limit','snapshot'].includes(name)),
    'Complete source receiving requires every original source-file field and row in original order.');
  params.set('snapshot',snapshot);
  const url=new URL(resource);url.search=params.toString();url.searchParams.sort();
  validateDatasetQuery(url.href,{initial:true});
  const rowIndex=offers.findIndex(offer=>(typeof offer.resource==='string'?offer.resource:offer.resource.url)===resource);
  need(rowIndex>=0,'The original merchant offer is unavailable.');
  const prepared=prepareReview(offersBytes,{rowIndex,acceptIndex,intentId:id,url:url.href,method:'GET'});
  const config={...prepared.draft,captureBody:false};delete config.responseFile;
  const record={schema:PLAN,id,kind,editionId:edition.editionId,sourceSetId:edition.sourceSetId,
    sourceManifestSha256:edition.sourceManifestSha256,merchantPlanSha256:plan.planSha256,snapshot,url:url.href,
    limits:{maxPages,maxTotalAtomic,maxRows,maxPageBytes:LIMITS.pageBytes},configSha256:digest(config),config};
  record.planSha256=digest(datasetIdentity(record));
  const location=await durableDirectory(join(edition.directory,'customer-datasets',id));
  await withPrivateLock(location,'plan.lock',()=>retained(location,'plan.json',record));
  return record;
}

async function selectedPlan(directory,id) {
  operationId(id);
  const {edition,plan:merchant}=await readWfsMerchant(directory);
  const location=join(edition.directory,'customer-datasets',id);
  const plan=await readPrivateJson(join(location,'plan.json'),131072);
  need(plan?.schema===PLAN&&plan.id===id&&plan.editionId===edition.editionId&&
    ['rows','sources'].includes(plan.kind)&&plan.sourceSetId===edition.sourceSetId&&
    plan.sourceManifestSha256===edition.sourceManifestSha256&&
    plan.snapshot===(plan.kind==='sources'?edition.sourceSnapshot:edition.snapshot)&&
    plan.planSha256===digest(datasetIdentity(plan))&&plan.configSha256===digest(plan.config)&&
    plan.merchantPlanSha256===merchant.planSha256,'The original dataset acquisition plan changed.');
  return {plan,edition,location};
}
async function bindOriginalDataset(dataset,plan) {
  const metadata=await dataset._metadata();
  need(dataset.id===plan.id&&metadata.source.kind==='config'&&metadata.expectedSnapshot===plan.snapshot&&
    canonical(metadata.limits)===canonical(plan.limits),
    'The original dataset uses another source or spending policy.','WFS_DATASET_BINDING_CHANGED',409);
  const selected=await readPrivateJson(join(dataset.directory,'config.json'),65536);
  need(canonical(selected.operation)===canonical(plan.config.operation)&&
    canonical(selected.preparedFrom)===canonical(plan.config.preparedFrom)&&
    selected.responseFile===undefined&&selected.captureBody===false,
    'The original native dataset configuration changed.','WFS_DATASET_BINDING_CHANGED',409);
  const binding={schema:'stellar-forge.wfs-native-dataset-binding.v1',datasetId:dataset.id,
    planSha256:plan.planSha256,editionId:plan.editionId,sourceSetId:plan.sourceSetId,
    sourceManifestSha256:plan.sourceManifestSha256,snapshot:plan.snapshot,kind:plan.kind,
    sessionDirectory:metadata.sessionDirectory,selectedConfigurationSha256:digest(selected)};
  await withPrivateLock(dataset.directory,'wfs-binding.lock',()=>
    retained(dataset.directory,'wfs-dataset.json',binding));
  return binding;
}
export async function createWfsDataset({directory,buyer,id}={}) {
  requireBuyer(buyer);need(typeof buyer.createDataset==='function','Use original Buyer.createDataset.');
  const {plan}=await selectedPlan(directory,id);let dataset;
  try{dataset=await buyer.createDataset({id,config:plan.config,...plan.limits,expectedSnapshot:plan.snapshot});}
  catch(error){
    if(error.code!=='DATASET_ALREADY_EXISTS_USE_OPEN')throw error;
    dataset=buyer.dataset(id);await bindOriginalDataset(dataset,plan);await dataset.initialize();
  }
  return {id,plan,binding:await bindOriginalDataset(dataset,plan),dataset};
}
export async function openWfsDataset({directory,buyer,id}={}) {
  requireBuyer(buyer);
  const {plan}=await selectedPlan(directory,id),dataset=buyer.dataset(id);
  return {id,plan,binding:await bindOriginalDataset(dataset,plan),dataset};
}

/** Every action remains an original Dataset operation on the same ID/session. */
export async function actWfsDataset({directory,buyer,id,action='inspect',options={},signal}={}) {
  need(['inspect','run','recover','deliver','accounting','finalize'].includes(action),
    'Select an original dataset action.');
  need(options&&typeof options==='object'&&!Array.isArray(options)&&
    (['accounting','finalize'].includes(action)||Object.keys(options).length===0),
    'Pass accounting options only to original accounting or finalization.');
  const {dataset,plan,binding}=await openWfsDataset({directory,buyer,id});
  if(action==='deliver'){
    const {location}=await selectedPlan(directory,id);
    return withPrivateLock(location,'delivery.lock',async()=>{
      let report=await optionalJson(join(location,'delivery.json'));
      const reopened=report!==null;
      const delivery=report?await DatasetDelivery.open(report):
        await dataset.deliver(join(location,'delivery'),{signal});
      need(delivery.manifest.dataset.snapshot===plan.snapshot&&delivery.report.sourceDirectory===dataset.directory,
        'The original delivered dataset binding changed.');
      if(!report){report=delivery.report;await retained(location,'delivery.json',report);}
      return {id,binding,report,manifest:delivery.manifest,reopened};
    });
  }
  const result=await dataset[action]({...options,signal});return {id,binding,...result};
}

async function checkedSourceBundle(result) {
  need(result&&SHA(result.captureManifestSha256)&&SHA(result.sourceSetId)&&
    result.manifest?.schema==='stellar-forge.wfs-source-files.v1',
    'The original source-file receiver returned an invalid binding.');
  const bundle=await readPrivateJson(join(result.directory,'project-bundle.json'),SOURCE_BYTES);
  const summary=inspectWfsProjectBundle(bundle,{maxBytes:SOURCE_BYTES});
  need(summary.bundleSha256===result.sourceSetId&&bundle.bundleSha256===result.sourceSetId&&
    summary.project.id===result.manifest.originalProjectId&&
    canonical(summary.project)===canonical(result.project),
    'The original complete WFS project differs from its source-file delivery.');
  return {bundle,summary};
}

/** Receive either the original SF88 report or a completed original SF100 scan. */
export async function receiveWfsSourceDelivery({report,nativeScan,directory,expectedCaptureId,
  expectedSourceSetId,python,signal}={}) {
  need((report!==undefined)!==(nativeScan!==undefined),'Select one original delivery report or native SF100 scan.');
  need(expectedCaptureId===undefined||expectedCaptureId===null||SHA(expectedCaptureId),'Invalid selected source manifest hash.');
  need(expectedSourceSetId===undefined||expectedSourceSetId===null||SHA(expectedSourceSetId),'Invalid selected complete source identity.');
  if(report!==undefined){
    const delivery=await DatasetDelivery.open(report);
    need(canonical(delivery.manifest.dataset.projectedFields)===canonical(SOURCE_COLUMNS),
      'Receive the complete original nine-column source-file projection.');
  }
  const input={...(report!==undefined?{report}:{nativeScan}),directory:resolve(directory),
    expectedCaptureId:expectedCaptureId??null,expectedSourceSetId:expectedSourceSetId??null};
  const result=await runWfsPython('source_receive.py',input,{python,signal,maxOutputBytes:2*1024*1024});
  need(result.directory===resolve(directory)&&
    (expectedCaptureId==null||result.captureManifestSha256===expectedCaptureId)&&
    (expectedSourceSetId==null||result.sourceSetId===expectedSourceSetId),
    'The original source-file receiving selection changed.');
  const {summary}=await checkedSourceBundle(result);
  const binding={schema:'stellar-forge.wfs-received-source-binding.v1',
    captureManifestSha256:result.captureManifestSha256,sourceSetId:result.sourceSetId,
    publicationId:result.publicationId,snapshot:result.snapshot,project:clone(summary.project)};
  await withPrivateLock(result.directory,'wfs-receiving.lock',()=>
    retained(result.directory,'wfs-receiving.json',binding));
  return {...result,counts:summary.counts,originalProjectId:summary.project.id,projectRevision:summary.project.revision};
}
export async function receiveWfsDataset({directory,buyer,id,target,python,signal}={}) {
  const {plan}=await openWfsDataset({directory,buyer,id});
  need(plan.kind==='sources','Choose the original complete source-file acquisition.');
  const {location}=await selectedPlan(directory,id);
  const report=await readPrivateJson(join(location,'delivery.json'),4*1024*1024);
  need(report.nativeStatus?.snapshot===plan.snapshot,'The original source delivery changed.');
  return receiveWfsSourceDelivery({report,directory:target,expectedCaptureId:plan.sourceManifestSha256,
    expectedSourceSetId:plan.sourceSetId,python,signal});
}
async function originalReceivedSources(sourceDirectory,{python,signal}={}) {
  sourceDirectory=resolve(sourceDirectory);
  const binding=await readPrivateJson(join(sourceDirectory,'wfs-receiving.json'),65536);
  need(binding?.schema==='stellar-forge.wfs-received-source-binding.v1'&&
    SHA(binding.captureManifestSha256)&&SHA(binding.sourceSetId),
    'Resume the original source receiving before reopening its saved project.');
  const inspected=await runWfsPython('source_receive.py',{mode:'inspect',directory:sourceDirectory,
    expectedCaptureId:binding.captureManifestSha256,expectedSourceSetId:binding.sourceSetId},
    {python,signal,maxOutputBytes:2*1024*1024});
  need(inspected.directory===sourceDirectory&&inspected.publicationId===binding.publicationId&&
    inspected.snapshot===binding.snapshot&&canonical(inspected.project)===canonical(binding.project),
    'The received original project binding changed.');
  return {binding,inspected,...await checkedSourceBundle(inspected)};
}

/** Reopen the same original project. Its receiver preserves later local edits. */
export async function reopenWfsSources({sourceDirectory,projectDirectory,id,python,signal}={}) {
  const {binding,bundle,summary}=await originalReceivedSources(sourceDirectory,{python,signal});
  signal?.throwIfAborted();
  const receiving=await receiveWfsProject({directory:resolve(projectDirectory),bundle,
    id:id??'source-'+binding.sourceSetId,maxBytes:SOURCE_BYTES,signal});
  need(receiving.projectId===summary.project.id&&receiving.bundleSha256===binding.sourceSetId,
    'The original project receiver returned another project.');
  return {schema:'stellar-forge.wfs-customer-reopen.v1',directory:resolve(projectDirectory),
    sourceSetId:binding.sourceSetId,publicationId:binding.publicationId,snapshot:binding.snapshot,
    projectId:summary.project.id,revision:summary.project.revision,counts:summary.counts,receiving};
}

function fileType(name) {
  return ({'.csv':'text/csv; charset=utf-8','.html':'text/html; charset=utf-8',
    '.jsonl':'application/x-ndjson','.json':'application/json','.geojson':'application/geo+json',
    '.xml':'application/xml','.xsd':'application/xml','.md':'text/markdown; charset=utf-8'})[extname(name)]??
    'application/octet-stream';
}
/** Download exact original project files after complete offline source readback. */
export async function exportWfsReceivedFile({sourceDirectory,file,python,signal}={}) {
  need(typeof file==='string'&&file.length>0,'Select an exact retained original file.');
  const {binding,bundle,inspected}=await originalReceivedSources(sourceDirectory,{python,signal});
  let bytes;
  if(file==='sources-manifest.json'||file==='project-bundle.json'){
    bytes=await readBytes(join(resolve(sourceDirectory),file),SOURCE_BYTES);
    if(file==='sources-manifest.json')need(hash(bytes)===binding.captureManifestSha256,'Original manifest changed.');
    else{
      const member=inspected.manifest.files.find(item=>item.path===file);
      need(member&&bytes.length===member.bytes&&hash(bytes)===member.sha256,'Original complete bundle changed.');
    }
  }else{
    const member=bundle.files.find(item=>item.path===file);
    need(member,'Choose a file in the original complete project inventory.','WFS_SOURCE_FILE_UNKNOWN',404);
    bytes=Buffer.from(member.base64,'base64');
    need(bytes.length===member.bytes&&hash(bytes)===member.sha256,'The original project file changed.');
  }
  signal?.throwIfAborted();return {name:basename(file),path:file,type:fileType(file),bytes};
}

/** Download an original SF100 export without reopening a payment or source request. */
export async function exportWfsDatasetDelivery({directory,id,file='dataset.csv',signal}={}) {
  need(['dataset.csv','dataset.jsonl','review.html','manifest.json','semantics.json'].includes(file),
    'Choose an original delivered dataset file.');
  const {plan,location}=await selectedPlan(directory,id);
  const report=await readPrivateJson(join(location,'delivery.json'),4*1024*1024);
  const delivery=await DatasetDelivery.open(report);
  need(delivery.manifest.dataset.snapshot===plan.snapshot,'The original delivered snapshot changed.');
  need(report.outputs[file],'The delivery does not contain that file.','WFS_OUTPUT_UNKNOWN',404);
  return {name:file,type:fileType(file),bytes:await delivery.file(file).bytes({limit:LIMITS.projectBytes,signal})};
}
