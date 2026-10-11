// MIT. Explicit fictional merchant backend for the UPSTREAM.md walkthrough.
import { createServer } from 'node:http';
const rows = [{region:'north',value:4},{region:'south',value:7}];
const server = createServer((req,res) => {
  const url = new URL(req.url,'http://127.0.0.1');
  if (url.pathname !== '/v1/dataset' || !['GET','HEAD'].includes(req.method)) {
    res.writeHead(404,{'content-type':'application/json'}); res.end('{"error":"NOT_FOUND"}'); return;
  }
  const region = url.searchParams.get('region');
  const body = JSON.stringify({dataset:'local-example',rows:rows.filter(row => !region || row.region === region)});
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',etag:'"local-example-v1"'});
  res.end(req.method === 'HEAD' ? undefined : body);
});
server.requestTimeout = 5000;
server.listen(8425,'127.0.0.1',() => console.log('Fictional backend: http://127.0.0.1:8425/v1/dataset'));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => { server.close(); server.closeIdleConnections(); });
