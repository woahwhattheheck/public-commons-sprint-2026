import { GRANT_AGENT_SCHEMA, GRANT_MAX_BUNDLE_BYTES, GRANT_MAX_SOURCE_BYTES, GRANT_CASE_ACTIONS } from './agent-contracts.mjs';
export { GRANT_AGENT_SCHEMA, GRANT_MAX_BUNDLE_BYTES, GRANT_MAX_SOURCE_BYTES, GRANT_CASE_ACTIONS } from './agent-contracts.mjs';
// MIT. Typed agent access to the original SF47 planning and delivery service.
// This client owns no planning database, business records or financial model.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGrantWorkspaceSelection, readGrantWorkspaceLaunch, GRANT_LAUNCH_SCHEMA } from './launch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));



const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const error = (code, message, details = {}) => Object.assign(new Error(message), {code, ...details});
const need = (value, code, message) => { if (!value) throw error(code, message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const object = (value, name = 'Input') => {
  need(plain(value), 'GRANT_INVALID_INPUT', name + ' must be an object.'); return value;
};
const exact = (value, allowed, required = []) => {
  object(value);
  need(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)),
    'GRANT_INVALID_INPUT', 'Use the declared fields, including every required field.');
};
const text = (value, name, max = 12000, empty = false) => {
  need(typeof value === 'string' && value.length <= max && (empty || value.trim()) && !value.includes('\0'),
    'GRANT_INVALID_INPUT', name + ' is required and must fit its native text bound.'); return value;
};
const integer = (value, name, min = 1, max = 10000000) => {
  need(Number.isSafeInteger(value) && value >= min && value <= max, 'GRANT_INVALID_INPUT',
    name + ' must be an integer from ' + min + ' through ' + max + '.'); return value;
};
const id = (value, prefix) => {
  need(typeof value === 'string' && new RegExp('^' + prefix + '-[a-f0-9]{32}$').test(value),
    'GRANT_INVALID_INPUT', 'Use the original ' + prefix + ' identifier.'); return value;
};
const requestId = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value),
    'GRANT_INVALID_INPUT', 'Use the original request ID: up to 100 letters, numbers, dots, underscores or hyphens.');
  return value;
};
const path = value => {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'GRANT_CONFIGURATION_ERROR',
    'Host selections must be absolute original paths.'); return resolve(value);
};
const sha = value => {
  need(typeof value === 'string' && HASH.test(value), 'GRANT_INVALID_INPUT', 'Use the exact SHA256.'); return value;
};

const SUPPORT_DEPLOYMENT_FIELDS = [
  'name', 'operator', 'operatorId', 'role', 'participantClass', 'environment', 'state',
  'costIds', 'tranche', 'endpoint', 'releaseRef', 'caseRef', 'acceptedBy', 'acceptedAt', 'sourceNote',
];
const supportHandoff = (bytes, filename) => {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= GRANT_MAX_SOURCE_BYTES,
    'GRANT_INPUT_TOO_LARGE', 'Use the complete nonempty original support handoff up to 8 MiB.');
  text(filename, 'Original support filename', 240);
  need(!/[\x00-\x1f\x7f\\/]/.test(filename) && !['.', '..'].includes(filename),
    'GRANT_INVALID_INPUT', 'Use the plain original support filename without directory components.');
  return {filename, contentBase64:bytes.toString('base64')};
};




