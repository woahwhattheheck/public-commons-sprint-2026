// MIT. Private quote assessment receiving through original SF74 case/source and SF47 readers.
import {join,resolve,isAbsolute} from 'node:path';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {exportCaseSourcePackage,inspectCaseSourcePackage,receiveCaseSourcePackage} from '../case-source-package.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {privateDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {canonical,jsonBytes,sha256,commercialError} from '../commercial-pricing.mjs';
import {inspectCommercialInstallationSource} from '../../../scf_2026/sf47_budget_model/workspace/commercial_installation_source.mjs';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=message=>{throw commercialError('COMMERCIAL_ECONOMICS_RECEIVING',message,409);};
const same=(a,b)=>{if(canonical(a)!==canonical(b))fail('The original quotation or private assessment changed.');};
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
function absolute(path){
  if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path==='/')fail('Use an absolute normalized private path.');
  return path;
}
function selection(args){
  const value={quoteId:args.quoteId,quoteSha256:args.quoteSha256,
    assessmentId:args.assessmentId,assessmentSha256:args.assessmentSha256};
  if(!UUID.test(value.quoteId??'')||!UUID.test(value.assessmentId??'')||
    !HASH.test(value.quoteSha256??'')||!HASH.test(value.assessmentSha256??''))
    fail('Select the exact original quotation and private assessment IDs and sealed SHA-256 values.');
  return value;
}
function checkedDownload(result){
  const body=Buffer.from(result.body);
  if(body.length!==result.descriptor.bytes||sha256(body)!==result.descriptor.sha256)
    fail('The original native download differs from its complete descriptor.');
  return body;
}
async function optional(path,maximum){
  try{return await readPrivateFile(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function modelAt(casesDirectory){
  absolute(casesDirectory);await privateDirectory(casesDirectory,{create:false});
  return openCaseCommercial({store:await openCaseStore(casesDirectory),workspaceId:commercialWorkspaceId(casesDirectory)});
}
/** Reading retains separate sealed-object and downloaded-file digests. */
export async function inspectEconomicsCase(args){
  const selected=selection(args);
  if(!HASH.test(args.revision??''))fail('Select the original saved case revision.');
  const model=args.model??await modelAt(args.casesDirectory);
  const view=await model.read({id:args.id,revision:args.revision});
  const assessment=view.economics.assessments.find(row=>row.id===selected.assessmentId);
  const quote=view.quotes.find(row=>row.id===selected.quoteId);
  if(!assessment||assessment.sha256!==selected.assessmentSha256||
    assessment.quoteId!==selected.quoteId||assessment.quoteSha256!==selected.quoteSha256||
    !quote||quote.sha256!==selected.quoteSha256)
    fail('The selected assessment must belong to this exact retained quotation.');
  const common={id:args.id,revision:args.revision};
  const a=await model.downloadEconomics({...common,assessmentId:assessment.id,kind:'JSON'});
  const q=await model.download({...common,quoteId:quote.id,quoteSha256:quote.sha256,kind:'QUOTE_JSON'});
  const assessmentBytes=checkedDownload(a),quoteBytes=checkedDownload(q);
  const originalAssessment=JSON.parse(decode(assessmentBytes)),originalQuote=JSON.parse(decode(quoteBytes));
  if(originalAssessment.sha256!==selected.assessmentSha256||originalQuote.sha256!==selected.quoteSha256)
    fail('The original native documents differ from their selected sealed identities.');
  return {schema:'stellar-forge.merchant-economics-case-review.v1',selection:selected,
    case:copy(view.case),assessment:originalAssessment,quote:originalQuote,
    files:{assessment:copy(a.descriptor),quote:copy(q.descriptor)}};
}
/** Full original history, all original source bundles, and every assessment travel together. */
export async function exportEconomicsCase(args){
  const review=await inspectEconomicsCase(args);
  const store=args.store??await openCaseStore(args.casesDirectory);
  const result=await exportCaseSourcePackage({store,casesDirectory:args.casesDirectory,id:args.id,
    revision:args.revision,directory:absolute(args.directory),exportId:args.exportId,
    sourceDelivery:args.sourceDelivery,generatedAt:args.generatedAt,python:args.python,
    environment:args.environment,signal:args.signal});
  same(result.case,review.case&&{id:args.id,revision:args.revision,
    workspaceSha256:review.case.workspaceSha256,supportSha256:review.case.supportSha256});
  return {schema:'stellar-forge.merchant-economics-package.v1',state:'COMPLETE',
    selection:review.selection,casePackage:result,review};
}
/** Recompute from the hash-checked package's own original case history. */
export async function inspectEconomicsPackage(args){
  const selected=selection(args),directory=absolute(args.directory);
  if(!HASH.test(args.expectedManifestSha256??''))fail('Use the exact whole case/source manifest SHA-256.');
  const result=await inspectCaseSourcePackage({directory,expectedManifestSha256:args.expectedManifestSha256,
    python:args.python,environment:args.environment,signal:args.signal});
  const review=await inspectEconomicsCase({casesDirectory:join(directory,'original-case-store'),
    id:result.case.id,revision:result.case.revision,...selected});
  return {schema:'stellar-forge.merchant-economics-package.v1',state:'VERIFIED',
    selection:selected,casePackage:result,review};
}
export async function receiveEconomicsCase(args){
  const selected=selection(args),root=absolute(args.receivingDirectory);
  await privateDirectory(root);
  const retained=await optional(join(root,'package','case-source-package.json'),64*1024*1024);
  const original=await inspectEconomicsPackage({...args,directory:retained?join(root,'package'):args.directory});
  const request={schema:'stellar-forge.merchant-economics-receiving-selection.v1',
    requestId:args.requestId,actor:args.actor,manifestSha256:args.expectedManifestSha256,
    selection:selected,sourceCase:original.review.case};
  // The original receiver owns its effect lock and request journal. This immutable
  // selection prevents one receiving directory from being reused for another assessment.
  await retainCaseArtifact(join(root,'economics-selection.json'),jsonBytes(request));
  const received=await receiveCaseSourcePackage({directory:args.directory,receivingDirectory:root,
    casesDirectory:args.casesDirectory,sourceDelivery:args.sourceDelivery,requestId:args.requestId,
    actor:args.actor,expectedManifestSha256:args.expectedManifestSha256,
    python:args.python,environment:args.environment,signal:args.signal});
  same(received.sourceCase,original.casePackage.case);
  const review=await inspectEconomicsCase({casesDirectory:args.casesDirectory,id:received.case.id,
    revision:received.case.importedRevision,...selected});
  same(review.assessment,original.review.assessment);same(review.quote,original.review.quote);
  same(review.files,original.review.files);
  // importedRevision remains the frozen receiving comparison. The original
  // receiver separately returns currentRevision and never replaces later edits.
  return {schema:'stellar-forge.merchant-economics-receiving.v1',state:'COMPLETE',
    selection:selected,receiving:received,review};
}
/** Staff-only transfer. No case, Installation, Forecast or customer acceptance is written. */
export async function exportEconomicsHandoff(args){
  const selected=selection(args),review=await inspectEconomicsCase(args);
  const model=await modelAt(args.casesDirectory),common={id:args.id,revision:args.revision};
  const handoff=await model.download({...common,quoteId:selected.quoteId,quoteSha256:selected.quoteSha256,kind:'HANDOFF'});
  const report=await model.downloadEconomics({...common,assessmentId:selected.assessmentId,kind:'REPORT'});
  const source=checkedDownload(handoff),reportBytes=checkedDownload(report);
  let accepted=null;
  if(args.acceptanceId!==undefined||args.acceptanceSha256!==undefined){
    if(!UUID.test(args.acceptanceId??'')||!HASH.test(args.acceptanceSha256??''))
      fail('Keep both exact original customer acceptance fields.');
    accepted={quoteId:selected.quoteId,quoteSha256:selected.quoteSha256,
      acceptanceId:args.acceptanceId,acceptanceSha256:args.acceptanceSha256};
  }
  const native=await inspectCommercialInstallationSource(source,accepted);
  const preserved=native.economics?.assessments?.find(row=>row.id===selected.assessmentId);
  if(!preserved||preserved.sha256!==selected.assessmentSha256)
    fail('The installed SF47 reader must retain this exact private assessment.');
  const {material,originCaseId,...original}=preserved;
  same(original,review.assessment);
  const directory=absolute(args.directory);await privateDirectory(directory);
  const contents=[
    ['merchant-handoff.json',source,'complete-original-merchant-source'],
    ['private-assessment.json',jsonBytes(review.assessment),'private-operator-assessment'],
    ['private-assessment.md',reportBytes,'private-readable-assessment'],
    ['quote.json',jsonBytes(review.quote),'original-immutable-customer-quote'],
    ['quote.md',Buffer.from(review.quote.customerDocument),'original-customer-document'],
    ['sf47-source-review.json',jsonBytes(native),'original-sf47-read-only-source-inspection'],
  ];
  const files=[];
  for(const [name,bytes,role]of contents){
    const pin=await retainCaseArtifact(join(directory,name),bytes);
    files.push({name,role,...pin});
  }
  const manifest={schema:'stellar-forge.merchant-economics-sf47-handoff.v1',
    audience:'PRIVATE_OPERATOR',case:review.case,selection:selected,
    acceptance:accepted,files,
    use:'Attach merchant-handoff.json as the original SF47 source. Select its actual recorded acceptance through Customer Installation. Keep this entire private handoff with the source; no Forecast row or customer acceptance is created by this read.'};
  const body=jsonBytes(manifest),pin=await retainCaseArtifact(join(directory,'economics-handoff.json'),body);
  // Verify the complete just-published originals. A matching path alone is not success.
  for(const file of files){
    const bytes=await readPrivateFile(join(directory,file.name),file.bytes);
    if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)fail('A published handoff member changed.');
  }
  return {schema:manifest.schema,state:'COMPLETE',directory,manifest:{name:'economics-handoff.json',...pin},
    selection:selected,acceptance:accepted,files,reader:native.reader};
}
