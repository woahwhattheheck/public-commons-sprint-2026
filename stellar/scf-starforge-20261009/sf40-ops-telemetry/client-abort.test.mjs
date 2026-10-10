import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createOpsHandler } from './ops.mjs';

const catalog = {size:1,version:1,list(){return {resources:[]}},search(){return {resources:[]}}};

test('partial 200 response abandoned by client is an incomplete request, not an HTTP success', async () => {
  let notifyClose;
  const backendClosed = new Promise(resolve => { notifyClose = resolve; });
  const observations = [];
  const backend = async (req,res) => {
    if (req.url === '/discovery/search') { res.writeHead(200); res.end('{}'); return; }
    res.writeHead(200, {'content-type':'application/json','content-length':2048});
    res.write('{"resources":['); // intentionally incomplete original response
    res.once('close', notifyClose);
    await backendClosed;
  };
  const ops = createOpsHandler({ catalog, discoveryHandler:backend,
    maxInFlight:1, observe: event => observations.push(event) });
  const server = createServer(ops.handler);
  server.listen(0, '127.0.0.1');
  await once(server,'listening');
  try {
    const root = 'http://127.0.0.1:' + server.address().port;
    await new Promise((resolve,reject) => {
      const req = request(root+'/discovery/resources', res => {
        assert.equal(res.statusCode,200);
        res.once('data',() => { req.destroy(); resolve(); });
        res.once('error', reject);
      });
      req.once('error',e => { if (e.code!=='ECONNRESET') reject(e); });
      req.end();
    });
    await backendClosed;
    await new Promise(resolve => setImmediate(resolve));
    const s = ops.snapshot();
    const metrics = s.routeMetrics['/discovery/resources'];
    assert.equal(metrics.requests,1);
    assert.equal(metrics.abortedResponses,1);
    assert.equal(metrics.statusClasses['2xx'],0);
    assert.equal(metrics.sampleCount,0);
    assert.equal(s.completedRequests,0);
    assert.equal(s.abortedResponses,1);
    assert.equal(s.inFlight,0);
    assert.deepEqual(observations[0], {
      route:'/discovery/resources', status:null, durationMs:observations[0].durationMs, aborted:true
    });
    // The abandonment releases admission for a subsequent successful request.
    const next = await fetch(root+'/discovery/search');
    assert.equal(next.status,200);assert.equal(await next.text(),'{}');
    assert.equal(ops.snapshot().completedRequests,1);
    assert.equal(ops.snapshot().routeMetrics['/discovery/search'].statusClasses['2xx'],1);
  } finally {
    server.close();await once(server,'close');
  }
});
