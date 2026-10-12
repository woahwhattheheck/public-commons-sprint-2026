import {merchantCommercial} from './support-commercial.mjs';
import { supportTools, alias, digest, uuid, notificationStatuses, page, text, selected, metadataSchema, termsSchema, exportNames, object } from './catalog/support.mjs';
import { MerchantSupportIncidentSources } from './support-incidents.mjs';
import {readServiceCase,changeServiceCase,previewServiceCase,readServiceCaseReport} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/service-cases.mjs';
import {renderServiceReport,serviceReportCsv,serviceSummary} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/service-commitments.mjs';
export { supportTools } from './catalog/support.mjs';
// MIT. Configured MCP access to the original incident, case and workorder lifecycle.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { incidentStatus, acknowledgeIncident, exportIncident, configureIncidents, remindIncident,
  operateNotification } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-operator.mjs';
import { readPrivateFile, openIncidentStore } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-store.mjs';
import { compileConfig as compileWatchConfig, configHash as watchConfigHash } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-config.mjs';
import { runIncidentWatch } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/watch.mjs';
import { openCaseStore, retainCaseArtifact, caseMetadata, CASE_STATUSES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-store.mjs';
import { parseWorkspace, serializeWorkspace, workspaceDraft, MAX_WORKSPACE_BYTES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs';
import { importRuntimeHandoff, exportRuntimeHandoff, reviewRuntime, MAX_HANDOFF_BYTES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import { termsDraftFromDocument, termsDocumentFromDraft } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/terms-editor.mjs';
import { workorderFromSources } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/workorder-source.mjs';
import {inspectCaseCommissioning,prepareCaseCommissioning,operateCaseCommissioning} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-commissioning.mjs';
import {commissioningSummary,commissioningReport,commissioningTasksCsv} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/commissioning.mjs';
import { failure, exact, identifier, writePrivate, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const json = value => JSON.stringify(value, null, 2) + '\n';
const DRAFT_SCHEMA = 'stellar-forge.merchant-terms-draft.v1';
const EXPORT_SCHEMA = 'stellar-forge.merchant-support-export.v1';











function expected(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw failure('INVALID_PARAMS', 'Use the exact inspected SHA-256 or case revision.');
  return value;
}
function caseId(value) {
  if (typeof value !== 'string' || !new RegExp(uuid.pattern).test(value)) throw failure('INVALID_CASE_ID', 'Use an original case UUID.');
  return value;
}
function configurationRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw failure('INVALID_PARAMS', 'Use the exact current original configuration revision.');
  return value;
}
function originalWatchError(error) {
  if (/^[A-Z][A-Z0-9_]+$/.test(error.code ?? '')) return error.code;
  if (/^(SF93|FLEET)_[A-Z0-9_]+$/.test(error.message ?? '')) return error.message;
  return 'INCIDENT_WATCH_FAILED';
}
function configurationChanges(before, after) {
  const prior = new Map(before.merchants.map(row => [row.id, row])), next = new Map(after.merchants.map(row => [row.id, row]));
  return { addedMerchants: [...next.keys()].filter(id => !prior.has(id)),
    removedMerchants: [...prior.keys()].filter(id => !next.has(id)),
    changedMerchants: [...next.keys()].filter(id => prior.has(id) && JSON.stringify(prior.get(id)) !== JSON.stringify(next.get(id))),
    merchantOrderChanged: JSON.stringify([...prior.keys()]) !== JSON.stringify([...next.keys()]),
    settings: Object.keys(after).filter(key => !['schema', 'merchants'].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) };
}
function draftTerms(workspace) {
  if (!workspace.termsText) throw failure('CASE_TERMS_REQUIRED', 'Record the owner terms in this case before creating its workorder.');
  const value = JSON.parse(workspace.termsText);
  exact(value, ['schema', 'values'], ['schema', 'values']);
  if (value.schema !== DRAFT_SCHEMA) throw failure('CASE_TERMS_INVALID', 'Open this case in the original support console and review its terms.');
  return termsDocumentFromDraft(value.values);
}
function ownerDraft(terms) {
  exact(terms, Object.keys(termsSchema.properties), termsSchema.required);
  exact(terms.merchantConsent, Object.keys(termsSchema.properties.merchantConsent.properties), ['status']);
  exact(terms.commercial, Object.keys(termsSchema.properties.commercial.properties), ['priceApproval']);
  const values = termsDraftFromDocument(terms);
  for (const [key, value] of Object.entries(values)) {
    if (value.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
        !['deliveryScope', 'deliverables', 'acceptanceCriteria'].includes(key) && /[\r\n\t]/.test(value))
      throw failure('INVALID_PARAMS', 'Owner terms must reopen in their original form fields. Use delivery fields for multiline text.');
  }
  return JSON.stringify({ schema: DRAFT_SCHEMA, values });
}
function sourcePacket(record, workspace, options = {}) {
  const terms = draftTerms(workspace), inputs = { terms: Buffer.from(json(terms)).toString('base64') };
  if (workspace.workorderSource === 'runtime') {
    if (!record.supportText) throw failure('CASE_RUNTIME_REQUIRED', 'This case has no retained runtime capture.');
    inputs.supportText = record.supportText; inputs.inputs = workspace.inputs;
  } else {
    inputs.before = workspace.sources.before;
    if (!workspace.baselineOnly && workspace.sources.after) {
      inputs.after = workspace.sources.after;
      if (Boolean(workspace.sources.postBefore) !== Boolean(workspace.sources.postAfter))
        throw failure('CASE_SOURCE_PAIR_REQUIRED', 'Keep both original browser checks or clear the unpaired check in the support console.');
      if (workspace.sources.postBefore) { inputs.postBefore = workspace.sources.postBefore; inputs.postAfter = workspace.sources.postAfter; }
    }
  }
  const result = workorderFromSources(inputs,options);
  result.packet.caseSource = { id: record.id, revision: record.revision, workspaceSha256: sha(record.workspaceText),
    supportSha256: record.supportText === null ? null : sha(record.supportText) };
  return { ...result, terms };
}
async function caseView(record) {
  const { workspaceText, supportText, ...summary } = record, workspace = await parseWorkspace(workspaceText);
  let terms = null, termsIssue = null;
  try { terms = draftTerms(workspace); } catch (error) { termsIssue = error.code ?? 'CASE_TERMS_DRAFT_INCOMPLETE'; }
  return { ...summary, workorderSource: workspace.workorderSource ?? 'diagnostic', baselineOnly: workspace.baselineOnly,
    workspaceSha256: sha(workspaceText), supportSha256: supportText === null ? null : sha(supportText),
    terms, termsIssue, termsText: workspace.termsText,
    ...(workspace.commissioning?{implementation:commissioningSummary(workspace.commissioning)}:{}),
    ...(workspace.service?{service:serviceSummary(workspace.service)}:{}),
    runtimeReview: supportText === null ? null : reviewRuntime(supportText, workspace.inputs) };
}


/** Same original completion format for host verification and client persistence. */
export function parseSupportExportManifest(bytes, exportId) {
  identifier(exportId, 'Export ID');
  if (bytes.length > 65000) throw failure('SUPPORT_EXPORT_INVALID', 'The original support export manifest is oversized.');
  let manifest;
  try { manifest = JSON.parse(decode(bytes)); }
  catch { throw failure('SUPPORT_EXPORT_INVALID', 'The original support export manifest is not valid UTF-8 JSON.'); }
  const invalid = () => { throw failure('SUPPORT_EXPORT_INVALID', 'The original support export manifest is inconsistent.'); };
  if (manifest?.schema !== EXPORT_SCHEMA || manifest.exportId !== exportId || !Array.isArray(manifest.files) ||
      manifest.files.length < 2 || manifest.files.length > exportNames.length || typeof manifest.workorderIncluded !== 'boolean' ||
      !manifest.case || !new RegExp(uuid.pattern).test(manifest.case.id) || !new RegExp(digest.pattern).test(manifest.case.revision) ||
      !new RegExp(digest.pattern).test(manifest.case.workspaceSha256) ||
      manifest.case.supportSha256 !== null && !new RegExp(digest.pattern).test(manifest.case.supportSha256)) invalid();
  const names = new Set();
  for (const file of manifest.files) {
    if (!file || !exportNames.includes(file.name) || names.has(file.name) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_HANDOFF_BYTES ||
        typeof file.sha256 !== 'string' || !new RegExp(digest.pattern).test(file.sha256)) invalid();
    names.add(file.name);
  }
  if (!names.has('case.json') || !names.has('merchant-workspace.json') ||
      manifest.files.find(file => file.name === 'merchant-workspace.json').sha256 !== manifest.case.workspaceSha256 ||
      ['merchant-support.json', 'support.html'].some(name => names.has(name) !== (manifest.case.supportSha256 !== null)) ||
      ['owner-terms.json', 'packet.json', 'seller-packet.html', 'acceptance-checklist.md'].some(name => names.has(name) !== manifest.workorderIncluded)) invalid();
  const implementationFiles=['merchant-commissioning.json','merchant-implementation.html','merchant-implementation-tasks.csv'];
  if(implementationFiles.some(name=>names.has(name))&&!implementationFiles.every(name=>names.has(name)))invalid();
  const serviceReportFiles=['merchant-service-report.json','merchant-service-report.csv','merchant-service-report.html'];
  if(serviceReportFiles.some(name=>names.has(name))&&(!names.has('merchant-service.json')||!serviceReportFiles.every(name=>names.has(name))))invalid();
  return manifest;
}
function exportFileType(name) {
  return name.endsWith('.json') ? 'application/json' : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8';
}

export class MerchantSupport {
  #config; #store; #commercial; #watch = null; #lastWatchExit = null; #closing = false; #close; #incidentSources; #environment;
  #reads = new RetainedFileReads({ errorPrefix: 'SUPPORT' });
  constructor(config, { environment = process.env } = {}) {
    this.#config = config; this.#environment = environment;
    this.#commercial=merchantCommercial({cases:()=>this.#cases(),casesDirectory:()=>this.#configured().casesDirectory,
      exportsDirectory:()=>this.#config.exportsDirectory,reads:this.#reads,environment});
    this.#incidentSources = new MerchantSupportIncidentSources(config.support, {
      profiles: () => this.summary.profiles,
      profile: (alias, sourceDigest) => this.#profile(alias, sourceDigest),
      configurationChanges,
      template: (alias, sourceDigest) => this.#input('workspace', alias, sourceDigest),
      cases: () => this.#cases()
    }, { environment });
  }
  get summary() {
    const value = this.#config.support;
    return { configured: Boolean(value), incidentsConfigured: Boolean(value?.incidentsDirectory || value?.incidentSourcesFile),
      incidentSources: this.#incidentSources.summary,
      fileReads: this.#reads.summary,
      watcher: { ownedInstanceId: this.#watch?.instanceId ?? null, state: this.#watch?.state ?? 'NOT_OWNED', lastExit: this.#lastWatchExit },
      profiles: Object.entries(value?.profiles ?? {}).map(([profile, entry]) => ({ profile, label: entry.label })),
      sources: value ? ['handoffs', 'workspaces'].flatMap(kind => Object.entries(value[kind]).map(([source, entry]) =>
        ({ kind: kind === 'handoffs' ? 'handoff' : 'workspace', source, label: entry.label }))) : [] };
  }
  #configured() {
    if (!this.#config.support) throw failure('SUPPORT_NOT_CONFIGURED', 'Add supportConnection to the host merchant configuration, then restart this MCP operator.');
    return this.#config.support;
  }
  async #cases() { return this.#store ??= openCaseStore(this.#configured().casesDirectory); }
  #incidents() {
    const directory = this.#configured().incidentsDirectory;
    if (!directory) throw failure('INCIDENTS_NOT_CONFIGURED', 'Register the existing SF93 incident directory in the host support connection.');
    return directory;
  }
  async #profile(profile, sourceDigest) {
    const entry = (this.#configured().profiles ?? {})[identifier(profile, 'Support profile alias')];
    if (!entry) throw failure('SUPPORT_PROFILE_NOT_FOUND', 'Choose a host profile returned by merchant_support_profiles.');
    const bytes = await readPrivateFile(entry.file, 65536), sourceSha256 = sha(bytes);
    if (sourceDigest !== undefined && sourceSha256 !== expected(sourceDigest))
      throw failure('SUPPORT_SOURCE_CHANGED', 'The configured profile changed. Inspect its actual original configuration before applying it.');
    const configuration = compileWatchConfig(JSON.parse(decode(bytes)));
    return { profile, label: entry.label, sourceSha256, configHash: watchConfigHash(configuration), configuration };
  }
  async #profiles(profile) {
    const state = await (await openIncidentStore(this.#incidents())).read();
    const current = { configRevision: state.configRevision, configHash: state.configHash, configuration: state.config };
    if (profile === undefined) return { profiles: this.summary.profiles, current };
    const selected = await this.#profile(profile);
    return { ...selected, current, matchesCurrent: selected.configHash === state.configHash,
      changes: configurationChanges(state.config, selected.configuration) };
  }
  async #watchStatus() {
    const state = await incidentStatus({ directory: this.#incidents() });
    return { schema: 'stellar-forge.merchant-support-watch.v1', configRevision: state.configRevision,
      configHash: state.configHash, worker: state.worker,
      owned: this.#watch ? { instanceId: this.#watch.instanceId, state: this.#watch.state,
        startedConfiguration: this.#watch.startedConfiguration } : null,
      lastOwnedExit: this.#lastWatchExit };
  }
  #watchExited(handle, error) {
    handle.state = error ? 'FAILED' : 'STOPPED';
    this.#lastWatchExit = { instanceId: handle.instanceId, state: handle.state,
      completedAt: new Date().toISOString(), code: error ? originalWatchError(error) : null };
    if (this.#watch === handle) this.#watch = null;
  }
  async #startWatch(args) {
    const directory = this.#incidents();
    configurationRevision(args.expectedConfigRevision); expected(args.expectedConfigHash);
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'Merchant support is closing.');
    if (this.#watch) throw failure('INCIDENT_WATCH_ALREADY_OWNED', 'This operator already owns a watcher. Read merchant_support_watch_status.');
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const handle = { controller: new AbortController(), instanceId: null, state: 'STARTING', startedConfiguration: null, done: null };
    this.#watch = handle;
    handle.done = runIncidentWatch({ directory, signal: handle.controller.signal, environment: this.#environment,
      expectedConfigRevision: args.expectedConfigRevision, expectedConfigHash: args.expectedConfigHash,
      onReady: value => {
        handle.instanceId = value.instanceId; handle.state = 'RUNNING';
        handle.startedConfiguration = { configRevision: value.configRevision, configHash: value.configHash };
        resolveReady();
      } }).then(result => {
        this.#watchExited(handle);
        if (!handle.instanceId) rejectReady(failure('INCIDENT_WATCH_NOT_STARTED', 'The original watcher ended before it became ready.'));
        return result;
      }, error => { this.#watchExited(handle, error); rejectReady(error); throw error; });
    // Keep a background failure visible in status without an unhandled rejection.
    handle.done.catch(() => {});
    await ready;
    return this.#watchStatus();
  }
  async #stopWatch(instanceId) {
    caseId(instanceId);
    const handle = this.#watch;
    if (!handle && this.#lastWatchExit?.instanceId === instanceId && this.#lastWatchExit.state === 'STOPPED')
      return { ...await this.#watchStatus(), unchanged: true };
    if (!handle || handle.instanceId !== instanceId)
      throw failure('INCIDENT_WATCH_INSTANCE_CONFLICT', 'This MCP operator does not own that watcher instance. Read merchant_support_watch_status.');
    handle.state = 'STOPPING'; handle.controller.abort(); await handle.done;
    return this.#watchStatus();
  }
  async #notifications(args) {
    const state = await incidentStatus({ directory: this.#incidents() }), offset = args.offset ?? 0, limit = args.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        args.status !== undefined && !notificationStatuses.includes(args.status)) throw failure('INVALID_PARAMS', 'Use a valid notification state and page.');
    if (args.id !== undefined) caseId(args.id);
    if (args.incidentId !== undefined) caseId(args.incidentId);
    const found = state.notifications.filter(row => (args.id === undefined || row.id === args.id) &&
      (args.incidentId === undefined || row.incidentId === args.incidentId) && (args.status === undefined || row.status === args.status));
    return { directoryRevision: state.directoryRevision, notifications: found.slice(offset, offset + limit),
      total: found.length, offset, limit, nextOffset: offset + limit < found.length ? offset + limit : null,
      notificationCapacityEvents: state.notificationCapacityEvents };
  }
  async #input(kind, source, digest) {
    if (!['handoff', 'workspace'].includes(kind)) throw failure('INVALID_PARAMS', 'Choose handoff or workspace.');
    const entry = this.#configured()[kind === 'handoff' ? 'handoffs' : 'workspaces'][identifier(source, 'Support source alias')];
    if (!entry) throw failure('SUPPORT_SOURCE_NOT_FOUND', 'Choose an alias returned by merchant_support_sources.');
    const bytes = await readPrivateFile(entry.file, kind === 'handoff' ? MAX_HANDOFF_BYTES : MAX_WORKSPACE_BYTES);
    const sourceSha256 = sha(bytes);
    if (digest !== undefined && sourceSha256 !== expected(digest)) throw failure('SUPPORT_SOURCE_CHANGED', 'The configured input changed. Inspect its actual digest and mapping before importing it.');
    const value = kind === 'handoff' ? await importRuntimeHandoff(decode(bytes)) : { workspaceText: decode(bytes), supportText: null, metadata: {} };
    await parseWorkspace(value.workspaceText);
    return { ...value, kind, source, label: entry.label, sourceSha256, bytes: bytes.length, file: entry.file };
  }
  async #selected(args) {
    expected(args.expectedRevision);
    const record = await (await this.#cases()).read(caseId(args.id));
    if (record.currentRevision !== args.expectedRevision) throw failure('CASE_CONFLICT', 'A newer original case revision exists. Reopen the case before this operation.');
    return record;
  }
  async #update(args) {
    const record = await (await this.#cases()).read(caseId(args.id), expected(args.expectedRevision)), workspace = await parseWorkspace(record.workspaceText);
    if (!['metadata', 'terms', 'workorderSource', 'baselineOnly'].some(key => Object.hasOwn(args, key)))
      throw failure('INVALID_PARAMS', 'Provide a case metadata, terms or source-choice change.');
    if (args.workorderSource !== undefined && !['runtime', 'diagnostic'].includes(args.workorderSource) ||
        args.baselineOnly !== undefined && typeof args.baselineOnly !== 'boolean') throw failure('INVALID_PARAMS', 'Invalid saved workorder choice.');
    const metadata = args.metadata === undefined ? record.metadata : caseMetadata({ ...record.metadata, ...args.metadata });
    if (args.metadata !== undefined) exact(args.metadata, Object.keys(metadataSchema.properties));
    const next = workspaceDraft(workspace,{baselineOnly:args.baselineOnly??workspace.baselineOnly,
      workorderSource:args.workorderSource??workspace.workorderSource??'diagnostic'});
    if (args.terms !== undefined) next.termsText = ownerDraft(args.terms);
    // Keep the original save timestamp: metadata/terms updates do not change source observations,
    // and an identical request can use the original case writer's lost-response retry handling.
    const workspaceText = ['terms', 'workorderSource', 'baselineOnly'].some(key => Object.hasOwn(args, key))
      ? await serializeWorkspace(next, { now: workspace.savedAt }) : record.workspaceText;
    return (await this.#cases()).save({ id: args.id, expectedRevision: args.expectedRevision,
      workspaceText, supportText: record.supportText, metadata });
  }
  async #exportRequest(exportId) {
    const root=await privateSupportDirectory(this.#config.exportsDirectory),folder=join(root,identifier(exportId,'Export ID'));
    let bytes;
    try{bytes=await readPrivateFile(join(root,'.support-export-request-'+exportId+'.json'),65000);}
    catch(error){if(error.code!=='ENOENT')throw error;await privateSupportDirectory(folder);
      bytes=await readPrivateFile(join(folder,'support-export-request.json'),65000);}
    let intent;try{intent=JSON.parse(decode(bytes));}catch{throw failure('SUPPORT_EXPORT_INVALID','The original export request is unreadable.');}
    exact(intent,['schema','exportId','request','manifest'],['schema','exportId','request','manifest']);
    if(intent.schema!=='stellar-forge.merchant-support-export-request.v1'||intent.exportId!==exportId)
      throw failure('SUPPORT_EXPORT_INVALID','The original export request identity differs.');
    exact(intent.request,['id','expectedRevision','includeWorkorder'],['id','expectedRevision','includeWorkorder']);
    caseId(intent.request.id);expected(intent.request.expectedRevision);
    if(typeof intent.request.includeWorkorder!=='boolean')throw failure('SUPPORT_EXPORT_INVALID','The original workorder selection differs.');
    const manifest=parseSupportExportManifest(Buffer.from(json(intent.manifest)),exportId);
    if(manifest.case.id!==intent.request.id||manifest.case.revision!==intent.request.expectedRevision||
      manifest.workorderIncluded!==intent.request.includeWorkorder||
      typeof manifest.createdAt!=='string'||!Number.isFinite(Date.parse(manifest.createdAt))||new Date(manifest.createdAt).toISOString()!==manifest.createdAt)
      throw failure('SUPPORT_EXPORT_INVALID','The original export request and completion plan differ.');
    return intent;
  }
  async #export(args) {
    if(args.includeWorkorder!==undefined&&typeof args.includeWorkorder!=='boolean')
      throw failure('INVALID_PARAMS','includeWorkorder must be a boolean.');
    const exportId=identifier(args.exportId,'Export ID'),request={id:caseId(args.id),
      expectedRevision:expected(args.expectedRevision),includeWorkorder:args.includeWorkorder??false};
    const root=await privateSupportDirectory(this.#config.exportsDirectory),folder=join(root,exportId);
    const matches=manifest=>manifest.case.id===request.id&&manifest.case.revision===request.expectedRevision&&
      manifest.workorderIncluded===request.includeWorkorder;
    const status=await this.#exportStatus(exportId);
    if(status.state==='COMPLETE'){
      if(!matches(status))throw failure('SUPPORT_EXPORT_CONFLICT','This export ID belongs to a different original case, revision or workorder selection.');
      return {...status,reused:true};
    }
    let intent=null;
    if(status.state!=='NOT_FOUND'){
      try{intent=await this.#exportRequest(exportId);}
      catch(error){if(error.code!=='ENOENT')throw error;
        throw failure('SUPPORT_EXPORT_REQUEST_REQUIRED','This earlier incomplete export has no retained original request. Its existing files remain available for original-case recovery.');}
      if(json(intent.request)!==json(request))throw failure('SUPPORT_EXPORT_CONFLICT','This export ID belongs to a different original request.');
    }
    const record=intent?await(await this.#cases()).read(request.id,request.expectedRevision):await this.#selected(args);
    const workspace=await parseWorkspace(record.workspaceText),generatedAt=intent?.manifest.createdAt??new Date().toISOString();
    const generated=request.includeWorkorder?sourcePacket(record,workspace,{generatedAt}):null;
    const {workspaceText,supportText,...summary}=record;summary.currentRevision=record.revision;
    const files=[['case.json',json(summary)],['merchant-workspace.json',workspaceText]];
    if(supportText!==null){
      const handoff=await exportRuntimeHandoff({workspaceText,supportText,metadata:record.metadata,generatedAt});
      files.push(['merchant-support.json',handoff.handoff],['support.html',handoff.html]);
    }
    if(workspace.commissioning)files.push(['merchant-commissioning.json',json(workspace.commissioning)],
      ['merchant-implementation.html',commissioningReport(workspace.commissioning)],
      ['merchant-implementation-tasks.csv',commissioningTasksCsv(workspace.commissioning)]);
    if(workspace.service){
      files.push(['merchant-service.json',json(workspace.service)]);
      const selected=workspace.service.reports.find(report=>report.id===workspace.service.draft?.report?.selectedReportId)
        ??workspace.service.reports.at(-1);
      if(selected)files.push(['merchant-service-report.json',json(selected)],
        ['merchant-service-report.csv',serviceReportCsv(selected)],['merchant-service-report.html',renderServiceReport(selected)]);
    }
    if(generated)files.push(['owner-terms.json',json(generated.terms)],['packet.json',json(generated.packet)],
      ['seller-packet.html',generated.html],['acceptance-checklist.md',generated.checklist]);
    const manifest={schema:EXPORT_SCHEMA,exportId,createdAt:generatedAt,
      case:{id:record.id,revision:record.revision,workspaceSha256:sha(workspaceText),supportSha256:supportText===null?null:sha(supportText)},
      workorderIncluded:request.includeWorkorder,files:files.map(([name,body])=>({name,bytes:Buffer.byteLength(body),sha256:sha(body)}))};
    const resumed=Boolean(intent);
    if(intent){
      if(json(intent.manifest)!==json(manifest))
        throw failure('SUPPORT_EXPORT_SOURCE_CHANGED','The retained case or original export rendering differs from this export request.');
    }else{
      intent={schema:'stellar-forge.merchant-support-export-request.v1',exportId,request,manifest};
      try{
        // The original atomic case writer publishes the request before the
        // directory. A stopped process can therefore resume even if mkdir or
        // the first customer file has not run yet.
        await retainCaseArtifact(join(root,'.support-export-request-'+exportId+'.json'),Buffer.from(json(intent)));
      }catch(error){
        if(error.code!=='CASE_STORAGE_INVALID')throw error;
        const accepted=await this.#exportRequest(exportId);
        if(json(accepted.request)!==json(request))throw failure('SUPPORT_EXPORT_CONFLICT','This export ID belongs to a different original request.');
        return this.#export(args);
      }
    }
    try{await mkdir(folder,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    await privateSupportDirectory(folder);
    await retainCaseArtifact(join(folder,'support-export-request.json'),Buffer.from(json(intent)));
    for(const[name,body]of files)await retainCaseArtifact(join(folder,name),Buffer.from(body));
    await retainCaseArtifact(join(folder,'support-export.json'),Buffer.from(json(intent.manifest)));
    return {...intent.manifest,state:'COMPLETE',reused:false,resumed};
  }
  async #exportStatus(exportId) {
    identifier(exportId, 'Export ID'); const folder = join(this.#config.exportsDirectory, exportId);
    try { await privateSupportDirectory(folder); }
    catch (error) {
      if(error.code!=='ENOENT')throw error;
      let original=null;try{original=await this.#exportRequest(exportId);}catch(requestError){if(requestError.code!=='ENOENT')throw requestError;}
      return original?{exportId,state:'INCOMPLETE_OR_OTHER_EXPORT',request:{...original.request,exportId},
        action:'Repeat this original merchant_case_export request to complete the retained delivery.'}:{exportId,state:'NOT_FOUND'};
    }
    let value;
    try { value = await this.#readExportManifest(exportId); }
    catch (error) {
      if(error.code!=='ENOENT')throw error;
      let original=null;try{original=await this.#exportRequest(exportId);}catch(requestError){if(requestError.code!=='ENOENT')throw requestError;}
      return {exportId,state:'INCOMPLETE_OR_OTHER_EXPORT',...(original?{request:{...original.request,exportId},
        action:'Repeat this original merchant_case_export request to complete the retained delivery.'}:
        {action:'Inspect the existing original case files to recover this earlier export.'})};
    }
    const { manifest } = value;
    for (const file of manifest.files) {
      const bytes = await readPrivateFile(join(folder, file.name), MAX_HANDOFF_BYTES);
      if (bytes.length !== file.bytes || sha(bytes) !== expected(file.sha256)) throw failure('SUPPORT_EXPORT_CHANGED', 'A retained support export file differs from its original completion manifest.');
    }
    return { ...manifest, state: 'COMPLETE' };
  }
  async #readExportManifest(exportId) {
    identifier(exportId, 'Export ID');
    const folder = await privateSupportDirectory(join(this.#config.exportsDirectory, exportId));
    const bytes = await readPrivateFile(join(folder, 'support-export.json'), 65000);
    return { folder, bytes, manifest: parseSupportExportManifest(bytes, exportId),
      manifestFile: { name: 'support-export.json', contentType: 'application/json', bytes: bytes.length, sha256: sha(bytes) } };
  }
  async #exportManifest(exportId) {
    const value = await this.#readExportManifest(exportId);
    return { ...value.manifest, state: 'MANIFEST_RETAINED', manifestFile: value.manifestFile, fileReads: this.#reads.status(exportId) };
  }
  async #exportFile(args) {
    const exportId = identifier(args.exportId, 'Export ID'), manifestSha256 = expected(args.expectedManifestSha256);
    if (![...exportNames, 'support-export.json'].includes(args.file)) throw failure('INVALID_PARAMS', 'Choose a filename from the original support export manifest.');
    if (args.readId !== undefined) caseId(args.readId);
    return { exportId, manifestSha256, ...await this.#reads.read({ scope: exportId,
      key: JSON.stringify([exportId, args.file, manifestSha256]), kind: 'support-export',
      directory: join(this.#config.exportsDirectory, exportId), readId: args.readId, offset: args.offset,
      limit: args.limit, expectedSha256: args.expectedSha256,
      load: async () => {
        const value = await this.#readExportManifest(exportId);
        if (value.manifestFile.sha256 !== manifestSha256)
          throw failure('SUPPORT_EXPORT_CHANGED', 'The retained completion manifest differs from the inspected export.');
        const file = args.file === 'support-export.json' ? value.manifestFile : value.manifest.files.find(file => file.name === args.file);
        if (!file) throw failure('SUPPORT_EXPORT_FILE_NOT_FOUND', 'This completed export does not contain that support file.');
        const bytes = args.file === 'support-export.json' ? value.bytes : await readPrivateFile(join(value.folder, file.name), MAX_HANDOFF_BYTES);
        if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
          throw failure('SUPPORT_EXPORT_CHANGED', 'A retained support export file differs from its original completion manifest.');
        return { bytes, name: file.name, type: exportFileType(file.name) };
      } }) };
  }
  async call(name, args) {
    this.#configured();
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'Merchant support is closing.');
    try {
      return await (async () => {
      if(this.#commercial.handles(name))return this.#commercial.call(name,args);
      if(name==='merchant_service_read')return readServiceCase({store:await this.#cases(),args});
      if(name==='merchant_service_change')return changeServiceCase({store:await this.#cases(),args,readSnapshot:input=>this.#incidentSources.serviceSnapshot(input)});
      if(name==='merchant_service_preview')return previewServiceCase({store:await this.#cases(),args});
      if(name==='merchant_service_report')return readServiceCaseReport({store:await this.#cases(),args});
      if (this.#incidentSources.handles(name)) return this.#incidentSources.call(name, args);
      if (args.incidentSource !== undefined)
        throw failure('SUPPORT_INCIDENT_SOURCE_NOT_FOUND', 'This connection uses its original single incident store; omit incidentSource or select a host source file.');
      switch (name) {
        case 'merchant_support_profiles': return this.#profiles(args.profile);
        case 'merchant_support_configure': {
          configurationRevision(args.expectedConfigRevision); expected(args.expectedSourceSha256);
          const selected = await this.#profile(args.profile, args.expectedSourceSha256);
          const result = await configureIncidents({ directory: this.#incidents(), config: selected.configuration,
            expectedConfigRevision: args.expectedConfigRevision, environment: this.#environment });
          return { ...result, profile: selected.profile, sourceSha256: selected.sourceSha256,
            unchanged: result.configRevision === args.expectedConfigRevision };
        }
        case 'merchant_support_watch_status': return this.#watchStatus();
        case 'merchant_support_watch_start': return this.#startWatch(args);
        case 'merchant_support_watch_stop': return this.#stopWatch(args.instanceId);
        case 'merchant_notifications': return this.#notifications(args);
        case 'merchant_incident_notify': {
          if (args.expectedNotificationId !== undefined && args.expectedNotificationId !== null) caseId(args.expectedNotificationId);
          return remindIncident({ directory: this.#incidents(), id: caseId(args.id), expectedRevision: configurationRevision(args.expectedRevision), environment: this.#environment,
            ...(Object.hasOwn(args, 'expectedNotificationId') ? { expectedNotificationId: args.expectedNotificationId } : {}) });
        }
        case 'merchant_notification_update': {
          if (!Number.isSafeInteger(args.expectedAttempts) || args.expectedAttempts < 0 || !['retry', 'cancel'].includes(args.action))
            throw failure('INVALID_PARAMS', 'Choose retry or cancel with the exact original notification attempt count.');
          return operateNotification({ directory: this.#incidents(), id: caseId(args.id), expectedAttempts: args.expectedAttempts, action: args.action, by: args.by, environment: this.#environment });
        }
        case 'merchant_support_sources': {
          if (args.source === undefined && args.kind === undefined) return this.summary;
          if (args.source === undefined || args.kind === undefined) throw failure('INVALID_PARAMS', 'Inspect a source with both kind and source alias.');
          const value = await this.#input(args.kind, args.source), workspace = await parseWorkspace(value.workspaceText);
          return { kind: value.kind, source: value.source, label: value.label, bytes: value.bytes, sourceSha256: value.sourceSha256,
            name: workspace.name, inputs: workspace.inputs, metadata: caseMetadata(value.metadata), workspace: workspace.summary,
            workorderSource: workspace.workorderSource ?? 'diagnostic', runtimeReview: value.supportText === null ? null : reviewRuntime(value.supportText, workspace.inputs) };
        }
        case 'merchant_incidents': {
          const value = await incidentStatus({ directory: this.#incidents(), details: true }), offset = args.offset ?? 0, limit = args.limit ?? 50;
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
              args.status !== undefined && !['OPEN', 'ACKNOWLEDGED', 'RECOVERED', 'RETIRED'].includes(args.status)) throw failure('INVALID_PARAMS', 'Use a valid incident status and page.');
          if (args.id !== undefined) caseId(args.id);
          const found = value.incidents.filter(row => (args.id === undefined || row.id === args.id) && (args.status === undefined || row.status === args.status));
          const incidents = found.slice(offset, offset + limit), ids = new Set(incidents.map(row => row.id));
          return { schema: value.schema, directoryRevision: value.directoryRevision, configRevision: value.configRevision, configHash: value.configHash,
            worker: value.worker, active: value.active, incidents, total: found.length, offset, limit,
            nextOffset: offset + limit < found.length ? offset + limit : null,
            notifications: value.notifications.filter(row => ids.has(row.incidentId)), captureStorage: value.captureStorage };
        }
        case 'merchant_incident_ack': return acknowledgeIncident({ directory: this.#incidents(), id: caseId(args.id), expectedRevision: args.expectedRevision, by: args.by, notes: args.notes, environment: this.#environment });
        case 'merchant_incident_case': {
          caseId(args.id); caseId(args.incidentId); expected(args.expectedTemplateSha256);
          if (typeof args.routeId !== 'string' || !args.routeId || args.routeId.length > 160) throw failure('INVALID_PARAMS', 'Choose an actual route ID from the original capture.');
          const template = await this.#input('workspace', args.template, args.expectedTemplateSha256);
          const temporary = await mkdtemp(join(await privateSupportDirectory(this.#config.exportsDirectory), '.incident-'));
          try {
            // Snapshot the inspected original template to close a host-edit race before SF93 reads it.
            const workspaceFile = join(temporary, 'workspace.json'); await writePrivate(workspaceFile, template.workspaceText);
            const out = join(temporary, 'original');
            await exportIncident({ directory: this.#incidents(), id: args.incidentId, expectedRevision: args.expectedIncidentRevision,
              workspaceFile, routeId: args.routeId, out });
            const handoff = await importRuntimeHandoff(decode(await readPrivateFile(join(out, 'support-handoff.json'), MAX_HANDOFF_BYTES)));
            return { ...await (await this.#cases()).save({ id: args.id, expectedRevision: null, ...handoff }),
              incident: { id: args.incidentId, revision: args.expectedIncidentRevision }, templateSha256: template.sourceSha256 };
          } finally { await rm(temporary, { recursive: true, force: true }); }
        }
        case 'merchant_cases': return (await this.#cases()).list(args);
        case 'merchant_case_read': return caseView(await (await this.#cases()).read(args.id, args.revision ?? null));
        case 'merchant_case_history': { const { id, ...options } = args; return (await this.#cases()).history(id, options); }
        case 'merchant_case_import': {
          if (args.expectedRevision !== undefined) throw failure('INVALID_PARAMS', 'Import creates a new case; use merchant_case_update for an existing case.');
          expected(args.expectedSourceSha256); caseId(args.id);
          const input = await this.#input('handoff', args.source, args.expectedSourceSha256);
          return { ...await (await this.#cases()).save({ id: args.id, expectedRevision: null, workspaceText: input.workspaceText,
            supportText: input.supportText, metadata: caseMetadata(input.metadata) }), sourceSha256: input.sourceSha256 };
        }
        case 'merchant_case_update': return this.#update(args);
        case 'merchant_case_restore': {
          expected(args.expectedRevision);
          const record = await (await this.#cases()).read(args.id, expected(args.revision));
          return (await this.#cases()).save({ id: args.id, expectedRevision: args.expectedRevision,
            workspaceText: record.workspaceText, supportText: record.supportText, metadata: record.metadata });
        }
        case 'merchant_case_workorder': {
          const record = await this.#selected(args), workspace = await parseWorkspace(record.workspaceText);
          return { case: { id: record.id, revision: record.revision }, packet: sourcePacket(record, workspace).packet };
        }
        case 'merchant_case_implementation': return inspectCaseCommissioning(await this.#cases(),args);
        case 'merchant_case_implementation_prepare': return prepareCaseCommissioning(await this.#cases(),args);
        case 'merchant_case_implementation_apply': return operateCaseCommissioning(await this.#cases(),args);
        case 'merchant_case_export': return this.#export(args);
        case 'merchant_support_export_status': return this.#exportStatus(args.exportId);
        case 'merchant_support_export_manifest': return this.#exportManifest(args.exportId);
        case 'merchant_support_export_file': return this.#exportFile(args);
        case 'merchant_support_export_file_release':
          await this.#reads.release(identifier(args.exportId, 'Export ID'), caseId(args.readId));
          return { exportId: args.exportId, readId: args.readId, released: true };
        default: throw failure('TOOL_NOT_FOUND', 'Unknown merchant support operation.');
      }
      })();
    } catch (error) {
      // Preserve original conflict/validation codes; filesystem failures expose no host paths.
      if (error.path || error.syscall) throw failure('SUPPORT_STORAGE_UNAVAILABLE', 'Host support storage could not complete normally. Inspect the original saved case or export before retrying.');
      if (/^(SF93|FLEET)_[A-Z0-9_]+$/.test(error.message ?? '')) throw failure(error.message, 'Original incident operation: ' + error.message + '. Read current incident state before retrying.');
      throw error;
    }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      const handle = this.#watch;
      const readsClosing = this.#reads.close(), sourcesClosing = this.#incidentSources.close(), commercialClosing = this.#commercial.close();
      try {
        if (handle) { handle.state = 'STOPPING'; handle.controller.abort(); await handle.done; }
      } finally {
        const results = await Promise.allSettled([readsClosing, sourcesClosing, commercialClosing]);
        const errors = results.filter(value => value.status === 'rejected').map(value => value.reason);
        if (errors.length) throw new AggregateError(errors, 'Original support readers and source watchers did not finish closing.');
      }
    })();
    return this.#close;
  }
}
