// MIT. Reviewer delivery through the original Merchant Console and retained file owner.
import {createRetainedDownload} from '../retained-download.mjs';
import {downloadReviewerExport,readReviewerValue} from '../../../stellar/scf_2026/presentation/reviewer/merchant/client.mjs';
import {ALIAS,SHA,MANIFEST_NAME,MAX_RESPONSE_BYTES,MAX_PACKET_BYTES,parseReviewerExport,encode}
  from '../../../stellar/scf_2026/presentation/reviewer/merchant/contracts.mjs';
import {canonical,digest,fail} from './records.mjs';

const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const checked=(value,pattern,label)=>{
  if(typeof value!=='string'||!new RegExp(pattern).test(value))
    throw fail('CONSOLE_REVIEWER_SELECTION','Use the original '+label+'.',400);
  return value;
};
export const REVIEWER_CUSTOMER_FAMILY='grant-reviewer';
const prefix='merchant_grant_reviewer';
const files=createRetainedDownload({
  manifestName:MANIFEST_NAME,parseManifest:parseReviewerExport,
  maximumBytes:MAX_RESPONSE_BYTES+MAX_PACKET_BYTES,
  stateSchema:'stellar-forge.grant-reviewer-file-download.v1',
  resultSchema:'stellar-forge.grant-reviewer-file-receipt.v1',
  toolPrefix:prefix,errorPrefix:'GRANT_REVIEWER',clientName:'starforge-merchant-console',
  validateExportId:id=>checked(id,SHA,'export ID')
});
export function normalizeReviewerCustomer(input){
  if(input.family!==REVIEWER_CUSTOMER_FAMILY)
    throw fail('CONSOLE_REVIEWER_SELECTION','Select the original reviewer customer family.',400);
  return {profileId:input.profileId,family:REVIEWER_CUSTOMER_FAMILY,
    workspace:checked(input.workspace,ALIAS,'configured reviewer workspace'),
    exportId:checked(input.exportId,SHA,'reviewer export ID'),
    expectedManifestSha256:checked(input.expectedManifestSha256,SHA,'manifest SHA-256'),
    hostFingerprint:checked(input.expectedHostFingerprint??input.hostFingerprint,SHA,'host fingerprint')};
}
export function reviewerCustomerAccess(selection){
  return {name:prefix+'_manifest',args:{workspace:selection.workspace,exportId:selection.exportId}};
}
export function createReviewerCustomerTransfer({operator,authorize},selection,request){
  const client={endpoint:'urn:stellar-forge:merchant-host:'+selection.hostFingerprint,
    call:async(name,args)=>{
      const values={...args,workspace:selection.workspace};
      const context=await authorize(request,name,values);
      return operator.call(name,values,context?{authorization:context}:undefined);
    }};
  return {...files,
    download:input=>downloadReviewerExport({...input,workspace:selection.workspace,client})};
}
/** The selected packet is itself the complete native receiving file, not a reconstructed archive. */
export function reviewerCustomerArchiveFile(record){
  const manifest=record.manifest;
  if(manifest.kind==='reviewer-packet'){
    const file=manifest.files.find(value=>value.name==='grant-reviewer-packet.json');
    if(!file)throw fail('CONSOLE_REVIEWER_PACKET','The received manifest has no original reviewer packet.',409);
    return {...file,label:'Download original receiving packet'};
  }
  if(manifest.files.length===1)return {...manifest.files[0],label:'Download complete original file'};
  return null;
}
export function validateReviewerCustomerRecord(record){
  const selection=normalizeReviewerCustomer(record.identity);
  if(canonical(selection)!==canonical(record.identity))
    throw fail('CONSOLE_ARCHIVE_CHANGED','The reviewer customer selection changed.',400);
  if(record.state!=='COMPLETE')return;
  const manifest=parseReviewerExport(encode(record.manifest),selection.exportId);
  if(manifest.workspace!==selection.workspace||
    digest(encode(manifest))!==selection.expectedManifestSha256)
    throw fail('CONSOLE_ARCHIVE_CHANGED','Retain the exact original reviewer manifest.',400);
  const expected=[...manifest.files,{name:MANIFEST_NAME,bytes:encode(manifest).length,sha256:selection.expectedManifestSha256}];
  if(!Array.isArray(record.files)||record.files.length!==expected.length||
    expected.some(item=>!record.files.some(file=>file.name===item.name&&file.bytes===item.bytes&&file.sha256===item.sha256)))
    throw fail('CONSOLE_ARCHIVE_CHANGED','Retain every original reviewer file and manifest identity.',400);
}
export const reviewerCustomerFamily=Object.freeze({
  id:REVIEWER_CUSTOMER_FAMILY,label:'Grant reviewer packet and results',
  workspaceRequired:true,workspacePattern:ALIAS,exportPattern:SHA,
  toolPrefix:prefix,manifestName:MANIFEST_NAME,maximumBytes:MAX_RESPONSE_BYTES+MAX_PACKET_BYTES,
  normalize:normalizeReviewerCustomer,access:reviewerCustomerAccess,
  createTransfer:createReviewerCustomerTransfer,parseManifest:parseReviewerExport,
  validateRecord:validateReviewerCustomerRecord,archiveFile:reviewerCustomerArchiveFile
});

/** Reopen the full original return behind a saved native console call. No workbench action is repeated. */
export async function readReviewerConsoleCall({record,operator,authorize,request}){
  if(!record.tool?.startsWith(prefix+'_')||record.state!=='COMPLETE'||
    typeof record.resultJson!=='string'||digest(record.resultJson)!==record.resultSha256)
    throw fail('CONSOLE_REVIEWER_RETURN','Choose a completed original reviewer call.',409);
  const args=JSON.parse(record.argumentsJson);
  await authorize(request,record.tool,args);
  const result=JSON.parse(record.resultJson);
  if(result?.isError)throw fail('CONSOLE_REVIEWER_NATIVE_ERROR','The original native tool returned an error; open its retained request.',409);
  if(result?.schema!=='stellar-forge.grant-reviewer-merchant-result.v1')
    return {callId:record.id,resultSha256:record.resultSha256,native:result,retained:null};
  if(result.retention?.state!=='COMPLETE'||!result.exportId)
    throw fail('CONSOLE_REVIEWER_RETURN_UNRETAINED',
      'The original action returned before file retention completed. Recover that same native request UUID.',409);
  if(['saved-result','source-document'].includes(result.kind))
    return {callId:record.id,resultSha256:record.resultSha256,viewKind:'file',
      native:{kind:result.kind,source:result.source,files:result.files},retained:result};
  const native=result.completeValue===true?result.value:await readReviewerValue({
    workspace:args.workspace,result,
    file:result.kind==='reviewer-packet'?'operation.json':'original-response.json',
    client:{endpoint:'urn:stellar-forge:merchant-console:'+record.hostFingerprint,
      call:async(name,values)=>{
        const context=await authorize(request,name,values);
        return operator.call(name,values,context?{authorization:context}:undefined);
      }}
  });
  return {callId:record.id,resultSha256:record.resultSha256,native,retained:result};
}
