// MIT. Portable live merchant package and original SF88 customer request/receiving.
import { constants } from 'node:fs';
import { open,mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareReview } from '../../../sf88-operator-buyer-cli/prepare.mjs';
import { compileQuery } from '../source.mjs';
import { prepareProduct,json } from './config.mjs';
import { buildQuery,digest,validatePage,plain } from './contract.mjs';
export async function readBytes(path,limit=16777216) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();if(!info.isFile()||info.size>limit)throw new TypeError('Select a regular source file within its size limit');
    const content=await handle.readFile();if(content.length>limit)throw new TypeError('Source file grew beyond its size limit');return content;
  }finally{await handle.close();}
}
export async function readJson(path,limit) {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path,limit)));}
export function prepareDraft({catalog,plan,selection},options={}) {
  const prepared=prepareProduct(plan,catalog,options);
  if(!plain(selection)||typeof selection.operation!=='string'||!plain(selection.request)||Object.keys(selection).some(key=>!['operation','request'].includes(key)))
    throw new TypeError('Choose one live merchant operation and its customer query');
  const query=buildQuery(prepared.plan,catalog,selection.operation,selection.request);
  return {...prepared,selection:{operation:selection.operation,request:query.query},query};
}
/** Consume the original retained operator workspace without a second project store. */
export async function prepareFromWorkspace(workspace,{planId,plan,operation}={},options={}) {
  const state=await workspace.state(),retained=state.plans.find(row=>row.id===planId);
  if(!retained)throw new TypeError('Choose a saved original OData query');
  const connection=state.connections.find(row=>row.id===retained.connectionId);
  if(!connection||connection.catalogHash!==retained.catalogHash)throw new TypeError('The saved query belongs to a different metadata edition');
  const compiled=compileQuery(connection.catalog,retained.query.plan);
  if(compiled.fingerprint!==retained.query.fingerprint)throw new TypeError('The original saved query changed');
  const catalog=structuredClone(connection.catalog);
  for(const receipt of Object.values(catalog.receipts)) {
    const bytes=receipt.rawBase64?Buffer.from(receipt.rawBase64,'base64'):await workspace.raw(receipt.sha256);
    if(digest(bytes)!==receipt.sha256)throw new TypeError('Original catalog source identity changed');
    receipt.rawBase64=bytes.toString('base64');
  }
  const {entitySet,...request}=compiled.plan;
  const id=operation??plan.operations.find(row=>row.entitySet===entitySet||row.entitySet===compiled.entitySet)?.id;
  return prepareDraft({catalog,plan,selection:{operation:id,request}},options);
}
export async function writePackage(prepared,directory) {
  const root=resolve(directory);await mkdir(root,{mode:0o700});
  const files={'catalog.json':json(prepared.catalog),'plan.json':json(prepared.plan),
    'seller-service.json':json(prepared.service),'offers.json':json(prepared.offers),'openapi.json':json(prepared.spec),
    'customer-query.json':json(prepared.selection),'request.json':json(prepared.selection.request)};
  for(const [name,content]of Object.entries(files))await writeFile(join(root,name),content,{flag:'wx',mode:0o600});
  const manifest={schema:'stellar-forge.odata-live-package.v1',id:randomUUID(),createdAt:new Date().toISOString(),
    sourceBinding:prepared.sourceBinding,files:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,{bytes:Buffer.byteLength(content),sha256:digest(content)}]))};
  await writeFile(join(root,'package.json'),json(manifest),{flag:'wx',mode:0o600});return {directory:root,...manifest};
}
export async function readPackage(directory,options={}) {
  const root=resolve(directory),manifest=await readJson(join(root,'package.json'),65536);
  const required=['catalog.json','plan.json','seller-service.json','offers.json','openapi.json','customer-query.json','request.json'];
  if(manifest.schema!=='stellar-forge.odata-live-package.v1'||!plain(manifest.files)||Object.keys(manifest.files).length!==required.length||
      required.some(name=>!Object.hasOwn(manifest.files,name)))throw new TypeError('Original complete live OData package required');
  const loaded={};
  for(const name of required){const content=await readBytes(join(root,name));
    if(content.length!==manifest.files[name].bytes||digest(content)!==manifest.files[name].sha256)throw new TypeError('Live OData package changed: '+name);
    loaded[name]=new TextDecoder('utf-8',{fatal:true}).decode(content);}
  const prepared=prepareDraft({catalog:JSON.parse(loaded['catalog.json']),plan:JSON.parse(loaded['plan.json']),selection:JSON.parse(loaded['customer-query.json'])},options);
  if(prepared.sourceBinding!==manifest.sourceBinding||json(prepared.service)!==loaded['seller-service.json']||
      json(prepared.offers)!==loaded['offers.json']||json(prepared.spec)!==loaded['openapi.json']||json(prepared.selection.request)!==loaded['request.json'])
    throw new TypeError('Original OData compiler and selected package disagree');
  return {...prepared,directory:root,manifest};
}
export async function prepareBuyerHandoff(prepared,{operation,request,intentId,directory,acceptIndex=0}={}) {
  const rowIndex=prepared.plan.operations.findIndex(row=>row.id===operation);
  if(rowIndex<0)throw new TypeError('Select an exported live OData product');
  if(Object.hasOwn(request??{},'cursor')) {
    if(!plain(request)||Object.keys(request).length!==1||typeof request.cursor!=='string'||!request.cursor||request.cursor.length>32768)
      throw new TypeError('A next-page handoff takes its original cursor only');
  }else request=buildQuery(prepared.plan,prepared.catalog,operation,request).query;
  const root=resolve(directory),config=prepareReview(Buffer.from(json(prepared.offers)),{rowIndex,acceptIndex,intentId,
    url:prepared.plan.publicOrigin+prepared.plan.operations[rowIndex].path,method:'POST',bodyFile:join(root,'request.json'),bodyBytes:Buffer.byteLength(json(request)),bodySha256:digest(json(request)),responseOut:join(root,'response.json')});
  await mkdir(root,{mode:0o700});
  for(const [name,value]of Object.entries({'request.json':request,'offers.json':prepared.offers,'buyer.json':config.draft}))
    await writeFile(join(root,name),json(value),{flag:'wx',mode:0o600});
  const result={schema:'stellar-forge.odata-live-buyer-handoff.v1',directory:root,operation,intentId,metadataSha256:prepared.catalog.receipts.metadata.sha256,
    requestSha256:digest(json(request)),buyerSha256:config.configSha256};
  await writeFile(join(root,'handoff.json'),json(result),{flag:'wx',mode:0o600});return result;
}
export async function receivePage(prepared,{operation,responsePath,directory}={}) {
  const original=await readBytes(responsePath,16777216),page=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));
  validatePage(page,prepared.plan,prepared.catalog,operation);
  const root=resolve(directory);await mkdir(root,{mode:0o700});
  const jsonl=page.items.map(row=>JSON.stringify(row)).join('\n')+(page.items.length?'\n':'');
  const manifest={schema:'stellar-forge.odata-live-receiving.v1',operation,metadataSha256:prepared.catalog.receipts.metadata.sha256,
    rows:page.items.length,seenRows:page.seenRows,count:page.count,columns:page.query.select,query:page.query,queryFingerprint:page.queryFingerprint,
    completion:page.completion,supplierResponseSha256:page.supplierResponseSha256,
    originalResponse:{file:'original-response.json',sha256:digest(original),bytes:original.length},
    jsonl:{file:'rows.jsonl',sha256:digest(jsonl),bytes:Buffer.byteLength(jsonl)},nextRequest:page.next?'next-request.json':null};
  await writeFile(join(root,'original-response.json'),original,{flag:'wx',mode:0o600});
  await writeFile(join(root,'rows.jsonl'),jsonl,{flag:'wx',mode:0o600});
  if(page.next)await writeFile(join(root,'next-request.json'),json({cursor:page.next}),{flag:'wx',mode:0o600});
  await writeFile(join(root,'receiving.json'),json(manifest),{flag:'wx',mode:0o600});return {directory:root,...manifest};
}
