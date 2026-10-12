import { usaSpendingWorkspaceTools, read, selected, UUID, page, nativeId, expectedRevision, query, alias, shortText, inEdition, awardKey, strings, inDossier, exportKind, digest, offset, pageSize, RESEARCH_ID, EXPORTS, DIGEST } from './catalog/usaspending-workspace.mjs';
export { usaSpendingWorkspaceTools } from './catalog/usaspending-workspace.mjs';
// MIT. Agent operation of the original USAspending research, delivery and dossier applications.
import { realpath, mkdir, open, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { readBytes, privateDirectory, parse, syncDirectory } from '../../stellar/scf-starforge-20261009/sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { canonical, sha, csv, publicRow, COLUMNS, integer } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/core.mjs';

export const USASPENDING_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.usaspending-workspace-connection.v1';






















const definitions = new Map(usaSpendingWorkspaceTools((name, _description, properties, required) =>
  ({ name, properties, required })).map(item => [item.name, item]));
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare a nonempty original host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw failure('INVALID_PARAMS', 'Select the original ' + label + '.');
  return value;
}
async function canonicalDirectory(directory) {
  await privateDirectory(directory);
  if (await realpath(directory) !== directory)
    throw failure('CONFIGURATION_ERROR', 'Use the original canonical private directory.');
  return directory;
}
async function sourceFile(value, base) {
  const path = hostPath(value, base);
  if (await realpath(path) !== path) throw failure('CONFIGURATION_ERROR', 'Use an original canonical source file.');
  return path;
}

export async function readUSASpendingWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = parse(await readBytes(path, { privateFile: true, max: 1024 * 1024 }), 'USAspending workspace connection');
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== USASPENDING_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between 1 and 32 original award workspaces.');
  const base = dirname(path), directories = new Set(), workspaces = Object.create(null);
  for (const [key, input] of Object.entries(raw.workspaces)) {
    identifier(key, 'USAspending workspace alias');
    exact(input, ['label', 'directory', 'dossierDirectory', 'operator', 'sources', 'deliveries', 'merchant'], ['directory']);
    const directory = await canonicalDirectory(hostPath(input.directory, base));
    const dossierDirectory = input.dossierDirectory === undefined ? join(directory, 'dossiers')
      : await canonicalDirectory(hostPath(input.dossierDirectory, base));
    if (directory === dossierDirectory || directories.has(directory) || directories.has(dossierDirectory))
      throw failure('CONFIGURATION_ERROR', 'Bind each original research and dossier directory through one alias.');
    directories.add(directory); directories.add(dossierDirectory);
    if (input.sources !== undefined && (!plain(input.sources) || Object.keys(input.sources).length > 100))
      throw failure('CONFIGURATION_ERROR', 'Declare up to 100 retained source handles.');
    const sources = Object.create(null);
    for (const [source, item] of Object.entries(input.sources ?? {})) {
      identifier(source, 'Retained source alias');
      exact(item, ['kind', 'file', 'receipt', 'sha256'], ['kind', 'file']);
      if (!['collection', 'capture', 'detail', 'workspace', 'dossier'].includes(item.kind))
        throw failure('CONFIGURATION_ERROR', 'Choose collection, capture, detail, workspace or dossier for the retained source.');
      if ((item.kind === 'detail') !== (item.receipt !== undefined))
        throw failure('CONFIGURATION_ERROR', 'Declare an original receipt only for a detail source.');
      sources[source] = { kind: item.kind, file: await sourceFile(item.file, base),
        ...(item.receipt !== undefined ? { receipt: await sourceFile(item.receipt, base) } : {}),
        ...(item.sha256 !== undefined ? { sha256: checked(item.sha256, DIGEST, 'source SHA256') } : {}) };
    }
    if (input.deliveries !== undefined && (!plain(input.deliveries) || Object.keys(input.deliveries).length > 100))
      throw failure('CONFIGURATION_ERROR', 'Declare up to 100 original delivery handles.');
    const deliveries = Object.create(null);
    for (const [delivery, path] of Object.entries(input.deliveries ?? {})) {
      identifier(delivery, 'Original delivery alias');
      deliveries[delivery] = await canonicalDirectory(hostPath(path, base));
    }
    const merchant = input.merchant ?? {};
    exact(merchant, ['payment', 'origin', 'path', 'defaultLimit', 'maxLimit'], []);
    if ((merchant.payment === undefined) !== (merchant.origin === undefined))
      throw failure('CONFIGURATION_ERROR', 'Declare public merchant payment terms and origin together.');
    if (merchant.payment !== undefined && !plain(merchant.payment))
      throw failure('CONFIGURATION_ERROR', 'Use the original public merchant payment configuration.');
    if (merchant.origin !== undefined) {
      let url; try { url = new URL(merchant.origin); } catch {}
      if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
        throw failure('CONFIGURATION_ERROR', 'Use the selected original HTTPS merchant origin.');
    }
    integer(merchant.defaultLimit ?? 50, 'Default page size', 1, 250);
    integer(merchant.maxLimit ?? 100, 'Maximum page size', merchant.defaultLimit ?? 50, 250);
    workspaces[key] = { label: line(input.label ?? key, 'USAspending workspace label'), directory, dossierDirectory,
      operator: line(input.operator ?? 'USAspending research operator', 'Research operator'), sources, deliveries, merchant };
  }
  return { schema: USASPENDING_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}
