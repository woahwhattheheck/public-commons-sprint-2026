/** MoneyGram Ramps Stellar source-bound values; official source packet F0C908C6EBT. */
export const MONEYGRAM_SOURCE = Object.freeze({schema:"bim.moneygram-source.v1",sha256:"72524cef3370b6f3514e4ffa8a4b668526cc528e89e63ad7b366aaae5f08fb99",retrieved:"2026-10-13"});
export const NETWORKS=Object.freeze({mainnet:"Public Global Stellar Network ; September 2015",testnet:"Test SDF Network ; September 2015"});
const ENV=Object.freeze({
 sandbox:Object.freeze({name:"sandbox",api:"https://playground.xramps.moneygram.com/api",origin:"https://playground.xramps.moneygram.com",network:"testnet",issuer:"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",webhookKey:"GCUZ6YLL5RQBTYLTTQLPCM73C5XAIUGK2TIMWQH7HPSGWVS2KJ2F3CHS"}),
 production:Object.freeze({name:"production",api:"https://xramps.moneygram.com/api",origin:"https://xramps.moneygram.com",network:"mainnet",issuer:"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",webhookKey:"GD5NUMEX7LYHXGXCAD4PGW7JDMOUY2DKRGY5XZHJS5IONVHDKCJYGVCL"})
});
export function need(value,message){if(!value){const error=new Error(message);error.code="PROVIDER_VALIDATION";error.publicMessage=message;throw error;}}
export function object(value){return !!value&&typeof value==="object"&&!Array.isArray(value);}
export function copy(value){return JSON.parse(JSON.stringify(value));}
export function text(value,label,max=4096){need(typeof value==="string"&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value),label+" must be a nonempty original string");return value;}
export function environment(value){need(Object.hasOwn(ENV,value),"Select sandbox or production");return ENV[value];}
export function stellarPublicKey(value){
 need(typeof value==="string"&&/^G[A-Z2-7]{55}$/.test(value),"Require an original Stellar G-address");
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",out=[];let bits=0,v=0;
 for(const c of value){v=(v<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){out.push((v>>>(bits-8))&255);bits-=8;}}
 need(out.length===35&&out[0]===48,"Invalid Stellar public-key encoding");let crc=0;
 for(const b of out.slice(0,33)){crc^=b<<8;for(let i=0;i<8;i++)crc=((crc<<1)^((crc&32768)?0x1021:0))&65535;}
 need(out[33]===(crc&255)&&out[34]===(crc>>>8),"Invalid Stellar public-key checksum");
 return Uint8Array.from(out.slice(1,33));
}
export function amount(value){
 need(typeof value==="string"&&/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value)&&value.length<=40,"Require a positive original Stellar decimal string with at most seven places");
 const [a,b=""]=value.split(".");const atoms=BigInt(a)*10000000n+BigInt(b.padEnd(7,"0"));
 need(atoms>0n&&atoms<=9223372036854775807n,"Stellar amount is outside the positive int64 range");return {text:value,atoms:atoms.toString()};
}
export function normalizeSessionInput(input,envName){
 need(object(input),"Require the complete session input");stellarPublicKey(input.walletAddress);need(input.flow==="on-ramp"||input.flow==="off-ramp","Select on-ramp or off-ramp");
 if(input.chain!==undefined)need(input.chain==="stellar","This adapter selects Stellar");
 return {walletAddress:input.walletAddress,chain:"stellar",flow:input.flow,environment:environment(envName).name};
}
export function normalizeSignRequest(payload,selection){
 need(object(payload)&&object(selection),"Require original sign payload and selected session");const env=environment(selection.environment);
 need(selection.flow==="off-ramp","Cash-in does not authorize a wallet payment");stellarPublicKey(selection.walletAddress);
 need(payload.chain==="stellar"&&payload.asset==="USDC","Sign only the selected Stellar USDC flow");
 need(payload.requiredNetwork===env.network,"MoneyGram signing network differs from selected session");
 stellarPublicKey(payload.to);const a=amount(payload.amount);
 need(payload.tokenAddress===undefined||payload.tokenAddress==="USDC","MoneyGram tokenAddress must be the USDC asset code");
 const issuer=payload.issuer??env.issuer;stellarPublicKey(issuer);need(issuer===env.issuer,"MoneyGram issuer differs from selected Circle network asset");
 let memo=null;if(payload.memo!==undefined&&payload.memo!==null&&payload.memo!==""){need(typeof payload.memo==="string"&&/^\d+$/.test(payload.memo)&&payload.memo.length<=20&&BigInt(payload.memo)<=18446744073709551615n,"Require the original uint64 ID memo string");memo=payload.memo;}
 return {schema:"bim.moneygram.stellar-payment.v1",environment:env.name,networkPassphrase:NETWORKS[env.network],address:selection.walletAddress,to:payload.to,asset:{code:"USDC",issuer},amount:a.text,amountAtoms:a.atoms,memo:memo===null?null:{type:"id",value:memo},original:copy(payload)};
}
const EVENTS=new Set(["RAMPS_READY","RAMPS_CHECK_BALANCE","RAMPS_TRANSACTION_CREATED","RAMPS_SIGN_TRANSACTION","RAMPS_DEPOSIT_ADDRESS","RAMPS_TRANSACTION_COMPLETE","RAMPS_TRANSACTION_FAILED","RAMPS_SIGN_ERROR","RAMPS_CLOSE"]);
export function translateMoneyGramEvent(type,payload,selection){
 need(EVENTS.has(type),"Unsupported MoneyGram widget event");const original=payload===undefined?null:copy(payload);const out={schema:"bim.moneygram.widget-observation.v1",source:"CLIENT_WIDGET_OBSERVATION",event:type,environment:environment(selection.environment).name,walletAddress:selection.walletAddress,flow:selection.flow,payload:original,settlementConfirmed:false};
 if(type==="RAMPS_TRANSACTION_CREATED"||type==="RAMPS_TRANSACTION_COMPLETE"){
  need(object(payload),"Require complete widget transaction");out.transactionId=text(payload.id,"Ramps transaction ID",256);
  if(payload.mgiTransactionId!==undefined)out.mgiTransactionId=text(payload.mgiTransactionId,"MoneyGram transaction ID",256);
  if(payload.walletAddress!==undefined)need(payload.walletAddress===selection.walletAddress,"Widget transaction uses another wallet");
  if(payload.chain!==undefined)need(payload.chain==="stellar","Widget transaction uses another chain");
  if(payload.asset!==undefined)need(payload.asset==="USDC","Widget transaction uses another asset");
  const flowTypes=selection.flow==="on-ramp"?["on-ramp","cash-in"]:["off-ramp","cash-out"];
  if(payload.type!==undefined)need(flowTypes.includes(payload.type),"Widget transaction uses another flow");
  out.phase=type==="RAMPS_TRANSACTION_CREATED"?"VALIDATED_BEFORE_COMMIT":"WIDGET_DONE";
 }else if(type==="RAMPS_SIGN_TRANSACTION"){out.payment=normalizeSignRequest(payload,selection);out.phase="SIGNATURE_REQUEST";}
 else if(type==="RAMPS_DEPOSIT_ADDRESS"){out.phase="CUSTODIAL_REQUEST";out.requiresCustodialProfile=true;}
 else out.phase=type.replace(/^RAMPS_/,"");
 return out;
}
const STATES={
 "on-ramp":{validated:["VALIDATED",false],pending_kyc:["KYC_PENDING",false],committed:["AWAITING_CASH",false],funds_received:["CASH_RECEIVED",false],completed:["USDC_DELIVERED",true],failed:["FAILED",true],quote_expired:["EXPIRED",true]},
 "off-ramp":{pending_commit:["COMMIT_PENDING",false],awaiting_funds:["AWAITING_USDC",false],funds_received:["USDC_RECEIVED",false],completed:["CASH_READY",false],paid_out:["CASH_COLLECTED",true],failed:["FAILED",true],quote_expired:["EXPIRED",true],refund_requested:["REFUND_REQUESTED",false],refund_mgi_pending:["REFUND_PENDING",false],refund_mgi_success:["REFUND_PROVIDER_SUCCESS",false],refunded:["REFUNDED",true],refund_failed:["REFUND_FAILED",true]}
};
export function projectMoneyGramStatus(value,{transactionId,session}){
 need(object(value),"Require complete original status response");need(object(session)&&object(session.public),"Require original selected session descriptor");
 const s=session.public;environment(s.environment);const flow=s.flow;need(Object.hasOwn(STATES,flow),"Invalid selected session flow");const findings=[];
 const id=value.id??value.transactionId;if(id===undefined)findings.push({code:"RESPONSE_ID_ABSENT",status:"UNKNOWN"});else if(id!==transactionId)findings.push({code:"RESPONSE_ID_CONFLICT",status:"CONFLICT"});
 if(value.walletAddress!==undefined&&value.walletAddress!==s.walletAddress)findings.push({code:"WALLET_CONFLICT",status:"CONFLICT"});
 if(value.chain!==undefined&&value.chain!=="stellar")findings.push({code:"CHAIN_CONFLICT",status:"CONFLICT"});
 if(value.asset!==undefined&&value.asset!=="USDC")findings.push({code:"ASSET_CONFLICT",status:"CONFLICT"});
 const status=typeof value.status==="string"?value.status:null,meaning=status&&Object.hasOwn(STATES[flow],status)?STATES[flow][status]:null;
 if(!meaning)findings.push({code:"UNRECOGNIZED_STATUS",status:"UNKNOWN"});
 const usable=!!meaning&&!findings.some(f=>f.status==="CONFLICT");
 return {schema:"bim.moneygram.status.v1",transactionId,sessionId:session.id,environment:s.environment,walletAddress:s.walletAddress,flow,providerStatus:status,phase:meaning?.[0]??"UNKNOWN",terminal:usable&&!!meaning?.[1],providerOutcomeUsable:usable,cashCollected:usable&&flow==="off-ramp"&&status==="paid_out",providerReportsDelivered:usable&&flow==="on-ramp"&&status==="completed",depositAlreadySubmitted:value.depositSubmitted===true,chainConfirmation:"SEPARATE_ORIGINAL_LEDGER_EVIDENCE_REQUIRED",findings,original:copy(value)};
}
export function widgetURL(original,envName,flow,viewId){
 const env=environment(envName),url=new URL(original);need(url.origin===env.origin&&url.protocol==="https:"&&!url.username&&!url.password,"Widget URL is outside selected MoneyGram origin");need(url.pathname==="/widget.html","Require MoneyGram widget.html");
 need(flow==="on-ramp"||flow==="off-ramp","Invalid widget flow");url.searchParams.set("mode",viewId?"view":flow);return url.toString();
}