/** Exact regular-file input. Private launch records additionally keep original ownership. */
export async function readGrantAgentFile(filename, maximum = GRANT_MAX_BUNDLE_BYTES, privateOnly = false) {
  const fd = await open(path(filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    need(before.isFile() && before.size <= maximum, 'GRANT_INPUT_FILE_INVALID',
      'Select one complete regular file within its native size bound.');
    if (privateOnly) need(before.nlink === 1 && !(before.mode & 0o077) &&
      (!process.getuid || before.uid === process.getuid()), 'GRANT_PRIVATE_LAUNCH_REQUIRED',
    'Keep the original launch record private and owned by its operator.');
    const bytes = await fd.readFile(), after = await fd.stat();
    need(bytes.length === before.size && before.dev === after.dev && before.ino === after.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'GRANT_INPUT_CHANGED', 'The original file changed during its read.');
    return bytes;
  } finally { await fd.close(); }
}

/** Configuration performs no process launch and no SQLite open. */
export async function inspectGrantAgentBinding(input) {
  exact(input, ['directory', 'scenarioFile', 'pythonExecutable', 'allowStart', 'label'], ['directory']);
  const directory = path(input.directory), pythonExecutable = path(input.pythonExecutable ?? '/usr/bin/python3');
  if (input.allowStart !== undefined) need(typeof input.allowStart === 'boolean', 'GRANT_CONFIGURATION_ERROR',
    'allowStart must be an explicit host boolean.');
  const selected = await inspectGrantWorkspaceSelection({workspaceDirectory:directory,
    pythonExecutable, ...(input.scenarioFile ? {scenarioFile:path(input.scenarioFile)} : {})});
  return {directory, scenarioFile:selected.selection.scenarioFile, pythonExecutable,
    allowStart:input.allowStart === true, label:text(input.label ?? 'Grant workspace', 'Workspace label', 240),
    selectionSha256:selected.selectionSha256, selection:selected.selection};
}

function publicOriginal(record) {
  const {accessToken, ...original} = record;
  return original;
}
function originalSource(connection) {
  const record = connection.original;
  return {schema:GRANT_LAUNCH_SCHEMA, instanceId:record.instanceId, pid:record.pid,
    selectionSha256:record.selectionSha256, url:record.url, sourceDirectory:record.selection.sourceDirectory,
    executionSourceDirectory:record.execution.sourceDirectory};
}
function transport(connection, route, {body, contentType = 'application/json', headers = {},
  originalRequestId, timeoutMs = 30000, mutation = body !== undefined} = {}) {
  const target = new URL(route, connection.original.url), authorization = new URL(connection.url).hash.slice('#access='.length);
  need(target.origin === new URL(connection.original.url).origin && route.startsWith('/api/'),
    'GRANT_ROUTE_INVALID', 'Use an original declared grant API route.');
  const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  need(bytes === undefined || bytes.length <= GRANT_MAX_BUNDLE_BYTES, 'GRANT_INPUT_TOO_LARGE',
    'The original grant API accepts complete requests up to 32 MiB.');
  return new Promise((resolveResult, reject) => {
    let dispatched = false, settled = false;
    const uncertain = failure => {
      if (settled) return;
      settled = true;
      if (mutation && dispatched && failure.definite !== true) {
        reject(error('GRANT_RESULT_UNCERTAIN',
          'The original request may have committed. Original request ID: ' + (originalRequestId ?? '(none)') +
          '. Reopen the original case or plan and repeat this identical request ID and payload to recover its saved result.',
          {requestId:originalRequestId ?? null, originalCode:failure.code ?? null, originalStatus:failure.status ?? null,
            source:originalSource(connection), route, uncertain:true}));
      } else reject(failure);
    };
    const req = httpRequest(target, {method:bytes === undefined ? 'GET' : 'POST', agent:false, maxHeaderSize:32768,
      headers:{Authorization:'Bearer ' + authorization, Accept:'application/json, application/zip, application/octet-stream',
        ...(bytes === undefined ? {} : {'Content-Type':contentType, 'Content-Length':String(bytes.length)}), ...headers}},
    response => {
      const chunks = []; let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > MAX_RESPONSE_BYTES) {
          req.destroy(error('GRANT_RESPONSE_TOO_LARGE', 'The original response exceeds the 64 MiB receiving bound.')); return;
        }
        chunks.push(chunk);
      });
      response.once('error', uncertain);
      response.once('aborted', () => uncertain(error('GRANT_RESPONSE_INTERRUPTED', 'The original response was interrupted.')));
      response.once('end', () => {
        if (settled) return;
        try {
          const raw = Buffer.concat(chunks), mediaType = String(response.headers['content-type'] ?? 'application/octet-stream');
          let value;
          if (/^application\/json\b/i.test(mediaType)) value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const problem = value?.error;
            throw error(problem?.code ?? 'GRANT_HTTP_ERROR', problem?.message ?? 'The original grant service returned HTTP ' + status + '.',
              {status, definite:status >= 400 && status < 500, source:originalSource(connection), requestId:originalRequestId ?? null});
          }
          if (mediaType.startsWith('application/json')) need(value !== undefined, 'GRANT_RESPONSE_INVALID', 'Read the original JSON response.');
          settled = true;
          resolveResult({value, bytes:raw, mediaType, status, sha256:digest(raw), source:originalSource(connection),
            filename:typeof response.headers['content-disposition'] === 'string'
              ? response.headers['content-disposition'].match(/filename="([^"]+)"/)?.[1] ?? null : null});
        } catch (failure) { uncertain(failure); }
      });
    });
    req.once('finish', () => { dispatched = true; });
    req.once('error', failure => { if (req.socket?.bytesWritten) dispatched = true; uncertain(failure); });
    req.setTimeout(timeoutMs, () => req.destroy(error('GRANT_REQUEST_TIMEOUT', 'The original grant request timed out.')));
    if (bytes) req.end(bytes); else req.end();
  });
}

