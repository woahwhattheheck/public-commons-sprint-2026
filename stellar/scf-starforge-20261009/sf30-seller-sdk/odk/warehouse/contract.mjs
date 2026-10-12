// MIT. Bind one original accepted Central CSV export to its commissioning period.
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fault, identifier, stable, digest } from '../../odata/state.mjs';
import { validateDatasetSemantics } from '../../dataset-handler.mjs';
import { centralTableEdition } from '../analysis.mjs';
import { verifyFile } from '../store.mjs';
import { fingerprint, resolveCaptureTable } from '../commissioning/agreement.mjs';

export const APPROVAL_SCHEMA='stellar-forge.odk-central-postgres-approval.v1';
const SOURCE_SCHEMA='stellar-forge.odata-dataset-source.v1';
const HASH=/^[a-f0-9]{64}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
const need=(value,message,code='CENTRAL_WAREHOUSE_SOURCE')=>{
  if(!value)throw fault(code,message,409);
};
const equal=(left,right)=>stable(left)===stable(right);

export function selection(input={}) {
  const {deliveryId,datasetId,period}=input;
  identifier(deliveryId,'original commissioning delivery ID');
  identifier(datasetId,'original approved dataset ID');
  need(Number.isSafeInteger(period)&&period>=0&&period<=1,'Choose original period 0 or 1.','CENTRAL_WAREHOUSE_PERIOD');
  return {deliveryId,datasetId,period};
}
export function relativeMember(value) {
  need(typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.includes('\\')&&
    !value.includes('\0')&&!value.includes(':')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'),
    'Retain the original relative export member path.','CENTRAL_WAREHOUSE_FILE');
  return value;
}
function receipt(value) {
  need(value&&HASH.test(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0,
    'Use the complete original native export file receipt.','CENTRAL_WAREHOUSE_FILE');
  return {bytes:value.bytes,sha256:value.sha256};
}
export function originalSelection({workspace,store,input}) {
  const chosen=selection(input),delivery=store.get('commissioning-delivery',chosen.deliveryId),
    commission=store.get('commissioning',delivery.request?.commissionId);
  need(Array.isArray(delivery.datasets)&&Array.isArray(delivery.request?.captures),
    'Finish the original native dataset delivery before selecting its approved output.');
  const selected=delivery.request.captures.find(x=>x.period===chosen.period),
    datasets=delivery.datasets.filter(x=>x.period===chosen.period&&x.id===chosen.datasetId);
  need(selected&&datasets.length===1,'Select one actual retained dataset from this original reporting period.');
  const delivered=datasets[0],capture=workspace.edition({id:selected.captureId}),
    dataset=store.get('export',chosen.datasetId),period=commission.definition.periods[chosen.period],
    plan=commission.definition.plans[chosen.period],table=capture.tables.find(x=>x.id===dataset.tableId),
    review=capture.decisions.find(x=>x.id===selected.reviewId);
  need(delivery.request.commissionDefinitionSha256===fingerprint(commission.definition),
    'The retained delivery must use this complete immutable commissioning definition.');
  need(capture.status==='COMPLETE'&&capture.contentHash===selected.contentHash&&
    capture.planId===plan.id&&equal(capture.scope,period.scope),
    'The approved dataset must retain the original complete period capture and source identity.');
  need(review?.decision==='accept'&&review.captureId===capture.id&&review.contentHash===capture.contentHash,
    'Retain the exact original accepted review that issued this dataset.');
  need(dataset.kind==='dataset'&&dataset.captureId===capture.id&&delivered.captureId===capture.id&&
    delivered.tableId===dataset.tableId&&table,'The retained dataset belongs to another native table or capture.');
  need(equal(delivered.files,dataset.files)&&equal(delivered.receipts,dataset.receipts),
    'The original commissioning handover and native export files differ.');
  const outputs=commission.definition.outputs.filter(output=>{
    try{return resolveCaptureTable(capture,output).id===table.id;}catch{return false;}
  });
  need(outputs.length===1,'Bind this native table to one explicitly approved commissioning output.');
  const output=outputs[0],required=[...table.query.keyFields,...(table.relation?[table.relation.parentField]:[])],
    fields=[...new Set([...required,...output.fields])];
  need(required.every(path=>output.fields.includes(path))&&equal(dataset.mapping.map(x=>x.path),fields),
    'The approved field list must explicitly include the native row and repeat-parent keys.');
  const form=capture.forms.find(x=>x.key===table.formKey);
  need(form&&String(form.projectId)===output.projectId&&form.formId===output.formId,
    'Retain the exact original project, form and table identity.');
  return {chosen,delivery,commission,selected,capture,dataset,period,plan,table,review,output,form,fields};
}

async function readJson(file) {
  const raw=await readFile(file.path);
  need(raw.length===file.bytes&&digest(raw)===file.sha256,
    'An original metadata file changed while preparing its warehouse intake.','CENTRAL_WAREHOUSE_FILE');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw fault('CENTRAL_WAREHOUSE_JSON','The original native metadata is not complete UTF-8 JSON.',422);}
}

