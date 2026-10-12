#!/usr/bin/env node
// MIT. CLI over the same private connection workspace and original Applications operations.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { regular, saveJSON, absolute, privateDirectory, digest, need, json }
  from '../../../distribution/runtime-workspace/storage.mjs';
import { createConnectionWorkspace, openConnectionWorkspace, MAX_INPUT_BYTES } from './model.mjs';
import { startConnectionWorkspace } from './server.mjs';

export const STARTUP_SCHEMA = 'stellar-forge.blockscout-connection-workspace-startup.v1';
export const HELP = [
  'Blockscout connections — private first-deployment workspace (Node 24+, Linux)',
  '',
  '  init --workspace PRIVATE_DIRECTORY',
  '  serve --workspace PRIVATE_DIRECTORY [--applications EXISTING_RUNTIME_WORKSPACE] [--port 0]',
  '        [--expected-workspace-id UUID] [--expected-config-sha256 SHA256]',
  '  state --workspace DIRECTORY',
  '  history --workspace DIRECTORY [--after ID] [--limit 30]',
  '  record --workspace DIRECTORY --type TYPE --id ID',
  '  intake --workspace DIRECTORY --file PLAN_OR_BUNDLE.json --request-id UUID',
  '  review --workspace DIRECTORY --source SOURCE_ID [--changes CHANGES.json] --request-id UUID',
  '  prepare --workspace DIRECTORY --review REVIEW_ID [--out PRIVATE_PACKAGE] --request-id UUID',
  '  connect --workspace DIRECTORY --applications EXISTING_RUNTIME_WORKSPACE --request-id UUID',
  '  applications --workspace DIRECTORY --binding BINDING_ID',
  '  application-review --workspace DIRECTORY --package PACKAGE_ID --binding BINDING_ID',
  '        --runtime RUNTIME_ID --label LABEL --settings SETTINGS.json --request-id UUID',
  '  deployment-review --workspace DIRECTORY --application APPLICATION_ID --revision CURRENT_SHA256',
  '        --settings DEPLOYMENT.json --request-id UUID',
  '  application-save --workspace DIRECTORY --review REVIEW_ID --request-id UUID',
  '  reconnect --workspace DIRECTORY --application APPLICATION_ID --request-id UUID',
  '  launch-review --workspace DIRECTORY --application APPLICATION_ID --request-id UUID',
  '  launch --workspace DIRECTORY --review REVIEW_ID --request-id UUID',
  '  recover-run --workspace DIRECTORY --application APPLICATION_ID --operation ORIGINAL_UUID --request-id UUID',
  '  stop --workspace DIRECTORY --application APPLICATION_ID --operation ORIGINAL_UUID --request-id UUID',
  '  output --workspace DIRECTORY --application APPLICATION_ID --operation ORIGINAL_UUID',
  '  resume --workspace DIRECTORY --operation SAVED_REQUEST_UUID',
  '  export --workspace DIRECTORY --package PACKAGE_ID --out NEW_CONNECTION_BUNDLE.json',
  '',
  'The startup URL opens the complete operator forms. Inputs are an existing valid',
  'token merchant plan or the original complete connection bundle. Provider credentials',
  'stay in the selected host environment; the browser collects environment names and',
  'private file paths. Package receiving rebuilds the trusted original local entry.',
  '',
  'Use the same request ID when receiving a lost response. History and resume reopen',
  'that exact operation. Application save resolves one reviewed merchant identity;',
  'deployment-review revises its mode, facilitator and credential-file references',
  'after its original run stops. The package, runtime and provider state stay bound.',
  'launch/recover/stop use the existing Applications runtime and original process.',
  'Closing this setup desk leaves a separately running Applications merchant intact.',
].join('\n');

