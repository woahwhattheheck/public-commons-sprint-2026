// MIT. Use the original exact native dependency set and the selected channel contract.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNative, versions } from '../mpp-charge/runtime.mjs';
import { requireValue as need, hash, now } from '../mpp-charge/storage.mjs';
import { absolute, streamKey, publicURL, amount } from './config.mjs';
export { versions };
export async function loadChannelNative(dependencyRoot) {
  const native=await loadNative(dependencyRoot);
  const resolver=createRequire(join(absolute(dependencyRoot), 'package.json'));
  const [channelServer,channelClient]=await Promise.all(['@stellar/mpp/channel/server','@stellar/mpp/channel/client']
    .map(name=>import(pathToFileURL(resolver.resolve(name)).href)));
  return {...native, channelServer, channelClient};
}
export function nativeStore(workspace, terms) {
  const prefix='mpp-channel:'+terms.network+':'+terms.address+':';
  return {
    prefix, get:key=>workspace.sdkStore.get(prefix+key),
    put:(key,value)=>workspace.sdkStore.put(prefix+key,value),
    delete:key=>workspace.sdkStore.delete(prefix+key),
    update:(key,fn)=>workspace.sdkStore.update(prefix+key,fn)
  };
}
export const clientCumulativeKey = terms => 'stellar:channel:client:'+terms.network+':'+terms.address+':cumulative';
export const merchantCumulativeKey = terms => 'stellar:channel:cumulative:'+terms.address;
export const closedKey = terms => 'stellar:channel:closed:'+terms.address;
export const settlingKey = terms => 'stellar:channel:settling:'+terms.address;
function networkPassphrase(native, network) {
  if(network==='stellar:testnet') return native.sdk.Networks.TESTNET;
  need(network==='stellar:pubnet', 'MPP_CHANNEL_NETWORK_INVALID'); return native.sdk.Networks.PUBLIC;
}
export { networkPassphrase };
export async function channelRpc(native, terms, rpcUrl=terms.rpcUrl) {
  const server=new native.sdk.rpc.Server(publicURL(rpcUrl).href);
  const network=await timeout(server.getNetwork(),'channel network');
  need(network?.passphrase===networkPassphrase(native,terms.network),
    'MPP_CHANNEL_RPC_NETWORK_MISMATCH');
  return server;
}
function enumKey(value, name, sdk) {
  try { const v=value.vec(); return v?.length===1 &&
    v[0].switch().value===sdk.xdr.ScValType.scvSymbol().value && v[0].sym().toString()===name; }
  catch { return false; }
}
async function timeout(promise, label) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=> {
    timer=setTimeout(()=>reject(Object.assign(new Error(label),{code:'MPP_CHANNEL_RPC_TIMEOUT'})),15000);
  })]); } finally { clearTimeout(timer); }
}
// Balance and instance accounting must come from the same ledger. In particular,
// a collection changes both balance and WithdrawnAmount; mixing ledgers overstates credit.
export async function observeChannel(native, terms) {
  const sdk=native.sdk, server=await channelRpc(native,terms);
  const instanceKey=sdk.xdr.LedgerKey.contractData(new sdk.xdr.LedgerKeyContractData({
    contract:sdk.Address.fromString(terms.address).toScAddress(),
    key:sdk.xdr.ScVal.scvLedgerKeyContractInstance(),
    durability:sdk.xdr.ContractDataDurability.persistent()
  }));
  const account=new sdk.Account(sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32)), '0');
  for(let attempt=0;attempt<3;attempt++) {
    const getter=new sdk.TransactionBuilder(account,{fee:'100',
      networkPassphrase:networkPassphrase(native,terms.network)})
      .addOperation(new sdk.Contract(terms.address).call('balance')).setTimeout(60).build();
    const [simulation,entries]=await Promise.all([
      timeout(server.simulateTransaction(getter),'channel balance'),
      timeout(server.getLedgerEntries(instanceKey),'channel instance')
    ]);
    need(sdk.rpc.Api.isSimulationSuccess(simulation) && simulation.result?.retval,
      'MPP_CHANNEL_BALANCE_OBSERVATION_REQUIRED');
    need(Number.isSafeInteger(simulation.latestLedger) && Number.isSafeInteger(entries.latestLedger) &&
      simulation.latestLedger>0 && entries.latestLedger>0, 'MPP_CHANNEL_OBSERVATION_LEDGER_REQUIRED');
    if(simulation.latestLedger!==entries.latestLedger) continue;
    const entry=entries.entries?.find(row=>Buffer.from(row.key.toXDR()).equals(Buffer.from(instanceKey.toXDR())));
    need(entry, 'MPP_CHANNEL_INSTANCE_REQUIRED');
    const instance=entry.val.contractData().val().instance(),fields=instance.storage() ?? [];
    const field=name=>fields.find(row=>enumKey(row.key(),name,sdk))?.val();
    const code=Buffer.from(instance.executable().wasmHash()).toString('hex');
    need(code===terms.wasmSha256, 'MPP_CHANNEL_CODE_EDITION_CHANGED');
    const token=field('Token'),funder=field('From'),recipient=field('To'),commitment=field('CommitmentKey');
    need(token && funder && recipient &&
      sdk.Address.fromScVal(token).toString()===terms.token &&
      sdk.Address.fromScVal(funder).toString()===terms.funder &&
      sdk.Address.fromScVal(recipient).toString()===terms.recipient,
      'MPP_CHANNEL_ONCHAIN_PARTIES_CHANGED');
    need(commitment && Buffer.from(commitment.bytes()).equals(
      Buffer.from(sdk.Keypair.fromPublicKey(terms.commitmentKey).rawPublicKey())),
      'MPP_CHANNEL_COMMITMENT_KEY_CHANGED');
    const withdrawn=field('WithdrawnAmount'),waiting=field('RefundWaitingPeriod'),close=field('CloseEffectiveAtLedger');
    need(waiting, 'MPP_CHANNEL_REFUND_WAITING_PERIOD_REQUIRED');
    const balanceAtomic=amount(BigInt(sdk.scValToNative(simulation.result.retval)).toString(),{zero:true});
    const withdrawnAtomic=amount(withdrawn?BigInt(sdk.scValToNative(withdrawn)).toString():'0',{zero:true});
    return {schema:'stellar-forge.mpp-channel-observation.v1',observedAt:now(),
      network:terms.network,channel:terms.address,token:terms.token,funder:terms.funder,recipient:terms.recipient,
      commitmentKey:terms.commitmentKey,wasmSha256:code,balanceAtomic,withdrawnAtomic,
      depositedAtomic:(BigInt(balanceAtomic)+BigInt(withdrawnAtomic)).toString(),
      refundWaitingPeriod:waiting.u32(),closeEffectiveAtLedger:close?close.u32():null,
      currentLedger:entries.latestLedger,instanceLedger:entries.latestLedger,
      balanceLedger:simulation.latestLedger,instanceSha256:hash(entry.val.toXDR())};
  }
  need(false, 'MPP_CHANNEL_OBSERVATION_LEDGER_ADVANCED',409);
}
export function outstandingAtomic(observation,cumulativeAtomic) {
  const cumulative=BigInt(amount(cumulativeAtomic,{zero:true}));
  const withdrawn=BigInt(amount(observation.withdrawnAtomic,{zero:true}));
  return (cumulative>withdrawn?cumulative-withdrawn:0n).toString();
}
export function assertFreshCommitment(observation,cumulativeAtomic,requestedAtomic) {
  const cumulative=BigInt(amount(cumulativeAtomic)),withdrawn=BigInt(amount(observation.withdrawnAtomic,{zero:true}));
  need(observation.closeEffectiveAtLedger===null, 'MPP_CHANNEL_CLOSING',409);
  need(cumulative>withdrawn, 'MPP_CHANNEL_ORIGINAL_CUMULATIVE_HISTORY_REQUIRED',409);
  const outstanding=cumulative-withdrawn;
  need(outstanding>=BigInt(amount(requestedAtomic)), 'MPP_CHANNEL_UNPAID_INCREMENT_TOO_SMALL',409);
  need(outstanding<=BigInt(amount(observation.balanceAtomic,{zero:true})),
    'MPP_CHANNEL_OUTSTANDING_EXCEEDS_BALANCE',409);
  return outstanding.toString();
}

export async function dependencyRootFor(workspace,config) {
  const binding=await workspace.read('channel-receiving','runtime:'+streamKey(config.channel));
  return binding?absolute(binding.dependencyRoot):config.dependencyRoot;
}
export async function inputPathFor(workspace,config,path) {
  const binding=await workspace.read('channel-receiving','runtime:'+streamKey(config.channel));
  const selected=binding?.files?.[path];
  if(!selected) return path;
  const {regular}=await import('../distribution/runtime-workspace/storage.mjs');
  const bytes=await regular(selected.path,16*1024*1024);
  need(hash(bytes)===selected.sha256, 'MPP_CHANNEL_RECEIVED_INPUT_CHANGED');
  return selected.path;
}
