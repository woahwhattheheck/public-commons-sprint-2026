// MIT. Reviewed native Huwise Automation ingestion inside the original workbench lock.
import { join, resolve, dirname } from 'node:path';
import { lstat, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, identity, fault, stamp, privateDirectory, readPrivate, readJson, createFile, atomicJson } from '../../postgres/publisher/files.mjs';
import { catalogOrigin, captureSelection, captureOpendatasoftDataset, readOpendatasoftCapture, ExactOpendatasoftNumber } from '../capture.mjs';
import { createOpendatasoftAutomationClient, validateOpendatasoftAutomationBody } from './client.mjs';
import { AUTOMATION_SOURCE, AUTOMATION_SCHEMAS } from './contract.mjs';

export const AUTOMATION_CONNECTION_SCHEMA = 'stellar-forge.opendatasoft-automation-connection.v1';
export const TENANT_PLAN_SCHEMA = 'stellar-forge.opendatasoft-tenant-plan.v1';
const UUID = /^[a-f0-9-]{36}$/, SHA = /^[a-f0-9]{64}$/, ALIAS = /^[a-z][a-z0-9_-]{0,63}$/;
const TYPES = {
  fields: { list:'list-dataset-field-configurations', create:'create-dataset-field-configurations', update:'update-dataset-field', get:'retrieve-dataset-field-configuration', param:'field_uid', schema:'DatasetFieldConfiguration' },
  processors: { list:'list-dataset-processors', create:'create-dataset-processor', update:'update-dataset-processor', get:'retrieve-dataset-processor', param:'processor_uid', schema:'DatasetProcessor' },
  users: { list:'list-dataset-user-security', create:'create-dataset-user-security', update:'update-dataset-user-security', get:'retrieve-dataset-user-security', param:'username', schema:'DatasetUserSecurity' },
  groups: { list:'list-dataset-group-security', create:'create-dataset-group-security', update:'update-dataset-group-security', get:'retrieve-dataset-group-security', param:'group_uid', schema:'DatasetGroupSecurity' },
  schedules: { list:'list-dataset-schedules', create:'create-dataset-schedule', update:'update-dataset-schedule', get:'retrieve-dataset-schedule', param:'schedule_uid', schema:'DatasetSchedule' },
};
const fail = (code, message, status = 400) => fault('ODS_TENANT_' + code, message, status);
const checkedId = value => { if (typeof value !== 'string' || !UUID.test(value)) throw fail('PLAN_REQUIRED','Choose an existing tenant plan.',404); return value; };
const line = (value, label, maximum = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    throw fail('VALUE_REQUIRED','Enter ' + label + '.');
  return value.trim();
};
function integer(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw fail('VALUE_REQUIRED','Use a nonnegative integer for ' + label + '.');
  return value;
}
function exact(value, allowed, required = []) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value,key)))
    throw fail('INPUT_INVALID','Use the documented tenant plan fields.');
  return value;
}
const clone = value => structuredClone(value);
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const entityId = (kind, value) => kind === 'users' ? value?.user?.username : kind === 'groups' ? value?.group?.uid : value?.uid;

/** Keep complete writable native schemas, including custom metadata and processor parameters. */
export function automationWritable(value, schemaName) {
  function visit(item, schema = {}) {
    if (schema.$ref) schema = { ...AUTOMATION_SCHEMAS[schema.$ref.split('/').at(-1)], ...schema, $ref:undefined };
    if (Array.isArray(item)) return item.map(child => visit(child,schema.items ?? {}));
    if (!object(item)) return item;
    let properties = { ...(schema.properties ?? {}) };
    for (const part of schema.allOf ?? []) {
      const expanded = part.$ref ? AUTOMATION_SCHEMAS[part.$ref.split('/').at(-1)] : part;
      properties = { ...properties, ...(expanded?.properties ?? {}) };
    }
    if (schema.discriminator?.mapping?.[item[schema.discriminator.propertyName]]) {
      const selected = AUTOMATION_SCHEMAS[schema.discriminator.mapping[item[schema.discriminator.propertyName]].split('/').at(-1)];
      for (const part of selected?.allOf ?? []) properties = { ...properties, ...(part.properties ?? {}) };
    }
    const result = {};
    for (const [key, child] of Object.entries(item)) {
      const rule = properties[key] ?? {};
      if (rule.readOnly || key === 'remote_value' && Object.hasOwn(item,'value')) continue;
      result[key] = visit(child,rule);
    }
    return result;
  }
  return visit(value,AUTOMATION_SCHEMAS[schemaName]);
}
function datasetBody(value) {
  if (!object(value)) throw fail('DATASET_INVALID','Supply a complete reviewed native dataset configuration.');
  return automationWritable(Object.fromEntries(Object.entries(value).filter(([key]) =>
    ['dataset_id','is_restricted','metadata','default_security'].includes(key))),'Dataset');
}
function sourceValue(value) {
  if (value instanceof ExactOpendatasoftNumber) return { exactNumber:value.source };
  if (Array.isArray(value)) return value.map(sourceValue);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,sourceValue(value[key])]));
  return value;
}
function expectedBodyMatches(actual, wanted, schema) {
  const a = automationWritable(actual,schema);
  function contains(current, desired) {
    if (Array.isArray(desired)) return Array.isArray(current) && desired.length === current.length && desired.every((item,index) => contains(current[index],item));
    if (object(desired)) return object(current) && Object.entries(desired).every(([key,value]) => Object.hasOwn(current,key) && contains(current[key],value));
    return Object.is(current,desired);
  }
  return contains(a,wanted);
}
function configuration(snapshot) {
  if (snapshot.absent) return { absent:true, datasetId:snapshot.datasetId };
  return {
    dataset:datasetBody(snapshot.dataset),
    resources:snapshot.resources.map(value => ({ uid:value.uid, ...automationWritable(value,'Resource') })),
    ...Object.fromEntries(Object.entries(TYPES).map(([kind,type]) => [kind,snapshot[kind].map(value => ({ id:entityId(kind,value), ...automationWritable(value,type.schema) }))])),
    attachments:snapshot.attachments,
    alternativeExports:snapshot.alternativeExports,
  };
}
function planSummary(plan) {
  return { id:plan.id, state:plan.state, createdAt:plan.createdAt, updatedAt:plan.updatedAt, target:plan.target,
    source:plan.source, planSha256:plan.planSha256, inspection:plan.inspection, review:plan.review,
    datasetUid:plan.datasetUid ?? null, fileUid:plan.fileUid ?? null, resourceUid:plan.resourceUid ?? null,
    providerStatus:plan.providerStatus ?? null, receiving:plan.receiving ?? null, error:plan.error ?? null };
}
export async function readAutomationConnections(path) {
  if (!path) return { targets:{} };
  path = resolve(path);
  await privateDirectory(dirname(path));
  const config = await readJson(path,1048576);
  exact(config,['schema','targets'],['schema','targets']);
  if (config.schema !== AUTOMATION_CONNECTION_SCHEMA || !object(config.targets) || Object.keys(config.targets).length > 32)
    throw fail('CONNECTION_INVALID','Declare up to 32 named tenant connections in the private host file.');
  const targets = {};
  for (const [alias,entry] of Object.entries(config.targets)) {
    if (!ALIAS.test(alias)) throw fail('CONNECTION_INVALID','Use a short tenant alias.');
    exact(entry,['origin','authTokenEnv','label','timeoutMs','maxResponseBytes','maxUploadBytes'],['origin','authTokenEnv']);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(entry.authTokenEnv)) throw fail('CONNECTION_INVALID','Declare the tenant token environment variable name.');
    targets[alias] = {
      origin:catalogOrigin(entry.origin), authTokenEnv:entry.authTokenEnv, label:line(entry.label ?? alias,'a tenant label'),
      ...(entry.timeoutMs !== undefined ? { timeoutMs:integer(entry.timeoutMs,'timeout',300000) } : {}),
      ...(entry.maxResponseBytes !== undefined ? { maxResponseBytes:integer(entry.maxResponseBytes,'response size',1073741824) } : {}),
      ...(entry.maxUploadBytes !== undefined ? { maxUploadBytes:integer(entry.maxUploadBytes,'upload size',1073741824) } : {}),
    };
  }
  return { targets };
}

