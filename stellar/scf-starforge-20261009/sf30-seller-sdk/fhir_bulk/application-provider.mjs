// MIT. Original FHIR Bulk Data command in the maintained Applications lifecycle.
import { join } from 'node:path';
import {
  APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup,
} from '../../distribution/runtime-workspace/application-provider.mjs';
import {
  absolute, privateDirectory, regular, plain, need, digest,
} from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_bulk';
const WORKSPACE = 'stellar-forge.fhir-bulk-workspace.v1';
const STARTUP = 'stellar-forge.fhir-bulk-startup.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

async function originalJSON(path) {
  const bytes = await regular(path, 4096);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'APPLICATION_FHIR_WORKSPACE_INVALID', 'Open an initialized original FHIR Bulk Data workspace.'); }
  return { value, path, sha256: digest(bytes) };
}

export async function inspectFhirApplicationWorkspace(directory, expectedId = null) {
  directory = await privateDirectory(absolute(directory));
  await privateDirectory(join(directory, 'fhir'));
  const marker = await originalJSON(join(directory, 'workspace.json'));
  const identity = await originalJSON(join(directory, 'fhir', 'identity.json'));
  need(plain(marker.value) && Object.keys(marker.value).length === 1 && marker.value.schema === WORKSPACE &&
    plain(identity.value) && identity.value.schema === WORKSPACE && UUID.test(identity.value.workspaceId ?? ''),
  'APPLICATION_FHIR_WORKSPACE_INVALID', 'Select the private directory initialized or received by fhir-bulk.');
  need(expectedId === null || identity.value.workspaceId === expectedId,
    'APPLICATION_FHIR_WORKSPACE_CHANGED', 'Reopen and review this application after selecting a different original workspace.');
  return { directory, workspaceId: identity.value.workspaceId, marker, identity };
}

function selection(request) {
  need(!request.pythonCommand && request.command === 'fhir-bulk' &&
    Array.isArray(request.args) && request.args[0] === 'serve',
  'APPLICATION_FHIR_REQUEST_CHANGED');
  const args = request.args.slice(1), options = new Map();
  const allowed = new Set(['--workspace', '--expected-workspace-id', '--credentials-file', '--port']);
  need(args.length % 2 === 0, 'APPLICATION_FHIR_REQUEST_CHANGED');
  for (let i = 0; i < args.length; i += 2) {
    need(allowed.has(args[i]) && !options.has(args[i]) && typeof args[i + 1] === 'string',
      'APPLICATION_FHIR_REQUEST_CHANGED');
    options.set(args[i], args[i + 1]);
  }
  need(UUID.test(options.get('--expected-workspace-id') ?? '') &&
    /^(0|[1-9]\d*)$/.test(options.get('--port') ?? '') &&
    Number(options.get('--port')) <= 65535, 'APPLICATION_FHIR_REQUEST_CHANGED');
  return {
    directory: absolute(options.get('--workspace')),
    workspaceId: options.get('--expected-workspace-id'),
    port: Number(options.get('--port')),
    ...(options.has('--credentials-file') ? { credentialsFile: absolute(options.get('--credentials-file')) } : {}),
  };
}

async function liveState(url) {
  const response = await fetch(new URL('/api/state', url), {
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + url.hash.slice(1) },
    signal: AbortSignal.timeout(10000),
  });
  need(response.status === 200 &&
    /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
  'APPLICATION_FHIR_LISTENER_UNAVAILABLE', 'The original FHIR listener did not return its authenticated saved workspace.');
  const maximum = 16 * 1024 * 1024, declared = response.headers.get('content-length');
  need(declared === null || /^\d+$/.test(declared) && Number(declared) <= maximum,
    'APPLICATION_FHIR_LISTENER_UNAVAILABLE');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    need(size <= maximum, 'APPLICATION_FHIR_LISTENER_UNAVAILABLE');
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { need(false, 'APPLICATION_FHIR_LISTENER_UNAVAILABLE', 'The original FHIR state could not be read.'); }
}

export async function fhirApplicationStartup(request, value) {
  if (!plain(value) || value.schema !== STARTUP) return null;
  const selected = selection(request);
  const original = await inspectFhirApplicationWorkspace(selected.directory, selected.workspaceId);
  need(value.workspace === original.directory && value.workspaceId === original.workspaceId,
    'APPLICATION_FHIR_STARTUP_CHANGED', 'The original listener opened a different FHIR workspace.');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_FHIR_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^#[A-Za-z0-9_-]{43}$/.test(url.hash) && port >= 1 && port <= 65535 &&
    (!selected.port || selected.port === port),
  'APPLICATION_FHIR_STARTUP_CHANGED');
  const state = await liveState(url);
  need(state?.schema === WORKSPACE && state.workspaceId === original.workspaceId,
    'APPLICATION_FHIR_STARTUP_CHANGED', 'The authenticated FHIR listener differs from the selected saved workspace.');
  return {
    url: url.href, workspaceId: original.workspaceId,
    original: { schema: STARTUP, directory: original.directory, workspaceId: original.workspaceId,
      markerSha256: original.marker.sha256, identitySha256: original.identity.sha256 },
  };
}

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'fhir-bulk', order: 410,
  catalog({ common, field }) {
    return [{
      id: 'fhir-bulk', command: 'fhir-bulk', title: 'FHIR Bulk Data',
      terminal: false, requiredSource: SOURCE + '/application-provider.mjs',
      description: 'Reopen original healthcare exports, source files, reviewed mappings, native datasets, edition comparisons and complete customer delivery.',
      fields: [
        field('workspaceDirectory', 'Initialized FHIR workspace', 'path', true,
          'Select the private workspace created or received with fhir-bulk.'),
        field('credentialsFile', 'Authentication profiles', 'path', false,
          'Optional existing private FHIR authentication profile JSON. Secret values remain in the selected local environment.'),
        ...common,
      ],
    }];
  },
  async prepare(type, settings, context) {
    const original = await inspectFhirApplicationWorkspace(settings.workspaceDirectory);
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, context.inputPath);
    await path('workspaceDirectory', 'directory', false, true);
    for (const file of [original.marker, original.identity]) {
      const input = await context.inputPath(file.path, 'file');
      need(input.sha256 === file.sha256, 'APPLICATION_FHIR_WORKSPACE_CHANGED');
      inputs.push(input);
    }
    if (settings.credentialsFile) await path('credentialsFile', 'file');
    args.push('serve', '--workspace', original.directory, '--expected-workspace-id', original.workspaceId);
    option('--credentials-file', settings.credentialsFile);
    // Source, plans, native SQLite rows and acquired exports are editable work.
    // Keep their original private workspace identity stable across ordinary edits.
    return { args, inputs, createDirectories,
      resourceKey: digest(JSON.stringify({ family: 'fhir-bulk', directory: original.directory, workspaceId: original.workspaceId })) };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'fhir-bulk' && request.args?.[0] === 'serve';
  },
  async verifyLaunch(request) {
    const selected = selection(request);
    await inspectFhirApplicationWorkspace(selected.directory, selected.workspaceId);
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{')) return null;
      let value;
      try { value = JSON.parse(text); } catch { return null; }
      return value?.schema === STARTUP ? () => fhirApplicationStartup(request, value) : null;
    });
  },
};
