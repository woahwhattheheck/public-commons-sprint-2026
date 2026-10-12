// MIT. Reviewed native Huwise Automation ingestion inside the original workbench lock.
import { join, resolve, dirname } from 'node:path';
import { lstat, readdir, rename, unlink, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, fault, stamp, privateDirectory, readPrivate, createFile, atomicJson, syncDirectory, hashPrivate } from '../../postgres/publisher/files.mjs';
import { catalogOrigin, captureSelection, captureOpendatasoftDataset, readOpendatasoftCapture, parseOpendatasoftJson, ExactOpendatasoftNumber } from '../capture.mjs';
import { createOpendatasoftAutomationClient, validateOpendatasoftAutomationBody, classifyOpendatasoftAutomationStatus } from './client.mjs';
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
const clone = value => parseOpendatasoftJson(bytes(value));
const readJson = async (path,maximum) => parseOpendatasoftJson(await readPrivate(path,maximum));
function exactDecimal(token) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) throw fail('NUMBER_INVALID','Retain complete native JSON numeric tokens.');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/,'');
  if (!digits) return '0';
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailing) { digits = digits.slice(0,-trailing); exponent += BigInt(trailing); }
  return match[1] + digits + 'e' + exponent.toString();
}
function nativeCanonical(value) {
  if (value instanceof ExactOpendatasoftNumber) return ['number',exactDecimal(value.source)];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw fail('NUMBER_INVALID','Use finite native JSON numbers.');
    return ['number',exactDecimal(String(value))];
  }
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array',value.map(nativeCanonical)];
  if (object(value)) return ['object',Object.keys(value).sort().map(key => [key,nativeCanonical(value[key])])];
  return [typeof value,value];
}
const identity = value => digest(Buffer.from(JSON.stringify(nativeCanonical(value))));
const publicationIdentity = value => identity(Object.fromEntries(['status','previous','next','since','is_published']
  .filter(key => Object.hasOwn(value,key)).map(key => [key,value[key]])));
function publicationTransition(plan,status,callId) {
  const step = plan.steps.publish;
  if (!step?.publicationBaseline || step.request?.operationId !== 'publish-dataset' ||
      !['COMPLETE','UNCERTAIN','DISPATCH_PENDING','ACKNOWLEDGED'].includes(step.state)) return false;
  const current = publicationIdentity(status);
  if (current !== step.publicationBaseline.statusSha256 && !step.publicationTransition)
    step.publicationTransition = { status:clone(status),statusSha256:current,callId,at:stamp() };
  return Boolean(step.publicationTransition);
}
async function retainBytes(path,content) {
  const raw = Buffer.isBuffer(content) ? content:Buffer.from(content);
  if (await exists(path)) {
    const prior = await readPrivate(path,raw.length);
    if (prior.length !== raw.length || digest(prior) !== digest(raw)) throw fail('JOURNAL_CHANGED','The original retained native bytes differ.');
    return;
  }
  const pending = path + '.pending-' + randomUUID();
  try {
    await createFile(pending,raw);
    await rename(pending,path);
    await syncDirectory(dirname(path));
  } catch (error) {
    if (await exists(pending)) await unlink(pending).catch(() => {});
    throw error;
  }
}
async function retainExportFile(path,source,expected,signal,onProgress = () => {}) {
  signal?.throwIfAborted();
  if (await exists(path)) {
    const actual = await hashPrivate(path,expected.bytes);
    if (actual.bytes !== expected.bytes || actual.hash !== expected.sha256)
      throw fail('EXPORT_CHANGED','A file in the original delivery preparation differs from its frozen source.');
    onProgress(expected.bytes); return;
  }
  // This pending file belongs to the original frozen delivery and survives an
  // interrupted copy. The workbench's existing operation lock is the sole writer.
  const pending = path + '.pending-copy';
  let input, output;
  try {
    input = await open(source,constants.O_RDONLY | constants.O_NOFOLLOW);
    const sourceStat = await input.stat();
    if (!sourceStat.isFile() || sourceStat.nlink !== 1 || sourceStat.mode & 0o077 || sourceStat.size !== expected.bytes)
      throw fail('EXPORT_SOURCE_CHANGED','Restore the original file selected by the delivery preparation.');
    output = await open(pending,constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,0o600);
    const copied = await output.stat();
    if (!copied.isFile() || copied.nlink !== 1 || copied.mode & 0o077 || copied.size > expected.bytes)
      throw fail('EXPORT_CHANGED','The original partial delivery file is invalid.');
    const original = Buffer.alloc(1048576), partial = Buffer.alloc(1048576);
    async function readExactly(handle,buffer,length,position) {
      let count = 0;
      while (count < length) {
        signal?.throwIfAborted();
        const received = await handle.read(buffer,count,length - count,position + count);
        if (!received.bytesRead) throw fail('EXPORT_SOURCE_CHANGED','A prepared delivery file changed during receiving.');
        count += received.bytesRead;
      }
    }
    // Check every retained prefix byte before continuing at the original offset.
    for (let position = 0; position < copied.size;) {
      const length = Math.min(original.length,copied.size - position);
      await readExactly(input,original,length,position);
      await readExactly(output,partial,length,position);
      if (!original.subarray(0,length).equals(partial.subarray(0,length)))
        throw fail('EXPORT_CHANGED','The original partial delivery differs from its frozen source.');
      position += length; onProgress(position);
    }
    for (let position = copied.size; position < expected.bytes;) {
      const length = Math.min(original.length,expected.bytes - position);
      await readExactly(input,original,length,position);
      let written = 0;
      while (written < length) {
        signal?.throwIfAborted();
        const result = await output.write(original,written,length - written,position + written);
        if (!result.bytesWritten) throw fail('EXPORT_WRITE_FAILED','The original delivery copy could not advance.');
        written += result.bytesWritten;
      }
      position += length; onProgress(position);
    }
    signal?.throwIfAborted();
    const sourceAfter = await input.stat();
    if (sourceAfter.size !== sourceStat.size || sourceAfter.mtimeMs !== sourceStat.mtimeMs || sourceAfter.ctimeMs !== sourceStat.ctimeMs)
      throw fail('EXPORT_SOURCE_CHANGED','The original prepared source changed while it was being copied.');
    await output.sync(); await output.close(); output = null;
    await input.close(); input = null;
    const actual = await hashPrivate(pending,expected.bytes);
    if (actual.bytes !== expected.bytes || actual.hash !== expected.sha256)
      throw fail('EXPORT_SOURCE_CHANGED','The completed delivery copy differs from its frozen source.');
    signal?.throwIfAborted();
    if (await exists(path)) {
      const prior = await hashPrivate(path,expected.bytes);
      if (prior.bytes !== expected.bytes || prior.hash !== expected.sha256)
        throw fail('EXPORT_CHANGED','The original delivery file changed during receiving.');
      await unlink(pending);
    } else await rename(pending,path);
    await syncDirectory(dirname(path));
  } finally {
    // Retain the one original partial file for the next same-delivery attempt.
    if (output) { await output.sync().catch(() => {}); await output.close().catch(() => {}); }
    await input?.close().catch(() => {});
  }
}
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const entityId = (kind, value) => kind === 'users' ? value?.user?.username : kind === 'groups' ? value?.group?.uid : value?.uid;

