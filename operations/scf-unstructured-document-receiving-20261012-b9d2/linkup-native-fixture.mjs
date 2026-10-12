// MIT. Controlled RPC/Horizon responses for the original native SDK journey.
// Loaded in the merchant and its ORIGINAL buyer child through NODE_OPTIONS.
import assert from 'node:assert/strict';
import { basename, resolve } from 'node:path';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { Keypair, Account, Address, StrKey, Networks, SorobanDataBuilder, nativeToScVal,
  scValToNative, xdr, rpc, Horizon } from '@stellar/stellar-sdk';
import { USDC_TESTNET_ADDRESS } from '@x402/stellar';

const root=process.env.LINKUP_FIXTURE_ROOT;
assert(root && resolve(root)===root && basename(root).startsWith('linkup-native-'));
export const fixture={
  payer:Keypair.fromRawEd25519Seed(Buffer.alloc(32,41)),
  merchant:Keypair.fromRawEd25519Seed(Buffer.alloc(32,42)),
  facilitator:Keypair.fromRawEd25519Seed(Buffer.alloc(32,43)),
  asset:USDC_TESTNET_ADDRESS, ledger:5000000,
  state:{simulations:0,submissions:[],confirmations:0,readOnlyCalls:[]},
};
let sequence='1000';
const events=[];
rpc.Server.prototype.getLatestLedger=async()=>({sequence:fixture.ledger});
Horizon.Server.prototype.ledgers=function(){const query={limit:()=>query,order:()=>query,
  call:async()=>({records:[{closed_at:'2026-10-11T18:00:05Z'},{closed_at:'2026-10-11T18:00:00Z'}]})};return query;};
rpc.Server.prototype.getAccount=async address=>{
  assert.equal(address,fixture.facilitator.publicKey());return new Account(address,sequence);
};
rpc.Server.prototype.simulateTransaction=async tx=>{
  const invoke=tx.operations[0];assert.equal(tx.operations.length,1);
  assert.equal(invoke.type,'invokeHostFunction');
  const call=invoke.func.invokeContract(),args=call.args();
  assert.equal(Address.fromScAddress(call.contractAddress()).toString(),fixture.asset);
  assert.equal(call.functionName().toString(),'transfer');
  assert.equal(scValToNative(args[0]),fixture.payer.publicKey());
  assert.equal(scValToNative(args[1]),fixture.merchant.publicKey());
  assert.equal(scValToNative(args[2]),10000n);
  // The first native client simulation discovers the payer's unsigned entry.
  // Every subsequent simulation preserves the ORIGINAL SDK-signed entry.
  const auth=invoke.auth?.length?invoke.auth:[new xdr.SorobanAuthorizationEntry({
    credentials:xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address:new Address(fixture.payer.publicKey()).toScAddress(),nonce:xdr.Int64.fromString(process.env.LINKUP_FIXTURE_NONCE ?? '17'),
      signatureExpirationLedger:0,signature:xdr.ScVal.scvVoid()})),
    rootInvocation:new xdr.SorobanAuthorizedInvocation({
      function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call),subInvocations:[]})})];
  const event=new xdr.DiagnosticEvent({inSuccessfulContractCall:true,event:new xdr.ContractEvent({
    ext:new xdr.ExtensionPoint(0),contractId:StrKey.decodeContract(fixture.asset),
    type:xdr.ContractEventType.contract(),body:new xdr.ContractEventBody(0,new xdr.ContractEventV0({
      topics:[nativeToScVal('transfer',{type:'symbol'}),args[0],args[1]],data:args[2]}))})});
  fixture.state.simulations++;
  return {_parsed:true,id:'linkup-original-sdk-fixture',latestLedger:fixture.ledger,
    minResourceFee:'1000',events:[event],transactionData:new SorobanDataBuilder().setResourceFee('1000'),
    result:{auth,retval:xdr.ScVal.scvVoid()}};
};
rpc.Server.prototype.sendTransaction=async tx=>{
  assert.equal(tx.source,fixture.facilitator.publicKey());
  assert(fixture.facilitator.verify(tx.hash(),tx.signatures[0].signature()));
  assert.equal(BigInt(tx.sequence),BigInt(sequence)+1n);sequence=tx.sequence;
  const hash=tx.hash().toString('hex');
  fixture.state.submissions.push({hash,sequence,feeStroops:tx.fee,at:Date.now()});
  const args=tx.operations[0].func.invokeContract().args();
  events.push({id:'linkup-native-'+hash,txHash:hash,contractId:fixture.asset,
    topic:[nativeToScVal('transfer',{type:'symbol'}),args[0],args[1]].map(value=>value.toXDR('base64')),
    value:args[2].toXDR('base64')});
  return {status:'PENDING',hash};
};
rpc.Server.prototype.getTransaction=async hash=>{
  assert(fixture.state.submissions.some(item=>item.hash===hash));
  fixture.state.confirmations++;return {status:'SUCCESS'};
};

/** The original SF43 observer uses HTTP JSON-RPC, independently of the SDK. */
export function readOnlyRpc(method,params={}) {
  fixture.state.readOnlyCalls.push(method);
  if(method==='getNetwork')return {passphrase:Networks.TESTNET};
  if(method==='getTransaction'){
    const found=fixture.state.submissions.find(value=>value.hash===params.hash);
    return found?{status:'SUCCESS',txHash:found.hash,ledger:fixture.ledger}:{status:'NOT_FOUND'};
  }
  if(method==='getEvents'){
    assert.equal(params.startLedger,fixture.ledger);
    assert.deepEqual(params.filters,[{type:'contract',contractIds:[fixture.asset]}]);
    return {events,cursor:null};
  }
  throw Error('Unexpected read-only fixture RPC method: '+method);
}

// The local provider contract service receives the original HTTPS request.
// Restrict this transport fixture to one exact provider endpoint.
const originalHttpsRequest = https.request;
https.request = function(target, options, callback) {
  const url = target instanceof URL ? target : typeof target === 'string' ? new URL(target) : null;
  if (url?.origin === 'https://api.linkup.so') {
    assert.equal(url.pathname, '/v1/search'); assert.equal(url.search, '');
    const port = Number(process.env.LINKUP_FIXTURE_PROVIDER_PORT);
    assert(Number.isInteger(port) && port > 0);
    return originalHttpsRequest.call(this, url, {...options, port, servername:'api.linkup.so',
      headers:{...options.headers,host:'api.linkup.so'},
      lookup: (_host, options, callback) => {
        if(typeof options === 'function') {callback=options;options={};}
        callback(null, options?.all ? [{address:'127.0.0.1',family:4}] : '127.0.0.1', 4);
      }}, callback);
  }
  return originalHttpsRequest.apply(this, arguments);
};
syncBuiltinESMExports();
