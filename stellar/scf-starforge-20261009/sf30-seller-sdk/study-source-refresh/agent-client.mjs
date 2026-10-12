// MIT. Typed transport to the original Study HTTP operator; no business-state replica.
import { open, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { STUDY_AGENT_SCHEMA, STUDY_NATIVE_OPERATIONS } from './agent-contracts.mjs';
import { STUDY_HERE, STUDY_INSTANCE_SCHEMA, STUDY_MAX_PACKET_BYTES, STUDY_MAX_JSON_BYTES, STUDY_REQUEST_BYTES,
  STUDY_CHUNK_BYTES, canonical, decode, hash, failure, need, exact, sha, integer, absolute, privateDirectory, plain,
  readFile, fileHandle, verifyHandle, sourceSelection, inspectStudyBinding } from './agent-local.mjs';
export { inspectStudyBinding } from './agent-local.mjs';
export { STUDY_AGENT_SCHEMA, STUDY_NATIVE_OPERATIONS } from './agent-contracts.mjs';

const CONNECTION_SCHEMA = 'stellar-forge.study-operator-connection.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const missing = error => ['ENOENT','ECONNREFUSED'].includes(error.code);
const sourceOf = connection => ({schema:STUDY_INSTANCE_SCHEMA, instanceId:connection.operator.instance_id,
  pid:connection.pid, selectionSha256:connection.operator.selection_sha256,
  sourceSha256:connection.operator.source_sha256, baseUrl:connection.base_url});
function origin(value) {
  const url = new URL(value);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    !url.hash && !url.search && url.pathname === '/' && Number(url.port) >= 1 && Number(url.port) <= 65535,
  'STUDY_LOOPBACK_REQUIRED', 'Use the original local Study operator listener.');
  return url;
}
function safeFilename(value, fallback) {
  const filename = typeof value === 'string' ? value.match(/filename="([^"]+)"/)?.[1] : null;
  return filename && filename.length <= 240 && !/[\/\\\x00-\x1f\x7f]/.test(filename) ? filename : fallback;
}

