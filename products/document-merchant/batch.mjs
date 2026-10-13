// MIT. Document batches compose the original Request, Checkout, Jobs and Resource library.
import {join, resolve, dirname, relative, isAbsolute, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {
  absolute, ownedDirectory, ownedBytes, writeExact, encoded, parse, canonical, plain, need, integer, text
} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {initialRecord} from '../prepaid-api/records.mjs';
import {openJobWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/model.mjs';
import {
  exportCollection, inspectCollectionArchive, receiveCollection, openReceivedLibrary
} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/collection-package.mjs';
import {
  DOCUMENT_PROVIDER_SCHEMA, documentProvider, normalizeDocumentInput, buildDocumentRequest
} from './contracts.mjs';
import {renderDocumentBatchHtml, renderDocumentBatchCsv} from './batch-render.mjs';

export const DOCUMENT_BATCH_SCHEMA = 'stellar-forge.document-batch.v1';
export const DOCUMENT_BATCH_PLAN_SCHEMA = 'stellar-forge.document-batch-plan.v1';
export const DOCUMENT_BATCH_SNAPSHOT_SCHEMA = 'stellar-forge.document-batch-snapshot.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PLAN_BYTES = 16777216;
const MAX_DOCUMENTS = 2000;
const ids = {html: 'renderHtml', markdown: 'renderMarkdown', 'pdf-set':'assemblePdfs'};
const media = {html: 'text/html', markdown: 'text/markdown', 'pdf-set':'application/json'};
const digest = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const equal = (a,b) => canonical(a) === canonical(b);
const cleanCode = error => /^[A-Z][A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'DOCUMENT_BATCH_OPERATION_FAILED';
const now = () => new Date().toISOString();
const cancelled = signal => signal?.throwIfAborted();
const planFile = directory => join(absolute(directory), 'batch-plan.json');
const sourceInput = input => {const value = copy(input); delete value.$files; return value;};
const paymentFlow = payment => payment.extra?.paymentFlow ?? payment.paymentFlow ?? 'authorization';
function requestPrefix(id) {return 'document.' + digest(id).slice(0,24) + '.';}
function referenceFor(batchId,itemId) {return requestPrefix(batchId) + digest(itemId).slice(0,24);}
function normalizeOrigin(value) {
  let url;
  try {url = new URL(value);} catch {need(false, 'DOCUMENT_BATCH_ORIGIN_REQUIRED');}
  need(url.protocol === 'https:' && url.origin === value && !url.username && !url.password,
    'DOCUMENT_BATCH_ORIGIN_REQUIRED');
  return url.origin;
}

export function documentBatchTemplate(provider = 'mintpdf') {
  const service = documentProvider(provider);
  return {
    schema: DOCUMENT_BATCH_SCHEMA, id: 'operations-week-41', name: 'Operations reports — week 41',
    provider: service.id, merchantOrigin: null,
    documents: service.formats.map((format,index) => ({
      id: 'report-' + format, label: 'Operations report — ' + format.toUpperCase(),
      source: 'report.' + (format === 'markdown' ? 'md' : 'html'), format,
      input: {title: 'Operations report', taskReference: 'operations-week-41-' + (index+1)}
    }))
  };
}

/** Input describes customer work. Original native records own execution and payment. */
export function normalizeDocumentBatch(value,{sourceRoot} = {}) {
  need(plain(value) && value.schema === DOCUMENT_BATCH_SCHEMA &&
    Object.keys(value).every(key => ['schema','id','name','provider','merchantOrigin','documents'].includes(key)),
    'DOCUMENT_BATCH_REQUIRED');
  need(ID.test(value.id ?? ''), 'DOCUMENT_BATCH_ID_REQUIRED');
  const provider = documentProvider(value.provider), root = absolute(sourceRoot);
  const merchantOrigin = normalizeOrigin(value.merchantOrigin);
  need(Array.isArray(value.documents) && value.documents.length > 0 && value.documents.length <= MAX_DOCUMENTS,
    'DOCUMENT_BATCH_DOCUMENTS_REQUIRED');
  const seen = new Set();
  const documents = value.documents.map(item => {
    need(plain(item) && Object.keys(item).every(key => ['id','label','source','format','input'].includes(key)) &&
      ID.test(item.id ?? '') && !seen.has(item.id), 'DOCUMENT_BATCH_DOCUMENT_INVALID');
    seen.add(item.id);
    need(provider.formats.includes(item.format)||provider.id==='pdfmint'&&item.format==='pdf-set', 'DOCUMENT_BATCH_FORMAT_UNSUPPORTED');
    need(typeof item.source === 'string' && item.source.length > 0 && item.source.length <= 4096 &&
      !isAbsolute(item.source) && !/[\x00-\x1f\x7f]/.test(item.source), 'DOCUMENT_BATCH_SOURCE_REQUIRED');
    const path = resolve(root,item.source), local = relative(root,path);
    need(local && !local.startsWith('..' + sep) && local !== '..' && !isAbsolute(local),
      'DOCUMENT_BATCH_SOURCE_OUTSIDE_ROOT');
    need(plain(item.input) && !Object.hasOwn(item.input,'$files'), 'DOCUMENT_BATCH_INPUT_REQUIRED');
    const input = normalizeDocumentInput(provider.id,item.format,item.input);
    return {id:item.id, label:text(item.label ?? input.title,200,'DOCUMENT_BATCH_LABEL_REQUIRED'),
      source:local, sourcePath:path, format:item.format, functionId:ids[item.format],
      reference:referenceFor(value.id,item.id), input};
  });
  return {schema:DOCUMENT_BATCH_SCHEMA,id:value.id,
    name:text(value.name,200,'DOCUMENT_BATCH_NAME_REQUIRED'),
    provider:provider.id,merchantOrigin,sourceRoot:root,documents};
}
function definitionFor(catalog,item) {
  const definition = catalog.functions.find(value => value.id === item.functionId);
  const slots = definition?.inputFiles?.slots;
  need(definition && slots?.source && slots.source.required && definition.output?.format === 'package' &&
    Object.keys(definition.output.files ?? {}).length === 4 &&
    ['pdf','source','request','render'].every(slot => definition.output.files?.[slot]?.required) &&
    definition.output.files.pdf.contentType === 'application/pdf' &&
    definition.output.files.source.contentType === media[item.format],
    'DOCUMENT_BATCH_MERCHANT_FUNCTION_REQUIRED');
  need(slots.source.mediaTypes?.includes(media[item.format]), 'DOCUMENT_BATCH_SOURCE_POLICY_CHANGED');
  const payment = definition.payment;
  need(payment?.scheme === 'exact' && ['stellar:testnet','stellar:pubnet'].includes(payment.network) &&
    typeof payment.asset === 'string' && typeof payment.payTo === 'string' &&
    typeof payment.amount === 'string' && /^(?:0|[1-9][0-9]*)$/.test(payment.amount),
    'DOCUMENT_BATCH_MERCHANT_PRICE_REQUIRED');
  return definition;
}
function paymentTotals(items) {
  const groups = new Map();
  for (const item of items) {
    const p = item.payment;
    const key = canonical([p.scheme,p.network,p.asset,p.payTo,paymentFlow(p)]);
    let group = groups.get(key);
    if (!group) {group = {scheme:p.scheme,network:p.network,asset:p.asset,payTo:p.payTo,
      paymentFlow:paymentFlow(p),documents:0,maximumAtomic:0n}; groups.set(key,group);}
    group.documents++; group.maximumAtomic += BigInt(p.amount);
  }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>
    ({...value,maximumAtomic:value.maximumAtomic.toString()}));
}
function sourceDescriptor(row) {
  const descriptor = row.input?.$files?.source ?? row.inputFiles?.descriptors?.source;
  need(descriptor && HASH.test(descriptor.sha256 ?? '') && Number.isSafeInteger(descriptor.bytes) &&
    descriptor.bytes > 0 && typeof descriptor.contentType === 'string', 'DOCUMENT_BATCH_SOURCE_NOT_READY');
  return descriptor;
}
function bindRequest(row,item,catalog) {
  need(row.reference === item.reference && row.label === item.label &&
    row.merchant.origin === catalog.publicOrigin && row.merchant.catalogSha256 === catalog.catalogSha256 &&
    row.merchant.functionId === item.functionId &&
    equal(sourceInput(row.input),item.input), 'DOCUMENT_BATCH_ORIGINAL_REQUEST_CHANGED');
}
async function requestIndex(workspace,batch) {
  const found = new Map();
  for (let offset=0;;) {
    const page = workspace.intake.list({q:requestPrefix(batch.id),offset,limit:200});
    for (const row of page.items) if (row.merchant.origin === batch.merchantOrigin) {
      need(!found.has(row.reference),'DOCUMENT_BATCH_REFERENCE_COLLISION');
      found.set(row.reference,row.id);
    }
    offset += page.items.length;
    if (offset >= page.total) break;
    need(page.items.length > 0,'DOCUMENT_BATCH_REQUEST_PAGE_INCOMPLETE');
  }
  return found;
}
function validatePlan(value,{directory,workspaceDirectory,inputSha256} = {}) {
  need(plain(value) && value.schema === DOCUMENT_BATCH_PLAN_SCHEMA && ID.test(value.id ?? '') &&
    HASH.test(value.inputSha256 ?? '') && value.directory === directory &&
    typeof value.workspaceDirectory === 'string' &&
    (!workspaceDirectory || value.workspaceDirectory === workspaceDirectory) &&
    (!inputSha256 || value.inputSha256 === inputSha256) &&
    Array.isArray(value.items) && value.items.length > 0 && value.items.length <= MAX_DOCUMENTS &&
    value.catalog?.publicOrigin === value.input?.merchantOrigin &&
    HASH.test(value.catalog?.catalogSha256 ?? ''), 'DOCUMENT_BATCH_PLAN_INVALID');
  need(new Set(value.items.map(item=>item.id)).size === value.items.length &&
    new Set(value.items.map(item=>item.requestId)).size === value.items.length &&
    value.items.every(item=>HASH.test(item.requestId ?? '') && HASH.test(item.inputSha256 ?? '') &&
      HASH.test(item.source?.sha256 ?? '') && item.reference === referenceFor(value.id,item.id)),
    'DOCUMENT_BATCH_PLAN_IDENTITY_CHANGED');
  need(digest(canonical(value.input)) === value.inputSha256, 'DOCUMENT_BATCH_INPUT_CHANGED');
  need(value.input.documents.length === value.items.length && value.items.every((item,index) => {
    const declared = value.input.documents[index], definition = definitionFor(value.catalog,declared);
    return item.id === declared.id && item.label === declared.label && item.format === declared.format &&
      item.sourcePath === declared.sourcePath && equal(item.input,declared.input) &&
      item.functionId === declared.functionId && item.functionSha256 === definition.functionSha256 &&
      equal(item.payment,definition.payment) && item.purchaseUrl === definition.purchaseUrl &&
      item.source.policySha256 === definition.inputFiles.policySha256;
  }), 'DOCUMENT_BATCH_SOURCE_PLAN_CHANGED');
  need(equal(value.totals,paymentTotals(value.items)), 'DOCUMENT_BATCH_TOTALS_CHANGED');
  return value;
}
async function validateSource(item,definition,provider) {
  const bytes = await ownedBytes(item.sourcePath,definition.inputFiles.slots.source.maxBytes,{privateMode:false});
  let source;
  try {source = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch {need(false,'DOCUMENT_BATCH_SOURCE_ENCODING_REQUIRED');}
  const request=buildDocumentRequest({schema:DOCUMENT_PROVIDER_SCHEMA,provider,plan:'free',authentication:'bearer',
    maxSourceBytes:Math.min(definition.inputFiles.slots.source.maxBytes,documentProvider(provider).maxSourceBytes)},
  item.format,item.input,source);
  if(item.format==='pdf-set')for(const file of request.source.files){
    const raw=Buffer.from(file.base64,'base64');
    need(raw.toString('base64')===file.base64&&raw.length===file.bytes&&digest(raw)===file.sha256&&
      raw.subarray(0,5).toString('ascii')==='%PDF-','DOCUMENT_ASSEMBLY_FILE_CHANGED');
  }
  return {sha256:digest(bytes),bytes:bytes.length};
}

export async function prepareDocumentBatch({workspace,directory,request,sourceRoot,intakeAccessToken = null,signal,onProgress} = {}) {
  const input = normalizeDocumentBatch(request,{sourceRoot}), inputSha256 = digest(canonical(input));
  need(encoded(input).length <= MAX_PLAN_BYTES/4,'DOCUMENT_BATCH_INPUT_TOO_LARGE');
  directory = await ownedDirectory(absolute(directory),{create:true});
  need(workspace && typeof workspace.intake?.draft === 'function','DOCUMENT_BATCH_CUSTOMER_REQUIRED');
  const lease = await acquireStateLease(directory);
  try {
    const retained = await initialRecord({directory,name:'batch-plan.json',lease,maxBytes:MAX_PLAN_BYTES,
      validate:value=>validatePlan(value,{directory,workspaceDirectory:workspace.directory,inputSha256}),
      create:async()=>{
        cancelled(signal);
        const catalog = await workspace.intake.discover({origin:input.merchantOrigin,signal});
        need(catalog.publicOrigin === input.merchantOrigin,'DOCUMENT_BATCH_MERCHANT_CHANGED');
        const definitions = input.documents.map(item=>definitionFor(catalog,item));
        const references = await requestIndex(workspace,input), items = [];
        for (let index=0;index<input.documents.length;index++) {
          cancelled(signal);
          const item = input.documents[index], definition = definitions[index];
          let row;
          const existing = references.get(item.reference);
          if (existing) row = await workspace.intake.get(existing);
          else row = (await workspace.intake.draft({catalog,functionId:item.functionId,
            input:item.input,label:item.label,reference:item.reference,accessToken:intakeAccessToken})).request;
          row = await workspace.intake.get(row.id);
          bindRequest(row,item,catalog);
          if (row.requestAttempts === 0 && !row.hasTicket && !row.inputFiles?.ready) {
            const original = await validateSource(item,definition,input.provider);
            await workspace.intake.inputFiles.local(row.id,{slot:'source',path:item.sourcePath,
              contentType:media[item.format],expectedRevision:row.revision,signal});
            row = await workspace.intake.get(row.id);
            const received = sourceDescriptor(row);
            need(received.sha256 === original.sha256 && received.bytes === original.bytes,
              'DOCUMENT_BATCH_SOURCE_CHANGED_DURING_STAGING');
          }
          const selected = sourceDescriptor(row);
          need(selected.contentType === media[item.format],'DOCUMENT_BATCH_SOURCE_MEDIA_CHANGED');
          items.push({...item,requestId:row.id,inputSha256:row.inputSha256,
            source:copy(selected),sourcePath:item.sourcePath,payment:copy(definition.payment),
            purchaseUrl:definition.purchaseUrl,functionSha256:definition.functionSha256});
          await onProgress?.({stage:'SOURCE_STAGED',index:index+1,total:input.documents.length,
            itemId:item.id,requestId:row.id,source:copy(selected)});
        }
        return {schema:DOCUMENT_BATCH_PLAN_SCHEMA,id:input.id,name:input.name,directory,
          workspaceDirectory:workspace.directory,createdAt:now(),inputSha256,input,
          catalog:copy(catalog),items,totals:paymentTotals(items),
          unitMeaning:{documents:items.length,outputPackages:items.length,
            parentTaskReferences:new Set(items.map(item=>item.input.taskReference)).size,
            customerAcceptedParentTasks:null}};
      }});
    const plan = retained;
    validatePlan(plan,{directory,workspaceDirectory:workspace.directory,inputSha256});
    const bytes = await ownedBytes(planFile(directory),MAX_PLAN_BYTES);
    return {plan,sha256:digest(bytes),bytes:bytes.length};
  } finally {await lease.close();}
}
export async function readDocumentBatch(directory) {
  directory = await ownedDirectory(absolute(directory));
  const bytes = await ownedBytes(planFile(directory),MAX_PLAN_BYTES);
  const plan = validatePlan(parse(bytes),{directory});
  return {plan,sha256:digest(bytes),bytes:bytes.length};
}
function bindPlanRequest(plan,item,row) {
  bindRequest(row,item,plan.catalog);
  const selected = sourceDescriptor(row);
  need(row.id === item.requestId && row.inputSha256 === item.inputSha256 &&
    equal(selected,item.source) && row.merchant.functionSha256 === item.functionSha256,
    'DOCUMENT_BATCH_RETAINED_INPUT_CHANGED');
}
function publicRow(item,row,checkout,job,outputs) {
  const state = job?.receipt?.latestStatus?.state ?? null;
  const received = outputs?.received === true;
  return {id:item.id,label:item.label,format:item.format,taskReference:item.input.taskReference,
    reference:item.reference,requestId:item.requestId,requestRevision:row.revision,
    requestPhase:row.phase,source:copy(item.source),payment:copy(item.payment),
    checkoutId:checkout?.id ?? row.checkoutId,checkoutPhase:checkout?.phase ?? null,
    checkoutIntent:checkout?.intentId ?? null,checkoutAttempted:checkout?.attempted ?? false,
    jobEntryId:job?.id ?? checkout?.jobEntryId ?? null,jobId:job?.receipt?.jobId ?? null,
    nativeSettlement:copy(job?.receipt?.delivery?.nativeSettlement ?? job?.receipt?.latestStatus?.nativeSettlement ?? null),
    jobState:state,received,
    state:received ? 'RECEIVED' : state ?? (checkout?.attempted ? 'PAYMENT_CONTINUATION' : row.phase),
    error:job?.receipt?.latestStatus?.error?.code ?? job?.lastError ??
      checkout?.lastError ?? row.lastError ?? null,
    packageResourceId:job?.resourceId ?? null,
    outputs:outputs ? {received:outputs.received,package:copy(outputs.package),
      manifestSha256:outputs.manifestSha256,
      ...(outputs.received ? {job:copy(outputs.job),policySha256:outputs.policySha256,
        selectionSha256:outputs.selectionSha256,directory:outputs.directory} : {}),
      files:outputs.files.map(file=>({slot:file.slot,filename:file.filename,contentType:file.contentType,
        bytes:file.bytes,sha256:file.sha256,path:file.path ?? null,resourceId:file.resourceId}))} : null};
}
export async function inspectDocumentBatch({workspace,plan,signal} = {}) {
  need(workspace.directory === plan.workspaceDirectory,'DOCUMENT_BATCH_CUSTOMER_CHANGED');
  const rows = [];
  for (const item of plan.items) {
    cancelled(signal);
    const row = await workspace.intake.get(item.requestId); bindPlanRequest(plan,item,row);
    const checkout = row.checkoutId ? workspace.checkout.get(row.checkoutId) : null;
    const job = checkout?.jobEntryId ? workspace.get(checkout.jobEntryId) : null;
    let outputs = null;
    if (job?.receipt?.delivery) outputs = await workspace.outputs(job.id,{signal});
    rows.push(publicRow(item,row,checkout,job,outputs));
  }
  const counts = {};
  for (const row of rows) counts[row.state] = (counts[row.state] ?? 0)+1;
  const tasks = new Map();
  for (const row of rows) {
    let task = tasks.get(row.taskReference);
    if (!task) {task = {reference:row.taskReference,documents:0,receivedDocuments:0};tasks.set(row.taskReference,task);}
    task.documents++; if (row.received) task.receivedDocuments++;
  }
  return {schema:DOCUMENT_BATCH_SNAPSHOT_SCHEMA,id:plan.id,name:plan.name,
    observedAt:now(),workspaceDirectory:workspace.directory,inputSha256:plan.inputSha256,
    merchantOrigin:plan.input.merchantOrigin,provider:plan.input.provider,totals:copy(plan.totals),
    documents:rows.length,counts,receivedDocuments:rows.filter(row=>row.received).length,
    parentTasks:[...tasks.values()].map(task=>({...task,
      completeDocumentSet:task.documents === task.receivedDocuments,customerAcceptance:null})),
    rows};
}

function bindCheckout(plan,item,request,checkout) {
  const terms = checkout.ticket.acceptedTerms, payment = item.payment;
  need(checkout.id === request.checkoutId && checkout.ticket.jobId === item.reference &&
    checkout.ticket.inputSha256 === item.inputSha256 && checkout.ticket.functionId === item.functionId &&
    checkout.ticket.sellerUrl === item.purchaseUrl && checkout.ticket.method === 'POST' &&
    terms.scheme === payment.scheme && terms.network === payment.network &&
    terms.asset === payment.asset && terms.payTo === payment.payTo &&
    terms.maxAtomic === payment.amount && (terms.paymentFlow ?? 'authorization') === paymentFlow(payment) &&
    (payment.maxTimeoutSeconds === undefined || terms.maxTimeoutSeconds === payment.maxTimeoutSeconds),
    'DOCUMENT_BATCH_CHECKOUT_TERMS_CHANGED');
  if (checkout.review) need(checkout.review.intentId === checkout.intentId &&
    checkout.review.bodySha256 === checkout.ticket.bodySha256 &&
    checkout.review.sellerUrl === checkout.ticket.sellerUrl &&
    checkout.review.method === checkout.ticket.method &&
    equal(checkout.review.acceptedTerms,terms), 'DOCUMENT_BATCH_ORIGINAL_REVIEW_CHANGED');
}
function approveOriginal(plan,item,request,checkout,approval) {
  bindCheckout(plan,item,request,checkout);
  const snapshot = approval.snapshot, review = snapshot?.review;
  need(approval.checkoutId === checkout.id && approval.intentId === checkout.intentId &&
    approval.executing && typeof approval.taskId === 'string' &&
    snapshot?.state === 'AWAITING_OPERATOR' && snapshot.intentId === checkout.intentId &&
    review && HASH.test(review.request_sha256 ?? '') &&
    review.scheme === item.payment.scheme && review.network === item.payment.network &&
    review.asset === item.payment.asset && review.pay_to === item.payment.payTo &&
    review.max_atomic_units_to_reserve === item.payment.amount &&
    review.method === checkout.ticket.method && review.body_sha256 === checkout.ticket.bodySha256,
    'DOCUMENT_BATCH_NATIVE_APPROVAL_CHANGED');
  need(snapshot.current_native_budget_estimate?.approved === true,
    'DOCUMENT_BATCH_NATIVE_BUDGET_UNAVAILABLE');
  return {intent:checkout.intentId,approvalId:snapshot.id,requestSha256:review.request_sha256,
    decision:'approve',taskId:approval.taskId};
}
async function pause(milliseconds,signal) {
  cancelled(signal);
  await new Promise((resolve,reject)=>{
    const stop = ()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(signal.reason);};
    const timer = setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},milliseconds);
    signal?.addEventListener('abort',stop,{once:true});
  });
}
async function originalTask(controller,id,options,{signal,onApproval} = {}) {
  cancelled(signal);
  const started = await controller.start(id,options), taskId = started.task?.id;
  need(typeof taskId === 'string','DOCUMENT_BATCH_NATIVE_TASK_REQUIRED');
  let finished = false;
  const waiting = controller.wait(id,{taskId});
  waiting.then(()=>{finished=true;},()=>{finished=true;});
  const decided = new Set();
  try {
    while (!finished) {
      cancelled(signal);
      if (onApproval) {
        const approval = controller.approval(id), snapshot = approval.snapshot;
        if (approval.taskId === taskId && snapshot?.state === 'AWAITING_OPERATOR') {
          const key = snapshot.id + ':' + snapshot.review?.request_sha256;
          if (!decided.has(key)) {
            const decision = await onApproval(approval);
            cancelled(signal);
            await controller.decideApproval(id,decision);
            decided.add(key);
          }
        }
      }
      if (!finished) await pause(200,signal);
    }
    return await waiting;
  } catch (error) {
    await controller.cancel(id,{taskId}).catch(()=>{});
    await waiting.catch(()=>{});
    throw error;
  }
}
function supplierAdmissionError(code) {
  return [
    'JOB_NATIVE_DOCUMENT_AUTHENTICATION','JOB_NATIVE_DOCUMENT_SUBSCRIPTION',
    'JOB_NATIVE_DOCUMENT_RATE_OR_QUOTA','JOB_NATIVE_DOCUMENT_CAPACITY',
    'DOCUMENT_BATCH_NATIVE_BUDGET_UNAVAILABLE'
  ].includes(code);
}
async function ensureTicket(workspace,plan,item,{signal,intakeAccessToken} = {}) {
  let request = await workspace.intake.get(item.requestId);
  bindPlanRequest(plan,item,request);
  if (request.checkoutId) return request;
  if (intakeAccessToken !== undefined && !request.hasTicket && request.requestAttempts === 0)
    await workspace.intake.setAccess(request.id,{expectedRevision:request.revision,accessToken:intakeAccessToken});
  request = await workspace.intake.get(request.id);
  need(request.phase !== 'WITHDRAWN','DOCUMENT_BATCH_REQUEST_WITHDRAWN');
  request = await originalTask(workspace.intake,request.id,
    {kind:request.hasTicket ? 'import' : 'prepare',expectedRevision:request.revision},{signal});
  bindPlanRequest(plan,item,request);
  need(request.checkoutId,request.lastError ?? 'DOCUMENT_BATCH_CHECKOUT_NOT_READY');
  return request;
}
async function receiveJob(workspace,jobEntryId,{signal,deadlineMs,pollMs} = {}) {
  let job = workspace.get(jobEntryId);
  let outputs = job.receipt.delivery ? await workspace.outputs(job.id,{signal}) : null;
  if (!outputs?.received) {
    job = await originalTask(workspace,job.id,{kind:'fetch',deadlineMs,pollMs},{signal});
    outputs = job.receipt.delivery ? await workspace.outputs(job.id,{signal}) : null;
  }
  return {job,received:outputs?.received === true};
}

