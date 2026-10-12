// MIT. ArcGIS source and delivery work over the existing merchant publisher owner.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { exact, failure, identifier, line } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { openArcgisWorkbench } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/workbench/model.mjs';
import { requestId } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/workbench/catalog.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const UPLOAD_BYTES = 67108864, DOWNLOAD_BYTES = 256_000_000;
const downloads = ['dataset.csv', 'dataset.json', 'seller.json', 'source.json', 'binding.json',
  'arcgis-receiving.json', 'release-receiving.json'];
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: UUID.source };
const hash = { type: 'string', pattern: HASH.source };
const text = { type: 'string', minLength: 1, maxLength: 240 };
const integer = { type: 'integer', minimum: 0 };
const read = { readOnly: true, idempotent: true };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const querySchema = object({ where: { type: 'string', minLength: 1, maxLength: 8192 },
  outFields: { type: 'array', minItems: 1, maxItems: 4096, uniqueItems: true, items: { type: 'string', minLength: 1 } },
  returnGeometry: { type: 'boolean' } });
const filesSchema = object({ metadata: uuid, pages: { type: 'array', minItems: 1, maxItems: 4096, items: uuid },
  geometryPages: { type: 'array', minItems: 1, maxItems: 4096, items: uuid },
  geometryField: text, representation: { enum: ['parsed-json', 'wire-json'] } }, ['metadata', 'pages']);
const columnsSchema = { type: 'object', minProperties: 1, maxProperties: 64, additionalProperties: {
  oneOf: [object({ field: text }, ['field']),
    object({ source: { enum: ['attributes', 'geometry', 'spatialReference'] } }, ['source'])] } };

export function arcgisWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, workbenchId: uuid, ...properties });
  return [
    tool('merchant_arcgis_status', 'List host-declared ArcGIS workspaces or inspect an open original workbench. Source captures, immutable editions, deployments and request IDs are shared with its browser and merchant_publisher tools. Status does not open a publisher or start its scheduler.',
      scoped({ limit: { type: 'integer', minimum: 1, maximum: 100 },
        capturesOffset: integer, editionsOffset: integer, deploymentsOffset: integer }), [], read),
    tool('merchant_arcgis_open', 'Open or reuse the ArcGIS workbench attached to the declared original merchant publisher. One publisher object, workspace lease and scheduler serve both agent commands and the borrowed browser. Returns workbenchId and the current process instance IDs.',
      { workspace: alias }, ['workspace'], { idempotent: true, openWorld: true }),
    tool('merchant_arcgis_close', 'Close this exact workbench instance and drain its browser, source operation and retained file reads. The owning merchant publisher and its schedule remain open. Use merchant_publisher_close to close that owner and every attached workbench.',
      { workspace: alias, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_arcgis_source', 'Inspect a host-declared original JSON file and its SHA-256, upload those exact bytes into the native workbench, or remove a completed ingress copy. Upload requires file alias, requestId and inspected expectedSha256. Remove requires uploadId and expectedSha256. Source files and credentials cannot be selected by client path.',
      scoped({ action: { enum: ['inspect', 'upload', 'remove-upload'] }, file: alias,
        requestId: uuid, uploadId: uuid, expectedSha256: hash }), ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_capture', 'Prepare a named live or retained-file capture, continue or pause its original request, or inspect its native fields and sample. Prepare selects a host profile plus exact ArcGIS query; files mode selects retained upload IDs for metadata and ordered pages. Continue retains the original capture and page progress. Every mutation uses a client-retained requestId.',
      scoped({ action: { enum: ['prepare', 'continue', 'pause', 'inspect'] }, requestId: uuid,
        captureId: uuid, title: text, mode: { enum: ['live', 'files'] }, profile: alias,
        query: querySchema, files: filesSchema, maxPages: { type: 'integer', minimum: 1, maximum: 4096 } }),
      ['workspace', 'workbenchId', 'action'], { openWorld: true }),
    tool('merchant_arcgis_edition', 'Create an immutable reviewed mapping from a complete capture, inspect a retained source edition, or select it against the current source revision. Create requires the actual capture SHA-256 and explicit public columns. Geometry and spatial reference remain original Esri JSON. Selection does not publish a dataset.',
      scoped({ action: { enum: ['create', 'inspect', 'select'] }, requestId: uuid, captureId: uuid,
        expectedCaptureSha256: hash, title: text, query: { type: 'string', minLength: 1, maxLength: 48 },
        columns: columnsSchema, editionId: uuid, expectedRevision: integer }), ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_request', 'Read the original retained ArcGIS request by its exact UUID. RUNNING, PAUSED, INTERRUPTED, FAILED and SUCCEEDED are native states. After a lost response inspect this record, then explicitly resend the same operation and input only if continuation is needed.',
      scoped({ requestId: uuid }), ['workspace', 'workbenchId', 'requestId'], read),
    tool('merchant_arcgis_deployment', 'Export the complete native delivery package for an already published run and retained seller upload, stage that package in the host release store, or inspect its files and hashes. Stage uses only the host runtime declaration. Original release controls govern activation; export and stage do not start another publisher or pay a buyer.',
      scoped({ action: { enum: ['export', 'stage', 'inspect'] }, requestId: uuid,
        runId: uuid, sellerUploadId: uuid, label: text, deploymentId: uuid, releaseId: alias }),
      ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_file', 'Read an original deployment file in SHA-256-bound chunks. First read verifies the native package and retains one immutable snapshot. Continue with readId, expectedSha256 and nextOffset; EOF releases it. The scope accepts four reads and 256 MB of verified snapshots. Original package files remain unchanged.',
      scoped({ deploymentId: uuid, filename: { enum: downloads }, expectedSha256: hash, readId: uuid,
        offset: integer, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }),
      ['workspace', 'workbenchId', 'deploymentId', 'filename'], read),
    tool('merchant_arcgis_file_release', 'Release a selected unfinished original deployment-file read without deleting the deployment.',
      scoped({ readId: uuid }), ['workspace', 'workbenchId', 'readId'], { idempotent: true }),
    tool('merchant_arcgis_browser', 'Open or close the industrial browser on this same publisher, workbench and scheduler. A repeated open reuses its existing listener. Closing the browser drains only its listener and active responses; agent tools and retained source work remain available.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }),
      ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_release_console', 'Open the original release controls for this workspace after a deployment is staged. Returns the live private local URL; the durable request stores its nonsecret result. Reuses the current original console. A fresh open request is needed after the workbench has closed.',
      scoped({ requestId: uuid }), ['workspace', 'workbenchId', 'requestId']),
  ];
}

