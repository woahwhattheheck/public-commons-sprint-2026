import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const options = JSON.parse(process.argv[2]);
const { startServer } = await import(pathToFileURL(resolve(options.source, 'workspace/server.mjs')));
let clockOffset = options.clockOffsetMs ?? 0;
const service = await startServer({ directory: options.directory, providerOrigin: options.providerOrigin, development: true,
  automationClock: () => Date.now() + clockOffset, automationPollMs: 100 });
const emit = value => writeSync(1, JSON.stringify(value) + '\n');
process.on('message', async message => {
  try {
    if (message.kind === 'clock') clockOffset = message.value - Date.now();
    if (message.kind === 'tick') await Promise.all([service.model.tickAutomation(), service.model.tickAutomation()]);
    process.send?.({ reply: message.id, clock: Date.now() + clockOffset });
  } catch (error) { process.send?.({ reply: message.id, error: error.message }); }
});
let closing = false;
const close = async () => { if (closing) return; closing = true; await service.close(); process.disconnect?.(); };
process.once('SIGTERM', () => close().catch(error => { emit({ error: error.message }); process.exitCode = 1; }));
process.once('SIGINT', () => close().catch(error => { emit({ error: error.message }); process.exitCode = 1; }));
emit({ type: 'ready', url: service.url, pid: process.pid, provider: service.model.provider.info() });

