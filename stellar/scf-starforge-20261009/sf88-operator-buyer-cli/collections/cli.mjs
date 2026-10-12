#!/usr/bin/env node
// MIT. Collection commands use the original SF88 queue and per-request terminal approval.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCollections, previewCollection } from './model.mjs';

const USAGE = `Usage:
  starforge buyer-collections preview --config ABS [--config ABS ...]
  starforge buyer-collections create --directory ABS --queue-root ABS --id ID --name NAME --preview-sha256 SHA --config ABS [--config ABS ...]
  starforge buyer-collections list --directory ABS
  starforge buyer-collections show --directory ABS --id ID
  starforge buyer-collections enqueue --directory ABS --id ID --manifest-sha256 SHA
  starforge buyer-collections run --directory ABS --id ID --manifest-sha256 SHA --intent ID [--intent ID ...] [--workspace ABS]
  starforge buyer-collections run --directory ABS --id ID --manifest-sha256 SHA --remaining
  starforge buyer-collections cancel --directory ABS --id ID --manifest-sha256 SHA --intent ID [--intent ID ...]
  starforge buyer-collections recover --directory ABS --id ID --manifest-sha256 SHA --intent ID [--intent ID ...]
  starforge buyer-collections export --directory ABS --id ID --manifest-sha256 SHA --out ABS
  starforge buyer-collections serve --directory ABS [--queue-root ABS] [--port PORT]

--queue-root is required when opening a new collection store. The inbox must
already exist; use the original "starforge inbox init --root ABS" command.
A reopened store retains that original queue binding.

A run reviews and attempts each selected request through original SF88 terminal
approval. Ctrl+C pauses remaining work. --remaining explicitly selects only the
currently QUEUED entries. Existing attempts remain in their original inbox.
Use --workspace-for INTENT=ABS repeatedly when requests use different existing
operator workspaces; it is an alternative to one common --workspace.

Enqueue, cancel, recover and export require the exact manifest SHA from show.
Preview and create preserve request, body, ticket and source identities.
`;
const error = code => { throw Object.assign(new Error(code), { code }); };
const need = (value, code) => { if (!value) error(code); };
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const repeatable = new Set(['--config', '--intent', '--workspace-for']);
function options(args, allowed) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    need(allowed.includes(flag) && (!values.has(flag) || repeatable.has(flag)), 'COLLECTION_ARGUMENT_INVALID');
    if (flag === '--remaining') { values.set(flag, true); continue; }
    const value = args[++index];
    need(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'COLLECTION_ARGUMENT_VALUE_REQUIRED');
    if (repeatable.has(flag)) values.set(flag, [...(values.get(flag) ?? []), value]);
    else values.set(flag, value);
  }
  return values;
}
function requireFlags(values, flags) {
  need(flags.every(flag => values.has(flag)), 'COLLECTION_EXPLICIT_ARGUMENTS_REQUIRED');
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && args[0] === '--help') {
    process.stdout.write(USAGE);
    return null;
  }
  const [command, ...rest] = args;
  if (command === 'serve') return (await import('./server.mjs')).main(rest);
  const allowed = {
    preview: ['--config'],
    create: ['--directory', '--queue-root', '--id', '--name', '--preview-sha256', '--config'],
    list: ['--directory', '--queue-root'],
    show: ['--directory', '--queue-root', '--id'],
    enqueue: ['--directory', '--queue-root', '--id', '--manifest-sha256'],
    run: ['--directory', '--queue-root', '--id', '--manifest-sha256', '--intent', '--remaining', '--workspace', '--workspace-for'],
    cancel: ['--directory', '--queue-root', '--id', '--manifest-sha256', '--intent'],
    recover: ['--directory', '--queue-root', '--id', '--manifest-sha256', '--intent'],
    export: ['--directory', '--queue-root', '--id', '--manifest-sha256', '--out'],
  };
  need(Object.hasOwn(allowed, command), 'COLLECTION_COMMAND_REQUIRED');
  const values = options(rest, allowed[command]);
  if (command === 'preview') {
    requireFlags(values, ['--config']);
    const result = await previewCollection({ configFiles: values.get('--config') });
    print(result); return result;
  }
  requireFlags(values, ['--directory']);
  if (command !== 'list') requireFlags(values, ['--id']);
  if (['enqueue', 'run', 'cancel', 'recover', 'export'].includes(command))
    requireFlags(values, ['--manifest-sha256']);
  const model = await openCollections({
    directory: values.get('--directory'), queueRoot: values.get('--queue-root'),
  });
  const controller = new AbortController();
  let interrupted = null;
  const interrupt = () => { interrupted = 130; controller.abort(); };
  const terminate = () => { interrupted = 143; controller.abort(); };
  if (command === 'run') {
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
  }
  try {
    const id = values.get('--id'), expectedManifestSha256 = values.get('--manifest-sha256');
    let result;
    if (command === 'list') result = await model.list();
    else if (command === 'show') result = await model.inspect(id);
    else if (command === 'create') {
      requireFlags(values, ['--name', '--preview-sha256', '--config']);
      result = await model.create({ id, name: values.get('--name'), configFiles: values.get('--config'),
        expectedPreviewSha256: values.get('--preview-sha256') });
    } else if (command === 'enqueue') result = await model.enqueue({ id, expectedManifestSha256 });
    else if (command === 'export') {
      requireFlags(values, ['--out']);
      result = await model.export({ id, directory: values.get('--out'), expectedManifestSha256 });
    } else if (command === 'cancel' || command === 'recover') {
      requireFlags(values, ['--intent']);
      result = await model[command]({ id, intentIds: values.get('--intent'), expectedManifestSha256 });
    } else {
      need(values.has('--remaining') !== values.has('--intent'), 'COLLECTION_ONE_SELECTION_REQUIRED');
      need(!values.has('--workspace') || !values.has('--workspace-for'), 'COLLECTION_ONE_WORKSPACE_SOURCE_REQUIRED');
      const status = await model.inspect(id);
      need(status.manifestSha256 === expectedManifestSha256, 'COLLECTION_MANIFEST_CHANGED');
      const intentIds = values.has('--remaining')
        ? status.items.filter(item => item.state === 'QUEUED').map(item => item.intentId)
        : values.get('--intent');
      if (intentIds.length === 0) {
        result = { ...status, action: { kind: 'RUN', state: 'NO_REMAINING_REQUESTS', results: [] } };
      } else {
        const workspaceByIntent = Object.create(null);
        if (values.has('--workspace'))
          for (const intentId of intentIds) workspaceByIntent[intentId] = values.get('--workspace');
        for (const value of values.get('--workspace-for') ?? []) {
          const split = value.indexOf('=');
          need(split > 0, 'COLLECTION_WORKSPACE_MAP_INVALID');
          const intentId = value.slice(0, split), workspace = value.slice(split + 1);
          need(intentIds.includes(intentId) && !Object.hasOwn(workspaceByIntent, intentId), 'COLLECTION_WORKSPACE_MAP_INVALID');
          workspaceByIntent[intentId] = workspace;
        }
        process.stderr.write('Selected original requests:\n' + intentIds.map(intentId => '  ' + intentId).join('\n') + '\n');
        result = await model.run({ id, intentIds, expectedManifestSha256, workspaceByIntent, signal: controller.signal });
      }
    }
    print(result);
    if (result?.action?.results?.some(row => row.error) || result?.action?.state === 'NEEDS_REVIEW')
      process.exitCode = 2;
    return result;
  } finally {
    if (command === 'run') {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
    await model.close();
    if (interrupted !== null) process.exitCode = interrupted;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'COLLECTION_OPERATION_FAILED';
    process.stderr.write(JSON.stringify({ error: code }) + '\n');
    process.exitCode = 1;
  });
}
