// MIT. One source→original compiler→retained workspace→live seller journey.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createSourceBundle, openSourceBundle, sourceBundleDigest } from './source-bundle.mjs';
import { captureSourceBundle, saveSourceBundle, extractSourceBundle } from './source-bundle-files.mjs';
import { parseOpenApiSource } from './source-document.mjs';
import { importOpenApi, createOpenApiResolver } from './importer.mjs';
import { run as originalCLI } from './cli.mjs';
import { readPackage, prepareMerchant } from './workspace/model.mjs';
import { startWorkspace } from './workspace/server.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const root = await mkdtemp(join(tmpdir(), 'starforge-source-bundle-'));
const sources = {
  'api/openapi.json': { openapi:'3.1.0', info:{title:'Station observations',version:'1.0'},
    servers:[{url:'https://backend.example.test/v1'}], paths:{'/stations/{station}':{$ref:'../paths/station.json'}},
    components:{schemas:{'x-Measurement':{$ref:'../schemas/station.json#/$defs/Measurement'}}},
    'x-payload':{$ref:'DO-NOT-OPEN.json'} },
  'paths/station.json': { get:{operationId:'stationReading',summary:'Read station measurement',
    parameters:[{$ref:'../parameters/station.json'}],responses:{'200':{$ref:'../responses/station.json'}}} },
  'parameters/station.json': {name:'station',in:'path',required:true,schema:{type:'string',example:'KLOU'}},
  'responses/station.json': {description:'Current measurement',content:{'application/json':{
    schema:{$ref:'../schemas/station.json#/$defs/Measurement'},examples:{'x-measurement':{$ref:'../examples/measurement.json'}}}}},
  'schemas/station.json': {$defs:{Measurement:{type:'object',properties:{station:{type:'string'},temperature:{type:'number'},
    'x-quality':{$ref:'#/$defs/Quality'}},required:['station','temperature','x-quality'],additionalProperties:false},
    Quality:{type:'string',enum:['observed','estimated'],default:'observed'}}},
  'examples/measurement.json': {summary:'Protocol-shaped data',value:{station:'KLOU',temperature:21,'x-quality':'observed',
    $ref:'DATA-ONLY.json',nested:{default:{$ref:'ALSO-DATA.json'}}}}
};
const terms = {scheme:'exact',network:'stellar:testnet',amount:'20000',asset:'DEMO_NONPAYABLE_ASSET',
  payTo:'DEMO_NONPAYABLE_RECIPIENT',maxTimeoutSeconds:60};
const selections = [{method:'GET',path:'/stations/{station}',accepts:[terms,{...terms,amount:'30000',maxTimeoutSeconds:90}]}];
const plan = {schema:'stellar-forge.api-merchant-plan.v1',sellerServer:'https://merchant.example.test/data',
  serviceName:'Station observations',payment:{network:terms.network,asset:terms.asset,payTo:terms.payTo,maxTimeoutSeconds:60},
  operations:[{method:'GET',path:'/stations/{station}',id:'station',amountAtomic:'20000',responseValidation:'declared'}]};
