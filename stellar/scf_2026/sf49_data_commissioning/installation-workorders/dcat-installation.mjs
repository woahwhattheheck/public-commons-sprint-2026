#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Complete retained DCAT Installation preparation; original Operations owns Save. */
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createDcatInstallationService } from './dcat-installation/service.mjs';
import { privateDirectory, hashPrivate, syncDirectory, fault } from
  '../../../scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const need = (ok, code, message) => { if (!ok) throw fault(code, message); };
const sha = value => {
  need(typeof value === 'string' && HASH.test(value),
    'DCAT_INSTALLATION_SHA256_REQUIRED', 'Use the complete inspected SHA-256.');
  return value;
};
export const dcatInstallationUsage = [
  'dcat-installation serve --directory PRIVATE_ROOT [--port 0]',
  'dcat-installation import --directory PRIVATE_ROOT --request UUID --kind archive|case|seed|bindings|selection --file ORIGINAL --sha256 HASH',
  'dcat-installation inspect --directory PRIVATE_ROOT --request UUID --archive FILE_ID',
  'dcat-installation template --directory PRIVATE_ROOT --request UUID --inspection UUID --case FILE_ID --seed FILE_ID',
  'dcat-installation prepare --directory PRIVATE_ROOT --request UUID --inspection UUID --case FILE_ID --seed FILE_ID --bindings FILE_ID --selection FILE_ID --selection-source SOURCE_ID',
  'dcat-installation list --directory PRIVATE_ROOT [--offset 0] [--limit 50]',
  'dcat-installation get --directory PRIVATE_ROOT --request UUID',
  'dcat-installation files --directory PRIVATE_ROOT --request UUID',
  'dcat-installation export --directory PRIVATE_ROOT --file-id FILE_ID --sha256 HASH --out PRIVATE_FILE',
  '',
  'Use one private preparation root outside catalogue projects and installed source.',
  'Each mutation uses its own stable request UUID. Reuse that UUID with identical input IDs to resume.',
  'Input file IDs are the 64-hex immutable identities returned by import. Inspection IDs are request UUIDs.',
  'Keep the existing browser/Applications owner running. Completed requests/files may be read concurrently; retry a busy mutation with its same UUID and exact inputs.',
  'Installation Preview/Save and full Operations receiving remain the original writer.'
].join('\n');
const definitions = {
  serve: [['directory'], ['port', 'managed-selection']],
  import: [['directory','request','kind','file','sha256'], []],
  inspect: [['directory','request','archive'], []],
  template: [['directory','request','inspection','case','seed'], []],
  prepare: [['directory','request','inspection','case','seed','bindings','selection','selection-source'], []],
  list: [['directory'], ['offset','limit']],
  get: [['directory','request'], []],
  files: [['directory','request'], []],
  export: [['directory','file-id','sha256','out'], []]
};
function argumentsFor(argv) {
  const values = [...argv], command = values.shift();
  if (!command || ['help','--help','-h'].includes(command)) return {command:'help',options:{}};
  const definition = definitions[command], options = {};
  need(definition, 'DCAT_INSTALLATION_COMMAND', dcatInstallationUsage);
  const allowed = new Set(definition.flat());
  for (let i=0;i<values.length;i+=2) {
    const name = values[i], key = name?.slice(2), value = values[i+1];
    need(typeof name === 'string' && /^--[a-z][a-z-]*$/.test(name) &&
      allowed.has(key) && !Object.hasOwn(options,key) && typeof value === 'string' &&
      value.length > 0 && !value.includes('\0') && !value.startsWith('--'),
      'DCAT_INSTALLATION_ARGUMENTS', dcatInstallationUsage);
    options[key] = value;
  }
  need(definition[0].every(key=>Object.hasOwn(options,key)),
    'DCAT_INSTALLATION_ARGUMENTS', dcatInstallationUsage);
  for (const key of ['directory','file','out']) if (options[key]) options[key]=resolve(options[key]);
  for (const key of ['request','inspection']) if(options[key])
    need(UUID.test(options[key]), 'DCAT_INSTALLATION_REQUEST_ID', 'Use the original request UUID.');
  for (const key of ['archive','case','seed','bindings','selection','file-id','sha256'])
    if(options[key]) sha(options[key]);
  for(const [key,max,min] of [['offset',Number.MAX_SAFE_INTEGER,0],['limit',200,1],['port',65535,0]]) {
    if(options[key]!==undefined) {
      need(/^(0|[1-9][0-9]*)$/.test(options[key]) && Number.isSafeInteger(Number(options[key])) &&
        Number(options[key])>=min && Number(options[key])<=max,
        'DCAT_INSTALLATION_ARGUMENTS','Use a whole number in the declared '+key+' range.');
      options[key]=Number(options[key]);
    }
  }
  if(command==='import') need(['archive','case','seed','bindings','selection'].includes(options.kind),
    'DCAT_INSTALLATION_INPUT_KIND','Select archive, case, seed, bindings or selection.');
  return {command,options};
}

