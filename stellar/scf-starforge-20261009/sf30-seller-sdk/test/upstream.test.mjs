// MIT. Focused declarative integration through the shared original HTTP handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { compileUpstreamBindings,createUpstreamHandlers,validateUpstreamService } from '../upstream.mjs';
const document = bindings => ({schema:'stellar-forge.seller-upstreams.v1',bindings});
const context = (path='/resource',extra={}) => ({method:'GET',url:new URL('https://seller.example'+path),headers:{},pathParams:{},...extra});

test('existing backend: exact selected inputs, buffered output and no secret/payment header forwarding',async t => {
  let observed;
  const server = createServer(async (req,res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    observed = {path:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks).toString()};
    res.writeHead(200,{'content-type':'application/json',etag:'"v1"','set-cookie':'private-session=never-forward',
      'payment-response':'upstream-is-not-the-payment-authority','x-internal':'private'});
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({rows:[{region:'north',value:4}]}));
  });
  await new Promise(done => server.listen(0,'127.0.0.1',done));
  t.after(() => new Promise(done => {server.close(done);server.closeAllConnections();}));
  const config = document({dataset:{origin:`http://127.0.0.1:${server.address().port}`,path:'/v1/items/:item',query:['tag','region'],
    requestHeaders:['Accept-Language'],headerEnv:{Authorization:'TEST_BACKEND_TOKEN'},responseHeaders:['etag']}});
  const env = {TEST_BACKEND_TOKEN:'Bearer locally-generated-test-value'};
  config.bindings.post = {...config.bindings.dataset,method:'POST'};
  config.bindings.head = {...config.bindings.dataset,method:'HEAD'};
  const bindings = compileUpstreamBindings(config,{allowLoopback:true,env});
  validateUpstreamService({routes:[['dataset','GET'],['post','POST'],['head','HEAD']].map(([handler,method]) => ({path:'/items/:item',handler,definition:{method}}))},bindings);
  const handlers = createUpstreamHandlers(config,{allowLoopback:true,env});
  env.TEST_BACKEND_TOKEN = 'changed-after-start';
  const result = await handlers.dataset(context('/items/A?tag=a&region=north&tag=b',{
    pathParams:{item:'東京 space'},headers:{'accept-language':'ja','authorization':'buyer-value','cookie':'buyer-cookie',
      'payment-signature':'buyer-proof','x-payment':'legacy-proof','x-forwarded-host':'attacker.invalid'}}));
  assert.equal(result.status,200); assert.deepEqual(JSON.parse(result.body),{rows:[{region:'north',value:4}]});
  assert.equal(observed.path,'/v1/items/%E6%9D%B1%E4%BA%AC%20space?tag=a&region=north&tag=b');
  assert.equal(observed.headers.authorization,'Bearer locally-generated-test-value');
  assert.equal(observed.headers['accept-language'],'ja'); assert.equal(observed.headers['accept-encoding'],'gzip, deflate, br');
  for (const key of ['cookie','payment-signature','x-payment','x-forwarded-host']) assert.equal(observed.headers[key],undefined);
  assert.deepEqual({...result.headers},{'content-type':'application/json',etag:'"v1"'});
  await handlers.post(context('/resource',{method:'POST',pathParams:{item:'query'},body:{filters:['a','b'],limit:2}}));
  assert.equal(observed.method,'POST'); assert.equal(observed.body,'{"filters":["a","b"],"limit":2}');
  assert.equal(observed.headers['content-type'],'application/json; charset=utf-8');
  const head = await handlers.head(context('/resource',{method:'HEAD',pathParams:{item:'query'}}));
  assert.equal(head.status,200); assert.equal(head.body.length,0);
});

test('failure path: no redirect/retry, internal error text withheld, deadlines and streaming size enforced',async t => {
  let calls = 0, redirectHits = 0;
  const server = createServer((req,res) => {
    calls++;
    if (req.url === '/redirect') {res.writeHead(302,{location:'/target'});res.end();}
    else if (req.url === '/target') {redirectHits++;res.end('never');}
    else if (req.url === '/failure') {res.writeHead(500);res.end('DATABASE_PASSWORD=do-not-release');}
    else if (req.url === '/slow') {res.writeHead(200,{'content-type':'application/json'});res.write('{');}
    else if (req.url === '/large') {res.writeHead(200,{'content-type':'application/json'});res.write('"'+ 'a'.repeat(80));res.end('a'.repeat(80)+'"');}
    else if (req.url === '/broken') {res.writeHead(200,{'content-type':'application/json','content-length':99});res.end('{}');}
    else if (req.url === '/compressed') {res.writeHead(200,{'content-type':'application/json','content-encoding':'gzip'});res.end('{}');}
    else if (req.url === '/badjson') {res.writeHead(200,{'content-type':'application/json'});res.end('{invalid');}
    else {res.writeHead(200,{'content-type':'application/json'});res.end('{}');}
  });
  await new Promise(done => server.listen(0,'127.0.0.1',done));
  t.after(() => new Promise(done => {server.close(done);server.closeAllConnections();}));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const names = ['redirect','failure','slow','large','broken','compressed','badjson','ok'];
  const handlers = createUpstreamHandlers(document(Object.fromEntries(names.map(name => [name,{
    origin,path:'/'+name,timeoutMs:100,maxResponseBytes:100}]))),{allowLoopback:true});
  for (const name of names.slice(0,-1)) {
    const before = calls, result = await handlers[name](context());
    assert.ok(result.status >= 400,name);
    assert.equal(calls,before+1,name+' invokes backend once');
    assert.doesNotMatch(JSON.stringify(result),/DATABASE_PASSWORD|do-not-release/);
    if (name === 'slow') assert.equal(result.status,504);
  }
  assert.equal(redirectHits,0);
  assert.equal((await handlers.ok(context())).status,200,'failure does not poison later calls');
});

test('startup and resolver boundaries: declared routes only, no compile-time I/O, invalid targets never connect',async () => {
  const valid = {origin:'https://backend.example',path:'/api/:item'};
  for (const override of [{path:'/api/..'},{path:'//other/path'},{path:'/a:x'},{path:'/a'.repeat(300)+'%'},
    {origin:'http://localhost:8000'},{origin:'http://127.0.0.1:8000'},{origin:'https://10.0.0.1'},
    {requestHeaders:['payment-signature']},{requestHeaders:['authorization']},{requestHeaders:['cookie']},
    {headerEnv:{'payment-response':'TOKEN'}},{headerEnv:{Authorization:'MISSING'}},{responseHeaders:['set-cookie']}]) {
    assert.throws(() => compileUpstreamBindings(document({api:{...valid,...override}}),{env:{TOKEN:'fake'}}));
  }
  const compiled = compileUpstreamBindings(document({api:valid}));
  assert.throws(() => validateUpstreamService({routes:[{path:'/api/:different',handler:'api',definition:{method:'GET'}}]},compiled));
  assert.throws(() => validateUpstreamService({routes:[{path:'/api/:item',handler:'api',definition:{method:'GET'},admit:'api'}]},compiled));
  let resolutions = 0;
  const handlers = createUpstreamHandlers(document({api:valid}),{lookup:async () => {
    resolutions++;return [{address:'127.0.0.1',family:4}];
  }});
  assert.equal(resolutions,0);
  assert.equal((await handlers.api(context('/api/ok',{pathParams:{item:'..'}}))).status,400);
  assert.equal(resolutions,0,'invalid path fails before DNS');
  assert.equal((await handlers.api(context('/api/ok',{pathParams:{item:'ok'}}))).status,502);
  assert.equal(resolutions,1,'private DNS fails before socket creation');
});
