// MIT. Portable research edition from one original retained managed Pipelines output.
import { createHash } from 'node:crypto';
import { need, object, parseJson, jsonBytes } from '../../node/store.mjs';

export const PIPELINE_EDITION_MODE = 'ORIGINAL_UNSTRUCTURED_PIPELINES_OUTPUT';
export const PIPELINE_EDITION_SCHEMA = 'stellar-forge.unstructured-pipelines-edition.v1';
export const MAX_PIPELINE_EDITION_BYTES = 64 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const HEX = /^[a-f0-9]{64}$/;
const origin = 'https://docs.unstructured.io/api-reference/workflow/overview';
const terms = 'Original input and output rights and the configured Unstructured account terms apply.';
function text(value, code, maximum = 4096, empty = false) {
  need(typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maximum &&
    (empty || value.trim().length > 0) && !/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), code);
  return value;
}
function identifier(value, code) { text(value, code, 512); need(!/[\0-\x1f\x7f]/.test(value), code); return value; }
function hash(value, code) { need(typeof value === 'string' && HEX.test(value), code); return value; }
function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : object(value) ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
function record(value, keys, code) {
  need(object(value) && Object.keys(value).every(key => keys.includes(key)), code);
  return value;
}
function encodedBytes(value) {
  record(value, ['encoding','bytes','sha256','body'], 'PIPELINE_EDITION_PAYLOAD_INVALID');
  need(value.encoding === 'base64' && Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
    value.bytes <= MAX_PIPELINE_EDITION_BYTES && typeof value.body === 'string' &&
    value.body.length <= Math.ceil(MAX_PIPELINE_EDITION_BYTES / 3) * 4,
  'PIPELINE_EDITION_PAYLOAD_INVALID');
  hash(value.sha256, 'PIPELINE_EDITION_OUTPUT_DIGEST_INVALID');
  const body = Buffer.from(value.body, 'base64');
  need(body.length === value.bytes && body.toString('base64') === value.body &&
    sha(body) === value.sha256, 'PIPELINE_EDITION_OUTPUT_CHANGED');
  return body;
}
function checkedOriginal(value) {
  record(value, ['schema','binding','inputs','output','payload'], 'PIPELINE_EDITION_ORIGINAL_INVALID');
  need(value.schema === PIPELINE_EDITION_SCHEMA, 'PIPELINE_EDITION_SCHEMA_INVALID');
  const binding = record(value.binding, ['workspaceId','account','apiUrl','configSha256',
    'operationId','planSha256','requestId','profileId','profileLabel','profileSha256',
    'providerJobId','providerStatus','workflowId'], 'PIPELINE_EDITION_BINDING_INVALID');
  text(binding.workspaceId, 'PIPELINE_WORKSPACE_ID_REQUIRED', 128);
  text(binding.account, 'PIPELINE_ACCOUNT_REQUIRED', 512);
  const api = new URL(binding.apiUrl);
  need(api.protocol === 'https:' && !api.username && !api.password && !api.search && !api.hash,
    'PIPELINE_EDITION_API_ORIGIN_INVALID');
  hash(binding.configSha256, 'PIPELINE_CONFIGURATION_DIGEST_INVALID');
  need(/^up_[a-f0-9]{64}$/.test(binding.operationId ?? ''), 'PIPELINE_OPERATION_ID_INVALID');
  hash(binding.planSha256, 'PIPELINE_PLAN_DIGEST_INVALID');
  text(binding.requestId, 'PIPELINE_REQUEST_ID_REQUIRED', 256);
  text(binding.profileId, 'PIPELINE_PROFILE_REQUIRED', 128);
  text(binding.profileLabel, 'PIPELINE_PROFILE_LABEL_REQUIRED', 240);
  hash(binding.profileSha256, 'PIPELINE_PROFILE_DIGEST_INVALID');
  identifier(binding.providerJobId, 'PIPELINE_PROVIDER_JOB_REQUIRED');
  text(binding.providerStatus, 'PIPELINE_PROVIDER_STATUS_REQUIRED', 128);
  if (binding.workflowId !== null) identifier(binding.workflowId, 'PIPELINE_WORKFLOW_ID_INVALID');
  need(Array.isArray(value.inputs) && value.inputs.length > 0 && value.inputs.length <= 1024,
    'PIPELINE_EDITION_INPUTS_REQUIRED');
  const ids = new Set();
  for (const input of value.inputs) {
    record(input, ['id','index','filename','contentType','bytes','sha256'], 'PIPELINE_EDITION_INPUT_INVALID');
    need(/^in_[a-f0-9]{64}$/.test(input.id ?? '') && !ids.has(input.id) &&
      Number.isSafeInteger(input.index) && input.index >= 0 && input.index <= 1024 &&
      Number.isSafeInteger(input.bytes) && input.bytes >= 0,
    'PIPELINE_EDITION_INPUT_INVALID');
    ids.add(input.id);
    text(input.filename, 'PIPELINE_INPUT_FILENAME_REQUIRED', 1024);
    text(input.contentType, 'PIPELINE_INPUT_TYPE_REQUIRED', 256);
    hash(input.sha256, 'PIPELINE_INPUT_DIGEST_INVALID');
  }
  const output = record(value.output, ['id','fileId','nodeId','bytes','sha256',
    'contentType','receivedAt','receiptId'], 'PIPELINE_EDITION_OUTPUT_INVALID');
  need(/^out_[a-f0-9]{64}$/.test(output.id ?? '') &&
    Number.isSafeInteger(output.bytes) && output.bytes >= 0, 'PIPELINE_EDITION_OUTPUT_INVALID');
  identifier(output.fileId, 'PIPELINE_FILE_ID_REQUIRED');
  if (output.nodeId !== null) identifier(output.nodeId, 'PIPELINE_NODE_ID_INVALID');
  hash(output.sha256, 'PIPELINE_OUTPUT_DIGEST_INVALID');
  text(output.contentType, 'PIPELINE_OUTPUT_TYPE_REQUIRED', 256);
  need(typeof output.receivedAt === 'string' && Number.isFinite(Date.parse(output.receivedAt)),
    'PIPELINE_OUTPUT_CAPTURE_TIME_REQUIRED');
  text(output.receiptId, 'PIPELINE_OUTPUT_RECEIPT_REQUIRED', 512);
  const bytes = encodedBytes(value.payload);
  need(bytes.length === output.bytes && sha(bytes) === output.sha256, 'PIPELINE_EDITION_OUTPUT_CHANGED');
  return bytes;
}
function content(bytes, contentType) {
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal:true }).decode(bytes); }
  catch { return {format:'binary',rows:[],text:null}; }
  const json = /(?:^|[/+])json(?:;|$)/i.test(contentType) || /^\s*[\[{]/.test(decoded);
  if (json) {
    try {
      const value = JSON.parse(decoded);
      const rows = Array.isArray(value) ? value : object(value) && Array.isArray(value.elements) ?
        value.elements : [value];
      return {format:'json',rows,text:decoded};
    } catch {
      return {format:'text',rows:[decoded],text:decoded};
    }
  }
  return {format:'text',rows:[decoded],text:decoded};
}
function projected(original, bytes) {
  const data = content(bytes, original.output.contentType), binding = original.binding;
  const results = data.rows.map((row,index) => {
    const structured = object(row), metadata = structured && object(row.metadata) ? copy(row.metadata) : {};
    const elementId = structured && typeof row.element_id === 'string' ? row.element_id : String(index + 1);
    const type = structured && typeof row.type === 'string' ? row.type : data.format === 'json' ? 'Record' : 'Text';
    const filename = typeof metadata.filename === 'string' && metadata.filename.trim() ?
      metadata.filename : original.output.fileId;
    const page = metadata.page_number ?? null;
    const body = structured && typeof row.text === 'string' ? row.text :
      typeof row === 'string' ? row : object(row) ? copy(row) : JSON.stringify(row);
    return {
      id: [binding.providerJobId,original.output.nodeId ?? 'default',original.output.fileId,
        elementId,String(index+1)].map(encodeURIComponent).join(':'),
      title: filename + (page === null ? '' : ' · page ' + String(page)) + ' · ' + type,
      content: body,
      metadata: {...metadata, pipeline:{providerJobId:binding.providerJobId,
        operationId:binding.operationId,profileId:binding.profileId,profileSha256:binding.profileSha256,
        fileId:original.output.fileId,nodeId:original.output.nodeId,outputSha256:original.output.sha256,
        position:index+1,elementId,type}},
    };
  });
  if (data.format === 'binary') results.push({
    id:[binding.providerJobId,original.output.nodeId??'default',original.output.fileId].map(encodeURIComponent).join(':'),
    title:original.output.fileId + ' · binary output', content:'',
    metadata:{pipeline:{providerJobId:binding.providerJobId,operationId:binding.operationId,
      fileId:original.output.fileId,nodeId:original.output.nodeId,outputSha256:original.output.sha256,
      contentType:original.output.contentType,bytes:original.output.bytes,format:'binary'}},
  });
  return {
    schema:'sf88-research-results-v1', provider:'unstructured-pipelines',
    success:true, status:binding.providerStatus === 'COMPLETED' ? 'AVAILABLE' : 'PARTIAL',
    query:binding.profileLabel, sourceTerms:terms, results,
    usage:{providerJobId:binding.providerJobId,providerStatus:binding.providerStatus,
      inputCount:original.inputs.length,outputBytes:original.output.bytes,
      outputFormat:data.format,elementCount:results.length},
    warnings:binding.providerStatus === 'COMPLETED' ? [] :
      ['This retained output was available while the provider job reported ' + binding.providerStatus + '.'],
    originalPipelineOutput:copy(original),
  };
}

/** Project the inspected retained output; its private original request and API key stay with the job owner. */
export function createPipelineResearchEdition({view,output,body,workspaceId}={}) {
  need(object(view?.plan?.payload) && object(view.operation) && object(output) &&
    body instanceof Uint8Array, 'PIPELINE_ORIGINAL_OUTPUT_REQUIRED');
  const payload=view.plan.payload, source=payload.source, profile=payload.profile;
  need(object(source) && object(profile) && Array.isArray(payload.inputs) &&
    view.operation.providerJobId, 'PIPELINE_ORIGINAL_JOB_REQUIRED');
  const details=view.operation.details ?? view.operation.job ?? {};
  const original = {
    schema:PIPELINE_EDITION_SCHEMA,
    binding:{
      workspaceId, account:source.account, apiUrl:source.apiUrl, configSha256:source.configSha256,
      operationId:view.plan.id,planSha256:view.plan.sha256,requestId:payload.request.requestId,
      profileId:profile.id,profileLabel:profile.label,profileSha256:profile.sha256,
      providerJobId:view.operation.providerJobId,
      providerStatus:String(details.status ?? view.operation.job?.status ?? view.operation.phase),
      workflowId:details.workflow_id ?? view.operation.job?.workflow_id ?? null,
    },
    inputs:payload.inputs.map(input=>Object.fromEntries(
      ['id','index','filename','contentType','bytes','sha256'].map(key=>[key,input[key]]))),
    output:Object.fromEntries(['id','fileId','nodeId','bytes','sha256','contentType','receivedAt','receiptId']
      .map(key=>[key,key==='nodeId' ? output[key]??null : output[key]])),
    payload:{encoding:'base64',bytes:body.length,sha256:sha(body),body:Buffer.from(body).toString('base64')},
  };
  const checked=checkedOriginal(original), value=projected(original,checked), bytes=jsonBytes(value);
  need(bytes.length<=MAX_PIPELINE_EDITION_BYTES,'PIPELINE_RESEARCH_EDITION_TOO_LARGE');
  return {value,bytes,sha256:sha(bytes)};
}

/** Open the retained original bytes and regenerate the visible projection on portable reopen. */
export function verifyPipelineResearchEdition(input) {
  const bytes=Buffer.from(input);
  need(bytes.length>0&&bytes.length<=MAX_PIPELINE_EDITION_BYTES,'PIPELINE_RESEARCH_EDITION_TOO_LARGE');
  const value=parseJson(bytes), original=value.originalPipelineOutput;
  const output=checkedOriginal(original), rebuilt=projected(original,output);
  need(same(value,rebuilt),'PIPELINE_RESEARCH_EDITION_CHANGED');
  return {value,bytes,sha256:sha(bytes),body:output,
    binding:copy(original.binding),inputs:copy(original.inputs),output:copy(original.output),
    items:copy(rebuilt.results),format:rebuilt.usage.outputFormat};
}

export function pipelineResearchOrigin(checked) {
  return {mode:PIPELINE_EDITION_MODE,workspaceId:checked.binding.workspaceId,
    operationId:checked.binding.operationId,providerJobId:checked.binding.providerJobId,
    profileId:checked.binding.profileId,outputId:checked.output.id,fileId:checked.output.fileId,
    nodeId:checked.output.nodeId,outputSha256:checked.output.sha256,editionSha256:checked.sha256};
}
export const PIPELINE_SOURCE_REFERENCE = origin;
