import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectResourceURL, inspectRouteTemplate, resolveCatalogIdentity } from './identity.mjs';

const http=(resourceURL,routeTemplate,pathParams,method='GET')=>({
  resourceURL,routeTemplate,
  input:{type:'http',method,...(pathParams===undefined?{}:{pathParams})},
});

test('real template shape and bound path params collapse route variants',()=>{
  assert.deepEqual(inspectRouteTemplate('/weather/:country/:city'),{
    ok:true,canonicalPath:'/weather/:country/:city',paramNames:['country','city'],
  });
  const a=resolveCatalogIdentity(http('https://API.Example.com:443/weather/US/Boston?units=metric','/weather/:country/:city',{country:'US',city:'Boston'}));
  const b=resolveCatalogIdentity(http('https://api.example.com/weather/CA/Toronto?units=kelvin','/weather/:country/:city',{country:'CA',city:'Toronto'}));
  assert.equal(a.status,'accepted');
  assert.equal(a.catalogKey,'http|GET|https://api.example.com/weather/:country/:city');
  assert.equal(a.catalogKey,b.catalogKey);
});

test('HTTP method, host and nondefault port remain distinct',()=>{
  const a=resolveCatalogIdentity(http('https://api.example.com/v1/users/1','/v1/users/:id',{id:'1'}));
  const b=resolveCatalogIdentity(http('https://api.example.com/v1/users/1','/v1/users/:id',{id:'1'},'POST'));
  const c=resolveCatalogIdentity(http('https://api.example.com:8443/v1/users/1','/v1/users/:id',{id:'1'}));
  const d=resolveCatalogIdentity(http('https://alt.example.com/v1/users/1','/v1/users/:id',{id:'1'}));
  assert.notEqual(a.catalogKey,b.catalogKey);
  assert.notEqual(a.catalogKey,c.catalogKey);
  assert.notEqual(a.catalogKey,d.catalogKey);
});

test('multi-encoded traversal upstream already fixed stays rejected',()=>{
  for(const value of ['/users/%2e%2e/admin','/users/%252e%252e/admin','/users/%25252e%25252e/admin','/users/%253a%252f%252f/admin']) {
    assert.equal(inspectRouteTemplate(value).ok,false,value);
  }
});

test('invalid templates fall back to the concrete URL, not a payment denial',()=>{
  for(const path of ['/users/../admin','/users/%252e%252e/admin','/users/:id?x=1','https://evil.com','/x/:id/:id','/x/:9bad','/x/./y']) {
    const got=resolveCatalogIdentity(http('https://api.example.com/users/1',path));
    assert.equal(got.status,'fallback',path);
    assert.equal(got.resourceURL,'https://api.example.com/users/1');
  }
});

test('syntactically valid unrelated path cannot be substituted',()=>{
  const got=resolveCatalogIdentity(http('https://api.example.com/admin/42','/users/:id',{id:'42'}));
  assert.equal(got.status,'fallback');
  assert.equal(got.reason,'TEMPLATE_PATH_MISMATCH');
  assert.equal(got.catalogKey,'http|GET|https://api.example.com/admin/42');
  const wrong=resolveCatalogIdentity(http('https://api.example.com/users/42','/users/:id',{id:'99'}));
  assert.equal(wrong.status,'fallback');
  assert.equal(wrong.reason,'TEMPLATE_PARAMS_MISMATCH');
});

test('encoded separators, malformed escaping and double encoding rejected',()=>{
  assert.equal(inspectRouteTemplate('/users/%2f').reason,'TEMPLATE_ENCODED_SEPARATOR');
  assert.equal(inspectRouteTemplate('/users/%').reason,'TEMPLATE_INVALID_PERCENT_ENCODING');
  assert.equal(resolveCatalogIdentity(http('https://api.example.com/users/%2f','/users/:id')).reason,'RESOURCE_PATH_ENCODED_SEPARATOR');
  assert.equal(resolveCatalogIdentity(http('https://api.example.com/users/%zz','/users/:id')).reason,'RESOURCE_PATH_PERCENT_ENCODING');
});

test('raw dot paths caught before WHATWG URL parser normalizes them',()=>{
  for(const u of ['https://api.example.com/a/../admin','https://api.example.com/a/%2e%2e/admin','https://api.example.com/a/%252e%252e/admin']) {
    assert.equal(inspectResourceURL(u).reason,'RESOURCE_PATH_DOT_SEGMENT');
  }
});

test('userinfo, fragments, unsafe schemes and backslash parser rewrites rejected',()=>{
  for(const u of ['ftp://example.com/v1','https://attacker@api.example.com/v1','https://api.example.com/v1#frag','https:\\api.example.com/v1']) {
    assert.equal(inspectResourceURL(u).ok,false,u);
  }
});

test('MCP multiplexing must key URL and tool name',()=>{
  const url='https://mcp.example.com:443/tools';
  const a=resolveCatalogIdentity({resourceURL:url,input:{type:'mcp',toolName:'get_weather'}});
  const b=resolveCatalogIdentity({resourceURL:url,input:{type:'mcp',toolName:'get_forecast'}});
  assert.equal(a.status,'accepted'); assert.notEqual(a.catalogKey,b.catalogKey);
});

test('unknown methods and hostile tool identifiers reject',()=>{
  assert.equal(resolveCatalogIdentity(http('https://api.example.com/users/1',undefined,undefined,'TRACE')).reason,'HTTP_METHOD_INVALID');
  assert.equal(resolveCatalogIdentity({resourceURL:'https://api.example.com/mcp',input:{type:'mcp',toolName:'../../admin'}}).reason,'MCP_TOOL_NAME_INVALID');
});

test('static routes preserve query variation when no template is declared',()=>{
  const a=resolveCatalogIdentity(http('https://api.example.com/weather?region=1'));
  const b=resolveCatalogIdentity(http('https://api.example.com/weather?region=2'));
  assert.equal(a.status,'accepted'); assert.notEqual(a.catalogKey,b.catalogKey);
});

test('safe encoded unreserved route literal resolves canonically',()=>{
  const x=resolveCatalogIdentity(http('https://api.example.com/items/A','/items/%41'));
  assert.equal(x.status,'accepted'); assert.equal(x.canonicalRouteTemplate,'/items/A');
});

test('malicious template cannot overwrite an unrelated catalog record',()=>{
  const entries=new Map();
  const original=resolveCatalogIdentity(http('https://api.example.com/users/41','/users/:id',{id:'41'}));
  entries.set(original.catalogKey,{price:'1000',sellerVerified:true});
  const bad=resolveCatalogIdentity(http('https://api.example.com/admin/41','/users/:id',{id:'41'}));
  assert.notEqual(original.catalogKey,bad.catalogKey);
  assert.deepEqual(entries.get(original.catalogKey),{price:'1000',sellerVerified:true});
});
