// MIT. Exact customer downloads over the original SAM API and native retained-file reader.
import {mkdir, readdir, open, lstat, unlink, link} from 'node:fs/promises';
import {join, basename} from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {acquirePrivateDirectoryWriter} from '../operations/history.mjs';
import {sha as identity} from './core.mjs';
import {RetainedFileReads} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {samNeed, samFailure, samPrivateDirectory, samReadPrivateJson, samWritePrivateJson,
  samRequest, inspectSamListener, SAM_MAX_RESPONSE_BYTES, SAM_HASH} from './connection.mjs';

const EXPORT_SCHEMA = 'stellar-forge.samgov-customer-export.v1';
async function folder(path) {
  try { await mkdir(path, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await samPrivateDirectory(path); return path;
}
async function optionalJson(path) {
  try { return (await samReadPrivateJson(path, 128 * 1024)).value; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function fileDigest(path, maximum) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    samNeed(info.isFile() && info.size <= maximum &&
      (process.platform === 'win32' || !(info.mode & 0o077) && (!process.getuid || info.uid === process.getuid())),
    'SAM_EXPORT_FILE_INVALID', 'The retained customer file is not an owned original regular file.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024); let position = 0;
    while (position < info.size) {
      const {bytesRead} = await file.read(buffer, 0, Math.min(buffer.length, info.size - position), position);
      samNeed(bytesRead > 0, 'SAM_EXPORT_FILE_CHANGED', 'The retained customer file changed.', 409);
      hash.update(buffer.subarray(0,bytesRead)); position += bytesRead;
    }
    const after = await file.stat();
    samNeed(['dev','ino','size','mtimeMs','ctimeMs'].every(key => info[key] === after[key]),
      'SAM_EXPORT_FILE_CHANGED', 'The retained customer file changed during inspection.', 409);
    return {bytes: position, sha256: hash.digest('hex')};
  } finally { await file.close(); }
}
function fileName(value, fallback) {
  const match = /(?:^|;\s*)filename="([^"]*)"/.exec(value || '');
  const name = match?.[1] || fallback;
  samNeed(name === basename(name) && name.length >= 1 && name.length <= 240 &&
    !/[\\/\x00-\x1f\x7f]/.test(name), 'SAM_EXPORT_NAME_INVALID', 'The original export filename is invalid.');
  return name;
}
export class SamRetainedFiles {
  #directory; #reads = new RetainedFileReads({errorPrefix: 'SAMGOV'});
  constructor(directory) { this.#directory = directory; }
  get summary() { return this.#reads.summary; }
  async #root(scope) {
    await samPrivateDirectory(this.#directory);
    return folder(join(await folder(join(this.#directory, 'samgov')), scope.alias));
  }
  async #exportDirectory(scope, exportId) {
    samNeed(/^sx_[a-f0-9]{64}$/.test(exportId), 'SAM_EXPORT_ID_INVALID', 'Choose a retained SAM export ID.');
    return join(await this.#root(scope), exportId);
  }
  #selection(args) {
    const selected = {format: args.format};
    samNeed(['portable','html','markdown','notices','reviews','changes','sources'].includes(args.format),
      'SAM_EXPORT_FORMAT_INVALID', 'Choose an original SAM export format.');
    samNeed(Boolean(args.handoffId) !== (args.revision !== undefined),
      'SAM_EXPORT_REVISION_REQUIRED', 'Select one exact source revision or named handoff.');
    if (args.revision !== undefined) {
      samNeed(Number.isSafeInteger(args.revision) && args.revision >= 1,
        'SAM_EXPORT_REVISION_REQUIRED', 'Choose an original positive source revision.');
      selected.revision = args.revision;
    }
    for (const key of ['selectionId','handoffId']) if (args[key] !== undefined) selected[key] = args[key];
    samNeed(!(selected.selectionId && selected.handoffId), 'SAM_EXPORT_SELECTION_CONFLICT',
      'Select a retained selection or a named handoff.');
    return selected;
  }
  #intent(scope, args) {
    samNeed(typeof args.requestId === 'string' && args.requestId.length >= 1 && args.requestId.length <= 200 &&
      !/[\x00-\x1f\x7f]/.test(args.requestId), 'SAM_EXPORT_REQUEST_ID_REQUIRED', 'Retain a stable export request ID.');
    return {workspace: scope.alias, directory: scope.directory, requestId: args.requestId,
      selection: this.#selection(args)};
  }
  async #record(scope, exportId) {
    const directory = await this.#exportDirectory(scope, exportId);
    const result = await optionalJson(join(directory,'export.json'));
    samNeed(result?.schema === EXPORT_SCHEMA && result.exportId === exportId &&
      result.intent?.workspace === scope.alias && result.intent?.directory === scope.directory &&
      result.requestSha256 === identity(result.intent) && SAM_HASH.test(result.sha256) &&
      Number.isSafeInteger(result.bytes) && result.bytes >= 0 && result.bytes <= SAM_MAX_RESPONSE_BYTES &&
      typeof result.filename === 'string' && result.filename === basename(result.filename),
    'SAM_EXPORT_NOT_FOUND', 'Choose a completed original export for this workspace.', 404);
    return {directory, result};
  }
  async findExport(scope, args) {
    const intent = this.#intent(scope,args), exportId = 'sx_' + identity({workspace: scope.alias, requestId: args.requestId});
    const directory = await this.#exportDirectory(scope,exportId);
    const result = await optionalJson(join(directory,'export.json'));
    if (!result) return null;
    const record = await this.#record(scope,exportId);
    samNeed(record.result.requestSha256 === identity(intent), 'SAM_EXPORT_REQUEST_REUSED',
      'This export request ID belongs to different source selection or options.', 409);
    return {...record.result, reused: true};
  }
  async #download(connection, path, directory, {maximum, expectedSha256, expectedBytes, fallback}) {
    const target = join(directory,'content'), savedHeaders = join(directory,'response.json');
    try {
      const info = await lstat(target);
      samNeed(info.isFile() && !info.isSymbolicLink(), 'SAM_EXPORT_FILE_INVALID', 'The original customer file is invalid.');
      const headers = await optionalJson(savedHeaders), found = await fileDigest(target,maximum);
      samNeed(headers && headers.bytes === found.bytes && (!expectedSha256 || found.sha256 === expectedSha256) &&
        (expectedBytes === undefined || found.bytes === expectedBytes),
      'SAM_EXPORT_FILE_CHANGED', 'The retained original download differs from its response.', 409);
      return {...headers,...found};
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const partial = join(directory,'download.partial');
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const transfer = await samRequest(connection,path,{raw:true,maximum});
    let file;
    try {
      const header = transfer.response.headers.get('content-length');
      samNeed(/^\d+$/.test(header || '') && Number(header) <= maximum &&
        (expectedBytes === undefined || Number(header) === expectedBytes),
      'SAM_EXPORT_LENGTH_INVALID', 'The original response must provide its exact supported byte count.');
      const meta = {filename: fileName(transfer.response.headers.get('content-disposition'),fallback),
        mediaType: transfer.response.headers.get('content-type') || 'application/octet-stream',
        bytes: Number(header), capturedAt: new Date().toISOString()};
      await samWritePrivateJson(savedHeaders,meta,{replace:true});
      file = await open(partial,'wx',0o600);
      const hash = createHash('sha256'); let length = 0;
      if (transfer.response.body) for await (const chunk of transfer.response.body) {
        samNeed(length + chunk.length <= meta.bytes && length + chunk.length <= maximum,
          'SAM_EXPORT_LENGTH_INVALID', 'The original download exceeds its declared byte count.');
        let offset = 0;
        while (offset < chunk.length) {
          const written = await file.write(chunk,offset,chunk.length-offset,length+offset);
          samNeed(written.bytesWritten > 0, 'SAM_EXPORT_WRITE_FAILED', 'The retained download could not be written.', 507);
          offset += written.bytesWritten;
        }
        length += chunk.length; hash.update(chunk);
      }
      const sha256 = hash.digest('hex');
      samNeed(length === meta.bytes && (!expectedSha256 || sha256 === expectedSha256),
        'SAM_EXPORT_BYTES_CHANGED', 'The complete received bytes differ from the selected original source.', 409);
      await file.sync(); await file.close(); file = null;
      await link(partial,target); await unlink(partial);
      const parent = await open(directory,'r');
      try { await parent.sync(); } finally { await parent.close(); }
      return {...meta,sha256};
    } finally {
      try { if (file) await file.close(); }
      finally {
        try { await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        finally { await transfer.release(); }
      }
    }
  }
  async export(scope, connection, args) {
    const prior = await this.findExport(scope,args);
    if (prior) return prior;
    const intent = this.#intent(scope,args), exportId = 'sx_' + identity({workspace: scope.alias, requestId: args.requestId});
    const directory = await folder(await this.#exportDirectory(scope,exportId));
    const lease = await acquirePrivateDirectoryWriter(directory);
    try {
      const repeated = await this.findExport(scope,args); if (repeated) return repeated;
      const requestSha256 = identity(intent), preparedPath = join(directory,'request.json');
      let prepared = await optionalJson(preparedPath);
      const live = await inspectSamListener(connection);
      samNeed(live.workspace.id, 'SAM_WORKSPACE_EMPTY', 'Retain original SAM source before exporting.');
      if (prepared) {
        samNeed(prepared.schema === EXPORT_SCHEMA + '.request' &&
          prepared.requestSha256 === requestSha256 && identity(prepared.intent) === requestSha256,
        'SAM_EXPORT_REQUEST_REUSED', 'This retained export request belongs to different input.', 409);
        samNeed(prepared.workspaceId === live.workspace.id, 'SAM_EXPORT_WORKSPACE_CHANGED',
          'Continue this export in the same original SAM workspace.', 409);
      } else {
        prepared = {schema: EXPORT_SCHEMA + '.request', intent, requestSha256,
          workspaceId: live.workspace.id, preparedAt: new Date().toISOString()};
        await samWritePrivateJson(preparedPath,prepared);
      }
      const parameters = new URLSearchParams(Object.entries(intent.selection).map(([key,value]) => [key,String(value)]));
      const file = await this.#download(connection,'/api/export?' + parameters.toString(),directory,
        {maximum:SAM_MAX_RESPONSE_BYTES,fallback:'samgov-export'});
      const result = {schema: EXPORT_SCHEMA, exportId, intent, requestSha256,
        workspaceId: prepared.workspaceId, ...file, completedAt: new Date().toISOString()};
      await samWritePrivateJson(join(directory,'export.json'),result);
      return result;
    } finally { await lease.release(); }
  }
  async list(scope, offset = 0, limit = 50) {
    samNeed(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000,
      'SAM_EXPORT_PAGE_INVALID','Choose a nonnegative offset and page size from 1 to 1000.');
    const names = (await readdir(await this.#root(scope))).filter(name => /^sx_[a-f0-9]{64}$/.test(name)).sort();
    const records = [];
    for (const name of names) {
      const value = await optionalJson(join(await this.#exportDirectory(scope,name),'export.json'));
      if (value) records.push((await this.#record(scope,name)).result);
    }
    return {exports:records.slice(offset,offset+limit),offset,limit,total:records.length,
      nextOffset:offset+limit<records.length?offset+limit:null};
  }
  async file(scope, connection, args) {
    const key = args.kind + ':' + args.id;
    return this.#reads.read({scope:scope.alias,key,kind:args.kind,directory:this.#directory,
      readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
      load:async () => {
        let directory, metadata;
        if (args.kind === 'export') {
          const retained = await this.#record(scope,args.id); directory = retained.directory; metadata = retained.result;
        } else {
          samNeed(args.kind === 'source' && connection, 'SAM_SOURCE_CONNECTION_REQUIRED',
            'Connect the original SAM workspace to read a retained source.');
          const live = await inspectSamListener(connection);
          const original = live.workspace.sources.find(source => source.id === args.id);
          samNeed(original && SAM_HASH.test(original.sha256), 'SAM_SOURCE_NOT_FOUND', 'Choose an original retained source ID.',404);
          directory = await folder(join(await this.#root(scope),'source_' + original.sha256));
          const lease = await acquirePrivateDirectoryWriter(directory);
          try { metadata = await this.#download(connection,'/api/sources/' + encodeURIComponent(args.id) + '?download=1',directory,
            {maximum:64*1024*1024,expectedSha256:original.sha256,expectedBytes:original.bytes,fallback:original.filename}); }
          finally { await lease.release(); }
        }
        const path = join(directory,'content'), readonlyFileHandle = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        return {readonlyFileHandle,bytes:metadata.bytes,sha256:metadata.sha256,name:metadata.filename,type:metadata.mediaType};
      }});
  }
  release(scope,readId) { return this.#reads.release(scope.alias,readId); }
  disconnect(scope) { return this.#reads.closeScope(scope.alias); }
  close() { return this.#reads.close(); }
}