/** Keep complete writable native schemas, including custom metadata and processor parameters. */
export function automationWritable(value, schemaName) {
  function visit(item, schema = {}) {
    if (item instanceof ExactOpendatasoftNumber) return item;
    if (schema.$ref) schema = { ...AUTOMATION_SCHEMAS[schema.$ref.split('/').at(-1)], ...schema, $ref:undefined };
    if (object(item) && typeof item.uid === 'string' && schema.oneOf?.some(choice => choice.type === 'object' && choice.required?.includes('uid') && choice.properties?.uid)) return { uid:item.uid };
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
    const entries = [];
    for (const [key, child] of Object.entries(item)) {
      const rule = Object.hasOwn(properties,key) ? properties[key] :
        object(schema.additionalProperties) ? schema.additionalProperties : {};
      const expanded = rule.$ref ? { ...AUTOMATION_SCHEMAS[rule.$ref.split('/').at(-1)],...rule } : rule;
      if (expanded.readOnly) continue;
      entries.push([key,visit(child,rule)]);
    }
    return Object.fromEntries(entries);
  }
  return visit(value,AUTOMATION_SCHEMAS[schemaName]);
}
function datasetBody(value) {
  if (!object(value)) throw fail('DATASET_INVALID','Supply a complete reviewed native dataset configuration.');
  return automationWritable(Object.fromEntries(Object.entries(value).filter(([key]) =>
    ['dataset_id','is_restricted','metadata','default_security'].includes(key))),'Dataset');
}
const sourceValue = value => value;

