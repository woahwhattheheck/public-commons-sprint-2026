import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BazaarCatalog,isValidRouteTemplate,sanitizeResourceServiceMetadata,createDiscoveryServer,validateCatalogEntry } from '../src/catalog.mjs';
const schema={type:'object',properties:{input:{type:'object'}},required:['input']};
const entry = (name,type='http',i={}) => ({
  resource:{url:`https://example.org/${name}`,description:`${name} forecast for cities`,serviceName:'Weather API',tags:['Weather','weather','Forecast']},
  accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'GTESTADDRESS'}],
  extensions:{bazaar:{info:{input: type==='http' ? {type,method:'GET',...i} : {type,toolName:name,inputSchema:{type:'object'},...i},output:{type:'json'}},schema}}
});
test('x402 template safety including percent-decoded traversal',()=>{
  for(const s of ['/users/:id','/weather/:country/:city','/v1/test']) assert.equal(isValidRouteTemplate(s),true);
  for(const s of ['../x','/users/../admin','/a/%2e%2e/b','/http://bad','/http%3a%2f%2fevil','/%oops']) assert.equal(isValidRouteTemplate(s),false);
});
test('metadata soft-drop and dedup exact ASCII behavior',()=>{
  const r=sanitizeResourceServiceMetadata({serviceName:'Good',tags:['A','a','B',123,'C','D','E','F'],iconUrl:'http://127.0.0.1/icon'});
  assert.deepEqual(r.tags,['A','B','C','D','E']);assert.equal(r.iconUrl,undefined);
  assert.equal(sanitizeResourceServiceMetadata({iconUrl:'http://%31%32%37.0.0.1/a'}).iconUrl,undefined);
  assert.equal(sanitizeResourceServiceMetadata({serviceName:'☃'}).serviceName,undefined);
});
test('HTTP templates dedup, MCP tools distinct at the same resource URL',()=>{
  const c = new BazaarCatalog(); const a=entry('users/123');
  a.extensions.bazaar.routeTemplate='/users/:id'; c.insertValidated(a);
  const b=entry('users/456');b.extensions.bazaar.routeTemplate='/users/:id';c.insertValidated(b);
  assert.equal(c.size,1);
  const x=entry('mcp','mcp',{toolName:'weather'});x.resource.url='https://example.org/mcp';c.insertValidated(x);
  const y=entry('mcp','mcp',{toolName:'forecast'});y.resource.url='https://example.org/mcp';c.insertValidated(y);
  assert.equal(c.size,3);assert.equal(c.list(new URLSearchParams('type=mcp')).resources.length,2);
});
test('filters apply to actual payment accepts and extension types',()=>{
  const c=new BazaarCatalog(); c.insertValidated(entry('weather'));c.insertValidated(entry('image','mcp'));
  assert.equal(c.list(new URLSearchParams('network=stellar:testnet&scheme=exact&payTo=GTESTADDRESS&extensions=bazaar')).resources.length,2);
  assert.equal(c.list(new URLSearchParams('network=stellar:pubnet')).resources.length,0);
  assert.equal(c.list(new URLSearchParams('type=mcp')).resources.length,1);
});
test('natural-language relevance and cursor stable, invalidated on insertion',()=>{
  const c=new BazaarCatalog();c.insertValidated(entry('weather'));c.insertValidated(entry('traffic'));c.insertValidated(entry('weather-alerts','mcp'));
  const first=c.search(new URLSearchParams('query=weather&limit=1'));
  assert.equal(first.resources.length,1);assert.equal(first.partialResults,true);
  const next=c.search(new URLSearchParams('query=weather&limit=1&cursor='+encodeURIComponent(first.pagination.cursor)));
  assert.equal(next.resources.length,1);assert.notDeepEqual(next.resources,first.resources);
  assert.throws(()=>c.search(new URLSearchParams('query=traffic&cursor='+first.pagination.cursor)),RangeError);
  c.insertValidated(entry('new'));assert.throws(()=>c.search(new URLSearchParams('query=weather&cursor='+first.pagination.cursor)),RangeError);
});
test('public endpoints read-only and return concrete machine errors',async()=>{
  const catalog=new BazaarCatalog();catalog.insertValidated(entry('rain'));
  const server=createServer(createDiscoveryServer(catalog));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const root=`http://127.0.0.1:${server.address().port}`;
    const list=await fetch(root+'/discovery/resources?type=http');assert.equal((await list.json()).resources.length,1);
    const search=await fetch(root+'/discovery/search?query=rain');assert.equal((await search.json()).resources.length,1);
    const invalid=await fetch(root+'/discovery/search');assert.equal(invalid.status,400);assert.ok((await invalid.json()).reason);
    const post=await fetch(root+'/discovery/resources',{method:'POST'});assert.equal(post.status,405);
  }finally {await new Promise(resolve=>server.close(resolve));}
});

// SF-39 cross-module route guard: legacy one-decode catalog used to accept
// double-encoded traversal that the existing SF-28 identity module rejects.
test('SF-39 rejects repeated encoding and canonicalizes safe route aliases', () => {
  for (const unsafe of ['/weather/%252e%252e/admin', '/weather/%252fadmin', '/weather/%25252e%25252e/admin']) {
    assert.equal(isValidRouteTemplate(unsafe), false, unsafe);
  }
  assert.equal(isValidRouteTemplate('/cities/:city'), true);
  assert.equal(isValidRouteTemplate('/cities/%3Acity'), true);

  const catalog = new BazaarCatalog();
  const one = entry('cities/louisville');
  one.extensions.bazaar.routeTemplate = '/cities/:city';
  catalog.insertValidated(one);
  const two = entry('cities/indy');
  two.extensions.bazaar.routeTemplate = '/cities/%3Acity';
  catalog.insertValidated(two);
  assert.equal(catalog.size, 1, 'safe percent-encoded aliases share one catalog identity');
  assert.equal(catalog.list().resources[0].extensions.bazaar.routeTemplate, '/cities/:city');

  const fallback = entry('cities/safe');
  fallback.extensions.bazaar.routeTemplate = '/cities/%252e%252e/admin';
  const parsed = validateCatalogEntry(fallback);
  assert.equal(parsed.entry.extensions.bazaar.routeTemplate, undefined, 'hostile template must not be published');
  assert.equal(parsed.id.includes('%252e%252e'), false);
});

test('SF-39 checks raw resource URL before URL parser dot-segment normalization', () => {
  const catalog = new BazaarCatalog();
  for (const url of [
    'https://example.org/weather/%2e%2e/admin',
    'https://example.org/weather/%252e%252e/admin',
    'https://example.org/weather/%252fadmin',
    'https://example.org/weather/../admin',
  ]) {
    const sample = entry('weather');
    sample.resource.url = url;
    assert.throws(() => catalog.insertValidated(sample), /Invalid resource URL/, url);
  }
  assert.equal(catalog.size, 0, 'rejections cannot mutate the public catalog');
});
