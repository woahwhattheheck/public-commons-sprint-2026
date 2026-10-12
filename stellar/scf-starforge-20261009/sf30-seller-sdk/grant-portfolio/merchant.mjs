// MIT. Merchant access borrows the original grant-portfolio console and its action ledger.
import {open, mkdir, lstat, realpath, readdir, link, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {RetainedFileReads} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {privateSupportDirectory} from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {connectGrantPortfolio} from './client.mjs';
import {grantPortfolioTools} from './merchant-catalog.mjs';
import {
  GRANT_PORTFOLIO_CONNECTION_SCHEMA, GRANT_PORTFOLIO_MANIFEST, GRANT_PORTFOLIO_MAX_BYTES,
  GRANT_PORTFOLIO_SHA as SHA, GRANT_PORTFOLIO_UUID as UUID, GRANT_PORTFOLIO_ALIAS as ALIAS,
  portfolioPlain as plain, portfolioHash as hash, portfolioNeed as need,
  portfolioFailure as failure, portfolioExact as exact, portfolioChecked as checked,
  portfolioInteger as integer, portfolioJson as json,
  createGrantPortfolioManifest, parseGrantPortfolioManifest,
} from './merchant-contract.mjs';
export {grantPortfolioTools, GRANT_PORTFOLIO_CONNECTION_SCHEMA};
const definitions = new Map(grantPortfolioTools((name, description, properties, required) =>
  ({name, properties, required})).map(value => [value.name, value]));
const pathOf = (value, base) => {
  need(typeof value === 'string' && value && !value.includes('\0'), 'CONFIGURATION', 'Select an original host file path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
};
const line = (value, maximum = 500) => {
  need(typeof value === 'string' && value.trim() && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value),
    'CONFIGURATION', 'Use an original printable label.'); return value;
};
async function regular(filename, maximum, privateFile = true) {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size <= maximum && (!privateFile || process.platform === 'win32' ||
      (info.mode & 0o077) === 0 && info.uid === process.getuid()), 'FILE_INVALID', 'Use a complete original regular file with its required privacy.');
    return {handle, info};
  } catch (error) { await handle.close(); throw error; }
}
async function bytes(filename, maximum) {
  const {handle, info} = await regular(filename, maximum);
  try {
    const value = await handle.readFile(), after = await handle.stat();
    need(value.length === info.size && after.size === info.size && after.mtimeMs === info.mtimeMs &&
      after.ctimeMs === info.ctimeMs, 'FILE_CHANGED', 'The original private record changed during reading.');
    return value;
  } finally { await handle.close(); }
}
async function directory(filename) {
  await mkdir(filename, {mode:0o700}).catch(error => {if (error.code !== 'EEXIST') throw error;});
  await privateSupportDirectory(filename);
  need(await realpath(filename) === filename, 'DIRECTORY_INVALID', 'Use the original private directory without path aliases.');
  return filename;
}
async function syncDirectory(filename) {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try {await handle.sync();} finally {await handle.close();}
}
async function immutable(filename, content) {
  const temporary = join(dirname(filename), '.new-' + randomUUID()), handle = await open(temporary, 'wx', 0o600);
  try {await handle.writeFile(content); await handle.sync();} finally {await handle.close();}
  try {
    await link(temporary, filename).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      need((await bytes(filename, content.length)).equals(content), 'RETAINED_CONFLICT', 'This original retained identity belongs to different bytes.');
    });
    await syncDirectory(dirname(filename));
  } finally {await unlink(temporary).catch(() => {});}
}
function decoded(value) {
  try {return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(value));}
  catch {throw failure('FILE_INVALID', 'Read the complete original JSON record.');}
}
function page(items, input) {
  const offset = integer(input.offset ?? 0), limit = integer(input.limit ?? 50, 1, 250), snapshot = hash(json(items));
  need(offset <= items.length, 'PAGE_INVALID', 'The offset exceeds this original inventory.');
  if (input.expectedSnapshot !== undefined)
    need(checked(input.expectedSnapshot, SHA, 'inventory snapshot') === snapshot, 'SNAPSHOT_CHANGED', 'Reopen this changed inventory from its first page.');
  need(offset === 0 || input.expectedSnapshot !== undefined, 'SNAPSHOT_REQUIRED', 'Continue the original inventory with its returned snapshot.');
  const rows = items.slice(offset, offset + limit);
  return {rows,total:items.length,offset,nextOffset:offset + rows.length < items.length ? offset + rows.length : null,snapshot};
}