function captureView(value) {
  const { owner, error, ...rest } = value;
  return { ...rest, owned: Boolean(owner), error: error ? { code: error.code, message: error.message,
    providerStatus: error.providerStatus ?? null, retryAt: error.retryAt ?? null,
    retainedResponse: typeof error.responseBase64 === 'string',
    receipt: error.receipt ?? null } : null };
}
function dossierSummary(value) {
  const { questions, editions, sources, findings, revisions, providerUsage, unavailableSelections, ...rest } = value;
  return rest;
}
function paged(values, input = {}) {
  const start = integer(input.offset ?? 0, 'Page offset', 0, Number.MAX_SAFE_INTEGER);
  const limit = integer(input.limit ?? 50, 'Page size', 1, 100), snapshot = sha(values);
  if (input.expectedSnapshot !== undefined && checked(input.expectedSnapshot, DIGEST, 'inventory snapshot') !== snapshot)
    throw failure('USASPENDING_INVENTORY_CHANGED', 'The original inventory changed; read page zero and continue its new snapshot.');
  if (start > 0 && input.expectedSnapshot === undefined)
    throw failure('USASPENDING_SNAPSHOT_REQUIRED', 'Continue with the original inventory snapshot.');
  if (start > values.length) throw failure('INVALID_PARAMS', 'Page offset exceeds the original inventory.');
  const items = values.slice(start, start + limit);
  return { total: values.length, snapshot, offset: start, limit, items,
    nextOffset: start + items.length < values.length ? start + items.length : null };
}
function issueCode(issue) {
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(issue?.code ?? '') ? issue.code : 'USASPENDING_OPERATION_FAILED';
}
function safeError(issue) {
  const code = issueCode(issue), error = failure(code, 'Original USAspending operation: ' + code + '. Read its current native state before continuing.');
  for (const key of ['status', 'providerStatus']) if (Number.isInteger(issue?.[key])) error[key] = issue[key];
  if (typeof issue?.captureId === 'string' && RESEARCH_ID.test(issue.captureId)) error.captureId = issue.captureId;
  if (typeof issue?.retryAt === 'string' && Number.isFinite(Date.parse(issue.retryAt))) {
    error.retryAt = issue.retryAt; error.message += ' Provider retry at ' + issue.retryAt + '.';
  }
  if (plain(issue?.usaSpendingImport)) error.usaSpendingImport = issue.usaSpendingImport;
  return error;
}

