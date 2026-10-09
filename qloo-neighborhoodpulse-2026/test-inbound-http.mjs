import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from './server.mjs';

test('inbound JSON joins split UTF-8 bytes and returns a parsed fixture schedule', async () => {
  const server = http.createServer(createHandler());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const body = Buffer.from(JSON.stringify({
      city: 'Louisville', tastes: ['Niña Simone', 'Moonlight', 'James Baldwin'], mode: 'fixture',
    }));
    const boundary = body.indexOf(Buffer.from('ñ')[0]) + 1;
    assert(boundary > 1 && boundary < body.length);
    const result = await send(server, [body.subarray(0, boundary), body.subarray(boundary)]);
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).weeks.length, 4);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('over-32KB request returns HTTP 413 instead of abruptly destroying the connection', async () => {
  const server = http.createServer(createHandler());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await send(server, [Buffer.alloc(32769, 0x20)]);
    assert.equal(result.status, 413);
    assert.match(JSON.parse(result.body).error, /32 KB/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function send(server, chunks) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port, path: '/api/plan', method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, res => {
      const buffers = [];
      res.on('data', chunk => buffers.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(buffers).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}
