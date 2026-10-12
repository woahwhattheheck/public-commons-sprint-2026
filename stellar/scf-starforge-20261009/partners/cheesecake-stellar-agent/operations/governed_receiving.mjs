#!/usr/bin/env node
/**
 * MIT. One complete receiving exercise using the original application, MCP SDK,
 * quote/result SQLite stores and SF36 governor. The original handoff is an input.
 * The provider and payment payloads are explicit local integration fixtures.
 *
 * node operations/governed_receiving.mjs --handoff ORIGINAL_PRIVATE_HANDOFF --work NEW_PRIVATE_DIRECTORY --python ABSOLUTE_PYTHON
 * Retains the full resulting application/state and receiving.json in --work.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat,lstat,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {createGovernedNativeMcpOperator} from '../../../../../stellar-forge/mcp-paid-agent/native-spend-governor.mjs';
import {inspectHandoff} from '../application.mjs';
import {loadApplication} from '../configuration.mjs';
import {initializeInstalledApplication,inspectInstalledApplication,startInstalledApplication} from '../installed.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const endpoint='https://merchant.example/mcp';
const payer='GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const payTo='GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const asset='CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ';
const network='stellar:testnet';
const accepted={scheme:'exact',network,asset,payTo,amount:'60',maxTimeoutSeconds:60,
  extra:{areFeesSponsored:true,paymentFlow:'authorization',description:'Original complete option café 😀'}};
const inputSchema={type:'object',properties:{mode:{type:'string',enum:['paid','free','cancel','revoked']}},
  required:['mode'],additionalProperties:false};
const largeText='café 😀 '.repeat(110000);
const transaction='a'.repeat(64);
const control={configured:false,authorized:true,opens:0,approvals:0,signing:0,protocolCalls:0,
  unsigned:0,signed:0,approvalWaiting:false,approvalAborted:false,work:null,python:null,keys:null};

export async function authorizeFixture({context}) {
  return control.authorized && context.subject==='receiving:operator';
}
async function providerFixture(input,init={}) {
  assert.ok(control.configured);
  const url=new URL(input instanceof Request?input.url:input);
  if(url.href!==endpoint) return new Response(JSON.stringify({resources:[{
    resource:{url:endpoint},accepts:[accepted],
    extensions:{bazaar:{info:{input:{type:'mcp',toolName:'read_record',transport:'streamable-http',inputSchema}}}},
  }],pagination:{hasMore:false}}),{headers:{'content-type':'application/json'}});
  control.protocolCalls++;
  if(String(init.method??'GET').toUpperCase()==='DELETE')return new Response(null,{status:204});
  if(String(init.method??'GET').toUpperCase()==='GET')return new Response(null,{status:405});
  const rpc=JSON.parse(init.body);
  let result;
  if(rpc.method==='initialize') result={protocolVersion:rpc.params.protocolVersion,
    capabilities:{tools:{}},serverInfo:{name:'original-sdk-receiving-fixture',version:'1'}};
  else if(rpc.method==='notifications/initialized') return new Response(null,{status:202});
  else if(rpc.method==='tools/list') result={tools:[{name:'read_record',inputSchema}]};
  else if(rpc.method==='tools/call') {
    assert.equal(rpc.params.name,'read_record');
    const mode=rpc.params.arguments.mode,payment=rpc.params._meta?.['x402/payment'];
    if(payment){control.signed++;assert.deepEqual(payment.accepted,accepted);}
    else control.unsigned++;
    if(mode==='paid'&&!payment) result={isError:true,content:[{type:'text',text:'Payment required'}],
      structuredContent:{x402Version:2,resource:{url:endpoint},accepts:[accepted]}};
    else result={content:[{type:'text',text:largeText}],structuredContent:{mode,complete:true},
      ...(payment?{_meta:{'x402/payment-response':{success:true,network,transaction}}}:{})};
  } else throw new Error('Unexpected original SDK request: '+rpc.method);
  const raw=JSON.stringify({jsonrpc:'2.0',id:rpc.id,result});
  return new Response(raw,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(raw))}});
}
export async function openFixtureOperator() {
  assert.ok(control.configured);control.opens++;
  const sdk={versions:{core:'receiving-fixture',stellar:'receiving-fixture'},
    ExactStellarScheme:class{},
    x402Client:class{
      constructor(select){this.select=select;}
      register(){}
      setSpendControls(){}
      async createPaymentPayload(required){
        control.signing++;
        return{x402Version:2,accepted:this.select(2,required.accepts),resource:required.resource,
          payload:{integrationFixture:true}};
      }
    }};
  const operator=await createGovernedNativeMcpOperator({
    spending:{python:control.python,actor:'receiving-operator',service:'cheesecake-application',
      policy:join(control.work,'policy.json'),ledger:join(control.work,'spending.sqlite'),
      stateDirectory:join(control.work,'governed'),environment:control.keys},
    payer,signer:{address:payer,signAuthEntry(){throw new Error('Fixture payment has no live signer.');}},
    sdk,rpcUrl:'https://soroban-testnet.stellar.org',
    limits:{network,asset,payTo,maxAtomic:'60',maxTimeoutSeconds:60},
    approveQuote:async quote=>{
      control.approvals++;assert.equal(quote.limits.aggregate.approved,true);
      if(quote.invocation.arguments.mode==='revoked'){control.authorized=false;return true;}
      if(quote.invocation.arguments.mode!=='cancel')return true;
      control.approvalWaiting=true;
      return new Promise(resolveApproval=>{
        const abort=()=>{control.approvalAborted=true;resolveApproval(false);};
        if(quote.signal.aborted)abort();
        else quote.signal.addEventListener('abort',abort,{once:true});
      });
    },
  });
  return {...operator,fetchImpl:providerFixture};
}
async function waitUntil(condition) {
  const expires=Date.now()+10000;
  while(!condition()){assert.ok(Date.now()<expires,'Original approval did not become ready.');
    await new Promise(done=>setTimeout(done,10));}
}
function argumentsFor(args) {
  assert.equal(args.length%2,0);
  const out={};
  for(let i=0;i<args.length;i+=2){
    assert.ok(['--handoff','--work','--python'].includes(args[i])&&!out[args[i]]);
    assert.ok(isAbsolute(args[i+1])&&resolve(args[i+1])===args[i+1]);out[args[i]]=args[i+1];
  }
  assert.ok(out['--handoff']&&out['--work']&&out['--python']);return out;
}
export async function main(args=process.argv.slice(2)) {
  const o=argumentsFor(args),work=o['--work'],handoff=o['--handoff'];
  assert.equal(await realpath(handoff),handoff);
  const original=await inspectHandoff(handoff),httpIds=[...original.requests.keys()];
  assert.ok(httpIds.length>0);
  await mkdir(work,{mode:0o700});
  const privateParent=await lstat(work);assert.equal(privateParent.mode&0o077,0);
  Object.assign(control,{configured:true,work,python:o['--python'],
    keys:Object.fromEntries(['CONSENT','AUDIT','OPERATOR'].map(name=>['SF36_'+name+'_KEY_B64',randomBytes(32).toString('base64')]))});
  // Preserve fixture keys privately with this retained local integration case.
  await writeFile(join(work,'fixture-environment.json'),JSON.stringify(control.keys),{mode:0o600,flag:'wx'});
  await writeFile(join(work,'policy.json'),JSON.stringify({schema:'stellar-spend-governor/v1',
    assets:[{network,asset,max_single:'100',max_total:'1000',max_per_utc_day:'1000',
      max_per_actor_utc_day:'1000',max_per_service_utc_day:'1000'}]}),{mode:0o600,flag:'wx'});
  const operatorModule=join(work,'receiving-operator.mjs');
  await writeFile(operatorModule,'import {openFixtureOperator,authorizeFixture} from '+
    JSON.stringify(import.meta.url)+';\nexport const openOperator=openFixtureOperator;\nexport const authorize=authorizeFixture;\n',
    {mode:0o600,flag:'wx'});
  const remoteFile=join(work,'remote-mcp.json');
  await writeFile(remoteFile,JSON.stringify({schema:'stellar-forge.application-remote-mcp.v1',
    discoveryUrl:'https://merchant.example',allowedResourceOrigins:['https://merchant.example'],
    operatorModule,timeoutMs:30000,
    requests:['paid','free','cancel','revoked'].map(mode=>({intentId:'remote-'+mode,
      label:mode+' original receiving',query:'read_record',endpoint,toolName:'read_record',
      transport:'streamable-http',paymentResourceUrl:endpoint,arguments:{mode},acceptedTerms:accepted}))}),
    {mode:0o600,flag:'wx'});
  let loaded,server;
  try {
    const prepared=await initializeInstalledApplication({directory:join(work,'application'),
      applicationId:'cheesecake-governed-receiving',subject:'receiving:operator',handoffDirectory:handoff,
      authorizationModule:operatorModule,remoteMcp:remoteFile});
    assert.equal(control.opens,0);
    assert.equal((await stat(prepared.configFile)).mode&0o077,0);
    assert.equal((await inspectInstalledApplication(prepared.configFile)).selectionSha256,prepared.selectionSha256);
    loaded=await loadApplication(prepared.configFile);
    assert.equal(control.opens,1);
    const app=loaded.application,context=loaded.context;
    const listed=await app.requests(context);
    assert.equal(listed.requests.length,httpIds.length+4);
    await assert.rejects(app.requests({subject:'another:operator'}),{code:'APPLICATION_AUTHORIZATION_DENIED'});
    const originalReviews=[];
    for(const intent of httpIds){
      const view=await app.call(context,'review',intent);
      assert.equal(view.binding.bodySha256,original.requests.get(intent).view.bodySha256);
      originalReviews.push({intentId:intent,bodySha256:view.binding.bodySha256});
    }
    for(const mode of ['paid','free','cancel','revoked']){
      const view=await app.call(context,'review','remote-'+mode);
      assert.equal(view.request.bodyText,JSON.stringify({mode}));
      assert.equal(view.review.spending.outcome,'NOT_RESERVED');
    }
    const pending=app.call(context,'execute','remote-cancel');
    await waitUntil(()=>control.approvalWaiting);
    assert.equal((await app.call(context,'cancel','remote-cancel')).operation.state,'CANCELLED');
    await pending.catch(error=>assert.ok(['APPLICATION_AUTHORIZATION_DENIED','ABORT_ERR'].includes(error.code)||error.name==='AbortError'));
    assert.equal(control.approvalAborted,true);
    assert.equal(control.signing,0);
    await app.call(context,'execute','remote-revoked').catch(error=>assert.equal(error.code,'APPLICATION_AUTHORIZATION_DENIED'));
    assert.equal(control.authorized,false);control.authorized=true;
    assert.equal((await app.call(context,'status','remote-revoked')).operation.state,'CANCELLED');
    assert.equal(control.signing,0);
    const free=await app.call(context,'execute','remote-free');
    assert.equal(free.operation.state,'FREE_SUCCESS');
    assert.equal((await app.call(context,'spending','remote-free')).spending.outcome,'NOT_RESERVED');
    const paid=await app.call(context,'execute','remote-paid');
    assert.equal(paid.operation.state,'CONFIRMED_BY_SERVER');
    assert.equal(control.signing,1);
    assert.equal(control.signed,1);
    const spending=await app.call(context,'spending','remote-paid');
    assert.equal(spending.spending.reservation.amount,'60');
    const saved=await app.call(context,'read','remote-paid',{format:'json'});
    assert.equal(saved.data.content[0].text,largeText);
    assert.ok(saved.result.file.bytes>1048576);
    const destination=join(work,'complete-native-result.json');
    const exported=await app.call(context,'export','remote-paid',{destination});
    const bytes=await readFile(destination);
    assert.equal(bytes.length,saved.result.file.bytes);
    assert.equal(hash(bytes),saved.result.file.sha256);
    assert.equal(exported.exported.sha256,saved.result.file.sha256);
    await loaded.close();loaded=null;
    loaded=await loadApplication(prepared.configFile);
    assert.equal(control.opens,2);
    const recovered=await loaded.application.call(loaded.context,'recover','remote-paid');
    assert.equal(recovered.binding.quoteId,paid.binding.quoteId);
    assert.equal(recovered.result.delivery.sha256,saved.result.file.sha256);
    assert.equal((await loaded.application.call(loaded.context,'spending','remote-paid')).spending.reservation.amount,'60');
    assert.equal(control.signing,1);
    await loaded.close();loaded=null;
    const token=randomBytes(24).toString('hex');
    server=await startInstalledApplication({configFile:prepared.configFile,
      expectedSelectionSha256:prepared.selectionSha256,bearerToken:token,port:0});
    assert.equal(control.opens,3);
    assert.equal(server.startup.stateDirectory,prepared.stateDirectory);
    assert.equal(server.startup.sourceDirectory,prepared.applicationDirectory);
    assert.equal(server.startup.launchSourceDirectory,prepared.applicationDirectory);
    assert.equal(server.startup.runtimeDirectory,prepared.runtimeDirectory);
    const headers={authorization:'Bearer '+token,'content-type':'application/json'};
    const listing=await fetch(server.origin+'/api/requests',{headers});
    assert.equal(listing.status,200);assert.equal((await listing.json()).requests.length,httpIds.length+4);
    const download=await fetch(server.origin+'/api/requests/remote-paid/download',{headers});
    assert.equal(download.status,200);
    assert.equal(hash(Buffer.from(await download.arrayBuffer())),saved.result.file.sha256);
    const mcp=await fetch(server.origin+'/mcp',{method:'POST',
      headers:{...headers,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},
      body:JSON.stringify({jsonrpc:'2.0',id:'native-receiving',method:'tools/call',
        params:{name:'stellar_request_read',arguments:{intentId:'remote-paid',format:'file'}}})});
    assert.equal(mcp.status,200);
    const result=await mcp.json();assert.equal(result.result.isError,false);
    assert.equal(result.result.structuredContent.result.file.sha256,saved.result.file.sha256);
    await server.close();server=null;
    const sourcePaths=['application.mjs','configuration.mjs','remote-mcp.mjs','server.mjs','cli.mjs','installed.mjs','ui/app.js'];
    const files=await Promise.all(sourcePaths.map(async path=>({path,sha256:hash(await readFile(new URL('../'+path,import.meta.url)))})));
    const report={outcome:'PASS',operation:'cheesecake-governed-receiving-f232-20261012',
      scope:'original application/MCP SDK/SQLite/SF36 with local provider and payment fixtures',
      node:process.version,python:control.python,originalHandoffId:original.manifest.handoffId,
      originalReviews,remoteRequests:4,signingCalls:control.signing,signedCalls:control.signed,
      reservedAmount:'60',resultBytes:bytes.length,resultSha256:hash(bytes),
      factoryInstances:control.opens,approvalCancellation:true,grantRevocation:true,
      originalRestartQuoteId:paid.binding.quoteId,httpDownload:true,mcpRead:true,
      sourceFiles:files,workspace:work};
    await writeFile(join(work,'receiving.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
    process.stdout.write(JSON.stringify(report)+'\n');return report;
  }finally{await server?.close();await loaded?.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({outcome:'FAILED',code:error.code??error.name,
    message:error.message,stack:error.stack})+'\n');process.exitCode=1;});
