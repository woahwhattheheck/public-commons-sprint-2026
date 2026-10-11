import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './pilot.mjs';

const sourceFiles = ['offers.json', 'seller-service.json', 'manifest.json'];
const snapshot = out => Promise.all(sourceFiles.map(name => readFile(join(out, name), 'utf8')));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'seller-operation-'));
  const example = name => readFile(new URL('../sf61-openapi-seller-import/' + name, import.meta.url));
  const spec = join(root, 'openapi.json'), selections = join(root, 'selections.json'), bindings = join(root, 'bindings.json');
  await Promise.all([
    example('openapi.example.json').then(bytes => writeFile(spec, bytes)),
    example('service-selections.example.json').then(bytes => writeFile(selections, bytes)),
    example('service-bindings.example.json').then(bytes => writeFile(bindings, bytes)),
  ]);
  const out = join(root, 'seller');
  return { root, out, inputs: [spec, selections, bindings],
    args: ['--spec', spec, '--config', selections, '--bindings', bindings, '--out', out] };
}

test('original compile → run → stop → resume keeps source and saved options; status is live', async () => {
  const f = await fixture(); let session;
  try {
    const handler = join(f.root, 'handlers.mjs');
    await writeFile(handler, 'export function forecast() { return { status: 200, body: { forecast: true } }; }\n');
    await writeFile(f.inputs[2], JSON.stringify([{ method: 'POST', path: '/forecast', id: 'forecast', handler: 'forecast' }]));
    session = await launch([...f.args, '--handlers', handler, '--port', '0']);
    const before = await snapshot(f.out);
    const challenge = await fetch(session.url + '/api/v2/forecast', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{"latitude":38.25,"longitude":-85.76}' });
    assert.equal(challenge.status, 402); await challenge.text();
    assert.equal((await launch(['--status', f.out])).state, 'RUNNING');
    await session.close(); session = null;
    assert.equal((await launch(['--status', f.out])).state, 'UNAVAILABLE');
    await Promise.all(f.inputs.map(path => rm(path)));
    session = await launch(['--resume', f.out]);
    assert.deepEqual(await snapshot(f.out), before);
    const live = await launch(['--status', f.out]);
    assert.equal(live.state, 'RUNNING'); assert.equal(live.lastSuccessfulRuntime.handlers, handler); assert.equal(live.lastSuccessfulRuntime.port, '0');
    await session.close(); session = null;
    await writeFile(join(f.out, 'offers.json'), before[0] + ' ');
    const marker = join(f.root, 'imported'), uncalled = join(f.root, 'uncalled.mjs');
    await writeFile(uncalled, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'imported');\n`);
    await assert.rejects(launch(['--resume', f.out, '--handlers', uncalled]), /differs from manifest/);
    await assert.rejects(access(marker), { code: 'ENOENT' });
  } finally { if (session) await session.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('occupied-port first launch recovers from its compiled directory with an explicit override', async () => {
  const f = await fixture(); const occupied = createServer(); let session;
  try {
    await new Promise(done => occupied.listen(0, '127.0.0.1', done));
    const port = String(occupied.address().port);
    await assert.rejects(launch([...f.args, '--port', port]), error =>
      error.cause?.code === 'EADDRINUSE' && error.message.includes('--resume') && error.message.includes('--port 0'));
    const before = await snapshot(f.out);
    assert.equal((await launch(['--status', f.out])).state, 'NOT_STARTED');
    session = await launch(['--resume', f.out, '--port', '0', '--challenge-only']);
    assert.equal(session.mode, 'CHALLENGE_ONLY');
    assert.deepEqual(await snapshot(f.out), before);
    const saved = JSON.parse(await readFile(join(f.out, 'pilot-runtime.json'), 'utf8'));
    assert.equal(saved.options.port, '0'); assert.equal(saved.options.facilitator, undefined);
  } finally {
    if (session) await session.close();
    if (occupied.listening) await new Promise(done => occupied.close(done));
    await rm(f.root, { recursive: true, force: true });
  }
});
