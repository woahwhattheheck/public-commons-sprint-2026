#!/usr/bin/env node
// MIT. Own one original merchant workspace and its foreground seller lifecycle.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { startDuckdbWorkspace } from './server.mjs';
import { WorkspaceError, publicIssue } from './model.mjs';
import { readSavedWorkspaceSource } from './store.mjs';
import { prepareWorkbenchSource } from '../workbench/bootstrap.mjs';

const HELP = `Usage: node duckdb/workspace/cli.mjs --state PRIVATE_DIRECTORY
  [--source SOURCE.json | --data-dir DATA_DIRECTORY [--database FILE] [--parquet FILE]...]
  [--plan MERCHANT_PLAN.json] [--python /private/duckdb-venv/bin/python]
  [--port 8437] [--seller-port 0] [--operations-port 0]
  [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]
  [--facilitator HTTPS_URL] [--allow-local-facilitator]

Opens native relation/query authoring, previews, merchant-plan editing, retained drafts/packages and
the original seller/operations runtime. The private URL printed below opens the app.
Use --state or --workspace with the saved directory to reopen its retained source.
SIGINT/SIGTERM drain
the owned merchant and close the workspace. Native payment uses the configured facilitator.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP + '\n'); return null; }
  const values = new Map();
  const parquetFiles = [];
  for (let index = 0; index < args.length; index++) {
    const flag = args[index] === '--workspace' ? '--state' : args[index];
    if (flag === '--parquet' && args[index + 1] && !args[index + 1].startsWith('--')) {
      parquetFiles.push(args[++index]); continue;
    }
    if (values.has(flag)) throw new WorkspaceError('DUPLICATE_COMMAND_OPTION');
    if (flag === '--allow-local-facilitator') { values.set(flag, true); continue; }
    if (!['--source', '--data-dir', '--database', '--state', '--plan', '--python', '--port', '--seller-port', '--operations-port', '--facilitator', '--availability-dir'].includes(flag) ||
        !args[index + 1] || args[index + 1].startsWith('--')) throw new WorkspaceError('INVALID_COMMAND_OPTIONS', 422, HELP);
    values.set(flag, args[++index]);
  }
  if (!values.has('--state') || values.has('--source') && values.has('--data-dir') ||
      !values.has('--data-dir') && (values.has('--database') || parquetFiles.length) ||
      values.has('--allow-local-facilitator') && !values.has('--facilitator'))
    throw new WorkspaceError('SOURCE_AND_WORKSPACE_REQUIRED', 422, HELP);
  const port = (name, fallback) => {
    const raw = values.get(name) ?? String(fallback);
    if (!/^(0|[1-9]\d{0,4})$/.test(raw) || Number(raw) > 65535) throw new WorkspaceError('INVALID_LISTENER_PORT');
    return Number(raw);
  };
  let nativeFactory = null;
  if (values.has('--facilitator')) {
    const url = new URL(values.get('--facilitator'));
    const local = values.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new WorkspaceError('DUCKDB_FACILITATOR_URL_INVALID');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../../native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled,
      { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
  }
  const directory = resolve(values.get('--state'));
  let sourceFile = values.has('--source') ? resolve(values.get('--source')) : null;
  if (!sourceFile && values.has('--data-dir')) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    ({ sourceFile } = await prepareWorkbenchSource({ dataDirectory: resolve(values.get('--data-dir')),
      database: values.get('--database') ?? ':memory:', parquetFiles, workspace: directory }));
  }
  sourceFile ??= await readSavedWorkspaceSource(directory);
  const session = await startDuckdbWorkspace({ sourceFile,
    availabilityDirectory: values.get('--availability-dir'),
    directory, ...(values.has('--plan') ? { planFile: resolve(values.get('--plan')) } : {}),
    python: values.get('--python') ?? 'python3', port: port('--port', 8437),
    sellerPort: port('--seller-port', 0), operationsPort: port('--operations-port', 0), nativeFactory });
  process.stdout.write(JSON.stringify({ workspace: session.url, state: session.model.directory }) + '\n');
  const finish = () => session.close().catch(error => { process.stderr.write(publicIssue(error).error + '\n'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, finish);
  return session;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(JSON.stringify(publicIssue(error)) + '\n'); process.exitCode = 1; });