export class MerchantUSASpendingWorkspaces {
  #config; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'USASPENDING_FILE' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.usaSpendingWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.usaSpendingWorkspaces?.workspaces ?? {}).map(([workspace, definition]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: definition.label, open: Boolean(entry), opening: this.#opening.has(workspace),
          closing: Boolean(entry?.closing), workspaceId: entry?.workspaceId ?? null, instanceId: entry?.instanceId ?? null,
          browserUrl: entry?.service.url ?? null, dossierBrowserUrl: entry?.dossierService.url ?? null,
          sources: Object.entries(definition.sources).map(([source, value]) => ({ source, kind: value.kind, sha256: value.sha256 ?? null })),
          deliveries: Object.keys(definition.deliveries), merchantPaymentConfigured: Boolean(definition.merchant.payment) };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'USAspending workspace alias');
    const definition = this.#config.usaSpendingWorkspaces?.workspaces[alias];
    if (!definition) throw failure('USASPENDING_WORKSPACE_NOT_CONFIGURED', 'Choose a host alias from merchant_usaspending_workspaces.');
    return definition;
  }
  #entry(alias) {
    this.#definition(alias); const entry = this.#entries.get(alias);
    if (!entry) throw failure('USASPENDING_WORKSPACE_NOT_OPEN', 'Open the original award workspace first.');
    if (entry.closing) throw failure('USASPENDING_WORKSPACE_CLOSING', 'This original workspace is draining.');
    return entry;
  }
  #scope(alias) { return 'usaspending:' + alias + ':' + this.#definition(alias).directory; }
  #visible(entry, value) {
    const definition = this.#definition(entry.alias);
    const paths = [definition.directory, definition.dossierDirectory, entry.exportsDirectory].sort((a, b) => b.length - a.length);
    const walk = input => typeof input === 'string'
      ? paths.reduce((text, path) => text.split(path).join('[workspace]'), input)
      : Array.isArray(input) ? input.map(walk)
      : plain(input) ? Object.fromEntries(Object.entries(input).map(([key, value]) => [key, walk(value)])) : input;
    return walk(value);
  }
  async #http(entry, path, body) {
    const response = await fetch(entry.service.origin + path, { method: body === undefined ? 'GET' : 'POST',
      redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'x-research-token': new URL(entry.service.url).hash.slice(1), accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const parts = []; let length = 0;
    for await (const part of response.body) {
      length += part.length;
      if (length > 32 * 1024 * 1024) throw failure('USASPENDING_CONTROL_RESPONSE_TOO_LARGE', 'Use paged native records and complete exports for this workspace.');
      parts.push(part);
    }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, length)));
    if (!response.ok) throw Object.assign(new Error(result.message ?? result.error), result, { code: result.error, status: response.status });
    return result;
  }
  async #state(entry) {
    const native = await this.#http(entry, '/api/state');
    return { workspace: entry.alias, workspaceId: entry.workspaceId, instanceId: entry.instanceId,
      browserUrl: entry.service.url, dossierBrowserUrl: entry.dossierService.url,
      schema: native.schema, operationCount: native.operationCount, columns: native.columns, reviewStatuses: native.reviewStatuses,
      counts: Object.fromEntries(['queries', 'captures', 'editions', 'reviews', 'publications'].map(key => [key, native[key].length])),
      active: native.active, captures: native.captures.filter(item => ['capturing', 'paused', 'error'].includes(item.status)).map(captureView),
      jobs: native.jobs.map(({ result, error, ...job }) => ({ ...job, error, resultAvailable: result !== null })),
      dossiers: await entry.dossiers.list(), fileReads: this.#reads.status(this.#scope(entry.alias)) };
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#entries.has(alias)) return this.#state(this.#entry(alias));
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      const [{ AwardWorkspace }, { serveWorkspace }, imports, merchant, bridge, brief, { openDossierStore }, { startDossierWorkspace }] = await Promise.all([
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/workspace.mjs'),
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/server.mjs'),
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/source-import.mjs'),
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/merchant.mjs'),
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/dossier.mjs'),
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/brief.mjs'),
        import('../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/dossier.mjs'),
        import('../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs'),
      ]);
      let model, service, dossierService;
      try {
        await canonicalDirectory(definition.directory);
        await mkdir(definition.dossierDirectory, { recursive: true, mode: 0o700 });
        await canonicalDirectory(definition.dossierDirectory);
        const exportsDirectory = join(this.#config.exportsDirectory, 'usaspending', alias);
        await mkdir(exportsDirectory, { recursive: true, mode: 0o700 });
        await canonicalDirectory(exportsDirectory);
        model = new AwardWorkspace(definition.directory, { operator: definition.operator });
        service = await serveWorkspace(model, { port: 0 });
        const providers = { usaspending: bridge.createUSAspendingEditionProvider(model) };
        const dossiers = await openDossierStore(definition.dossierDirectory, { providers });
        dossierService = await startDossierWorkspace({ directory: definition.dossierDirectory, providers, port: 0 });
        if (this.#closing) throw failure('USASPENDING_WORKSPACE_CLOSING', 'The merchant operator is closing.');
        const entry = { alias, model, service, dossiers, dossierService, imports, merchant, bridge, brief,
          exportsDirectory, workspaceId: model.state().id, instanceId: randomUUID(), pending: new Set(), closing: null };
        this.#entries.set(alias, entry);
        try { return await this.#state(entry); } catch (issue) { this.#entries.delete(alias); throw issue; }
      } catch (issue) {
        await dossierService?.close().catch(() => {});
        if (service) await service.close().catch(() => {}); else model?.close();
        throw issue;
      }
    })();
    this.#opening.set(alias, opening);
    try { return await opening; } finally { this.#opening.delete(alias); }
  }
  #closeEntry(entry) {
    if (!entry.closing) entry.closing = (async () => {
      await Promise.allSettled([...entry.pending]);
      await this.#reads.closeScope(this.#scope(entry.alias));
      const results = await Promise.allSettled([entry.service.close(), entry.dossierService.close()]);
      if (results.some(result => result.status === 'rejected'))
        throw failure('USASPENDING_SHUTDOWN_INCOMPLETE', 'An original application reported incomplete shutdown.');
      if (this.#entries.get(entry.alias) === entry) this.#entries.delete(entry.alias);
      return { workspace: entry.alias, workspaceId: entry.workspaceId, instanceId: entry.instanceId, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  async #merchant(entry, merchantId) {
    checked(merchantId, RESEARCH_ID, 'merchant ID');
    const publication = entry.model.state().publications.find(item => item.data.merchantId === merchantId);
    if (!publication) throw failure('USASPENDING_MERCHANT_NOT_FOUND', 'Select the original prepared merchant.');
    const directory = join(entry.model.directory, 'merchant', merchantId);
    if (publication.data.directory !== directory || await realpath(directory) !== directory)
      throw failure('USASPENDING_MERCHANT_DIRECTORY_CHANGED', 'Use the original host-owned prepared merchant directory.');
    const original = await entry.merchant.loadMerchant(directory);
    if (original.bundle.id !== merchantId || original.bundle.editionId !== publication.edition_id)
      throw failure('USASPENDING_MERCHANT_BINDING_CHANGED', 'Prepared merchant no longer matches its original publication.');
    return original;
  }
  async #source(entry, input) {
    identifier(input.source, 'Retained source alias');
    const selected = this.#definition(entry.alias).sources[input.source];
    if (!selected) throw failure('USASPENDING_SOURCE_NOT_CONFIGURED', 'Select a retained source handle from merchant_usaspending_workspaces.');
    if (await realpath(selected.file) !== selected.file) throw failure('USASPENDING_SOURCE_CHANGED', 'The original source path changed.');
    if (selected.sha256 !== undefined) {
      const bytes = await readBytes(selected.file, { max: 256000000 });
      if (sha(bytes) !== selected.sha256) throw failure('USASPENDING_SOURCE_CHANGED', 'Retained source bytes differ from the host-selected SHA256.');
    }
    const options = { name: input.name, maxRows: input.maxRows };
    if (selected.kind === 'collection') return entry.imports.importSourceCollection(entry.model, selected.file, options);
    if (selected.kind === 'capture') return entry.imports.importRetainedCapture(entry.model, selected.file, options);
    if (selected.kind === 'detail') {
      if (input.maxRows !== undefined) throw failure('INVALID_PARAMS', 'A detail import does not take a capture row capacity.');
      return entry.imports.importRetainedDetail(entry.model, selected.file, selected.receipt, { name: input.name });
    }
    if (input.name !== undefined || input.maxRows !== undefined)
      throw failure('INVALID_PARAMS', 'Reopen the original complete portable source without changing its original name or capacity.');
    const { value } = await entry.imports.readJsonFile(selected.file, 256000000);
    if (selected.kind === 'workspace') {
      const restored = entry.model.restorePacket(value);
      entry.workspaceId = entry.model.state().id;
      return restored;
    }
    return dossierSummary(await entry.dossiers.reopen(value));
  }
  async #export(entry, input) {
    const format = EXPORTS[input.kind];
    if (!format) throw failure('INVALID_PARAMS', 'Select a supported complete export kind.');
    const { kind, ...selection } = input;
    exact(selection, [...format.required, ...format.optional], format.required);
    let body;
    if (format.file) {
      const original = await this.#merchant(entry, input.merchantId);
      if (format.file === 'seller.json' && !original.bundle.seller)
        throw failure('USASPENDING_PAYMENT_NOT_CONFIGURED', 'This original package is a research dataset without configured seller terms.');
      body = await readBytes(join(original.directory, format.file), { privateFile: true, max: 256000000 });
      if (format.file === 'bundle.json') {
        const publication = entry.model.state().publications.find(item => item.data.merchantId === input.merchantId);
        if (sha(body) !== publication.data.bundleSha256)
          throw failure('USASPENDING_MERCHANT_BINDING_CHANGED', 'The original prepared bundle bytes changed.');
      }
    } else if (kind === 'edition-json') body = entry.model.exportEdition(input.editionId, { includeSourceBytes: true, includeReviews: input.includeReviews ?? false });
    else if (kind === 'edition-csv') body = csv(entry.model.rows(input.editionId).map(publicRow), COLUMNS, { spreadsheet: true });
    else if (kind === 'workspace') body = entry.model.exportPacket();
    else if (kind === 'source-page') body = entry.model.sourcePage(input.captureId, input.page).response;
    else if (kind === 'brief') body = entry.brief.workshareBrief(entry.model, input.editionId, input.awardKey);
    else if (kind === 'comparison') body = entry.model.compare(input.before, input.after);
    else if (kind.startsWith('dossier-')) body = (await entry.dossiers.exportDossier(input.dossierId, { format: kind.slice(8) })).body;
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
    if (bytes.length > 256000000) throw failure('USASPENDING_EXPORT_TOO_LARGE', 'Select an original edition or dossier within the retained-file capacity.');
    const exportId = sha(bytes), name = kind + '-' + exportId + '.' + format.ext;
    const target = join(entry.exportsDirectory, name), temporary = join(entry.exportsDirectory, '.export-' + randomUUID());
    const file = await open(temporary, 'wx', 0o600);
    try {
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, target); }
      catch (issue) {
        if (issue.code !== 'EEXIST') throw issue;
        if (sha(await readBytes(target, { privateFile: true, max: 256000000 })) !== exportId)
          throw failure('USASPENDING_EXPORT_CHANGED', 'The original retained export bytes changed.');
      }
      await syncDirectory(entry.exportsDirectory);
    } finally { await unlink(temporary).catch(issue => { if (issue.code !== 'ENOENT') throw issue; }); }
    return { workspace: entry.alias, workspaceId: entry.workspaceId, kind, exportId, file: { name, contentType: format.type,
      bytes: bytes.length, sha256: exportId }, selection, state: 'EXPORT_RETAINED' };
  }
  async #file(entry, input) {
    const format = EXPORTS[input.kind];
    if (!format) throw failure('INVALID_PARAMS', 'Select the original retained export kind.');
    const exportId = checked(input.exportId, DIGEST, 'retained export SHA256');
    if (input.readId !== undefined) checked(input.readId, UUID, 'file read');
    const name = input.kind + '-' + exportId + '.' + format.ext;
    const result = await this.#reads.read({ scope: this.#scope(entry.alias), key: JSON.stringify([input.kind, exportId]),
      kind: 'usaspending-' + input.kind, directory: entry.exportsDirectory,
      readId: input.readId, expectedSha256: exportId, offset: input.offset, limit: input.limit,
      load: async () => {
        const bytes = await readBytes(join(entry.exportsDirectory, name), { privateFile: true, max: 256000000 });
        if (sha(bytes) !== exportId) throw failure('USASPENDING_EXPORT_CHANGED', 'The original retained export bytes changed.');
        return { bytes, name, type: format.type };
      } });
    return { workspace: entry.alias, kind: input.kind, exportId, ...result };
  }
  async #execute(entry, name, args) {
    const { workspace, ...input } = args, original = entry.model;
    const result = native => ({ workspace, native: this.#visible(entry, native) });
    switch (name) {
      case 'merchant_usaspending_status': return this.#visible(entry, await this.#state(entry));
      case 'merchant_usaspending_inventory': {
        const choices = ['queries', 'captures', 'editions', 'reviews', 'publications', 'dossiers'];
        if (!choices.includes(input.kind)) throw failure('INVALID_PARAMS', 'Select an original inventory kind.');
        let items = input.kind === 'dossiers' ? await entry.dossiers.list() : original.state()[input.kind];
        if (input.kind === 'captures') items = items.map(captureView);
        return result({ kind: input.kind, ...paged(items, input) });
      }
      case 'merchant_usaspending_query_save': return result(original.saveQuery(input));
      case 'merchant_usaspending_query': return result(original.query(input.queryId));
      case 'merchant_usaspending_capture': {
        if (input.captureId !== undefined) {
          if (input.queryId !== undefined || input.queryRevision !== undefined) throw failure('INVALID_PARAMS', 'Resume only the original captureId.');
        } else if (input.queryId === undefined || input.queryRevision === undefined)
          throw failure('INVALID_PARAMS', 'Start with the original queryId and queryRevision, or resume captureId.');
        return result(await this.#http(entry, '/api/captures', input));
      }
      case 'merchant_usaspending_capture_status': return result(captureView(original.captureRecord(input.captureId)));
      case 'merchant_usaspending_capture_capacity': return result(original.resizeCapture(input));
      case 'merchant_usaspending_job': {
        checked(input.jobId, RESEARCH_ID, 'job ID');
        const state = await this.#http(entry, '/api/state'), job = state.jobs.find(item => item.id === input.jobId);
        if (!job) throw failure('USASPENDING_JOB_NOT_IN_THIS_INSTANCE', 'Use status and the durable original capture records after a process restart.');
        return result(job);
      }
      case 'merchant_usaspending_pause': {
        if ((input.jobId === undefined) === (input.captureId === undefined))
          throw failure('INVALID_PARAMS', 'Pause exactly one original jobId or captureId.');
        return result(await this.#http(entry, input.jobId === undefined ? '/api/cancel-capture' : '/api/cancel-job', input));
      }
      case 'merchant_usaspending_source_import': return result(await this.#source(entry, input));
      case 'merchant_usaspending_edition': {
        const edition = original.edition(input.editionId), { groups, ...overview } = original.overview(input.editionId);
        const packet = original.exportEdition(input.editionId, { includeSourceBytes: false, includeReviews: false });
        return result({ edition, overview, groups: paged(groups, input), coverage: packet.coverage, warnings: packet.warnings });
      }
      case 'merchant_usaspending_rows': {
        const { editionId, ...filters } = input; return result(original.browse(editionId, filters));
      }
      case 'merchant_usaspending_award': return result({ ...original.row(input.editionId, input.awardKey),
        review: original.state().reviews.find(item => item.award_key === input.awardKey) ?? null });
      case 'merchant_usaspending_compare': {
        const { changes, ...summary } = original.compare(input.before, input.after);
        return result({ ...summary, changes: paged(changes, input) });
      }
      case 'merchant_usaspending_select': return result(original.selectEdition(input.editionId, { awardKeys: input.awardKeys, name: input.name }));
      case 'merchant_usaspending_enrich': return result(await this.#http(entry, '/api/enrich', input));
      case 'merchant_usaspending_attach_details': return result(original.attachDetails(input.editionId, input.detailIds));
      case 'merchant_usaspending_review_save': {
        const { awardKey, ...review } = input; return result(original.saveReview({ ...review, award_key: awardKey }));
      }
      case 'merchant_usaspending_history': return result(original.history({ award_key: input.awardKey, limit: input.limit ?? 100 }));
      case 'merchant_usaspending_merchant_prepare': return result(await this.#http(entry, '/api/merchant', {
        editionId: input.editionId, options: this.#definition(workspace).merchant,
      }));
      case 'merchant_usaspending_merchant_preview': {
        const merchant = await this.#merchant(entry, input.merchantId);
        return result(await entry.merchant.previewMerchant(merchant.directory, input.query ?? {}));
      }
      case 'merchant_usaspending_delivery_adopt': {
        identifier(input.delivery, 'Original delivery alias');
        const directory = this.#definition(workspace).deliveries[input.delivery];
        if (!directory) throw failure('USASPENDING_DELIVERY_NOT_CONFIGURED', 'Select a host-declared original delivery.');
        await canonicalDirectory(directory);
        return result(await entry.merchant.adoptDelivery(original, directory));
      }
      case 'merchant_usaspending_dossier_create': return result(dossierSummary(await entry.dossiers.create(input)));
      case 'merchant_usaspending_dossier': {
        const view = await entry.dossiers.get(input.dossierId, { revision: input.revision }), section = input.section ?? 'overview';
        if (!['overview', 'questions', 'editions', 'sources', 'findings', 'revisions', 'providerUsage', 'unavailableSelections'].includes(section))
          throw failure('INVALID_PARAMS', 'Select an original dossier section.');
        return result({ ...dossierSummary(view), section, ...(section === 'overview' ? {} : { page: paged(view[section], input) }) });
      }
      case 'merchant_usaspending_dossier_update': {
        const { dossierId, ...update } = input;
        if (update.title === undefined && update.description === undefined) throw failure('INVALID_PARAMS', 'Supply a title or description update.');
        return result(dossierSummary(await entry.dossiers.update(dossierId, update)));
      }
      case 'merchant_usaspending_dossier_question': {
        const { dossierId, questionId, ...change } = input;
        if (questionId === undefined && (change.text === undefined || change.notes !== undefined || change.status !== undefined))
          throw failure('INVALID_PARAMS', 'A new question requires text; edit notes or status using its saved questionId.');
        const view = questionId === undefined ? await entry.dossiers.addQuestion(dossierId, change)
          : await entry.dossiers.updateQuestion(dossierId, questionId, change);
        return result({ ...dossierSummary(view), questions: view.questions });
      }
      case 'merchant_usaspending_dossier_receive': {
        const { dossierId, ...selection } = input;
        return result(await entry.bridge.receiveUSAspendingEdition(entry.dossiers, dossierId, { ...selection, workspace: original }));
      }
      case 'merchant_usaspending_dossier_evidence': {
        const { dossierId, sourceId, occurrenceId, ...selection } = input;
        if ((sourceId === undefined) === (occurrenceId === undefined))
          throw failure('INVALID_PARAMS', 'Select exactly one sourceId or question-specific occurrenceId.');
        const view = sourceId === undefined
          ? await entry.dossiers.updateSelection(dossierId, { ...selection, occurrenceId })
          : await entry.dossiers.selectEvidence(dossierId, { ...selection, sourceId });
        return result(dossierSummary(view));
      }
      case 'merchant_usaspending_dossier_finding': {
        const { dossierId, findingId, ...finding } = input;
        if (findingId === undefined && (finding.questionId === undefined || finding.title === undefined || finding.text === undefined))
          throw failure('INVALID_PARAMS', 'A new finding requires its original question, title and text.');
        if (findingId !== undefined && finding.questionId !== undefined)
          throw failure('INVALID_PARAMS', 'An existing finding retains its original research question.');
        const view = findingId === undefined ? await entry.dossiers.addFinding(dossierId, finding)
          : await entry.dossiers.updateFinding(dossierId, findingId, finding);
        return result({ ...dossierSummary(view), findings: view.findings });
      }
      case 'merchant_usaspending_dossier_compare': return result(await entry.dossiers.compare(input.dossierId, { before: input.before, after: input.after }));
      case 'merchant_usaspending_export': return this.#export(entry, input);
      case 'merchant_usaspending_file_read': return this.#file(entry, input);
      case 'merchant_usaspending_file_release':
        await this.#reads.release(this.#scope(workspace), checked(input.readId, UUID, 'file read'));
        return { workspace, readId: input.readId, state: 'RELEASED' };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown USAspending workspace operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('USASPENDING_WORKSPACE_CLOSING', 'The merchant operator is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown USAspending workspace operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    try {
      if (name === 'merchant_usaspending_workspaces') return this.summary;
      if (name === 'merchant_usaspending_open') return await this.#open(args.workspace);
      if (name === 'merchant_usaspending_close') {
        const entry = this.#entry(args.workspace);
        if (entry.instanceId !== checked(args.instanceId, UUID, 'workspace instance'))
          throw failure('USASPENDING_INSTANCE_CONFLICT', 'Close only this process-owned original workspace instance.');
        return await this.#closeEntry(entry);
      }
      const entry = this.#entry(args.workspace), pending = Promise.resolve().then(() => this.#execute(entry, name, args));
      entry.pending.add(pending);
      try { return await pending; } finally { entry.pending.delete(pending); }
    } catch (issue) { throw safeError(issue); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#opening.values()]);
        const results = await Promise.allSettled([...this.#entries.values()].map(entry => this.#closeEntry(entry)));
        await this.#reads.close();
        if (results.some(result => result.status === 'rejected'))
          throw failure('USASPENDING_SHUTDOWN_INCOMPLETE', 'An original workspace reported incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
