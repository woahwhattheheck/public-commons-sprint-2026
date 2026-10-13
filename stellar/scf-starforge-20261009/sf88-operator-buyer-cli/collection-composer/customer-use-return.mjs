// MIT. Original Inbox evidence joined to an immutable saved customer-use selection.
import { inspectHandoff, renderHandoff, MAX_BYTES as INBOX_MAX_BYTES } from '../operations-handoff/contract.mjs';
import { canonical, digest, copy, hash, commissionId, entryKey, plainObject,
  requireCustomerUse as need, customerUseError } from './customer-use-definition.mjs';

export const CUSTOMER_USE_RETURN_SCHEMA = 'stellar-forge.sf88.customer-use-return.v1';
export const CUSTOMER_USE_RETURN_MAX_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\0');
const integer = value => Number.isSafeInteger(value) && value >= 1;
function object(value, keys) {
  need(plainObject(value) && Object.keys(value).every(key => keys.includes(key)),
    'CUSTOMER_USE_RETURN_INVALID', 'Retain the complete supported customer-use return fields.');
}
function context(value, rows) {
  object(value, ['source','commission','bindings']);
  object(value.source, ['caseId','caseVersion','mode','planId','planContentSha256','calendarSha256']);
  const source=value.source;
  need(ID(source.caseId)&&integer(source.caseVersion)&&ID(source.mode)&&ID(source.planId),
    'CUSTOMER_USE_RETURN_SOURCE_INVALID','Retain the original case export selection.');
  hash(source.planContentSha256);hash(source.calendarSha256);
  object(value.commission,['id','revision','revisionSha256','documentSha256']);
  commissionId(value.commission.id);hash(value.commission.revisionSha256);hash(value.commission.documentSha256);
  need(integer(value.commission.revision),'CUSTOMER_USE_RETURN_REVISION_INVALID','Retain the saved commission edition.');
  need(Array.isArray(value.bindings)&&value.bindings.length>0&&value.bindings.length<=2000,
    'CUSTOMER_USE_RETURN_SELECTION_REQUIRED','Select original saved use bindings.');
  const byIntent=new Map(rows.map(row=>[row.intentId,row])), used=new Set(), ids=new Set(), entries=new Set();
  for(const binding of value.bindings) {
    object(binding,['id','entry','kind','use','requests']);commissionId(binding.id);
    object(binding.entry,['installationId','revision','installationSha256','entryId']);
    need(ID(binding.entry.installationId)&&integer(binding.entry.revision)&&ID(binding.entry.entryId),
      'CUSTOMER_USE_RETURN_ENTRY_INVALID','Retain the exact original Installation and dated use.');
    hash(binding.entry.installationSha256);
    need(!ids.has(binding.id)&&!entries.has(entryKey(binding.entry)),
      'CUSTOMER_USE_RETURN_DUPLICATE','Each original binding and use occurs once.');
    ids.add(binding.id);entries.add(entryKey(binding.entry));
    need(['PERIOD_REQUESTS','RETAINED_RESPONSES'].includes(binding.kind)&&plainObject(binding.use)
      &&binding.use.id===binding.entry.entryId&&ID(binding.use.buyerDeploymentId)&&ID(binding.use.taskId)
      &&['PURCHASE','ALLOWANCE_USE','REOPEN','FREE_USE'].includes(binding.use.mode)
      &&['PLANNED','CANCELLED'].includes(binding.use.state)
      &&Array.isArray(binding.use.fundingIds)
      &&(binding.kind==='RETAINED_RESPONSES')===(binding.use.mode==='REOPEN'),
    'CUSTOMER_USE_RETURN_USE_INVALID','Retain the complete original use and its request/result mode.');
    need(Array.isArray(binding.requests)&&binding.requests.length>0&&binding.requests.length<=500,
      'CUSTOMER_USE_RETURN_REQUEST_REQUIRED','Retain the exact original requests for each selected use.');
    const local=new Set();
    for(const request of binding.requests) {
      object(request,['collectionId','manifestSha256','requestKey','intentId','jobId','configSha256','sourceConfigSha256','responseSha256']);
      commissionId(request.collectionId);hash(request.manifestSha256);hash(request.jobId);hash(request.configSha256);hash(request.sourceConfigSha256);
      need(ID(request.intentId),'CUSTOMER_USE_RETURN_INTENT_INVALID','Retain the original intent, not its job-directory digest.');
      if(binding.kind==='PERIOD_REQUESTS'){
        commissionId(request.requestKey);
        need(request.responseSha256===null,'CUSTOMER_USE_RETURN_RESPONSE_INVALID',
          'A period request retains native output in its original Inbox row; its selected response digest is null.');
      }
      else need(request.requestKey===null,'CUSTOMER_USE_RETURN_REQUEST_INVALID','A retained result keeps its existing intent identity.');
      if(request.responseSha256!==null)hash(request.responseSha256);
      need(!local.has(request.intentId),'CUSTOMER_USE_RETURN_DUPLICATE','Each original intent occurs once per use.');
      local.add(request.intentId);
      const row=byIntent.get(request.intentId);
      need(row&&row.jobId===request.jobId&&row.configSha256===request.configSha256&&row.sourceConfigSha256===request.sourceConfigSha256,
        'CUSTOMER_USE_RETURN_NATIVE_BINDING_CHANGED','The original Inbox row belongs to another selected request.',409);
      if(binding.kind==='RETAINED_RESPONSES')
        need(request.responseSha256!==null&&row.output?.state==='VERIFIED'&&row.output.sha256===request.responseSha256,
          'CUSTOMER_USE_RETURN_RESPONSE_CHANGED','Reverify the same retained response before returning a reopened use.',409);
      used.add(row.intentId);
    }
  }
  need(used.size===rows.length,'CUSTOMER_USE_RETURN_UNBOUND_NATIVE_ROW',
    'Every captured original Inbox row must belong to this reviewed customer-use selection.');
  need(Buffer.byteLength(canonical(value))<=MAX_CONTEXT_BYTES,'CUSTOMER_USE_RETURN_CONTEXT_SIZE',
    'Select a smaller complete group of uses within the 2 MiB return-context limit.',413);
  return copy(value);
}
function decodeOriginal(original) {
  object(original,['filename','bytes','sha256','contentBase64']);
  need(typeof original.filename==='string'&&original.filename.length>0&&original.filename.length<=240
    &&!/[\x00-\x1f/\\]/.test(original.filename)&&Number.isSafeInteger(original.bytes)
    &&original.bytes>0&&original.bytes<=INBOX_MAX_BYTES&&typeof original.contentBase64==='string'
    &&original.contentBase64.length<=Math.ceil(INBOX_MAX_BYTES/3)*4,
  'CUSTOMER_USE_RETURN_ORIGINAL_INVALID','Retain the complete original Inbox handoff within its existing limit.');
  hash(original.sha256);
  const raw=Buffer.from(original.contentBase64,'base64');
  need(raw.toString('base64')===original.contentBase64&&raw.length===original.bytes&&digest(raw)===original.sha256,
    'CUSTOMER_USE_RETURN_ORIGINAL_CHANGED','The original Inbox handoff bytes differ.',409);
  return raw;
}
export function inspectCustomerUseReturn(raw) {
  need(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=CUSTOMER_USE_RETURN_MAX_BYTES,
    'CUSTOMER_USE_RETURN_SIZE','Choose a complete customer-use return within 16 MiB.',413);
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw customerUseError('CUSTOMER_USE_RETURN_JSON','Retain complete UTF-8 customer-use return JSON.');}
  object(value,['schema','customerUse','original']);
  need(value.schema===CUSTOMER_USE_RETURN_SCHEMA,'CUSTOMER_USE_RETURN_SCHEMA','Choose the supported customer-use return.');
  const original=decodeOriginal(value.original),native=inspectHandoff(original);
  const customerUse=context(value.customerUse,native.rows);
  return {...native,schema:CUSTOMER_USE_RETURN_SCHEMA,
    source:{...native.source,sha256:digest(raw),bytes:raw.length},
    buyerSource:{...copy(native.source),filename:value.original.filename,schema:native.schema},
    customerUse,
    reader:{...native.reader,customerUse:'ORIGINAL_SAVED_INSTALLATION_AND_COMMISSION',
      transferVerification:native.reader.transferVerification},
    interpretation:native.interpretation+' The customer-use binding is a saved plan attribution. It does not change native financial evidence or create an additional payment for allowance use or reopening.'};
}
export function createCustomerUseReturn({raw:original,filename='original-buyer-handoff.json',customerUse}) {
  need(Buffer.isBuffer(original),'CUSTOMER_USE_RETURN_ORIGINAL_INVALID','Keep the original capture bytes.');
  const native=inspectHandoff(original);
  const packet={schema:CUSTOMER_USE_RETURN_SCHEMA,customerUse:context(customerUse,native.rows),
    original:{filename,bytes:original.length,sha256:digest(original),contentBase64:original.toString('base64')}};
  const raw=Buffer.from(JSON.stringify(packet,null,2)+'\n');
  const report=inspectCustomerUseReturn(raw);
  return {packet,raw,report};
}
const escape = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function renderCustomerUseReturn(report) {
  need(report?.schema===CUSTOMER_USE_RETURN_SCHEMA,'CUSTOMER_USE_RETURN_SCHEMA','Render the inspected original return.');
  const rows=report.customerUse.bindings.map(binding=>'<tr>'+[
    binding.entry.installationId+' / '+binding.entry.revision,binding.entry.entryId,binding.use.date,
    binding.use.mode+' / '+binding.use.state,binding.use.buyerDeploymentId,binding.use.taskId,
    binding.use.fundingIds.join(', '),binding.requests.map(row=>row.intentId).join(', '),
  ].map(value=>'<td>'+escape(value)+'</td>').join('')+'</tr>').join('');
  const body='<h2>Saved customer-use selection</h2><p>Case '+escape(report.customerUse.source.caseId)
    +'; commission '+escape(report.customerUse.commission.id)+' edition '+report.customerUse.commission.revision
    +'. The original receiver verifies each historical Installation edition before association.</p><p>Calendar SHA-256 <code>'
    +escape(report.customerUse.source.calendarSha256)+'</code>; original Inbox handoff <code>'
    +escape(report.buyerSource.sha256)+'</code>.</p><section><table><thead><tr>'
    +['Installation / edition','Dated use','Planned date','Mode / state','Buyer','Useful task','Funding groups','Original intents']
      .map(value=>'<th>'+value+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></section>';
  return renderHandoff(report).replace('</main>',body+'</main>');
}
