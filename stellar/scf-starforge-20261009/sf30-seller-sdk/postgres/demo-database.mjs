#!/usr/bin/env node
// MIT. Explicit disposable PostgreSQL WASM demo, exposed only on loopback TCP.
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const database = await PGlite.create();
await database.exec(await readFile(new URL('./example-seed.sql', import.meta.url), 'utf8'));
const version = (await database.query("SELECT current_setting('server_version') AS version")).rows[0].version;
const server = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port: 0,
  maxConnections: 4, inspect: false, debug: false });
await server.start();
const uri = 'postgresql://postgres@' + server.getServerConn() + '/postgres';
const ready = { event: 'ready', engine: 'PostgreSQL WASM (PGlite)', version, uri,
  data: 'DISPOSABLE_FICTIONAL_SAMPLE', tls: 'local-plaintext' };
if (process.send) process.send(ready);
else process.stdout.write(JSON.stringify(ready) + '\n');
let closing;
async function close() {
  closing ??= server.stop().finally(() => database.close());
  await closing;
  if (process.connected) process.disconnect();
}
process.on('message', message => { if (message?.event === 'stop') close().catch(() => { process.exitCode = 1; }); });
process.once('disconnect', () => close().catch(() => { process.exitCode = 1; }));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().catch(() => { process.exitCode = 1; }));