const specs = {
  init: [], serve: ['applications','port','expected-workspace-id','expected-config-sha256'],
  state: [], history: ['after','limit'], record: ['type','id'],
  intake: ['file','request-id'], review: ['source','changes','request-id'],
  prepare: ['review','out','request-id'], connect: ['applications','request-id'],
  applications: ['binding'],
  'application-review': ['package','binding','runtime','label','settings','request-id'],
  'deployment-review': ['application','revision','settings','request-id'],
  'application-save': ['review','request-id'], reconnect: ['application','request-id'],
  'launch-review': ['application','request-id'], launch: ['review','request-id'],
  'recover-run': ['application','operation','request-id'], stop: ['application','operation','request-id'],
  output: ['application','operation'], resume: ['operation'], export: ['package','out'],
};
function options(args) {
  const [command, ...rest] = args;
  need(Object.hasOwn(specs, command), 'CONNECTION_WORKSPACE_COMMAND_UNKNOWN');
  const allowed = new Set(['workspace', ...specs[command]]), out = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index].startsWith('--') ? rest[index].slice(2) : '';
    need(allowed.has(key) && !Object.hasOwn(out, key), 'CONNECTION_WORKSPACE_OPTIONS_INVALID');
    const value = rest[++index];
    need(typeof value === 'string' && value && !value.startsWith('--'), 'CONNECTION_WORKSPACE_OPTION_REQUIRED');
    out[key] = value;
  }
  need(out.workspace, 'CONNECTION_WORKSPACE_DIRECTORY_REQUIRED');
  return { command, out };
}
async function fileText(path) {
  absolute(path);
  return new TextDecoder('utf-8', { fatal: true }).decode(await regular(path, MAX_INPUT_BYTES));
}
async function fileJSON(path) { return JSON.parse(await fileText(path)); }
function integer(value, fallback) {
  if (value === undefined) return fallback;
  need(/^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)),
    'CONNECTION_WORKSPACE_INTEGER_REQUIRED');
  return Number(value);
}
async function serve(out, io) {
  let service = null, stopping = false, resolveStop;
  const stopped = new Promise(resolve => { resolveStop = resolve; });
  const signal = () => { stopping = true; resolveStop(); };
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  try {
    service = await startConnectionWorkspace({ directory: out.workspace,
      applicationsDirectory: out.applications, port: integer(out.port, 0),
      expectedWorkspaceId: out['expected-workspace-id'], expectedConfigSha256: out['expected-config-sha256'] });
    if (!stopping) {
      io.out(JSON.stringify({ schema: STARTUP_SCHEMA, status: 'BLOCKSCOUT_CONNECTION_WORKSPACE_RUNNING',
        directory: service.config.directory, workspaceId: service.config.workspaceId,
        configSha256: service.config.configSha256, controlUrl: service.controlUrl }) + '\n');
      await stopped;
    }
  } finally {
    try { if (service) await service.close(); }
    finally { process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal); }
  }
}
export async function main(args = process.argv.slice(2), io = {
  out: value => process.stdout.write(value), error: value => process.stderr.write(value),
}) {
  if (!args.length || args[0] === '--help' || args[0] === 'help') { io.out(HELP + '\n'); return; }
  const { command, out } = options(args);
  if (command === 'init') { io.out(json(await createConnectionWorkspace({ directory: out.workspace }))); return; }
  if (command === 'serve') { await serve(out, io); return; }
  const model = await openConnectionWorkspace({ directory: out.workspace });
  try {
    let result;
    const requestId = out['request-id'];
    if (command === 'state') result = await model.state();
    else if (command === 'history') result = await model.history({ after: out.after ?? '', limit: integer(out.limit, 30) });
    else if (command === 'record') result = await model.record(out.type, out.id);
    else if (command === 'applications') result = await model.applicationsState(out.binding);
    else if (command === 'output') result = await model.output(out.application, out.operation);
    else if (command === 'resume') result = await model.call('resume', { operationId: out.operation });
    else if (command === 'intake') result = await model.call(command, { requestId, filename: out.file, text: await fileText(out.file) });
    else if (command === 'review') result = await model.call(command, { requestId, sourceId: out.source,
      ...(out.changes ? { changes: await fileJSON(out.changes) } : {}) });
    else if (command === 'prepare') result = await model.call(command, { requestId, reviewId: out.review,
      ...(out.out ? { directory: out.out } : {}) });
    else if (command === 'connect') result = await model.call(command, { requestId, directory: out.applications });
    else if (command === 'application-review') result = await model.call(command, { requestId,
      bindingId: out.binding, runtimeId: out.runtime, packageId: out.package, label: out.label,
      settings: await fileJSON(out.settings) });
    else if (command === 'deployment-review') result = await model.call(command, { requestId,
      applicationId: out.application, expectedRevision: out.revision, settings: await fileJSON(out.settings) });
    else if (['application-save','launch'].includes(command))
      result = await model.call(command, { requestId, reviewId: out.review });
    else if (['reconnect','launch-review'].includes(command))
      result = await model.call(command, { requestId, applicationId: out.application });
    else if (['recover-run','stop'].includes(command))
      result = await model.call(command, { requestId, applicationId: out.application, operationId: out.operation });
    else if (command === 'export') {
      absolute(out.out);
      const { dirname } = await import('node:path'); await privateDirectory(dirname(out.out));
      const bundle = await model.download(out.package), value = JSON.parse(bundle.bytes.toString('utf8'));
      need(digest(json(value)) === bundle.sha256, 'CONNECTION_WORKSPACE_EXPORT_FORMAT_CHANGED');
      let existing;
      try { existing = await regular(out.out, MAX_INPUT_BYTES); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing) need(digest(existing) === bundle.sha256, 'CONNECTION_WORKSPACE_EXPORT_EXISTS',
        'The selected file already contains different bytes.', 409);
      else {
        try { await saveJSON(out.out, value); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      const written = await regular(out.out, MAX_INPUT_BYTES);
      need(digest(written) === bundle.sha256, 'CONNECTION_WORKSPACE_EXPORT_CHANGED', undefined, 409);
      result = { status: existing ? 'EXPORT_REOPENED' : 'EXPORTED', path: out.out,
        bytes: written.length, sha256: bundle.sha256 };
    }
    io.out(json(result));
  } finally { await model.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'CONNECTION_WORKSPACE_FAILED',
      message: String(error.message ?? error), requestId: error.requestId ?? null }) + '\n');
    process.exitCode = error.status === 409 ? 3 : 1;
  }
}