function checkedHash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) throw failure('INVALID_PARAMS', 'Use the exact original SHA-256.');
  return value;
}
function count(value, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', 'Use an integer within the declared limits.');
  return value;
}
function fields(args, allowed, required = []) {
  exact(args, ['workspace', 'workbenchId', ...allowed], ['workspace', 'workbenchId', ...required]);
}
function pageOptions(args) {
  const result = {};
  for (const name of ['limit', 'capturesOffset', 'editionsOffset', 'deploymentsOffset'])
    if (args[name] !== undefined) result[name] = count(args[name], name === 'limit' ? 100 : Number.MAX_SAFE_INTEGER, name === 'limit' ? 1 : 0);
  return result;
}
function closeError(errors) {
  if (errors.length) {
    const issue = failure('ARCGIS_CLOSE_FAILED', 'An original ArcGIS resource reported incomplete shutdown.');
    issue.cause = new AggregateError(errors); throw issue;
  }
}
// Descriptor-bound input reads prevent symlink replacement and bound allocation
// before reading. A changed declared input never reuses an accepted upload ID.
async function verifiedBytes(path, maximum, expected = null, privateFile = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximum ||
        privateFile && (before.mode & 0o077 || before.nlink !== 1) ||
        expected?.bytes !== undefined && before.size !== expected.bytes)
      throw failure('ARCGIS_FILE_INVALID', 'The selected original file is unavailable or exceeds its declared size limit.');
    const bytes = Buffer.allocUnsafe(before.size);
    let position = 0;
    while (position < bytes.length) {
      const result = await handle.read(bytes, position, Math.min(65536, bytes.length - position), position);
      if (!result.bytesRead) throw failure('ARCGIS_FILE_CHANGED', 'The original file changed while being read.');
      position += result.bytesRead;
    }
    const after = await handle.stat(), sha256 = createHash('sha256').update(bytes).digest('hex');
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
        expected?.sha256 !== undefined && sha256 !== expected.sha256)
      throw failure('ARCGIS_FILE_CHANGED', 'Inspect the changed original file before choosing another request.');
    return { bytes, sha256 };
  } finally { await handle.close(); }
}

