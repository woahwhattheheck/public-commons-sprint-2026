import {NETWORKS,need,object,copy,text,normalizeSignRequest} from "../lib/moneygram-core.mjs";
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
async function shaBytes(bytes){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)));}
const base64=bytes=>{let out="";for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);};
const stable=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?"["+v.map(stable).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}";
function endpoint(s){const u=new URL(s);need(u.protocol==="https:"&&!u.username&&!u.password&&!u.search&&!u.hash,"Select an HTTPS chain endpoint without embedded credentials");return u.toString().replace(/\/$/,"");}
function retainedHTTP(record){const {body,...retained}=record;return copy(retained);}
function rawJSON(record){need(!record.error&&!record.cleanupError&&record.bodyComplete===true&&record.bodyUTF8===true&&record.status>=200&&record.status<300,"Chain HTTP request did not succeed");const p=JSON.parse(record.body);need(object(p),"Expected a complete chain response object");return p;}
function parseTx(stellar,xdr,np){const t=stellar.TransactionBuilder.fromXDR(xdr,np);need(!t.innerTransaction,"This signing profile requires an ordinary transaction envelope");return t;}
export function createStellarSubmissionDriver({stellar,wallet,networkPassphrase,horizonUrl,rpcUrl,journal,fetchImpl=globalThis.fetch,httpTimeoutMs=30000,maxResponseBytes=16777216}){
 need(Object.values(NETWORKS).includes(networkPassphrase),"Select explicit Stellar public or test network");need(wallet?.signEnvelope&&wallet?.getAccount,"Bind the actual selected wallet driver");
 need(journal&&typeof journal.command==="function"&&typeof journal.get==="function"&&typeof journal.retainHTTP==="function","Bind the original backend wallet journal and complete source.import receiver");
 need(Number.isSafeInteger(httpTimeoutMs)&&httpTimeoutMs>=1000&&httpTimeoutMs<=120000&&Number.isSafeInteger(maxResponseBytes)&&maxResponseBytes>=1024&&maxResponseBytes<=67108864,"Select bounded HTTP timeout and body capacity");need(typeof fetchImpl==="function","Require browser fetch");
 const horizon=endpoint(horizonUrl),rpc=rpcUrl?endpoint(rpcUrl):null;
 const busy=new Set();
 async function locked(id,fn){text(id,"Original wallet operation ID",256);need(!busy.has(id),"The original wallet operation is already active");busy.add(id);try{if(globalThis.navigator?.locks)return await navigator.locks.request("bim:wallet:"+id,{mode:"exclusive"},fn);return await fn();}finally{busy.delete(id);}}
 let closing=false;const httpOwners=new Set();
 async function http(url,method="GET",body=null,headers={}){
  need(!closing,"Original browser HTTP owner is closing");
  const requestHeaders=copy(headers),startedAt=new Date().toISOString(),controller=new AbortController();
  const owner={controller,promise:null};let finish;owner.promise=new Promise(resolve=>finish=resolve);httpOwners.add(owner);
  const timer=setTimeout(()=>controller.abort(new Error("Original chain HTTP deadline exceeded")),httpTimeoutMs);
  let response=null,reader=null,error=null,complete=false,raw="",encodingValid=true,observedBytes=0,retainedBytes=0,cleanupError=null;
  const chunks=[];
  try{
   response=await fetchImpl(url,{method,headers:requestHeaders,body,credentials:"omit",redirect:"error",cache:"no-store",signal:controller.signal});
   if(response.body){reader=response.body.getReader();while(true){const part=await reader.read();if(part.done){complete=true;break;}need(part.value instanceof Uint8Array,"HTTP reader returned non-byte data");observedBytes+=part.value.length;
     const capacity=maxResponseBytes-retainedBytes,take=part.value.subarray(0,Math.max(0,capacity));if(take.length){chunks.push(take.slice());retainedBytes+=take.length;}
     if(part.value.length>capacity){controller.abort(new Error("Original chain HTTP body exceeded selected capacity"));throw new Error("HTTP body exceeds "+maxResponseBytes+" bytes; retained bytes are an explicit original prefix");}
   }}else complete=true;
  }catch(e){error=String(e?.message??e);}
  finally{
   clearTimeout(timer);
   if(!complete)controller.abort();
   if(reader){try{if(!complete)await reader.cancel();}catch(e){cleanupError=String(e?.message??e);}finally{try{reader.releaseLock();}catch(e){cleanupError=String(e?.message??e);}}}
  }
  try{
   const bytes=new Uint8Array(retainedBytes);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
   try{raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch(e){encodingValid=false;raw=new TextDecoder().decode(bytes);error=error??"Original HTTP body is not valid UTF-8";}
   const record={schema:"bim.browser-http.v2",source:"CLIENT_BROWSER_OBSERVATION",url,method,requestBody:body,requestHeaders,startedAt,observedAt:new Date().toISOString(),status:response?.status??null,bodyComplete:complete,bodyUTF8:encodingValid,headers:response?Object.fromEntries(response.headers.entries()):{},bodyBase64:base64(bytes),bytes:retainedBytes,observedBytes,sha256:await shaBytes(bytes),error,cleanupError,limit:{timeoutMs:httpTimeoutMs,maxResponseBytes}};
   const receipt=await journal.retainHTTP(copy(record));text(receipt?.id,"Original retained HTTP source file ID",256);
   return {...record,body:raw,sourceFile:copy(receipt)};
  }finally{httpOwners.delete(owner);finish();}
 }
 async function proof(transport){
  const record=transport==="rpc"?await http(rpc,"POST",JSON.stringify({jsonrpc:"2.0",id:"network",method:"getNetwork"}),{"content-type":"application/json"}):await http(horizon);
  const p=rawJSON(record),actual=transport==="rpc"?p.result?.passphrase:p.network_passphrase;
  need(actual===networkPassphrase,"Original chain endpoint reports another network");return record;
 }
 function expected(input){const plan=copy(input);need(plan.networkPassphrase===networkPassphrase,"Original plan uses another network");need(plan.transport==="horizon"||plan.transport==="rpc"&&rpc,"Select a configured Horizon or RPC transport");
  const t=parseTx(stellar,plan.unsignedXdr,networkPassphrase),hash=hex(t.hash());need(hash===plan.unsignedHash,"Original unsigned envelope hash differs");need(t.source===plan.address,"Original transaction source differs from selected wallet account");
  const selectedEndpoint=plan.transport==="rpc"?rpc:horizon;
  return {...plan,intent:{...copy(plan.intent??{}),transport:plan.transport,endpoint:selectedEndpoint},unsignedHash:hash};
 }
 function freshTime(p){
  const t=parseTx(stellar,p.unsignedXdr,networkPassphrase),bounds=t.timeBounds;
  if(!bounds)return;
  need(typeof bounds.minTime==="string"&&/^\d+$/.test(bounds.minTime)&&typeof bounds.maxTime==="string"&&/^\d+$/.test(bounds.maxTime),"Retain exact original transaction time bounds");
  const now=BigInt(Math.floor(Date.now()/1000)),min=BigInt(bounds.minTime),max=BigInt(bounds.maxTime);
  need(now>=min,"The original transaction time window has not opened");
  need(max===0n||now<max,"The original transaction has expired; preserve it and explicitly prepare a new plan");
 }
 function match(op,p){need(op&&op.networkPassphrase===p.networkPassphrase&&op.address===p.address&&op.unsignedXdr===p.unsignedXdr&&op.unsignedHash===p.unsignedHash&&stable(op.intent)===stable(p.intent),"Retained wallet operation differs from original selected plan");}
 async function record(id,originalHTTP,projection){const r=await journal.command("wallet.observed",{id,originalHTTP:retainedHTTP(originalHTTP),projection});return r;}
 async function observeUnlocked(id){
  const op=await journal.get(id);need(op&&typeof op.hash==="string"&&/^[0-9a-f]{64}$/.test(op.hash),"Retain the original signed transaction hash before status lookup");
  need(op.networkPassphrase===networkPassphrase&&op.intent?.endpoint===(op.intent.transport==="rpc"?rpc:horizon),"Retained wallet operation uses another network/endpoint");
  const networkRecord=await proof(op.intent.transport);
  await record(id,networkRecord,{kind:"NETWORK_PROOF",networkPassphrase,source:"CLIENT_BROWSER_OBSERVATION"});
  let response,projection;
  if(op.intent.transport==="rpc"){
   response=await http(rpc,"POST",JSON.stringify({jsonrpc:"2.0",id:"status:"+id,method:"getTransaction",params:{hash:op.hash}}),{"content-type":"application/json"});
   let p=null;try{p=rawJSON(response);}catch{}
   const r=p?.result;const binding=r?.txHash===undefined||r.txHash===op.hash;
   projection={kind:"TRANSACTION_STATUS",hash:op.hash,status:binding&&r?.status==="SUCCESS"?"CONFIRMED":binding&&r?.status==="FAILED"?"FAILED":"UNRESOLVED",originalStatus:r?.status??null,independentConfirmationRequired:true,source:"CLIENT_BROWSER_OBSERVATION"};
  }else{
   response=await http(horizon+"/transactions/"+op.hash);let p=null;try{p=rawJSON(response);}catch{}
   const binding=p?.hash===op.hash;
   projection={kind:"TRANSACTION_STATUS",hash:op.hash,status:binding&&p.successful===true?"CONFIRMED":binding&&p.successful===false?"FAILED":"UNRESOLVED",originalStatus:response.status,independentConfirmationRequired:true,source:"CLIENT_BROWSER_OBSERVATION"};
  }
  await record(id,response,projection);return {operation:await journal.get(id),projection,response};
 }
 return {
  async close(){closing=true;for(const owner of httpOwners)owner.controller.abort(new Error("Original browser HTTP owner closed"));await Promise.all([...httpOwners].map(x=>x.promise));},
  async readBalance({address,asset}){
   need(asset?.code==="USDC"&&typeof asset.issuer==="string","Select complete original issued-asset identity");
   const networkRecord=await proof("horizon"),response=await http(horizon+"/accounts/"+encodeURIComponent(address)),account=rawJSON(response);
   need(account.account_id===address,"Horizon account identity differs");const matches=(account.balances??[]).filter(x=>x.asset_code===asset.code&&x.asset_issuer===asset.issuer);
   need(matches.length===1&&typeof matches[0].balance==="string","Selected USDC trustline balance is unresolved");
   return {address,networkPassphrase,asset:copy(asset),balance:matches[0].balance,source:{network:networkRecord,account:response},sourceKind:"CLIENT_BROWSER_OBSERVATION"};
  },
  async prepareMoneyGramPayment({id,payment,intent}){
   const p=copy(payment);need(stable(normalizeSignRequest(p.original,{environment:p.environment,walletAddress:p.address,flow:"off-ramp"}))===stable(p),"Normalized payment differs from its complete original widget request");need(p.schema==="bim.moneygram.stellar-payment.v1"&&p.networkPassphrase===networkPassphrase,"Use the normalized original MoneyGram payment");
   const existing=await journal.get(id);
   if(existing){
    need(existing.networkPassphrase===networkPassphrase&&existing.address===p.address&&stable(existing.intent?.payment)===stable(p)&&existing.intent?.transactionId===intent?.transactionId,"Existing original payment operation differs from the selected transaction");
    const originalPlan=expected({networkPassphrase:existing.networkPassphrase,address:existing.address,unsignedXdr:existing.unsignedXdr,unsignedHash:existing.unsignedHash,transport:existing.intent.transport,intent:existing.intent});
    match(existing,originalPlan);return {id,plan:originalPlan,recovered:true};
   }
   const current=await wallet.getAccount();need(current.address===p.address&&current.networkPassphrase===networkPassphrase,"Wallet differs from original MoneyGram payment");
   const networkRecord=await proof("horizon"),response=await http(horizon+"/accounts/"+encodeURIComponent(p.address)),account=rawJSON(response);
   need(account.account_id===p.address&&typeof account.sequence==="string"&&/^\d+$/.test(account.sequence),"Require the selected original Horizon account sequence");
   const b=new stellar.TransactionBuilder(new stellar.Account(p.address,account.sequence),{fee:String(stellar.BASE_FEE),networkPassphrase}).addOperation(stellar.Operation.payment({destination:p.to,asset:new stellar.Asset(p.asset.code,p.asset.issuer),amount:p.amount}));
   if(p.memo)b.addMemo(stellar.Memo.id(p.memo.value));
   const t=b.setTimeout(180).build();
   const plan=expected({networkPassphrase,address:p.address,unsignedXdr:t.toXDR(),unsignedHash:hex(t.hash()),transport:"horizon",intent:{...copy(intent??{}),payment:p,accountSource:retainedHTTP(response),networkSource:retainedHTTP(networkRecord)}});
   await journal.command("wallet.reserve",{id,networkPassphrase,address:plan.address,unsignedXdr:plan.unsignedXdr,unsignedHash:plan.unsignedHash,intent:plan.intent});
   match(await journal.get(id),plan);return {id,plan};
  },
  signAndSubmit:({id,plan})=>locked(id,async()=>{
   const selected=expected(plan);let op=await journal.get(id);
   if(!op){await journal.command("wallet.reserve",{id,networkPassphrase,address:selected.address,unsignedXdr:selected.unsignedXdr,unsignedHash:selected.unsignedHash,intent:selected.intent});op=await journal.get(id);}
   match(op,selected);
   if(["SUBMITTING","UNCERTAIN","SUBMITTED","CONFIRMED","FAILED"].includes(op.state))return observeUnlocked(id);
   if(op.state==="RESERVED"){
    need(!closing,"Original submission owner is closing");
    freshTime(selected);
    const result=await wallet.signEnvelope({xdr:selected.unsignedXdr,networkPassphrase,address:selected.address});
    await journal.command("wallet.signed",{id,signedXdr:result.signedTxXdr,hash:result.transactionHash,signatureReceipt:result});
    op=await journal.get(id);match(op,selected);
    if(result.selectionUnchanged!==true)return {operation:op,status:"SELECTION_CHANGED",requiresExplicitReview:true};
   }
   need(!closing,"Original submission owner closed; signed result remains retained");
   need(op.state==="SIGNED"&&typeof op.signedXdr==="string"&&op.hash===selected.unsignedHash,"Original signed operation is unavailable");
   need(op.signatureReceipt?.selectionUnchanged===true,"Original signature needs account-selection review");
   const current=await wallet.getAccount();need(current.address===selected.address&&current.networkPassphrase===networkPassphrase,"Wallet account/network changed before submission");
   const networkRecord=await proof(selected.transport);
   await record(id,networkRecord,{kind:"NETWORK_PROOF",networkPassphrase,source:"CLIENT_BROWSER_OBSERVATION"});
   need(!closing,"Original submission owner is closing");
   freshTime(selected);
   const admission=await journal.command("wallet.submitting",{id});
   // The backend/client must distinguish a newly accepted outer request from replay.
   // Missing or replayed admission is status-only, even if its old body says SUBMITTING.
   if(admission?.replayed!==false)return observeUnlocked(id);
   const admitted=await journal.get(id);match(admitted,selected);
   need(admitted.state==="SUBMITTING"&&admitted.signedXdr===op.signedXdr&&admitted.hash===op.hash,"Submission admission changed before original browser send");
   freshTime(selected);
   let response,projection;
   if(selected.transport==="rpc"){
    response=await http(rpc,"POST",JSON.stringify({jsonrpc:"2.0",id:"submit:"+id,method:"sendTransaction",params:{transaction:op.signedXdr}}),{"content-type":"application/json"});
    let p=null;try{p=rawJSON(response);}catch{}
    const r=p?.result;projection={kind:"TRANSACTION_SUBMISSION",hash:op.hash,status:r?.hash===op.hash&&["PENDING","DUPLICATE"].includes(r.status)?"SUBMITTED":"UNCERTAIN",originalStatus:r?.status??null,source:"CLIENT_BROWSER_OBSERVATION"};
   }else{
    response=await http(horizon+"/transactions","POST",new URLSearchParams({tx:op.signedXdr}).toString(),{"content-type":"application/x-www-form-urlencoded"});
    let p=null;try{p=rawJSON(response);}catch{}
    projection={kind:"TRANSACTION_SUBMISSION",hash:op.hash,status:p?.hash===op.hash&&p.successful===true?"SUBMITTED":"UNCERTAIN",originalStatus:response.status,source:"CLIENT_BROWSER_OBSERVATION"};
   }
   await record(id,response,projection);
   // No repeat POST follows errors, timeout, NOT_FOUND or an ambiguous provider body.
   return observeUnlocked(id);
  }),
  observe:id=>locked(id,()=>observeUnlocked(id))
 };
}
