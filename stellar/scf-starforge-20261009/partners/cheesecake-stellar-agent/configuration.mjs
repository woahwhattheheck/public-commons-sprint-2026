// MIT. Trusted receiving-host configuration, separate from application tool arguments.
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJSON, openApplication, inspectHandoff } from './application.mjs';

const fail = code => Object.assign(new Error(code), { code });
const need = (ok, code) => { if (!ok) throw fail(code); };
export async function loadConfiguration(file) {
  const config = await readJSON(resolve(file));
  need(config && typeof config === 'object' && !Array.isArray(config) &&
    config.schema === 'stellar-forge.application-config.v1' &&
    Object.keys(config).every(key => ['schema','applicationId','runtimeDirectory','handoffDirectory',
      'stateDirectory','subject','operatorProfile','authorizationModule'].includes(key)),
    'APPLICATION_CONFIG_INVALID');
  need(typeof config.subject === 'string' && config.subject.trim() === config.subject &&
    config.subject.length >= 1 && config.subject.length <= 256, 'APPLICATION_HOST_SUBJECT_REQUIRED');
  for (const key of ['runtimeDirectory','handoffDirectory','stateDirectory','operatorProfile','authorizationModule'])
    if (config[key] !== undefined) need(typeof config[key] === 'string' && isAbsolute(config[key]) &&
      resolve(config[key]) === config[key], 'APPLICATION_CONFIG_ABSOLUTE_PATH_REQUIRED');
  return config;
}
export async function loadApplication(file) {
  const config = await loadConfiguration(file);
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
  const application = await openApplication({ ...config, authorize });
  return { application, context, config, sourceRoot: resolve(config.runtimeDirectory, '../../..'),
    async close() { try { await application.close(); } finally { await host?.close?.(); } } };
}
export { inspectHandoff };