/** Preserve every complete native JSON response, including its original refusal. */
async function transport(connection, route, {body, inputFile, outputFile, contentType = 'application/json',
  mutation = false, operation = route, timeoutMs = 360000, maximum = STUDY_MAX_JSON_BYTES} = {}) {
  need((body === undefined || inputFile === undefined) && route.startsWith('/') && !route.startsWith('//'),
    'STUDY_ROUTE_INVALID', 'Use one declared original route and request body.');
  const base = origin(connection.base_url), target = new URL(route, base);
  need(target.origin === base.origin, 'STUDY_ROUTE_INVALID', 'Keep the original authenticated local operator.');
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  need(bytes === undefined || bytes.length <= STUDY_REQUEST_BYTES, 'STUDY_REQUEST_TOO_LARGE',
    'The original Study JSON request fits 4 MiB.');
  let original, output;
  if (inputFile) {
    original = await fileHandle(inputFile.path, STUDY_MAX_PACKET_BYTES);
    try {
      need(original.bytes === inputFile.bytes, 'STUDY_INPUT_CHANGED', 'The original upload length changed.');
      await verifyHandle(original, inputFile.sha256);
    } catch (error) { await original.handle.close(); throw error; }
  }
  const length = original?.bytes ?? bytes?.length;
  if (outputFile) {
    await privateDirectory(dirname(absolute(outputFile)));
    try { output = await open(outputFile, 'wx', 0o600); }
    catch (error) { await original?.handle.close(); throw error; }
  }
  let dispatched = false, keptOutput = false;
  try {
    const result = await new Promise((resolveResult, reject) => {
      let settled = false, sending = Promise.resolve();
      const fail = error => {
        if (settled) return;
        settled = true;
        if (mutation && dispatched) reject(failure('STUDY_RESULT_UNCERTAIN',
          'The original operation may have committed. Reopen the same workspace and inspect its saved source, comparison, review version or export before another write.',
          {operation, source:sourceOf(connection), originalCode:error.code ?? null, uncertain:true}));
        else reject(error);
      };
      const request = httpRequest(target, {method:length === undefined ? 'GET' : 'POST', agent:false, maxHeaderSize:32768,
        headers:{Authorization:'Bearer ' + connection.token, Accept:'application/json, application/octet-stream',
          ...(length === undefined ? {} : {'Content-Type':contentType, 'Content-Length':String(length)}),
          ...(original ? {'X-Content-SHA256':inputFile.sha256} : {})}},
      response => {
        (async () => {
          const chunks = [], digest = createHash('sha256'); let count = 0;
          const status = response.statusCode ?? 0;
          const mediaType = String(response.headers['content-type'] ?? 'application/octet-stream');
          const jsonResponse = /^application\/json\b/i.test(mediaType);
          const outputResponse = output && status >= 200 && status < 300 && !jsonResponse;
          const bound = outputResponse ? maximum : Math.min(maximum, STUDY_MAX_JSON_BYTES);
          for await (const part of response) {
            count += part.length;
            need(count <= bound, 'STUDY_RESPONSE_TOO_LARGE', 'The complete native response exceeds its receiving limit.');
            digest.update(part);
            if (outputResponse) await output.writeFile(part); else chunks.push(part);
          }
          await sending;
          const declared = response.headers['content-length'];
          need(declared === undefined || /^[0-9]+$/.test(String(declared)) && Number(declared) === count,
            'STUDY_RESPONSE_INTERRUPTED', 'Receive the complete native response length.');
          const sha256 = digest.digest('hex'), raw = outputResponse ? undefined : Buffer.concat(chunks);
          const value = jsonResponse ? decode(raw) : undefined;
          const suppliedHash = response.headers['x-content-sha256'];
          if (suppliedHash !== undefined) need(sha256 === sha(String(suppliedHash)), 'STUDY_DOWNLOAD_CHANGED',
            'The complete native download differs from its original response hash.');
          if (outputResponse) await output.sync();
          if (original) await verifyHandle(original, inputFile.sha256);
          if (settled) return;
          settled = true;
          resolveResult({status, mediaType, sha256, bytes:raw, byteCount:count, value,
            ...(outputResponse ? {file:outputFile} : {}), source:sourceOf(connection),
            filename:safeFilename(response.headers['content-disposition'], outputResponse ? 'original.bin' : 'original-response.json')});
        })().catch(error => { response.destroy(); fail(error); });
      });
      request.once('error', error => { if (request.socket?.bytesWritten) dispatched = true; fail(error); });
      request.once('finish', () => { dispatched = true; });
      request.setTimeout(timeoutMs, () => request.destroy(failure('STUDY_REQUEST_TIMEOUT', 'The original operator request timed out.')));
      if (original) {
        sending = (async () => {
          const buffer = Buffer.alloc(STUDY_CHUNK_BYTES); let position = 0;
          while (position < original.bytes) {
            const read = await original.handle.read(buffer, 0, Math.min(buffer.length, original.bytes - position), position);
            need(read.bytesRead > 0, 'STUDY_INPUT_CHANGED', 'The original upload ended before its recorded length.');
            dispatched = true;
            await new Promise((resolveWrite, rejectWrite) => request.write(buffer.subarray(0, read.bytesRead),
              error => error ? rejectWrite(error) : resolveWrite()));
            position += read.bytesRead;
          }
          request.end();
        })();
        sending.catch(error => request.destroy(error));
      } else { if (bytes) dispatched = true; request.end(bytes); }
    });
    keptOutput = Boolean(result.file);
    return result;
  } finally {
    await original?.handle.close();
    await output?.close();
    if (outputFile && !keptOutput)
      await unlink(outputFile).catch(() => {});
  }
}

