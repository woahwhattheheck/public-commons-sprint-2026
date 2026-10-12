// MIT. Trusted receiving-host configuration, separate from application tool arguments.
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readBytes, openApplication, inspectHandoff } from './application.mjs';
import { attachRemoteMcpApplication, inspectRemoteMcp } from './remote-mcp.mjs';

const fail = code => Object.assign(new Error(code), { code });
const need = (ok, code) => { if (!ok) throw fail(code); };
async function configurationSource(file) {
  const configFile = resolve(file), raw = await readBytes(configFile);
  const config = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(config && typeof config === 'object' && !Array.isArray(config) &&
    config.schema === 'stellar-forge.application-config.v1' &&
    Object.keys(config).every(key => ['schema','applicationId','runtimeDirectory','handoffDirectory',
      'stateDirectory','subject','operatorProfile','authorizationModule','remoteMcp'].includes(key)),
    'APPLICATION_CONFIG_INVALID');
  need(typeof config.subject === 'string' && config.subject.trim() === config.subject &&
    config.subject.length >= 1 && config.subject.length <= 256, 'APPLICATION_HOST_SUBJECT_REQUIRED');
  for (const key of ['runtimeDirectory','handoffDirectory','stateDirectory','operatorProfile','authorizationModule','remoteMcp'])
    if (config[key] !== undefined) need(typeof config[key] === 'string' && isAbsolute(config[key]) &&
      resolve(config[key]) === config[key], 'APPLICATION_CONFIG_ABSOLUTE_PATH_REQUIRED');
  return {config,configFile,configurationSha256:createHash('sha256').update(raw).digest('hex')};
}
export async function loadConfiguration(file) {
  return (await configurationSource(file)).config;
}
export async function loadApplication(file) {
  const {config,configFile,configurationSha256} = await configurationSource(file);
  let host;
  if (config.authorizationModule) {
    host = await import(pathToFileURL(config.authorizationModule).href);
    need(typeof host.authorize === 'function' &&
      (host.close === undefined || typeof host.close === 'function'), 'APPLICATION_AUTHORIZATION_MODULE_INVALID');
  }
  const context = Object.freeze({ subject: config.subject });
  // This default serves one explicitly selected local operator behind the server's bearer check.
  // Existing products supply their authenticated context and current grant lookup through the module/API.
  const authorize = host?.authorize ?? (async ({ context: current }) => current.subject === config.subject);
  const sourceRoot = resolve(config.runtimeDirectory, '../../..');
  let application;
  try {
    application = await openApplication({ ...config, authorize });
    if (config.remoteMcp) application = await attachRemoteMcpApplication({application,
      configurationFile:config.remoteMcp,sourceRoot,stateDirectory:config.stateDirectory,authorize});
  } catch (error) {
    try { await application?.close(); } finally { await host?.close?.(); }
    throw error;
  }
  // This private launch identity comes from the same bytes that produced config.
  // Installed hosts compare it before publishing READY; HTTP/MCP keep their public projection.
  const launchBinding = Object.freeze({configFile,configurationSha256,applicationId:config.applicationId,
    subject:config.subject,runtimeDirectory:config.runtimeDirectory,stateDirectory:config.stateDirectory,
    handoffDirectory:config.handoffDirectory,remoteMcp:config.remoteMcp ?? null});
  return { application, context, config, sourceRoot, launchBinding,
    async close() { try { await application.close(); } finally { await host?.close?.(); } } };
}
export { inspectHandoff, inspectRemoteMcp };

