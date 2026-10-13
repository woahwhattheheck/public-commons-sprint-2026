'use strict';
async function runCommissioningSourceChecks(core,example,anchors){
 function assert(ok,message){if(!ok)throw new Error(message);}
 const sample=core.copy(example),A='G'+'A'.repeat(55),B='G'+'B'.repeat(55);
 sample.title='Synthetic actual-source commissioning exercise';
 sample.roles=[{contract:'nav_oracle',role:'attester',members:[A]}];
 sample.accounts=[{address:A,thresholds:{low_threshold:1,med_threshold:2,high_threshold:3},signers:[{key:A,type:'ed25519_public_key',weight:1},{key:'X'+'C'.repeat(55),type:'sha256_hash',weight:1}]}];
 sample.bootstrapAccounts=[B];sample.expected['async_vault.net_deployed']='-9999999999999999999999999999';
 const request=core.requestFor(sample,'strata-source-exercise','2026-10-13T20:40:00.000Z');
 function fixture(){
  const disk=new Map();let reads=0,attempt=0,failKey=null,networkWrong=false,changedCount=false,countReads=0;
  const io={source:anchors,receiverSource:[],read:async key=>disk.has(key)?core.copy(disk.get(key)):null,publish:async(key,value)=>{const old=disk.get(key);if(old&&core.canonical(old)!==core.canonical(value))throw Error('conflict '+key);disk.set(key,core.copy(value));if(key===failKey){failKey=null;throw Error('synthetic lost response');}}};
  const transport={metadata:{kind:'synthetic-source-exercise'},network:async()=>{reads++;return{rpc:{passphrase:sample.network.passphrase},horizon:{network_passphrase:networkWrong?'different':sample.network.passphrase}}},ledger:async()=>{reads++;return{sequence:1234,closeTime:'1791924000'}},executable:async()=>{reads++;return{kind:'wasm',wasmSha256:'a'.repeat(64),instanceXdr:'retained-synthetic-xdr'}},account:async a=>{reads++;return a===A?{account_id:A,thresholds:sample.accounts[0].thresholds,signers:sample.accounts[0].signers}:{account_id:a,thresholds:{low_threshold:0,med_threshold:0,high_threshold:0},signers:[{key:a,type:'ed25519_public_key',weight:0}]}},contract:async(name,method,args)=>{reads++;let value=null;
   if(method==='get_role_member_count'){value=args.role==='attester'?1:0;if(changedCount&&args.role==='attester'&&++countReads===2)value=2;}
   else if(method==='get_role_member')value=A;
   else if(name==='async_vault'&&['asset','share_token','oracle'].includes(method))value=sample.contracts[method==='oracle'?'nav_oracle':method];
   else if(name==='share_token'&&['compliance','identity_verifier'].includes(method))value=sample.contracts[method];
   else if(method==='is_allowed')value=true;else if(method==='linked_tokens')value=[sample.contracts.share_token];
   else if(method==='config')value={freshness_duration:'3600',cooldown_secs:'60',max_up_bps:1000,max_down_bps:null,min_answer:'500000000000000000',max_answer:'100000000000000000000'};else if(method==='net_deployed')value=sample.expected['async_vault.net_deployed'];
   return{kind:'value',value,simulation:{latestLedger:1234}};
  }};
  return{disk,io,transport,options:{now:()=>request.createdAt,attemptId:()=> 'synthetic_'+(++attempt)},get reads(){return reads},setFail:key=>{failKey=key},setWrong:()=>{networkWrong=true},setChanged:()=>{changedCount=true}};
 }
 const checks=[];
 const a=fixture(),capture=await core.capture(request,a.transport,a.io,a.options),assessment=core.assess(capture);
 assert(JSON.stringify(capture).includes('-9999999999999999999999999999'),'Wide integer changed.');
 const html=core.renderReport(capture),csv=core.csv(capture);assert(html.includes('sha256_hash')&&csv.includes('-9999999999999999999999999999'),'Full outputs lost typed evidence.');
 checks.push('Complete native-wide integer and all-signer-type evidence survives capture/report/CSV.');
 const before=a.reads,replayed=await core.capture(request,a.transport,a.io,a.options);assert(a.reads===before&&core.hash(capture)===core.hash(replayed),'Complete replay performed reads/changed bytes.');checks.push('Completed capture reopens byte-identically without further reads.');
 const deployment={network:'testnet',deployedAt:request.createdAt,ledger:1234,asset:{code:'USDC',issuer:A,contract:sample.contracts.asset},contracts:sample.contracts,accounts:{deployer:{public:A,secret:'never-publish'}},extra:{secret:'never-publish'}};
 assert(!JSON.stringify(core.publicDeployment(deployment)).includes('never-publish'),'Private Deployment leaked.');checks.push('Original complete Deployment projection retains defined public fields and omits secret/unknown data.');
 const b=fixture();b.setFail('complete.json');let failed=false;try{await core.capture(request,b.transport,b.io,b.options)}catch{failed=true}assert(failed,'Lost response was not injected.');const br=b.reads;const restored=await core.capture(request,b.transport,b.io,b.options);assert(b.reads===br&&core.hash(restored)===core.hash(capture),'Post-commit lost response failed exact reopen.');checks.push('Lost response after complete publication reopens original completion with zero new reads.');
 const c=fixture();c.setFail('observations/async_vault.asset.json');try{await core.capture(request,c.transport,c.io,c.options)}catch{}const retained=core.copy(c.disk.get('observations/async_vault.asset.json'));await core.capture(request,c.transport,c.io,c.options);assert(core.canonical(retained)===core.canonical(c.disk.get('observations/async_vault.asset.json')),'Retained observation was replaced.');checks.push('Interrupted capture preserves accepted original observations while recording fresh attempts only for missing reads.');
 const d=fixture();d.setWrong();failed=false;try{await core.capture(request,d.transport,d.io,d.options)}catch{failed=true}assert(failed&&d.reads===1,'Wrong Horizon network permitted contract/account reads.');checks.push('Wrong Horizon network stops before all contract/account reads.');
 const e=fixture();e.setChanged();const changed=await core.capture(request,e.transport,e.io,e.options);assert(changed.roles.find(r=>r.role==='attester').complete===false&&core.assess(changed).rows.find(r=>r.id==='nav_oracle.role.attester').status==='UNKNOWN','Role count drift treated as complete.');checks.push('Changed role count retains full source and yields UNKNOWN.');
 let changedRequest=core.copy(request);changedRequest.selection.title='changed';changedRequest.selectionSha256=core.hash(changedRequest.selection);failed=false;try{await core.capture(changedRequest,a.transport,a.io,a.options)}catch{failed=true}assert(failed&&a.reads===before,'Changed original operation was accepted.');checks.push('Changed retained request is rejected without network reads.');
 return{schema:'strata.commissioning-source-execution/v1',nativeExecuted:false,providerCalls:0,actualSourceFunctions:true,checks,observations:capture.observations.length,assessment:assessment.counts,captureSha256:capture.sha256,reportCharacters:html.length,illustrativeCapture:capture};
}
module.exports={runCommissioningSourceChecks};
