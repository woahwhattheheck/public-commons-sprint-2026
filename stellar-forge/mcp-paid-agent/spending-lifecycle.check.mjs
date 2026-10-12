/** MIT. One local integration exercise of the original SQLite spending lifecycle.
 * SDK/payment evidence fixtures exercise the integration without sending a payment.
 * Run: MCP_SPENDING_PYTHON=/absolute/python3 node spending-lifecycle.check.mjs
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm,stat,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMcpSpendingClient,createGovernedNativeMcpOperator,mcpSpendingBinding}
  from './native-spend-governor.mjs';
import {configureMcpSpendingModule,nativeSpendingMain} from './native-spend-workspace.mjs';
import {prepareMcpInvocation} from './remote-mcp.mjs';
import {McpPaidToolBroker} from './agent-server.mjs';

const python=process.env.MCP_SPENDING_PYTHON;
assert.ok(python?.startsWith('/'),'Set MCP_SPENDING_PYTHON to the actual absolute Python executable.');
const root=await mkdtemp(join(tmpdir(),'mcp-spending-lifecycle-'));
const environment=Object.fromEntries(['CONSENT','AUDIT','OPERATOR'].map(name=>
  ['SF36_'+name+'_KEY_B64',randomBytes(32).toString('base64')]));
const payer='GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const payTo='GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const asset='CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ';
const network='stellar:testnet',rpcUrl='https://soroban-testnet.stellar.org';
const limits={network,asset,payTo,maxAtomic:'60',maxTimeoutSeconds:60};
const accepted={scheme:'exact',network,asset,payTo,amount:'60',maxTimeoutSeconds:60,
  extra:{areFeesSponsored:true,paymentFlow:'authorization',description:'Unicode: café 😀'}};
const invocation=prepareMcpInvocation({resource:{url:'https://merchant.example/mcp'},
  input:{toolName:'read_record',transport:'streamable-http',inputSchema:{type:'object'}}},
{arguments:{name:'café 😀',small:1e-7,whole:1.0}});
const quote=()=>({quoteId:randomUUID(),requestUrl:invocation.endpoint,method:'tools/call',invocation,accepted});
const policy=join(root,'policy.json'),ledger=join(root,'governor.sqlite');
const setPolicy=maximum=>writeFile(policy,JSON.stringify({schema:'stellar-spend-governor/v1',
  assets:[{network,asset,max_single:'100',max_total:maximum,max_per_utc_day:maximum,
    max_per_actor_utc_day:maximum,max_per_service_utc_day:maximum}]}),{mode:0o600});
const host=stateDirectory=>({python,actor:'buyer',service:'merchant-tools',policy,ledger,
  stateDirectory,environment});
let signingCalls=0;
const sdk={versions:{core:'fixture',stellar:'fixture'},
  ExactStellarScheme:class {},
  x402Client:class {
    constructor(select){this.select=select;}
    register(){}
    setSpendControls(){}
    async createPaymentPayload(required){
      signingCalls++;
      return {x402Version:2,accepted:this.select(2,required.accepts),
        resource:required.resource,payload:{fixture:true}};
    }
  }};
const signer={address:payer,signAuthEntry(){throw new Error('Fixture SDK does not call a real signer.');}};
const options=spending=>({spending,payer,signer,sdk,rpcUrl,limits,
  approveQuote:async reviewed=>{assert.equal(reviewed.limits.aggregate.approved,true);return true;}});
const input=q=>({...q,paymentRequired:{x402Version:2,resource:{url:invocation.paymentResourceUrl},
  accepts:[accepted]},resource:{url:invocation.paymentResourceUrl}});
const opened=[];
try {
  await setPolicy('100');
  const hosts=[host(join(root,'buyer-a')),host(join(root,'buyer-b'))];
  const operators=await Promise.all(hosts.map(h=>createGovernedNativeMcpOperator(options(h))));
  opened.push(...operators);
  const clients=hosts.map(createMcpSpendingClient);opened.push(...clients);
  const quotes=[quote(),quote()];
  await operators[0].approve(quotes[0]);await operators[1].approve(quotes[1]);
  const bindings=quotes.map(q=>mcpSpendingBinding(q,{...hosts[0],payer}));
  assert.equal((await clients[0].estimate(bindings[0])).reservation,null);
  const bad=input(quotes[0]);bad.paymentRequired={...bad.paymentRequired,resource:{url:'mcp://tool/changed'}};
  await assert.rejects(operators[0].signPayment(bad),{code:'CHALLENGE_MISMATCH'});
  assert.equal((await clients[0].status(quotes[0].quoteId)).outcome,'NOT_RESERVED');

  // Two separate helper directories/processes contend on the same original ledger.
  const attempts=await Promise.allSettled(operators.map((op,i)=>op.signPayment(input(quotes[i]))));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(signingCalls,1);
  const winner=attempts.findIndex(r=>r.status==='fulfilled'),loser=1-winner;
  const q=quotes[winner],client=clients[winner],binding=bindings[winner];
  assert.equal((await client.status(q.quoteId)).reservation.amount,'60');
  assert.equal((await clients[loser].status(quotes[loser].quoteId)).outcome,'NOT_RESERVED');
  assert.equal((await clients[loser].estimate(bindings[loser])).estimate.limit_remaining.max_total,'40');
  await assert.rejects(operators[winner].signPayment(input(q)),{code:'MCP_SPENDING_APPROVAL_MISMATCH'});

  // Changing the policy cap cannot turn an existing reservation into fresh authority.
  await operators[winner].close();
  await setPolicy('200');
  const restarted=await createGovernedNativeMcpOperator(options(hosts[winner]));opened.push(restarted);
  await restarted.approve(q);
  await assert.rejects(restarted.signPayment(input(q)),{code:'MCP_SPENDING_EXISTING_RESERVATION'});
  assert.equal(signingCalls,1);
  const inspected=await restarted.spendingStatus(q.quoteId);
  assert.equal(inspected.reservation.state,'reserved');
  assert.equal(Object.hasOwn(inspected,'binding'),false);

  const transaction='a'.repeat(64);
  const transfer={schema:'stellar-forge.sf86.rpc-reconciliation.v1',
    verdict:'CHAIN_TRANSFER_MATCHED_RPC_TESTNET',source:'official-stellar-testnet-rpc',
    rpcEndpoint:rpcUrl,networkPassphrase:'Test SDF Network ; September 2015',
    intentId:q.quoteId,transaction,network,asset,payer,recipient:payTo,atomicAmount:'60',
    matchingTransfers:1,ledger:123,matchingEventId:'fixture-transfer-1'};
  const proof={schema:'stellar-forge.sf86.payment-attempt.v1',outcome:'TRANSFER_MATCHED',
    rpcStatus:'SUCCESS',source:transfer.source,rpcEndpoint:rpcUrl,ledger:123,
    intentId:q.quoteId,transaction,network,asset,payer,recipient:payTo,atomicAmount:'60',transfer};
  await assert.rejects(client.finalize(q.quoteId,{...proof,payer:payTo}),{code:'MCP_SPENDING_REJECTED'});
  assert.equal((await client.status(q.quoteId)).reservation.state,'reserved');
  const finalized=await client.finalize(q.quoteId,proof);
  assert.equal(finalized.outcome,'FINALIZED');
  const again=await client.finalize(q.quoteId,{...proof,checkedAt:new Date().toISOString()});
  assert.equal(again.outcome,'IDEMPOTENT_FINALIZED');
  assert.equal(finalized.proof_sha256,again.proof_sha256);

  const broker=new McpPaidToolBroker({discoveryUrl:'https://merchant.example',
    quoteStore:{load:()=>[{...q,url:q.requestUrl,status:'CONFIRMED_BY_SERVER',
      signedRequestDispatched:true,result:{}}],save(){},close(){}},
    spendingStatus:restarted.spendingStatus});opened.push(broker);
  const publicStatus=await broker.spendingStatus({quoteId:q.quoteId});
  assert.equal(publicStatus.reservation.state,'settled');
  assert.equal(Object.hasOwn(publicStatus,'binding'),false);
  assert.ok(Buffer.byteLength(JSON.stringify(publicStatus))<65536);

  let reviewEntered,reviewAborted=false;
  const reviewing=new Promise(resolve=>{reviewEntered=resolve;});
  const advertisedInput={type:'mcp',toolName:invocation.toolName,
    transport:invocation.transport,inputSchema:{type:'object'}};
  const cancelBroker=new McpPaidToolBroker({discoveryUrl:'https://merchant.example',
    signPayment:async()=>{throw new Error('Cancelled approval must not reach signing.');},
    allowedResourceOrigins:['https://merchant.example'],
    fetchImpl:async()=>new Response(JSON.stringify({resources:[{
      resource:{url:invocation.endpoint},accepts:[accepted],
      extensions:{bazaar:{info:{input:advertisedInput}}}
    }]}),{headers:{'content-type':'application/json'}}),
    approve:({signal})=>new Promise(resolve=>{
      assert.ok(signal);signal.addEventListener('abort',()=>{reviewAborted=true;resolve(false);},{once:true});
      reviewEntered();
    })});opened.push(cancelBroker);
  const listing=await cancelBroker.search({query:'read_record'});
  const cancelledQuote=cancelBroker.preview({handle:listing.resources[0].handle,input:{arguments:{}}});
  const pendingReview=cancelBroker.execute({quoteId:cancelledQuote.quoteId});
  await reviewing;
  assert.equal(cancelBroker.cancel({quoteId:cancelledQuote.quoteId}).status,'CANCELLED');
  assert.equal((await pendingReview).status,'CANCELLED');
  assert.equal(reviewAborted,true);

  const configPath=join(root,'host.json'),modulePath=join(root,'operator.mjs');
  const {environment:privateEnvironment,...spending}=hosts[winner];
  await writeFile(configPath,JSON.stringify({schema:'stellar-forge.mcp-spending-host.v1',
    payer,signerSecretEnv:'ABSENT_TEST_SIGNER',rpcUrl,limits,spending}),{mode:0o600});
  assert.equal((await configureMcpSpendingModule(configPath,modulePath)).outcome,'CONFIGURED');
  assert.equal((await stat(modulePath)).mode&0o077,0);
  await assert.rejects(configureMcpSpendingModule(configPath,modulePath),{code:'EEXIST'});
  assert.equal((await nativeSpendingMain(['status',configPath,q.quoteId],{environment})).reservation.state,'settled');
  await rename(ledger,ledger+'.retained');
  await assert.rejects(client.status(q.quoteId),{code:'MCP_SPENDING_REJECTED'});
  await rename(ledger+'.retained',ledger);
  console.log(JSON.stringify({outcome:'PASS',exercise:'native-mcp-original-sf36-lifecycle',
    scope:'local integration with SDK and SF86 evidence fixtures',
    competingBuyers:2,signingCalls,chargedBaseUnits:'60',remainingBeforePolicyChange:'40',
    restart:'existing reservation refused',finality:'idempotent',brokerStatus:'settled',
    hostSetup:'private create-only module',approvalCancellation:'aborted waiting review',missingLedger:'refused'}));
} finally {
  await Promise.allSettled(opened.map(owner=>owner.close()));
  await rm(root,{recursive:true,force:true});
}