/** Host configuration selects credentials and files; agent arguments select declared aliases. */
export async function readGrantPortfolioConfiguration(filename) {
  filename = resolve(filename);
  const input = decoded(await bytes(filename, 1024 * 1024)), base = dirname(filename);
  exact(input, ['schema','workspaces'], ['schema','workspaces']);
  need(input.schema === GRANT_PORTFOLIO_CONNECTION_SCHEMA && plain(input.workspaces) &&
    Object.keys(input.workspaces).length >= 1 && Object.keys(input.workspaces).length <= 32,
  'CONFIGURATION', 'Declare one to 32 original portfolio consoles.');
  const workspaces = Object.create(null), identities = new Set();
  for (const [alias, value] of Object.entries(input.workspaces)) {
    checked(alias, ALIAS, 'workspace alias');
    exact(value, ['label','workspaceId','consoleUrlFile','consoleUrlEnv','files'], ['workspaceId']);
    checked(value.workspaceId, UUID, 'workspace identity');
    need(!identities.has(value.workspaceId), 'CONFIGURATION', 'Give each saved original workspace one console alias.');
    identities.add(value.workspaceId);
    need((value.consoleUrlFile === undefined) !== (value.consoleUrlEnv === undefined), 'CONFIGURATION',
      'Select one original private connection file or environment reference.');
    const connection = value.consoleUrlFile !== undefined ? {consoleUrlFile:pathOf(value.consoleUrlFile, base)} :
      {consoleUrlEnv:checked(value.consoleUrlEnv, /^[A-Za-z_][A-Za-z0-9_]*$/, 'console environment name')};
    const files = Object.create(null);
    need(value.files === undefined || plain(value.files) && Object.keys(value.files).length <= 128,
      'CONFIGURATION', 'Declare at most 128 complete original native packet handles.');
    for (const [name, item] of Object.entries(value.files ?? {})) {
      checked(name, ALIAS, 'packet handle'); exact(item, ['path','sha256','label'], ['path']);
      files[name] = {path:pathOf(item.path, base), label:line(item.label ?? name),
        ...(item.sha256 === undefined ? {} : {sha256:checked(item.sha256, SHA, 'packet SHA-256')})};
    }
    workspaces[alias] = {label:line(value.label ?? alias),workspaceId:value.workspaceId,...connection,files};
  }
  return {schema:GRANT_PORTFOLIO_CONNECTION_SCHEMA,workspaces};
}

