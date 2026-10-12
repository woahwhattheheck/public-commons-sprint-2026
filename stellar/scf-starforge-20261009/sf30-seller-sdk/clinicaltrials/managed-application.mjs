// MIT. ClinicalTrials preparation and authenticated startup in original Applications.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, canonical, digest, need, plain } from '../../distribution/runtime-workspace/storage.mjs';

const run = promisify(execFile);
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk';
const BINDING = 'stellar-forge.clinicaltrials-managed-binding.v1';
const STARTUP = 'stellar-forge.clinicaltrials-workspace-launch.v1';
const APPLICATION = 'stellar-forge.clinicaltrials-workspace.v1';
const SOURCE_FILES = [
  "ndjson/application.py",
  "ndjson/cli.py",
  "ndjson/cli.mjs",
  "ndjson/ndjson_source.py",
  "ndjson/managed.py",
  "ndjson/merchant.mjs",
  "ndjson/public/index.html",
  "ndjson/public/app.js",
  "ndjson/public/style.css",
  "xml/xml_source.py",
  "xml/workspace.py",
  "xml/server.py",
  "xml/native.mjs",
  "dataset-handler.mjs",
  "clinicaltrials/application-provider.mjs",
  "clinicaltrials/cli.mjs",
  "clinicaltrials/cli.py",
  "clinicaltrials/clinical_batch.py",
  "clinicaltrials/clinical_package.py",
  "clinicaltrials/clinical_prs.py",
  "clinicaltrials/clinical_server.py",
  "clinicaltrials/clinical_shared.py",
  "clinicaltrials/clinical_source.py",
  "clinicaltrials/clinical_workspace.py",
  "clinicaltrials/contracts/ProtocolRecordSchema.xsd",
  "clinicaltrials/contracts/RRSUploadSchema.xsd",
  "clinicaltrials/contracts/api-contract.json",
  "clinicaltrials/contracts/clinicaltrials-openapi.yaml",
  "clinicaltrials/contracts/source-contracts.json",
  "clinicaltrials/managed-application.mjs",
  "clinicaltrials/managed.py",
  "clinicaltrials/prs/__init__.py",
  "clinicaltrials/prs/__main__.py",
  "clinicaltrials/prs/errors.py",
  "clinicaltrials/prs/modernization.py",
  "clinicaltrials/prs/profiles/nlm-20261012.json",
  "clinicaltrials/prs/reconcile.py",
  "clinicaltrials/prs/schema.py",
  "clinicaltrials/prs/schemas/ProtocolRecordSchema.xsd",
  "clinicaltrials/prs/schemas/RRSUploadSchema.xsd",
  "clinicaltrials/prs/schemas/clinicaltrials-openapi.yaml",
  "clinicaltrials/prs/schemas/source-contracts.json",
  "clinicaltrials/prs/upload.py",
  "clinicaltrials/public/app.js",
  "clinicaltrials/public/batch.js",
  "clinicaltrials/public/index.html",
  "clinicaltrials/public/style.css",
  "clinicaltrials/publisher-bridge.mjs"
];
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function clinicalTrialsApplication(common = []) {
  return {
    id: 'clinicaltrials', command: 'clinicaltrials', title: 'ClinicalTrials registry', terminal: false,
    requiredSource: ROOT + '/clinicaltrials/managed.py',
    description: 'Reopen full study cohorts, source reviews, PRS modernization, native dataset editions, publisher and complete customer files.',
    fields: [
      field('workspaceDirectory', 'Original ClinicalTrials workspace', 'path', true,
        'Choose the private directory initialized or received by the original ClinicalTrials command.'),
      field('pythonExecutable', 'Existing Python executable', 'path', true,
        'Select the absolute Python 3.11+ executable with the declared lxml dependency and original PRS schemas.'),
      field('connectionFile', 'Console connection file', 'path', false,
        'Optional new private one-line URL file for the original ClinicalTrials MCP connection; the console removes it on Stop.'),
      ...common,
    ],
  };
}