export class MerchantArcgisWorkspaces {
  #config; #publishers; #environment; #handles = new Map(); #pending = new Set(); #closing = false; #close;
  constructor(config, publishers, { environment = process.env } = {}) {
    this.#config = config; this.#publishers = publishers; this.#environment = environment;
  }
  get summary() {
    const resources = [...this.#handles.values()].map(entry => entry.resource).filter(Boolean);
    return { configured: Boolean(this.#config.arcgisWorkspaces), opened: [...this.#handles.keys()],
      pending: this.#pending.size, closing: this.#closing,
      activeFileReads: resources.reduce((sum, item) => sum + item.reads.summary.activeFileReads, 0),
      snapshotBytes: resources.reduce((sum, item) => sum + item.reads.summary.snapshotBytes, 0) };
  }
  #declared(name) {
    identifier(name, 'ArcGIS workspace alias');
    const configuration = this.#config.arcgisWorkspaces?.workspaces?.[name];
    if (!configuration) throw failure('ARCGIS_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared ArcGIS workspace.');
    return configuration;
  }
  #declaration(name, configuration) {
    return { workspace: name, label: configuration.label, publisher: configuration.publisher,
      files: Object.entries(configuration.files).map(([file, item]) => ({ file, label: item.label, kind: item.kind })),
      profiles: Object.entries(configuration.connections).map(([profile, item]) => ({
        profile, label: item.label, layerUrl: item.connection.layerUrl,
        authenticated: Boolean(item.connection.tokenEnv) })) };
  }
  async #makeResource(name, entry, configuration, owned) {
    const model = await openArcgisWorkbench({ publisher: owned.publisher,
      releaseDirectory: configuration.releaseDirectory, environment: this.#environment });
    const resource = { model, publisher: owned.publisher, schedule: owned.schedule,
      publisherInstanceId: owned.instanceId, instanceId: randomUUID(),
      reads: new RetainedFileReads({ errorPrefix: 'ARCGIS' }), browser: null, browserTail: Promise.resolve(),
      closing: false, closed: false, closePromise: null };
    resource.close = () => {
      if (resource.closePromise) return resource.closePromise;
      resource.closing = true;
      resource.closePromise = (async () => {
        const errors = [];
        await resource.browserTail.catch(() => {});
        try { await resource.browser?.close(); } catch (issue) { errors.push(issue); }
        resource.browser = null;
        try { await resource.reads.close(); } catch (issue) { errors.push(issue); }
        try { await model.close(); } catch (issue) { errors.push(issue); }
        resource.closed = true;
        if (this.#handles.get(name) === entry) this.#handles.delete(name);
        closeError(errors);
      })();
      return resource.closePromise;
    };
    entry.resource = resource;
    return resource;
  }
  async #open(name) {
    const configuration = this.#declared(name);
    let entry = this.#handles.get(name);
    if (entry?.resource?.closing) throw failure('ARCGIS_WORKSPACE_CLOSING', 'The original workspace is still draining.');
    if (!entry) {
      entry = { opening: null, lease: null, resource: null, closing: null };
      this.#handles.set(name, entry);
      entry.opening = this.#publishers.borrow(configuration.publisher, { kind: 'arcgis', key: 'arcgis:' + name,
        open: owned => this.#makeResource(name, entry, configuration, owned) }).then(lease => { entry.lease = lease; return lease; });
      try { await entry.opening; }
      catch (issue) { if (this.#handles.get(name) === entry) this.#handles.delete(name); throw issue; }
    } else await entry.opening;
    return this.#status(name);
  }
  async #status(name, options = {}) {
    if (name === undefined) return { ...this.summary,
      workspaces: Object.entries(this.#config.arcgisWorkspaces?.workspaces ?? {}).map(([workspace, configuration]) => {
        const entry = this.#handles.get(workspace);
        return { ...this.#declaration(workspace, configuration),
          state: !entry ? 'CLOSED' : entry.closing || entry.resource?.closing || entry.lease?.closed ? 'CLOSING' : entry.resource ? 'OPEN' : 'OPENING' };
      }) };
    const configuration = this.#declared(name), entry = this.#handles.get(name);
    const declaration = this.#declaration(name, configuration);
    if (!entry) return { ...declaration, state: 'CLOSED' };
    const lease = await entry.opening, resource = lease.resource;
    if (entry.closing || lease.closed || resource.closing)
      return { ...declaration, state: 'CLOSING', instanceId: resource.instanceId, publisherInstanceId: lease.instanceId };
    return lease.run(async current => ({ ...declaration, state: 'OPEN', instanceId: current.instanceId,
      publisherInstanceId: lease.instanceId, workbenchId: current.model.workbenchId,
      native: await current.model.status(options), browser: { open: Boolean(current.browser) },
      fileReads: current.reads.status(name) }));
  }
  async #stop(name, entry) {
    if (entry.closing) return entry.closing;
    entry.closing = (async () => {
      const lease = await entry.opening, instanceId = lease.resource.instanceId;
      // Never call release from inside lease.run: it drains those accepted calls.
      await lease.release();
      if (this.#handles.get(name) === entry) this.#handles.delete(name);
      return { workspace: name, publisher: this.#declared(name).publisher, instanceId, state: 'CLOSED',
        publisherState: 'OWNED_BY_MERCHANT_PUBLISHER' };
    })();
    return entry.closing;
  }
  async #source(configuration, resource, args) {
    if (args.action === 'remove-upload') {
      fields(args, ['action', 'requestId', 'uploadId', 'expectedSha256'], ['requestId', 'uploadId', 'expectedSha256']);
      return resource.model.removeUpload({ requestId: requestId(args.requestId), uploadId: requestId(args.uploadId),
        expectedSha256: checkedHash(args.expectedSha256) });
    }
    if (!['inspect', 'upload'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose inspect, upload or remove-upload.');
    fields(args, args.action === 'inspect' ? ['action', 'file'] : ['action', 'file', 'requestId', 'expectedSha256'],
      args.action === 'inspect' ? ['file'] : ['file', 'requestId', 'expectedSha256']);
    const name = identifier(args.file, 'Source file alias'), declaration = configuration.files[name];
    if (!declaration) throw failure('ARCGIS_FILE_NOT_CONFIGURED', 'Choose a host-declared original source file.');
    if (args.action === 'upload') requestId(args.requestId);
    const value = await verifiedBytes(declaration.file, UPLOAD_BYTES,
      args.action === 'upload' ? { sha256: checkedHash(args.expectedSha256) } : null);
    const description = { file: name, label: declaration.label, kind: declaration.kind,
      name: basename(declaration.file), bytes: value.bytes.length, sha256: value.sha256 };
    if (args.action === 'inspect') return description;
    const result = await resource.model.upload(Readable.from([value.bytes]), {
      requestId: args.requestId, name: description.name, sha256: value.sha256 });
    return { file: description, request: result, upload: result.state === 'SUCCEEDED' ? result.result : null };
  }
  #capture(configuration, resource, args) {
    const model = resource.model;
    if (args.action === 'inspect') {
      fields(args, ['action', 'captureId'], ['captureId']); return model.capture(requestId(args.captureId));
    }
    if (args.action === 'pause') {
      fields(args, ['action', 'requestId', 'captureId'], ['requestId', 'captureId']);
      return model.pause({ requestId: requestId(args.requestId), captureId: requestId(args.captureId) });
    }
    if (args.action === 'continue') {
      fields(args, ['action', 'requestId', 'captureId', 'maxPages'], ['requestId', 'captureId']);
      return model.continueCapture({ requestId: requestId(args.requestId), captureId: requestId(args.captureId),
        ...(args.maxPages === undefined ? {} : { maxPages: count(args.maxPages, 4096, 1) }) });
    }
    if (args.action !== 'prepare') throw failure('INVALID_PARAMS', 'Choose prepare, continue, pause or inspect.');
    fields(args, ['action', 'requestId', 'title', 'mode', 'profile', 'query', 'files'],
      ['requestId', 'title', 'mode', 'profile', 'query']);
    if (!['live', 'files'].includes(args.mode)) throw failure('INVALID_PARAMS', 'Choose a live or retained-file capture.');
    const profile = configuration.connections[identifier(args.profile, 'Connection profile')];
    if (!profile) throw failure('ARCGIS_PROFILE_NOT_CONFIGURED', 'Choose a host-declared original layer connection.');
    exact(args.query, ['where', 'outFields', 'returnGeometry']);
    const declared = profile.connection;
    const connection = args.mode === 'live' ? { ...declared, query: args.query } :
      { layerUrl: declared.layerUrl, query: args.query, maxRows: declared.maxRows, maxSourceBytes: declared.maxSourceBytes };
    if (args.mode === 'files') {
      exact(args.files, ['metadata', 'pages', 'geometryPages', 'geometryField', 'representation'], ['metadata', 'pages']);
      requestId(args.files.metadata);
      for (const key of ['pages', 'geometryPages']) {
        if (key === 'geometryPages' && args.files[key] === undefined) continue;
        const values = args.files[key];
        if (!Array.isArray(values) || !values.length || values.length > 4096 || new Set(values).size !== values.length)
          throw failure('INVALID_PARAMS', 'Choose an ordered list of distinct retained page uploads.');
        values.forEach(requestId);
      }
    } else if (args.files !== undefined) throw failure('INVALID_PARAMS', 'Live captures use the declared provider connection.');
    return model.prepareCapture({ requestId: requestId(args.requestId), title: line(args.title), mode: args.mode,
      connection, ...(args.mode === 'files' ? { files: args.files } : {}) });
  }
  #edition(resource, args) {
    const model = resource.model;
    if (args.action === 'inspect') {
      fields(args, ['action', 'editionId'], ['editionId']); return model.edition(requestId(args.editionId));
    }
    if (args.action === 'select') {
      fields(args, ['action', 'requestId', 'editionId', 'expectedRevision'], ['requestId', 'editionId', 'expectedRevision']);
      return model.select({ requestId: requestId(args.requestId), editionId: requestId(args.editionId),
        expectedRevision: count(args.expectedRevision, Number.MAX_SAFE_INTEGER) });
    }
    if (args.action !== 'create') throw failure('INVALID_PARAMS', 'Choose create, select or inspect.');
    fields(args, ['action', 'requestId', 'captureId', 'expectedCaptureSha256', 'title', 'query', 'columns'],
      ['requestId', 'captureId', 'expectedCaptureSha256', 'title', 'columns']);
    return model.createEdition({ requestId: requestId(args.requestId), title: line(args.title),
      captureId: requestId(args.captureId), expectedCaptureSha256: checkedHash(args.expectedCaptureSha256),
      columns: args.columns, ...(args.query === undefined ? {} : { query: args.query }) });
  }
  #deployment(configuration, resource, args) {
    const model = resource.model;
    if (args.action === 'inspect') {
      fields(args, ['action', 'deploymentId'], ['deploymentId']); return model.deployment(requestId(args.deploymentId));
    }
    if (args.action === 'export') {
      fields(args, ['action', 'requestId', 'runId', 'sellerUploadId', 'label'], ['requestId', 'runId', 'sellerUploadId', 'label']);
      return model.exportDeployment({ requestId: requestId(args.requestId), run: requestId(args.runId),
        sellerUploadId: requestId(args.sellerUploadId), label: line(args.label) });
    }
    if (args.action !== 'stage') throw failure('INVALID_PARAMS', 'Choose export, stage or inspect.');
    fields(args, ['action', 'requestId', 'deploymentId', 'releaseId', 'label'], ['requestId', 'deploymentId', 'releaseId']);
    return model.stage({ requestId: requestId(args.requestId), deploymentId: requestId(args.deploymentId),
      releaseId: identifier(args.releaseId, 'Release ID'), runtime: configuration.runtime,
      ...(args.label === undefined ? {} : { label: line(args.label) }) });
  }
  async #file(name, resource, args) {
    fields(args, ['deploymentId', 'filename', 'expectedSha256', 'readId', 'offset', 'limit'], ['deploymentId', 'filename']);
    requestId(args.deploymentId);
    if (!downloads.includes(args.filename)) throw failure('INVALID_PARAMS', 'Choose a native deployment filename.');
    if (args.readId !== undefined) requestId(args.readId);
    return resource.reads.read({ scope: name, key: args.deploymentId + ':' + args.filename,
      kind: 'arcgis-deployment', directory: this.#config.exportsDirectory,
      expectedSha256: args.expectedSha256, readId: args.readId, offset: args.offset, limit: args.limit,
      load: async () => {
        const file = await resource.model.download(args.deploymentId, args.filename);
        const value = await verifiedBytes(file.path, DOWNLOAD_BYTES, file, true);
        return { bytes: value.bytes, name: file.name, type: file.type };
      } });
  }
  async #browser(configuration, resource, args) {
    fields(args, ['action', 'port'], ['action']);
    if (!['open', 'close'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose open or close.');
    if (args.action === 'close' && args.port !== undefined) throw failure('INVALID_PARAMS', 'Closing a browser does not select another port.');
    const port = count(args.port ?? 0, 65535);
    const operation = resource.browserTail.then(async () => {
      if (args.action === 'close') {
        await resource.browser?.close(); resource.browser = null; return { browser: 'CLOSED' };
      }
      const reused = Boolean(resource.browser);
      if (!resource.browser) {
        const { startArcgisWorkbenchServer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/workbench/server.mjs');
        resource.browser = await startArcgisWorkbenchServer({ publisher: resource.publisher, workbench: resource.model,
          schedule: resource.schedule, ownsPublisher: false, port,
          releaseDirectory: configuration.releaseDirectory, environment: this.#environment });
      } else if (port && Number(new URL(resource.browser.url).port || 80) !== port) {
        throw failure('ARCGIS_BROWSER_ALREADY_OPEN', 'Close the current listener before selecting another port.');
      }
      return { browser: 'OPEN', url: resource.browser.operatorUrl ?? resource.browser.url, reused };
    });
    resource.browserTail = operation.then(() => {}, () => {});
    return operation;
  }
  async #execute(name, workspace, configuration, resource, args) {
    if (args.workbenchId !== resource.model.workbenchId)
      throw failure('ARCGIS_WORKSPACE_CHANGED', 'Reopen and inspect the current original workspace before choosing this operation.');
    switch (name) {
      case 'merchant_arcgis_source': return this.#source(configuration, resource, args);
      case 'merchant_arcgis_capture': return this.#capture(configuration, resource, args);
      case 'merchant_arcgis_edition': return this.#edition(resource, args);
      case 'merchant_arcgis_request':
        fields(args, ['requestId'], ['requestId']); return resource.model.request(requestId(args.requestId));
      case 'merchant_arcgis_deployment': return this.#deployment(configuration, resource, args);
      case 'merchant_arcgis_file': return this.#file(workspace, resource, args);
      case 'merchant_arcgis_file_release':
        fields(args, ['readId'], ['readId']);
        await resource.reads.release(workspace, requestId(args.readId)); return { readId: args.readId, released: true };
      case 'merchant_arcgis_browser': return this.#browser(configuration, resource, args);
      case 'merchant_arcgis_release_console':
        fields(args, ['requestId'], ['requestId']); return resource.model.releaseConsole({ requestId: requestId(args.requestId) });
      default: throw failure('TOOL_NOT_FOUND', 'Unknown ArcGIS workspace operation.');
    }
  }
  async #dispatch(name, args) {
    if (name === 'merchant_arcgis_status') {
      exact(args, ['workspace', 'workbenchId', 'limit', 'capturesOffset', 'editionsOffset', 'deploymentsOffset']);
      const result = await this.#status(args.workspace, pageOptions(args));
      if (args.workbenchId !== undefined && args.workbenchId !== result.workbenchId)
        throw failure('ARCGIS_WORKSPACE_CHANGED', 'Inspect the declared current workbench.');
      return result;
    }
    if (name === 'merchant_arcgis_open') {
      exact(args, ['workspace'], ['workspace']); return this.#open(args.workspace);
    }
    const configuration = this.#declared(args.workspace), entry = this.#handles.get(args.workspace);
    if (!entry) throw failure('ARCGIS_WORKSPACE_CLOSED', 'Open this original workspace with merchant_arcgis_open.');
    const lease = await entry.opening, resource = lease.resource;
    if (entry.closing || lease.closed || resource.closing) throw failure('ARCGIS_WORKSPACE_CLOSING', 'The original workspace is draining.');
    if (name === 'merchant_arcgis_close') {
      exact(args, ['workspace', 'instanceId'], ['workspace', 'instanceId']);
      if (args.instanceId !== resource.instanceId) throw failure('INSTANCE_CONFLICT', 'Use the current workbench instanceId from status.');
      return this.#stop(args.workspace, entry);
    }
    return lease.run(async current => {
      const result = await this.#execute(name, args.workspace, configuration, current, args);
      return { workspace: args.workspace, publisher: configuration.publisher,
        instanceId: current.instanceId, publisherInstanceId: lease.instanceId,
        workbenchId: current.model.workbenchId, result };
    });
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The ArcGIS adapter is closing.');
    const operation = this.#dispatch(name, args);
    this.#pending.add(operation);
    try { return await operation; } finally { this.#pending.delete(operation); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const outcomes = await Promise.allSettled([...this.#handles].map(([name, entry]) => this.#stop(name, entry)));
      closeError(outcomes.filter(item => item.status === 'rejected').map(item => item.reason));
    })();
    return this.#close;
  }
}