export class StudyWorkspaceClient {
  #binding; #environment; #connection = null; #owned = null; #opening = null; #detaching = false; #closing = false; #close = null;
  #pending = new Set();
  constructor(binding, options = {}) {
    exact(options, ['environment']);
    const environment = options.environment ?? process.env;
    need(plain(environment) && Object.values(environment).every(value => typeof value === 'string'),
      'STUDY_ENVIRONMENT_INVALID', 'Use the original host-selected process environment.');
    this.#binding = binding; this.#environment = Object.freeze({...environment});
  }
  get summary() {
    return {schema:STUDY_AGENT_SCHEMA, label:this.#binding.label, selectionSha256:this.#binding.selectionSha256,
      allowStart:this.#binding.allowStart, state:this.#connection ? this.#owned ? 'OWNED_ORIGINAL_OPERATOR' : 'BORROWED_ORIGINAL_OPERATOR' : 'CLOSED',
      instanceId:this.#connection?.operator.instance_id ?? null, activeRequests:this.#pending.size};
  }
  #available() { need(!this.#closing && !this.#detaching, 'STUDY_CLOSING', 'The original Study connection is closing.'); }
  async #track(action) {
    this.#available();
    const pending = action(); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  async #readConnection() {
    const binding = this.#binding, filename = join(binding.directory, 'connection.json');
    const bytes = await readFile(filename, 131072, true), record = decode(bytes);
    need(record.schema === CONNECTION_SCHEMA && typeof record.token === 'string' &&
      /^[A-Za-z0-9_-]{40,128}$/.test(record.token) && Number.isSafeInteger(record.pid) && record.pid > 0 &&
      record.operator?.schema === STUDY_INSTANCE_SCHEMA && UUID.test(record.operator.instance_id ?? ''),
    'STUDY_OPERATOR_IDENTITY_REQUIRED', 'Open the maintained Study operator with its original instance identity.');
    origin(record.base_url);
    need(record.operator.pid === record.pid && record.operator.base_url === record.base_url &&
      record.operator.selection_sha256 === binding.selectionSha256 &&
      record.operator.source_sha256 === binding.sourceSha256 &&
      canonical(record.operator.selection) === canonical(binding.selection) &&
      record.operator.execution?.python_realpath === binding.pythonRealpath,
    'STUDY_SELECTION_CHANGED', 'The running original operator uses another workspace, Python runtime or application source selection.');
    const response = await transport(record, '/api/access', {timeoutMs:4000, maximum:131072});
    need(![401,403].includes(response.status), 'STUDY_OPERATOR_AUTHENTICATION_FAILED',
      'The original operator rejected its selected private connection. Reconcile that connection.');
    need(response.status === 200 && response.value?.ok === true &&
      canonical(response.value.result) === canonical(record.operator), 'STUDY_OPERATOR_UNAVAILABLE',
    'Authenticate the exact original operator instance before continuing.');
    need((await readFile(filename, 131072, true)).equals(bytes), 'STUDY_INSTANCE_CHANGED',
      'The original connection changed while its listener was authenticated.');
    const current = await sourceSelection(binding.directory);
    need(current.selectionSha256 === binding.selectionSha256, 'STUDY_SOURCE_CHANGED',
      'The selected application source changed. Reopen the host configuration against the intended source.');
    return record;
  }
  inspect() {
    return this.#track(async () => {
      try {
        const current = await this.#readConnection();
        return {...this.summary, state:this.#owned?.child.pid === current.pid ? 'OWNED_ORIGINAL_OPERATOR' : 'BORROWED_ORIGINAL_OPERATOR',
          original:current.operator};
      } catch (error) {
        if (missing(error)) return {...this.summary,state:'ORIGINAL_OPERATOR_UNAVAILABLE',reason:error.code};
        throw error;
      }
    });
  }
  async open({expectedSelectionSha256} = {}) {
    this.#available();
    if (expectedSelectionSha256 !== undefined) need(sha(expectedSelectionSha256) === this.#binding.selectionSha256,
      'STUDY_SELECTION_CHANGED', 'Use this original host-reviewed source selection.');
    if (this.#opening) return this.#opening;
    this.#opening = (async () => {
      try {
        this.#connection = await this.#readConnection();
        return {...this.summary, original:this.#connection.operator};
      } catch (error) { if (!missing(error)) throw error; }
      need(this.#binding.allowStart, 'STUDY_START_NOT_ENABLED',
        'This host alias borrows the original operator. Open its installed Study command, then attach this alias.');
      need(!this.#owned, 'STUDY_CHILD_ACTIVE', 'Reconcile the current original child before another start.');
      await privateDirectory(this.#binding.directory, true);
      const current = await inspectStudyBinding(this.#bindingInput());
      need(current.selectionSha256 === this.#binding.selectionSha256, 'STUDY_SELECTION_CHANGED',
        'The reviewed original source selection changed before startup.');
      const child = spawn(this.#binding.pythonExecutable, ['-B',join(STUDY_HERE,'cli.py'),
        '--workspace',this.#binding.directory,'serve','--port','0'],
        {stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...this.#environment,PYTHONDONTWRITEBYTECODE:'1'}});
      const owned = {child,done:null}; this.#owned = owned;
      owned.done = new Promise(resolveDone => {
        child.once('error', error => resolveDone({code:null,signal:null,error:error.code}));
        child.once('exit', (code,signal) => resolveDone({code,signal}));
      });
      owned.done.then(result => {
        owned.result = result;
        if (this.#owned === owned) {
          this.#owned = null;
          if (this.#connection?.pid === child.pid) this.#connection = null;
        }
      });
      let diagnostics = '', buffer = '';
      child.stderr.on('data', part => { diagnostics = (diagnostics + part.toString('utf8')).slice(-16000); });
      try {
        await new Promise((ready,reject) => {
          let done = false;
          const finish = error => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : ready(); };
          const timer = setTimeout(() => finish(failure('STUDY_START_TIMEOUT','The original Study operator did not announce its listener.')),30000);
          child.stdout.on('data', part => {
            buffer += part.toString('utf8');
            if (buffer.length > 65536) return finish(failure('STUDY_START_OUTPUT_INVALID','The original startup output exceeds its bound.'));
            let at;
            while ((at = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0,at); buffer = buffer.slice(at+1);
              try {
                const value = JSON.parse(line);
                if (value.connection_file === join(this.#binding.directory,'connection.json') && value.base_url) finish();
              } catch {}
            }
          });
          owned.done.then(result => finish(failure('STUDY_START_FAILED','The original Study child exited before startup.',
            {exitCode:result.code,signal:result.signal,diagnostics})));
        });
        const connection = await this.#readConnection();
        need(connection.pid === child.pid, 'STUDY_CHILD_IDENTITY_CONFLICT', 'The announced listener belongs to another original child.');
        this.#connection = connection;
        return {...this.summary,original:connection.operator};
      } catch (error) {
        await this.#stopOwned(owned);
        try { this.#connection = await this.#readConnection(); return {...this.summary,original:this.#connection.operator}; }
        catch { throw error; }
      }
    })();
    try { return await this.#opening; } finally { this.#opening = null; }
  }
  #bindingInput() {
    const {directory,pythonExecutable,allowStart,label} = this.#binding;
    return {directory,pythonExecutable,allowStart,label};
  }
  async #selected() {
    need(this.#connection, 'STUDY_OPEN_REQUIRED', 'Open the declared original Study workspace before dispatch.');
    const selected = await this.#readConnection();
    need(selected.operator.instance_id === this.#connection.operator.instance_id, 'STUDY_INSTANCE_CHANGED',
      'The original operator restarted. Inspect its saved results and explicitly reopen the current instance.');
    return selected;
  }
  call(operation, args = {}) {
    const definition = STUDY_NATIVE_OPERATIONS[operation];
    need(definition, 'STUDY_OPERATION_UNKNOWN', 'Choose a declared original Study operation.');
    exact(args, definition.fields, definition.required);
    return this.#track(async () => transport(await this.#selected(), '/api',
      {body:{operation,arguments:args},operation,mutation:!definition.readOnly}));
  }
  browser() {
    return this.#track(async () => {
      const connection = await this.#selected();
      return {schema:STUDY_AGENT_SCHEMA,url:connection.base_url + '/#' + connection.token,original:connection.operator};
    });
  }
  download(selection, destination) {
    exact(selection,['kind','id','path'],['kind','id']);
    need(['archive','export','source','property_document'].includes(selection.kind), 'STUDY_DOWNLOAD_INVALID',
      'Select an original archive or declared source/export member.');
    sha(selection.id);
    need(selection.kind === 'archive' ? selection.path === undefined : typeof selection.path === 'string',
      'STUDY_DOWNLOAD_INVALID', 'Use the original declared member for a source or export download.');
    const query = new URLSearchParams(selection);
    return this.#track(async () => transport(await this.#selected(), '/download?' + query,
      {outputFile:absolute(destination),maximum:STUDY_MAX_PACKET_BYTES,operation:'download'}));
  }
  importPackage(file) {
    exact(file,['path','bytes','sha256'],['path','bytes','sha256']);
    integer(file.bytes,STUDY_MAX_PACKET_BYTES); sha(file.sha256);
    return this.#track(async () => transport(await this.#selected(),'/upload',
      {inputFile:file,contentType:'application/zip',mutation:true,operation:'package.import'}));
  }
  async #stopOwned(owned) {
    if (!owned || this.#owned !== owned) return;
    const child = owned.child;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    let timer;
    const result = await Promise.race([owned.done,new Promise(resolveDone => { timer = setTimeout(() => resolveDone(null),10000); })]);
    clearTimeout(timer);
    if (!result && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      let lastTimer;
      const stopped = await Promise.race([owned.done,new Promise(resolveDone => {lastTimer = setTimeout(() => resolveDone(null),5000);})]);
      clearTimeout(lastTimer);
      need(stopped, 'STUDY_SHUTDOWN_INCOMPLETE', 'The original owned Study child has not returned its terminal process status.');
    }
    if (this.#owned === owned) this.#owned = null;
  }
  async detach(expectedInstanceId) {
    need(!this.#detaching, 'STUDY_CLOSING', 'This original connection is already closing.');
    this.#detaching = true;
    try {
      if (this.#opening) await this.#opening.catch(() => {});
      if (expectedInstanceId !== undefined) need(this.#connection?.operator.instance_id === expectedInstanceId,
        'STUDY_INSTANCE_CHANGED','Select the current original instance before closing this connection.');
      await Promise.allSettled([...this.#pending]);
      const owned = this.#owned, instanceId = this.#connection?.operator.instance_id ?? null;
      await this.#stopOwned(owned); this.#connection = null;
      return {schema:STUDY_AGENT_SCHEMA,state:owned ? 'OWNED_ORIGINAL_OPERATOR_CLOSED' : 'BORROWED_CONNECTION_RELEASED',instanceId};
    } finally { this.#detaching = false; }
  }
  close() {
    this.#closing = true;
    if (!this.#close) this.#close = this.detach().catch(error => {this.#close = null; throw error;});
    return this.#close;
  }
}
