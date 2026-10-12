// MIT. Shared Python/Merchant calls into the single original Research client.
import {need,object} from '../node/store.mjs';
import {extractionDigest,extractionInput,extractionTypedValue,EXTRACTION_OPERATION_SCHEMA} from './study-extraction.mjs';
import {publicationDigest,publicationInput,EXTRACTION_PUBLICATION_SCHEMA,EXTRACTION_PUBLICATION_OPERATION_SCHEMA} from './extraction-publication.mjs';

const fields=['requestId','expectedRevision','actor','action','data'];
const keys=value=>Object.keys(value).sort().join('\n');
const exact=(value,selected)=>object(value)&&keys(value)===selected.slice().sort().join('\n');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>a===undefined||b===undefined?a===b:extractionDigest(a)===extractionDigest(b);
const recovery='Read the original extraction/publication operation history, then replay the complete saved requestId, expectedRevision, actor, action and data. Preserve its original source/form/result choices; do not replace the expected revision after a lost reply.';

export function extractionTransportView(value,{dossierId,revision}){
  need(object(value)&&value.dossierId===dossierId&&Number.isSafeInteger(value.revision)&&
    value.revision>0&&(revision===undefined||value.revision===revision),
    'RESEARCH_EXTRACTION_SOURCE_CHANGED');
  return value;
}
export function extractionTransportRequest(request,{publication=false}={}){
  need(object(request)&&Object.keys(request).every(key=>fields.includes(key)||key==='projection')&&
    fields.every(key=>Object.hasOwn(request,key))&&
    (request.projection===undefined||request.projection==='metadata'),
    'RESEARCH_EXTRACTION_REQUEST_INVALID');
  const body=Object.fromEntries(fields.map(key=>[key,request[key]]));
  need(Buffer.byteLength(JSON.stringify(body))<=16*1024*1024,'RESEARCH_EXTRACTION_REQUEST_TOO_LARGE');
  return publication?publicationInput(body):extractionInput(body);
}
export function extractionTransportDigest(value,{publication=false}={}){
  return publication?publicationDigest(value):extractionDigest(value);
}

export async function reviewResearchExtraction(client,dossierId,request,{publication=false,signal}={}){
  const body=extractionTransportRequest(request,{publication});let result;
  try{
    result=await (publication?client.reviewExtractionPublication(dossierId,body,{signal}):
      client.reviewExtraction(dossierId,body,{signal}));
  }catch(error){
    if(error.outcomeUnknown)Object.assign(error,{dossierId,requestId:body.requestId,recovery});
    throw error;
  }
  const operation=result?.operation;
  if(result?.dossier?.id!==dossierId||typeof result.duplicate!=='boolean'||
    operation?.requestId!==body.requestId||operation?.originalRevision!==body.expectedRevision||
    operation?.revision!==body.expectedRevision+1||operation?.action!==body.action||
    operation?.schema!==(publication?EXTRACTION_PUBLICATION_OPERATION_SCHEMA:EXTRACTION_OPERATION_SCHEMA)||
    !hash(operation?.sha256)||!hash(operation?.originalRevisionSha256)||
    operation?.requestSha256!==extractionTransportDigest(body,{publication})||
    operation.sha256!==extractionTransportDigest(Object.fromEntries(
      Object.entries(operation).filter(([key])=>key!=='sha256')),{publication})||
    !same(operation?.request,body)||!same(operation?.actor,body.actor)||
    !Number.isSafeInteger(result.dossier?.revision)||result.dossier.revision<operation.revision){
    throw Object.assign(new Error('RESEARCH_EXTRACTION_RECEIPT_CHANGED'),{
      code:'RESEARCH_EXTRACTION_RECEIPT_CHANGED',outcomeUnknown:true,
      dossierId,requestId:body.requestId,recovery
    });
  }
  return result;
}
export async function readResearchExtraction(client,dossierId,options={},{
  publication=false,sourceValues=false,signal
}={}){
  need(!(publication&&sourceValues),'RESEARCH_EXTRACTION_READ_INVALID');
  const selected={...options,signal};
  const value=await (sourceValues?client.extractionSourceValues(dossierId,selected):
    publication?client.extractionPublications(dossierId,selected):client.extraction(dossierId,selected));
  extractionTransportView(value,{dossierId,revision:options.revision});
  if(sourceValues){
    need(value.schema==='sf88-research-extraction-source-values/v1'&&
      value.occurrence?.occurrenceId===options.occurrenceId&&Array.isArray(value.values)&&
      value.values.length===options.pointers?.length,'RESEARCH_EXTRACTION_SOURCE_VALUES_CHANGED');
    value.values.forEach((item,index)=>{
      need(item.occurrenceId===options.occurrenceId&&item.pointer===options.pointers[index]&&
        item.kind==='json-pointer'&&typeof item.found==='boolean'&&hash(item.contentSha256)&&
        Number.isSafeInteger(item.contentBytes)&&item.contentBytes>=0&&
        (options.fileName===undefined?item.file===undefined:item.file?.name===options.fileName)&&
        (item.found?Object.hasOwn(item,'typedValue'):!Object.hasOwn(item,'typedValue')),
        'RESEARCH_EXTRACTION_SOURCE_VALUES_CHANGED');
      if(item.found)extractionTypedValue(item.typedValue);
    });
  }else{
    need(value.schema===(publication?EXTRACTION_PUBLICATION_SCHEMA:'sf88-research-study-extraction/v1'),
      'RESEARCH_EXTRACTION_SOURCE_CHANGED');
  }
  return value;
}
