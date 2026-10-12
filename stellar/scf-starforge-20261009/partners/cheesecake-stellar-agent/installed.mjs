#!/usr/bin/env node
// MIT. Installed receiving workflow for the original Stellar application.
import { mkdir, lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadConfiguration, inspectHandoff } from './configuration.mjs';
import { readBytes } from './application.mjs';

const STARTUP = 'stellar-forge.application-installed-startup.v1';
const SELECTION = 'stellar-forge.application-installed-selection.v1';
const fail = code => Object.assign(new Error(code), {code});
const need = (condition, code) => { if (!condition) throw fail(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const absolute = value => {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), 'APPLICATION_ABSOLUTE_PATH_REQUIRED');
  return value;
};
async function directory(path, {privateOnly = false} = {}) {
  absolute(path);
  const st = await lstat(path);
  need(st.isDirectory() && !st.isSymbolicLink() && await realpath(path) === path &&
    (!privateOnly || !(st.mode & 0o077) &&
      (typeof process.getuid !== 'function' || st.uid === process.getuid())),
    'APPLICATION_DIRECTORY_INVALID');
}
async function sourceFile(path, maximum = 2 * 1024 * 1024) {
  absolute(path);
  need(await realpath(path) === path, 'APPLICATION_SOURCE_PATH_CHANGED');
  const raw = await readBytes(path, maximum);
  return {path, kind:'file', bytes:raw.length, sha256:hash(raw)};
}
async function publish(file, raw) {
  const temporary = join(dirname(file), '.' + randomUUID() + '.pending');
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(raw); await handle.sync(); await handle.close(); handle = null;
    await link(temporary, file);
    const parent = await open(dirname(file), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function installedApplicationPaths() {
  const sourceRoot = await realpath(fileURLToPath(new URL('../../../../', import.meta.url)));
  const applicationDirectory = await realpath(fileURLToPath(new URL('./', import.meta.url)));
  const runtimeDirectory = await realpath(fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url)));
  for (const path of [join(runtimeDirectory,'node/index.mjs'), join(applicationDirectory,'server.mjs'),
    join(applicationDirectory,'cli.mjs'), join(sourceRoot,'stellar-forge/mcp-paid-agent/http-tools.mjs')]) {
    const st = await lstat(path);
    need(st.isFile() && !st.isSymbolicLink(), 'APPLICATION_INSTALLED_SOURCE_INCOMPLETE');
  }
  return {schema:'stellar-forge.application-installed-paths.v1',sourceRoot,applicationDirectory,
    runtimeDirectory,operatorGuide:join(applicationDirectory,'OPERATOR.md'),
    installedGuide:join(applicationDirectory,'INSTALLED.md')};
}
async function selection(config, {requireState = true} = {}) {
  const paths = await installedApplicationPaths();
  need(config.runtimeDirectory === paths.runtimeDirectory, 'APPLICATION_SELECTED_RUNTIME_CHANGED');
  if (requireState) await directory(config.stateDirectory,{privateOnly:true});
  const handoff = await inspectHandoff(config.handoffDirectory);
  const references = [{
    path:join(config.handoffDirectory,'handoff.json'),kind:'file',
    ...(await sourceFile(join(config.handoffDirectory,'handoff.json'))),
  }, ...handoff.manifest.files.map(item => ({
    path:join(config.handoffDirectory,item.path),kind:'file',bytes:item.bytes,sha256:item.sha256,
  }))];
  need(references[0].sha256 === handoff.manifestSha256, 'APPLICATION_HANDOFF_CHANGED');
  const directories = [config.handoffDirectory,config.stateDirectory];
  for (const key of ['operatorProfile','authorizationModule'])
    if (config[key]) references.push(await sourceFile(config[key]));
  let remoteMcp = null;
  if (config.remoteMcp) {
    const {inspectRemoteMcp} = await import('./remote-mcp.mjs');
    const remote = await inspectRemoteMcp(config.remoteMcp,{sourceRoot:paths.sourceRoot});
    references.push(await sourceFile(config.remoteMcp));
    need(references.at(-1).sha256 === remote.sourceSha256, 'APPLICATION_REMOTE_SELECTION_CHANGED');
    references.push(await sourceFile(remote.config.operatorModule));
    const httpIds = new Set(handoff.requests.keys());
    need([...remote.requests.keys()].every(intent => !httpIds.has(intent)), 'APPLICATION_REMOTE_INTENT_COLLISION');
    remoteMcp = {sourceSha256:remote.sourceSha256,requests:remote.requests.size,
      configurationFile:config.remoteMcp,operatorModule:remote.config.operatorModule};
  }
  return {applicationId:config.applicationId,stateDirectory:config.stateDirectory,
    runtimeDirectory:config.runtimeDirectory,sourceRoot:paths.sourceRoot,
    handoffId:handoff.manifest.handoffId,manifestSha256:handoff.manifestSha256,
    httpRequests:handoff.requests.size,remoteMcp,directories:[...new Set(directories)],
    references:[...new Map(references.map(item => [item.path,item])).values()]};
}