export async function prepareClinicalTrialsApplication(settings, {
  inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function' &&
    typeof applicationEnvironment === 'function', 'APPLICATION_CLINICALTRIALS_CONTEXT_REQUIRED');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const python = await selectedExecutable(settings.pythonExecutable);
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const sourceRoot = await realpath(join(selected.sourceRoot, ROOT));
  const inputs = [workspace, ...python.inputs];
  const { environment } = await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output = await run(python.executable,
      [join(sourceRoot, 'clinicaltrials', 'cli.py'), '--workspace', workspace.path, 'binding'], {
        encoding: 'utf8', maxBuffer: 65536, timeout: 15000, windowsHide: true,
        env: { ...environment, PYTHONDONTWRITEBYTECODE: '1' },
      });
    observed = JSON.parse(output.stdout);
  } catch (error) {
    need(false, 'APPLICATION_CLINICALTRIALS_BINDING_UNAVAILABLE',
      'The original ClinicalTrials workspace and PRS runtime could not open with the selected Python: ' +
      String(error.stderr || error.message || error).trim().slice(0, 1500));
  }
  need(plain(observed) && observed.schema === BINDING && observed.applicationSchema === APPLICATION &&
    observed.workspace === workspace.path && observed.sourceRoot === sourceRoot &&
    plain(observed.workspaceIdentity) && plain(observed.python) && plain(observed.prs) &&
    plain(observed.source) && hex(observed.sha256), 'APPLICATION_CLINICALTRIALS_BINDING_CHANGED');
  const { sha256, sourceRoot: inspectedSourceRoot, ...core } = observed;
  need(digest(JSON.stringify(canonical(core)) + '\n') === sha256, 'APPLICATION_CLINICALTRIALS_BINDING_CHANGED');
  need(await realpath(observed.python.executable) === await realpath(python.executable) &&
    Array.isArray(observed.python.version) && observed.python.version.length === 3 &&
    observed.python.version.every(Number.isSafeInteger) &&
    (observed.python.version[0] > 3 || observed.python.version[0] === 3 && observed.python.version[1] >= 11),
  'APPLICATION_CLINICALTRIALS_PYTHON_CHANGED');
  need(observed.prs.schema === 'stellar-forge.prs-doctor.v1' &&
    typeof observed.prs.lxmlVersion === 'string' && typeof observed.prs.libxmlVersion === 'string' &&
    hex(observed.prs.schemaSetSha256), 'APPLICATION_CLINICALTRIALS_PRS_CHANGED');
  need(Object.keys(observed.source).length === SOURCE_FILES.length &&
    SOURCE_FILES.every(name => hex(observed.source[name])), 'APPLICATION_CLINICALTRIALS_SOURCE_INCOMPLETE');
  for (const relative of SOURCE_FILES) {
    const item = await inputPath(join(sourceRoot, relative), 'file');
    need(item.sha256 === observed.source[relative], 'APPLICATION_CLINICALTRIALS_SOURCE_CHANGED',
      'The original ClinicalTrials source changed during application review.');
    inputs.push(item);
  }
  const marker = await inputPath(join(workspace.path, 'workspace.json'), 'file');
  need(marker.sha256 === observed.workspaceIdentity.markerSha256 &&
    String(marker.dev) === observed.workspaceIdentity.markerDevice &&
    String(marker.ino) === observed.workspaceIdentity.markerInode &&
    String(workspace.dev) === observed.workspaceIdentity.device &&
    String(workspace.ino) === observed.workspaceIdentity.inode, 'APPLICATION_CLINICALTRIALS_WORKSPACE_CHANGED');
  inputs.push(marker);
  const args = ['--python', python.executable, '--workspace', workspace.path, 'serve',
    '--expected-binding', sha256, '--startup-format', 'json'];
  if (settings.connectionFile) {
    const connection = await inputPath(settings.connectionFile, 'file', true, true);
    need(!connection.exists, 'APPLICATION_CLINICALTRIALS_CONNECTION_EXISTS',
      'Choose a new connection file, or reopen the original running console that owns the existing file.');
    inputs.push(connection);
    args.push('--console-url-file', connection.path);
  }
  return { args, inputs, createDirectories: [], binding: observed };
}