/** No second lock or worker: all mutations below are called by the original engine's launch(). */
export function createOpendatasoftAutomationWorkspace({ directory, connectionFile, environment = process.env, state, persist, selectedCapture, selectedEdition }) {
  const root = join(directory,'tenant-plans');
  const location = value => join(root,checkedId(value));
  async function save(plan) {
    plan.updatedAt = stamp();
    await atomicJson(location(plan.id),'plan.json',plan);
    state.tenantPlans ??= [];
    const summary = planSummary(plan), index = state.tenantPlans.findIndex(item => item.id === plan.id);
    if (index < 0) state.tenantPlans.push(summary); else state.tenantPlans[index] = summary;
    await persist();
  }
  async function read(value) {
    const plan = await readJson(join(location(value),'plan.json'),67108864);
    if (plan.schema !== TENANT_PLAN_SCHEMA || plan.id !== value) throw fail('PLAN_INVALID','The retained tenant plan has changed.');
    const spec = await readJson(join(location(value),'specification.json'),8388608);
    if (identity(spec) !== plan.planSha256) throw fail('PLAN_CHANGED','The retained plan specification has changed.');
    return plan;
  }
  async function specFor(plan) {
    const spec = await readJson(join(location(plan.id),'specification.json'),8388608);
    if (identity(spec) !== plan.planSha256) throw fail('PLAN_CHANGED','The retained plan specification has changed.');
    return spec;
  }
  async function binding(plan, requireToken = true) {
    const config = await readAutomationConnections(connectionFile), target = config.targets[plan.target.alias];
    if (plan.target.datasetUid && plan.datasetUid !== plan.target.datasetUid) throw fail('TARGET_CHANGED','The saved tenant dataset UID changed.');
    if (!target || target.origin !== plan.target.origin) throw fail('TARGET_CHANGED','Restore the original named tenant connection before continuing.');
    if (requireToken && !environment[target.authTokenEnv]) throw fail('TOKEN_UNAVAILABLE','The selected tenant connection is not available on this host.');
    return target;
  }
  async function clientFor(plan) {
    const { label:_label,...target } = await binding(plan);
    return createOpendatasoftAutomationClient({ ...target,env:environment });
  }
  async function retainCall(plan, operationId, input, { signal, step, follow } = {}) {
    const client = await clientFor(plan), callId = randomUUID(), dir = join(location(plan.id),'journal',callId);
    await privateDirectory(dir,true);
    let requestSaved = false, responseSaved = false;
    const options = {
      signal,
      async onRequest(request) {
        await createFile(join(dir,'request.json'),bytes(request)); requestSaved = true;
        if (step) {
          step.callId = callId; step.state = 'DISPATCH_PENDING'; step.operationId = operationId; step.request = request;
          await save(plan);
        }
      },
      async onResponse(response) {
        await createFile(join(dir,'response.bin'),response.raw);
        await createFile(join(dir,'receipt.json'),bytes(response.receipt));
        responseSaved = true;
        if (step) {
          step.receipt = response.receipt;
          step.state = response.receipt.complete && response.receipt.outcome === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : response.receipt.outcome;
          await save(plan);
        }
      },
    };
    try {
      const response = follow ? await client.followPage(follow,{ expectedOperationId:operationId,params:input.params ?? {},query:input.query ?? {} },options)
        : await client.invoke(operationId,input,options);
      if (!requestSaved || !responseSaved) throw fail('JOURNAL_INCOMPLETE','The native call did not retain both original request and response.');
      return { ...response, callId };
    } catch (error) {
      if (!responseSaved && error.response?.raw && error.response.receipt) {
        await createFile(join(dir,'response.bin'),error.response.raw);
        await createFile(join(dir,'receipt.json'),bytes(error.response.receipt));
        responseSaved = true;
      }
      await createFile(join(dir,'error.json'),bytes({ code:error.code ?? 'NATIVE_CALL_FAILED',outcome:error.outcome ?? 'UNKNOWN',
        message:error.code ? error.message : 'The native call did not return completely.',request:error.request ?? null,receipt:error.receipt ?? null,at:stamp() }));
      if (step) {
        step.state = error.outcome === 'REJECTED' ? 'REJECTED' : requestSaved ? 'UNCERTAIN' : 'NOT_DISPATCHED';
        step.error = { code:error.code ?? 'NATIVE_CALL_FAILED',message:error.code ? error.message : 'Read the retained native result.' };
        plan.state = step.state === 'UNCERTAIN' ? 'RECOVERY_REQUIRED' : 'FAILED'; plan.error = step.error; await save(plan);
      }
      throw error;
    } finally { await client.close(); }
  }
  async function list(plan, operationId, params = {}, query = {}, signal) {
    const all = [], seen = new Set(); let next = null, pages = 0;
    do {
      const received = await retainCall(plan,operationId,{ params,query },{ signal,follow:next });
      const value = received.value, rows = Array.isArray(value) ? value : value?.results;
      if (!Array.isArray(rows)) throw fail('PAGE_INVALID','The native collection response did not contain its documented complete results.');
      all.push(...rows); pages++;
      const candidate = Array.isArray(value) ? null : value.next ?? value.links?.find?.(item => item.rel === 'next')?.href ?? null;
      if (candidate && typeof candidate !== 'string') throw fail('PAGE_INVALID','The native next-page link is not a URL.');
      if (candidate && seen.has(candidate)) throw fail('PAGE_LOOP','The provider repeated a collection page.');
      if (candidate) seen.add(candidate);
      next = candidate;
      if (!next && Number.isSafeInteger(value?.count) && value.count !== all.length)
        throw fail('PAGE_INCOMPLETE','The provider collection ended before its declared count.');
      if (all.length > 100000 || pages > 10000) throw fail('COLLECTION_LIMIT','The native configuration exceeds this workbench collection capacity.');
    } while (next);
    return all;
  }
  async function snapshot(plan, signal) {
    if (!plan.datasetUid) {
      const candidates = await list(plan,'list-datasets',{}, { dataset_id:plan.target.datasetId },signal);
      const exactMatches = candidates.filter(value => value.dataset_id === plan.target.datasetId);
      if (exactMatches.length) throw fail('TARGET_EXISTS','This dataset ID already exists. Select its actual dataset UID in a new plan.');
      return { absent:true,datasetId:plan.target.datasetId,observedAt:stamp() };
    }
    const params = { dataset_uid:plan.datasetUid };
    const before = (await retainCall(plan,'retrieve-dataset',{ params },{ signal })).value;
    if (before.uid !== plan.datasetUid || before.dataset_id !== plan.target.datasetId)
      throw fail('TARGET_CHANGED','The actual tenant dataset differs from the reviewed target.');
    const result = { dataset:before, datasetId:before.dataset_id, observedAt:stamp() };
    result.status = (await retainCall(plan,'get-dataset-status',{ params },{ signal })).value;
    result.metadata = (await retainCall(plan,'list-all-dataset-metadata',{ params },{ signal })).value;
    result.resources = await list(plan,'list-dataset-resources',params,{},signal);
    for (const [kind,type] of Object.entries(TYPES)) result[kind] = await list(plan,type.list,params,{},signal);
    result.attachments = await list(plan,'list-dataset-attachments',params,{},signal);
    result.alternativeExports = await list(plan,'list-dataset-alternative-exports',params,{},signal);
    const after = (await retainCall(plan,'retrieve-dataset',{ params },{ signal })).value;
    if (identity(datasetBody(before)) !== identity(datasetBody(after)) || before.updated_at !== after.updated_at)
      throw fail('REMOTE_EDITED','The tenant configuration changed while it was being read. Inspect the same plan again.');
    result.dataset = after;
    return result;
  }
  async function writeSnapshot(plan, label, value) {
    const name = label + '-' + randomUUID() + '.json';
    await createFile(join(location(plan.id),name),bytes(value));
    return { file:name,sha256:digest(bytes(value)),configurationSha256:identity(configuration(value)),at:stamp() };
  }
  async function readSnapshot(plan, descriptor) {
    const raw = await readPrivate(join(location(plan.id),descriptor.file),16777216);
    if (digest(raw) !== descriptor.sha256) throw fail('SNAPSHOT_CHANGED','The retained tenant configuration has changed.');
    return JSON.parse(raw.toString('utf8'));
  }
  async function originalSource(plan, spec) {
    const current = selectedEdition(plan.source.editionId), capture = await selectedCapture(plan.source.editionId);
    if (capture.manifestSha256 !== plan.source.captureSha256 || (current.notes?.revision ?? 0) !== plan.source.notesRevision)
      throw fail('SOURCE_CHANGED','Review a new plan for the changed source edition or notes.');
    const upload = await readPrivate(join(location(plan.id),'source','records.json'),spec.source.bytes);
    if (upload.length !== spec.source.bytes || digest(upload) !== spec.source.sha256)
      throw fail('UPLOAD_CHANGED','The complete retained upload no longer matches the reviewed source.');
    return capture;
  }
  function workflow(plan, spec, before) {
    const steps = [];
    const dataset = before.absent ? spec.dataset : {
      ...datasetBody(before.dataset), ...spec.dataset,
      metadata:{ ...datasetBody(before.dataset).metadata,...spec.dataset.metadata,
        default:{ ...datasetBody(before.dataset).metadata?.default,...spec.dataset.metadata.default } },
    };
    validateOpendatasoftAutomationBody(before.absent ? 'create-dataset':'update-dataset',dataset);
    steps.push({ key:'dataset',operationId:before.absent ? 'create-dataset':'update-dataset',schema:'Dataset',body:dataset,
      expected:before.absent ? null:datasetBody(before.dataset) });
    steps.push({ key:'upload',operationId:'upload-resource-file',upload:true });
    const priorResource = before.absent ? null:before.resources.find(item => item.uid === spec.resource.uid);
    if (spec.resource.uid && !priorResource) throw fail('RESOURCE_MISSING','The selected native resource UID was not present in the retained tenant configuration.');
    if (!before.absent && !spec.resource.uid && before.resources.length && spec.resourceMode !== 'append')
      throw fail('RESOURCE_SELECTION_REQUIRED','Choose the original resource UID, or explicitly select append for the reviewed additional resource.');
    const resource = { ...(priorResource ? automationWritable(priorResource,'Resource') : {}), ...spec.resource };
    delete resource.uid; delete resource.datasource;
    validateOpendatasoftAutomationBody(priorResource ? 'update-dataset-resource':'create-dataset-resource',{
      ...resource,datasource:{ type:'uploaded_file',file:{ uid:'reviewed-source-upload' } },
    });
    steps.push({ key:'resource',operationId:priorResource ? 'update-dataset-resource':'create-dataset-resource',schema:'Resource',
      params:priorResource ? { resource_uid:priorResource.uid } : {},body:resource,uid:priorResource?.uid,
      expected:priorResource ? automationWritable(priorResource,'Resource'):null,
      beforeIds:(before.resources ?? []).map(item => item.uid) });
    for (const [kind,type] of Object.entries(TYPES)) {
      const prior = before[kind] ?? [];
      for (let index = 0; index < spec.changes[kind].length; index++) {
        const change = spec.changes[kind][index], original = change.id ? prior.find(item => entityId(kind,item) === change.id) : null;
        if (change.id && !original) throw fail('CONFIGURATION_MISSING','The selected ' + kind + ' entry was not present in the retained configuration.');
        const body = original ? { ...automationWritable(original,type.schema),...change.body } : change.body;
        validateOpendatasoftAutomationBody(original ? type.update:type.create,body);
        steps.push({ key:kind + '-' + index,kind,operationId:original ? type.update:type.create,schema:type.schema,
          params:original ? { [type.param]:change.id }: {},body,uid:change.id ?? null,
          expected:original ? automationWritable(original,type.schema):null,beforeIds:prior.map(item => entityId(kind,item)) });
      }
    }
    if (spec.publish) steps.push({ key:'publish',operationId:'publish-dataset',action:true });
    return steps;
  }
  async function storedResponse(plan, step) {
    if (!step.callId) return null;
    const dir = join(location(plan.id),'journal',step.callId);
    if (!await exists(join(dir,'receipt.json')) || !await exists(join(dir,'response.bin'))) return null;
    const receipt = await readJson(join(dir,'receipt.json'),1048576), raw = await readPrivate(join(dir,'response.bin'),1073741824);
    if (digest(raw) !== receipt.sha256 || raw.length !== receipt.bytes) throw fail('RESPONSE_CHANGED','The retained original native response has changed.');
    if (!receipt.complete || receipt.outcome !== 'ACKNOWLEDGED') return null;
    return { value:JSON.parse(raw.toString('utf8')),receipt };
  }
  async function completeStep(plan, descriptor, step, value, recovery = null) {
    if (descriptor.key === 'dataset') {
      if (typeof value?.uid !== 'string' || value.dataset_id !== plan.target.datasetId)
        throw fail('DATASET_RESPONSE_INVALID','The native dataset response did not identify the reviewed target.');
      plan.datasetUid = value.uid;
    }
    if (descriptor.key === 'upload') {
      if (typeof value?.uid !== 'string') throw fail('UPLOAD_RESPONSE_INVALID','The native upload response did not contain an actual file UID.');
      plan.fileUid = value.uid;
    }
    if (descriptor.key === 'resource') {
      if (typeof value?.uid !== 'string') throw fail('RESOURCE_RESPONSE_INVALID','The native resource response did not contain an actual resource UID.');
      plan.resourceUid = value.uid;
    }
    step.state = 'COMPLETE'; step.completedAt = stamp(); step.actualId = value?.uid ?? null;
    if (recovery) step.recovery = recovery;
    await save(plan); return value;
  }
  async function runStep(plan, spec, descriptor, signal) {
    const step = plan.steps[descriptor.key] ??= { state:'READY',operationId:descriptor.operationId };
    if (step.state === 'COMPLETE') return;
    const retained = await storedResponse(plan,step);
    if (retained) return completeStep(plan,descriptor,step,retained.value,{ kind:'ORIGINAL_RESPONSE',receipt:retained.receipt });
    if (['UNCERTAIN','DISPATCH_PENDING','ACKNOWLEDGED'].includes(step.state))
      throw fail('RECOVERY_REQUIRED','Recover the original native operation before continuing.',409);
    if (step.state === 'REJECTED') throw fail('REJECTED','The native provider rejected this saved step. Correct its configuration in a new reviewed plan.',409);
    const params = { ...(plan.datasetUid ? { dataset_uid:plan.datasetUid } : {}),...(descriptor.params ?? {}) };
    let body = descriptor.body;
    if (descriptor.key === 'resource') body = { ...body,datasource:{ type:'uploaded_file',file:{ uid:plan.fileUid } } };
    if (descriptor.expected) {
      const operation = descriptor.key === 'dataset' ? 'retrieve-dataset' : descriptor.key === 'resource' ? 'retrieve-dataset-resource' : TYPES[descriptor.kind].get;
      const current = (await retainCall(plan,operation,{ params },{ signal })).value;
      if (identity(automationWritable(current,descriptor.schema)) !== identity(descriptor.expected))
        throw fail('REMOTE_EDITED','The selected native object changed after review. Inspect its current configuration before a new plan.',409);
    }
    const input = descriptor.upload ? { params,upload:{
      file:join(location(plan.id),'source','records.json'),filename:spec.source.filename,mimetype:'application/json',
      expectedSha256:spec.source.sha256,expectedBytes:spec.source.bytes,
    } } : { params,...(body ? { body }: {}) };
    step.desired = descriptor.key === 'resource' ? body : descriptor.body ?? null;
    const response = await retainCall(plan,descriptor.operationId,input,{ signal,step });
    return completeStep(plan,descriptor,step,response.value);
  }
  async function reconcileStep(plan, spec, descriptor, signal, input) {
    const step = plan.steps[descriptor.key];
    if (!step || step.state === 'COMPLETE' || ['READY','NOT_DISPATCHED'].includes(step.state)) return;
    const retained = await storedResponse(plan,step);
    if (retained) return completeStep(plan,descriptor,step,retained.value,{ kind:'ORIGINAL_RESPONSE',receipt:retained.receipt });
    if (step.state === 'REJECTED') return;
    let candidate, received;
    const params = plan.datasetUid ? { dataset_uid:plan.datasetUid } : {};
    if (descriptor.key === 'dataset') {
      const matches = plan.datasetUid
        ? [(await retainCall(plan,'retrieve-dataset',{ params },{ signal })).value]
        : (await list(plan,'list-datasets',{}, { dataset_id:plan.target.datasetId },signal)).filter(value => value.dataset_id === plan.target.datasetId);
      if (matches.length === 1 && expectedBodyMatches(matches[0],descriptor.body,'Dataset')) candidate = matches[0];
    } else if (descriptor.key === 'upload') {
      const fileUid = input.fileUid ?? plan.fileUid;
      if (fileUid) {
        received = await retainCall(plan,'retrieve-dataset-resource-file',{ params:{ ...params,file_uid:line(fileUid,'the actual native file UID') } },{ signal });
        const download = await retainCall(plan,'download-dataset-resource-file',{ params:{ ...params,file_uid:fileUid } },{ signal });
        if (download.raw.length !== spec.source.bytes || digest(download.raw) !== spec.source.sha256)
          throw fail('RECOVERY_FILE_DIFFERENT','The actual native file bytes differ from this plan source.');
        candidate = received.value;
      }
    } else if (descriptor.key === 'publish') {
      const current = (await retainCall(plan,'get-dataset-status',{ params },{ signal })).value;
      plan.providerStatus = current;
      // An idle old publication cannot establish whether a new publish POST ran.
      // Complete Explore receiving below can establish the reviewed result itself.
      step.recovery = { kind:'NATIVE_STATUS',at:stamp(),status:current };
      plan.state = 'RECEIVING_REQUIRED'; await save(plan); return;
    } else {
      const kind = descriptor.key === 'resource' ? null:descriptor.kind;
      const listOperation = kind ? TYPES[kind].list:'list-dataset-resources';
      const items = await list(plan,listOperation,params,{},signal);
      const desired = step.desired ?? descriptor.body;
      const actualId = input.stepIds?.[descriptor.key] ?? descriptor.uid;
      const matches = items.filter(value => (!actualId || (kind ? entityId(kind,value):value.uid) === actualId)
        && (actualId || !descriptor.beforeIds.includes(kind ? entityId(kind,value):value.uid))
        && expectedBodyMatches(value,desired,descriptor.schema));
      if (matches.length === 1) candidate = matches[0];
    }
    if (candidate) return completeStep(plan,descriptor,step,candidate,{ kind:'NATIVE_READBACK',at:stamp(),configurationSha256:identity(candidate) });
    plan.state = 'RECOVERY_REQUIRED';
    step.recovery = { kind:'UNRESOLVED_NATIVE_READBACK',at:stamp() }; await save(plan);
    throw fail('RECOVERY_REQUIRED',descriptor.key === 'upload'
      ? 'Supply the actual uploaded file UID; recovery will download and match every original source byte.'
      : 'The native readback has not identified this original operation. Retain the plan and inspect its request and response.',409);
  }
  function receivingComparison(capture, received, spec) {
    const criteria = spec.acceptance, sourceFields = capture.fields.map(field => field.id), receivedFields = new Set(received.fields.map(field => field.id));
    const fieldMap = Object.keys(criteria.fieldMap).length ? criteria.fieldMap : Object.fromEntries(sourceFields.map(field => [field,field]));
    const missingFields = Object.values(fieldMap).filter(field => !receivedFields.has(field));
    let missingRows = 0, differentRows = 0;
    if (criteria.mode === 'source-match' && !missingFields.length) {
      const counted = new Map();
      for (const row of received.rows) {
        const projected = Object.fromEntries(Object.entries(fieldMap).map(([source,target]) => [source,sourceValue(row[target])]));
        const hash = identity(projected); counted.set(hash,(counted.get(hash) ?? 0) + 1);
      }
      for (const row of capture.rows) {
        const projected = Object.fromEntries(Object.keys(fieldMap).map(field => [field,sourceValue(row[field])]));
        const hash = identity(projected), count = counted.get(hash) ?? 0;
        if (count) counted.set(hash,count - 1); else missingRows++;
      }
      differentRows = [...counted.values()].reduce((sum,count) => sum + count,0);
    }
    const rowCountMatched = received.rows.length === criteria.expectedRows;
    const success = rowCountMatched && !missingFields.length && (criteria.mode !== 'source-match' || !missingRows && (criteria.allowAdditionalRows || !differentRows));
    return { accepted:success,criteria,sourceRows:capture.rows.length,receivedRows:received.rows.length,rowCountMatched,
      missingFields,missingRows,differentRows,comparedFields:Object.keys(fieldMap).length,
      captureSha256:received.manifestSha256,at:stamp() };
  }
  const api = {
    async reconcile() {
      if (!await exists(root)) return;
      await privateDirectory(root);
      const saved = [];
      for (const entry of await readdir(root,{ withFileTypes:true })) {
        if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
        if (!await exists(join(root,entry.name,'plan.json'))) continue;
        const plan = await read(entry.name);
        saved.push(planSummary(plan));
      }
      saved.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
      const current = [...(state.tenantPlans ?? [])].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
      if (identity(current) !== identity(saved)) { state.tenantPlans = saved; await persist(); }
    },
    async targets() {
      const config = await readAutomationConnections(connectionFile);
      return Object.entries(config.targets).map(([alias,entry]) => ({ alias,label:entry.label,origin:entry.origin,available:Boolean(environment[entry.authTokenEnv]) }));
    },
    async datasets(alias,query = {},signal) {
      const config = await readAutomationConnections(connectionFile), target = config.targets[alias];
      if (!target) throw fail('TARGET_REQUIRED','Choose a named tenant connection.');
      if (!environment[target.authTokenEnv]) throw fail('TOKEN_UNAVAILABLE','The selected tenant connection is unavailable on this host.');
      exact(query,['dataset_id','offset','limit']);
      const { label:_label,...configured } = target;
      const client = createOpendatasoftAutomationClient({ ...configured,env:environment });
      try {
        const response = await client.listDatasets({ query:{ limit:20,...query } },{ signal });
        return { datasets:response.value.results,receipt:response.receipt,page:{
          next:response.value.next ?? null,total:response.value.total_count ?? null,
        } };
      } finally { await client.close(); }
    },
    async plan(value) {
      const plan = await read(value), spec = await specFor(plan);
      return { ...plan,specification:spec,
        ...(plan.inspection ? { remote:await readSnapshot(plan,plan.inspection) } : {}) };
    },
    async prepare(input) {
      exact(input,['editionId','captureSha256','notesRevision','target','dataset','resource','resourceMode','changes','publish','acceptance'],
        ['editionId','captureSha256','notesRevision','target','dataset','resource','publish']);
      const entry = selectedEdition(input.editionId), capture = await selectedCapture(input.editionId);
      if (!SHA.test(input.captureSha256 ?? '') || capture.manifestSha256 !== input.captureSha256 || (entry.notes?.revision ?? 0) !== input.notesRevision)
        throw fail('SOURCE_CHANGED','Use the inspected source capture SHA256 and current notes revision.');
      exact(input.target,['alias','datasetId','datasetUid'],['alias','datasetId']);
      const config = await readAutomationConnections(connectionFile), connection = config.targets[input.target.alias];
      if (!connection) throw fail('TARGET_REQUIRED','Choose a host-declared tenant connection.');
      const target = { alias:input.target.alias,origin:connection.origin,datasetId:line(input.target.datasetId,'the tenant dataset ID'),
        ...(input.target.datasetUid ? { datasetUid:line(input.target.datasetUid,'the actual dataset UID') }: {}) };
      const dataset = datasetBody(input.dataset);
      if (input.dataset.dataset_id && input.dataset.dataset_id !== target.datasetId) throw fail('TARGET_CHANGED','Use the same target dataset ID in the complete configuration.');
      dataset.dataset_id = target.datasetId;
      if (typeof dataset.is_restricted !== 'boolean') throw fail('VISIBILITY_REQUIRED','Choose the dataset visibility in the reviewed native configuration.');
      for (const name of ['title','modified','language'])
        if (!Object.hasOwn(dataset.metadata?.default?.[name] ?? {},'value')) throw fail('METADATA_REQUIRED','Supply the native title, modified date and language metadata values.');
      exact(input.resource,['uid','type','title','params'],['type','title']);
      const resource = clone(input.resource);
      line(resource.type,'the native extractor type'); line(resource.title,'the resource title');
      if (resource.uid) line(resource.uid,'the native resource UID');
      if (resource.params !== undefined && !object(resource.params)) throw fail('RESOURCE_INVALID','Use native extractor parameter fields.');
      if (input.resourceMode !== undefined && !['append','replace-selected'].includes(input.resourceMode)) throw fail('RESOURCE_INVALID','Choose append or replace-selected.');
      if (typeof input.publish !== 'boolean') throw fail('PUBLISH_REQUIRED','Choose whether to publish this reviewed configuration.');
      const changes = {};
      exact(input.changes ?? {},Object.keys(TYPES));
      for (const kind of Object.keys(TYPES)) {
        const values = input.changes?.[kind] ?? [], ids = new Set();
        if (!Array.isArray(values) || values.length > 1000) throw fail('CONFIGURATION_INVALID','Use at most 1000 reviewed changes per configuration collection.');
        changes[kind] = values.map(value => {
          exact(value,['id','body'],['body']);
          if (!object(value.body)) throw fail('CONFIGURATION_INVALID','Use complete native configuration objects.');
          if (value.id) {
            line(value.id,'the original configuration identifier');
            if (ids.has(value.id)) throw fail('CONFIGURATION_INVALID','Combine changes to one original configuration identifier.');
            ids.add(value.id);
          }
          return { ...(value.id ? { id:value.id }:{}),body:automationWritable(value.body,TYPES[kind].schema) };
        });
      }
      const acceptance = { mode:'source-match',expectedRows:capture.rows.length,fieldMap:{},allowAdditionalRows:false,...(input.acceptance ?? {}) };
      exact(acceptance,['mode','expectedRows','fieldMap','allowAdditionalRows'],['mode','expectedRows','fieldMap','allowAdditionalRows']);
      if (!['source-match','reviewed-output'].includes(acceptance.mode) || typeof acceptance.allowAdditionalRows !== 'boolean' || !object(acceptance.fieldMap))
        throw fail('ACCEPTANCE_INVALID','Use source-match or reviewed-output with explicit expected rows and field mappings.');
      integer(acceptance.expectedRows,'expected published row count',10000000);
      const sourceFields = new Set(capture.fields.map(field => field.id));
      for (const [from,to] of Object.entries(acceptance.fieldMap)) {
        if (!sourceFields.has(from)) throw fail('ACCEPTANCE_INVALID','A comparison field is absent from the retained source.');
        line(to,'the receiving field ID');
      }
      const raw = capture.rawFiles.get('records.json');
      if (!raw) throw fail('SOURCE_INVALID','The source edition is missing its complete original records export.');
      const source = { editionId:input.editionId,captureSha256:input.captureSha256,notesRevision:input.notesRevision,
        datasetId:capture.manifest.datasetId,rowCount:capture.rows.length,fieldCount:capture.fields.length,
        filename:target.datasetId.replace(/[^A-Za-z0-9_.-]/g,'_') + '.json',sha256:digest(raw),bytes:raw.length };
      const spec = { schema:TENANT_PLAN_SCHEMA,contract:AUTOMATION_SOURCE,target,source,dataset,resource,
        resourceMode:input.resourceMode ?? 'replace-selected',changes,publish:input.publish,acceptance };
      if (bytes(spec).length > 8388608) throw fail('PLAN_TOO_LARGE','The reviewed configuration exceeds eight MiB.');
      const plan = { schema:TENANT_PLAN_SCHEMA,id:randomUUID(),createdAt:stamp(),updatedAt:stamp(),state:'PREPARED',
        target,source,planSha256:identity(spec),datasetUid:target.datasetUid ?? null,
        inspection:null,review:null,steps:{},error:null };
      await privateDirectory(root,true); await privateDirectory(location(plan.id),true);
      await privateDirectory(join(location(plan.id),'source'),true); await privateDirectory(join(location(plan.id),'journal'),true);
      await createFile(join(location(plan.id),'specification.json'),bytes(spec));
      for (const [filename,content] of capture.rawFiles) await createFile(join(location(plan.id),'source',filename),content);
      await createFile(join(location(plan.id),'source','capture.json'),capture.manifestBytes);
      await createFile(join(location(plan.id),'source','edition-notes.json'),bytes(entry.notes ?? { revision:0,text:'',rowNotes:[] }));
      await save(plan); return planSummary(plan);
    },
    async inspect(value,signal) {
      const plan = await read(value), spec = await specFor(plan);
      if (Object.values(plan.steps).some(step => !['READY','NOT_DISPATCHED'].includes(step.state)))
        throw fail('PLAN_STARTED','Use recovery and status for a plan whose native application has started.');
      await originalSource(plan,spec);
      const before = await snapshot(plan,signal);
      plan.inspection = await writeSnapshot(plan,'before',before);
      plan.workflow = workflow(plan,spec,before); plan.review = null; plan.state = 'INSPECTED'; plan.error = null;
      await save(plan); return api.plan(value);
    },
    async review(value,input) {
      exact(input,['planSha256','configurationSha256','note'],['planSha256','configurationSha256']);
      const plan = await read(value), spec = await specFor(plan);
      if (!plan.inspection || !['INSPECTED','REVIEWED'].includes(plan.state)) throw fail('INSPECTION_REQUIRED','Inspect the actual tenant configuration before reviewing the plan.');
      if (input.planSha256 !== plan.planSha256 || input.configurationSha256 !== plan.inspection.configurationSha256)
        throw fail('REVIEW_CHANGED','Review the inspected source and tenant configuration hashes.');
      await originalSource(plan,spec);
      plan.review = { id:randomUUID(),planSha256:plan.planSha256,configurationSha256:plan.inspection.configurationSha256,
        at:stamp(),note:input.note ? line(input.note,'a review note',2048):'' };
      plan.state = 'REVIEWED'; await save(plan); return planSummary(plan);
    },
    async apply(value,input,signal,progress = () => {}) {
      exact(input,['reviewId'],['reviewId']);
      const plan = await read(value), spec = await specFor(plan);
      if (input.reviewId !== plan.review?.id || plan.review.planSha256 !== plan.planSha256) throw fail('REVIEW_REQUIRED','Use the saved review for this exact tenant plan.');
      await originalSource(plan,spec);
      if (plan.state === 'ACCEPTED' || plan.state === 'CONFIGURED' && !spec.publish) return planSummary(plan);
      if (!Object.values(plan.steps).some(step => step.state !== 'READY' && step.state !== 'NOT_DISPATCHED')) {
        const current = await snapshot(plan,signal);
        const currentHash = identity(configuration(current));
        await writeSnapshot(plan,'dispatch-before',current);
        if (currentHash !== plan.review.configurationSha256) throw fail('REMOTE_EDITED','The tenant changed after review. Inspect the same unstarted plan and review its actual configuration.',409);
      }
      plan.state = 'APPLYING'; plan.error = null; await save(plan);
      for (const descriptor of plan.workflow) {
        progress({ phase:descriptor.key,datasetUid:plan.datasetUid ?? null });
        await runStep(plan,spec,descriptor,signal);
      }
      plan.state = spec.publish ? 'PUBLICATION_REQUESTED':'CONFIGURED';
      if (plan.datasetUid) plan.providerStatus = (await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal })).value;
      await save(plan); return planSummary(plan);
    },
    async recover(value,input = {},signal,progress = () => {}) {
      exact(input,['fileUid','stepIds']);
      if (input.stepIds !== undefined && !object(input.stepIds)) throw fail('RECOVERY_INVALID','Use native identifiers keyed by the original step name.');
      const plan = await read(value), spec = await specFor(plan);
      if (!plan.review || !plan.workflow) throw fail('REVIEW_REQUIRED','This plan has not started a reviewed native operation.');
      await originalSource(plan,spec);
      for (const descriptor of plan.workflow) {
        progress({ phase:'recover ' + descriptor.key });
        await reconcileStep(plan,spec,descriptor,signal,input);
      }
      const incomplete = plan.workflow.some(descriptor => plan.steps[descriptor.key]?.state !== 'COMPLETE');
      if (plan.state !== 'RECEIVING_REQUIRED') plan.state = incomplete ? 'REVIEWED':spec.publish ? 'PUBLICATION_REQUESTED':'CONFIGURED';
      plan.error = null; await save(plan); return planSummary(plan);
    },
    async status(value,signal) {
      const plan = await read(value);
      if (!plan.datasetUid) return planSummary(plan);
      plan.providerStatus = (await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal })).value;
      await save(plan); return planSummary(plan);
    },
    async receive(value,input = {},signal,progress = () => {}) {
      exact(input,['maxRows','maxBytes']);
      const plan = await read(value), spec = await specFor(plan), capture = await originalSource(plan,spec);
      if (!plan.datasetUid || !plan.review) throw fail('DATASET_REQUIRED','Apply the reviewed native configuration before receiving its publication.');
      const unfinished = (plan.workflow ?? []).filter(step => step.key !== 'publish' && plan.steps[step.key]?.state !== 'COMPLETE');
      if (unfinished.length) throw fail('RECOVERY_REQUIRED','Recover the original configuration steps before receiving the publication.');
      const status = (await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal })).value;
      plan.providerStatus = status;
      if (status.status !== 'idle' || status.is_published !== true) {
        plan.state = 'PUBLICATION_PENDING'; await save(plan);
        return planSummary(plan);
      }
      const connection = await binding(plan), receivingId = randomUUID();
      const receivingRoot = join(location(plan.id),'receiving'); await privateDirectory(receivingRoot,true);
      const receivingDirectory = join(receivingRoot,receivingId);
      const selection = captureSelection({ catalogOrigin:connection.origin,datasetId:plan.target.datasetId,authTokenEnv:connection.authTokenEnv });
      plan.state = 'RECEIVING'; plan.receiving = { id:receivingId,state:'RECEIVING',startedAt:stamp() }; await save(plan);
      const received = await captureOpendatasoftDataset(selection,receivingDirectory,{
        env:environment,signal,onProgress:progress,maxRows:input.maxRows ?? Math.max(250000,spec.acceptance.expectedRows + 1),
        maxBytes:input.maxBytes ?? Math.max(268435456,spec.source.bytes * 4),
      });
      const afterStatus = (await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal })).value;
      if (afterStatus.status !== 'idle' || afterStatus.is_published !== true || status.since !== afterStatus.since)
        throw fail('PUBLICATION_CHANGED','The tenant publication changed while its complete receiving export was being read.');
      const acceptance = receivingComparison(capture,received,spec);
      if (Array.isArray(afterStatus.records_errors) && afterStatus.records_errors.length) acceptance.accepted = false;
      acceptance.recordErrors = afterStatus.records_errors ?? [];
      plan.receiving = { id:receivingId,state:acceptance.accepted ? 'ACCEPTED':'REVIEW_REQUIRED',captureSha256:received.manifestSha256,
        captureFile:join('receiving',receivingId,'capture.json'),acceptance,completedAt:stamp() };
      plan.providerStatus = afterStatus;
      const after = await snapshot(plan,signal); plan.after = await writeSnapshot(plan,'after',after);
      if (acceptance.accepted && plan.steps.publish?.state !== 'COMPLETE' && plan.steps.publish) {
        plan.steps.publish.state = 'COMPLETE'; plan.steps.publish.completedAt = stamp();
        plan.steps.publish.recovery = { kind:'COMPLETE_EXPLORE_RECEIVING',captureSha256:received.manifestSha256,at:stamp() };
      }
      plan.state = acceptance.accepted ? 'ACCEPTED':'RECEIVING_REVIEW_REQUIRED';
      await save(plan); return planSummary(plan);
    },
    async export(value) {
      const plan = await read(value), spec = await specFor(plan);
      await originalSource(plan,spec);
      const guide = [
        '# Huwise tenant ingestion', '',
        'Plan: ' + plan.id, 'Tenant: ' + plan.target.origin, 'Dataset: ' + plan.target.datasetId,
        'Source edition: ' + plan.source.editionId, 'Plan SHA256: ' + plan.planSha256, '',
        '## Receiving', '',
        'specification.json binds the complete original records.json bytes, reviewed dataset metadata, resource, field, processor, security and schedule configuration.',
        'plan.json retains the original native step state, actual dataset/file/resource identifiers and review.',
        'Each journal directory contains the original request binding, complete response bytes when returned, receipt, and any provider error.',
        'The before and after files preserve native configuration. receiving contains complete Explore exports and their original capture manifests.',
        'The private host connection supplies the named tenant and token environment variable. Tokens and the connection file are not included in this handoff.', '',
        '## Continue the same operation', '',
        'Open the original Huwise workbench with its private Automation connection. Inspect this exact plan before continuing.',
        'Use tenant-recover for an interrupted native dispatch; retained successful response bytes are adopted before any new call.',
        'An upload interrupted before its file UID returns is recovered using the actual native file UID and a complete hash-matched download.',
        'Use tenant-apply with the existing saved review to continue remaining configuration steps.',
        'Use tenant-status to read native processing state, then tenant-receive to capture and compare the full published dataset.',
        'Publishing returns a native acknowledgement. Acceptance is the saved complete Explore receiving result.', '',
        '## Current result', '',
        JSON.stringify(planSummary(plan),null,2), '',
      ].join('\n');
      const exportId = randomUUID(), exportsRoot = join(directory,'tenant-deliveries');
      await privateDirectory(exportsRoot,true);
      const destination = join(exportsRoot,exportId); await privateDirectory(destination,true);
      const files = [];
      async function copy(path,target,prefix = '') {
        for (const entry of await readdir(path,{ withFileTypes:true })) {
          if (!prefix && entry.name === 'exports') continue;
          const name = prefix ? prefix + '/' + entry.name : entry.name;
          if (entry.isSymbolicLink()) throw fail('EXPORT_CHANGED','A retained tenant file was replaced with a symbolic link.');
          if (entry.isDirectory()) {
            await privateDirectory(join(target,entry.name),true);
            await copy(join(path,entry.name),join(target,entry.name),name);
          } else if (entry.isFile()) {
            const raw = await readPrivate(join(path,entry.name),1073741824);
            await createFile(join(target,entry.name),raw);
            files.push({ path:name,bytes:raw.length,sha256:digest(raw) });
          }
        }
      }
      await copy(location(value),destination);
      const companion = Buffer.from(guide);
      await createFile(join(destination,'TENANT-INGESTION.md'),companion);
      files.push({ path:'TENANT-INGESTION.md',bytes:companion.length,sha256:digest(companion) });
      files.sort((a,b) => a.path.localeCompare(b.path));
      const manifest = { schema:'stellar-forge.opendatasoft-tenant-export.v1',id:exportId,planId:value,planSha256:plan.planSha256,createdAt:stamp(),files };
      const manifestBytes = bytes(manifest);
      await createFile(join(destination,'manifest.json'),manifestBytes);
      const entry = { id:exportId,planId:value,planSha256:plan.planSha256,directory:destination,createdAt:manifest.createdAt,
        manifestSha256:digest(manifestBytes),fileCount:files.length,bytes:files.reduce((sum,file) => sum + file.bytes,manifestBytes.length) };
      state.tenantExports ??= []; state.tenantExports.push(entry);
      plan.lastExport = { id:exportId,manifestSha256:entry.manifestSha256 }; await save(plan);
      return { ...entry,manifest };
    },
    async exportEntry(value) {
      const entry = state.tenantExports?.find(item => item.id === checkedId(value));
      if (!entry) throw fail('EXPORT_REQUIRED','Choose an existing retained tenant delivery.',404);
      const raw = await readPrivate(join(entry.directory,'manifest.json'),16777216);
      if (digest(raw) !== entry.manifestSha256) throw fail('EXPORT_CHANGED','The retained tenant delivery manifest changed.');
      const manifest = JSON.parse(raw.toString('utf8'));
      for (const file of manifest.files) {
        if (typeof file.path !== 'string' || file.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')))
          throw fail('EXPORT_CHANGED','The retained delivery path is invalid.');
        const content = await readPrivate(join(entry.directory,file.path),file.bytes);
        if (content.length !== file.bytes || digest(content) !== file.sha256) throw fail('EXPORT_CHANGED','A retained tenant delivery file changed.');
      }
      return { ...entry,manifest };

    },
  };
  return api;
}