/** Read the exact host selection without loading authorization, signer or provider code. */
export async function inspectInstalledApplication(configFile, {expectedSelectionSha256} = {}) {
  absolute(configFile);
  need(await realpath(configFile) === configFile, 'APPLICATION_SOURCE_PATH_CHANGED');
  const config = await loadConfiguration(configFile), raw = await readBytes(configFile,2*1024*1024);
  need(isDeepStrictEqual(config,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))),
    'APPLICATION_CONFIGURATION_CHANGED');
  const original = await selection(config);
  const configurationSha256 = hash(raw);
  const reference = {path:configFile,kind:'file',bytes:raw.length,sha256:configurationSha256};
  const value = {schema:SELECTION,configFile,configurationSha256,...original,
    references:[reference,...original.references]};
  const selectionSha256 = hash(json(value));
  need(expectedSelectionSha256 === undefined || /^[a-f0-9]{64}$/.test(expectedSelectionSha256) &&
    selectionSha256 === expectedSelectionSha256, 'APPLICATION_SELECTED_SOURCE_CHANGED');
  need(hash(await readBytes(configFile,2*1024*1024)) === configurationSha256,
    'APPLICATION_CONFIGURATION_CHANGED');
  return {...value,selectionSha256};
}

/** Prepare one new private receiving application from the host's selected sources. */
export async function initializeInstalledApplication({directory:destination,applicationId,subject,
  handoffDirectory,operatorProfile,authorizationModule,remoteMcp} = {}) {
  absolute(destination);
  await directory(dirname(destination),{privateOnly:true});
  need(typeof applicationId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(applicationId),
    'APPLICATION_ID_INVALID');
  need(typeof subject === 'string' && subject.trim() === subject && subject.length >= 1 &&
    subject.length <= 256 && !/[\x00-\x1f\x7f]/.test(subject), 'APPLICATION_HOST_SUBJECT_REQUIRED');
  absolute(handoffDirectory);
  for (const path of [operatorProfile,authorizationModule,remoteMcp]) if (path) absolute(path);
  const paths = await installedApplicationPaths();
  need(!destination.startsWith(paths.sourceRoot + '/') && destination !== paths.sourceRoot,
    'APPLICATION_STATE_OUTSIDE_INSTALLATION_REQUIRED');
  const config = {schema:'stellar-forge.application-config.v1',applicationId,
    runtimeDirectory:paths.runtimeDirectory,handoffDirectory,stateDirectory:join(destination,'state'),subject,
    ...(operatorProfile ? {operatorProfile} : {}),...(authorizationModule ? {authorizationModule} : {}),
    ...(remoteMcp ? {remoteMcp} : {})};
  // Complete original source inspection precedes the new workspace creation.
  await selection(config,{requireState:false});
  await mkdir(destination,{mode:0o700});
  await mkdir(config.stateDirectory,{mode:0o700});
  const configFile = join(destination,'application.json');
  await publish(configFile,json(config));
  return inspectInstalledApplication(configFile);
}