export class GrantWorkspaceClient {
  #binding; #child = null; #connection = null; #opening = null; #closing = false; #close;
  #pending = new Set();
  constructor(binding) { this.#binding = binding; }
  get summary() { return {schema:GRANT_AGENT_SCHEMA, label:this.#binding.label,
    selectionSha256:this.#binding.selectionSha256, allowStart:this.#binding.allowStart,
    connection:this.#connection ? this.#child ? 'OWNED_ORIGINAL_SERVICE' : 'BORROWED_ORIGINAL_SERVICE' : 'CLOSED',
    instanceId:this.#connection?.original.instanceId ?? null, activeRequests:this.#pending.size}; }
  async #readLaunch() {
    const input = this.#binding;
    const record = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(
      await readGrantAgentFile(join(input.directory, 'managed-launch.json'), 32768, true)));
    need(record.schema === GRANT_LAUNCH_SCHEMA && record.state === 'LISTENING', 'GRANT_APPLICATION_NOT_RUNNING',
      'Start or recover the original Grant planning and delivery application, then open this alias.');
    need(record.selectionSha256 === input.selectionSha256, 'GRANT_SELECTION_CHANGED',
      'The original application uses another reviewed source or workspace selection. Reconcile its host connection.');
    const result = await readGrantWorkspaceLaunch({workspaceDirectory:input.directory,
      scenarioFile:input.scenarioFile, pythonExecutable:input.pythonExecutable,
      selectionSha256:input.selectionSha256, executionSourceDirectory:record.execution?.sourceDirectory,
      pid:record.pid, instanceId:record.instanceId, port:0, announcement:publicOriginal(record)});
    this.#connection = result; return result;
  }
  async inspect() {
    try {
      const connection = await this.#readLaunch();
      return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:connection.original};
    } catch (failure) {
      if (['ENOENT', 'GRANT_APPLICATION_NOT_RUNNING', 'GRANT_STARTUP_UNAVAILABLE', 'ECONNREFUSED'].includes(failure.code))
        return {...this.summary, connection:'ORIGINAL_SERVICE_UNAVAILABLE', reason:failure.code,
          recovery:this.#binding.allowStart ? 'Use open to start the original reviewed service.' : 'Start the original managed application, then open this alias.'};
      throw failure;
    }
  }
  async open({expectedSelectionSha256} = {}) {
    need(!this.#closing, 'GRANT_CLOSING', 'This grant client is closing.');
    if (expectedSelectionSha256 !== undefined) need(sha(expectedSelectionSha256) === this.#binding.selectionSha256,
      'GRANT_SELECTION_CHANGED', 'Use the current host-reviewed workspace selection.');
    if (this.#opening) return this.#opening;
    this.#opening = (async () => {
      try { const existing = await this.#readLaunch(); return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:existing.original}; }
      catch (failure) {
        if (!['ENOENT', 'GRANT_APPLICATION_NOT_RUNNING', 'GRANT_STARTUP_UNAVAILABLE', 'ECONNREFUSED'].includes(failure.code)) throw failure;
        need(this.#binding.allowStart, 'GRANT_START_NOT_AUTHORIZED',
          'This alias borrows the existing application. Start it through its original Applications operation.');
      }
      need(!this.#child, 'GRANT_ORIGINAL_PROCESS_ACTIVE', 'Recover the current original grant child before opening another.');
      const binding = this.#binding;
      await mkdir(binding.directory, {mode:0o700, recursive:false}).catch(failure => { if (failure.code !== 'EEXIST') throw failure; });
      const selected = await inspectGrantWorkspaceSelection({workspaceDirectory:binding.directory,
        scenarioFile:binding.scenarioFile, pythonExecutable:binding.pythonExecutable});
      need(selected.selectionSha256 === binding.selectionSha256, 'GRANT_SELECTION_CHANGED', 'The reviewed original launch selection changed.');
      const child = spawn(process.execPath, [join(HERE, 'launcher.mjs'), '--python', binding.pythonExecutable,
        'serve', '--workspace', binding.directory, '--scenario', binding.scenarioFile, '--port', '0',
        '--source-directory', selected.selection.sourceDirectory, '--startup-format', 'managed',
        '--expected-selection-sha256', binding.selectionSha256],
      {stdio:['ignore', 'pipe', 'pipe'], windowsHide:true, env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}});
      const owned = {child, instanceId:null, done:null}; this.#child = owned;
      owned.done = new Promise(resolveDone => {
        child.once('error', failure => resolveDone({code:null, signal:null, error:failure.code}));
        child.once('exit', (code, signal) => resolveDone({code, signal}));
      });
      owned.done.then(() => { if (this.#child === owned) this.#child = null; });
      let diagnostics = '', lineBuffer = '';
      child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-16384); });
      try {
        await new Promise((ready, reject) => {
          let settled = false;
          const finish = (failure, value) => { if (settled) return; settled = true; clearTimeout(timer);
            failure ? reject(failure) : ready(value); };
          const timer = setTimeout(() => finish(error('GRANT_START_TIMEOUT', 'The original service did not announce its listener.')), 30000);
          child.stdout.on('data', chunk => {
            lineBuffer += chunk.toString('utf8');
            if (lineBuffer.length > 65536) return finish(error('GRANT_START_OUTPUT_INVALID', 'The original startup output exceeded its bound.'));
            let cut;
            while ((cut = lineBuffer.indexOf('\n')) >= 0) {
              const line = lineBuffer.slice(0, cut); lineBuffer = lineBuffer.slice(cut + 1);
              try { const value = JSON.parse(line);
                if (value.schema === GRANT_LAUNCH_SCHEMA && value.state === 'LISTENING') finish(null, value);
              } catch {}
            }
          });
          owned.done.then(result => finish(error('GRANT_START_FAILED', 'The original grant launcher exited before startup.',
            {exitCode:result.code, signal:result.signal, diagnostics})));
        });
        const connection = await this.#readLaunch(); owned.instanceId = connection.original.instanceId;
        return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:connection.original};
      } catch (failure) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await owned.done; if (this.#child === owned) this.#child = null;
        // A concurrently opened original application is authoritative. This reads
        // its real launch; no second launch or tool dispatch is attempted.
        try { const connection = await this.#readLaunch(); return {schema:GRANT_AGENT_SCHEMA, ...this.summary, original:connection.original}; }
        catch { throw failure; }
      }
    })();
    try { return await this.#opening; } finally { this.#opening = null; }
  }
  async browser() {
    const connection = await this.#readLaunch();
    return {schema:GRANT_AGENT_SCHEMA, url:connection.url, original:connection.original};
  }
  async #request(route, options) {
    need(!this.#closing, 'GRANT_CLOSING', 'This grant client is closing.');
    const pending = (async () => transport(await this.#readLaunch(), route, options))();
    this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  read(view, args = {}) {
    const pid = () => id(args.planId, 'plan'), cid = () => id(args.caseId, 'operation');
    const routes = {
      plans:() => '/api/plans',
      plan:() => '/api/plans/' + pid() + (args.revision === undefined ? '' : '/revision/' + integer(args.revision, 'Plan revision', 1, 1000000)),
      'plan-history':() => '/api/plans/' + pid() + '/history',
      cases:() => '/api/operations' + (args.planId === undefined ? '' : '?planId=' + pid()),
      case:() => '/api/operations/' + cid(),
      'case-report':() => '/api/operations/' + cid() + '/report',
      'case-history':() => '/api/operations/' + cid() + '/history?after=' + integer(args.after ?? 0, 'History cursor', 0) +
        '&limit=' + integer(args.limit ?? 100, 'History page size', 1, 200),
      forecasts:() => '/api/operations/' + cid() + '/forecasts',
      forecast:() => '/api/operations/' + cid() + '/forecasts/' + id(args.forecastId, 'forecast'),
      portfolios:() => '/api/operations/' + cid() + '/portfolios',
      portfolio:() => '/api/operations/' + cid() + '/portfolios/' + id(args.portfolioId, 'portfolio'),
      review:() => '/api/operations/' + cid() + '/reviews/' + id(args.reviewId, 'review'),
    };
    need(Object.hasOwn(routes, view), 'GRANT_INVALID_VIEW', 'Choose a declared native grant view.');
    return this.#request(routes[view](), {});
  }
  plan(action, planId, body) {
    id(planId, 'plan');
    const common = ['expectedRevision', 'scenarioPatch', 'planning'];
    const fields = {estimate:common, save:[...common, 'note', 'requestId'],
      restore:['expectedRevision', 'selectedRevision', 'note', 'requestId'], clone:['expectedRevision', 'name', 'requestId']};
    need(Object.hasOwn(fields, action), 'GRANT_INVALID_ACTION', 'Choose estimate, save, restore or clone.');
    exact(body, fields[action], action === 'estimate' ? ['expectedRevision'] : action === 'save'
      ? ['expectedRevision', 'note', 'requestId'] : fields[action]);
    integer(body.expectedRevision, 'Current plan revision', 1, 1000000);
    if (action !== 'estimate') requestId(body.requestId);
    return this.#request('/api/plans/' + planId + '/' + action,
      {body, originalRequestId:body.requestId, mutation:action !== 'estimate'});
  }
  createCase(body) {
    exact(body, ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'mode', 'calendarStart', 'actor', 'requestId'],
      ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'mode', 'actor', 'requestId']);
    id(body.planId, 'plan'); integer(body.selectedRevision, 'Selected revision', 1, 1000000);
    sha(body.expectedContentSha256); requestId(body.requestId);
    return this.#request('/api/operations', {body, originalRequestId:body.requestId});
  }
  command(caseId, body) {
    id(caseId, 'operation'); exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'action', 'data'],
      ['expectedVersion', 'requestId', 'actor', 'action', 'data']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    need(GRANT_CASE_ACTIONS.includes(body.action), 'GRANT_INVALID_ACTION', 'Choose the original case action.');
    object(body.data, 'Original action data');
    return this.#request('/api/operations/' + caseId + '/command', {body, originalRequestId:body.requestId});
  }
  forecastPreview(caseId, expectedVersion, inputs) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); object(inputs, 'Forecast inputs');
    return this.#request('/api/operations/' + caseId + '/forecast-preview', {body:{expectedVersion, inputs}, mutation:false});
  }
  forecastSave(caseId, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'inputs', 'expectedPreviewSha256'],
      ['expectedVersion', 'requestId', 'actor', 'inputs', 'expectedPreviewSha256']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId); sha(body.expectedPreviewSha256);
    const {inputs, expectedPreviewSha256, ...original} = body; object(inputs, 'Forecast inputs');
    return this.#request('/api/operations/' + caseId + '/command',
      {body:{...original, action:'forecast.save', data:{inputs, expectedPreviewSha256}}, originalRequestId:body.requestId});
  }
  portfolioSeed(caseId, expectedVersion, forecastId) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); id(forecastId, 'forecast');
    return this.#request('/api/operations/' + caseId + '/portfolio-seed',
      {body:{expectedVersion, forecastId}, mutation:false});
  }
  portfolioPreview(caseId, expectedVersion, inputs) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); object(inputs, 'Portfolio inputs');
    return this.#request('/api/operations/' + caseId + '/portfolio-preview',
      {body:{expectedVersion, inputs}, mutation:false});
  }
  portfolioSave(caseId, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'inputs', 'expectedPreviewSha256'],
      ['expectedVersion', 'requestId', 'actor', 'inputs', 'expectedPreviewSha256']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId); sha(body.expectedPreviewSha256);
    const {inputs, expectedPreviewSha256, ...original} = body; object(inputs, 'Portfolio inputs');
    return this.#request('/api/operations/' + caseId + '/command',
      {body:{...original, action:'portfolio.save', data:{inputs, expectedPreviewSha256}}, originalRequestId:body.requestId});
  }
  portfolioSelection(caseId, expectedVersion, portfolioId, alternativeId) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version'); id(portfolioId, 'portfolio');
    need(typeof alternativeId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(alternativeId),
      'GRANT_INVALID_INPUT', 'Use the original saved alternative ID, including base for the base allocation.');
    return this.#request('/api/operations/' + caseId + '/portfolio-selection',
      {body:{expectedVersion, portfolioId, alternativeId}, mutation:false});
  }
  supportPreview(caseId, expectedVersion, bytes, filename) {
    id(caseId, 'operation'); integer(expectedVersion, 'Current case version');
    return this.#request('/api/operations/' + caseId + '/support-preview',
      {body:{expectedVersion, ...supportHandoff(bytes, filename)}, mutation:false});
  }
  supportReceive(caseId, bytes, body) {
    id(caseId, 'operation');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'filename',
      'expectedPreviewSha256', 'deploymentId', 'deployment'],
    ['expectedVersion', 'requestId', 'actor', 'filename', 'expectedPreviewSha256']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    sha(body.expectedPreviewSha256); text(body.actor, 'Receiving operator', 300);
    if (body.note !== undefined) text(body.note, 'Receiving note', 12000, true);
    const {filename, expectedPreviewSha256, deploymentId = null, deployment, ...original} = body;
    if (deploymentId !== null) {
      id(deploymentId, 'deployment');
      need(deployment === undefined || deployment === null ||
        (plain(deployment) && Object.keys(deployment).length === 0), 'GRANT_INVALID_INPUT',
      'Choose the existing deployment without competing replacement fields.');
    } else exact(deployment, SUPPORT_DEPLOYMENT_FIELDS);
    return this.#request('/api/operations/' + caseId + '/command', {originalRequestId:body.requestId,
      body:{...original, action:'support.receive', data:{...supportHandoff(bytes, filename),
        expectedPreviewSha256, deploymentId, ...(deployment === undefined ? {} : {deployment})}}});
  }
  download(kind, args) {
    object(args);
    const routes = {
      plan:() => '/api/plans/' + id(args.planId, 'plan') + '/export.zip',
      scenario:() => '/api/plans/' + id(args.planId, 'plan') + '/scenario.json',
      'daily-csv':() => '/api/plans/' + id(args.planId, 'plan') + '/daily.csv',
      'costs-csv':() => '/api/plans/' + id(args.planId, 'plan') + '/costs.csv',
      case:() => '/api/operations/' + id(args.caseId, 'operation') + '/export.zip',
      forecast:() => '/api/operations/' + id(args.caseId, 'operation') + '/forecasts/' + id(args.forecastId, 'forecast') + '/export.zip',
      portfolio:() => '/api/operations/' + id(args.caseId, 'operation') + '/portfolios/' + id(args.portfolioId, 'portfolio') + '/export.zip',
      source:() => '/api/operations/' + id(args.caseId, 'operation') + '/sources/' + id(args.sourceId, 'source'),
    };
    need(Object.hasOwn(routes, kind), 'GRANT_INVALID_DOWNLOAD', 'Choose a complete original grant export or source.');
    return this.#request(routes[kind](), {});
  }
  importBundle(kind, bytes, body) {
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_BUNDLE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'Use the complete original bundle up to 32 MiB.');
    exact(body, ['name', 'requestId', 'actor'], ['name', 'requestId']);
    requestId(body.requestId); text(body.name, 'Received name', 300);
    need(['plan', 'case'].includes(kind), 'GRANT_INVALID_IMPORT', 'Choose a complete planning or operating-case bundle.');
    if (kind === 'case') text(body.actor, 'Receiving operator', 300);
    return this.#request((kind === 'case' ? '/api/operations/import' : '/api/import-bundle') + '?name=' + encodeURIComponent(body.name),
      {body:bytes, contentType:'application/zip', originalRequestId:body.requestId,
        headers:{'X-Request-ID':body.requestId, ...(kind === 'case' ? {'X-Recorded-By':encodeURIComponent(body.actor)} : {})}});
  }
  importScenario(bytes, body) {
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_SOURCE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'Use original scenario bytes up to 8 MiB.');
    exact(body, ['name', 'requestId', 'note', 'planning', 'filename'], ['name', 'requestId']);
    requestId(body.requestId);
    return this.#request('/api/import-scenario', {body:{...body, sourceBase64:bytes.toString('base64')}, originalRequestId:body.requestId});
  }
  attach(caseId, bytes, body) {
    id(caseId, 'operation');
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_SOURCE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'An original source attachment fits 8 MiB.');
    exact(body, ['expectedVersion', 'requestId', 'actor', 'note', 'filename', 'kind', 'mediaType', 'sourceUrl', 'observedAt'],
      ['expectedVersion', 'requestId', 'actor', 'filename', 'kind', 'mediaType']);
    integer(body.expectedVersion, 'Current case version'); requestId(body.requestId);
    const {expectedVersion, requestId:request, actor, note = '', ...data} = body;
    return this.#request('/api/operations/' + caseId + '/command', {originalRequestId:request,
      body:{expectedVersion, requestId:request, actor, note, action:'source.add', data:{...data, contentBase64:bytes.toString('base64')}}});
  }
  intake(bytes, body) {
    need(Buffer.isBuffer(bytes) && bytes.length <= GRANT_MAX_SOURCE_BYTES, 'GRANT_INPUT_TOO_LARGE', 'Use a complete original source-intake packet up to 8 MiB.');
    exact(body, ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'calendarStart', 'actor', 'requestId'],
      ['planId', 'selectedRevision', 'expectedContentSha256', 'name', 'actor', 'requestId']);
    requestId(body.requestId); id(body.planId, 'plan'); sha(body.expectedContentSha256);
    return this.#request('/api/operations/intake', {originalRequestId:body.requestId,
      body:{...body, packetBase64:bytes.toString('base64')}});
  }
  async detach(expectedInstanceId) {
    if (this.#opening) await this.#opening;
    const owned = this.#child, connection = this.#connection;
    if (expectedInstanceId !== undefined) need(connection?.original.instanceId === expectedInstanceId,
      'GRANT_INSTANCE_CONFLICT', 'Read the original instance before closing this connection.');
    await Promise.allSettled([...this.#pending]);
    if (owned) {
      need(!owned.instanceId || owned.instanceId === connection?.original.instanceId, 'GRANT_INSTANCE_CONFLICT',
        'This client may stop only its original owned grant instance.');
      if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill('SIGTERM');
      const result = await owned.done;
      if (this.#child === owned) this.#child = null;
      this.#connection = null;
      return {schema:GRANT_AGENT_SCHEMA, state:'OWNED_ORIGINAL_SERVICE_CLOSED', originalInstanceId:owned.instanceId, result};
    }
    this.#connection = null;
    return {schema:GRANT_AGENT_SCHEMA, state:'BORROWED_CONNECTION_RELEASED', originalInstanceId:connection?.original.instanceId ?? null};
  }
  close() {
    if (!this.#close) { this.#closing = true; this.#close = this.detach(); }
    return this.#close;
  }
}
