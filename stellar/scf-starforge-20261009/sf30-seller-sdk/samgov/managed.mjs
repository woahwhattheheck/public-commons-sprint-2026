#!/usr/bin/env node
// MIT. Applications owns the process; the original SAM server owns its writer and captures.
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {startSamWorkspace} from './server.mjs';
import {SAM_ENDPOINT, endpoint as samEndpoint} from './core.mjs';
import {SAM_CONNECTION_SCHEMA, SAM_CONNECTION_FILENAME, SAM_STARTUP_SCHEMA,
  samNeed, samFailure, samAbsolute, samPrivateDirectory, samWritePrivateJson,
  samReadPrivateJson} from './connection.mjs';

const OPTIONS = ['workspace', 'operator', 'api-key-env', 'endpoint', 'opportunity-workspace', 'port'];
export function samManagedOptions(argv) {
  const raw = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    samNeed(typeof flag === 'string' && flag.startsWith('--') && OPTIONS.includes(flag.slice(2)) &&
      !Object.hasOwn(raw, flag.slice(2)) && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--'),
    'SAM_MANAGED_ARGUMENT_INVALID', 'Use each documented option once with its value.');
    raw[flag.slice(2)] = argv[i + 1];
  }
  const directory = samAbsolute(raw.workspace);
  const operator = raw.operator || 'SAM opportunity operator', apiKeyEnv = raw['api-key-env'] || 'SAM_GOV_API_KEY';
  samNeed(operator.trim() === operator && operator.length >= 1 && operator.length <= 240 &&
    !/[\x00-\x1f\x7f]/.test(operator), 'SAM_OPERATOR_INVALID', 'Provide an operator name of 1–240 characters.');
  samNeed(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv),
    'SAM_API_KEY_ENV_INVALID', 'Select the existing SAM credential environment name.');
  samNeed(/^\d+$/.test(raw.port ?? '0') && Number(raw.port ?? 0) <= 65535,
    'SAM_PORT_INVALID', 'Choose a local port from 0 to 65535.');
  return {directory, operator, apiKeyEnv, endpoint: samEndpoint(raw.endpoint || SAM_ENDPOINT),
    ...(raw['opportunity-workspace'] ? {opportunityDirectory: samAbsolute(raw['opportunity-workspace'])} : {}),
    port: Number(raw.port ?? 0)};
}
/** This wraps startSamWorkspace; it does not construct another application or data store. */
export async function startManagedSamWorkspace(options) {
  const directory = samAbsolute(options.directory);
  if (options.opportunityDirectory) await samPrivateDirectory(options.opportunityDirectory);
  const service = await startSamWorkspace({...options, directory});
  let connection, closePromise;
  try {
    const identity = await samPrivateDirectory(service.directory), state = await service.store.list();
    const value = {
      schema: SAM_CONNECTION_SCHEMA, instanceId: randomUUID(), directory: identity.path,
      directoryIdentity: {dev: identity.dev, ino: identity.ino}, workspaceId: state.id,
      operator: service.operator, pid: process.pid, startedAt: new Date().toISOString(),
      origin: service.origin, url: service.url, apiKeyEnv: options.apiKeyEnv || 'SAM_GOV_API_KEY',
      endpoint: options.endpoint || SAM_ENDPOINT, opportunityDirectory: options.opportunityDirectory || null,
    };
    const written = await samWritePrivateJson(join(identity.path, SAM_CONNECTION_FILENAME), value, {replace: true});
    connection = {...written, value};
    const close = () => closePromise || (closePromise = (async () => {
      // Retire this session while its original writer lease is still held.
      // A later start can then publish its own connection after that lease closes.
      let retirementError;
      try {
        const current = await samReadPrivateJson(connection.path, 32768);
        if (current.sha256 === connection.sha256) await unlink(connection.path);
      } catch (error) { if (error.code !== 'ENOENT') retirementError = error; }
      await service.close();
      if (retirementError) throw retirementError;
    })());
    return {...service, connection, instanceId: value.instanceId, close};
  } catch (error) { await service.close().catch(() => {}); throw error; }
}
export function samStartup(service) {
  return {schema: SAM_STARTUP_SCHEMA, status: 'SAM_WORKSPACE_READY',
    directory: service.directory, operator: service.operator, workspaceId: service.connection.value.workspaceId,
    instanceId: service.instanceId, pid: service.connection.value.pid,
    connectionFile: service.connection.path, connectionSha256: service.connection.sha256,
    origin: service.origin, url: service.url};
}
const HELP = 'SAM.gov managed workspace\n\n' +
  'starforge samgov-workspace --workspace /private/sam --operator "Procurement operator" [--port 0]\n' +
  '  --api-key-env NAME              Existing SAM_GOV_API_KEY environment name\n' +
  '  --endpoint URL                  Original GSA search endpoint\n' +
  '  --opportunity-workspace DIR     Existing LGNDX opportunity workspace\n\n' +
  'Use Applications to review, save, start, open and stop this original workspace.\n' +
  'The private samgov.connection.json file connects typed MCP tools to this same listener.\n' +
  'SIGINT/SIGTERM pauses the original captures and drains requests/sellers before closing.\n';
export async function runManagedSamCli(argv = process.argv.slice(2), {
  stdout = process.stdout, waitForClose = true,
} = {}) {
  if (argv.length === 0 || argv.length === 1 && ['help', '--help'].includes(argv[0])) {
    stdout.write(HELP); return {help: true};
  }
  const service = await startManagedSamWorkspace(samManagedOptions(argv));
  stdout.write(JSON.stringify(samStartup(service)) + '\n');
  if (!waitForClose) return service;
  let stopping = false;
  await new Promise((accept, reject) => {
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try { await service.close(); accept(); } catch (error) { reject(error); }
      finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
  return {status: 'CLOSED', instanceId: service.instanceId};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagedSamCli().catch(error => {
    process.stderr.write(JSON.stringify({error: {code: error.code || 'SAM_MANAGED_FAILED',
      message: 'The original SAM application could not complete. Inspect its saved operation and private workspace.'}}) + '\n');
    process.exitCode = 1;
  });
}
