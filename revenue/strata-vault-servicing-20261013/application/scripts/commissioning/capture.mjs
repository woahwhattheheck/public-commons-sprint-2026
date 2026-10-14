import {check,copy,canonical,hash,validateRequest,READS,ROLES,CONTRACTS} from './selection.mjs';
export function nativeJSON(value,seen=new Set()){
 if(value===undefined)return null;
 if(typeof value==='bigint')return value.toString();
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){check(Number.isSafeInteger(value),'Unsafe numeric result; retain native XDR for this unreadable call.');return value;}
 check(typeof value==='object'&&!seen.has(value),'Cyclic/unsupported native result.');
 if(typeof value.toXDR==='function')return{encoding:'xdr-base64',content:value.toXDR('base64')};
 if(value instanceof Uint8Array)return{encoding:'base64',content:Buffer.from(value).toString('base64')};
 seen.add(value);let result;
 if(Array.isArray(value))result=value.map(v=>nativeJSON(v,seen));
 else if(value instanceof Map)result={encoding:'map-entries',entries:[...value].map(([k,v])=>[nativeJSON(k,seen),nativeJSON(v,seen)])};
 else{result={};for(const[k,v]of Object.entries(value))if(typeof v!=='function')result[k]=nativeJSON(v,seen);}
 seen.delete(value);return result;
}
function errorRecord(error){return{kind:'unreadable',error:{name:String(error?.name||'Error'),message:String(error?.message||error).slice(0,12000)}};}
export function contractOutcome(tx,Api){
 const simulation=tx?.simulation===undefined?null:nativeJSON(tx.simulation);
 if(tx?.simulation&&Api.isSimulationRestore(tx.simulation))return{kind:'archived',simulation};
 if(tx?.simulation&&Api.isSimulationError(tx.simulation)){const message=String(tx.simulation.error),m=message.match(/Error\(Contract, #(\d+)\)/);return{kind:m?'contract-error':'simulation-error',code:m?Number(m[1]):null,message,simulation};}
 try{return{kind:'value',value:nativeJSON(tx.result),simulation,isReadCall:typeof tx.isReadCall==='boolean'?tx.isReadCall:null};}
 catch(error){return{...errorRecord(error),simulation};}
}
export async function createStellarTransport(selection,{moduleRoot}={}){
 const [{createRequire},{readFileSync},{dirname,join,resolve}]=await Promise.all([import('node:module'),import('node:fs'),import('node:path')]);
 check(typeof moduleRoot==='string'&&moduleRoot,'Explicit original dependency root required.');const require=createRequire(join(resolve(moduleRoot),'package.json'));
 const {Client}=require('@stellar/stellar-sdk/contract'),sdk=require('@stellar/stellar-sdk');
 check(typeof Client?.from==='function'&&typeof sdk.rpc?.Server==='function'&&typeof sdk.Horizon?.Server==='function','Original SDK require exports are unavailable.');
let directory=dirname(require.resolve('@stellar/stellar-sdk')),version=null;
 for(let i=0;i<6;i++){try{const p=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));if(p.name==='@stellar/stellar-sdk'){version=p.version;break;}}catch{}directory=dirname(directory);}
 check(version==='16.1.0','Use the maintained repository SDK16.1.0 installation.');
 for(const id of Object.values(selection.contracts))check(sdk.StrKey.isValidContract(id),'Invalid selected contract checksum.');
 for(const a of [...selection.accounts.map(a=>a.address),...selection.bootstrapAccounts])check(sdk.StrKey.isValidEd25519PublicKey(a),'Invalid selected account checksum.');
 const rpc=new sdk.rpc.Server(selection.network.rpcUrl,{allowHttp:selection.network.allowHttp});
 const horizon=new sdk.Horizon.Server(selection.network.horizonUrl,{allowHttp:selection.network.allowHttp});
 const clients=new Map();
 async function client(name){if(!clients.has(name))clients.set(name,Client.from({contractId:selection.contracts[name],rpcUrl:selection.network.rpcUrl,networkPassphrase:selection.network.passphrase,allowHttp:selection.network.allowHttp,server:rpc}));return clients.get(name);}
 return{
  metadata:{sdk:'@stellar/stellar-sdk',version,contractSource:'stellar/js-stellar-sdk@v16.1.0'},
  network:async()=>({rpc:nativeJSON(await rpc.getNetwork()),horizon:nativeJSON(await horizon.root())}),
  ledger:async()=>nativeJSON(await rpc.getLatestLedger()),
  executable:async name=>{const instance=await rpc.getContractInstance(selection.contracts[name]),executable=instance.executable();return{kind:executable.switch()===sdk.xdr.ContractExecutableType.contractExecutableStellarAsset()?'stellar-asset':'wasm',wasmSha256:executable.switch()===sdk.xdr.ContractExecutableType.contractExecutableStellarAsset()?null:executable.wasmHash().toString('hex'),instanceXdr:instance.toXDR('base64')};},
  account:async address=>nativeJSON(await horizon.accounts().accountId(address).call()),
  contract:async(name,method,args)=>{
   check(READS[name]?.includes(method)||(['async_vault','nav_oracle','share_token'].includes(name)&&['get_role_member_count','get_role_member'].includes(method))||(name==='identity_verifier'&&method==='is_allowed'),'Method is outside the fixed read allowlist.');
   const c=await client(name);check(c.spec.funcs().some(f=>f.name().toString()===method)&&typeof c[method]==='function','Selected contract spec does not expose '+name+'.'+method);
   // No wallet, signer, signing callback, transaction submission or restore is supplied.
   return contractOutcome(args===null?await c[method]():await c[method](args),sdk.rpc.Api);
  }
 };
}
const addressPattern=/^[GC][A-Z2-7]{55}$/;
export async function capture(request,transport,io,{now=()=>new Date().toISOString(),attemptId}={}){
 const r=validateRequest(request),s=r.selection;check(typeof attemptId==='function','An explicit unique attempt ID supplier is required.');
 const complete=await io.read('complete.json');if(complete){validateCapture(complete,r);return complete;}
 const accepted=await io.read('request.json');if(accepted)check(canonical(accepted)===canonical(r),'Directory belongs to another request.');else await io.publish('request.json',r);
 const guardId=attemptId();check(/^[A-Za-z0-9_-]+$/.test(guardId),'Unsafe attempt ID.');
 const guard={schema:'strata.commissioning-network-check/v1',operationId:r.operationId,attemptId:guardId,startedAt:now(),expectedPassphrase:s.network.passphrase};
 await io.publish('network/'+guardId+'.request.json',guard);
 let network;try{network={kind:'value',value:await transport.network()};}catch(error){network=errorRecord(error);}
 const guardResult={...guard,completedAt:now(),outcome:network};await io.publish('network/'+guardId+'.result.json',guardResult);
 check(network.kind==='value'&&network.value.rpc?.passphrase===s.network.passphrase&&network.value.horizon?.network_passphrase===s.network.passphrase,'The selected RPC and Horizon networks could not be verified; no contract or account read was issued.');
 const records=[];
 async function observe(key,call,run){
  check(/^[A-Za-z0-9_.-]+$/.test(key),'Unsafe observation key.');
  const path='observations/'+key+'.json',old=await io.read(path);
  if(old){check(old.schema==='strata.commissioning-observation/v1'&&old.operationId===r.operationId&&old.selectionSha256===r.selectionSha256&&old.key===key&&canonical(old.call)===canonical(call),'Observation identity changed.');records.push(old);return old.outcome;}
  const id=attemptId(),intent={schema:'strata.commissioning-read-attempt/v1',operationId:r.operationId,selectionSha256:r.selectionSha256,key,call,attemptId:id,startedAt:now(),networkCheck:guardId};
  check(/^[A-Za-z0-9_-]+$/.test(id),'Unsafe attempt ID.');await io.publish('attempts/'+key+'-'+id+'.json',intent);
  let outcome;try{outcome=await run();canonical(outcome);}catch(error){outcome=errorRecord(error);}
  const receipt={...intent,schema:'strata.commissioning-observation/v1',completedAt:now(),outcome};
  await io.publish(path,receipt);records.push(receipt);return outcome;
 }
 const before=await observe('ledger.before',{kind:'rpc',method:'getLatestLedger'},async()=>({kind:'value',value:await transport.ledger()}));
 for(const name of CONTRACTS)await observe(name+'.executable.before',{kind:'rpc-executable',contract:name,address:s.contracts[name]},async()=>({kind:'value',value:await transport.executable(name)}));
 for(const[name,methods]of Object.entries(READS))for(const method of methods)await observe(name+'.'+method,{kind:'contract',contract:name,address:s.contracts[name],method,args:null},()=>transport.contract(name,method,null));
 await observe('identity_verifier.is_allowed.vault',{kind:'contract',contract:'identity_verifier',address:s.contracts.identity_verifier,method:'is_allowed',args:{account:s.contracts.async_vault}},()=>transport.contract('identity_verifier','is_allowed',{account:s.contracts.async_vault}));
 const roles=[];
 for(const[name,role]of ROLES){
  const base=name+'.role.'+role,args={role};
  const first=await observe(base+'.count.before',{kind:'contract',contract:name,address:s.contracts[name],method:'get_role_member_count',args},()=>transport.contract(name,'get_role_member_count',args));
  const members=[];let reason=null;
  if(first.kind!=='value'||!Number.isSafeInteger(first.value)||first.value<0||first.value>256)reason='Role count is unreadable or outside the explicit256-member receiving bound.';
  else{
   for(let index=0;index<first.value;index++){const a={role,index};const value=await observe(base+'.member.'+index,{kind:'contract',contract:name,address:s.contracts[name],method:'get_role_member',args:a},()=>transport.contract(name,'get_role_member',a));if(value.kind==='value'&&typeof value.value==='string'&&addressPattern.test(value.value))members.push(value.value);else reason='At least one role member is unreadable or malformed.';}
  }
  const last=await observe(base+'.count.after',{kind:'contract',contract:name,address:s.contracts[name],method:'get_role_member_count',args},()=>transport.contract(name,'get_role_member_count',args));
  if(last.kind!=='value'||first.kind!=='value'||last.value!==first.value)reason='Role count changed or could not be verified after enumeration.';
  if(new Set(members).size!==members.length)reason='Duplicate members in the observed role enumeration.';
  roles.push({contract:name,role,members,complete:reason===null,countBefore:first,countAfter:last,reason,atomicSnapshot:false});
 }
 const accounts=new Set([...s.accounts.map(a=>a.address),...s.bootstrapAccounts]);
 for(const role of roles)for(const a of role.members)if(a.startsWith('G'))accounts.add(a);
 for(const record of records){const o=record.outcome;if(record.call.kind==='contract'&&o.kind==='value'&&typeof o.value==='string'&&/^G[A-Z2-7]{55}$/.test(o.value))accounts.add(o.value);}
 check(accounts.size<=1024,'Observed authorities exceed the1024-account receiving bound.');
 for(const address of [...accounts].sort())await observe('account.'+address,{kind:'horizon',method:'account',address},async()=>({kind:'value',value:await transport.account(address)}));
 for(const name of CONTRACTS)await observe(name+'.executable.after',{kind:'rpc-executable',contract:name,address:s.contracts[name]},async()=>({kind:'value',value:await transport.executable(name)}));
 const after=await observe('ledger.after',{kind:'rpc',method:'getLatestLedger'},async()=>({kind:'value',value:await transport.ledger()}));
 const networkChecks=[];for(const id of new Set([guardId,...records.map(o=>o.networkCheck)])){const proof=await io.read('network/'+id+'.result.json');check(proof,'Missing retained network proof.');networkChecks.push(proof);}
 const body={schema:'strata.commissioning-capture/v1',request:r,transport:copy(transport.metadata),sourceAnchors:copy(io.source),receiverSource:copy(io.receiverSource),startedAt:records[0].startedAt,completedAt:records.at(-1).completedAt,networkCheck:guardResult,networkChecks,ledgerRange:{before,after,atomicSnapshot:false},roles,observations:records,limitations:['Read-only observations may span multiple ledgers and restarts.','A complete observed member count is not an atomic membership snapshot.','No transaction, grant, restore, signing, deployment or acceptance is performed.','Source code and public account observations cannot establish external legal or operational authority.','Observed executable hashes are not a source-to-WASM reproducible-build proof; only explicitly supplied artifact hashes are compared.']};
 const result={...body,sha256:hash(body)};validateCapture(result,r);await io.publish('complete.json',result);return result;
}
export function validateCapture(value,request=null){
 check(value&&value.schema==='strata.commissioning-capture/v1','Unsupported capture.');const{sha256,...body}=value;check(hash(body)===sha256,'Capture checksum mismatch.');const r=validateRequest(value.request),s=r.selection;if(request)check(canonical(request)===canonical(r),'Capture request mismatch.');
 check(Array.isArray(value.observations)&&value.observations.length<=4000&&Array.isArray(value.roles)&&value.roles.length===ROLES.length,'Invalid complete observation/role collection.');
 const by=new Map();for(const o of value.observations){
  check(o.schema==='strata.commissioning-observation/v1'&&o.operationId===r.operationId&&o.selectionSha256===r.selectionSha256&&!by.has(o.key),'Capture observation identity mismatch.');
  check(new Date(o.startedAt).toISOString()===o.startedAt&&new Date(o.completedAt).toISOString()===o.completedAt,'Invalid original observation time.');
  check(['value','archived','contract-error','simulation-error','unreadable'].includes(o.outcome?.kind),'Invalid native outcome.');
  by.set(o.key,o);
 }
 const expected=new Set();function read(key,call){const o=by.get(key);check(o&&canonical(o.call)===canonical(call),'Missing/changed complete observation: '+key);expected.add(key);return o.outcome;}
 for(const position of ['before','after']){
  read('ledger.'+position,{kind:'rpc',method:'getLatestLedger'});
  for(const name of CONTRACTS)read(name+'.executable.'+position,{kind:'rpc-executable',contract:name,address:s.contracts[name]});
 }
 for(const[name,methods]of Object.entries(READS))for(const method of methods)read(name+'.'+method,{kind:'contract',contract:name,address:s.contracts[name],method,args:null});
 read('identity_verifier.is_allowed.vault',{kind:'contract',contract:'identity_verifier',address:s.contracts.identity_verifier,method:'is_allowed',args:{account:s.contracts.async_vault}});
 const accounts=new Set([...s.accounts.map(a=>a.address),...s.bootstrapAccounts]);
 for(const[name,role]of ROLES){
  const base=name+'.role.'+role,call={kind:'contract',contract:name,address:s.contracts[name],method:'get_role_member_count',args:{role}};
  const first=read(base+'.count.before',call),last=read(base+'.count.after',call),members=[];let reason=null;
  if(first.kind!=='value'||!Number.isSafeInteger(first.value)||first.value<0||first.value>256)reason='Role count is unreadable or outside the explicit256-member receiving bound.';
  else for(let index=0;index<first.value;index++){const o=read(base+'.member.'+index,{kind:'contract',contract:name,address:s.contracts[name],method:'get_role_member',args:{role,index}});if(o.kind==='value'&&typeof o.value==='string'&&addressPattern.test(o.value))members.push(o.value);else reason='At least one role member is unreadable or malformed.';}
  if(last.kind!=='value'||first.kind!=='value'||last.value!==first.value)reason='Role count changed or could not be verified after enumeration.';
  if(new Set(members).size!==members.length)reason='Duplicate members in the observed role enumeration.';
  const derived={contract:name,role,members,complete:reason===null,countBefore:first,countAfter:last,reason,atomicSnapshot:false};
  check(canonical(derived)===canonical(value.roles.find(x=>x.contract===name&&x.role===role)),'Derived role proof differs.');
  for(const a of members)if(a.startsWith('G'))accounts.add(a);
 }
 for(const o of value.observations)if(o.call.kind==='contract'&&o.outcome.kind==='value'&&typeof o.outcome.value==='string'&&/^G[A-Z2-7]{55}$/.test(o.outcome.value))accounts.add(o.outcome.value);
 check(accounts.size<=1024,'Account receiving bound exceeded.');for(const address of accounts)read('account.'+address,{kind:'horizon',method:'account',address});
 check(expected.size===by.size,'Unexpected observations in the frozen capture.');
 check(canonical(value.ledgerRange)===canonical({before:by.get('ledger.before').outcome,after:by.get('ledger.after').outcome,atomicSnapshot:false}),'Ledger interval differs from original observations.');
 const guards=new Map();check(Array.isArray(value.networkChecks),'Complete network guards required.');for(const g of value.networkChecks){check(g.schema==='strata.commissioning-network-check/v1'&&g.operationId===r.operationId&&!guards.has(g.attemptId)&&g.expectedPassphrase===s.network.passphrase&&g.outcome?.kind==='value'&&g.outcome.value.rpc?.passphrase===s.network.passphrase&&g.outcome.value.horizon?.network_passphrase===s.network.passphrase,'Network provenance differs.');guards.set(g.attemptId,g);}
 check(canonical(guards.get(value.networkCheck.attemptId))===canonical(value.networkCheck),'Final network guard differs.');for(const o of value.observations)check(guards.has(o.networkCheck),'Original network guard missing for observation.');
 check(value.startedAt===value.observations[0].startedAt&&value.completedAt===value.observations.at(-1).completedAt,'Original capture completion changed.');
 return value;
}
