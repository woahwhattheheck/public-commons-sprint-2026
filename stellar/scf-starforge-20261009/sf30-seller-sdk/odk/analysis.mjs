// MIT. Source coverage, exact numeric indicators, period comparison and original dataset publication.
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fieldValue } from '../odata/workspace.mjs';
import { underlyingType } from '../odata/schema.mjs';
import { odataCaptureManifest, projectODataSemantics } from '../odata/semantics.mjs';
import { digest, fault, formatted, identifier, now, stable, writeNew } from '../odata/state.mjs';
import { verifyFile } from './store.mjs';

const numericTypes=new Set(['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32','Edm.Int64','Edm.Decimal','Edm.Single','Edm.Double']);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csv=value=>{const text=value===undefined||value===null?'':typeof value==='object'?stable(value):String(value);
  return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
const jsonPath=path=>'$'+path.split('/').map(part=>'.'+JSON.stringify(part)).join('');
const formFor=(capture,table)=>capture.forms.find(form=>form.key===table.formKey);
function tableFor(capture,id) {
  const table=capture.tables.find(table=>table.id===id);
  if(!table)throw fault('CENTRAL_TABLE_NOT_FOUND','Select a table in this reporting edition.',404);return table;
}
function complete(store,id) {
  const capture=store.get('capture',id);
  if(capture.status!=='COMPLETE')throw fault('CENTRAL_EDITION_INCOMPLETE','Finish the retained capture before producing this reporting edition.',409);
  return capture;
}
export function analyzeCapture(store,id) {
  const capture=store.get('capture',id);
  if(capture.quality?.contentHash===capture.contentHash&&capture.status==='COMPLETE')return capture.quality;
  const issues=[],tables=[],statusCounts=Object.create(null),reviewStates=Object.create(null),formVersions=Object.create(null);
  for(const table of capture.tables){
    const form=formFor(capture,table),fields=table.query.fields.filter(field=>!form.catalog.complexTypes[field.type]&&!field.collection);
    const profiles=fields.map(field=>({path:field.path,type:field.type,values:0,empty:0,nulls:0,missing:0}));
    for(const row of store.iterateRows(id,table.id)){
      for(const profile of profiles){const cell=fieldValue(row,profile.path);
        if(cell.state==='missing')profile.missing++;else if(cell.state==='null')profile.nulls++;else if(cell.value==='')profile.empty++;else profile.values++;}
      if(table.name==='Submissions'){
        const system=row.__system??{};
        const status=system.status??'available',review=system.reviewState??'unreviewed',version=system.formVersion;
        statusCounts[status]=(statusCounts[status]??0)+1;reviewStates[review]=(reviewStates[review]??0)+1;
        if(typeof version==='string'){const key=table.formKey+':'+version;formVersions[key]=(formVersions[key]??0)+1;}
      }
    }
    if(table.observedCounts.length>1)issues.push({code:'PROVIDER_COUNT_CHANGED',tableId:table.id,counts:table.observedCounts,
      message:'Central reported different collection counts while these pages were captured.'});
    if(table.status==='COMPLETE'&&table.observedCounts.some(count=>BigInt(count)!==BigInt(table.rowCount)))
      issues.push({code:'PROVIDER_ROW_COUNT',tableId:table.id,rowCount:table.rowCount,counts:table.observedCounts,
        message:'Retained row count differs from a count reported by Central.'});
    tables.push({id:table.id,form:form.name,name:table.name,status:table.status,rowCount:table.rowCount,pageCount:table.pageCount,
      sourceCounts:table.observedCounts,profiles,relation:table.relation});
  }
  const orphans=store.orphanCounts(id);
  for(const orphan of orphans)issues.push({code:'REPEAT_PARENT_MISSING',...orphan,
    message:'Repeat rows have no parent in the retained cohort. Review changes made while the source was captured.'});
  const history={submissions:0,versions:0,xmlRetained:0,missingXml:0,expectedAttachments:0,presentAttachments:0,
    missingAttachments:0,unavailableListings:0,unavailableSubmissions:0,currentFormVersionDifferences:0};
  for(const entry of store.iterateSubmissions(id)){
    history.submissions++;history.versions+=entry.versions.length;
    if(entry.unavailable)history.unavailableSubmissions++;
    for(const version of entry.versions){
      if(version.xml.outcome==='retained')history.xmlRetained++;else history.missingXml++;
      history.expectedAttachments+=version.media.expected??0;history.presentAttachments+=version.media.present;
      history.missingAttachments+=version.media.missing.length;if(version.media.unavailable)history.unavailableListings++;
      if(version.metadata.current&&typeof entry.sourceSystem?.formVersion==='string'&&
         typeof version.metadata.formVersion==='string'&&entry.sourceSystem.formVersion!==version.metadata.formVersion)
        history.currentFormVersionDifferences++;
    }
  }
  const formHistory={generations:0,xmlRetained:0,missingXml:0,originalSpreadsheets:0,missingSpreadsheets:0,
    expectedAttachments:0,presentAttachments:0,missingAttachments:0,linkedDatasets:0,unavailableListings:0,missingFields:0};
  for(const form of capture.forms){
    if(form.schemaChangedDuringCapture)issues.push({code:'FORM_SCHEMA_CHANGED',formKey:form.key,
      before:form.catalog.receipts.metadata.sha256,after:form.finalMetadata.sha256,
      message:'The form definition changed during capture; original CSDL and form generations are retained.'});
    for(const generation of form.generations??[]){
      formHistory.generations++;
      if(generation.xml.outcome==='retained')formHistory.xmlRetained++;else formHistory.missingXml++;
      if(generation.spreadsheet){if(generation.spreadsheet.outcome==='retained')formHistory.originalSpreadsheets++;else formHistory.missingSpreadsheets++;}
      if(generation.fields.outcome!=='retained')formHistory.missingFields++;
      formHistory.expectedAttachments+=generation.media.expected??0;formHistory.presentAttachments+=generation.media.present;
      formHistory.missingAttachments+=generation.media.missing.length;
      if(generation.media.unavailable)formHistory.unavailableListings++;
      formHistory.linkedDatasets+=generation.media.items.filter(item=>item.datasetExists===true).length;
    }
  }
  for(const [code,count,message]of [
    ['SUBMISSION_UNAVAILABLE',history.unavailableSubmissions,'Submission history became unavailable or returned no versions.'],
    ['SUBMISSION_XML_MISSING',history.missingXml,'Some submission version XML bodies were unavailable.'],
    ['SUBMISSION_MEDIA_MISSING',history.missingAttachments,'Expected submission media had not been uploaded or was unavailable.'],
    ['SUBMISSION_MEDIA_LIST_UNAVAILABLE',history.unavailableListings,'Some submission version media lists were unavailable.'],
    ['SUBMISSION_VERSION_DIFFERENCE',history.currentFormVersionDifferences,'The current submission version differs from its captured OData form version.'],
    ['FORM_XML_MISSING',formHistory.missingXml,'Some published form XML bodies were unavailable.'],
    ['FORM_SPREADSHEET_MISSING',formHistory.missingSpreadsheets,'Central advertised an original spreadsheet whose body was unavailable.'],
    ['FORM_FIELDS_MISSING',formHistory.missingFields,'Some original form field definitions were unavailable.'],
    ['FORM_MEDIA_MISSING',formHistory.missingAttachments,'Some expected form attachments were unavailable.'],
    ['FORM_MEDIA_LIST_UNAVAILABLE',formHistory.unavailableListings,'Some original form media lists were unavailable.'],
    ['ENCRYPTED_SUBMISSIONS',(statusCounts.notDecrypted??0)+(statusCounts.missingEncryptedFormData??0),'Central reported submissions whose encrypted contents are unavailable.'],
  ])if(count)issues.push({code,count,message});
  return {schema:'stellar-forge.odk-source-coverage.v1',captureId:id,contentHash:capture.contentHash??null,analyzedAt:now(),
    sourceWindow:{startedAt:capture.startedAt,completedAt:capture.completedAt??null,scope:capture.scope},
    tables,history,formHistory,statusCounts,reviewStates,formVersions,orphans,resources:store.resourceTotals(id),issues,
    interpretation:'Continuation tokens retain paging position. Capture receipts and original submission versions describe changes made while the source was being read.'};
}
function paired(store,leftId,rightId,tableId) {
  const left=complete(store,leftId),right=complete(store,rightId),before=tableFor(left,tableId),after=tableFor(right,tableId);
  const leftConnection=store.get('connection',left.connectionId),rightConnection=store.get('connection',right.connectionId);
  if(leftConnection.url!==rightConnection.url)throw fault('CENTRAL_COMPARE_SERVER','Compare periods from the same Central server.');
  return {left,right,before,after};
}
export function compareCaptures(store,{leftId,rightId,tableId,after='',limit=100}) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw fault('CENTRAL_COMPARE_LIMIT','Choose 1 to 1,000 comparison records per page.');
  const pair=paired(store,leftId,rightId,tableId),counts={added:0,removed:0,changed:0},changes=[];
  let more=false;
  for(const change of store.compareRows(leftId,rightId,tableId)){
    counts[change.change]++;
    if(change.id>after){if(changes.length<limit)changes.push(change);else more=true;}
  }
  return {leftId,rightId,tableId,counts,changes,next:more?changes.at(-1).id:null,
    identity:pair.after.name==='Submissions'?'Original initial submission instance ID':
      'Central repeat row ID within the retained form structure; repeat reordering may change IDs.',
    scopes:{left:pair.left.scope,right:pair.right.scope},
    schemaChanged:formFor(pair.left,pair.before).catalogHash!==formFor(pair.right,pair.after).catalogHash};
}
function decimal(value) {
  const text=String(value),match=/^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if(!match||text.length>10000)throw fault('CENTRAL_NUMERIC_VALUE','A numeric indicator contains an invalid exact source value.',422);
  const fraction=match[3]??'',exponent=Number(match[4]??0),scale=fraction.length-exponent;
  if(!Number.isSafeInteger(exponent)||Math.abs(scale)>1000)throw fault('CENTRAL_NUMERIC_SCALE','This exact source value requires a specialized numeric projection.',422);
  let n=BigInt((match[1]||'')+match[2]+fraction),s=scale;
  if(s<0){n*=10n**BigInt(-s);s=0;}return {n,s};
}
function aligned(a,b){const s=Math.max(a.s,b.s);return {a:a.n*10n**BigInt(s-a.s),b:b.n*10n**BigInt(s-b.s),s};}
function decimalText({n,s}) {
  const negative=n<0n;if(negative)n=-n;
  let text=n.toString().padStart(s+1,'0');
  if(s)text=text.slice(0,-s)+'.'+text.slice(-s);
  text=text.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
  return (negative&&n!==0n?'-':'')+text;
}
function meanText(sum,count,places=12) {
  if(!count)return null;
  const numerator=sum.n*10n**BigInt(places),denominator=BigInt(count)*10n**BigInt(sum.s);
  const negative=numerator<0n,absolute=negative?-numerator:numerator;
  const rounded=(absolute+denominator/2n)/denominator;
  return decimalText({n:negative?-rounded:rounded,s:places});
}
function indicatorField(capture,definition) {
  const table=tableFor(capture,definition.tableId),form=formFor(capture,table);
  const field=definition.field?table.query.fields.find(field=>field.path===definition.field):null;
  if((definition.operation!=='rows'||definition.field)&&!field)throw fault('CENTRAL_INDICATOR_FIELD','Select a captured field for this indicator.');
  if(field?.collection||field&&form.catalog.complexTypes[field.type])throw fault('CENTRAL_INDICATOR_FIELD','Select a scalar field for this indicator.');
  if(Object.hasOwn(definition,'equals')&&(definition.equals!==null&&typeof definition.equals==='object'||definition.equals===undefined))
    throw fault('CENTRAL_INDICATOR_FILTER','Compare a scalar original field value.');
  if(Object.hasOwn(definition,'equals')&&!field)throw fault('CENTRAL_INDICATOR_FILTER','Select the field whose value is matched.');
  const operations=['rows','nonempty','sum','mean','minimum','maximum','distinct','frequency'];
  if(!operations.includes(definition.operation))throw fault('CENTRAL_INDICATOR_OPERATION','Choose an available indicator operation.');
  if(['sum','mean','minimum','maximum'].includes(definition.operation)&&!numericTypes.has(underlyingType(form.catalog,field.type)))
    throw fault('CENTRAL_INDICATOR_TYPE','This indicator needs an original numeric field.');
  return {table,field};
}
function distributionRows(store,captureId,tableId,path,definition={}) {
  const pointer=jsonPath(path),filtered=Object.hasOwn(definition,'equals'),expected=JSON.stringify(filtered?definition.equals:null);
  return store.db.prepare('SELECT json_type(body,?) AS sourceType,json_extract(body,?) AS value,COUNT(*) AS count FROM rows WHERE capture=? AND table_id=? AND (?=0 OR (json_type(body,?)=json_type(?,\'$\') AND json_extract(body,?) IS json_extract(?,\'$\'))) GROUP BY json_type(body,?),json_extract(body,?) ORDER BY count DESC,value')
    .iterate(pointer,pointer,captureId,tableId,filtered?1:0,pointer,expected,pointer,expected,pointer,pointer);
}
export function measureIndicator(store,capture,definition) {
  const {table,field}=indicatorField(capture,definition),result={name:String(definition.name||definition.field||table.name),
    tableId:table.id,table:table.name,field:field?.path??null,operation:definition.operation,
    ...(Object.hasOwn(definition,'equals')?{equals:definition.equals}:{}),count:0,missing:0,nulls:0,empty:0,value:null};
  if(['frequency','distinct'].includes(definition.operation)){
    let groups=0;const distribution=[];
    for(const entry of distributionRows(store,capture.id,table.id,field.path,definition)){
      if(entry.sourceType===null){result.missing+=entry.count;continue;}
      if(entry.sourceType==='null'){result.nulls+=entry.count;continue;}
      groups++;result.count+=entry.count;
      if(distribution.length<25)distribution.push(entry);
    }
    result.value=groups;result.distribution=distribution;result.distributionGroups=groups;return result;
  }
  let sum={n:0n,s:0},minimum=null,maximum=null;
  for(const row of store.iterateRows(capture.id,table.id)){
    if(definition.operation==='rows'&&!field){result.count++;continue;}
    const cell=fieldValue(row,field.path);
    if(cell.state==='missing'){result.missing++;continue;}if(cell.state==='null'){result.nulls++;continue;}
    if(cell.value===''){result.empty++;continue;}
    if(Object.hasOwn(definition,'equals')&&stable(cell.value)!==stable(definition.equals))continue;
    result.count++;
    if(['sum','mean','minimum','maximum'].includes(definition.operation)){
      const value=decimal(cell.value),pair=aligned(sum,value);sum={n:pair.a+pair.b,s:pair.s};
      if(minimum===null||(()=>{const p=aligned(value,minimum);return p.a<p.b;})())minimum=value;
      if(maximum===null||(()=>{const p=aligned(value,maximum);return p.a>p.b;})())maximum=value;
    }
  }
  if(['rows','nonempty'].includes(definition.operation))result.value=result.count;
  else if(result.count){
    result.value=definition.operation==='sum'?decimalText(sum):definition.operation==='minimum'?decimalText(minimum):
      definition.operation==='maximum'?decimalText(maximum):meanText(sum,result.count);
    if(definition.operation==='mean')result.exactMean={sum:decimalText(sum),count:result.count,displayDecimalPlaces:12};
  }
  return result;
}
async function save(path,bytes) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{await writeNew(path,bytes);}catch(error){if(error.code!=='EEXIST')throw error;
    if(digest(await readFile(path))!==digest(bytes))throw fault('CENTRAL_EXPORT_CHANGED','An existing immutable output differs.',409);}
  return {bytes:bytes.length,sha256:digest(bytes)};
}
async function saveStream(path,producer) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomUUID()+'.part',handle=await open(temporary,'wx',0o600),hash=createHash('sha256');let bytes=0;
  const emit=async text=>{const body=Buffer.isBuffer(text)?text:Buffer.from(text);bytes+=body.length;hash.update(body);await handle.writeFile(body);};
  try{
    try{await producer(emit);await handle.sync();}finally{await handle.close();}
    const sha256=hash.digest('hex');
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;await verifyFile(path,sha256);}
    return {sha256,bytes};
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function columnName(path,used) {
  let name=path.replace(/[^A-Za-z0-9_]/g,'_');
  if(!/^[A-Za-z]/.test(name)||['constructor','prototype','__proto__'].includes(name))name='field_'+name;
  name=name.slice(0,35);if(used.has(name)||used.has(name+'_state'))name=name.slice(0,26)+'_'+digest(path).slice(0,8);
  if(used.has(name)||used.has(name+'_state'))throw fault('CENTRAL_COLUMN_COLLISION','Choose distinct exported columns.');
  used.add(name);used.add(name+'_state');return name;
}
function datasetType(type,collection) {
  if(collection)return 'string';if(['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32'].includes(type))return 'integer';
  return ['Edm.Single','Edm.Double'].includes(type)?'number':type==='Edm.Boolean'?'boolean':'string';
}
export function centralTableEdition(store,capture,table) {
  const form=formFor(capture,table),pages=store.pageRecords(capture.id,table.id);
  return {id:capture.id+'.'+table.id,label:capture.label+' / '+table.name,status:'COMPLETE',nextLink:null,
    catalog:form.catalog,catalogHash:form.catalogHash,query:table.query,pages,rowCount:table.rowCount,
    sourceCount:table.observedCounts[0]??null,completedAt:capture.completedAt,
    contentHash:digest(stable(pages.map(page=>({source:page.source.sha256,rows:page.rowsSha256}))))};
}
export async function exportCentralDataset(store,input) {
  const capture=complete(store,input.id),table=tableFor(capture,input.tableId),form=formFor(capture,table),
    review=capture.decisions.at(-1),edition=centralTableEdition(store,capture,table);
  if(review?.decision!=='accept')throw fault('CENTRAL_EXPORT_REVIEW','Accept the reporting edition with its source interpretation before publishing a dataset.',409);
  const available=new Map(table.query.fields.map(field=>[field.path,field]));
  if(input.fields!==undefined&&!Array.isArray(input.fields))throw fault('CENTRAL_DATASET_FIELDS','Select a list of captured field paths.');
  const chosen=input.fields?.length?input.fields:table.query.fields.filter(field=>!form.catalog.complexTypes[field.type]).map(field=>field.path);
  const paths=[...new Set([...table.query.keyFields,...(table.relation?[table.relation.parentField]:[]),...chosen])];
  if(paths.length>32||paths.some(path=>!available.has(path)))throw fault('CENTRAL_DATASET_FIELDS','Select up to 32 captured fields including the native row and parent keys.');
  const used=new Set(),mapping=paths.map(path=>{const field=available.get(path);return {path,name:columnName(path,used),
    odataType:field.type,type:datasetType(underlyingType(form.catalog,field.type),field.collection),collection:field.collection===true};});
  const columns=Object.fromEntries(mapping.flatMap(field=>[[field.name,{type:field.type,nullable:field.type!=='string'}],[field.name+'_state','string']]));
  const metadata=await store.raw(form.catalog.receipts.metadata.sha256),
    dictionary=projectODataSemantics({edition,metadataBytes:metadata,mapping,columns});
  if(input.expectedSemanticSha256&&input.expectedSemanticSha256!==dictionary.sha256)throw fault('CENTRAL_SEMANTICS_CHANGED','The captured field meaning changed; reopen this projection.',409);
  const config={schema:'stellar-forge.csv-dataset.v1',name:String(input.name||capture.label+' / '+table.name).slice(0,128),
    file:'dataset.csv',columns,filters:mapping.slice(0,8).map(field=>field.name),ranges:[],sorts:mapping.slice(0,8).map(field=>field.name),
    defaultLimit:input.defaultLimit??50,maxLimit:input.maxLimit??250,semantics:dictionary};
  if(formatted(config).length>65536)throw fault('CENTRAL_DATASET_DICTIONARY','Select a smaller projection for the original dataset configuration.');
  const manifest=odataCaptureManifest(edition),source={
    schema:'stellar-forge.odata-dataset-source.v1',provider:'odk-central',serviceUrl:edition.catalog.serviceUrl,entitySet:table.name,
    editionId:edition.id,captureId:capture.id,tableId:table.id,catalogHash:edition.catalogHash,query:edition.query.plan,
    queryUrl:edition.query.url,keyFields:edition.query.keyFields,rowCount:table.rowCount,sourceCount:edition.sourceCount,
    completedAt:capture.completedAt,contentHash:edition.contentHash,review,mapping,pages:edition.pages,
    scope:capture.scope,relationship:table.relation,
    originalWorkspace:{schema:'stellar-forge.odk-central-workspace.v1',captureId:capture.id,
      note:'The complete workspace archive retains the original form generations, all submission versions and their available media.'},
    semantics:{schema:dictionary.schema,sha256:dictionary.sha256,definitionSha256:dictionary.definitionSha256,
      captureManifestSha256:dictionary.source.captureManifestSha256,file:'semantics.json'},
    valueEncoding:'Every field has a value, null or missing state. Int64 and Decimal preserve original exact text.'};
  const bodyFiles=new Map([
    ['semantics.json',formatted(dictionary)],['table-schema.json',formatted(dictionary.csvw)],
    ['capture/manifest.json',formatted(manifest)],['capture/metadata.csdl',metadata],
    ['capture/service.json',await store.raw(form.catalog.receipts.service.sha256)],
  ]);
  const copies=new Map();
  for(const page of edition.pages){copies.set('capture/pages/'+page.source.sha256+'.json',page.source.sha256);
    copies.set('capture/rows/'+page.rowsSha256+'.json',page.rowsSha256);}
  source.sourceFiles=[...bodyFiles].map(([path,body])=>({path,bytes:body.length,sha256:digest(body)}));
  for(const [path,hash]of copies){const file=await store.sourceFile(hash);source.sourceFiles.push({path,bytes:file.bytes,sha256:hash});}
  const fingerprint=digest(stable({config,source,payment:input.payment??null,origin:input.origin??null,path:input.path??'/data'})),
    exportId=input.exportId?identifier(input.exportId,'dataset export ID'):fingerprint,existing=store.get('export',exportId,false);
  if(existing){if(existing.fingerprint!==fingerprint)throw fault('CENTRAL_EXPORT_EXISTS','This export ID already identifies another immutable dataset.',409);return existing;}
  const output=join(store.directory,'exports',exportId),receipts={};
  const retainOutput=async(name,body)=>{receipts[name]=await save(join(output,name),body);};
  await retainOutput('dataset.json',formatted(config));await retainOutput('source.json',formatted(source));
  for(const [name,body]of bodyFiles)await retainOutput(name,body);
  for(const [name,hash]of copies){
    const from=await store.sourceFile(hash),to=join(output,name);await mkdir(dirname(to),{recursive:true,mode:0o700});
    try{await link(from.path,to);}catch(error){if(error.code!=='EEXIST')throw error;await verifyFile(to,hash);}
    receipts[name]={sha256:hash,bytes:from.bytes};
  }
  receipts['dataset.csv']=await saveStream(join(output,'dataset.csv'),async emit=>{
    await emit(mapping.flatMap(field=>[field.name,field.name+'_state']).map(csv).join(',')+'\n');
    for(const row of store.iterateRows(capture.id,table.id)){
      const cells=mapping.flatMap(field=>{const cell=fieldValue(row,field.path);
        if(cell.state==='value'&&field.type==='number'&&!Number.isFinite(Number(cell.value)))throw fault('CENTRAL_NONFINITE_EXPORT','A captured numeric field has a non-finite value.');
        return [cell.state==='value'?cell.value:'',cell.state];});
      await emit(cells.map(csv).join(',')+'\n');
    }
  });
  receipts['rows.jsonl']=await saveStream(join(output,'rows.jsonl'),async emit=>{
    for(const row of store.iterateRows(capture.id,table.id))await emit(JSON.stringify(row)+'\n');
  });
  const {loadDatasetConfig}=await import('../dataset-handler.mjs'),dataset=await loadDatasetConfig(join(output,'dataset.json'));
  let merchant=false;
  if(input.payment||input.origin){
    if(!input.payment||!input.origin)throw fault('CENTRAL_PAYMENT_CONFIG','Supply both public payment terms and origin.');
    const {buildDatasetSellerConfig}=await import('../dataset-cli.mjs');
    const seller=await buildDatasetSellerConfig(dataset,{payment:input.payment,origin:input.origin,path:input.path??'/data'});
    await retainOutput('seller.json',formatted(seller));merchant=true;
  }
  return store.put('export',exportId,{id:exportId,fingerprint,kind:'dataset',captureId:capture.id,editionId:edition.id,tableId:table.id,
    directory:output,createdAt:now(),dataset:dataset.describe(),mapping,merchant,semantics:source.semantics,
    files:Object.keys(receipts),receipts},0);
}
const reportStyle='body{font:15px/1.55 system-ui,sans-serif;color:#222;background:#fff;max-width:1100px;margin:36px auto;padding:0 24px}h1{font-size:30px}h2{margin-top:36px;font-size:21px;border-bottom:1px solid #aaa;padding-bottom:8px}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:8px}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px}.muted{color:#555}.metric{font-variant-numeric:tabular-nums}.bar{display:inline-block;background:#777;height:10px;margin-right:8px}code{font-size:12px;overflow-wrap:anywhere}a{color:inherit}@media print{body{max-width:none;margin:0}tr{break-inside:avoid}h2{break-after:avoid}}';
const markdownCell=value=>String(value??'').replaceAll('|','\\|').replace(/\r?\n/g,' ');
function tableHtml(headers,rows){return '<table><thead><tr>'+headers.map(value=>'<th>'+escape(value)+'</th>').join('')+'</tr></thead><tbody>'+
  rows.map(row=>'<tr>'+row.map(value=>'<td>'+escape(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
export async function createCentralReport(store,{id,baselineId=null,title,narrative='',indicators,reportId:suppliedReportId}) {
  const capture=complete(store,id),quality=analyzeCapture(store,id),review=capture.decisions.at(-1)??null;
  const definitions=indicators??review?.indicators??capture.tables.map(table=>({tableId:table.id,operation:'rows',name:table.name+' rows'}));
  if(!Array.isArray(definitions))throw fault('CENTRAL_REPORT_INDICATORS','Choose an indicators array.');
  const baseline=baselineId?complete(store,baselineId):null,results=[];
  const fingerprint=digest(stable({captureId:id,contentHash:capture.contentHash,baselineId,baselineHash:baseline?.contentHash??null,
    reviewId:review?.id??null,title:String(title||capture.label),narrative:String(narrative),indicators:definitions,reporterVersion:1})),
    reportId=suppliedReportId?identifier(suppliedReportId,'report ID'):fingerprint,existing=store.get('report',reportId,false);
  if(existing){if(existing.fingerprint!==fingerprint)throw fault('CENTRAL_REPORT_EXISTS','This report ID already identifies another immutable analysis.',409);return existing;}
  for(const definition of definitions){
    const current=measureIndicator(store,capture,definition);let previous=null;
    if(baseline){
      paired(store,baselineId,id,definition.tableId);
      try{previous=measureIndicator(store,baseline,definition);}catch(error){
        if(['CENTRAL_INDICATOR_FIELD','CENTRAL_INDICATOR_TYPE'].includes(error.code))previous={unavailable:true,reason:error.message};else throw error;}
    }
    results.push({...current,baseline:previous});
  }
  const report={schema:'stellar-forge.odk-field-report.v1',id:reportId,fingerprint,captureId:id,baselineId,title:String(title||capture.label).slice(0,240),
    narrative:String(narrative),createdAt:now(),review,scope:capture.scope,startedAt:capture.startedAt,completedAt:capture.completedAt,
    indicators:results,quality,findings:review?.findings??[],source: capture.source,
    methods:[
      'Every original OData continuation page was retained with its source bytes and timestamp. Counts refer to the selected reporting cohort.',
      'Current CSDL describes the OData columns. Original form generations, submission XML versions and available attachments remain in the portable workspace.',
      'Central repeat IDs identify structural rows within a submission; they can change when repeat rows are reordered.',
      'Version attachment endpoints return the bytes uploaded when read. The provider does not keep overwritten attachment history.',
      'Decimal and Int64 sums remain exact. Means retain exact sum and count and display a rounded value to twelve decimal places.',
    ]};
  const output=join(store.directory,'reports',reportId),receipts={},comparisons=[];
  const put=async(name,body)=>{receipts[name]=await save(join(output,name),body);};
  for(let index=0;index<definitions.length;index++){
    const definition=definitions[index];
    if(definition.operation==='frequency'){
      const name='indicator-'+(index+1)+'-frequency.csv';
      receipts[name]=await saveStream(join(output,name),async emit=>{
        await emit('source_type,value,count\n');
        for(const entry of distributionRows(store,id,definition.tableId,definition.field,definition))
          await emit([entry.sourceType??'missing',entry.value,entry.count].map(csv).join(',')+'\n');
      });
      results[index].distributionFile=name;
    }
  }
  if(baseline)for(const table of capture.tables){
    if(!baseline.tables.some(item=>item.id===table.id))continue;
    const comparison=compareCaptures(store,{leftId:baselineId,rightId:id,tableId:table.id,limit:1}),
      name='changes-'+table.id+'.jsonl';
    receipts[name]=await saveStream(join(output,name),async emit=>{
      for(const change of store.compareRows(baselineId,id,table.id))await emit(JSON.stringify(change)+'\n');
    });
    comparisons.push({table:table.name,tableId:table.id,counts:comparison.counts,identity:comparison.identity,file:name});
  }
  report.comparisons=comparisons;
  await put('report.json',formatted(report));
  receipts['source-index.jsonl']=await saveStream(join(output,'source-index.jsonl'),async emit=>{
    for(const entry of store.resourceEntries(id))await emit(JSON.stringify(entry)+'\n');
  });
  const tableRows=quality.tables.map(table=>[table.form,table.name,table.rowCount,table.pageCount,table.sourceCounts.join(', ')]),
    indicatorRows=results.map(value=>[value.name,value.operation,value.field??'all rows',value.value??'—',
      value.baseline?.unavailable?value.baseline.reason:value.baseline?.value??'—',value.count]),
    issueRows=quality.issues.map(issue=>[issue.code,issue.count??issue.tableId??issue.formKey??'',issue.message]);
  let html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(report.title)+
    '</title><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><style>'+reportStyle+
    '</style><body><h1>'+escape(report.title)+'</h1><p class="muted">'+escape(capture.label)+' · '+escape(capture.completedAt)+
    ' · '+(review?.decision==='accept'?'Accepted reporting edition':'Working report')+'</p>'+
    '<p>'+escape(narrative).replace(/\n/g,'<br>')+'</p><h2>Reporting cohort</h2><pre>'+escape(JSON.stringify(capture.scope,null,2))+'</pre>'+
    tableHtml(['Form','Table','Rows','Pages','Provider counts'],tableRows)+
    '<h2>Indicators</h2>'+tableHtml(['Indicator','Operation','Source field','Current','Previous','Included values'],indicatorRows);
  for(const value of results)if(value.distribution?.length){
    const max=Math.max(...value.distribution.map(item=>item.count));
    html+='<h3>'+escape(value.name)+'</h3><table><tr><th>Value</th><th>Count</th></tr>'+
      value.distribution.map(item=>'<tr><td>'+escape(item.value)+'</td><td><span class="bar" style="width:'+(max?Math.round(item.count/max*240):0)+
        'px"></span>'+item.count+'</td></tr>').join('')+'</table><p class="muted">Leading 25 values; complete frequencies: '+escape(value.distributionFile??'report.json')+'.</p>';
  }
  html+='<h2>Source coverage</h2>'+tableHtml(['Measure','Count'],[
    ['Submission histories',quality.history.submissions],['Submission XML versions retained',quality.history.xmlRetained],
    ['Submission attachments retained / expected',quality.history.presentAttachments+' / '+quality.history.expectedAttachments],
    ['Original form XML generations retained',quality.formHistory.xmlRetained],['Original XLS / XLSX files',quality.formHistory.originalSpreadsheets],
    ['Form attachments retained / expected',quality.formHistory.presentAttachments+' / '+quality.formHistory.expectedAttachments]])+
    tableHtml(['Review item','Scope / count','Interpretation'],issueRows);
  if(comparisons.length)html+='<h2>Changes between periods</h2>'+tableHtml(['Table','Added IDs','Removed IDs','Changed IDs','Complete comparison'],
    comparisons.map(value=>[value.table,value.counts.added,value.counts.removed,value.counts.changed,value.file]));
  if(report.findings.length)html+='<h2>Analyst findings</h2>'+report.findings.map(value=>'<h3>'+escape(value.title??'Finding')+
    '</h3><p>'+escape(value.text??String(value)).replace(/\n/g,'<br>')+'</p>').join('');
  if(review)html+='<h2>Receiving review</h2><p>'+escape(review.note).replace(/\n/g,'<br>')+'</p><p>'+escape(review.reviewer)+' · '+escape(review.createdAt)+'</p>';
  html+='<h2>Methods and source files</h2><ul>'+report.methods.map(value=>'<li>'+escape(value)+'</li>').join('')+
    '</ul><p>Original source receipts are in source-index.jsonl. The complete portable workspace carries their exact bodies and all retained versions.</p>'+
    '<p>Provider reference: <a href="'+escape(capture.source.api)+'">ODK Central API</a> · backend '+escape(capture.source.commit)+'</p>'+
    '<p><code>Capture '+escape(id)+' · '+escape(capture.contentHash)+'</code></p></body></html>';
  const mdTable=(headers,rows)=>'| '+headers.map(markdownCell).join(' | ')+' |\n| '+headers.map(()=> '---').join(' | ')+' |\n'+
    rows.map(row=>'| '+row.map(markdownCell).join(' | ')+' |').join('\n')+'\n';
  let markdown='# '+report.title+'\n\n'+narrative+'\n\n## Reporting cohort\n\n'+mdTable(['Start','End','Capture completed'],[
    [capture.scope.submittedFrom??'All earlier submissions',capture.scope.submittedBefore,capture.completedAt]])+
    '\n'+mdTable(['Form','Table','Rows','Pages','Provider counts'],tableRows)+
    '\n## Indicators\n\n'+mdTable(['Indicator','Operation','Source field','Current','Previous','Included values'],indicatorRows)+
    '\n## Source coverage\n\n'+mdTable(['Review item','Scope / count','Interpretation'],issueRows)+
    '\n## Analyst findings\n\n'+report.findings.map(value=>'### '+(value.title??'Finding')+'\n\n'+(value.text??String(value))+'\n').join('\n')+
    '\n## Receiving review\n\n'+(review?.note??'Review the retained source coverage and record the reporting interpretation.')+
    '\n\n## Methods\n\n'+report.methods.map(value=>'- '+value).join('\n')+
    '\n\nSource receipts: source-index.jsonl. Full structured analysis: report.json. Complete source bodies: the portable workspace archive.\n\n'+
    '[ODK Central API]('+capture.source.api+'). Original backend commit: '+capture.source.commit+'.\n';
  if(comparisons.length)markdown+='\n## Changes between periods\n\n'+mdTable(['Table','Added IDs','Removed IDs','Changed IDs','File'],
    comparisons.map(value=>[value.table,value.counts.added,value.counts.removed,value.counts.changed,value.file]));
  await put('report.html',Buffer.from(html));await put('report.md',Buffer.from(markdown));
  return store.put('report',reportId,{id:reportId,fingerprint,kind:'report',captureId:id,baselineId,title:report.title,createdAt:report.createdAt,
    directory:output,files:Object.keys(receipts),receipts,indicators:results,comparisons},0);
}
