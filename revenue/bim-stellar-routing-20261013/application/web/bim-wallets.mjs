import {NETWORKS,stellarPublicKey,need,object,copy,text} from "../lib/moneygram-core.mjs";
export const WALLET_SOURCE=Object.freeze({walletsKit:{version:"2.7.1",packet:"F0C8Y1YTWBC",sha256:"c587d449cc7525a225e86ad2390dc3729a9edd501596b91875ecb218dcf9e9e5"},privy:{packet:"F0C90853RGR",sha256:"a7bb2e5c9514bc8585c66b6213f579ee05c1daf54158cbd1a4686941befc46c9"}});
const hex=(bytes)=>Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
const b64=(bytes)=>{let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
function network(value){need(Object.values(NETWORKS).includes(value),"Select the explicit Stellar public or test network passphrase");return value;}
function sdk(value){need(value?.TransactionBuilder?.fromXDR&&value?.Keypair?.fromPublicKey,"Inject the actual @stellar/stellar-sdk module");return value;}
function serial(){let busy=false;return async fn=>{need(!busy,"Complete the original wallet action before another action");busy=true;try{return await fn();}finally{busy=false;}};}
function tx(stellar,xdr,passphrase){text(xdr,"Original transaction envelope",4194304);const value=stellar.TransactionBuilder.fromXDR(xdr,passphrase);need(!value.innerTransaction,"Fee-bump signing requires an explicitly selected fee-bump profile");need(Array.isArray(value.signatures)&&typeof value.hash==="function","Invalid original Stellar transaction");return value;}
function signatureHex(s){return hex(s.toXDR());}
export function verifySignedEnvelope({stellar,originalXdr,signedTxXdr,networkPassphrase,address}){
 sdk(stellar);network(networkPassphrase);stellarPublicKey(address);
 const original=tx(stellar,originalXdr,networkPassphrase),signed=tx(stellar,signedTxXdr,networkPassphrase);
 const hash=original.hash();need(hex(hash)===hex(signed.hash()),"Wallet changed the original transaction body or network");
 const remaining=signed.signatures.map(signatureHex);
 for(const s of original.signatures){const i=remaining.indexOf(signatureHex(s));need(i>=0,"Wallet removed an existing original signature");remaining.splice(i,1);}
 const key=stellar.Keypair.fromPublicKey(address);
 need(signed.signatures.some(s=>{try{return hex(s.hint())===hex(key.signatureHint())&&key.verify(hash,s.signature());}catch{return false;}}),"Signed envelope lacks the selected account's valid signature for this exact network/body");
 return {transactionHash:hex(hash),signatureVerified:true,originalSignatureCount:original.signatures.length,signedSignatureCount:signed.signatures.length};
}
export function createWalletsKitDriver({kit,stellar,networkPassphrase}){
 sdk(stellar);const selectedNetwork=network(networkPassphrase),run=serial();
 need(kit&&["authModal","fetchAddress","signTransaction","getNetwork","setNetwork"].every(k=>typeof kit[k]==="function"),"Inject the selected complete StellarWalletsKit API");
 async function account(){
  const moduleId=text(kit.selectedModule?.productId,"Selected wallet module",256);
  const value=await kit.fetchAddress();stellarPublicKey(value?.address);
  need(kit.selectedModule?.productId===moduleId,"Wallet selection changed while reading its address");
  let networkEvidence;try{const reported=await kit.getNetwork();need(typeof reported?.networkPassphrase==="string","Wallet omitted its network passphrase");networkEvidence={status:"REPORTED",...copy(reported)};}catch(error){networkEvidence={status:"UNREPORTED",message:String(error?.message??error)};}
  need(kit.selectedModule?.productId===moduleId,"Wallet selection changed while reading its network");
  if(networkEvidence.status==="REPORTED")need(networkEvidence.networkPassphrase===selectedNetwork,"Wallet network differs from the selected original operation");
  return {schema:"bim.wallet-account.v1",provider:"wallets-kit",moduleId,address:value.address,networkPassphrase:selectedNetwork,networkEvidence};
 }
 return {
  id:"wallets-kit",source:WALLET_SOURCE.walletsKit,
  connect:()=>run(async()=>{kit.setNetwork(selectedNetwork);const result=await kit.authModal();stellarPublicKey(result?.address);const actual=await account();need(actual.address===result.address,"Wallet account changed during connection");return actual;}),
  getAccount:()=>run(account),
  signEnvelope:input=>run(async()=>{
   const request=copy(input);network(request.networkPassphrase);need(request.networkPassphrase===selectedNetwork,"Signing request differs from the driver's selected network");stellarPublicKey(request.address);tx(stellar,request.xdr,selectedNetwork);
   const before=await account();need(before.address===request.address,"Selected signing account changed");kit.setNetwork(selectedNetwork);
   const response=await kit.signTransaction(request.xdr,{networkPassphrase:selectedNetwork,address:request.address});
   need(object(response)&&typeof response.signedTxXdr==="string","Wallet did not return a signed envelope");if(response.signerAddress!==undefined)need(response.signerAddress===request.address,"Wallet signed with a different account");
   const proof=verifySignedEnvelope({stellar,originalXdr:request.xdr,signedTxXdr:response.signedTxXdr,networkPassphrase:selectedNetwork,address:request.address});
   let after=null,selectionError=null;try{after=await account();}catch(error){selectionError=String(error?.message??error);}const selectionUnchanged=after?.moduleId===before.moduleId&&after?.address===before.address;
   return {schema:"bim.wallet-signature.v1",provider:"wallets-kit",moduleId:before.moduleId,address:before.address,networkPassphrase:selectedNetwork,signedTxXdr:response.signedTxXdr,...proof,networkEvidence:after?.networkEvidence??before.networkEvidence,selectionError,selectionUnchanged,status:selectionUnchanged?"SIGNED":"SELECTION_CHANGED",providerResponse:copy(response)};
  })
 };
}
function privySession(getSession){const s=getSession();need(s?.ready===true&&s.authenticated===true&&typeof s.userId==="string","Log in through the actual Privy provider before selecting a wallet");need(Array.isArray(s.wallets),"Require the current Privy linked-wallet list");return s;}
export function createPrivyDriver({getSession,createWallet,signRawHash,stellar,networkPassphrase}){
 sdk(stellar);const selectedNetwork=network(networkPassphrase),run=serial();need([getSession,createWallet,signRawHash].every(x=>typeof x==="function"),"Bind the actual Privy extended-chain hooks");
 let chosen=null;
 function account(){const s=privySession(getSession),ws=s.wallets.filter(w=>w.chainType==="stellar"&&w.walletClientType==="privy");const matches=chosen?ws.filter(w=>w.address===chosen.address):ws;need(matches.length===1,"Select exactly one original Privy Stellar embedded wallet");stellarPublicKey(matches[0].address);if(chosen)need(s.userId===chosen.userId,"Privy authenticated user changed");
  return {schema:"bim.wallet-account.v1",provider:"privy",userId:s.userId,address:matches[0].address,networkPassphrase:selectedNetwork,networkEvidence:{status:"APP_SELECTED_HASH_DOMAIN",networkPassphrase:selectedNetwork}};
 }
 return {
  id:"privy",source:WALLET_SOURCE.privy,
  connect:options=>run(async()=>{
   const opts=options===undefined?{}:copy(options),s=privySession(getSession),ws=s.wallets.filter(w=>w.chainType==="stellar"&&w.walletClientType==="privy");
   let address=opts.address;if(address!==undefined)stellarPublicKey(address);
   if(ws.length===0){need(address===undefined,"Selected wallet is absent from the authenticated account");const made=await createWallet({chainType:"stellar"});need(made?.user?.id===s.userId&&made?.wallet?.chainType==="stellar","Created wallet belongs to another user or chain");address=made.wallet.address;stellarPublicKey(address);}
   else if(address===undefined){need(ws.length===1,"Choose one of the authenticated user's Stellar wallets");address=ws[0].address;}
   chosen={userId:s.userId,address};return account();
  }),
  getAccount:()=>run(async()=>account()),
  signEnvelope:input=>run(async()=>{
   const request=copy(input);need(request.networkPassphrase===selectedNetwork,"Signing request differs from the selected network");const before=account();need(before.address===request.address,"Signing request uses another Privy account");
   const original=tx(stellar,request.xdr,selectedNetwork),hash=original.hash();const response=await signRawHash({address:before.address,chainType:"stellar",hash:"0x"+hex(hash)});
   need(object(response)&&typeof response.signature==="string"&&/^(?:0x)?[0-9a-fA-F]{128}$/.test(response.signature),"Require Privy's complete 64-byte original Ed25519 signature");
   const h=response.signature.replace(/^0x/,""),bytes=Uint8Array.from(h.match(/../g),x=>parseInt(x,16));
   const key=stellar.Keypair.fromPublicKey(before.address);need(key.verify(hash,bytes),"Privy signature does not verify against the selected transaction/network/account");
   original.addSignature(before.address,b64(bytes));const signedTxXdr=original.toXDR();
   const proof=verifySignedEnvelope({stellar,originalXdr:request.xdr,signedTxXdr,networkPassphrase:selectedNetwork,address:before.address});
   let after=null,selectionError=null;try{after=account();}catch(error){selectionError=String(error?.message??error);}const selectionUnchanged=after?.address===before.address&&after?.userId===before.userId;
   return {schema:"bim.wallet-signature.v1",provider:"privy",userId:before.userId,address:before.address,networkPassphrase:selectedNetwork,signedTxXdr,...proof,networkEvidence:before.networkEvidence,selectionError,selectionUnchanged,status:selectionUnchanged?"SIGNED":"SELECTION_CHANGED",providerResponse:copy(response)};
  })
 };
}