let workspace;
try {
  const sourceRoot=join(root,'source');
  for(const [name,value]of Object.entries(sources)) {
    const path=join(sourceRoot,name);await mkdir(dirname(path),{recursive:true,mode:0o700});
    // Preserve BOM, CRLF and exact spaces, not a normalized reserialization.
    const text=name==='api/openapi.json'?'\uFEFF'+json(value).replaceAll('\n','\r\n'):json(value);
    await writeFile(path,text,{mode:0o600});
  }
  const captured=captureSourceBundle({root:sourceRoot,entry:'api/openapi.json'});
  assert.equal(captured.bundle.sources.length,6);assert.equal(captured.summary.references.length,7);
  assert.equal(captured.document['x-payload'].$ref,'DO-NOT-OPEN.json');
  const opened=parseOpenApiSource(captured.text);
  assert.equal(opened.format,'json');assert.deepEqual(opened.document,captured.document);
  const refs=createOpenApiResolver(opened.document);
  const item=refs.reference(opened.document.paths['/stations/{station}']);
  const response=refs.reference(item.get.responses['200']);
  assert.deepEqual(refs.reference(response.content['application/json'].examples['x-measurement']).value,
    sources['examples/measurement.json'].value);
  const compiled=importOpenApi(opened.document,selections);
  assert.deepEqual(compiled.offers[0].seller.accepts,selections[0].accepts);
  assert.equal(compiled.offers[0].seller.resource.url,'https://backend.example.test/v1/stations/KLOU');
  assert.equal(prepareMerchant(captured.text,plan).preview.routes.length,1);
  const packet=join(root,'source-bundle.json');
  const first=saveSourceBundle({root:sourceRoot,entry:'api/openapi.json',out:packet});
  assert.equal(first.reused,false);assert.equal(saveSourceBundle({root:sourceRoot,entry:'api/openapi.json',out:packet}).reused,true);
  if(process.platform!=='win32')assert.equal((await stat(packet)).mode&0o777,0o600);
  const restore=extractSourceBundle({bundle:packet,out:join(root,'restored')});
  for(const row of captured.bundle.sources)assert.deepEqual(await readFile(join(restore.sourceRoot,row.path)),Buffer.from(row.text));
  assert.equal(extractSourceBundle({bundle:packet,out:join(root,'restored')}).reused,true);
  assert.equal(captureSourceBundle({root:restore.sourceRoot,entry:captured.bundle.entry}).bundle.sourceDigest,captured.bundle.sourceDigest);
  await writeFile(join(restore.sourceRoot,'examples/measurement.json'),'operator edit\n');
  assert.throws(()=>extractSourceBundle({bundle:packet,out:join(root,'restored')}),/changed/);
  const damaged=structuredClone(captured.bundle);damaged.sources[0].text+=' ';
  assert.throws(()=>openSourceBundle(damaged),/INTEGRITY/);
  const duplicate=structuredClone(captured.bundle);duplicate.sources.push(duplicate.sources[0]);
  assert.throws(()=>openSourceBundle(duplicate),/DUPLICATE/);
  const small={openapi:'3.1.0',paths:{'/x':{$ref:'next.json'}},info:{title:'References',version:'1'}};
  for(const ref of ['https://example.test/path.json','../../outside.json','schema.json#NamedAnchor']) {
    const text=json({...small,paths:{'/x':{$ref:ref}}});
    assert.throws(()=>createSourceBundle({entry:'root.json',readSource:path=>path==='root.json'?text:'{}'}),/LOCAL_ONLY|SOURCE_PATH|SOURCE_POINTER/);
  }
  const cycle=createSourceBundle({entry:'root.json',readSource:path=>json(path==='root.json'?small:{$ref:'next.json'})});
  assert.equal(cycle.summary.targets,1);
  assert.throws(()=>importOpenApi(cycle.document,[{method:'GET',path:'/x',accepts:[terms]}]),/Recursive reference/);
  const legacy = {openapi:'3.0.3',info:{title:'Legacy reference semantics',version:'1'},servers:[{url:'https://backend.example.test/'}],
    paths:{'/x':{get:{parameters:[{name:'city',in:'query',schema:{$ref:'field.json',$id:'https://ignored.test/',
      properties:{ignored:{$ref:'https://ignored.test/never.json'}}}}],responses:{'200':{description:'OK'}}}}}};
  const legacyBundle=createSourceBundle({entry:'legacy.json',readSource:path=>path==='legacy.json'?json(legacy):
    path==='field.json'?json({type:'string',example:'Louisville'}):assert.fail('Ignored sibling was fetched')});
  assert.equal(legacyBundle.bundle.sources.length,2);
  assert.equal(importOpenApi(legacyBundle.document,[{method:'GET',path:'/x',accepts:[terms]}]).offers.length,1);
  await symlink(join(sourceRoot,'parameters/station.json'),join(sourceRoot,'parameters/link.json'));
  const malicious=structuredClone(sources['paths/station.json']);malicious.get.parameters=[{$ref:'../parameters/link.json'}];
  await writeFile(join(sourceRoot,'paths/station.json'),json(malicious));
  assert.throws(()=>captureSourceBundle({root:sourceRoot,entry:'api/openapi.json'}),/SYMLINK/);
  await writeFile(join(sourceRoot,'paths/station.json'),json(sources['paths/station.json']));
  await writeFile(join(root,'selections.json'),json(selections));
  await originalCLI(['source','inspect','--bundle',packet]);
  await originalCLI(['--spec',packet,'--config',join(root,'selections.json'),'--out',join(root,'compiled')]);
  assert.deepEqual(JSON.parse(await readFile(join(root,'compiled/offers.json'),'utf8')),compiled);

  // Use the same HTTP endpoints and retained project as the shipped browser.
  const parent=join(root,'projects');await mkdir(parent,{mode:0o700});
  workspace=await startWorkspace({parent,noSignals:true});
  async function call(path,body) {
    const result=await fetch(workspace.origin+path,{method:body===undefined?'GET':'POST',
      headers:{'x-workspace-token':workspace.token,...(body===undefined?{}:{'content-type':'application/json',origin:workspace.origin})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    const value=await result.json();assert.equal(result.ok,true,JSON.stringify(value));return value;
  }
  const inspected=await call('/api/inspect',{specText:captured.text});assert.equal(inspected.operations.length,1);
  await call('/api/preview',{specText:captured.text,plan});
  await call('/api/save',{specText:captured.text,plan,name:'station-bundle'});
  const saved=await readPackage(parent,'station-bundle');assert.equal(saved.specText,captured.text);
  assert.equal(saved.manifest.files['original-openapi.json'],sourceBundleDigest(captured.text));
  const firstRuntime=await call('/api/start',{name:'station-bundle'});
  const challenge=await fetch(firstRuntime.seller+'/data/stations/KLOU');assert.equal(challenge.status,402);
  const required=JSON.parse(Buffer.from(challenge.headers.get('payment-required'),'base64').toString('utf8'));
  assert.equal(required.accepts[0].amount,'20000');
  assert.equal(required.resource.url,'https://merchant.example.test/data/stations/KLOU');
  const accepted=await call('/api/accept',{});assert.ok(accepted.acceptance);
  await call('/api/stop',{});
  const loaded=await call('/api/load?name=station-bundle');assert.equal(loaded.specText,captured.text);
  const secondRuntime=await call('/api/start',{name:'station-bundle'});
  const secondChallenge=await fetch(secondRuntime.seller+'/data/stations/KLOU');assert.equal(secondChallenge.status,402);
  assert.deepEqual(JSON.parse(Buffer.from(secondChallenge.headers.get('payment-required'),'base64').toString('utf8')),required);
  await call('/api/stop',{});
  console.log(JSON.stringify({result:'PASS',sourceFiles:6,referenceEdges:7,originalOffers:1,
    retainedWorkspace:'saved/reopened/restarted',liveChallenges:2,unpaidRouteAudit:'complete',sourceDigest:captured.bundle.sourceDigest}));
} finally {
  await workspace?.close();
  await rm(root,{recursive:true,force:true});
}
