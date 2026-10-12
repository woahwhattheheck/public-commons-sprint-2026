#!/usr/bin/env node
// MIT. Original merchant cache operations, retained history and complete receiving.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from 'node:fs/promises';
import { openCacheWorkspace } from './model.mjs';
import { startCacheWorkspace } from './server.mjs';
import { renderCacheReport } from './reports.mjs';
import { regular } from '../../../distribution/runtime-workspace/storage.mjs';

const HELP = [
  'Starforge cache operations',
  '  cache-operations serve --state PRIVATE_DIRECTORY [--sources SOURCES_JSON] [--port 0]',
  '  cache-operations show --state PRIVATE_DIRECTORY [--source ALIAS]',
  '  cache-operations inspect --state PRIVATE_DIRECTORY --sources SOURCES_JSON --source ALIAS',
  '  cache-operations capture --state PRIVATE_DIRECTORY --sources SOURCES_JSON --source ALIAS --revision N [--label TEXT]',
  '  cache-operations review --state PRIVATE_DIRECTORY --id SNAPSHOT_ID',
  '  cache-operations prepare --state PRIVATE_DIRECTORY --sources SOURCES_JSON --source ALIAS --inspection SNAPSHOT_ID',
  '      --revision N --route ROUTE --action configure|invalidate [--policy RETENTION_JSON] [--note-file FILE]',
  '      [--restore-inspection PREVIOUS_SNAPSHOT_ID] [--operation-id UUID]',
  '  cache-operations apply|recover --state PRIVATE_DIRECTORY --sources SOURCES_JSON --id CHANGE_ID --revision N',
  '  cache-operations note --state PRIVATE_DIRECTORY --id CHANGE_ID --revision N --note-file FILE',
  '  cache-operations compare --state PRIVATE_DIRECTORY --before SNAPSHOT_ID --after SNAPSHOT_ID',
  '  cache-operations export --state PRIVATE_DIRECTORY --out NEW_JSON_FILE',
  '  cache-operations report --state PRIVATE_DIRECTORY --out NEW_HTML_FILE [--source ALIAS]',
  '  cache-operations restore --state NEW_PRIVATE_DIRECTORY --archive JSON_FILE [--sources SOURCES_JSON]',
  '',
  'Sources JSON is an array of {id,label,controlFile} or {id,label,socketPath}.',
  'Use the existing original merchant private control. Descriptor values stay on that host.',
  'The API merchant workspace opens this same UI under its saved package.',
  'Retention JSON: ttlMs, maxEntries, maxBytes, maxEntryBytes.',
  'A restored workspace receives the complete original operating history.', '',
].join('\n');
const readJSON = async (path, maximum = 64 * 1024 * 1024) =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(resolve(path), maximum)));
async function writeNew(path, bytes) {
  const file = await open(resolve(path), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args[0] === 'help') { process.stdout.write(HELP); return; }
  const [command, ...rest] = args, options = {};
  const allowed = new Set(['state','sources','port','source','revision','label','id','inspection','route','action','policy',
    'note-file','restore-inspection','operation-id','before','after','out','archive']);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].replace(/^--/, '');
    if (!rest[index].startsWith('--') || !allowed.has(key) || Object.hasOwn(options, key) || !rest[index + 1] ||
      rest[index + 1].startsWith('--')) throw new TypeError(HELP);
    options[key] = rest[index + 1];
  }
  if (!options.state) throw new TypeError(HELP);
  const directory = resolve(options.state), sources = options.sources ? await readJSON(options.sources, 65536) : [];
  if (command === 'serve') {
    const session = await startCacheWorkspace({ directory, sources, port: Number(options.port ?? 0) });
    process.stdout.write('Merchant cache operations: ' + session.url + '\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().catch(() => { process.exitCode = 1; }));
    return session;
  }
  const workspace = await openCacheWorkspace({ directory, sources });
  const revision = () => {
    if (!/^\d+$/.test(options.revision ?? '') || !Number.isSafeInteger(Number(options.revision))) throw new TypeError('--revision N is required');
    return Number(options.revision);
  };
  const readNote = async () => options['note-file'] ?
    new TextDecoder('utf-8', { fatal: true }).decode(await regular(resolve(options['note-file']), 8192)) : '';
  let result;
  try {
    if (command === 'show') result = workspace.snapshot({ sourceId: options.source });
    else if (command === 'inspect') result = await workspace.inspect(options.source);
    else if (command === 'capture') result = await workspace.capture({ sourceId: options.source,
      expectedRevision: revision(), label: options.label ?? '' });
    else if (command === 'review') result = workspace.inspection(options.id);
    else if (command === 'prepare') result = workspace.prepare({ sourceId: options.source, inspectionId: options.inspection,
      expectedRevision: revision(), route: options.route, action: options.action, note: await readNote(),
      ...(options.policy ? { policy: await readJSON(options.policy, 65536) } : {}),
      ...(options['restore-inspection'] ? { restoreInspectionId: options['restore-inspection'] } : {}),
      ...(options['operation-id'] ? { operationId: options['operation-id'] } : {}) });
    else if (command === 'apply' || command === 'recover') result = await workspace[command]({ id: options.id, expectedRevision: revision() });
    else if (command === 'note') result = workspace.annotate({ id: options.id, expectedRevision: revision(), note: await readNote() });
    else if (command === 'compare') result = workspace.compare(options.before, options.after);
    else if (command === 'restore') {
      if (!options.archive) throw new TypeError('--archive is required');
      result = workspace.restore(await readJSON(options.archive));
    } else if (command === 'export' || command === 'report') {
      if (!options.out) throw new TypeError('--out is required');
      const archive = workspace.exportWorkspace(), bytes = command === 'report' ?
        renderCacheReport(archive, { sourceId: options.source }) : JSON.stringify(archive, null, 2) + '\n';
      await writeNew(options.out, bytes);
      result = { file: resolve(options.out), bytes: Buffer.byteLength(bytes), workspaceId: archive.workspace.id,
        revision: archive.workspace.revision };
    } else throw new TypeError(HELP);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { await workspace.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write((error.code ?? error.message) + '\n'); process.exitCode = 1;
});
