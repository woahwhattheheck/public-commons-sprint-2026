// MIT. Document review and receiving in the original research workspace.
import { join, resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Buyer } from '../node/client.mjs';
import { readBytes, readJson, parseJson } from '../node/store.mjs';
import { canonicalBytes, digest, need, object } from '../node/unstructured/contract.mjs';
import {
  createPartitionEditionProvider, verifyPartitionResearchEnvelope, receivePartitionEnvelope,
} from '../node/unstructured/dossier.mjs';
import { decodePartitionBytes } from '../node/unstructured/purchase.mjs';
import { PARTITION_LIMITS } from '../node/unstructured/contract.mjs';

const nativeRuntime = resolve(fileURLToPath(new URL('../', import.meta.url)));
const HEX = /^[a-f0-9]{64}$/;
const ID = /^u_[a-f0-9]{64}$/;
const copy = value => structuredClone(value);
const sourceRoute = operation => {
  if (operation?.method !== 'POST' || typeof operation.url !== 'string') return null;
  try {
    const url = new URL(operation.url);
    return /^\/documents\/unstructured\/([a-z][a-z0-9-]{0,39})$/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
};
const safeFilename = (name, fallback) => {
  const value = typeof name === 'string' ? name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0,150) : '';
  return /^[A-Za-z0-9]/.test(value) ? value : fallback;
};
const metadata = purchase => ({
  filename: purchase.document.filename, contentType: purchase.document.contentType,
  bytes: purchase.document.bytes, sha256: purchase.document.sha256,
});
function selected(value) {
  need(object(value) && Object.keys(value).every(key => ['purchaseId','editionId'].includes(key)) &&
    [typeof value.purchaseId === 'string', typeof value.editionId === 'string'].filter(Boolean).length === 1,
  'UNSTRUCTURED_ONE_DOCUMENT_SELECTION_REQUIRED');
  if (value.purchaseId !== undefined) need(ID.test(value.purchaseId), 'UNSTRUCTURED_PURCHASE_ID_INVALID');
  if (value.editionId !== undefined) need(/^e_[a-f0-9]{64}$/.test(value.editionId), 'UNSTRUCTURED_EDITION_ID_INVALID');
  return copy(value);
}
function requestedHash(value) {
  need(typeof value === 'string' && HEX.test(value), 'UNSTRUCTURED_REVIEWED_EDITION_REQUIRED');
  return value;
}

/** Open a launcher-selected original buyer source; browser requests never provide these paths. */
export async function openSavedDocumentBuyerSource(configPath) {
  need(typeof configPath === 'string' && isAbsolute(configPath) && resolve(configPath) === configPath,
    'UNSTRUCTURED_DOCUMENT_SOURCE_PATH_REQUIRED');
  const value = await readJson(configPath, 1024 * 1024);
  need(object(value) && value.schema === 'stellar-forge.unstructured-document-source.v1' &&
    Object.keys(value).every(key => ['schema','workspaceId','runtimeDirectory','stateDirectory','inboxDirectory'].includes(key)),
  'UNSTRUCTURED_DOCUMENT_SOURCE_CONFIG_INVALID');
  need(typeof value.workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.workspaceId),
    'UNSTRUCTURED_WORKSPACE_ID_REQUIRED');
  const runtimeDirectory = value.runtimeDirectory ?? nativeRuntime;
  const stateDirectory = value.stateDirectory ?? value.inboxDirectory;
  for (const path of [runtimeDirectory,stateDirectory,...(value.inboxDirectory === undefined ? [] : [value.inboxDirectory])]) {
    need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
      'UNSTRUCTURED_DOCUMENT_SOURCE_ABSOLUTE_PATHS_REQUIRED');
    need((await stat(path)).isDirectory(), 'UNSTRUCTURED_DOCUMENT_SOURCE_DIRECTORY_REQUIRED');
  }
  const buyer = new Buyer({runtimeDirectory,stateDirectory});
  return {buyer,runtimeDirectory,workspaceId:value.workspaceId,
    ...(value.inboxDirectory === undefined ? {} : {inboxDirectory:value.inboxDirectory})};
}