/**
 * An explicit plan approval authorizes only its retained native requests and prices.
 * The original checkout broker and native ledger still make each actual decision.
 */
export async function runDocumentBatch({workspace,plan,approvedPlanSha256,planSha256,
  signal,deadlineMs=300000,pollMs=1500,intakeAccessToken,onProgress} = {}) {
  validatePlan(plan,{directory:plan.directory,workspaceDirectory:workspace.directory});
  need(HASH.test(planSha256 ?? '') && digest(encoded(plan)) === planSha256 && approvedPlanSha256 === planSha256,
    'DOCUMENT_BATCH_APPROVED_PLAN_REQUIRED');
  need(workspace.directory === plan.workspaceDirectory,'DOCUMENT_BATCH_CUSTOMER_CHANGED');
  integer(deadlineMs,1000,3600000,'DOCUMENT_BATCH_DEADLINE_INVALID');
  integer(pollMs,250,30000,'DOCUMENT_BATCH_POLL_INVALID');
  // Re-read every retained source binding before the first native payment action.
  await inspectDocumentBatch({workspace,plan,signal});
  await workspace.checkout.enableBrowserApproval();
  const outcomes = [];
  let admission = null;
  for (let index=0;index<plan.items.length;index++) {
    cancelled(signal);
    const item = plan.items[index];
    try {
      const request = await ensureTicket(workspace,plan,item,{signal,intakeAccessToken});
      let checkout = workspace.checkout.get(request.checkoutId);
      bindCheckout(plan,item,request,checkout);
      if (!checkout.jobEntryId && checkout.attempted) {
        checkout = await originalTask(workspace.checkout,checkout.id,
          {kind:'recover',expectedRevision:checkout.revision},{signal});
        bindCheckout(plan,item,request,checkout);
      }
      if (!checkout.jobEntryId && !checkout.attempted) {
        if (checkout.phase !== 'REVIEWED') checkout = await originalTask(workspace.checkout,checkout.id,
          {kind:'review',expectedRevision:checkout.revision},{signal});
        bindCheckout(plan,item,request,checkout);
        need(checkout.phase === 'REVIEWED',checkout.lastError ?? 'DOCUMENT_BATCH_REVIEW_INCOMPLETE');
        checkout = await originalTask(workspace.checkout,checkout.id,
          {kind:'execute',expectedRevision:checkout.revision},{
            signal,onApproval:approval=>approveOriginal(plan,item,request,workspace.checkout.get(checkout.id),approval)
          });
        bindCheckout(plan,item,request,checkout);
      }
      if (!checkout.jobEntryId) {
        outcomes.push({id:item.id,requestId:item.requestId,checkoutId:checkout.id,
          state:'PAYMENT_CONTINUATION',error:checkout.lastError ?? checkout.native?.runtimeError ?? null});
      } else {
        const {job,received} = await receiveJob(workspace,checkout.jobEntryId,{signal,deadlineMs,pollMs});
        const error = job.receipt.latestStatus?.error?.code ?? job.lastError ?? null;
        outcomes.push({id:item.id,requestId:item.requestId,checkoutId:checkout.id,jobEntryId:job.id,
          state:received ? 'RECEIVED' : job.receipt.latestStatus?.state ?? 'PENDING',error});
        if (supplierAdmissionError(error)) admission = {itemId:item.id,code:error};
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      const code = cleanCode(error);
      outcomes.push({id:item.id,requestId:item.requestId,state:'CONTINUATION_REQUIRED',error:code});
      if (supplierAdmissionError(code)) admission = {itemId:item.id,code};
    }
    await onProgress?.({stage:'DOCUMENT_RESULT',index:index+1,total:plan.items.length,
      outcome:copy(outcomes[outcomes.length-1])});
    if (admission) break;
  }
  const snapshot = await inspectDocumentBatch({workspace,plan,signal});
  return {...snapshot,operation:{kind:'RUN',outcomes,admission,
    remainingUnvisited:plan.items.length-outcomes.length}};
}

/** Continue delivery for accepted original jobs; this operation makes no new purchase. */
export async function receiveDocumentBatch({workspace,plan,signal,deadlineMs=300000,pollMs=1500,onProgress} = {}) {
  need(workspace.directory === plan.workspaceDirectory,'DOCUMENT_BATCH_CUSTOMER_CHANGED');
  integer(deadlineMs,1000,3600000,'DOCUMENT_BATCH_DEADLINE_INVALID');
  integer(pollMs,250,30000,'DOCUMENT_BATCH_POLL_INVALID');
  const outcomes = [];
  for (let index=0;index<plan.items.length;index++) {
    cancelled(signal);
    const item = plan.items[index], request = await workspace.intake.get(item.requestId);
    bindPlanRequest(plan,item,request);
    const checkout = request.checkoutId ? workspace.checkout.get(request.checkoutId) : null;
    if (!checkout?.jobEntryId) continue;
    bindCheckout(plan,item,request,checkout);
    try {
      const {job,received} = await receiveJob(workspace,checkout.jobEntryId,{signal,deadlineMs,pollMs});
      outcomes.push({id:item.id,jobEntryId:job.id,state:received ? 'RECEIVED' :
        job.receipt.latestStatus?.state ?? 'PENDING',error:job.lastError ?? null});
    } catch(error) {
      if (signal?.aborted) throw error;
      outcomes.push({id:item.id,jobEntryId:checkout.jobEntryId,error:cleanCode(error)});
    }
    await onProgress?.({stage:'DOCUMENT_RECEIVING',index:index+1,total:plan.items.length,
      outcome:copy(outcomes[outcomes.length-1])});
  }
  return {...await inspectDocumentBatch({workspace,plan,signal}),operation:{kind:'RECEIVE',outcomes}};
}
export async function saveDocumentBatchReport({snapshot,plan,directory} = {}) {
  directory = await ownedDirectory(absolute(directory),{create:true});
  const lease = await acquireStateLease(directory);
  try {
    const files = {
      'batch-plan.json':encoded(plan),
      'batch-results.json':encoded(snapshot),
      'batch-results.csv':Buffer.from(renderDocumentBatchCsv(snapshot)),
      'batch-review.html':Buffer.from(renderDocumentBatchHtml(snapshot))
    };
    const result = [];
    for (const [name,bytes] of Object.entries(files)) {
      need(bytes.length <= 67108864,'DOCUMENT_BATCH_REPORT_TOO_LARGE');
      lease.assertHeld(); await writeExact(join(directory,name),bytes);
      result.push({name,bytes:bytes.length,sha256:digest(bytes)});
    }
    return {directory,files:result};
  } finally {await lease.close();}
}
async function saveResultCollection(workspace,plan,snapshot,signal) {
  const members = [];
  for (const row of snapshot.rows) if (row.received) {
    cancelled(signal);
    const job = workspace.get(row.jobEntryId), output = await workspace.outputs(job.id,{signal});
    for (const id of [job.resourceId,...output.files.map(file=>file.resourceId)]) {
      need(id,'DOCUMENT_BATCH_LIBRARY_RESOURCE_REQUIRED');
      const resource = workspace.library.resource(id);
      need(resource.status === 'VERIFIED' && resource.sha256,'DOCUMENT_BATCH_LIBRARY_RECEIVING_INCOMPLETE');
      members.push({id:resource.id,sha256:resource.sha256,annotationRevision:resource.annotation.revision});
    }
  }
  need(members.length > 0,'DOCUMENT_BATCH_RECEIVED_DOCUMENT_REQUIRED');
  const id = 'documents.' + digest(canonical([workspace.directory,plan.id,plan.inputSha256])).slice(0,48);
  let current = null;
  try {current = workspace.library.collections.show(id);}
  catch (error) {if(error.code !== 'COLLECTION_NOT_FOUND')throw error;}
  const note = current?.note ?? 'Document batch ' + plan.id + '; input ' + plan.inputSha256 +
    '; original task references and complete sets are in batch-results.json.';
  const name = current?.name ?? plan.name;
  const chosen = new Set(members.map(member=>member.id));
  for (const previous of current?.members ?? []) if (!chosen.has(previous.id))
    members.push({id:previous.id,sha256:previous.sha256,annotationRevision:previous.annotation.revision,mode:'retain'});
  const selectors = values=>values.map(value=>({id:value.id,sha256:value.sha256,
    annotationRevision:value.annotationRevision ?? value.annotation.revision}));
  if (current && equal(selectors(current.members),selectors(members))) return current;
  return workspace.library.collections.save({id,name,note,members,
    expectedRevision:current?.revision ?? 0,
    operationId:'document-batch:' + digest(canonical([id,current?.revision ?? 0,members])).slice(0,64)});
}
export async function exportDocumentBatch({workspace,plan,directory,signal,maxBytes} = {}) {
  await workspace.scan({signal});
  let snapshot = await inspectDocumentBatch({workspace,plan,signal});
  const collection = await saveResultCollection(workspace,plan,snapshot,signal);
  directory = await ownedDirectory(absolute(directory),{create:true});
  const archivePath = join(directory,'documents.tar');
  let archive;
  try {
    archive = await inspectCollectionArchive(archivePath,{signal,maxBytes});
    need(archive.manifest.collection.id === collection.id &&
      archive.manifest.collection.revision === collection.revision &&
      equal(archive.manifest.collection,collection), 'DOCUMENT_BATCH_ARCHIVE_EDITION_CHANGED');
    archive = {path:archivePath,bytes:archive.bytes,sha256:archive.sha256};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    archive = await exportCollection(workspace.library,{id:collection.id,revision:collection.revision,
      destination:archivePath,signal,maxBytes});
  }
  try {
    const prior = parse(await ownedBytes(join(directory,'batch-results.json'),67108864));
    need(prior.schema === DOCUMENT_BATCH_SNAPSHOT_SCHEMA && prior.id === plan.id &&
      prior.inputSha256 === plan.inputSha256 && equal(prior.rows.map(row=>row.requestId),plan.items.map(item=>item.requestId)) &&
      equal(prior.rows.filter(row=>row.received).map(row=>[row.requestId,row.outputs.package.sha256]),
        snapshot.rows.filter(row=>row.received).map(row=>[row.requestId,row.outputs.package.sha256])),
      'DOCUMENT_BATCH_REPORT_EDITION_CHANGED');
    snapshot = prior;
  } catch(error) {if(error.code !== 'ENOENT')throw error;}
  const report = await saveDocumentBatchReport({snapshot,plan,directory});
  const exported = {schema:'stellar-forge.document-batch-export.v1',batchId:plan.id,directory,
    collection:{id:collection.id,revision:collection.revision,members:collection.members.length},
    documents:plan.items.length,receivedDocuments:snapshot.receivedDocuments,
    observedAt:snapshot.observedAt,
    archive:{path:archive.path,bytes:archive.bytes,sha256:archive.sha256},files:report.files};
  const lease = await acquireStateLease(directory);
  try {
    lease.assertHeld(); await writeExact(join(directory,'batch-export.json'),encoded(exported));
    return exported;
  } finally {await lease.close();}
}
export async function receiveDocumentBatchCollection({archive,destination,libraryState,expectedSha256,
  resume=true,signal,maxBytes} = {}) {
  const receipt = await receiveCollection({archive: absolute(archive),destination:absolute(destination),
    expectedSha256,resume,signal,maxBytes});
  const library = await openReceivedLibrary({directory:receipt.directory,state:absolute(libraryState),signal});
  try {return {schema:'stellar-forge.document-batch-receiving.v1',receipt,library:library.status(),
    collection:library.collections.show(receipt.collectionId)};}
  finally {await library.close();}
}
export {openJobWorkspace as openDocumentBatchCustomer};