/**
 * The approval carries relative native export paths only. Pass the current
 * source-workspace directory separately to the original Python operator.
 * No provider read, capture, review acceptance or dataset export is performed.
 */
export async function prepareCentralApproval({workspace,store,input}={}) {
  need(workspace?.directory&&store?.directory===workspace.directory,
    'Use the original Central workspace and its already-held Store.');
  const before=originalSelection({workspace,store,input});
  const {chosen,delivery,commission,selected,capture,dataset,period,plan,table,review,output,form}=before;
  identifier(dataset.id,'original export ID');
  need(Array.isArray(dataset.files)&&new Set(dataset.files).size===dataset.files.length&&
    equal([...dataset.files].sort(),Object.keys(dataset.receipts??{}).sort()),
    'The complete native file list and receipt map must match.');
  const required=['dataset.json','dataset.csv','source.json','semantics.json','table-schema.json',
    'capture/manifest.json','capture/metadata.csdl','capture/service.json','rows.jsonl'];
  need(required.every(name=>dataset.files.includes(name)),'Select the complete original Central dataset export.');
  const exportRoot='exports/'+dataset.id,absoluteRoot=resolve(workspace.directory,exportRoot),files=[],resolved=new Map();
  for(const name of dataset.files) {
    relativeMember(name);
    const expected=receipt(dataset.receipts[name]),file=await workspace.exportFile({id:dataset.id,path:name}),
      actualRelative=relative(absoluteRoot,resolve(file.path));
    need(actualRelative.split(sep).join('/')===name&&equal(receipt(file),expected),
      'Resolve each selected file through its original native export at this workspace.','CENTRAL_WAREHOUSE_FILE');
    const actual=await verifyFile(file.path,expected.sha256);
    need(actual.bytes===expected.bytes,'The original retained export file has another byte count.','CENTRAL_WAREHOUSE_FILE');
    files.push({path:name,...expected});resolved.set(name,{...file,...expected});
  }
  const [config,source,dictionary,tableSchema,manifest]=await Promise.all([
    readJson(resolved.get('dataset.json')),readJson(resolved.get('source.json')),
    readJson(resolved.get('semantics.json')),readJson(resolved.get('table-schema.json')),
    readJson(resolved.get('capture/manifest.json'))]);
  need(config.schema==='stellar-forge.csv-dataset.v1'&&config.file==='dataset.csv'&&
    source.schema===SOURCE_SCHEMA&&source.provider==='odk-central',
    'Use the native Central CSV configuration and its original OData source descriptor.');
  need(source.captureId===capture.id&&source.tableId===table.id&&source.rowCount===table.rowCount&&
    source.editionId===dataset.editionId&&equal(source.mapping,dataset.mapping)&&equal(source.review,review)&&
    equal(source.scope,capture.scope)&&equal(source.relationship??null,table.relation??null)&&
    equal(source.keyFields,table.query.keyFields),
    'The original source descriptor differs from this accepted period/table/review.');
  const edition=centralTableEdition(store,capture,table);
  need(source.contentHash===edition.contentHash&&source.catalogHash===edition.catalogHash&&
    source.editionId===edition.id&&source.queryUrl===edition.query.url&&equal(source.query,edition.query.plan),
    'The exact original table edition, source query or catalogue identity changed.');
  need(equal(config.semantics,dictionary)&&equal(dictionary.csvw,tableSchema),
    'The native dataset configuration and complete field dictionary must be the same original definition.');
  need(config.columns&&typeof config.columns==='object'&&!Array.isArray(config.columns),
    'Retain the original native column declaration object.');
  const physical=Object.entries(config.columns).map(([name,raw])=>{
    const spec=typeof raw==='string'?{type:raw}:raw;
    need(spec&&typeof spec==='object'&&!Array.isArray(spec)&&
      ['string','integer','number','boolean'].includes(spec.type)&&
      Object.keys(spec).every(key=>['type','nullable'].includes(key))&&
      (spec.nullable===undefined||typeof spec.nullable==='boolean'),
      'Retain each original physical column declaration.');
    return {name,type:spec.type,nullable:spec.nullable??false};
  });
  validateDatasetSemantics(dictionary,physical);
  need(source.semantics?.sha256===dictionary.sha256&&
    source.semantics.definitionSha256===dictionary.definitionSha256&&
    source.semantics.captureManifestSha256===dictionary.source.captureManifestSha256&&
    equal(source.semantics,dataset.semantics),
    'The accepted export must retain its original OData field and capture-manifest identities.');
  need(digest(await readFile(resolved.get('capture/manifest.json').path))===
    dictionary.source.captureManifestSha256,
    'The complete retained capture manifest differs from the field dictionary.');
  for(const item of source.sourceFiles??[]) {
    const held=resolved.get(relativeMember(item.path));
    need(held&&equal(receipt(item),receipt(held)),
      'Retain every complete original source member declared by source.json.');
  }
  need(source.valueEncoding==='Every field has a value, null or missing state. Int64 and Decimal preserve original exact text.',
    'Use the original Central value/state CSV encoding.');
  const after=originalSelection({workspace,store,input});
  need(after.dataset.fingerprint===dataset.fingerprint&&after.dataset.requestFingerprint===dataset.requestFingerprint&&
    equal(after.dataset.receipts,dataset.receipts)&&after.capture.contentHash===capture.contentHash&&
    fingerprint(after.commission.definition)===fingerprint(commission.definition),
    'The selected immutable output changed during warehouse preparation.');
  const identity=store.identity();
  return {
    schema:APPROVAL_SCHEMA,
    workspace:{schema:identity.schema,id:identity.workspaceId},
    commissioning:{id:commission.id,definitionSha256:fingerprint(commission.definition),
      agreementSha256:commission.definition.agreementSha256,sourceDefinition:copy(commission.sourceDefinition)},
    delivery:{id:delivery.id,requestSha256:fingerprint(delivery.request),selectionSha256:fingerprint(delivery.selection)},
    period:{index:chosen.period,label:period.label,planId:plan.id,scope:copy(period.scope)},
    capture:{id:capture.id,contentHash:capture.contentHash,completedAt:capture.completedAt,connectionId:capture.connectionId},
    table:{id:table.id,name:table.name,formKey:table.formKey,projectId:String(form.projectId),formId:form.formId,
      relationship:copy(table.relation??null),keyFields:copy(table.query.keyFields)},
    review:copy(review),
    export:{id:dataset.id,kind:dataset.kind,fingerprint:dataset.fingerprint,requestFingerprint:dataset.requestFingerprint,
      editionId:dataset.editionId,createdAt:dataset.createdAt,rowCount:source.rowCount},
    projection:{approvedFields:copy(output.fields),mapping:copy(dataset.mapping),columns:copy(config.columns),
      semantics:copy(source.semantics)},
    exportRoot,files
  };
}
