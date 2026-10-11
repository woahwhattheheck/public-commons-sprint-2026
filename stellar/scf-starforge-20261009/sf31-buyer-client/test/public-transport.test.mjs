// MIT. Original SF31 + actual loopback TLS; never a public seller/payment test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicHttpsFetch, isPublicAddress } from '../public-transport.mjs';
import { createPublicBuyer } from '../public-buyer.mjs';
import { X402BuyerClient } from '../buyer.mjs';
const origin = 'https://merchant.example';
const publicDNS = [{address:'8.8.8.8',family:4}]; // Never dial this fixture address.
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');

test('public address policy, mixed answers, framing and abort-before-connect', async () => {
  for (const ip of ['0.1.2.3','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254',
    '172.31.0.1','192.0.0.9','192.0.2.1','192.168.2.1','198.18.0.1','198.51.100.1',
    '203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8','64:ff9b::808:808',
    'fc00::1','fe80::1','2001::1','2001:db8::1','2002:7f00:1::','3fff::1','2606:4700::1%eth0'])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])
    assert.equal(isPublicAddress(ip), true, ip);
  let connects=0, resolutions=0;
  const neverConnect = () => { connects++; throw Error('Unexpected connection'); };
  const guarded = createPublicHttpsFetch({lookup:async () => {
    resolutions++; return [...publicDNS,{address:'127.0.0.1',family:4}];
  }, requestImpl:neverConnect});
  await assert.rejects(guarded(origin), {code:'NONPUBLIC_DNS_ANSWER'});
  for (const url of ['https://127.0.0.1','https://2130706433','https://api.internal','http://merchant.example'])
    await assert.rejects(guarded(url));
  await assert.rejects(guarded(origin,{headers:{host:'private.example'}}), {code:'FORBIDDEN_TRANSPORT_HEADER'});
  await assert.rejects(guarded(origin,{redirect:'follow'}), {code:'UNSUPPORTED_FETCH_OPTION'});
  const cancelled = AbortSignal.abort(Error('operator cancelled'));
  await assert.rejects(guarded(origin,{signal:cancelled}), /operator cancelled/);
  const deadline = createPublicHttpsFetch({timeoutMs:25, lookup:() => new Promise(() => {}), requestImpl:neverConnect});
  await assert.rejects(deadline(origin), {code:'PUBLIC_HTTPS_TIMEOUT'});
  assert.equal(connects,0); assert.equal(resolutions,1);
  assert.throws(() => createPublicBuyer({allowLocal:true}), /Only timeoutMs/);
});