/** Host supplies the original buyer/inbox once. Browser selections contain no filesystem path. */
export async function openUnstructuredWorkspace({
  dossiers, buyer = null, workspaceId, inboxDirectory,
  runtimeDirectory = buyer?.runtime.directory ?? nativeRuntime,
} = {}) {
  need(dossiers && typeof dossiers.get === 'function' && typeof dossiers.readRetainedEdition === 'function',
    'UNSTRUCTURED_ORIGINAL_RETAINED_EDITION_READER_REQUIRED');
  need(buyer === null || buyer instanceof Buyer, 'ORIGINAL_DOCUMENT_BUYER_REQUIRED');
  need(typeof runtimeDirectory === 'string' && resolve(runtimeDirectory) === runtimeDirectory,
    'UNSTRUCTURED_NATIVE_RUNTIME_REQUIRED');
  const provider = buyer ? createPartitionEditionProvider(buyer, { workspaceId, inboxDirectory }) : null;
  let cached = null;
  const clear = () => { cached = null; };
  const dossierMetadata = id => typeof dossiers.getMetadata === 'function' ?
    dossiers.getMetadata(id) : dossiers.get(id);

  async function sourcePurchases() {
    if (!buyer) return {items:[],warnings:[]};
    const items = [], warnings = [];
    if (inboxDirectory !== undefined) {
      const result = await buyer.inbox(inboxDirectory).list();
      need(Array.isArray(result.native?.jobs), 'UNSTRUCTURED_ORIGINAL_INBOX_LIST_INVALID');
      for (const job of result.native.jobs) {
        const profileId = sourceRoute(job.operation);
        if (!profileId) {
          if (job.state === 'REVIEW_REQUIRED') warnings.push({id:job.id,error:job.lastError?.code ?? 'ORIGINAL_INBOX_REVIEW_REQUIRED'});
          continue;
        }
        need(HEX.test(job.id) && job.id === digest(job.operation.intentId),
          'UNSTRUCTURED_ORIGINAL_INBOX_LIST_INVALID');
        items.push({id:'u_'+job.id,intentId:job.operation.intentId,profileId,createdAt:job.createdAt,
          configurationSha256:job.configSha256,state:job.state,
          outputStatus:job.outcome?.responseFile?.status ?? 'NOT_SAVED',
          paymentStatus:job.outcome?.status ?? null});
      }
    } else {
      for await (const operation of buyer.list()) {
        let meta, raw, config;
        try {
          meta = await readJson(join(operation.directory,'operation.json'));
          raw = await readBytes(operation.configPath);
          need(digest(raw) === meta.configSha256, 'UNSTRUCTURED_ORIGINAL_CONFIGURATION_CHANGED');
          config = parseJson(raw);
        } catch (error) {
          warnings.push({id:'u_'+digest(operation.intentId),error:error.code ?? 'ORIGINAL_BUYER_REVIEW_REQUIRED'});
          continue;
        }
        const profileId = sourceRoute(config.operation);
        if (!profileId) continue;
        need(config.operation.intentId === operation.intentId && meta.intentId === operation.intentId,
          'UNSTRUCTURED_ORIGINAL_OPERATION_CHANGED');
        items.push({id:'u_'+digest(operation.intentId),intentId:operation.intentId,profileId,
          createdAt:meta.createdAt,configurationSha256:meta.configSha256,state:meta.state,
          outputStatus:'OPEN_ORIGINAL_RESULT',paymentStatus:null});
      }
    }
    items.sort((a,b)=>a.id.localeCompare(b.id));
    return {items,warnings};
  }
  async function resolvePurchase(id) {
    need(provider && ID.test(id), 'UNSTRUCTURED_BUYER_SOURCE_NOT_CONFIGURED');
    const row = (await sourcePurchases()).items.find(item=>item.id===id);
    need(row, 'UNSTRUCTURED_PURCHASE_NOT_FOUND');
    return row;
  }
  async function capture(dossierId, selection) {
    selection = selected(selection);
    const dossier = await dossierMetadata(dossierId);
    let envelope, retained = null;
    if (selection.purchaseId) {
      const purchase = await resolvePurchase(selection.purchaseId);
      envelope = await provider.envelope(purchase.intentId);
    } else {
      const edition = dossier.editions.find(row=>row.id===selection.editionId);
      need(edition?.mode === 'retained' && edition.origin?.mode === 'ORIGINAL_UNSTRUCTURED_SAVED_BUYER_RESULT',
        'UNSTRUCTURED_RETAINED_EDITION_REQUIRED');
      const original = await dossiers.readRetainedEdition(dossierId, selection.editionId);
      need(original.edition.id === edition.id && original.bytes instanceof Uint8Array &&
        digest(original.bytes) === edition.raw.sha256, 'UNSTRUCTURED_RETAINED_EDITION_CHANGED');
      envelope = parseJson(original.bytes);
      retained = {id:edition.id,label:edition.label,questionId:edition.questionId,createdAt:edition.createdAt};
    }
    const checked = await verifyPartitionResearchEnvelope(envelope, {runtimeDirectory});
    const key = JSON.stringify([dossierId,selection]);
    cached = {key,dossierId,selection,checked,retained};
    return cached;
  }
  async function observed(dossierId, selection, expectedEditionSha256) {
    selection = selected(selection);
    requestedHash(expectedEditionSha256);
    const key = JSON.stringify([dossierId,selection]);
    const value = cached?.key === key ? cached : await capture(dossierId,selection);
    need(value.checked.editionSha256===expectedEditionSha256, 'UNSTRUCTURED_REVIEWED_EDITION_CHANGED');
    return value;
  }
  const publicReview = value => {
    const {checked,retained} = value, purchase=checked.envelope.originalPurchase;
    return {
      selection:copy(value.selection),editionSha256:checked.editionSha256,
      binding:copy(checked.binding),document:metadata(purchase),
      summary:copy(purchase.summary),parameters:copy(purchase.selection.parameters),
      native:copy(purchase.native),retained,warnings:copy(checked.envelope.warnings),
    };
  };
  async function list(dossierId,{after='',limit=20}={}) {
    need(typeof after==='string' && (after==='' || ID.test(after)) &&
      Number.isSafeInteger(limit) && limit>=1 && limit<=100,'UNSTRUCTURED_LIST_SELECTION_INVALID');
    const dossier=await dossierMetadata(dossierId),source=await sourcePurchases();
    const remaining=source.items.filter(item=>after==='' || item.id>after),purchases=remaining.slice(0,limit);
    const editions=dossier.editions.filter(edition=>edition.mode==='retained' &&
      edition.origin?.mode==='ORIGINAL_UNSTRUCTURED_SAVED_BUYER_RESULT').map(edition=>({
        id:edition.id,label:edition.label,questionId:edition.questionId,createdAt:edition.createdAt,
        document:copy(edition.origin.document),profileId:edition.origin.profileId,
        intentId:edition.origin.intentId,elementCount:edition.origin.elementCount ?? edition.itemCount ?? null,
      }));
    return {configured:provider!==null,workspaceId:workspaceId??null,purchases,editions,warnings:source.warnings,
      nextAfter:remaining.length>limit?purchases.at(-1).id:null,revision:dossier.revision};
  }
  async function review(dossierId,selection) {
    return publicReview(await capture(dossierId,selection));
  }
  async function elements(dossierId,{
    selection,expectedEditionSha256,offset=0,limit=25,page='',type='',query='',
  }={}) {
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100&&
      [page,type,query].every(value=>typeof value==='string')&&page.length<=100&&type.length<=200&&query.length<=2000,
    'UNSTRUCTURED_ELEMENT_FILTER_INVALID');
    const value=await observed(dossierId,selection,expectedEditionSha256),search=query.toLocaleLowerCase();
    const all=value.checked.elements.map((element,index)=>({position:index+1,element}));
    const filtered=all.filter(({element})=>(page===''||String(element.metadata.page_number??'')===page)&&
      (type===''||String(element.type??'Unspecified')===type)&&
      (search===''||element.text.toLocaleLowerCase().includes(search)));
    return {editionSha256:value.checked.editionSha256,total:all.length,filtered:filtered.length,offset,limit,
      items:filtered.slice(offset,offset+limit).map(copy),nextOffset:offset+limit<filtered.length?offset+limit:null};
  }
  async function download(dossierId,{selection,expectedEditionSha256,file}={}) {
    need(['document','response','edition'].includes(file),'UNSTRUCTURED_DOWNLOAD_SELECTION_INVALID');
    const value=await observed(dossierId,selection,expectedEditionSha256),purchase=value.checked.envelope.originalPurchase;
    let bytes,filename,contentType;
    if(file==='document') {
      bytes=value.checked.document;
      filename=safeFilename(purchase.document.filename,'original-document.bin');
      // Active document formats are always downloaded, never embedded in the operator origin.
      contentType='application/octet-stream';
    } else if(file==='response') {
      bytes=decodePartitionBytes(purchase.response,PARTITION_LIMITS.responseBytes);
      filename=safeFilename(purchase.document.filename,'document')+'.elements.json';
      contentType='application/json; charset=utf-8';
    } else {
      bytes=canonicalBytes(value.checked.envelope);
      filename=safeFilename(purchase.document.filename,'document')+'.research.json';
      contentType='application/json; charset=utf-8';
    }
    return {bytes,filename,contentType,sha256:digest(bytes)};
  }
  async function receive(dossierId,{
    selection,expectedEditionSha256,questionId,label,expectedRevision,
  }={}) {
    selection=selected(selection);
    need(selection.purchaseId!==undefined,'UNSTRUCTURED_PURCHASE_SELECTION_REQUIRED');
    requestedHash(expectedEditionSha256);
    // Fresh original bytes at mutation time; the cached read never substitutes for source reconciliation.
    const current=await capture(dossierId,selection);
    const result=await receivePartitionEnvelope(dossiers,dossierId,{
      envelope:current.checked.envelope,runtimeDirectory,questionId,label,expectedRevision,
      expectedEditionSha256,mode:'retained',
    });
    clear();
    return result;
  }
  return Object.freeze({provider,list,review,elements,download,receive,clear,
    configured:provider!==null,workspaceId:workspaceId??null});
}
