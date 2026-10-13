// MIT. Pure original profile archive validation shared by receiving and offline clients.
import { validateWorldBankCustomerRecord } from './worldbank-customer-records.mjs';
import { validateOpenApiCustomerRecord } from './openapi-customer-records.mjs';
import { validateGrpcCustomerRecord } from './grpc-customer-records.mjs';
import { validateHostComposition } from '../host-profile.mjs';
import { canonical, digest, fail,
  plainConsoleRecord as plain, consoleIdentifier as id, consoleRecordTitle as title, consoleRevision as revision, consoleSha256 as sha } from './records.mjs';
import { validateWorkflowRows } from './workflow-records.mjs';
import { validateWorkflowRecipeRows } from './workflow-recipes.mjs';
import { validateSeriesRows } from './workflow-series-records.mjs';

export const ARCHIVE_SCHEMA = 'stellar-forge.merchant-operator-profile.v1';
export const HOST_BINDING_SCHEMA = 'stellar-forge.merchant-host-binding.v1';
const parse = value => JSON.parse(value);
const toolName = value => {
  if (typeof value !== 'string' || !/^[-A-Za-z0-9_.]{1,128}$/.test(value)) throw fail('CONSOLE_TOOL', 'Use the original native tool name.', 400);
  return value;
};
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw fail('CONSOLE_ARCHIVE', 'Retain the original UTC record timestamp.', 400);
  return value;
};
function objectText(text, label) {
  if (typeof text !== 'string') throw fail('CONSOLE_ARCHIVE', label + ' must be retained JSON text.', 400);
  let value; try { value = parse(text); } catch { throw fail('CONSOLE_ARCHIVE', label + ' is not valid JSON.', 400); }
  if (!plain(value)) throw fail('CONSOLE_ARCHIVE', label + ' must be a JSON object.', 400);
  return value;
}
export function validateConsoleArchive(packet) {
  if (!plain(packet) || packet.schema !== ARCHIVE_SCHEMA || !plain(packet.profile) ||
      !Array.isArray(packet.drafts) || !Array.isArray(packet.calls) || !Array.isArray(packet.deliveries) || packet.deliveries.length>1000 || packet.drafts.length > 10000 || packet.calls.length > 10000)
    throw fail('CONSOLE_ARCHIVE', 'Receive a complete original operator profile archive.', 400);
  const { contentSha256, ...body } = packet;
  if (digest(canonical(body)) !== sha(contentSha256)) throw fail('CONSOLE_ARCHIVE_CHANGED', 'The profile archive differs from its saved digest.', 400);
  const profile = packet.profile;
  id(packet.sourceWorkspaceId); id(profile.id); revision(profile.revision); title(profile.name); sha(profile.hostFingerprint);
  timestamp(profile.createdAt); timestamp(profile.updatedAt);
  if (!Array.isArray(profile.favorites) || profile.favorites.length > 200) throw fail('CONSOLE_ARCHIVE', 'Retain the saved native tool favorites.', 400);
  profile.favorites.forEach(toolName);
  if (!plain(profile.host) || profile.host.configurationFingerprint !== profile.hostFingerprint)
    throw fail('CONSOLE_ARCHIVE', 'The profile must retain its original host binding.', 400);
  try{validateHostComposition(profile.host.composition,digest);}catch(error){throw fail('CONSOLE_ARCHIVE',error.message,400);}
  const bindings=packet.bindings??[],bindingKeys=new Map();
  if(!Array.isArray(bindings)||bindings.length>10000)throw fail('CONSOLE_ARCHIVE','Receive the complete retained host-binding history.',400);
  for(const binding of bindings) {
    if(!plain(binding)||binding.schema!==HOST_BINDING_SCHEMA||binding.profileId!==profile.id||
        !plain(binding.host)||binding.host.configurationFingerprint!==binding.hostFingerprint||
        !['PROFILE_CREATED','PROFILE_BOUND','LEGACY_PROFILE'].includes(binding.origin))
      throw fail('CONSOLE_ARCHIVE','Retain each original host-binding identity.',400);
    id(binding.workspaceId);revision(binding.revision);timestamp(binding.recordedAt);sha(binding.hostFingerprint);
    if(bindingKeys.has(binding.revision)||binding.revision>profile.revision)
      throw fail('CONSOLE_ARCHIVE','Receive unique host bindings within their original profile revisions.',400);
    const {bindingSha256,...original}=binding;
    if(digest(canonical(original))!==sha(bindingSha256))throw fail('CONSOLE_ARCHIVE_CHANGED','A retained host binding changed.',400);
    try{validateHostComposition(binding.host.composition,digest);}catch(error){throw fail('CONSOLE_ARCHIVE',error.message,400);}
    bindingKeys.set(binding.revision,binding);
  }
  if(bindings.length) {
    const active=bindingKeys.get(revision(profile.bindingRevision));
    if(!active||active.hostFingerprint!==profile.hostFingerprint||canonical(active.host)!==canonical(profile.host))
      throw fail('CONSOLE_ARCHIVE_CHANGED','The current profile must retain its selected original host binding.',400);
  } else if(profile.bindingRevision!==undefined)
    throw fail('CONSOLE_ARCHIVE','Include the current profile’s retained host-binding history.',400);
  const draftKeys = new Map(), callKeys = new Set(), deliveryKeys = new Set();
  for (const draft of packet.drafts) {
    if (!plain(draft)) throw fail('CONSOLE_ARCHIVE', 'Receive original draft objects.', 400);
    id(draft.id); revision(draft.revision); title(draft.name); toolName(draft.tool); timestamp(draft.createdAt); timestamp(draft.updatedAt);
    if (draft.recoveryOf !== undefined) id(draft.recoveryOf);
    if (draft.profileId !== profile.id || draftKeys.has(draft.id + ':' + draft.revision))
      throw fail('CONSOLE_ARCHIVE', 'Receive unique original draft revisions.', 400);
    draftKeys.set(draft.id + ':' + draft.revision, draft);
    objectText(draft.argumentsJson, 'Draft arguments');
    if (digest(draft.argumentsJson) !== sha(draft.argumentsSha256)) throw fail('CONSOLE_ARCHIVE_CHANGED', 'Draft arguments changed.', 400);
    sha(draft.toolSchemaSha256);
  }
  for (const call of packet.calls) {
    if (!plain(call)) throw fail('CONSOLE_ARCHIVE', 'Receive original call objects.', 400);
    id(call.id); id(call.workspaceId); toolName(call.tool); timestamp(call.startedAt); sha(call.hostFingerprint);
    if (call.completedAt !== null) timestamp(call.completedAt);
    if ((call.state === 'RUNNING') !== (call.completedAt === null) || (call.state === 'FAILED' ? !plain(call.error) || typeof call.error.code !== 'string' || typeof call.error.message !== 'string' : call.error !== null))
      throw fail('CONSOLE_ARCHIVE', 'Retain the original call completion and error state.', 400);
    if (call.profileId !== profile.id || callKeys.has(call.id) ||
        !['RUNNING','COMPLETE','FAILED'].includes(call.state) || !draftKeys.has(call.draftId + ':' + call.draftRevision))
      throw fail('CONSOLE_ARCHIVE', 'Receive unique calls with their original draft revision.', 400);
    const originalDraft = draftKeys.get(call.draftId + ':' + call.draftRevision);
    if (['tool','toolSchemaSha256','argumentsJson','argumentsSha256'].some(key => call[key] !== originalDraft[key]))
      throw fail('CONSOLE_ARCHIVE_CHANGED', 'The call must retain its exact saved native draft.', 400);
    callKeys.add(call.id); objectText(call.argumentsJson, 'Call arguments');
    if (digest(call.argumentsJson) !== sha(call.argumentsSha256)) throw fail('CONSOLE_ARCHIVE_CHANGED', 'Call arguments changed.', 400);
    const request = Object.fromEntries(['id','profileId','draftId','draftRevision','tool','toolSchemaSha256','argumentsJson','argumentsSha256','hostFingerprint'].map(key => [key,call[key]]));
    if (digest(canonical(request)) !== sha(call.requestSha256)) throw fail('CONSOLE_ARCHIVE_CHANGED', 'The original call changed.', 400);
    if (call.state === 'COMPLETE') {
      try { parse(call.resultJson); } catch { throw fail('CONSOLE_ARCHIVE', 'Receive the full original result JSON.', 400); }
      if (typeof call.resultJson !== 'string' || digest(call.resultJson) !== sha(call.resultSha256))
        throw fail('CONSOLE_ARCHIVE_CHANGED', 'The returned native result changed.', 400);
    } else if (call.resultJson !== null || call.resultSha256 !== null) throw fail('CONSOLE_ARCHIVE', 'An unfinished call cannot carry a completed result.', 400);
  }
  for(const value of packet.deliveries){
    if (!plain(value)) throw fail('CONSOLE_ARCHIVE','Receive original customer records.',400);
    id(value.id); id(value.workspaceId); sha(value.identitySha256); timestamp(value.startedAt); timestamp(value.updatedAt);
    if (deliveryKeys.has(value.id) || !['DOWNLOADING','PAUSED','FAILED','COMPLETE'].includes(value.state)) throw fail('CONSOLE_ARCHIVE','Receive unique customer records with their original receiving state.',400);
    deliveryKeys.add(value.id);
    if(value.profileId!==profile.id||!plain(value.identity)||value.identity.profileId!==profile.id||!['core','opensearch','openapi','grant-reviewer','grpc','worldbank-programme'].includes(value.identity.family)||!value.identity.exportId||digest(canonical(value.identity))!==value.identitySha256)
      throw fail('CONSOLE_ARCHIVE_CHANGED','The retained customer selection changed.',400);
    id(value.identity.exportId); sha(value.identity.expectedManifestSha256); sha(value.identity.hostFingerprint);
    if(value.identity.family==='opensearch') id(value.identity.workspace);
    if(value.identity.family==='openapi') validateOpenApiCustomerRecord(value);
    if(value.identity.family==='grpc') validateGrpcCustomerRecord(value);
    if(value.identity.family==='worldbank-programme') validateWorldBankCustomerRecord(value);
    if(value.identity.family==='grant-reviewer'){
      if(typeof value.identity.workspace!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.identity.workspace))
        throw fail('CONSOLE_ARCHIVE','Retain the original reviewer workspace alias.',400);
      sha(value.identity.exportId);
      if(value.state==='COMPLETE'&&(value.manifest?.schema!=='stellar-forge.grant-reviewer-merchant-export.v1'||
        value.manifest.workspace!==value.identity.workspace||value.manifest.exportId!==value.identity.exportId))
        throw fail('CONSOLE_ARCHIVE_CHANGED','The reviewer manifest belongs to a different original selection.',400);
    }
    if(value.state==='COMPLETE') {
      timestamp(value.completedAt);
      if(!Array.isArray(value.files) || !plain(value.manifest)) throw fail('CONSOLE_ARCHIVE','Retain the complete original customer manifest.',400);
      for(const file of value.files) if(!plain(file)||typeof file.name!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<0) throw fail('CONSOLE_ARCHIVE','Retain each original customer file identity.',400); else sha(file.sha256);
    }
  }
  const workflowData=validateWorkflowRows(packet.workflowData,{profile,drafts:packet.drafts,calls:packet.calls});
  const workflowRecipeData=validateWorkflowRecipeRows(packet.workflowRecipeData,{profile,drafts:packet.drafts,workflowData});
  const workflowSeriesData=validateSeriesRows(packet.workflowSeriesData,{profile,workflowData});
  return {profile,contentSha256,workflowData,workflowRecipeData,workflowSeriesData,bindings};
}

