// MIT. Native adapter contract exercise; supplied responses exercise protocol behavior locally.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const sourceDirectory=resolve(process.argv[2]),reportFile=process.argv[3]?resolve(process.argv[3]):null;
const {openPollarOperatorConnection}=await import(pathToFileURL(join(sourceDirectory,'native.mjs')).href);
const {POLLAR_NATIVE_ACTIONS}=await import(pathToFileURL(join(sourceDirectory,'catalogue.mjs')).href);
const app='pollar-contract-fixture',wallet='G'+'A'.repeat(55),token='fixture.access.token',key='sec_testnet_contract_fixture_only';
const calls=[],sections=[],sha=body=>createHash('sha256').update(body).digest('hex');
const actualTools=POLLAR_NATIVE_ACTIONS.filter(item=>item.tool).map(item=>({name:item.tool,inputSchema:structuredClone(item.inputSchema)}));
let behavior='normal',lastWrite=null;
function json(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});}
function frame(requestId,value,{cancelError=false}={}){
 const body=Buffer.from('id: result-'+requestId+'\r\nevent: message\r\ndata: '+JSON.stringify({jsonrpc:'2.0',id:requestId,result:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}})+'\r\n\r\n');
 const stream=new ReadableStream({start(controller){for(let i=0;i<body.length;i+=7)controller.enqueue(body.subarray(i,i+7));if(!cancelError)controller.close();},
 cancel(){if(cancelError)throw new Error('fixture stream close after complete result');}});
 return new Response(stream,{headers:{'content-type':'text/event-stream'}});
}
function primedDisconnect(){
 let count=0;return new Response(new ReadableStream({pull(controller){if(count++===0)controller.enqueue(Buffer.from('id: original-prime\r\n\r\n'));else controller.error(new Error('fixture disconnect after original cursor'));}}),{headers:{'content-type':'text/event-stream'}});
}
async function fetcher(url,options){
 const headers=new Headers(options.headers),body=options.body?JSON.parse(Buffer.from(options.body).toString('utf8')):null;
 calls.push({url,method:options.method,headers:Object.fromEntries(headers),body,bodyBytes:options.body?.length??0});
 if(url.startsWith('https://server.api.pollar.xyz/')){
  assert.equal(headers.get('x-pollar-api-key'),'sec_testnet_contract_fixture_server');
  if(url.endsWith('/v1/tokens/verify'))return json({success:true,code:'SERVER_TOKEN_VERIFIED',content:{userId:'fixture-user',applicationId:app,network:'testnet',expiresAt:'2099-01-01T00:00:00Z',wallet:{publicKey:wallet}},echo:body.token});
  if(url.endsWith('/v1/wallets/fund'))return behavior==='server-incomplete'?json({accepted:true}):json({success:true,code:'SERVER_WALLET_FUNDED',content:{publicKey:wallet,startingBalance:'10000.0000000'}});
  throw new Error('Unexpected original server fixture route '+url);
 }
 assert.equal(url,'https://mcp.api.pollar.xyz/mcp');
 assert.equal(headers.get('authorization'),'Bearer pat_contract_fixture_only');
 if(options.method==='GET'){
  assert.equal(headers.get('last-event-id'),'original-prime');assert.equal(options.body,undefined);
  return frame(lastWrite.id,{id:app,allowed_origins:lastWrite.params.arguments.allowed_origins});
 }
 if(body.method==='initialize')return json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:body.params.protocolVersion,capabilities:{tools:{listChanged:true}},serverInfo:{name:'local-original-contract-fixture',version:'1'}}},200,{'mcp-session-id':'private-contract-session'});
 assert.equal(headers.get('mcp-session-id'),'private-contract-session');assert.equal(headers.get('mcp-protocol-version'),'2025-11-25');
 if(body.method==='notifications/initialized')return new Response(null,{status:202});
 if(body.method==='tools/list'){
  if(body.params.cursor===undefined)return json({jsonrpc:'2.0',id:body.id,result:{tools:actualTools.slice(0,8),nextCursor:'original-page-two'}});
  assert.equal(body.params.cursor,'original-page-two');return json({jsonrpc:'2.0',id:body.id,result:{tools:actualTools.slice(8)}});
 }
 assert.equal(body.method,'tools/call');const {name,arguments:args}=body.params;
 if(name==='get_application_transactions'){
  const offset=args.offset??0,records=offset===0?[{id:'one',amount:'9007199254740993.0000001',note:'confirmé'},{id:'two',amount:'0.0000001'}]:[{id:'three',amount:'1.0000000'}];
  return frame(body.id,{records,total:3,limit:2,offset});
 }
 if(name==='create_api_key')return frame(body.id,{id:'fixture-key-id',apiKey:key,applicationId:app});
 if(name==='update_application_domains'){lastWrite=body;return primedDisconnect();}
 if(name==='get_application'){
  if(behavior==='unsafe-integer')return new Response('{"jsonrpc":"2.0","id":'+JSON.stringify(body.id)+',"result":{"structuredContent":{"ledger":9007199254740993},"content":[]}}',{headers:{'content-type':'application/json'}});
  if(behavior==='invalid-utf8')return new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}});
  return frame(body.id,{id:app,name:'Contract fixture'}, {cancelError:behavior==='complete-then-close-error'});
 }
 throw new Error('Unexpected original MCP fixture action '+name);
}
const connection={applicationId:app,network:'testnet',serverSecretKey:'sec_testnet_contract_fixture_server',personalAccessToken:'pat_contract_fixture_only',fetch:fetcher};
const client=await openPollarOperatorConnection({connection});
try{
 const declared=await client.catalog();assert.equal(Array.isArray(declared)?declared.length:declared.actions?.length??declared.tools?.length,22);
 const request=await client.prepare({action:'mcp.get_application_transactions',args:{id:app,limit:2,offset:0}});
 assert.equal(request.bodySha256,sha(Buffer.from(JSON.stringify(request.body))));
 const first=await client.perform({request}),second=await client.perform({request:first.pagination.nextRequest});
 assert.equal(first.outcome.state,'COMPLETE');assert.equal(first.outcome.result.records[0].amount,'9007199254740993.0000001');
 assert.equal(first.outcome.result.records[0].note,'confirmé');assert.equal(first.pagination.nextRequest.args.offset,2);
 assert.equal(second.outcome.state,'COMPLETE');assert.equal(second.pagination.complete,true);assert.equal(second.pagination.nextRequest,null);
 assert.equal(calls.filter(row=>row.body?.method==='tools/list').length,2);
 sections.push('Complete original tool catalogue and paginated history with exact decimal strings and split UTF-8 SSE');
 const oneTime=await client.perform({request:await client.prepare({action:'mcp.create_api_key',args:{id:app,name:'contract fixture'}})});
 assert.equal(oneTime.outcome.state,'COMPLETE');assert.ok(oneTime.ephemeral);
 assert.ok(Buffer.from(oneTime.ephemeral.response.bodyBase64,'base64').toString('utf8').includes(key));
 const durable=structuredClone(oneTime);delete durable.ephemeral;
 assert.equal(JSON.stringify(durable).includes(key),false);
 assert.equal(Buffer.from(durable.response.bodyBase64,'base64').toString('utf8').includes(key),false);
 sections.push('One-time key response survives only in the authorized ephemeral return');
 const verified=await client.verifySession({accessToken:token});
 assert.equal(verified.content.userId,'fixture-user');assert.equal(verified.response.bodyRedacted,true);
 assert.equal(JSON.stringify(verified).includes(token),false);assert.equal(Buffer.from(verified.response.bodyBase64,'base64').toString('utf8').includes(token),false);
 sections.push('Original session verification binds application and network and redacts echoed token');
 behavior='complete-then-close-error';
 const completed=await client.perform({request:await client.prepare({action:'mcp.get_application',args:{id:app}})});
 assert.equal(completed.outcome.state,'COMPLETE');assert.ok(completed.observations.some(item=>item.transportError));
 sections.push('Complete matching RPC result remains authoritative after stream close error');
 behavior='server-incomplete';
 const ambiguous=await client.perform({request:await client.prepare({action:'server.wallet.fund',args:{publicKey:wallet}})});
 assert.equal(ambiguous.outcome.state,'UNCERTAIN');
 sections.push('An incomplete successful HTTP mutation envelope requires original outcome recovery');
 behavior='normal';
 const mutation=await client.prepare({action:'mcp.update_application_domains',args:{id:app,allowed_origins:['http://127.0.0.1:8778']}});
 const dropped=await client.perform({request:mutation});assert.equal(dropped.outcome.state,'UNCERTAIN');
 assert.ok(dropped.observations.some(item=>item.lastEventId==='original-prime'));
 const resumed=await client.reconcile({operation:{id:'fixture-operation',action:mutation.action,request:mutation,sources:[dropped]}});
 assert.equal(resumed.outcome.state,'COMPLETE');assert.equal(calls.filter(row=>row.body?.params?.name==='update_application_domains').length,1);
 const resumeExchange=resumed.observations.find(item=>item.kind==='provider-http-exchange');assert.equal(resumeExchange.method,'GET');assert.equal(resumeExchange.requestBodyBytes,0);assert.equal(resumeExchange.requestBodySha256,null);
 sections.push('Original priming cursor recovers the same mutation result with a body-free GET and one mutation POST');
 for(const selection of ['unsafe-integer','invalid-utf8']){
  behavior=selection;const value=await client.perform({request:await client.prepare({action:'mcp.get_application',args:{id:app}})});
  assert.equal(value.outcome.state,'FAILED');assert.ok(value.observations.some(item=>item.projectionErrors?.length));assert.ok(value.response.bodyBytes>0);
 }
 sections.push('Original bytes remain available when UTF-8 or integer projection is invalid');
 const other=await openPollarOperatorConnection({connection:{...connection,applicationId:'another-application'}});
 try{await assert.rejects(()=>other.perform({request}));}finally{await other.close();}
 sections.push('Frozen original request rejects a different connection selection');
 const report={schema:'stellar-forge.pollar-partner.native-protocol-exercise.v1',completedAt:new Date().toISOString(),runtime:process.version,
  source:{nativeSha256:sha(await fs.readFile(join(sourceDirectory,'native.mjs'))),catalogueSha256:sha(await fs.readFile(join(sourceDirectory,'catalogue.mjs')))},
  transport:'local original-contract response fixture',sections,providerExchanges:calls.length,passed:true};
 if(reportFile)await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(report)+'\n');
}finally{await client.close();}
