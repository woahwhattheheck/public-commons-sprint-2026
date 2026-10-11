#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace } from './model.mjs';
import { startServer } from './server.mjs';
import { id, parse, requireThat } from './common.mjs';

function argumentsOf(argv) {
  const [command = 'help', ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i++) { const key = rest[i]; requireThat(/^--[a-z-]+$/.test(key) && !Object.hasOwn(options, key), 'ARGUMENT', 'Invalid or duplicate argument'); if (['--development', '--complete'].includes(key)) options[key] = true; else { requireThat(rest[i + 1] && !rest[i + 1].startsWith('--'), 'ARGUMENT', 'Argument needs a value'); options[key] = rest[++i]; } }
  return { command, options };
}
export async function main(argv) {
  const { command, options: o } = argumentsOf(argv);
  if (command === 'help') return { usage: 'node workspace/cli.mjs COMMAND --state PRIVATE_DIRECTORY [options]', commands: {
    serve: '[--port 0] [--token-env HUBSPOT_TOKEN] [--provider-origin http://127.0.0.1:PORT --development]',
    init: '--name PROJECT [--actor NAME]', status: '[--project ID]',
    import: '--project ID --file NATIVE_JSON --name CAPTURE [--complete]', schema: '--project ID --kind properties|pipelines --file NATIVE_JSON',
    config: '--project ID --file CONFIG_JSON', sync: '--project ID --name CAPTURE', resume: '--job ID',
    run: '--project ID --snapshot ID --as-of ISO_TIME --name NAME', retry: '--run ID',
    review: '--run ID --deal ID --file REVIEW_JSON', propose: '--run ID --file ACTION_JSON',
    prepare: '--action ID', approve: '--action ID --note TEXT', execute: '--action ID', reconcile: '--action ID [--native-id ID]', revoke: '--action ID --note TEXT',
    export: '--project ID --name NAME --out NEW_FILE [--run ID]', restore: '--file PROJECT_JSON_GZ --name NAME', report: '--run ID --out NEW_FILE', compare: '--run ID --baseline ID'
  }, note: 'CLI mutations use the same retained model. Stop the browser process before opening its directory from the CLI. Add --actor and --request-id for named, idempotent commands. Sync/execute/reconcile await their retained operation.' };
  requireThat(o['--state'], 'STATE', 'Provide --state with the private workspace directory');
  const settings = { directory: resolve(o['--state']), port: Number(o['--port'] ?? 0), tokenEnv: o['--token-env'] ?? null, providerOrigin: o['--provider-origin'] ?? 'https://api.hubapi.com', development: Boolean(o['--development']) };
  if (command === 'serve') {
    const service = await startServer(settings); process.stdout.write(JSON.stringify({ url: service.url, state: settings.directory, provider: service.model.provider.info() }) + '\n');
    let closing = false; const close = () => { if (!closing) { closing = true; service.close().catch(e => { process.stderr.write(e.message + '\n'); process.exitCode = 1; }); } }; process.once('SIGINT', close); process.once('SIGTERM', close); return service;
  }
  const model = await openWorkspace(settings);
  try {
    const actor = o['--actor'] ?? 'Local operator', requestId = o['--request-id'] ?? id(), projectId = o['--project'];
    const input = { actor, requestId, ...(projectId ? { revision: model.store.project(projectId).revision } : {}) };
    const contents = async () => { requireThat(o['--file'], 'FILE', 'Provide --file'); return readFile(resolve(o['--file'])); };
    let result;
    if (command === 'init') result = model.createProject({ ...input, name: o['--name'] });
    else if (command === 'status') result = projectId ? model.project(projectId) : model.state();
    else if (command === 'config') result = model.saveConfig(projectId, { ...input, config: parse(await contents()) });
    else if (command === 'schema') result = model.importSchema(projectId, { ...input, kind: o['--kind'], filename: o['--file'].split('/').at(-1), contentBase64: (await contents()).toString('base64') });
    else if (command === 'import') result = model.importSource(projectId, { ...input, name: o['--name'], filename: o['--file'].split('/').at(-1), contentBase64: (await contents()).toString('base64'), declaredComplete: Boolean(o['--complete']) });
    else if (command === 'sync' || command === 'resume') { result = command === 'sync' ? model.startSync(projectId, { ...input, name: o['--name'] }) : model.resumeJob(o['--job'], input); await model.background.get(result.job.id)?.completion; result = model.job(result.job.id); }
    else if (command === 'run' || command === 'retry') { result = command === 'run' ? model.startRun(projectId, { ...input, name: o['--name'], snapshotId: o['--snapshot'], asOf: o['--as-of'] }) : model.retryRun(o['--run'], input); await model.background.get(result.run.id)?.completion; result = model.run(result.run.id); }
    else if (command === 'review') result = model.review(o['--run'], o['--deal'], { ...parse(await contents()), ...input });
    else if (command === 'propose') { const run = model.store.get(o['--run'], 'run'); result = model.createAction(run.id, { ...parse(await contents()), ...input, revision: model.store.project(run.projectId).revision }); }
    else if (['prepare', 'approve', 'execute', 'reconcile', 'revoke'].includes(command)) {
      const action = model.store.get(o['--action'], 'action'); result = await model[command + 'Action'](action.id, { ...input, version: action.version, ...(o['--note'] ? { note: o['--note'] } : {}), ...(command === 'reconcile' ? { nativeId: o['--native-id'] ?? null } : {}) });
      await model.background.get(action.id)?.completion; result = model.action(action.id);
    } else if (command === 'compare') result = model.compare(o['--run'], o['--baseline']);
    else if (command === 'export') { requireThat(o['--out'], 'OUTPUT', 'Provide a new --out file'); result = model.exportProject(projectId, { ...input, name: o['--name'] ?? 'Customer handover', runId: o['--run'] ?? null }); await writeFile(resolve(o['--out']), model.store.readFile(result.export.fileId).data, { flag: 'wx', mode: 0o600 }); }
    else if (command === 'restore') result = model.restoreProject({ ...input, name: o['--name'], filename: o['--file'].split('/').at(-1), contentBase64: (await contents()).toString('base64') });
    else if (command === 'report') { const run = model.store.get(o['--run'], 'run'); requireThat(o['--out'], 'OUTPUT', 'Provide a new --out file'); await writeFile(resolve(o['--out']), model.store.readFile(run.reportFileId).data, { flag: 'wx', mode: 0o600 }); result = { out: resolve(o['--out']), reportFileId: run.reportFileId }; }
    else requireThat(false, 'COMMAND', 'Unknown command; run help');
    return result;
  } finally { await model.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(result => { if (!result?.server) process.stdout.write(JSON.stringify(result, null, 2) + '\n'); }).catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'OPERATION_FAILED', message: error.message }) + '\n'); process.exitCode = 1; });