/** Stream one verified original file to an immutable private export. */
export async function exportDcatInstallationFile({ service, fileId, expectedSha256, out, signal }) {
  const retained = await service.file(fileId);
  const selected = { ...retained.descriptor, file: retained.path }, name = selected.name;
  need(selected && typeof selected.file === 'string' &&
    Number.isSafeInteger(selected.bytes) && selected.bytes >= 0 &&
    sha(selected.sha256) === sha(expectedSha256),
    'DCAT_INSTALLATION_FILE_CHANGED', 'Select the exact retained name and full-file SHA-256.');
  out = resolve(out);
  await privateDirectory(dirname(out));
  signal?.throwIfAborted();
  try {
    const previous = await hashPrivate(out, selected.bytes);
    need(previous.bytes === selected.bytes && previous.hash === selected.sha256,
      'DCAT_INSTALLATION_EXPORT_EXISTS', 'Preserve the different existing output; choose a new file.');
    return { file: out, name, bytes: selected.bytes, sha256: selected.sha256, reused: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(dirname(out), '.' + basename(out) + '.pending-' + randomUUID());
  let source, target;
  try {
    source = await open(selected.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await source.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && !(before.mode & 0o077n) &&
      before.size === BigInt(selected.bytes), 'DCAT_INSTALLATION_FILE_CHANGED',
      'Receive the complete original private regular file.');
    target = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let count = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await source.read(buffer, 0, buffer.length, count);
      if (!bytesRead) break;
      count += bytesRead;
      need(count <= selected.bytes, 'DCAT_INSTALLATION_FILE_CHANGED', 'The original file grew during export.');
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        signal?.throwIfAborted();
        const result = await target.write(buffer, written, bytesRead - written, null);
        need(result.bytesWritten > 0, 'DCAT_INSTALLATION_EXPORT_WRITE', 'The complete export could not advance.');
        written += result.bytesWritten;
      }
    }
    const after = await source.stat({ bigint: true });
    need(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]) &&
      count === selected.bytes && hash.digest('hex') === selected.sha256,
      'DCAT_INSTALLATION_FILE_CHANGED', 'The complete original file changed during export.');
    await target.sync(); await target.close(); target = null;
    signal?.throwIfAborted();
    try { await link(temporary, out); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const actual = await hashPrivate(out, selected.bytes);
      need(actual.bytes === selected.bytes && actual.hash === selected.sha256,
        'DCAT_INSTALLATION_EXPORT_EXISTS', 'The concurrently created output differs from this original file.');
    }
    await unlink(temporary); await syncDirectory(dirname(out));
    return { file: out, name, bytes: selected.bytes, sha256: selected.sha256, reused: false };
  } finally {
    await target?.close(); await source?.close();
    try { await unlink(temporary); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}


export async function runDcatInstallationCommand(argv, {signal, onOwner}={}) {
  const {command,options}=argumentsFor(argv);
  if(command==='help') return {usage:dcatInstallationUsage};
  signal?.throwIfAborted();
  if(command==='serve') {
    const {createDcatInstallationServer}=await import('./dcat-installation/server.mjs');
    const {verifyDcatInstallationManagedSelection, inspectDcatInstallationSourceSelection}=
      await import('../../../scf-starforge-20261009/distribution/runtime-workspace/application-dcat-installation.mjs');
    const sourceRoot=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
    let selected;
    if(options['managed-selection']) {
      let selection;
      try {selection=JSON.parse(options['managed-selection']);}
      catch {throw fault('APPLICATION_DCAT_INSTALLATION_SELECTION_INVALID');}
      selected=await verifyDcatInstallationManagedSelection(selection,{
        directory:options.directory,sourceRoot,executable:process.execPath});
    } else selected={source:await inspectDcatInstallationSourceSelection(sourceRoot)};
    signal?.throwIfAborted();
    const server=await createDcatInstallationServer({directory:options.directory,host:'127.0.0.1',
      port:options.port??0});
    onOwner?.(server);
    return {owner:server,startup:{schema:'stellar-forge.dcat-installation-startup.v1',
      status:'READY',instanceId:server.instanceId,pid:process.pid,directory:options.directory,
      sourceRoot,sourceSha256:selected.source.sha256,sourceScope:selected.source.scope??'complete-installed-manifest',selectedExecutable:await realExecutable(),
      url:server.url,origin:server.origin}};
  }
  const service=await createDcatInstallationService({directory:options.directory});
  onOwner?.(service);
  try {
    signal?.throwIfAborted();
    if(command==='list') return await service.list({offset:options.offset??0,limit:options.limit??50});
    if(command==='get'||command==='files') {
      const value=await service.get(options.request);
      return command==='get'?value:{requestId:options.request,status:value.status,files:value.files??[]};
    }
    if(command==='export') return await exportDcatInstallationFile({service,fileId:options['file-id'],
      expectedSha256:options.sha256,out:options.out,signal});
    if(command==='import') return await service.importFile({requestId:options.request,path:options.file,
      kind:options.kind,expectedSha256:options.sha256});
    if(command==='inspect') return await service.inspect({requestId:options.request,archiveId:options.archive});
    const input={requestId:options.request,inspectionId:options.inspection,caseId:options.case,seedId:options.seed};
    if(command==='template') return await service.template(input);
    return await service.prepare({...input,bindingsId:options.bindings,selectionId:options.selection,
      selectionSourceId:options['selection-source']});
  } finally {await service.close();}
}
async function realExecutable() {
  const {realpath}=await import('node:fs/promises');return realpath(process.execPath);
}
export async function main(argv=process.argv.slice(2)) {
  const controller=new AbortController();
  let owner,closing=null;
  const stop=()=>{
    controller.abort(fault('DCAT_INSTALLATION_CANCELLED','The same owner is draining; retain the original request UUID.'));
    if(owner) closing??=Promise.resolve().then(()=>owner.close());
    closing?.catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'DCAT_INSTALLATION_CLOSE_FAILED',message:String(error.message??error)})+'\n');process.exitCode=1;});
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const remove=()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);};
  try {
    const result=await runDcatInstallationCommand(argv,{signal:controller.signal,onOwner:value=>{
      owner=value;if(controller.signal.aborted)stop();
    }});
    if(result.owner) {
      if(controller.signal.aborted) {await closing;remove();return;}
      process.stdout.write(JSON.stringify(result.startup)+'\n');
      return result.owner;
    }
    process.stdout.write(result.usage?result.usage+'\n':JSON.stringify(result,null,2)+'\n');
    if(closing)await closing;
    remove();return result;
  } catch(error) {
    try {if(closing)await closing;}catch(cleanup){throw new AggregateError([error,cleanup],'Preparation and owner shutdown failed.');}
    finally {remove();}
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'DCAT_INSTALLATION_FAILED',
    message:String(error.message??error)})+'\n');process.exitCode=1;});