function selection(request) {
  need(Array.isArray(request.args), 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
  const args = request.args;
  need(args.length >= 11 && args[0] === '--python' && args[2] === '--workspace' &&
    args[4] === 'serve', 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
  const flags = [...args.slice(0, 4), ...args.slice(5)], options = new Map();
  need(flags.length % 2 === 0, 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i], value = flags[i + 1];
    need(['--python', '--workspace', '--expected-binding', '--startup-format', '--console-url-file', '--port'].includes(key) &&
      !options.has(key) && typeof value === 'string', 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
    options.set(key, value);
  }
  need(options.size === (options.has('--console-url-file') ? 6 : 5) &&
    options.get('--startup-format') === 'json' && hex(options.get('--expected-binding')) &&
    /^(0|[1-9]\d*)$/.test(options.get('--port')) && Number(options.get('--port')) <= 65535,
  'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
  return {
    workspace: absolute(options.get('--workspace')), python: absolute(options.get('--python')),
    binding: options.get('--expected-binding'), port: Number(options.get('--port')),
    connection: options.has('--console-url-file') ? absolute(options.get('--console-url-file')) : null,
  };
}

function liveLaunch(url) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL('/api/launch', url), {
      method: 'GET',
      headers: { authorization: 'Bearer ' + url.hash.slice(1), origin: url.origin },
    }, response => {
      const chunks = [];
      let size = 0, length;
      try {
        need(response.statusCode === 200 &&
          /^application\/json(?:;|$)/i.test(response.headers['content-type'] ?? '') &&
          /^\d+$/.test(response.headers['content-length'] ?? ''),
        'APPLICATION_CLINICALTRIALS_STARTUP_UNAVAILABLE');
        length = Number(response.headers['content-length']);
        need(length > 0 && length <= 16384, 'APPLICATION_CLINICALTRIALS_STARTUP_UNAVAILABLE');
      } catch (error) { response.destroy(); reject(error); return; }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > length || size > 16384) {
          response.destroy();
          reject(Object.assign(new Error('The original launch response exceeded its declared size'),
            { code: 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          need(size === length, 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
          resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
        } catch (error) { reject(error); }
      });
      response.on('aborted', () => reject(Object.assign(new Error('The original console launch response was interrupted'),
        { code: 'APPLICATION_CLINICALTRIALS_STARTUP_UNAVAILABLE' })));
      response.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(Object.assign(new Error('The original console launch read timed out'),
      { code: 'APPLICATION_CLINICALTRIALS_STARTUP_UNAVAILABLE' })));
    req.on('error', reject);
    req.end();
  });
}

export async function clinicalTrialsStartup(request, text) {
  if (request.command !== 'clinicaltrials' || typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'CLINICALTRIALS_WORKSPACE_READY') return null;
  const selected = selection(request);
  need(value.applicationSchema === APPLICATION && value.workspace === selected.workspace &&
    value.bindingSha256 === selected.binding && (value.connectionFile ?? null) === selected.connection &&
    plain(value.python) && Array.isArray(value.python.version) && value.python.version.length === 3 &&
    plain(value.prs) && value.prs.schema === 'stellar-forge.prs-doctor.v1' && hex(value.prs.schemaSetSha256) &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.sourceRoot === 'string',
  'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
  need(await realpath(value.python.executable) === await realpath(selected.python) &&
    await realpath(value.sourceRoot) === await realpath(join(
      absolute(request.releaseDirectory), 'source', ROOT)),
  'APPLICATION_CLINICALTRIALS_EXECUTION_CHANGED',
  'The original console must use the reviewed Python and adopted ClinicalTrials source.');
  let url;
  try { url = new URL(value.console); } catch { need(false, 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (!selected.port || port === selected.port) &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)), 'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED');
  const active = await liveLaunch(url);
  need(JSON.stringify(canonical(active)) === JSON.stringify(canonical(value)),
    'APPLICATION_CLINICALTRIALS_STARTUP_CHANGED',
    'The live original ClinicalTrials console differs from its managed startup announcement.');
  return {
    url: url.href,
    original: {
      schema: STARTUP, applicationSchema: APPLICATION, workspace: selected.workspace,
      bindingSha256: selected.binding, sourceRoot: value.sourceRoot,
      python: value.python, prs: value.prs, pid: value.pid,
      ...(selected.connection ? { connectionFile: selected.connection } : {}),
    },
  };
}