export class MerchantGrantPortfolios {
  #config; #environment; #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({errorPrefix:'GRANT_PORTFOLIO'});
  constructor(config, {environment = process.env} = {}) {this.#config = config; this.#environment = environment;}
  get summary() {
    return {configured:Boolean(this.#config.grantPortfolios),ownership:'ORIGINAL_GRANT_PORTFOLIO_CONSOLE',
      ...this.#reads.summary,workspaces:Object.entries(this.#config.grantPortfolios?.workspaces ?? {}).map(([workspace, value]) =>
        ({workspace,label:value.label,workspaceId:value.workspaceId,
          connection:value.consoleUrlFile ? 'ORIGINAL_CONSOLE_URL_FILE' : 'ORIGINAL_CONSOLE_URL_ENV',
          files:Object.entries(value.files).map(([file, value]) => ({file,label:value.label,sha256:value.sha256 ?? null}))}))};
  }
  #definition(workspace) {
    checked(workspace, ALIAS, 'workspace alias');
    const value = this.#config.grantPortfolios?.workspaces[workspace];
    need(value, 'WORKSPACE_NOT_CONFIGURED', 'Choose an original configured portfolio console.'); return value;
  }
  async #client(workspace, run) {
    const definition = this.#definition(workspace);
    const client = await connectGrantPortfolio(definition.consoleUrlFile ?
      {consoleUrlFile:definition.consoleUrlFile} : {consoleUrl:this.#environment[definition.consoleUrlEnv]});
    try {
      const state = await client.state();
      need(state.workspaceId === definition.workspaceId, 'WORKSPACE_CHANGED', 'This connection now names a different original workspace.');
      return await run(client, state, definition);
    } finally {await client.dispose();}
  }
  async #root() {return directory(join(this.#config.exportsDirectory, 'grant-portfolios'));}
  async #exportDirectory(exportId, create = false) {
    checked(exportId, SHA, 'retained export ID');
    const root = join(await this.#root(), exportId);
    if (create) return directory(root);
    await privateSupportDirectory(root);
    need(await realpath(root) === root, 'DIRECTORY_INVALID', 'The original export directory changed.');
    return root;
  }
  async #manifest(exportId) {
    const root = await this.#exportDirectory(exportId);
    const manifestBytes = await bytes(join(root, GRANT_PORTFOLIO_MANIFEST), 65536);
    return {root,manifest:parseGrantPortfolioManifest(manifestBytes, exportId),
      manifestBytes,manifestSha256:hash(manifestBytes)};
  }
  #description(value) {
    const {manifest,manifestBytes,manifestSha256} = value;
    return {state:'MANIFEST_RETAINED',exportId:manifest.exportId,workspace:manifest.workspace,workspaceId:manifest.workspaceId,
      operationId:manifest.operationId,portfolioId:manifest.portfolioId,revision:manifest.revision,snapshot:manifest.snapshot,
      nativeExport:manifest.nativeExport,
      manifestFile:{name:GRANT_PORTFOLIO_MANIFEST,bytes:manifestBytes.length,sha256:manifestSha256}};
  }
  async #retain(workspace, client, nativeRequest, selected) {
    const result = nativeRequest.result;
    exact(result, ['sha256','bytes','filename','portfolioId','revision','snapshot'],
      ['sha256','bytes','filename','portfolioId','revision','snapshot']);
    need(result.portfolioId === selected.portfolioId && result.revision === selected.revision,
      'EXPORT_CHANGED', 'The completed export selected a different original portfolio revision.');
    const manifest = createGrantPortfolioManifest({workspace,workspaceId:this.#definition(workspace).workspaceId,
      operationId:nativeRequest.id,portfolioId:result.portfolioId,revision:result.revision,snapshot:result.snapshot,
      nativeExport:{sha256:result.sha256,bytes:result.bytes,filename:result.filename}});
    const root = await this.#exportDirectory(manifest.exportId, true);
    await client.downloadExport(result.sha256, join(root, 'portfolio.zip'), {bytes:result.bytes});
    await immutable(join(root, GRANT_PORTFOLIO_MANIFEST), json(manifest));
    return {...this.#description(await this.#manifest(manifest.exportId)),native:nativeRequest};
  }
  async #file(args) {
    const value = await this.#manifest(args.exportId), {manifest,root,manifestBytes,manifestSha256} = value;
    need(checked(args.expectedManifestSha256, SHA, 'manifest SHA-256') === manifestSha256,
      'EXPORT_CHANGED', 'The reviewed receiving manifest changed.');
    const item = args.file === GRANT_PORTFOLIO_MANIFEST ?
      {name:GRANT_PORTFOLIO_MANIFEST,bytes:manifestBytes.length,sha256:manifestSha256,type:'application/json'} :
      manifest.files.find(file => file.name === args.file);
    need(item && checked(args.expectedSha256, SHA, 'file SHA-256') === item.sha256,
      'FILE_CHANGED', 'Select an exact original manifest file.');
    const result = await this.#reads.read({scope:args.exportId,key:item.name,kind:'grant-portfolio',directory:root,
      readId:args.readId,expectedSha256:item.sha256,offset:args.offset,limit:args.limit,load:async () => {
        const {handle,info} = await regular(join(root, item.name), GRANT_PORTFOLIO_MAX_BYTES);
        try {
          need(info.size === item.bytes, 'FILE_CHANGED', 'The original retained file length changed.');
          return {readonlyFileHandle:handle,bytes:item.bytes,sha256:item.sha256,name:item.name,type:item.type};
        } catch (error) {await handle.close(); throw error;}
      }});
    return {exportId:args.exportId,manifestSha256,...result};
  }
  async #exports(input) {
    const root = await this.#root(), values = [];
    for (const name of await readdir(root)) if (SHA.test(name)) {
      let value;
      try {value = await this.#manifest(name);} catch (error) {if (error.code === 'ENOENT') continue; throw error;}
      if (input.workspace === undefined || value.manifest.workspace === input.workspace) values.push(this.#description(value));
    }
    values.sort((a,b) => a.exportId.localeCompare(b.exportId)); return page(values, input);
  }
  async #execute(name, args) {
    if (name === 'merchant_grant_portfolio_workspaces') return this.summary;
    if (name === 'merchant_grant_portfolio_manifest') return this.#description(await this.#manifest(args.exportId));
    if (name === 'merchant_grant_portfolio_file') return this.#file(args);
    if (name === 'merchant_grant_portfolio_file_release') {
      checked(args.exportId, SHA, 'export ID'); checked(args.readId, UUID, 'original read ID');
      await this.#reads.release(args.exportId, args.readId); return {exportId:args.exportId,readId:args.readId,state:'RELEASED'};
    }
    if (name === 'merchant_grant_portfolio_exports') return this.#exports(args);
    const {workspace, ...input} = args;
    return this.#client(workspace, async (client, state, definition) => {
      const result = native => ({workspace,native});
      switch (name) {
        case 'merchant_grant_portfolio_schema': return result(await client.schema());
        case 'merchant_grant_portfolio_state': {
          const counts = {};
          for (const kind of ['sources','portfolios','requests']) {
            need(Array.isArray(state[kind]), 'RESPONSE', 'The original state inventory is incomplete.'); counts[kind] = state[kind].length;
          }
          const {sources,portfolios,requests,...identity} = state;
          if (input.kind === undefined) return result({...identity,counts});
          need(['sources','portfolios','requests'].includes(input.kind), 'INVALID_PARAMS', 'Select an original state inventory.');
          return result({...identity,kind:input.kind,...page(state[input.kind],input)});
        }
        case 'merchant_grant_portfolio_source': return result(await client.source(input.sourceId));
        case 'merchant_grant_portfolio_open': return result(await client.portfolio(input.portfolioId,{revision:input.revision}));
        case 'merchant_grant_portfolio_rows': {
          const {expectedSnapshot,...selection} = input, rows = await client.rows(selection);
          if (expectedSnapshot !== undefined) need(checked(expectedSnapshot,SHA,'row snapshot') === rows.snapshot,
            'SNAPSHOT_CHANGED', 'The selected original table snapshot changed.');
          return result(rows);
        }
        case 'merchant_grant_portfolio_detail': return result(await client.detail(input));
        case 'merchant_grant_portfolio_action': return result(await client.action(input));
        case 'merchant_grant_portfolio_request': return result(await client.request(input.operationId));
        case 'merchant_grant_portfolio_resume': return result(await client.resume(input.operationId));
        case 'merchant_grant_portfolio_upload': {
          need((input.file === undefined) !== (input.exportId === undefined), 'INVALID_PARAMS',
            'Choose one declared native packet handle or one retained portfolio export.');
          if (input.file !== undefined) {
            const file = definition.files[checked(input.file,ALIAS,'packet handle')];
            need(file, 'INPUT_NOT_CONFIGURED', 'Choose an original host-declared packet handle.');
            return result(await client.uploadFile(file.path,{sha256:file.sha256}));
          }
          const value = await this.#manifest(checked(input.exportId,SHA,'retained export ID'));
          return result(await client.uploadFile(join(value.root,'portfolio.zip'),{sha256:value.manifest.nativeExport.sha256}));
        }
        case 'merchant_grant_portfolio_export': {
          const native = await client.createExport(input.operationId,
            {portfolioId:input.portfolioId,revision:input.revision},
            input.expectedRevision === undefined ? {} : {expectedRevision:input.expectedRevision});
          if (native.state !== 'COMPLETED') return result(native);
          return this.#retain(workspace,client,native,input);
        }
        default: throw failure('TOOL_NOT_FOUND', 'Select an original grant-portfolio tool.');
      }
    });
  }
  async call(name, args = {}) {
    need(!this.#closing, 'CLOSING', 'The portfolio merchant is closing its borrowed work.');
    const definition = definitions.get(name);
    need(definition, 'TOOL_NOT_FOUND', 'Select an original grant-portfolio tool.');
    exact(args,Object.keys(definition.properties),definition.required);
    const task = Promise.resolve().then(() => this.#execute(name,args)); this.#pending.add(task);
    try {return await task;} finally {this.#pending.delete(task);}
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {await Promise.allSettled([...this.#pending]); await this.#reads.close();})();
    }
    return this.#close;
  }
}

/** Attach the original live consoles through the maintained source-owned provider initializer. */
export async function initializeGrantPortfolioMerchant({directory:root,connection,name='Starforge grant portfolios',releaseStore} = {}) {
  need(typeof root === 'string' && typeof connection === 'string', 'CONFIGURATION', 'Select the new merchant directory and original connection file.');
  root = resolve(root); connection = resolve(connection); name = line(name,160);
  const configured = await readGrantPortfolioConfiguration(connection);
  const {readReleaseState,initReleaseStore} = await import('../../sf82-seller-pilot/releases.mjs');
  const store = releaseStore === undefined ? join(root,'releases') : resolve(releaseStore);
  if (releaseStore !== undefined) await readReleaseState(store);
  await mkdir(root,{mode:0o700});
  if (releaseStore === undefined) await initReleaseStore(store);
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  const configuration = join(root,'merchant-mcp.json');
  await immutable(configuration,json({schema:'stellar-forge.merchant-mcp.v1',name,releaseStore:store,
    exportsDirectory:'./customer-exports',sources:{},grantPortfolioConnection:connection}));
  const {readMerchantConfig} = await import('../../../../stellar-forge/mcp-merchant-operator/config.mjs');
  await readMerchantConfig(configuration);
  return {schema:'stellar-forge.merchant-mcp.v1',state:'INITIALIZED',configuration,
    ownership:'ORIGINAL_GRANT_PORTFOLIO_CONSOLE',
    workspaces:Object.entries(configured.workspaces).map(([workspace,value]) =>
      ({workspace,workspaceId:value.workspaceId,label:value.label}))};
}
