#!/usr/bin/env node
// MIT. Explicit source synchronization and original native receiver delivery.
import { pathToFileURL } from 'node:url';
import { openDestinationWorkspace } from './model.mjs';
import { readJSON, codeOf, fault } from './storage.mjs';

const usage = `SF98 merchant delivery destinations

node destinations/cli.mjs init --workspace /private/destinations --source /private/sf98-outbox
node destinations/cli.mjs enroll --workspace /private/destinations --file /private/receiver.json
node destinations/cli.mjs status|sync|drain --workspace /private/destinations [--id accounting]
node destinations/cli.mjs pause|resume --workspace /private/destinations --id accounting --revision 1
node destinations/cli.mjs events --workspace /private/destinations --id accounting [--state EXHAUSTED --offset 0 --limit 50]
node destinations/cli.mjs requeue --workspace /private/destinations --id accounting --event ORIGINAL_EVENT_ID --revision 1 --delivery-revision ORIGINAL_DELIVERY_REVISION
node destinations/cli.mjs run --workspace /private/destinations [--limit 20 --concurrency 1 --destination-concurrency 4 --timeout-ms 7000 --poll-ms 5000]
node destinations/cli.mjs stop|handoff --workspace /private/destinations
node destinations/cli.mjs export --workspace /private/destinations --to /private/portable-destinations
node destinations/cli.mjs inspect --workspace /private/portable-destinations
node destinations/cli.mjs receive --workspace /private/received --from /private/portable-destinations --fingerprint SHA256
node destinations/cli.mjs serve --workspace /private/destinations [--source /private/sf98-outbox --port 8478]

Enrollment copies no events and sends no request. Select history "all" or "new" in the private enrollment file.
Sync copies exact original selected events; drain and run explicitly deliver them through the original signed transport.
Each destination references its signing secret by environment variable name. Start delivery in that environment.
`;
const allowed = {
  init: ['--source'], enroll: ['--file'], status: [], sync: ['--id'],
  drain: ['--id', '--limit', '--concurrency', '--destination-concurrency', '--timeout-ms'],
  pause: ['--id', '--revision'], resume: ['--id', '--revision'],
  events: ['--id', '--state', '--offset', '--limit'], requeue: ['--id', '--event', '--revision', '--delivery-revision'],
  run: ['--limit', '--concurrency', '--destination-concurrency', '--timeout-ms', '--poll-ms'], stop: [], handoff: [], export: ['--to'], inspect: [], receive: ['--from', '--fingerprint'], serve: ['--source', '--port'],
};
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['help', '-h', '--help'].includes(args[0])) {
    process.stdout.write(usage); return { help: true };
  }
  const [command, ...rest] = args;
  if (!allowed[command] || rest.length % 2) throw fault('INVALID_DESTINATIONS_USAGE');
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    if (!['--workspace', ...allowed[command]].includes(rest[index]) || options.has(rest[index]) || !rest[index + 1])
      throw fault('INVALID_OR_DUPLICATE_OPTION');
    options.set(rest[index], rest[index + 1]);
  }
  const directory = options.get('--workspace');
  if (!directory) throw fault('WORKSPACE_DIRECTORY_REQUIRED');
  const number = (name, fallback) => {
    const value = options.get(name);
    if (value === undefined) return fallback;
    if (!/^(0|[1-9][0-9]{0,8})$/.test(value)) throw fault('INVALID_NUMERIC_OPTION');
    return Number(value);
  };
  const required = name => { const value = options.get(name); if (!value) throw fault('REQUIRED_OPTION_MISSING'); return value; };
  if (command === 'serve') {
    const { startDestinationsServer } = await import('./server.mjs');
    const session = await startDestinationsServer({ directory, sourceDirectory: options.get('--source'), port: number('--port', 8478) });
    process.stdout.write(JSON.stringify({ url: session.url, directory, sourceDirectory: session.model.sourceDirectory }) + '\n');
    const stop = async () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await session.close(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop); return session;
  }
  if (['export', 'inspect', 'receive'].includes(command)) {
    const { exportDestinationWorkspace, inspectDestinationExchange, receiveDestinationExchange } = await import('./exchange.mjs');
    const result = command === 'export' ? await exportDestinationWorkspace(directory, required('--to')) :
      command === 'inspect' ? await inspectDestinationExchange(directory) :
      await receiveDestinationExchange(required('--from'), directory, required('--fingerprint'));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  const model = await openDestinationWorkspace({ directory,
    sourceDirectory: command === 'init' ? required('--source') : undefined });
  let result;
  try {
    if (['init', 'status'].includes(command)) result = await model.state();
    else if (command === 'enroll') result = await model.enroll(await readJSON(required('--file')));
    else if (command === 'sync') result = await model.sync({ id: options.get('--id') });
    else if (command === 'drain') result = await model.drain({ id: options.get('--id'),
      limit: number('--limit', 20), concurrency: number('--concurrency', 1), destinationConcurrency: number('--destination-concurrency', 4), timeoutMs: number('--timeout-ms', 7000) });
    else if (['pause', 'resume'].includes(command)) result = await model.setPaused({ id: required('--id'),
      expectedRevision: number('--revision', -1), paused: command === 'pause' });
    else if (command === 'events') result = await model.events({ id: required('--id'), state: options.get('--state') ?? 'ALL',
      offset: number('--offset', 0), limit: number('--limit', 50) });
    else if (command === 'requeue') result = await model.requeue({ id: required('--id'), eventId: required('--event'),
      expectedRevision: number('--revision', -1), expectedDeliveryRevision: required('--delivery-revision') });
    else if (command === 'stop') result = await model.stop();
    else if (command === 'handoff') result = await model.handoff();
    else if (command === 'run') {
      const stop = () => { model.stop().catch(() => {}); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      try {
        const started = await model.start({ limit: number('--limit', 20), concurrency: number('--concurrency', 1),
          destinationConcurrency: number('--destination-concurrency', 4), timeoutMs: number('--timeout-ms', 7000), pollMs: number('--poll-ms', 5000) });
        process.stdout.write(JSON.stringify(started) + '\n'); result = await model.waitForWorker();
      } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (Array.isArray(result?.results) && result.results.some(item => !item.ok)) process.exitCode = 1;
    return result;
  } finally { await model.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { process.stderr.write(codeOf(error) + '\n'); process.exitCode = error.code === 'SF98_DELIVERY_BUSY' ? 75 : 1; });
