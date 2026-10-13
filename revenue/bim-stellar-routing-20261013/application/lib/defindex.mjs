import {need,object,exactKeys,integer,small,safeNumber,jsonValue,canonical,https,address,wallet,providerBinding,assertBinding,evidence,requestJSON,createStellarTools} from './stellar-provider.mjs';

const ID='defindex',BASE='https://api.defindex.io';
const NETWORKS={mainnet:'Public Global Stellar Network ; September 2015',testnet:'Test SDF Network ; September 2015'};
const SOURCE={sdk:{repository:'defindex-io/defindex-sdk',commit:'bbee7f83b0a2f87b34066918647eb7099be046db',version:'0.3.0'},contracts:{repository:'defindex-io/stellar-contracts',commit:'be878a9c1b0b176ec4351a85dad5557425c4a97c',paths:['vault/src/lib.rs','vault/src/deposit.rs','vault/src/interface.rs','vault/src/token/contract.rs']}};
const f=(name,type,required=true)=>({name,type,required});
export function createDefindexAdapter({sdk}){
 const catalogue=[
  {id:'defindex.discover',label:'Discover original vaults',mode:'read',fields:[]},
  {id:'defindex.vault',label:'Read full vault assets, fees and strategies',mode:'read',fields:[f('vault','string')]},
  {id:'defindex.position',label:'Read exact native shares and underlying position',mode:'read',fields:[f('vault','string'),f('owner','string',false),f('transactionSource','string',false)]},
  {id:'defindex.deposit.prepare',label:'Prepare exact i128 native vault deposit',mode:'prepare',fields:[f('vaultEvidenceId','evidence-id'),f('amounts','integer-text[]'),f('minAmounts','integer-text[]'),f('invest','boolean'),f('ttlSeconds','integer-text',false)]},
  {id:'defindex.withdraw.prepare',label:'Prepare exact native share withdrawal',mode:'prepare',fields:[f('vaultEvidenceId','evidence-id'),f('shares','integer-text'),f('minAmounts','integer-text[]'),f('ttlSeconds','integer-text',false)]},
  {id:'defindex.http.prepare',label:'Prepare issued vault API transaction',mode:'prepare',fields:[f('vaultEvidenceId','evidence-id'),f('operation','deposit|withdraw|withdraw-shares'),f('amounts','integer-text[]',false),f('shares','integer-text',false),f('invest','boolean',false),f('slippageBps','integer-text'),f('minAmounts','integer-text[]',false),f('maxShares','integer-text',false)]},
  {id:'defindex.confirm',label:'Confirm original vault wallet submission',mode:'read',fields:[f('submissionId','evidence-id')]}
 ].map(d=>({...d,origins:[BASE],source:SOURCE}));
 function config(ctx){const binding=providerBinding(ctx,ID),p=binding.provider;need(Object.hasOwn(NETWORKS,p.environment)&&binding.network.passphrase===NETWORKS[p.environment],'Select matching explicit DeFindex network and passphrase.');const u=https(p.baseUrl||BASE);need(u.origin===BASE&&!u.search,'Use the issued DeFindex API origin.');return {binding,p,base:u.href.replace(/\/$/,''),network:p.environment};}
 async function api(ctx,c,path,body){const u=new URL(c.base+path);u.searchParams.set('network',c.network);return requestJSON(ctx,{url:u.href,method:body===undefined?'GET':'POST',body,credential:c.p.credentialAlias});}
 const vector=values=>sdk.xdr.ScVal.scvVec(values.map(v=>sdk.nativeToScVal(integer(v),{type:'i128'})));
 const addr=value=>new sdk.Address(value).toScVal();
 function amounts(v,count,positive=false){need(Array.isArray(v)&&v.length===count,'Keep one exact amount for each original vault asset, in its original order.');const n=v.map(x=>integer(x));if(positive)need(n.some(x=>x>0n),'Select a positive deposit/withdrawal amount.');return v;}
 function selectedVault(ctx,c,id){const row=evidence(ctx,id,r=>r.actionId==='defindex.vault'),v=row.value;need(v?.kind==='defindex-vault'&&Array.isArray(v.info?.assets)&&v.info.assets.length>0,'Select the complete original vault information.');assertBinding(ctx,ID,v.binding);address(sdk,v.vault,true);for(const asset of v.info.assets)address(sdk,asset.address,true);need(new Set(v.info.assets.map(a=>a.address)).size===v.info.assets.length,'Original vault asset order contains duplicates.');return {row,value:v,vault:v.vault,assets:v.info.assets.map(a=>a.address)};}
 function fee(c,plan){const cap=c.p.publicConfig?.maxFeeStroops;if(cap&&plan.selection?.fee)need(BigInt(plan.selection.fee)<=integer(cap,{positive:true}),'Original transaction fee exceeds the selected provider wallet limit.');}
 async function currentAssets(tools,selected,source,ttl){
  const seen=await tools.simulateCall({contractId:selected.vault,method:'get_assets',args:[],source,timeoutSeconds:ttl});
  need(seen.status==='SIMULATED'&&Array.isArray(seen.returnValue),'Current complete native vault assets could not be simulated.');
  const assets=seen.returnValue.map(a=>a.address);need(canonical(assets)===canonical(selected.assets),'Current native vault asset order differs from the selected original evidence.');return seen;
 }
 async function execute(action,input,ctx){
  const c=config(ctx),tools=createStellarTools(sdk,ctx);
  if(action==='defindex.discover'){exactKeys(input,[]);const r=await api(ctx,c,'/vault/discover');return {kind:'defindex-vault-discovery',binding:c.binding,discovery:r.value,exchangeIds:[r.exchangeId],source:SOURCE};}
  if(action==='defindex.vault'){
   exactKeys(input,['vault'],['vault']);address(sdk,input.vault,true);const r=await api(ctx,c,'/vault/'+encodeURIComponent(input.vault));need(object(r.value)&&Array.isArray(r.value.assets),'Retain the complete original vault response.');
   return {kind:'defindex-vault',binding:c.binding,vault:input.vault,info:r.value,originalJSON:r.exchange.text,exchangeIds:[r.exchangeId],source:SOURCE};
  }
  if(action==='defindex.position'){
   exactKeys(input,['vault','owner','transactionSource'],['vault']);address(sdk,input.vault,true);const owner=input.owner||wallet(sdk,ctx);address(sdk,owner);
   const source=input.transactionSource||wallet(sdk,ctx);address(sdk,source);
   const balance=await tools.simulateCall({contractId:input.vault,method:'balance',args:[addr(owner)],source});
   if(balance.status!=='SIMULATED')return {kind:'defindex-position',status:'NEEDS_REVIEW',vault:input.vault,owner,balance,binding:c.binding,exchangeIds:tools.exchangeIds()};
   const shares=String(balance.returnValue);integer(shares);
   const underlying=await tools.simulateCall({contractId:input.vault,method:'get_asset_amounts_per_shares',args:[sdk.nativeToScVal(BigInt(shares),{type:'i128'})],source});
   const assets=await tools.simulateCall({contractId:input.vault,method:'get_assets',args:[],source});
   return {kind:'defindex-position',status:underlying.status==='SIMULATED'&&assets.status==='SIMULATED'?'OBSERVED':'NEEDS_REVIEW',binding:c.binding,vault:input.vault,owner,shares,underlyingAmounts:underlying.returnValue,assets:assets.returnValue,
     basis:'Complete original RPC simulations; not a single atomic ledger snapshot. Fee/report changes inside get_asset_amounts_per_shares were simulated only and were not submitted.',
     simulations:{balance,underlying,assets},exchangeIds:tools.exchangeIds(),source:SOURCE};
  }
  if(action==='defindex.deposit.prepare'||action==='defindex.withdraw.prepare'){
   const depositing=action==='defindex.deposit.prepare';exactKeys(input,depositing?['vaultEvidenceId','amounts','minAmounts','invest','ttlSeconds']:['vaultEvidenceId','shares','minAmounts','ttlSeconds'],depositing?['vaultEvidenceId','amounts','minAmounts','invest']:['vaultEvidenceId','shares','minAmounts']);
   const selected=selectedVault(ctx,c,input.vaultEvidenceId),owner=wallet(sdk,ctx);need(sdk.StrKey.isValidEd25519PublicKey(owner),'Direct prepared transaction signing currently requires a G-address wallet. Select the issued HTTP smart-wallet operation workflow for a C-address.');
   const ttl=input.ttlSeconds===undefined?300:Number(integer(input.ttlSeconds,{positive:true,max:3600n}));small(ttl,1,3600);amounts(input.minAmounts,selected.assets.length);
   let method,args;
   if(depositing){amounts(input.amounts,selected.assets.length,true);need(typeof input.invest==='boolean','Explicitly select whether to invest.');for(let i=0;i<input.amounts.length;i++)need(BigInt(input.minAmounts[i])<=BigInt(input.amounts[i]),'Deposit minimum exceeds its exact desired amount.');method='deposit';args=[vector(input.amounts),vector(input.minAmounts),addr(owner),sdk.xdr.ScVal.scvBool(input.invest)];}
   else{integer(input.shares,{positive:true});method='withdraw';args=[sdk.nativeToScVal(BigInt(input.shares),{type:'i128'}),vector(input.minAmounts),addr(owner)];}
   const observedAssets=await currentAssets(tools,selected,owner,ttl),plan=await tools.prepareCall({contractId:selected.vault,method,args,source:owner,timeoutSeconds:ttl});fee(c,plan);
   return {...plan,kind:'defindex-plan',provider:ID,binding:c.binding,vaultEvidenceId:selected.row.id,vault:selected.vault,assets:selected.assets,operation:method,request:input,observedAssets,
     selection:{...plan.selection,vault:selected.vault,assets:selected.assets,owner,method,amounts:input.amounts||null,shares:input.shares||null,minAmounts:input.minAmounts,invest:input.invest??null},
     exchangeIds:[...new Set([...selected.value.exchangeIds,...tools.exchangeIds()])],source:SOURCE};
  }
  if(action==='defindex.http.prepare'){
   exactKeys(input,['vaultEvidenceId','operation','amounts','shares','invest','slippageBps','minAmounts','maxShares'],['vaultEvidenceId','operation','slippageBps']);
   const selected=selectedVault(ctx,c,input.vaultEvidenceId),owner=wallet(sdk,ctx);need(['deposit','withdraw','withdraw-shares'].includes(input.operation),'Select the original issued vault operation.');
   const bps=Number(integer(input.slippageBps,{max:10000n})),body={caller:owner,slippageBps:bps};
   if(input.operation==='deposit')need(input.minAmounts===undefined&&input.maxShares===undefined,'Deposit uses desired amounts and its explicit slippage bound.');
   else{amounts(input.minAmounts,selected.assets.length);if(input.operation==='withdraw')integer(input.maxShares,{positive:true});else need(input.maxShares===undefined,'Exact-share withdrawal already freezes the share burn.');}
   if(input.operation==='withdraw-shares'){integer(input.shares,{positive:true});need(input.amounts===undefined&&input.invest===undefined,'Share withdrawal does not take asset amounts or investment choice.');body.shares=safeNumber(input.shares);}
   else{amounts(input.amounts,selected.assets.length,true);need(input.shares===undefined,'Asset amount workflow does not take a share amount.');body.amounts=input.amounts.map(safeNumber);if(input.operation==='deposit'){need(typeof input.invest==='boolean','Explicitly select whether to invest.');body.invest=input.invest;}else need(input.invest===undefined,'Withdrawal has no investment option.');}
   const r=await api(ctx,c,'/vault/'+encodeURIComponent(selected.vault)+'/'+input.operation,body),original=r.value;
   function checkOperation(op){
   const method=input.operation==='deposit'?'deposit':'withdraw';need(op.type==='invokeHostFunction'&&op.contractId===selected.vault&&op.method===method,'Original API transaction calls a different contract or method.');
   if(method==='deposit'){
    need(op.args.length===4&&canonical(op.args[0])===canonical(input.amounts)&&op.args[2]===owner&&op.args[3]===input.invest,'Original deposit caller, desired amounts or investment choice differs.');
    need(Array.isArray(op.args[1])&&op.args[1].length===input.amounts.length,'Original deposit minima are incomplete.');
    for(let i=0;i<input.amounts.length;i++)need(integer(String(op.args[1][i]))>=BigInt(input.amounts[i])*BigInt(10000-bps)/10000n,'Original API deposit weakens selected minimum.');
   }else{
    need(op.args.length===3&&op.args[2]===owner,'Original withdrawal caller differs.');integer(String(op.args[0]),{positive:true});need(Array.isArray(op.args[1])&&op.args[1].length===selected.assets.length,'Original withdrawal output minima are incomplete.');
    if(input.operation==='withdraw-shares')need(String(op.args[0])===input.shares,'Original withdrawal share amount differs.');
    else need(BigInt(op.args[0])<=BigInt(input.maxShares),'Original API withdrawal exceeds the explicit maximum share burn.');
    for(let i=0;i<input.minAmounts.length;i++)need(integer(String(op.args[1][i]))>=BigInt(input.minAmounts[i]),'Original API withdrawal weakens the exact operator minimum output.');
    if(input.operation==='withdraw')for(let i=0;i<input.amounts.length;i++)need(integer(String(op.args[1][i]))>=BigInt(input.amounts[i])*BigInt(10000-bps)/10000n,'Original API withdrawal weakens selected minimum.');
   }
   }
   if(original.isSmartWallet===true){
    need(sdk.StrKey.isValidContract(owner)&&original.xdr===null&&typeof original.operationXDR==='string','Complete original C-wallet operation is required.');
    const raw=sdk.xdr.Operation.fromXDR(original.operationXDR,'base64'),body=raw.body();need(body.switch().name==='invokeHostFunction','Original smart-wallet payload must be a contract invocation.');
    const host=body.invokeHostFunctionOp(),func=host.hostFunction();need(func.switch().name==='hostFunctionTypeInvokeContract','Original smart-wallet host function differs.');
    const call=func.invokeContract(),op={type:'invokeHostFunction',contractId:sdk.Address.fromScAddress(call.contractAddress()).toString(),method:call.functionName().toString(),args:call.args().map(x=>jsonValue(sdk.scValToNative(x))),argsXdr:call.args().map(x=>x.toXDR('base64')),authorizationXdr:host.auth().map(x=>x.toXDR('base64'))};
    checkOperation(op);
    return {kind:'defindex-plan',provider:ID,status:'NEEDS_REVIEW',binding:c.binding,vault:selected.vault,vaultEvidenceId:selected.row.id,assets:selected.assets,request:input,
      unsignedPayload:{kind:'stellar-operation',operationXDR:original.operationXDR,networkId:c.binding.network.id,networkPassphrase:c.binding.network.passphrase,source:owner},
      selection:{owner,vault:selected.vault,assets:selected.assets,request:input,operation:op,operationXDR:raw.toXDR('base64')},providerResponse:original,
      findings:['The selected C-address wallet must supply its own complete envelope and contract authorization; an operation XDR is not a signed or submitted transaction.'],
      exchangeIds:[...selected.value.exchangeIds,r.exchangeId],source:SOURCE};
   }
   need(sdk.StrKey.isValidEd25519PublicKey(owner)&&typeof original.xdr==='string','Classic wallet requires the complete unsigned transaction XDR.');
   const inspected=tools.inspectEnvelope({xdr:original.xdr,expectedSource:owner});need(!inspected.feeBump&&inspected.signatures.length===0&&inspected.operations.length===1,'Select one complete unsigned original vault invocation.');
   checkOperation(inspected.operations[0]);
   const simulated=await tools.simulateEnvelope({xdr:original.xdr,expectedSource:owner}),plan=tools.prepareSimulation(simulated);fee(c,plan);
   return {...plan,kind:'defindex-plan',provider:ID,binding:c.binding,vault:selected.vault,vaultEvidenceId:selected.row.id,assets:selected.assets,request:input,providerResponse:original,
     selection:{...plan.selection,owner,vault:selected.vault,assets:selected.assets,request:input},exchangeIds:[...new Set([...selected.value.exchangeIds,r.exchangeId,...tools.exchangeIds()])],source:SOURCE};
  }
  if(action==='defindex.confirm'){
   exactKeys(input,['submissionId'],['submissionId']);const s=evidence(ctx,input.submissionId,r=>r.planId&&r.submission),p=evidence(ctx,s.planId,r=>String(r.actionId).startsWith('defindex.')&&r.value?.kind==='defindex-plan');assertBinding(ctx,ID,p.value.binding);const payload=p.unsignedPayload||p.value.unsignedPayload;
   need(payload?.kind==='stellar-xdr','The complete original wallet envelope plan is required for native confirmation.');
   const result=await tools.confirm({transactionHash:s.submission.transactionHash,signedXdr:s.submission.signedXdr||s.submission.xdr,expectedSource:payload.source});
   if(result.observed)need(result.observed.innerTransactionHash===payload.transactionHash,'Observed vault transaction differs from the prepared original plan.');
   return {...result,kind:'defindex-confirmation',submissionId:s.id,planId:p.id,vault:p.value.vault,originalPlan:p.value};
  }
  throw new Error('Unsupported DeFindex action: '+action);
 }
 return {catalogue,execute};
}
