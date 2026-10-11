// MIT. Disposable PostgreSQL WASM fixture for the single focused adapter exercise.
// PGlite and its socket server are development dependencies, never seller imports.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const db = await PGlite.create();
await db.exec(`CREATE SCHEMA merchant;
  CREATE TABLE merchant.catalog (id bigint PRIMARY KEY, title text, region text, price_cents bigint, precise numeric, active boolean, extra jsonb, private_note text);
  INSERT INTO merchant.catalog VALUES
    (9007199254740993, 'Café 東京', 'north', 9223372036854775807, 12345678901234567890.123456789, true, '{"big":9007199254740993}', 'NEVER_PUBLIC'),
    (9007199254740994, 'Second', 'north', 499, 0.000000001, false, NULL, 'NEVER_PUBLIC'),
    (9007199254740995, 'Third', 'north', 599, 12.30, true, '{}', 'NEVER_PUBLIC');
  CREATE TABLE merchant.write_guard (value int);
  CREATE FUNCTION merchant.forbidden_write() RETURNS int LANGUAGE plpgsql AS $f$
    BEGIN INSERT INTO merchant.write_guard VALUES (1); RETURN 1; END $f$;`);
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 4 });
await server.start();
const version = (await db.query('SELECT version() AS version')).rows[0].version;
process.send({ port: Number(server.getServerConn().split(':').at(-1)), version });
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await server.stop(); await db.close(); if (process.connected) process.disconnect();
}
process.on('message', async message => { if (message === 'stop') await stop(); });
process.once('disconnect', () => void stop());