function expectedBodyMatches(actual, wanted, schema) {
  const a = automationWritable(actual,schema), expected = clone(wanted);
  // These native flags make modified a provider-derived timestamp. The flags
  // themselves and every other explicitly reviewed value must still match.
  const defaults = schema === 'Dataset' ? expected?.metadata?.default : schema === 'DatasetMetadata' ? expected?.default : null;
  if (defaults && (defaults.modified_updates_on_data_change?.value === true || defaults.modified_updates_on_metadata_change?.value === true))
    delete defaults.modified;
  function contains(current, desired) {
    if (desired instanceof ExactOpendatasoftNumber || typeof desired === 'number')
      return (current instanceof ExactOpendatasoftNumber || typeof current === 'number') && identity(current) === identity(desired);
    if (Array.isArray(desired)) return Array.isArray(current) && desired.length === current.length && desired.every((item,index) => contains(current[index],item));
    if (object(desired)) return object(current) && Object.entries(desired).every(([key,value]) => Object.hasOwn(current,key) && contains(current[key],value));
    return Object.is(current,desired);
  }
  return contains(a,expected);
}
function configuration(snapshot) {
  if (snapshot.absent) return { absent:true, datasetId:snapshot.datasetId };
  return {
    dataset:{ ...datasetBody(snapshot.dataset),...(object(snapshot.metadata) ? { metadata:automationWritable(snapshot.metadata,'DatasetMetadata') }: {}) },
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
  const targets = Object.create(null);
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
    if (identity(spec) !== plan.planSha256 || identity(plan.source) !== identity(spec.source) || identity(plan.target) !== identity(spec.target))
      throw fail('PLAN_CHANGED','The retained plan source or target binding has changed.');
    if (plan.workflow && (!plan.workflowSha256 || identity(plan.workflow) !== plan.workflowSha256))
      throw fail('PLAN_CHANGED','The retained native workflow has changed.');
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
  async function retainCall(plan, operationId, input, { signal, step, follow, downloadExpected } = {}) {
    const client = await clientFor(plan), callId = randomUUID(), dir = join(location(plan.id),'journal',callId);
    await privateDirectory(dir,true);
    let requestSaved = false, responseSaved = false;
    if (downloadExpected) input = { ...input,download:{ destination:join(dir,'response.bin'),...downloadExpected } };
    const options = {
      signal,
      async onRequest(request) {
        await retainBytes(join(dir,'request.json'),bytes(request)); requestSaved = true;
        if (step) {
          step.callId = callId; step.state = 'DISPATCH_PENDING'; step.operationId = operationId; step.request = request;
          await save(plan);
        }
      },
      async onResponse(response) {
        if (response.raw !== null) await retainBytes(join(dir,'response.bin'),response.raw);
        else if (!response.file || response.file.path !== join(dir,'response.bin')) throw fail('JOURNAL_INCOMPLETE','The native file response is not in its original journal.');
        await retainBytes(join(dir,'receipt.json'),bytes(response.receipt));
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
        await retainBytes(join(dir,'response.bin'),error.response.raw);
        await retainBytes(join(dir,'receipt.json'),bytes(error.response.receipt));
        responseSaved = true;
      }
      await retainBytes(join(dir,'error.json'),bytes({ code:error.code ?? 'NATIVE_CALL_FAILED',outcome:error.outcome ?? 'UNKNOWN',
        message:error.code ? error.message : 'The native call did not return completely.',request:error.request ?? null,receipt:error.receipt ?? null,at:stamp() }));
      if (step) {
        step.state = error.outcome === 'NOT_SENT' ? 'NOT_DISPATCHED' : error.outcome === 'REJECTED' ? 'REJECTED' : requestSaved ? 'UNCERTAIN' : 'NOT_DISPATCHED';
        step.error = { code:error.code ?? 'NATIVE_CALL_FAILED',message:error.code ? error.message : 'Read the retained native result.' };
        plan.state = step.state === 'UNCERTAIN' ? 'RECOVERY_REQUIRED' : 'FAILED'; plan.error = step.error; await save(plan);
      }
      throw error;
    } finally { await client.close(); }
  }
  async function list(plan, operationId, params = {}, query = {}, signal) {
    const all = [], seen = new Set(), totals = []; let next = null, pages = 0;
    do {
      const received = await retainCall(plan,operationId,{ params,query },{ signal,follow:next });
      const value = received.value, rows = Array.isArray(value) ? value : value?.results;
      if (!Array.isArray(rows)) throw fail('PAGE_INVALID','The native collection response did not contain its documented complete results.');
      all.push(...rows); pages++;
      if (value?.total_count !== null && value?.total_count !== undefined) {
        const token = value.total_count instanceof ExactOpendatasoftNumber ? value.total_count.source:String(value.total_count);
        if (!/^\d+$/.test(token)) throw fail('PAGE_INVALID','The native total_count is not a nonnegative integer.');
        const total = BigInt(token);
        if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('COLLECTION_LIMIT','The native collection count exceeds this host integer capacity.');
        totals.push(Number(total));
      }
      const candidate = Array.isArray(value) ? null : value.next ?? value.links?.find?.(item => item.rel === 'next')?.href ?? null;
      if (candidate && typeof candidate !== 'string') throw fail('PAGE_INVALID','The native next-page link is not a URL.');
      if (candidate && seen.has(candidate)) throw fail('PAGE_LOOP','The provider repeated a collection page.');
      if (candidate) seen.add(candidate);
      next = candidate;
      if (!next && totals.some(total => total !== all.length))
        throw fail('PAGE_INCOMPLETE','The complete native collection differs from its observed total_count values.');
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
    return parseOpendatasoftJson(raw);
  }
  async function retainedSource(plan,spec) {
    const capture = await readOpendatasoftCapture(join(location(plan.id),'source','capture.json'),plan.source.captureSha256);
    if (capture.manifestSha256 !== plan.source.captureSha256)
      throw fail('SOURCE_CHANGED','The retained source capture differs from the reviewed edition.');
    const upload = capture.rawFiles.get('records.json');
    if (!upload || upload.length !== spec.source.bytes || digest(upload) !== spec.source.sha256)
      throw fail('UPLOAD_CHANGED','The complete retained upload no longer matches the reviewed source.');
    const notesRaw = await readPrivate(join(location(plan.id),'source','edition-notes.json'),4194304);
    const notes = parseOpendatasoftJson(notesRaw);
    if (digest(notesRaw) !== spec.source.notesSha256 || (notes.revision ?? 0) !== plan.source.notesRevision)
      throw fail('SOURCE_CHANGED','The retained source notes differ from the reviewed edition.');
    return capture;
  }
  async function originalSource(plan, spec) {
    const current = selectedEdition(plan.source.editionId), capture = await selectedCapture(plan.source.editionId);
    if (capture.manifestSha256 !== plan.source.captureSha256 || (current.notes?.revision ?? 0) !== plan.source.notesRevision)
      throw fail('SOURCE_CHANGED','Review a new plan for the changed source edition or notes.');
    return retainedSource(plan,spec);
  }
  function workflow(plan, spec, before) {
    const steps = [];
    const originalDataset = before.absent ? null:configuration(before).dataset;
    const metadata = clone(originalDataset?.metadata ?? {});
    for (const [template,fields] of Object.entries(spec.dataset.metadata))
      Object.defineProperty(metadata,template,{ value:{ ...(Object.hasOwn(metadata,template) ? metadata[template]:{}),...fields },enumerable:true,writable:true,configurable:true });
    const dataset = { ...(originalDataset ?? {}),...spec.dataset };
    if (before.absent) dataset.metadata = metadata; else delete dataset.metadata;
    validateOpendatasoftAutomationBody(before.absent ? 'create-dataset':'update-dataset',dataset);
    steps.push({ key:'dataset',operationId:before.absent ? 'create-dataset':'update-dataset',schema:'Dataset',body:dataset,
      expected:before.absent ? null:datasetBody(before.dataset) });
    if (!before.absent) {
      validateOpendatasoftAutomationBody('update-all-dataset-metadata',metadata);
      steps.push({ key:'metadata',operationId:'update-all-dataset-metadata',schema:'DatasetMetadata',body:metadata,
        expected:automationWritable(before.metadata,'DatasetMetadata') });
    }
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
    return { value:parseOpendatasoftJson(raw),receipt };
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
    if (descriptor.schema) {
      step.appliedConfiguration = automationWritable(value,descriptor.schema);
      const desired = step.desired ?? descriptor.body;
      if (!expectedBodyMatches(value,desired,descriptor.schema)) {
        step.configurationMismatch = { at:stamp(),expectedSha256:identity(desired),actualSha256:identity(step.appliedConfiguration) };
        step.state = 'ACKNOWLEDGED'; plan.state = 'CONFIGURATION_REVIEW_REQUIRED';
        plan.error = { code:'ODS_TENANT_NATIVE_CONFIGURATION_DIFFERENT',message:'The native response for ' + descriptor.key + ' differs from the reviewed configuration. Inspect its retained request and complete response.' };
        await save(plan); throw fail('NATIVE_CONFIGURATION_DIFFERENT',plan.error.message,409);
      }
    }
    step.state = 'COMPLETE'; step.completedAt = stamp(); step.actualId = descriptor.kind ? entityId(descriptor.kind,value) : value?.uid ?? null;
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
      const operation = descriptor.key === 'dataset' ? 'retrieve-dataset' : descriptor.key === 'metadata' ? 'list-all-dataset-metadata' : descriptor.key === 'resource' ? 'retrieve-dataset-resource' : TYPES[descriptor.kind].get;
      const current = (await retainCall(plan,operation,{ params },{ signal })).value;
      if (identity(automationWritable(current,descriptor.schema)) !== identity(descriptor.expected))
        throw fail('REMOTE_EDITED','The selected native object changed after review. Inspect its current configuration before a new plan.',409);
    }
    if (descriptor.key === 'publish') {
      const baseline = await retainCall(plan,'get-dataset-status',{ params },{ signal });
      if (['RUNNING','UNKNOWN'].includes(classifyOpendatasoftAutomationStatus(baseline.value).phase))
        throw fail('PUBLICATION_RUNNING','The tenant has an active native operation. Read its status, then continue this saved review when that operation finishes.',409);
      step.publicationBaseline = { status:clone(baseline.value),statusSha256:publicationIdentity(baseline.value),callId:baseline.callId,at:stamp() };
      await save(plan);
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
    } else if (descriptor.key === 'metadata') {
      received = await retainCall(plan,'list-all-dataset-metadata',{ params },{ signal });
      if (expectedBodyMatches(received.value,descriptor.body,'DatasetMetadata')) candidate = received.value;
    } else if (descriptor.key === 'upload') {
      const fileUid = input.fileUid ?? plan.fileUid ?? spec.source.filename;
      if (fileUid) {
        try {
          received = await retainCall(plan,'retrieve-dataset-resource-file',{ params:{ ...params,file_uid:line(fileUid,'the native file UID or reviewed filename') } },{ signal });
        } catch (error) {
          if (input.fileUid || plan.fileUid || error.receipt?.status !== 404) throw error;
        }
        if (received) {
          const actualUid = line(received.value?.uid,'the actual returned native file UID');
          const download = await retainCall(plan,'download-dataset-resource-file',{ params:{ ...params,file_uid:actualUid } },{
            signal,downloadExpected:{ expectedBytes:spec.source.bytes,expectedSha256:spec.source.sha256 } });
          if (!download.file?.complete || download.file.bytes !== spec.source.bytes || download.file.sha256 !== spec.source.sha256)
            throw fail('RECOVERY_FILE_DIFFERENT','The actual native file bytes differ from this plan source.');
          plan.uploadReadback = { fileUid:actualUid,bytes:download.file.bytes,sha256:download.file.sha256,callId:download.callId,at:stamp() };
          candidate = received.value;
        }
      }
    } else if (descriptor.key === 'publish') {
      const observed = await retainCall(plan,'get-dataset-status',{ params },{ signal }), current = observed.value;
      plan.providerStatus = current;
      const transitioned = publicationTransition(plan,current,observed.callId);
      step.recovery = { kind:'NATIVE_STATUS',at:stamp(),status:current,transitioned };
      plan.state = transitioned ? 'RECEIVING_REQUIRED':'PUBLICATION_PENDING'; await save(plan); return;
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
      ? 'The reviewed upload filename did not identify matching native source bytes. Supply its actual uploaded file UID to continue the complete file readback.'
      : 'The native readback has not identified this original operation. Retain the plan and inspect its request and response.',409);
  }
  function projectedConfiguration(plan,baseline) {
    const expected = baseline.absent ? { dataset:null,resources:[],fields:[],processors:[],users:[],groups:[],schedules:[],attachments:[],alternativeExports:[] } : configuration(baseline);
    for (const descriptor of plan.workflow ?? []) {
      const step = plan.steps[descriptor.key];
      if (step?.state !== 'COMPLETE' || !descriptor.schema) continue;
      const body = automationWritable(step.appliedConfiguration ?? step.desired ?? descriptor.body,descriptor.schema);
      if (descriptor.key === 'dataset') {
        const metadata = expected.dataset?.metadata ?? body.metadata;
        expected.dataset = { ...body,...(metadata ? { metadata }: {}) }; continue;
      }
      if (descriptor.key === 'metadata') { expected.dataset.metadata = body; continue; }
      const kind = descriptor.key === 'resource' ? 'resources':descriptor.kind;
      const idKey = kind === 'resources' ? 'uid':'id', actualId = step.actualId ?? descriptor.uid;
      if (typeof actualId !== 'string') throw fail('NATIVE_ID_REQUIRED','Recover the actual native identifier for ' + descriptor.key + '.');
      const value = { [idKey]:actualId,...body };
      const index = expected[kind].findIndex(item => item[idKey] === actualId);
      if (index < 0) expected[kind].push(value); else expected[kind][index] = value;
    }
    return expected;
  }
  function comparableConfiguration(value,publication) {
    const result = clone(value);
    // Collection order changes do not change these native sets. Field and processor
    // sequences stay ordered because their execution order changes the result.
    for (const kind of ['resources','users','groups','schedules','attachments','alternativeExports'])
      result[kind].sort((a,b) => identity(a).localeCompare(identity(b)));
    const defaults = result.dataset?.metadata?.default;
    if (publication && defaults && (defaults.modified_updates_on_data_change?.value === true || defaults.modified_updates_on_metadata_change?.value === true))
      delete defaults.modified;
    return result;
  }
  async function compareConfiguration(plan,current,publication = false) {
    const baseline = await readSnapshot(plan,plan.createdBaseline ?? plan.inspection);
    const expected = comparableConfiguration(projectedConfiguration(plan,baseline),publication);
    const actual = comparableConfiguration(configuration(current),publication);
    const sections = Object.keys(expected).filter(key => identity(expected[key]) !== identity(actual[key]));
    return { matched:sections.length === 0,changedSections:sections,at:stamp(),
      expectedConfigurationSha256:identity(expected),actualConfigurationSha256:identity(actual),
      automaticModifiedMetadata:publication && expected.dataset?.metadata?.default?.modified === undefined };
  }
  async function ensureCreatedBaseline(plan,spec,signal) {
    if (plan.createdBaseline || plan.steps.dataset?.state !== 'COMPLETE' || plan.workflow[0].operationId !== 'create-dataset') return;
    const current = await snapshot(plan,signal);
    if (!expectedBodyMatches(current.dataset,plan.workflow[0].body,'Dataset'))
      throw fail('CREATED_CONFIGURATION_CHANGED','The newly created dataset differs from its reviewed native configuration.',409);
    plan.createdBaseline = await writeSnapshot(plan,'created-defaults',current);
    await save(plan);
  }
  async function guardConfiguration(plan,spec,signal,phase,publication = false) {
    const current = await snapshot(plan,signal), retained = await writeSnapshot(plan,phase,current);
    const comparison = await compareConfiguration(plan,current,publication);
    plan.configurationCheck = { ...comparison,snapshot:retained,phase };
    if (!comparison.matched) {
      plan.state = 'CONFIGURATION_CHANGED';
      plan.error = { code:'ODS_TENANT_CONFIGURATION_CHANGED',message:'The current tenant differs from the reviewed configuration in: ' + comparison.changedSections.join(', ') + '.' };
      await save(plan); throw fail('CONFIGURATION_CHANGED',plan.error.message,409);
    }
    await save(plan); return current;
  }
  async function verifyUploadedSource(plan,spec,signal) {
    if (!plan.fileUid) throw fail('UPLOAD_REQUIRED','Recover the actual native source file UID.');
    if (plan.uploadReadback?.fileUid === plan.fileUid && plan.uploadReadback.sha256 === spec.source.sha256 && plan.uploadReadback.bytes === spec.source.bytes)
      return;
    const downloaded = await retainCall(plan,'download-dataset-resource-file',{
      params:{ dataset_uid:plan.datasetUid,file_uid:plan.fileUid },
    },{ signal,downloadExpected:{ expectedBytes:spec.source.bytes,expectedSha256:spec.source.sha256 } });
    if (!downloaded.file?.complete || downloaded.file.bytes !== spec.source.bytes || downloaded.file.sha256 !== spec.source.sha256)
      throw fail('UPLOAD_DIFFERENT','The native uploaded source differs from the reviewed complete export.');
    plan.uploadReadback = { fileUid:plan.fileUid,bytes:downloaded.file.bytes,sha256:downloaded.file.sha256,callId:downloaded.callId,at:stamp() };
    await save(plan);
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
  async function retainedExport(entry,signal) {
    if (entry.directory !== join(directory,'tenant-deliveries',checkedId(entry.id)))
      throw fail('EXPORT_CHANGED','The original delivery directory changed.');
    await privateDirectory(entry.directory);
    const raw = await readPrivate(join(entry.directory,'manifest.json'),16777216);
    if (digest(raw) !== entry.manifestSha256) throw fail('EXPORT_CHANGED','The retained tenant delivery manifest changed.');
    const manifest = parseOpendatasoftJson(raw), paths = new Set();
    if (manifest.schema !== 'stellar-forge.opendatasoft-tenant-export.v1' || manifest.id !== entry.id ||
        manifest.planId !== entry.planId || manifest.planSha256 !== entry.planSha256 || !Array.isArray(manifest.files))
      throw fail('EXPORT_CHANGED','The retained tenant delivery binding changed.');
    for (const file of manifest.files) {
      signal?.throwIfAborted();
      if (typeof file.path !== 'string' || paths.has(file.path) ||
          file.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')) ||
          !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 1073741824 || !SHA.test(file.sha256 ?? ''))
        throw fail('EXPORT_CHANGED','The retained delivery file is invalid.');
      paths.add(file.path);
      const content = await hashPrivate(join(entry.directory,file.path),file.bytes);
      if (content.bytes !== file.bytes || content.hash !== file.sha256)
        throw fail('EXPORT_CHANGED','A retained tenant delivery file changed.');
    }
    return { ...entry,manifest };
  }
  const api = {
    async reconcile() {
      if (!await exists(root)) return;
      await privateDirectory(root);
      const saved = []; let restoredDelivery = false;
      for (const entry of await readdir(root,{ withFileTypes:true })) {
        if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
        if (!await exists(join(root,entry.name,'plan.json'))) continue;
        const plan = await read(entry.name);
        const preparation = plan.exportPreparation;
        // The private plan commits before the workbench catalog. Recover that
        // exact completed delivery after a crash between the two atomic writes.
        if (preparation?.state === 'COMPLETE' && plan.lastExport?.id === preparation.id &&
            !(state.tenantExports ?? []).some(item => item.id === preparation.id)) {
          const destination = join(directory,'tenant-deliveries',checkedId(preparation.id));
          const raw = await readPrivate(join(destination,'manifest.json'),16777216);
          const manifest = parseOpendatasoftJson(raw);
          if (digest(raw) !== plan.lastExport.manifestSha256 || manifest.basisSha256 !== preparation.basisSha256 ||
              manifest.planRevisionSha256 !== preparation.planRevisionSha256 || !Array.isArray(manifest.files))
            throw fail('EXPORT_CHANGED','The completed original delivery changed before catalog recovery.');
          const delivery = { id:preparation.id,planId:plan.id,planSha256:plan.planSha256,directory:destination,
            createdAt:manifest.createdAt,manifestSha256:plan.lastExport.manifestSha256,fileCount:manifest.files.length,
            bytes:manifest.files.reduce((sum,file) => sum + file.bytes,raw.length) };
          await retainedExport(delivery);
          (state.tenantExports ??= []).push(delivery); restoredDelivery = true;
        }
        saved.push(planSummary(plan));
      }
      saved.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
      const current = [...(state.tenantPlans ?? [])].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
      if (restoredDelivery || identity(current) !== identity(saved)) { state.tenantPlans = saved; await persist(); }
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
      return { ...planSummary(plan),lastExport:plan.lastExport ?? null,
        workflow:(plan.workflow ?? []).map(({ key,kind,operationId }) => ({ key,...(kind ? { kind }: {}),operationId })),
        steps:Object.fromEntries(Object.entries(plan.steps).map(([key,step]) => [key,{ state:step.state,operationId:step.operationId,actualId:step.actualId ?? null }])),
        specificationJson:bytes(spec).toString('utf8'),nativePlanJson:bytes(plan).toString('utf8'),
        ...(plan.inspection ? { remoteJson:bytes(await readSnapshot(plan,plan.inspection)).toString('utf8') } : {}) };
    },
    async prepare(input) {
      if (typeof input === 'string' || Buffer.isBuffer(input)) input = parseOpendatasoftJson(typeof input === 'string' ? Buffer.from(input):input);
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
      if (!object(dataset.metadata) || Object.values(dataset.metadata).some(fields => !object(fields)))
        throw fail('METADATA_REQUIRED','Supply the native metadata dictionary, with each template containing its field values.');
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
      const planId = randomUUID(), notesBytes = bytes(entry.notes ?? { revision:0,text:'',rowNotes:[] });
      const source = { editionId:input.editionId,captureSha256:input.captureSha256,notesRevision:input.notesRevision,
        datasetId:capture.manifest.datasetId,rowCount:capture.rows.length,fieldCount:capture.fields.length,notesSha256:digest(notesBytes),
        filename:target.datasetId.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,100) + '-' + planId + '-' + digest(raw).slice(0,16) + '.json',sha256:digest(raw),bytes:raw.length };
      const spec = { schema:TENANT_PLAN_SCHEMA,contract:AUTOMATION_SOURCE,target,source,dataset,resource,
        resourceMode:input.resourceMode ?? 'replace-selected',changes,publish:input.publish,acceptance };
      if (bytes(spec).length > 8388608) throw fail('PLAN_TOO_LARGE','The reviewed configuration exceeds eight MiB.');
      const plan = { schema:TENANT_PLAN_SCHEMA,id:planId,createdAt:stamp(),updatedAt:stamp(),state:'PREPARED',
        target,source,planSha256:identity(spec),datasetUid:target.datasetUid ?? null,
        inspection:null,review:null,steps:{},error:null };
      await privateDirectory(root,true); await privateDirectory(location(plan.id),true);
      await privateDirectory(join(location(plan.id),'source'),true); await privateDirectory(join(location(plan.id),'journal'),true);
      await createFile(join(location(plan.id),'specification.json'),bytes(spec));
      for (const [filename,content] of capture.rawFiles) await createFile(join(location(plan.id),'source',filename),content);
      await createFile(join(location(plan.id),'source','capture.json'),capture.manifestBytes);
      await createFile(join(location(plan.id),'source','edition-notes.json'),notesBytes);
      await save(plan); return planSummary(plan);
    },
    async inspect(value,signal) {
      const plan = await read(value), spec = await specFor(plan);
      if (Object.values(plan.steps).some(step => !['READY','NOT_DISPATCHED'].includes(step.state)))
        throw fail('PLAN_STARTED','Use recovery and status for a plan whose native application has started.');
      await originalSource(plan,spec);
      const before = await snapshot(plan,signal);
      plan.inspection = await writeSnapshot(plan,'before',before);
      plan.workflow = workflow(plan,spec,before); plan.workflowSha256 = identity(plan.workflow);
      plan.review = null; plan.state = 'INSPECTED'; plan.error = null;
      await save(plan); return planSummary(plan);
    },
    async review(value,input) {
      exact(input,['planSha256','configurationSha256','note'],['planSha256','configurationSha256']);
      const plan = await read(value), spec = await specFor(plan);
      if (!plan.inspection || !['INSPECTED','REVIEWED'].includes(plan.state)) throw fail('INSPECTION_REQUIRED','Inspect the actual tenant configuration before reviewing the plan.');
      if (input.planSha256 !== plan.planSha256 || input.configurationSha256 !== plan.inspection.configurationSha256)
        throw fail('REVIEW_CHANGED','Review the inspected source and tenant configuration hashes.');
      await originalSource(plan,spec);
      plan.review = { id:randomUUID(),planSha256:plan.planSha256,workflowSha256:plan.workflowSha256,configurationSha256:plan.inspection.configurationSha256,
        at:stamp(),note:input.note ? line(input.note,'a review note',2048):'' };
      plan.state = 'REVIEWED'; await save(plan); return planSummary(plan);
    },
    async apply(value,input,signal,progress = () => {}) {
      exact(input,['reviewId'],['reviewId']);
      const plan = await read(value), spec = await specFor(plan);
      if (input.reviewId !== plan.review?.id || plan.review.planSha256 !== plan.planSha256 || plan.review.workflowSha256 !== plan.workflowSha256) throw fail('REVIEW_REQUIRED','Use the saved review for this exact tenant plan.');
      await retainedSource(plan,spec);
      if (plan.state === 'ACCEPTED' || plan.state === 'CONFIGURED' && !spec.publish) return planSummary(plan);
      if (!Object.values(plan.steps).some(step => step.state !== 'READY' && step.state !== 'NOT_DISPATCHED')) {
        const current = await snapshot(plan,signal);
        const currentHash = identity(configuration(current));
        await writeSnapshot(plan,'dispatch-before',current);
        if (currentHash !== plan.review.configurationSha256) throw fail('REMOTE_EDITED','The tenant changed after review. Inspect the same unstarted plan and review its actual configuration.',409);
      }
      for (const descriptor of plan.workflow) {
        const step = plan.steps[descriptor.key];
        if (!step || step.state === 'COMPLETE') continue;
        const retained = await storedResponse(plan,step);
        if (retained) await completeStep(plan,descriptor,step,retained.value,{ kind:'ORIGINAL_RESPONSE',receipt:retained.receipt });
        else if (['UNCERTAIN','DISPATCH_PENDING','ACKNOWLEDGED'].includes(step.state))
          throw fail('RECOVERY_REQUIRED','Recover the original native step before continuing its configuration.',409);
      }
      await ensureCreatedBaseline(plan,spec,signal);
      if (Object.values(plan.steps).some(step => step.state === 'COMPLETE'))
        await guardConfiguration(plan,spec,signal,'resume-configuration',plan.steps.publish?.state === 'COMPLETE');
      plan.state = 'APPLYING'; plan.error = null; await save(plan);
      for (const descriptor of plan.workflow) {
        progress({ phase:descriptor.key,datasetUid:plan.datasetUid ?? null });
        if (descriptor.key === 'publish' && plan.steps.publish?.state !== 'COMPLETE') {
          await verifyUploadedSource(plan,spec,signal);
          await guardConfiguration(plan,spec,signal,'publish-configuration');
        }
        await runStep(plan,spec,descriptor,signal);
        if (descriptor.key === 'dataset') await ensureCreatedBaseline(plan,spec,signal);
      }
      if (!spec.publish) {
        await verifyUploadedSource(plan,spec,signal);
        await guardConfiguration(plan,spec,signal,'configured');
      }
      plan.state = spec.publish ? 'PUBLICATION_REQUESTED':'CONFIGURED';
      if (plan.datasetUid) {
        const observed = await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal });
        plan.providerStatus = observed.value; publicationTransition(plan,observed.value,observed.callId);
      }
      await save(plan); return planSummary(plan);
    },
    async recover(value,input = {},signal,progress = () => {}) {
      exact(input,['fileUid','stepIds']);
      if (input.stepIds !== undefined && !object(input.stepIds)) throw fail('RECOVERY_INVALID','Use native identifiers keyed by the original step name.');
      const plan = await read(value), spec = await specFor(plan);
      if (!plan.review || !plan.workflow) throw fail('REVIEW_REQUIRED','This plan has not started a reviewed native operation.');
      await retainedSource(plan,spec);
      for (const descriptor of plan.workflow) {
        progress({ phase:'recover ' + descriptor.key });
        await reconcileStep(plan,spec,descriptor,signal,input);
        if (descriptor.key === 'dataset') await ensureCreatedBaseline(plan,spec,signal);
      }
      const incomplete = plan.workflow.some(descriptor => plan.steps[descriptor.key]?.state !== 'COMPLETE');
      if (!['RECEIVING_REQUIRED','PUBLICATION_PENDING'].includes(plan.state)) plan.state = incomplete ? 'REVIEWED':spec.publish ? 'PUBLICATION_REQUESTED':'CONFIGURED';
      plan.error = null; await save(plan); return planSummary(plan);
    },
    async status(value,signal) {
      const plan = await read(value);
      if (!plan.datasetUid) return planSummary(plan);
      const observed = await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal });
      plan.providerStatus = observed.value; publicationTransition(plan,observed.value,observed.callId);
      await save(plan); return planSummary(plan);
    },
    async receive(value,input = {},signal,progress = () => {}) {
      exact(input,['maxRows','maxBytes']);
      const plan = await read(value), spec = await specFor(plan), capture = await retainedSource(plan,spec);
      if (!plan.datasetUid || !plan.review) throw fail('DATASET_REQUIRED','Apply the reviewed native configuration before receiving its publication.');
      if (!spec.publish) throw fail('PUBLICATION_PLAN_REQUIRED','This plan configures the tenant without publication. Use a reviewed publication plan to receive a new published result.');
      const publication = plan.steps.publish;
      if (!publication?.publicationBaseline || publication.request?.operationId !== 'publish-dataset' ||
          !['COMPLETE','UNCERTAIN','DISPATCH_PENDING','ACKNOWLEDGED'].includes(publication.state))
        throw fail('PUBLICATION_REQUIRED','Apply this saved review through its original publish step before receiving the publication.');
      const unfinished = (plan.workflow ?? []).filter(step => step.key !== 'publish' && plan.steps[step.key]?.state !== 'COMPLETE');
      if (unfinished.length) throw fail('RECOVERY_REQUIRED','Recover the original configuration steps before receiving the publication.');
      const observed = await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal }), status = observed.value;
      plan.providerStatus = status;
      const transitioned = publicationTransition(plan,status,observed.callId);
      if (!transitioned || classifyOpendatasoftAutomationStatus(status).phase !== 'IDLE' || status.is_published !== true) {
        plan.state = 'PUBLICATION_PENDING'; await save(plan);
        return planSummary(plan);
      }
      await guardConfiguration(plan,spec,signal,'receiving-before',true);
      const connection = await binding(plan), priorReceiving = plan.receiving;
      const resume = priorReceiving?.state === 'RECEIVING' && priorReceiving.publicationStatusSha256 === publicationIdentity(status);
      const receivingId = resume ? checkedId(priorReceiving.id):randomUUID();
      const limits = {
        maxRows:integer(input.maxRows ?? priorReceiving?.limits?.maxRows ?? Math.max(250000,spec.acceptance.expectedRows + 1),'receiving row capacity',10000000),
        maxBytes:integer(input.maxBytes ?? priorReceiving?.limits?.maxBytes ?? Math.max(268435456,spec.source.bytes * 4),'receiving byte capacity',1073741824),
      };
      if (priorReceiving && !resume) {
        plan.receivingHistory ??= [];
        plan.receivingHistory.push({ ...priorReceiving,retainedAt:stamp() });
      }
      const receivingRoot = join(location(plan.id),'receiving'); await privateDirectory(receivingRoot,true);
      const receivingDirectory = join(receivingRoot,receivingId);
      const selection = captureSelection({ catalogOrigin:connection.origin,datasetId:plan.target.datasetId,authTokenEnv:connection.authTokenEnv });
      plan.state = 'RECEIVING'; plan.receiving = { id:receivingId,state:'RECEIVING',
        startedAt:resume ? priorReceiving.startedAt:stamp(),publicationSince:status.since,publicationStatusSha256:publicationIdentity(status),limits }; await save(plan);
      const received = await captureOpendatasoftDataset(selection,receivingDirectory,{
        env:environment,signal,onProgress:progress,...limits,
      });
      const afterStatus = (await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal })).value;
      if (classifyOpendatasoftAutomationStatus(afterStatus).phase !== 'IDLE' || afterStatus.is_published !== true || publicationIdentity(status) !== publicationIdentity(afterStatus))
        throw fail('PUBLICATION_CHANGED','The tenant publication changed while its complete receiving export was being read.');
      const acceptance = receivingComparison(capture,received,spec);
      if (Array.isArray(afterStatus.records_errors) && afterStatus.records_errors.length) acceptance.accepted = false;
      acceptance.recordErrors = afterStatus.records_errors ?? [];
      plan.receiving = { ...plan.receiving,state:acceptance.accepted ? 'ACCEPTED':'REVIEW_REQUIRED',captureSha256:received.manifestSha256,
        captureFile:join('receiving',receivingId,'capture.json'),acceptance,completedAt:stamp() };
      plan.providerStatus = afterStatus;
      const after = await snapshot(plan,signal); plan.after = await writeSnapshot(plan,'after',after);
      const finalStatus = (await retainCall(plan,'get-dataset-status',{ params:{ dataset_uid:plan.datasetUid } },{ signal })).value;
      if (publicationIdentity(finalStatus) !== publicationIdentity(status))
        throw fail('PUBLICATION_CHANGED','The native publication changed during its final configuration readback.');
      plan.providerStatus = finalStatus;
      const configurationResult = await compareConfiguration(plan,after,true);
      plan.configurationCheck = { ...configurationResult,snapshot:plan.after,phase:'receiving-after' };
      acceptance.configuration = configurationResult;
      acceptance.accepted = acceptance.accepted && configurationResult.matched;
      plan.receiving.state = acceptance.accepted ? 'ACCEPTED':'REVIEW_REQUIRED';
      if (acceptance.accepted && plan.steps.publish?.state !== 'COMPLETE' && plan.steps.publish) {
        plan.steps.publish.state = 'COMPLETE'; plan.steps.publish.completedAt = stamp();
        plan.steps.publish.recovery = { kind:'COMPLETE_EXPLORE_RECEIVING',captureSha256:received.manifestSha256,at:stamp() };
      }
      plan.state = acceptance.accepted ? 'ACCEPTED':'RECEIVING_REVIEW_REQUIRED';
      await save(plan); return planSummary(plan);
    },
    async export(value,signal,progress = () => {}) {
      signal?.throwIfAborted();
      const plan = await read(value), spec = await specFor(plan);
      await retainedSource(plan,spec);
      const { updatedAt:_updatedAt,lastExport:_lastExport,exportPreparation:_preparation,...product } = plan;
      const planRevisionSha256 = identity(product);
      const cataloged = state.tenantExports?.some(item => item.id === plan.exportPreparation?.id);
      if (cataloged && plan.exportPreparation?.state === 'COMPLETE' && plan.exportPreparation.planRevisionSha256 === planRevisionSha256)
        return api.exportEntry(plan.exportPreparation.id,signal);
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
        'Open the original Huwise workbench with its private Automation connection and read this exact tenant-plan. Use recovery and status when its native application has already started.',
        'Use tenant-recover for an interrupted native dispatch; retained successful response bytes are adopted before any new call.',
        'An interrupted upload is first looked up using its unique reviewed filename. Recovery adopts only the returned actual file UID after downloading and matching every original source byte. An explicit file UID can also be supplied.',
        'Use tenant-apply with the existing saved review to continue remaining configuration steps.',
        'Use tenant-status to read native processing state, then tenant-receive to capture and compare the full published dataset.',
        'Publishing returns a native acknowledgement. Acceptance is the saved complete Explore receiving result.', '',
        '## Current result', '',
        JSON.stringify(planSummary(plan),null,2), '',
      ].join('\n');
      const pending = plan.exportPreparation && (plan.exportPreparation.state !== 'COMPLETE' || !cataloged) ? plan.exportPreparation:null;
      const exportId = pending ? checkedId(pending.id):randomUUID(), exportsRoot = join(directory,'tenant-deliveries');
      const preparations = join(directory,'tenant-export-preparations');
      await privateDirectory(exportsRoot,true); await privateDirectory(preparations,true);
      if (!pending) {
        // Publish the plan pointer only after its complete frozen basis is durable.
        plan.exportPreparation = { id:exportId,state:'PREPARING',createdAt:stamp(),planRevisionSha256 };
      }
      const destination = join(exportsRoot,exportId), preparationFile = join(preparations,exportId + '.json');
      await privateDirectory(destination,true);
      let basis;
      if (await exists(preparationFile)) basis = await readJson(preparationFile,268435456);
      else {
        if (planRevisionSha256 !== plan.exportPreparation.planRevisionSha256)
          throw fail('EXPORT_PREPARATION_CHANGED','Restore the original frozen delivery basis before continuing this saved preparation.');
        const frozen = [];
        async function inventory(path,prefix = '') {
          for (const item of await readdir(path,{ withFileTypes:true })) {
            signal?.throwIfAborted();
            if (!prefix && item.name === 'exports' || item.name.includes('.pending-')) continue;
            const name = prefix ? prefix + '/' + item.name:item.name, source = join(path,item.name);
            if (item.isSymbolicLink()) throw fail('EXPORT_CHANGED','A retained tenant file was replaced with a symbolic link.');
            if (item.isDirectory()) await inventory(source,name);
            else if (item.isFile()) {
              if (item.name === 'plan.json' || item.name === 'progress.json') {
                const raw = await readPrivate(source,67108864);
                frozen.push({ path:name,bytes:raw.length,sha256:digest(raw),snapshotBase64:raw.toString('base64') });
              } else {
                const actual = await hashPrivate(source,1073741824);
                frozen.push({ path:name,bytes:actual.bytes,sha256:actual.hash });
              }
            }
          }
        }
        await inventory(location(value)); frozen.sort((a,b) => a.path.localeCompare(b.path));
        basis = { schema:'stellar-forge.opendatasoft-tenant-export-preparation.v1',id:exportId,planId:value,
          planSha256:plan.planSha256,planRevisionSha256:plan.exportPreparation.planRevisionSha256,
          createdAt:plan.exportPreparation.createdAt,guide,files:frozen };
        await retainBytes(preparationFile,bytes(basis));
      }
      if (basis.schema !== 'stellar-forge.opendatasoft-tenant-export-preparation.v1' || basis.id !== exportId ||
          basis.planId !== value || basis.planSha256 !== plan.planSha256 || !Array.isArray(basis.files) ||
          basis.planRevisionSha256 !== plan.exportPreparation.planRevisionSha256 ||
          plan.exportPreparation.basisSha256 && plan.exportPreparation.basisSha256 !== identity(basis))
        throw fail('EXPORT_CHANGED','The saved original delivery preparation changed.');
      plan.exportPreparation.basisSha256 = identity(basis); plan.exportPreparation.state = 'COPYING'; await save(plan);
      const totalBytes = basis.files.reduce((sum,file) => sum + file.bytes,0);
      let completeFiles = 0, completeBytes = 0;
      for (const file of basis.files) {
        signal?.throwIfAborted();
        const fileProgress = copiedBytes => progress({ phase:'tenant-export',exportId,completeFiles,totalFiles:basis.files.length,
          completeBytes,totalBytes,path:file.path,copiedBytes,fileBytes:file.bytes });
        fileProgress(0);
        if (typeof file.path !== 'string' || file.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')) ||
            !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 1073741824 || !SHA.test(file.sha256 ?? ''))
          throw fail('EXPORT_CHANGED','The prepared native delivery file is invalid.');
        const target = join(destination,file.path);
        await privateDirectory(dirname(target),true);
        if (file.snapshotBase64 !== undefined) {
          if (typeof file.snapshotBase64 !== 'string') throw fail('EXPORT_CHANGED','The frozen native state is invalid.');
          const raw = Buffer.from(file.snapshotBase64,'base64');
          if (raw.length !== file.bytes || digest(raw) !== file.sha256) throw fail('EXPORT_CHANGED','The frozen native state changed.');
          await retainBytes(target,raw);
        } else await retainExportFile(target,join(location(value),file.path),file,signal,fileProgress);
        completeFiles++; completeBytes += file.bytes;
        progress({ phase:'tenant-export',exportId,completeFiles,totalFiles:basis.files.length,completeBytes,totalBytes,
          path:null,copiedBytes:0,fileBytes:0 });
      }
      signal?.throwIfAborted();
      const companion = Buffer.from(basis.guide);
      await retainBytes(join(destination,'TENANT-INGESTION.md'),companion);
      const preparedFiles = basis.files.map(({ path,bytes,sha256 }) => ({ path,bytes,sha256 }));
      preparedFiles.push({ path:'TENANT-INGESTION.md',bytes:companion.length,sha256:digest(companion) });
      preparedFiles.sort((a,b) => a.path.localeCompare(b.path));
      const manifest = { schema:'stellar-forge.opendatasoft-tenant-export.v1',id:exportId,planId:value,
        planSha256:plan.planSha256,planRevisionSha256:basis.planRevisionSha256,basisSha256:identity(basis),
        createdAt:basis.createdAt,files:preparedFiles };
      const manifestBytes = bytes(manifest);
      await retainBytes(join(destination,'manifest.json'),manifestBytes);
      const entry = { id:exportId,planId:value,planSha256:plan.planSha256,directory:destination,createdAt:manifest.createdAt,
        manifestSha256:digest(manifestBytes),fileCount:preparedFiles.length,bytes:preparedFiles.reduce((sum,file) => sum + file.bytes,manifestBytes.length) };
      state.tenantExports ??= [];
      const originalEntry = state.tenantExports.findIndex(item => item.id === exportId);
      if (originalEntry < 0) state.tenantExports.push(entry); else state.tenantExports[originalEntry] = entry;
      plan.exportPreparation.state = 'COMPLETE'; plan.lastExport = { id:exportId,manifestSha256:entry.manifestSha256 };
      await save(plan); return { ...entry,manifest };
    },
    async exportEntry(value,signal) {
      const entry = state.tenantExports?.find(item => item.id === checkedId(value));
      if (!entry) throw fail('EXPORT_REQUIRED','Choose an existing retained tenant delivery.',404);
      return retainedExport(entry,signal);
    },
  };
  return api;
}