test('pinned options, real TLS identity, native discovery and original one-retry buyer', async t => {
  const dir=mkdtempSync(join(tmpdir(),'sf31-tls-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-subj','/CN=merchant.example','-addext','subjectAltName=DNS:merchant.example',
    '-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')],{stdio:'ignore'});
  const cert=readFileSync(join(dir,'cert.pem'));
  const hits=[], pins=[];
  const terms={scheme:'exact',network:'stellar:testnet',asset:'fixture-asset',payTo:'fixture-recipient',amount:'5',maxTimeoutSeconds:60};
  const challenge={x402Version:2,resource:{url:origin+'/paid'},accepts:[terms]};
  const server=createServer({key:readFileSync(join(dir,'key.pem')),cert}, async (req,res) => {
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    hits.push({path:req.url,method:req.method,host:req.headers.host,sni:req.socket.servername,
      body:Buffer.concat(chunks).toString(),signature:req.headers['payment-signature']});
    if (req.url.startsWith('/discovery/')) {
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({items:[{resource:origin+'/paid',accepts:[terms]}],pagination:{total:1,limit:20,offset:0}}));
    } else if (req.url.startsWith('/identity')) {
      res.writeHead(402,{'PAYMENT-REQUIRED':encode({...challenge,resource:{url:origin+req.url}})}); res.end();
    } else if (req.url === '/paid' && !req.headers['payment-signature']) {
      res.writeHead(402,{'PAYMENT-REQUIRED':encode(challenge)}); res.end();
    } else if (req.url === '/paid') {
      res.writeHead(200,{'PAYMENT-RESPONSE':encode({network:terms.network,success:false,
        transaction:'a'.repeat(64),errorReason:'settlement_pending'})}); res.end('local TLS fixture, not a ledger');
    } else if (req.url === '/redirect') { res.writeHead(302,{location:'https://private.internal'}); res.end(); }
    else if (req.url === '/slow') { res.writeHead(200); res.write('start'); }
    else if (req.url === '/encoded') { res.setHeader('content-encoding','gzip'); res.end('not accepted'); }
    else if (req.url === '/large') { res.writeHead(200,{'content-length':String(300_000)}); res.write('x'); }
    else { res.writeHead(404); res.end(); }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  let resolutions=0;
  const lookup=async (host,opts) => { resolutions++; assert.equal(opts.all,true); assert.equal(opts.verbatim,true); return publicDNS; };
  // Trusted test seam: inspect the production pin, then remap ONLY the socket
  // to our loopback server and trust its temporary cert. Production has neither override.
  const localRequest=(opts,callback) => {
    assert.equal(opts.agent,false); assert.equal(opts.rejectUnauthorized,true);
    assert.equal(opts.servername,opts.hostname); assert.equal(opts.autoSelectFamily,false);
    const before=resolutions;
    opts.lookup(opts.hostname,{},(err,ip,family) => { assert.ifError(err); pins.push(ip); assert.equal(family,4); });
    opts.lookup(opts.hostname,{all:true},(err,rows) => { assert.ifError(err); assert.deepEqual(rows,publicDNS); });
    assert.equal(resolutions,before);
    return request({...opts,port:server.address().port,ca:cert,
      headers:{...opts.headers,host:opts.hostname},
      lookup:(_host,_options,cb) => cb(null,'127.0.0.1',4)},callback);
  };
  const transport=createPublicHttpsFetch({lookup,requestImpl:localRequest,timeoutMs:2000});
  const buyer=new X402BuyerClient({fetchImpl:transport});
  const catalog=await buyer.discover({origin});
  assert.equal(catalog.sourceEnvelope,'items'); assert.deepEqual(catalog.resources[0].accepts,[terms]);
  let approvals=0, signatures=0;
  const result=await buyer.call({url:origin+'/paid',method:'POST',body:'{"q":"value"}',
    expect:{...terms,maxAtomic:'5'},approve:async intent => {
      approvals++; assert.equal(intent.bodyBytes,13); assert.deepEqual(intent.acceptedTerms,terms); return true;
    },sign:async ({challenge,accepted}) => {
      signatures++; return {...challenge,accepts:undefined,accepted,payload:{fixtureOnly:true}};
    }});
  assert.equal(result.status,'SETTLEMENT_PENDING'); assert.equal(result.attempts,2);
  assert.equal(approvals,1); assert.equal(signatures,1); await result.response.text();
  assert.equal(hits.length,3); assert.equal(resolutions,3);
  assert.equal(hits[1].signature,undefined); assert.ok(hits[2].signature);
  assert.equal(hits[1].body,hits[2].body);
  assert.ok(hits.every(row => row.host==='merchant.example' && row.sni==='merchant.example'));
  const redirect=await transport(origin+'/redirect'); assert.equal(redirect.status,302); await redirect.body.cancel();
  await assert.rejects(transport('https://wrong.example/'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
  assert.equal(hits.length,4); // Bad TLS identity produced no HTTP request.
  await assert.rejects(transport(origin+'/encoded'),{code:'UNSUPPORTED_CONTENT_ENCODING'});
  const slow=await createPublicHttpsFetch({lookup,requestImpl:localRequest,timeoutMs:100})(origin+'/slow');
  await assert.rejects(slow.text());
  const cancellation=await transport(origin+'/slow'); await cancellation.body.cancel();
  const oversized=new X402BuyerClient({fetchImpl:(url,init) => transport(origin+'/large',init)});
  await assert.rejects(oversized.discover({origin}),{code:'DISCOVERY_RESPONSE_TOO_LARGE'});
  // WHATWG URL.search is empty for both /identity and /identity?. The original
  // buyer binds href exactly, so the wire request must preserve the empty query.
  let identityApprovals=0;
  for (const suffix of ['', '?', '?city=New%20York&city=C%2B%2B&empty=']) {
    const url=origin+'/identity'+suffix;
    await assert.rejects(buyer.call({url,expect:{...terms,maxAtomic:'5'},
      approve:intent => { identityApprovals++; assert.equal(intent.url,url); return false; },
      sign:() => assert.fail('Identity check must not sign'),
    }),{code:'PAYMENT_NOT_APPROVED'});
    assert.equal(hits.at(-1).path,'/identity'+suffix);
  }
  assert.equal(identityApprovals,3);
  assert.ok(pins.every(ip => ip === '8.8.8.8'));
});