/** Start the unchanged authenticated application on its selected loopback listener. */
export async function startInstalledApplication({configFile,expectedSelectionSha256,
  bearerToken=process.env.STELLAR_APP_ACCESS_TOKEN,host='127.0.0.1',port=0} = {}) {
  const selected = await inspectInstalledApplication(absolute(configFile),{expectedSelectionSha256});
  const {createApplicationServer} = await import('./server.mjs');
  const opened = await createApplicationServer({configFile,bearerToken,host,port});
  try {
    await inspectInstalledApplication(configFile,{expectedSelectionSha256:selected.selectionSha256});
    const startup = {schema:STARTUP,status:'STELLAR_APPLICATION_READY',configFile,
      configurationSha256:selected.configurationSha256,selectionSha256:selected.selectionSha256,
      applicationId:selected.applicationId,stateDirectory:selected.stateDirectory,
      handoffId:selected.handoffId,remoteMcpSourceSha256:selected.remoteMcp?.sourceSha256 ?? null,
      serverId:opened.identity.server.id,origin:opened.origin};
    return {...opened,startup,selection:selected};
  } catch (error) { await opened.close(); throw error; }
}
const help = [
  'Stellar application — installed merchant/buyer and governed MCP receiving',
  '',
  '  starforge stellar-application paths',
  '  starforge stellar-application init --dir NEW_PRIVATE_DIRECTORY --id APPLICATION_ID',
  '    --subject HOST_SUBJECT --handoff ORIGINAL_HANDOFF_DIRECTORY',
  '    [--profile ORIGINAL_OPERATOR_PROFILE] [--authorization TRUSTED_MODULE] [--remote REMOTE_SELECTION_JSON]',
  '  starforge stellar-application inspect --config PRIVATE_APPLICATION_JSON',
  '  starforge stellar-application serve --config PRIVATE_APPLICATION_JSON [--port 0] [--host 127.0.0.1|::1]',
  '    [--expected-selection-sha256 REVIEWED_SOURCE_SHA256]',
  '  starforge stellar-application list|verify-source --config PRIVATE_APPLICATION_JSON',
  '  starforge stellar-application review|execute|status|recover|read|export|cancel|spending|reconcile ...',
  '',
  'Serve uses STELLAR_APP_ACCESS_TOKEN from the protected process environment.',
  'Enter that token in the original browser connection field. Payment approval uses the original terminal.',
  'All request commands forward unchanged to the original application CLI. Use its --help for exact arguments.',
  '',
].join('\n');
function options(args, allowed) {
  need(args.length % 2 === 0,'APPLICATION_INSTALLED_OPTIONS_INVALID');
  const result = {};
  for (let index=0;index<args.length;index+=2) {
    const key=args[index].slice(2),value=args[index+1];
    need(args[index].startsWith('--') && allowed.includes(key) && !Object.hasOwn(result,key) &&
      typeof value==='string' && value.length>0 && !value.startsWith('--'),'APPLICATION_INSTALLED_OPTIONS_INVALID');
    result[key]=value;
  }
  return result;
}
export async function main(args=process.argv.slice(2)) {
  const [action,...tail]=args;
  if (!action || ['help','--help','-h'].includes(action)) {
    process.stdout.write(help);
    return;
  }
  if (action === 'paths') {
    need(tail.length===0,'APPLICATION_INSTALLED_OPTIONS_INVALID');
    const value=await installedApplicationPaths();process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;
  }
  if (action === 'init') {
    const o=options(tail,['dir','id','subject','handoff','profile','authorization','remote']);
    need(o.dir && o.id && o.subject && o.handoff,'APPLICATION_INSTALLED_REQUIRED_OPTION');
    const value=await initializeInstalledApplication({directory:absolute(o.dir),applicationId:o.id,subject:o.subject,
      handoffDirectory:absolute(o.handoff),operatorProfile:o.profile,authorizationModule:o.authorization,remoteMcp:o.remote});
    process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;
  }
  if (action === 'inspect') {
    const o=options(tail,['config']);need(o.config,'APPLICATION_CONFIG_REQUIRED');
    const value=await inspectInstalledApplication(absolute(o.config));
    process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;
  }
  if (action === 'serve') {
    const o=options(tail,['config','port','host','expected-selection-sha256']);
    need(o.config,'APPLICATION_CONFIG_REQUIRED');
    const opened=await startInstalledApplication({configFile:absolute(o.config),
      expectedSelectionSha256:o['expected-selection-sha256'],port:o.port===undefined?0:Number(o.port),host:o.host??'127.0.0.1'});
    process.stdout.write(JSON.stringify(opened.startup)+'\n');
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;try{await opened.close();
      process.stdout.write(JSON.stringify({event:'closed',serverId:opened.startup.serverId})+'\n');
    }catch(error){process.stderr.write(JSON.stringify({error:'APPLICATION_CLOSE_FAILED'})+'\n');process.exitCode=1;}};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
    return opened;
  }
  const {main:original}=await import('./cli.mjs');
  return original(args);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => {
    const supplied=String(error.code??''),code=/^[A-Z][A-Z0-9_]{1,100}$/.test(supplied)?supplied:'APPLICATION_INSTALLED_COMMAND_FAILED';
    process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;
  });
