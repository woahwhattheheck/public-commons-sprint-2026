// MIT. Ordered PDF volumes on the original document source, Requests and paid batches.
import {join,dirname,relative,isAbsolute,sep,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {
  absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,canonical,plain
} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {inspectCollectionArchive} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/collection-package.mjs';
import {writeDocumentAssemblyArchive} from './assembly-archive.mjs';
import {initialRecord} from '../prepaid-api/records.mjs';
import {
  DOCUMENT_PDF_SOURCE_SCHEMA,DOCUMENT_PROVIDER_SCHEMA,documentProvider,documentError,
  normalizeDocumentPdfSource,normalizeDocumentAssemblyInput,buildDocumentAssemblyRequest
} from './contracts.mjs';
import {
  DOCUMENT_BATCH_SCHEMA,normalizeDocumentBatch,prepareDocumentBatch,readDocumentBatch,
  inspectDocumentBatch,runDocumentBatch,receiveDocumentBatch,exportDocumentBatch,saveDocumentBatchReport
} from './batch.mjs';

export const DOCUMENT_ASSEMBLY_SCHEMA='stellar-forge.document-assembly.v1';
export const DOCUMENT_ASSEMBLY_PLAN_SCHEMA='stellar-forge.document-assembly-plan.v1';
export const DOCUMENT_ASSEMBLY_DELIVERY_SCHEMA='stellar-forge.document-assembly-delivery.v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PLAN=192*1048576,MAX_SOURCE=96*1048576,MAX_PARTS=2000;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>structuredClone(value);
const same=(left,right)=>canonical(left)===canonical(right);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function need(value,code,message){if(!value)throw documentError(code,message??code);}
function identifier(value){need(typeof value==='string'&&ID.test(value),'DOCUMENT_ASSEMBLY_ID_REQUIRED');return value;}
function hash(value){need(typeof value==='string'&&HASH.test(value),'DOCUMENT_ASSEMBLY_SELECTION_REQUIRED');return value;}
function words(value,max,code){need(typeof value==='string'&&value.length>0&&value.length<=max&&
  !/[\x00-\x1f\x7f]/.test(value),code);return value;}
function inside(path,root){const part=relative(root,path);return part!==''&&part!=='..'&&
  !part.startsWith('..'+sep)&&!isAbsolute(part);}
function origin(value){let url;try{url=new URL(value);}catch{need(false,'DOCUMENT_ASSEMBLY_ORIGIN_REQUIRED');}
  need(url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password,
    'DOCUMENT_ASSEMBLY_ORIGIN_REQUIRED');return value;}
function configuration(maxSourceBytes){return {schema:DOCUMENT_PROVIDER_SCHEMA,provider:'pdfmint',
  plan:'free',authentication:'bearer',maxSourceBytes};}
export function documentAssemblyTemplate(){
  return {schema:DOCUMENT_ASSEMBLY_SCHEMA,id:'invoice-bundle',name:'Complete invoice bundle',
    merchantOrigin:null,title:'Invoices',taskReference:'original-customer-task',
    maxVolumeBytes:10000000,settings:{strict:true}};
}
export function normalizeDocumentAssembly(value){
  need(plain(value)&&value.schema===DOCUMENT_ASSEMBLY_SCHEMA&&Object.keys(value).every(key=>
    ['schema','id','name','merchantOrigin','title','taskReference','maxVolumeBytes','settings'].includes(key)),
    'DOCUMENT_ASSEMBLY_REQUIRED');
  const input=normalizeDocumentAssemblyInput('pdfmint',{title:value.title,taskReference:value.taskReference,
    settings:value.settings});
  words(input.title,170,'DOCUMENT_ASSEMBLY_TITLE_LIMIT');
  const maxVolumeBytes=value.maxVolumeBytes??documentProvider('pdfmint').maxSourceBytes;
  need(Number.isSafeInteger(maxVolumeBytes)&&maxVolumeBytes>=4096&&
    maxVolumeBytes<=documentProvider('pdfmint').maxSourceBytes,'DOCUMENT_ASSEMBLY_VOLUME_LIMIT_INVALID');
  return {schema:DOCUMENT_ASSEMBLY_SCHEMA,id:identifier(value.id),
    name:words(value.name,200,'DOCUMENT_ASSEMBLY_NAME_REQUIRED'),
    merchantOrigin:origin(value.merchantOrigin),...input,maxVolumeBytes};
}
function originalPdf(file){
  const source=normalizeDocumentPdfSource({schema:DOCUMENT_PDF_SOURCE_SCHEMA,files:[file]},{minimumFiles:1}).files[0];
  const raw=Buffer.from(source.base64,'base64');
  need(raw.length===source.bytes&&raw.toString('base64')===source.base64&&
    digest(raw)===source.sha256&&raw.subarray(0,5).toString('ascii')==='%PDF-',
    'DOCUMENT_ASSEMBLY_FILE_CHANGED','Use the complete original PDF and its current byte identity.');
  return source;
}
function packet(files){return {schema:DOCUMENT_PDF_SOURCE_SCHEMA,files};}
function inputFor(request,index){return {title:request.title+' — volume '+(index+1),
  taskReference:request.taskReference,settings:copy(request.settings)};}
function volumeSource(request,files,index){
  const bytes=encoded(packet(files));
  if(bytes.length>request.maxVolumeBytes)return null;
  if(files.length>1){
    try{buildDocumentAssemblyRequest(configuration(request.maxVolumeBytes),inputFor(request,index),
      bytes.toString('utf8'));}
    catch(error){if(['DOCUMENT_PROVIDER_BODY_TOO_LARGE','DOCUMENT_SOURCE_SIZE_INVALID'].includes(error.code))return null;throw error;}
  }
  return bytes;
}
function volumesFor(request,files){
  const groups=[];let current=[];
  for(const file of files){
    const selected=[...current,file];
    if(current.length&& (selected.length>50||!volumeSource(request,selected,groups.length))){
      groups.push(current);current=[];
    }
    current.push(file);
  }
  if(current.length)groups.push(current);
  // Keep the last lone file paired when the previous complete volume can lend its last PDF.
  if(groups.length>1&&groups.at(-1).length===1&&groups.at(-2).length>2){
    const pair=[groups.at(-2).at(-1),groups.at(-1)[0]];
    if(volumeSource(request,pair,groups.length-1)){groups.at(-2).pop();groups[groups.length-1]=pair;}
  }
  return groups.map((parts,index)=>{
    const id='volume-'+String(index+1).padStart(4,'0'),kind=parts.length===1?'original':'merge';
    const bytes=kind==='merge'?volumeSource(request,parts,index):Buffer.from(parts[0].base64,'base64');
    need(bytes,'DOCUMENT_ASSEMBLY_VOLUME_LIMIT_INVALID');
    return {id,index:index+1,kind,filename:id+'.pdf',fileIds:parts.map(file=>file.id),
      input:inputFor(request,index),source:{path:kind==='merge'?'volumes/'+id+'.json':
        'originals/'+parts[0].id+'.pdf',bytes:bytes.length,sha256:digest(bytes),
        contentType:kind==='merge'?'application/json':'application/pdf'}};
  });
}
function selectedOrigin(value){
  if(value===null||value===undefined)return null;
  need(plain(value)&&Object.keys(value).every(key=>['kind','batchId','batchInputSha256',
    'batchPlanSha256','compositionId','compositionSha256'].includes(key))&&value.kind==='document-batch',
    'DOCUMENT_ASSEMBLY_ORIGIN_SELECTION_REQUIRED');
  identifier(value.batchId);hash(value.batchInputSha256);hash(value.batchPlanSha256);
  if(value.compositionId!==undefined){identifier(value.compositionId);hash(value.compositionSha256);}
  else need(value.compositionSha256===undefined,'DOCUMENT_ASSEMBLY_ORIGIN_SELECTION_REQUIRED');
  return copy(value);
}
/** The complete portable source contains every original PDF exactly once. */
export function composeDocumentPdfAssembly({request,sources,origin:sourceOrigin=null}={}){
  request=normalizeDocumentAssembly(request);
  need(Array.isArray(sources)&&sources.length>0&&sources.length<=MAX_PARTS,
    'DOCUMENT_ASSEMBLY_SOURCES_REQUIRED');
  const seen=new Set();let total=0;
  const files=sources.map(file=>{
    const selected=originalPdf(file);need(!seen.has(selected.id),'DOCUMENT_ASSEMBLY_DUPLICATE_FILE');
    seen.add(selected.id);total+=selected.bytes;
    need(total<=MAX_SOURCE,'DOCUMENT_ASSEMBLY_SOURCE_LIMIT',
      'The complete selected source exceeds the local 96 MiB assembly input allowance.');
    return selected;
  });
  const source=selectedOrigin(sourceOrigin),volumes=volumesFor(request,files);
  const selection={request,origin:source,files:files.map(({base64,...file})=>file)};
  const plan={schema:DOCUMENT_ASSEMBLY_PLAN_SCHEMA,request,origin:source,inputSha256:digest(canonical(selection)),
    files,volumes,counts:{originalFiles:files.length,originalBytes:total,volumes:volumes.length,
      paidMerges:volumes.filter(volume=>volume.kind==='merge').length,
      unchangedVolumes:volumes.filter(volume=>volume.kind==='original').length}};
  need(encoded(plan).length<=MAX_PLAN,'DOCUMENT_ASSEMBLY_PLAN_LIMIT');
  return plan;
}
function validatePlan(value){
  need(plain(value)&&value.schema===DOCUMENT_ASSEMBLY_PLAN_SCHEMA,'DOCUMENT_ASSEMBLY_PLAN_REQUIRED');
  const rebuilt=composeDocumentPdfAssembly({request:value.request,sources:value.files,origin:value.origin});
  need(same(value,rebuilt),'DOCUMENT_ASSEMBLY_SOURCE_PLAN_CHANGED');return value;
}
function sourceFiles(plan){
  const byId=new Map(plan.files.map(file=>[file.id,file]));
  return [
    ...plan.files.map(file=>({path:'originals/'+file.id+'.pdf',bytes:Buffer.from(file.base64,'base64')})),
    ...plan.volumes.filter(volume=>volume.kind==='merge').map(volume=>({path:volume.source.path,
      bytes:encoded(packet(volume.fileIds.map(id=>byId.get(id))))}))
  ];
}
async function materialize(directory,plan,lease,signal){
  for(const file of sourceFiles(plan)){
    signal?.throwIfAborted();lease.assertHeld();
    await ownedDirectory(dirname(join(directory,file.path)),{create:true});
    await writeExact(join(directory,file.path),file.bytes);
  }
}
export async function prepareDocumentPdfAssembly({directory,request,sources,origin:sourceOrigin=null,signal}={}){
  const proposed=composeDocumentPdfAssembly({request,sources,origin:sourceOrigin});
  directory=await ownedDirectory(absolute(directory),{create:true});
  const lease=await acquireStateLease(directory);
  try{
    const plan=await initialRecord({directory,name:'assembly-plan.json',lease,maxBytes:MAX_PLAN,
      validate:value=>{validatePlan(value);need(same(value,proposed),'DOCUMENT_ASSEMBLY_RETAINED_SOURCE_CHANGED');return value;},
      create:async()=>proposed});
    await materialize(directory,plan,lease,signal);
    const raw=await ownedBytes(join(directory,'assembly-plan.json'),MAX_PLAN);
    return {directory,plan,sha256:digest(raw),bytes:raw.length};
  }finally{await lease.close();}
}
export async function readDocumentPdfAssembly(directory,{expectedSha256,requireFiles=true,signal}={}){
  directory=await ownedDirectory(absolute(directory));
  const raw=await ownedBytes(join(directory,'assembly-plan.json'),MAX_PLAN),sha256=digest(raw);
  if(expectedSha256!==undefined)need(hash(expectedSha256)===sha256,'DOCUMENT_ASSEMBLY_SOURCE_SELECTION_CHANGED');
  const plan=validatePlan(parse(raw));
  if(requireFiles)for(const file of sourceFiles(plan)){
    signal?.throwIfAborted();
    const original=await ownedBytes(join(directory,file.path),Math.max(file.bytes.length,1));
    need(original.length===file.bytes.length&&digest(original)===digest(file.bytes),
      'DOCUMENT_ASSEMBLY_MATERIALIZED_SOURCE_CHANGED');
  }
  return {directory,plan,sha256,bytes:raw.length};
}
export async function receiveDocumentPdfAssembly({source,directory,expectedSha256,signal}={}){
  const raw=await ownedBytes(absolute(source),MAX_PLAN,{privateMode:false});
  need(digest(raw)===hash(expectedSha256),'DOCUMENT_ASSEMBLY_SOURCE_SELECTION_CHANGED');
  const plan=validatePlan(parse(raw));
  const received=await prepareDocumentPdfAssembly({directory,request:plan.request,sources:plan.files,
    origin:plan.origin,signal});
  need(received.sha256===expectedSha256,'DOCUMENT_ASSEMBLY_RECEIVED_SOURCE_CHANGED');return received;
}
function sourceRootAllowed(workspace,path){
  const roots=workspace.status().fileRoots;
  need(Array.isArray(roots)&&roots.some(root=>inside(path,root)),
    'DOCUMENT_ASSEMBLY_SOURCE_OUTSIDE_CUSTOMER_ROOT');
}
export async function stageDocumentPdfAssemblyFiles({workspace,directory,request,files,signal}={}){
  need(workspace&&Array.isArray(files)&&files.length>0&&files.length<=MAX_PARTS,'DOCUMENT_ASSEMBLY_FILES_REQUIRED');
  sourceRootAllowed(workspace,absolute(directory));const sources=[];
  for(const file of files){
    signal?.throwIfAborted();need(plain(file),'DOCUMENT_ASSEMBLY_FILE_REQUIRED');
    const path=absolute(file.path);sourceRootAllowed(workspace,path);
    const raw=await ownedBytes(path,33554432,{privateMode:false}),sha256=digest(raw);
    if(file.sha256!==undefined)need(hash(file.sha256)===sha256,'DOCUMENT_ASSEMBLY_FILE_CHANGED');
    if(file.bytes!==undefined)need(file.bytes===raw.length,'DOCUMENT_ASSEMBLY_FILE_CHANGED');
    sources.push({id:identifier(file.id),filename:file.filename??basename(path),bytes:raw.length,sha256,
      base64:raw.toString('base64'),...(file.reference===undefined?{}:{reference:file.reference})});
  }
  return prepareDocumentPdfAssembly({directory,request,sources,signal});
}
/** Select completed PDFs in explicit customer order from the original native batch. */
export async function stageDocumentPdfAssemblyFromBatch({workspace,directory,request,batchDirectory,
  batchPlanSha256,itemIds,composition,signal}={}){
  const batch=await readDocumentBatch(batchDirectory);
  need(batch.sha256===hash(batchPlanSha256),'DOCUMENT_ASSEMBLY_ORIGINAL_BATCH_CHANGED');
  need(batch.plan.workspaceDirectory===workspace.directory,'DOCUMENT_BATCH_CUSTOMER_CHANGED');
  need(Array.isArray(itemIds)&&itemIds.length>0&&itemIds.length<=MAX_PARTS&&
    new Set(itemIds).size===itemIds.length,'DOCUMENT_ASSEMBLY_SELECTION_REQUIRED');
  const snapshot=await inspectDocumentBatch({workspace,plan:batch.plan,signal});
  const rows=new Map(snapshot.rows.map(row=>[row.id,row])),sources=[];
  sourceRootAllowed(workspace,absolute(directory));
  for(const id of itemIds){
    signal?.throwIfAborted();const row=rows.get(id);
    need(row?.received,'DOCUMENT_ASSEMBLY_ORIGINAL_PDF_NOT_RECEIVED');
    const file=row.outputs.files.find(file=>file.slot==='pdf');
    need(file?.resourceId&&typeof file.path==='string','DOCUMENT_ASSEMBLY_ORIGINAL_PDF_REQUIRED');
    const resource=workspace.library.resource(file.resourceId);
    need(resource.status==='VERIFIED'&&resource.sha256===file.sha256&&resource.bytes===file.bytes,
      'DOCUMENT_ASSEMBLY_ORIGINAL_PDF_CHANGED');
    const raw=await ownedBytes(file.path,33554432,{privateMode:false});
    need(raw.length===file.bytes&&digest(raw)===file.sha256,'DOCUMENT_ASSEMBLY_ORIGINAL_PDF_CHANGED');
    sources.push({id:identifier(id),filename:id+'.pdf',bytes:raw.length,sha256:file.sha256,
      base64:raw.toString('base64'),reference:row.requestId});
  }
  return prepareDocumentPdfAssembly({directory,request,sources,origin:{kind:'document-batch',
    batchId:batch.plan.id,batchInputSha256:batch.plan.inputSha256,batchPlanSha256:batch.sha256,
    ...(composition?{compositionId:composition.id,compositionSha256:composition.sha256}:{})},signal});
}
function nativeRequest(source){
  const plan=source.plan,request=plan.request;
  return {schema:DOCUMENT_BATCH_SCHEMA,id:'assembly.'+source.sha256.slice(0,54),name:request.name,
    provider:'pdfmint',merchantOrigin:request.merchantOrigin,
    documents:plan.volumes.filter(volume=>volume.kind==='merge').map(volume=>({
      id:volume.id,label:volume.input.title,source:volume.source.path,format:'pdf-set',input:volume.input
    }))};
}
export async function prepareDocumentPdfAssemblyBatch({workspace,directory,expectedSha256,
  intakeAccessToken=null,signal,onProgress}={}){
  const source=await readDocumentPdfAssembly(directory,{expectedSha256,signal});
  if(!source.plan.counts.paidMerges)return {source,batch:null,totals:[]};
  const batch=await prepareDocumentBatch({workspace,directory:join(source.directory,'batch'),
    request:nativeRequest(source),sourceRoot:source.directory,intakeAccessToken,signal,onProgress});
  return {source,batch,totals:copy(batch.plan.totals)};
}
export async function readDocumentPdfAssemblyBatch({workspace,directory,expectedSha256,signal}={}){
  const source=await readDocumentPdfAssembly(directory,{expectedSha256,signal});
  if(!source.plan.counts.paidMerges)return {source,batch:null,totals:[]};
  const batch=await readDocumentBatch(join(source.directory,'batch'));
  need(batch.plan.workspaceDirectory===workspace.directory&&same(batch.plan.input,
    normalizeDocumentBatch(nativeRequest(source),{sourceRoot:source.directory})),
    'DOCUMENT_ASSEMBLY_ORIGINAL_BATCH_CHANGED');
  for(const item of batch.plan.items){
    const volume=source.plan.volumes.find(value=>value.id===item.id);
    need(volume&&item.source.bytes===volume.source.bytes&&item.source.sha256===volume.source.sha256,
      'DOCUMENT_ASSEMBLY_PAID_SOURCE_CHANGED');
  }
  return {source,batch,totals:copy(batch.plan.totals)};
}
export async function inspectDocumentPdfAssembly({workspace,directory,expectedSha256,signal}={}){
  const source=await readDocumentPdfAssembly(directory,{expectedSha256,signal});
  let batch=null,snapshot=null;
  try{const selected=await readDocumentPdfAssemblyBatch({workspace,directory,expectedSha256:source.sha256,signal});
    batch=selected.batch;
    if(batch)snapshot=await inspectDocumentBatch({workspace,plan:batch.plan,signal});
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const rows=new Map((snapshot?.rows??[]).map(row=>[row.id,row]));
  const volumes=source.plan.volumes.map(volume=>{
    const native=rows.get(volume.id)??null;
    return {...copy(volume),state:volume.kind==='original'?'RETAINED_ORIGINAL':native?.state??'PRICE_REQUIRED',
      received:volume.kind==='original'||native?.received===true,native};
  });
  return {schema:'stellar-forge.document-assembly-view.v1',id:source.plan.request.id,
    directory:source.directory,sourceSha256:source.sha256,sourceBytes:source.bytes,
    request:copy(source.plan.request),origin:copy(source.plan.origin),counts:copy(source.plan.counts),
    originalFiles:source.plan.files.map(({base64,...file})=>copy(file)),volumes,
    complete:volumes.every(volume=>volume.received),
    native:batch?{planSha256:batch.sha256,planBytes:batch.bytes,directory:batch.plan.directory,
      totals:copy(batch.plan.totals),snapshot}:null};
}
export async function runDocumentPdfAssembly({workspace,directory,expectedSha256,approvedPlanSha256,
  receiveOnly=false,intakeAccessToken=null,signal,deadlineMs=300000,pollMs=1500,onProgress}={}){
  const selected=await readDocumentPdfAssemblyBatch({workspace,directory,expectedSha256,signal});
  if(selected.batch){
    let snapshot,operationError;
    try{
      const options={workspace,plan:selected.batch.plan,signal,deadlineMs,pollMs,onProgress};
      snapshot=receiveOnly?await receiveDocumentBatch(options):await runDocumentBatch({...options,
        approvedPlanSha256,planSha256:selected.batch.sha256,
        ...(intakeAccessToken===null?{}:{intakeAccessToken})});
    }catch(error){operationError=error;throw error;}finally{
      // Original journals remain authoritative even if a supplier operation is interrupted.
      if(!snapshot)try{snapshot=await inspectDocumentBatch({workspace,plan:selected.batch.plan});}catch{}
      if(snapshot)try{await saveDocumentBatchReport({snapshot,plan:selected.batch.plan,
        directory:join(selected.source.directory,'reports',digest(encoded(snapshot)).slice(0,32))});}
      catch(error){if(!operationError)throw error;}
    }
  }
  return inspectDocumentPdfAssembly({workspace,directory,expectedSha256:selected.source.sha256,signal});
}
async function outputFile(workspace,source,volume,snapshot,signal){
  if(volume.kind==='original')return {path:join(source.directory,volume.source.path),
    bytes:volume.source.bytes,sha256:volume.source.sha256,resourceId:null};
  const row=snapshot.rows.find(item=>item.id===volume.id);
  need(row?.received,'DOCUMENT_ASSEMBLY_VOLUME_NOT_RECEIVED');
  const pdf=row.outputs.files.find(file=>file.slot==='pdf'),original=row.outputs.files.find(file=>file.slot==='source');
  need(original?.sha256===volume.source.sha256&&original.bytes===volume.source.bytes&&pdf?.path&&pdf.resourceId,
    'DOCUMENT_ASSEMBLY_OUTPUT_SOURCE_CHANGED');
  const resource=workspace.library.resource(pdf.resourceId);
  need(resource.status==='VERIFIED'&&resource.sha256===pdf.sha256&&resource.bytes===pdf.bytes,
    'DOCUMENT_ASSEMBLY_OUTPUT_CHANGED');
  signal?.throwIfAborted();return {path:pdf.path,bytes:pdf.bytes,sha256:pdf.sha256,resourceId:pdf.resourceId};
}
export async function documentPdfAssemblyOutput({workspace,directory,expectedSha256,volumeId,signal}={}){
  const selected=await readDocumentPdfAssemblyBatch({workspace,directory,expectedSha256,signal});
  const volume=selected.source.plan.volumes.find(value=>value.id===volumeId);
  need(volume,'DOCUMENT_ASSEMBLY_VOLUME_REQUIRED');
  const snapshot=selected.batch?await inspectDocumentBatch({workspace,plan:selected.batch.plan,signal}):null;
  return {...await outputFile(workspace,selected.source,volume,snapshot,signal),filename:volume.filename,
    contentType:'application/pdf',volume:copy(volume)};
}
function csv(rows){
  const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  return [['volume','kind','filename','original_files','bytes','sha256'],...rows.map(row=>
    [row.id,row.kind,row.filename,row.fileIds.join(' | '),row.bytes,row.sha256])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
function reviewHtml(plan,rows){
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+
    '<title>'+escape(plan.request.name)+'</title><style>body{max-width:1100px;margin:32px auto;padding:0 20px;font:15px system-ui;color:#202020}table{border-collapse:collapse;width:100%}td,th{text-align:left;border:1px solid #bbb;padding:10px}th{background:#eee}code{overflow-wrap:anywhere}</style>'+
    '<h1>'+escape(plan.request.name)+'</h1><p>Original task: '+escape(plan.request.taskReference)+
    '. '+plan.counts.originalFiles+' complete source PDFs in '+rows.length+' ordered volumes.</p>'+
    '<p>'+plan.counts.paidMerges+' original paid assembly requests; '+plan.counts.unchangedVolumes+
    ' unchanged PDF volumes. Supplier credits, native purchases, PDF pages and customer task acceptance remain separate.</p>'+
    '<table><thead><tr><th>Volume</th><th>PDF</th><th>Original files, in order</th><th>Bytes</th></tr></thead><tbody>'+
    rows.map(row=>'<tr><td>'+row.index+'</td><td><a href="pdfs/'+escape(row.filename)+'">'+escape(row.filename)+
      '</a></td><td>'+row.fileIds.map(escape).join(', ')+'</td><td>'+row.bytes+'</td></tr>').join('')+
    '</tbody></table><p><a href="assembly-plan.json">Complete original editable source</a> · '+
    '<a href="assembly-delivery.json">Delivery and exact file identities</a> · <a href="assembly-results.csv">CSV</a></p></html>';
}
async function retainedBatchExport(workspace,batch,directory,signal,maxBytes){
  try{
    const saved=parse(await ownedBytes(join(directory,'batch-export.json'),1048576));
    need(saved.schema==='stellar-forge.document-batch-export.v1'&&saved.batchId===batch.plan.id&&
      saved.directory===directory&&saved.receivedDocuments===batch.plan.items.length&&
      saved.documents===batch.plan.items.length,'DOCUMENT_ASSEMBLY_NATIVE_EXPORT_CHANGED');
    const original=parse(await ownedBytes(join(directory,'batch-plan.json'),16777216));
    need(same(original,batch.plan),'DOCUMENT_ASSEMBLY_NATIVE_EXPORT_CHANGED');
    const archive=await inspectCollectionArchive(join(directory,'documents.tar'),{signal,maxBytes});
    need(archive.sha256===saved.archive.sha256&&archive.bytes===saved.archive.bytes&&
      saved.archive.path===join(directory,'documents.tar')&&
      archive.manifest.collection.id===saved.collection.id&&
      archive.manifest.collection.revision===saved.collection.revision,'DOCUMENT_ASSEMBLY_NATIVE_EXPORT_CHANGED');
    for(const file of saved.files){
      need(typeof file.name==='string'&&!file.name.includes('/')&&!file.name.includes('\\'),
        'DOCUMENT_ASSEMBLY_NATIVE_EXPORT_CHANGED');
      const bytes=await ownedBytes(join(directory,file.name),file.bytes);
      need(bytes.length===file.bytes&&digest(bytes)===file.sha256,'DOCUMENT_ASSEMBLY_NATIVE_EXPORT_CHANGED');
    }
    return saved;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return exportDocumentBatch({workspace,plan:batch.plan,directory,signal,maxBytes});
}
/** A complete customer edition: ordered PDFs, all input bytes, original paid results and portable Collection. */
export async function exportDocumentPdfAssembly({workspace,directory,expectedSha256,destination,signal,maxBytes}={}){
  const selected=await readDocumentPdfAssemblyBatch({workspace,directory,expectedSha256,signal});
  const {source,batch}=selected,plan=source.plan;
  const snapshot=batch?await inspectDocumentBatch({workspace,plan:batch.plan,signal}):null;
  need(!snapshot||snapshot.receivedDocuments===snapshot.documents,'DOCUMENT_ASSEMBLY_RECEIVING_INCOMPLETE',
    'Receive every original assembly job before exporting the complete customer volume set.');
  destination=await ownedDirectory(absolute(destination),{create:true});
  need(destination!==source.directory&&!inside(source.directory,destination),'DOCUMENT_ASSEMBLY_EXPORT_DIRECTORY_INVALID');
  const lease=await acquireStateLease(destination);
  try{
    const batchExport=batch?await retainedBatchExport(workspace,batch,join(destination,'native'),signal,maxBytes):null;
    const rows=[];
    for(const volume of plan.volumes){
      signal?.throwIfAborted();const file=await outputFile(workspace,source,volume,snapshot,signal);
      const bytes=await ownedBytes(file.path,file.bytes,{privateMode:false});
      need(bytes.length===file.bytes&&digest(bytes)===file.sha256,'DOCUMENT_ASSEMBLY_OUTPUT_CHANGED');
      await ownedDirectory(join(destination,'pdfs'),{create:true});lease.assertHeld();
      await writeExact(join(destination,'pdfs',volume.filename),bytes);
      rows.push({id:volume.id,index:volume.index,kind:volume.kind,filename:volume.filename,fileIds:volume.fileIds,
        bytes:file.bytes,sha256:file.sha256,resourceId:file.resourceId});
    }
    const raw=await ownedBytes(join(source.directory,'assembly-plan.json'),MAX_PLAN);
    need(digest(raw)===source.sha256,'DOCUMENT_ASSEMBLY_SOURCE_SELECTION_CHANGED');
    const outputFiles={'assembly-plan.json':raw,'assembly-results.csv':Buffer.from(csv(rows)),
      'index.html':Buffer.from(reviewHtml(plan,rows))};
    const files=[];
    for(const [name,bytes]of Object.entries(outputFiles)){
      lease.assertHeld();await writeExact(join(destination,name),bytes);
      files.push({path:name,bytes:bytes.length,sha256:digest(bytes)});
    }
    const result={schema:DOCUMENT_ASSEMBLY_DELIVERY_SCHEMA,id:plan.request.id,directory:destination,
      source:{path:'assembly-plan.json',bytes:source.bytes,sha256:source.sha256},
      request:copy(plan.request),origin:copy(plan.origin),counts:copy(plan.counts),volumes:rows,
      files:[...files,...rows.map(row=>({path:'pdfs/'+row.filename,bytes:row.bytes,sha256:row.sha256}))],
      native:batchExport};
    // Keep the delivery manifest independent of its containing archive.
    const resultBytes=encoded(result);
    lease.assertHeld();await writeExact(join(destination,'assembly-delivery.json'),resultBytes);
    const members=[...result.files.map(file=>({...file,name:file.path,path:join(destination,file.path)})),
      {name:'assembly-delivery.json',path:join(destination,'assembly-delivery.json'),
        bytes:resultBytes.length,sha256:digest(resultBytes)}];
    if(batchExport){
      for(const file of batchExport.files)members.push({name:'native/'+file.name,
        path:join(destination,'native',file.name),bytes:file.bytes,sha256:file.sha256});
      const raw=await ownedBytes(join(destination,'native','batch-export.json'),1048576);
      members.push({name:'native/batch-export.json',path:join(destination,'native','batch-export.json'),
        bytes:raw.length,sha256:digest(raw)},
        {name:'native/documents.tar',...batchExport.archive});
    }
    const archive=await writeDocumentAssemblyArchive({destination:join(destination,'complete-pdf-bundle.tar'),
      members,signal,maxBytes});
    const receipt={schema:'stellar-forge.document-assembly-archive.v1',sourceSha256:source.sha256,
      deliverySha256:digest(resultBytes),archive};
    lease.assertHeld();await writeExact(join(destination,'assembly-archive.json'),encoded(receipt));
    return {...result,archive};
  }finally{await lease.close();}
}

export {
  DOCUMENT_PDF_SOURCE_SCHEMA,DOCUMENT_ASSEMBLY_SOURCE_CHECKED_ON,DOCUMENT_ASSEMBLY_FORMAT,
  DOCUMENT_ASSEMBLY_MAX_FILES,documentAssemblySettingsSchema,normalizeDocumentAssemblyInput,
  documentAssemblyInputSchema,normalizeDocumentPdfSource,buildDocumentAssemblyRequest
} from './contracts.mjs';
