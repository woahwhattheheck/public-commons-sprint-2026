// MIT. Open a selected native channel and retain its complete code and original deployment.
import { randomBytes } from 'node:crypto';
import { regular } from '../distribution/runtime-workspace/storage.mjs';
import { requireValue as need, hash, stable, now, id } from '../mpp-charge/storage.mjs';
import { openingConfig, funderConfig, profileKey, streamKey, absolute } from './config.mjs';
import { loadChannelNative, dependencyRootFor, channelRpc, networkPassphrase,
  observeChannel, nativeStore } from './runtime.mjs';
import { groups, serialChannel, ensureStream, rememberObservation, openingView } from './state.mjs';
import { assertOperating } from './receiving.mjs';
import { terminalConsent } from './authority.mjs';
import { prepareChannelCall, transactionFinality, broadcastRetained,
  acquireFinancialMarker, clearFinancialMarker } from './transaction.mjs';
const terminal=new Set(['OPENED','FAILED','EXPIRED','CANCELLED']);
const transactionTerminal=new Set(['SUCCESS','FAILED','EXPIRED']);
const owner=row=>({kind:'opening',id:row.id});
const hasSigned=row=>Object.values(row.transactions ?? {}).some(value=>value.signedXdr);
function instanceKey(sdk,address) {
  return sdk.xdr.LedgerKey.contractData(new sdk.xdr.LedgerKeyContractData({
    contract:sdk.Address.fromString(address).toScAddress(),
    key:sdk.xdr.ScVal.scvLedgerKeyContractInstance(),
    durability:sdk.xdr.ContractDataDurability.persistent()}));
}
export function openingAddress(native,{network,funder,salt}) {
  need(/^[a-f0-9]{64}$/.test(salt),'MPP_CHANNEL_OPENING_SALT_REQUIRED');
  const sdk=native.sdk,preimage=sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new sdk.xdr.ContractIdPreimageFromAddress({
      address:sdk.Address.fromString(funder).toScAddress(),salt:Buffer.from(salt,'hex')}));
  const full=sdk.xdr.HashIdPreimage.envelopeTypeContractId(new sdk.xdr.HashIdPreimageContractId({
    networkId:sdk.hash(Buffer.from(networkPassphrase(native,network))),contractIdPreimage:preimage}));
  return sdk.StrKey.encodeContract(sdk.hash(full.toXDR()));
}
async function setupObservation(native,config) {
  const sdk=native.sdk,rpc=await channelRpc(native,config.channel);
  const codeKey=sdk.xdr.LedgerKey.contractCode(new sdk.xdr.LedgerKeyContractCode({
    hash:Buffer.from(config.channel.wasmSha256,'hex')}));
  const channelKey=instanceKey(sdk,config.channel.address);
  const result=await rpc.getLedgerEntries(codeKey,channelKey);
  need(Number.isSafeInteger(result.latestLedger) && result.latestLedger>0,
    'MPP_CHANNEL_SETUP_LEDGER_REQUIRED');
  const find=key=>result.entries?.find(row=>Buffer.from(row.key.toXDR()).equals(Buffer.from(key.toXDR())));
  const code=find(codeKey),channel=find(channelKey);
  const bytes=code?Buffer.from(code.val.contractCode().code()):null;
  if(bytes)need(hash(bytes)===config.channel.wasmSha256,'MPP_CHANNEL_SELECTED_WASM_CHANGED');
  return {observation:{schema:'stellar-forge.mpp-channel-setup-observation.v1',
    network:config.channel.network,channel:config.channel.address,wasmSha256:config.channel.wasmSha256,
    codePresent:!!code,channelPresent:!!channel,codeBytes:bytes?.length ?? 0,
    instanceLedger:result.latestLedger,observedAt:now()},bytes};
}
function constructorArgs(native,config) {
  const sdk=native.sdk,terms=config.channel,selected=config.opening;
  return [sdk.Address.fromString(terms.token).toScVal(),
    sdk.Address.fromString(terms.funder).toScVal(),
    sdk.xdr.ScVal.scvBytes(sdk.Keypair.fromPublicKey(terms.commitmentKey).rawPublicKey()),
    sdk.Address.fromString(terms.recipient).toScVal(),
    sdk.nativeToScVal(BigInt(selected.initialAmountAtomic),{type:'i128'}),
    sdk.nativeToScVal(selected.refundWaitingPeriod,{type:'u32'})];
}
function specification(native,row,stage) {
  const config=openingConfig(row.config),sdk=native.sdk;
  need(profileKey(config)===row.profileId &&
    openingAddress(native,{...config.channel,salt:config.opening.salt})===config.channel.address,
    'MPP_CHANNEL_ORIGINAL_OPENING_PROFILE_CHANGED');
  const common={channel:config.channel,account:config.funding.account,
    maximumFeeStroops:config.funding.maximumFeeStroops};
  if(stage==='code') {
    const bytes=Buffer.from(row.codeData.bodyBase64,'base64');
    need(bytes.length===row.codeData.bytes && hash(bytes)===config.channel.wasmSha256,
      'MPP_CHANNEL_ORIGINAL_WASM_REQUIRED');
    return {...common,hostOperation:sdk.Operation.uploadContractWasm({wasm:bytes}),
      opening:{stage:'code'}};
  }
  need(stage==='open','MPP_CHANNEL_OPENING_STAGE_REQUIRED');
  const args=constructorArgs(native,config);
  return {...common,hostOperation:sdk.Operation.createCustomContract({
    address:sdk.Address.fromString(config.funding.account),
    wasmHash:Buffer.from(config.channel.wasmSha256,'hex'),salt:Buffer.from(config.opening.salt,'hex'),
    constructorArgs:args}),opening:{stage:'open',constructorArgs:args,
      initialAmountAtomic:config.opening.initialAmountAtomic}};
}
async function save(workspace,row,change) {
  const next={...row,...change,updatedAt:now()};await workspace.put(groups.openings,row.id,next);return next;
}
async function readOpening(workspace,openingId) {
  const row=await workspace.read(groups.openings,id(openingId));
  need(row?.schema==='stellar-forge.mpp-channel-opening.v1','MPP_CHANNEL_OPENING_NOT_FOUND',404);return row;
}
async function saveStage(workspace,openingId,stage,value) {
  let row=await readOpening(workspace,openingId);
  const phase=value.phase==='SUCCESS'?(stage==='code'?'CODE_READY':'OPENING'):value.phase;
  row=await save(workspace,row,{phase,activeStage:stage,
    transactions:{...row.transactions,[stage]:value}});
  return row;
}
async function finish(workspace,row,native,store) {
  if(row.transactions?.open?.phase==='SUCCESS' && !['FAILED','EXPIRED','CANCELLED'].includes(row.phase)) {
    const config=openingConfig(row.config),observation=row.openingObservation ?? await observeChannel(native,config.channel);
    need(observation.refundWaitingPeriod===config.opening.refundWaitingPeriod,
      'MPP_CHANNEL_OPENING_REFUND_PERIOD_CHANGED');
    row=await save(workspace,row,{phase:'OPENED',openingObservation:observation,
      completedAt:row.completedAt ?? now(),receipt:{model:'channel-opening',network:config.channel.network,
        channel:config.channel.address,transaction:row.transactions.open.transaction,
        codeUploadTransaction:row.transactions.code?.transaction ?? null,
        wasmSha256:config.channel.wasmSha256,token:config.channel.token,funder:config.channel.funder,
        recipient:config.channel.recipient,commitmentKey:config.channel.commitmentKey,
        initialAmountAtomic:config.opening.initialAmountAtomic,
        refundWaitingPeriod:config.opening.refundWaitingPeriod,
        observedBalanceAtomic:observation.balanceAtomic,observedAtLedger:observation.currentLedger}});
    await ensureStream(workspace,config.channel);
    const funding=funderConfig({title:config.title,channel:config.channel,
      dependencyRoot:config.dependencyRoot,funding:config.funding}),fundingId=profileKey(funding);
    await workspace.put('profiles',fundingId,funding);
    await workspace.update(groups.funders,streamKey(config.channel),current=>{
      if(current)return {op:'noop',result:current};
      const selected={schema:'stellar-forge.mpp-channel-funder-selection.v1',channel:config.channel,
        profileId:fundingId,title:config.title,revision:1,openingId:row.id,updatedAt:now()};
      return {op:'set',value:selected,result:selected};
    });
    await rememberObservation(workspace,config.channel,observation,
      {openingId:row.id,transaction:row.transactions.open.transaction});
  }
  if(terminal.has(row.phase)) {
    await clearFinancialMarker(store,row.config.channel,owner(row));
    if(!row.finalizedAt)row=await save(workspace,row,{finalizedAt:now()});
  }
  return row;
}
export async function prepareOpening({workspace,openingId,profile}) {
  id(openingId);
  const previous=await workspace.read(groups.openings,openingId);
  const native=await loadChannelNative(previous?await dependencyRootFor(workspace,previous.config):absolute(profile?.dependencyRoot));
  const salt=profile?.opening?.salt || previous?.config?.opening?.salt || randomBytes(32).toString('hex');
  const address=openingAddress(native,{network:profile?.channel?.network,funder:profile?.channel?.funder,salt});
  const config=openingConfig({...profile,channel:{...profile.channel,address},
    opening:{...profile.opening,salt}});
  return serialChannel(workspace,config.channel,async()=>{
    await assertOperating(workspace,config.channel);
    const current=await workspace.read(groups.openings,openingId);
    need(!current || current.streamKey===streamKey(config.channel),'MPP_CHANNEL_OPENING_ID_ALREADY_USED',409);
    if(current && hasSigned(current)) {
      need(current.profileId===profileKey(config),'MPP_CHANNEL_RESUME_ORIGINAL_OPENING',409);
      return openingView(current);
    }
    need(!current || ['DRAFT','CANCELLED'].includes(current.phase),
      'MPP_CHANNEL_RESUME_ORIGINAL_OPENING',409);
    const selected=await setupObservation(native,config);
    need(!selected.observation.channelPresent,'MPP_CHANNEL_ALREADY_OPEN_USE_ORIGINAL_CHANNEL',409);
    let bytes=selected.bytes,codeSource={kind:'selected-network',ledger:selected.observation.instanceLedger,
      rpcUrl:config.channel.rpcUrl};
    if(config.opening.codeMode==='upload') {
      bytes=await regular(config.opening.wasmFile,8*1024*1024);
      need(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])),
        'MPP_CHANNEL_WASM_BINARY_REQUIRED');
      need(hash(bytes)===config.channel.wasmSha256,'MPP_CHANNEL_SELECTED_WASM_CHANGED');
      codeSource={kind:'selected-file',path:config.opening.wasmFile};
    }
    need(bytes && bytes.length<=8*1024*1024 && hash(bytes)===config.channel.wasmSha256,
      'MPP_CHANNEL_RECEIVE_SELECTED_CODE_OR_CHOOSE_UPLOAD',409);
    const row={schema:'stellar-forge.mpp-channel-opening.v1',id:openingId,phase:'DRAFT',
      streamKey:streamKey(config.channel),config,profileId:profileKey(config),
      uploadRequired:!selected.observation.codePresent,
      codeData:{sha256:hash(bytes),bytes:bytes.length,bodyBase64:bytes.toString('base64'),source:codeSource},
      observation:selected.observation,transactions:{},activeStage:null,
      createdAt:current?.createdAt ?? now(),updatedAt:now(),
      unsignedHistory:[...(current?.unsignedHistory ?? []),...(current?[{profileId:current.profileId,
        phase:current.phase,config:current.config,updatedAt:current.updatedAt}]:[])]};
    await workspace.put('profiles',row.profileId,config);
    await workspace.update(groups.openings,row.id,latest=>{
      need(stable(latest)===stable(current),'MPP_CHANNEL_OPENING_PREPARATION_CHANGED',409);
      return {op:'set',value:row,result:row};
    });
    return openingView(row);
  });
}
async function runStage(workspace,row,native,stage,environment) {
  let transaction=row.transactions[stage],spec=specification(native,row,stage);
  if(transactionTerminal.has(transaction?.phase))return row;
  if(!transaction?.signedXdr) {
    const selected=await setupObservation(native,row.config);
    need(!selected.observation.channelPresent,'MPP_CHANNEL_OPENING_ORIGINAL_RESULT_REQUIRED',409);
    if(stage==='open')need(selected.observation.codePresent,
      'MPP_CHANNEL_SELECTED_CODE_RECEPTION_REQUIRED',409);
    const key=native.sdk.Keypair.fromSecret(environment[row.config.funding.keyEnv] ?? '');
    const envelope=await prepareChannelCall(native,spec,key);
    transaction={schema:'stellar-forge.mpp-channel-opening-transaction.v1',stage,phase:'SIGNED',
      config:row.config,profileId:row.profileId,openingId:row.id,observation:selected.observation,
      signedXdr:envelope.toXDR(),transaction:envelope.hash().toString('hex'),feeStroops:envelope.fee,
      expiresAt:new Date(Number(envelope.timeBounds.maxTime)*1000).toISOString(),createdAt:now(),updatedAt:now()};
    const committedFees=Object.values(row.transactions).reduce((sum,item)=>sum+BigInt(item.feeStroops ?? '0'),0n)+
      BigInt(transaction.feeStroops);
    need(committedFees<=BigInt(row.authority.review.maximumTotalFeeStroops),
      'MPP_CHANNEL_OPENING_TOTAL_FEE_EXCEEDED');
    row=await saveStage(workspace,row.id,stage,transaction);
  }
  transaction=await broadcastRetained(native,transaction,spec,async(current,change)=>{
    const next={...current,...change,updatedAt:now()};await saveStage(workspace,row.id,stage,next);return next;
  });
  const result=await transactionFinality(native,transaction,spec);
  return saveStage(workspace,row.id,stage,{...transaction,...result,updatedAt:now()});
}
export async function executeOpening({workspace,openingId,environment=process.env}) {
  const original=await readOpening(workspace,openingId);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await readOpening(workspace,openingId);await assertOperating(workspace,row.config.channel);
    const native=await loadChannelNative(await dependencyRootFor(workspace,row.config)),
      store=nativeStore(workspace,row.config.channel);
    if(terminal.has(row.phase))return openingView(await finish(workspace,row,native,store));
    if(row.phase==='DRAFT') {
      const selected=await setupObservation(native,row.config);
      need(!selected.observation.channelPresent,'MPP_CHANNEL_ALREADY_OPEN_USE_ORIGINAL_CHANNEL',409);
      need(selected.observation.codePresent || row.uploadRequired,
        'MPP_CHANNEL_CODE_RECEPTION_CHANGED_REPREPARE',409);
      const review={schema:'stellar-forge.mpp-channel-opening-authority.v1',openingId:row.id,
        profileId:row.profileId,operator:row.config.funding.operator,title:row.config.title,
        channel:row.config.channel,opening:row.config.opening,codeSource:row.codeData.source,
        codeBytes:row.codeData.bytes,uploadRequired:row.uploadRequired,
        feeAccount:row.config.funding.account,maximumFeeStroops:row.config.funding.maximumFeeStroops,
        maximumTotalFeeStroops:(BigInt(row.config.funding.maximumFeeStroops)*(row.uploadRequired?2n:1n)).toString(),
        taskAuthority:'The resulting channel is selected for separately authorized useful task budgets.',
        observation:selected.observation};
      const authority=await terminalConsent('Open and initially fund the selected channel',review,
        'OPEN '+row.id+' '+row.config.opening.initialAmountAtomic);
      row=await save(workspace,row,{phase:'AUTHORIZED',authority:{...authority,review}});
    }
    need(row.authority?.reviewSha256===hash(stable(row.authority.review)) &&
      row.authority.review.openingId===row.id && row.authority.review.profileId===row.profileId &&
      profileKey(openingConfig(row.config))===row.profileId &&
      row.authority.review.uploadRequired===row.uploadRequired,
      'MPP_CHANNEL_ORIGINAL_OPENING_AUTHORITY_REQUIRED');
    await acquireFinancialMarker(store,row.config.channel,owner(row),
      {authoritySha256:row.authority.reviewSha256});
    if(row.uploadRequired && row.transactions.code?.phase!=='SUCCESS') {
      row=await runStage(workspace,row,native,'code',environment);
      if(row.transactions.code?.phase!=='SUCCESS')return openingView(await finish(workspace,row,native,store));
    }
    row=await runStage(workspace,row,native,'open',environment);
    return openingView(await finish(workspace,row,native,store));
  });
}
export async function reconcileOpening({workspace,openingId,rpcUrl}) {
  const original=await readOpening(workspace,openingId);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await readOpening(workspace,openingId);await assertOperating(workspace,row.config.channel);
    const native=await loadChannelNative(await dependencyRootFor(workspace,row.config)),
      store=nativeStore(workspace,row.config.channel);
    if(terminal.has(row.phase))return openingView(await finish(workspace,row,native,store));
    need(row.activeStage && row.transactions[row.activeStage]?.signedXdr,
      'MPP_CHANNEL_OPENING_SIGNED_TRANSACTION_REQUIRED',409);
    const stage=row.activeStage,transaction=row.transactions[stage];
    if(!transactionTerminal.has(transaction.phase)) {
      const result=await transactionFinality(native,transaction,specification(native,row,stage),rpcUrl);
      row=await saveStage(workspace,row.id,stage,{...transaction,...result,updatedAt:now()});
    }
    return openingView(await finish(workspace,row,native,store));
  });
}
export async function cancelOpening({workspace,openingId}) {
  const original=await readOpening(workspace,openingId);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await readOpening(workspace,openingId);await assertOperating(workspace,row.config.channel);
    need(!row.transactions.open?.signedXdr &&
      (!row.transactions.code?.signedXdr || transactionTerminal.has(row.transactions.code.phase)),
      'MPP_CHANNEL_SIGNED_OPENING_REQUIRES_RECONCILIATION',409);
    need(row.phase!=='OPENED','MPP_CHANNEL_OPENING_ALREADY_COMPLETED',409);
    row=await save(workspace,row,{phase:'CANCELLED'});
    await clearFinancialMarker(nativeStore(workspace,row.config.channel),row.config.channel,owner(row));
    row=await save(workspace,row,{finalizedAt:row.finalizedAt ?? now()});return openingView(row);
  });
}
export { openingView } from './state.mjs';
