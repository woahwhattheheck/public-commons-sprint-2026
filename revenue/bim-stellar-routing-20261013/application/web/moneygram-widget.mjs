import {environment,normalizeSessionInput,normalizeSignRequest,translateMoneyGramEvent,widgetURL,need,object,copy,text} from "../lib/moneygram-core.mjs";
const stable=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?"["+v.map(stable).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}";
async function hash(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,"0")).join("");}
function units(s){need(typeof s==="string"&&/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(s),"Require a complete nonnegative Stellar balance string");const [a,b=""]=s.split(".");return BigInt(a)*10000000n+BigInt(b.padEnd(7,"0"));}
/**
 * capability is read explicitly from the authenticated no-store /api/session/:id.
 * onObservation retains every event without session secrets. persistEvent commits
 * actual transaction bindings through the original session.event request journal.
 * submission is createStellarSubmissionDriver on that same backend journal.
 */
export function mountMoneyGramWidget({container,capability,viewTransactionId=null,persistEvent,onObservation,submission,onError=()=>{},onClose=()=>{},onChange=()=>{}}){
 need(container?.ownerDocument&&object(capability?.session)&&object(capability?.secret),"Require container and original private session capability");
 const session=copy(capability.session),selection=normalizeSessionInput(session.public,session.public.environment),env=environment(selection.environment);
 need(session.kind==="moneygram.widget"&&session.public.apiOrigin===env.origin,"Session belongs to another configured API origin");text(session.id,"Original session ID",256);
 const expires=Date.parse(session.expiresAt);need(Number.isFinite(expires)&&expires>Date.now(),"Create a fresh provider session before opening an expired widget");
 let token=text(capability.secret.sessionToken,"Original private session token",32768);
 need(typeof persistEvent==="function"&&typeof onObservation==="function","Retain original widget events and transaction bindings");
 if(viewTransactionId!==null){text(viewTransactionId,"Original view transaction",256);need((session.transactionIds??[]).some(v=>(typeof v==="string"?v:v?.transactionId??v?.id)===viewTransactionId),"Associate the original retained transaction event before view mode");}
 const doc=container.ownerDocument,win=doc.defaultView;
 const frame=doc.createElement("iframe");frame.title="MoneyGram "+(selection.flow==="on-ramp"?"cash-in":"cash-out");frame.src=widgetURL(session.public.widgetUrl,selection.environment,selection.flow,viewTransactionId);
 frame.referrerPolicy="no-referrer";frame.style.width="100%";frame.style.minHeight="640px";frame.style.border="0";
 let closed=false,tail=Promise.resolve(),knownId=viewTransactionId,lastState=null;
 const signResults=new Map();
 const active=()=>!closed&&Date.now()<expires;
 function post(type,payload){if(active())frame.contentWindow?.postMessage({type,payload},env.origin);}
 async function retain(type,payload){
  const event=translateMoneyGramEvent(type,payload,selection);
  if(event.transactionId&&knownId)need(event.transactionId===knownId,"Widget changed the selected transaction identity");
  if(!event.transactionId&&knownId)event.transactionId=knownId;
  await onObservation(copy(event));
  if(event.transactionId||event.mgiTransactionId)await persistEvent({sessionId:session.id,event:copy(event)});
  if(event.transactionId)knownId=event.transactionId;
  lastState=copy(event);onChange(copy(event));return event;
 }
 async function handle(type,payload){
  if(closed)return;
  need(active(),"MoneyGram session expired; open a fresh session and associate the retained transaction");
  if(type==="RAMPS_READY"){
   await retain(type,payload);
   post("RAMPS_CONFIG",{sessionToken:token,wallet:{address:selection.walletAddress,chain:"stellar",asset:"USDC",walletType:"non-custodial"},transaction:{type:selection.flow,asset:"USDC"},...(viewTransactionId?{mode:"view",transactionId:viewTransactionId}:{mode:selection.flow})});
   return;
  }
  const event=await retain(type,payload);
  if(closed)return;
  if(type==="RAMPS_CHECK_BALANCE"){
   need(submission?.readBalance,"Bind actual original network/account balance reading");need(payload?.asset==="USDC","Balance request uses another asset");
   const balance=await submission.readBalance({address:selection.walletAddress,asset:{code:"USDC",issuer:env.issuer}});
   need(balance.address===selection.walletAddress&&balance.asset.code==="USDC"&&balance.asset.issuer===env.issuer,"Balance source differs from selected wallet/asset");
   const originalAmount=typeof payload.amount==="number"?String(payload.amount):payload.amount;
   const sufficient=units(balance.balance)>=units(originalAmount);
   // The widget's display amount is numeric. The sufficiency comparison above is exact.
   const n=Number(balance.balance);need(Number.isFinite(n),"Balance cannot be displayed by this widget");
   await onObservation({schema:"bim.moneygram.balance-observation.v1",source:"CLIENT_BROWSER_OBSERVATION",sessionId:session.id,transactionId:knownId,request:copy(payload),result:copy(balance),sufficient});
   post("RAMPS_BALANCE_RESULT",{balance:n,sufficient,asset:"USDC"});return;
  }
  if(type==="RAMPS_SIGN_TRANSACTION"){
   need(!viewTransactionId,"View mode does not authorize another payment");need(knownId,"Retain the original transaction-created or completion ID before signing");
   need(submission?.prepareMoneyGramPayment&&submission?.signAndSubmit&&submission?.observe,"Bind actual wallet signing and original submission journal");
   const payment=normalizeSignRequest(payload,selection),operationId="moneygram-"+await hash(selection.environment+"\n"+selection.walletAddress+"\n"+knownId);
   const prior=signResults.get(operationId);need(!prior||prior.payment===stable(payment),"MoneyGram changed the payment for the original transaction");
   // Stable across fresh provider sessions: the original transaction has one wallet operation.
   // prepare adopts its complete existing XDR rather than rebuilding a new sequence/time bound.
   signResults.set(operationId,{payment:stable(payment),state:"PENDING"});
   const prepared=await submission.prepareMoneyGramPayment({id:operationId,payment,intent:{kind:"moneygram.off-ramp",sessionId:session.id,transactionId:knownId,originalEvent:event}});
   if(closed)return;
   const result=await submission.signAndSubmit(prepared);
   signResults.set(operationId,{payment:stable(payment),state:"OBSERVED",result:copy(result)});
   await onObservation({schema:"bim.moneygram.wallet-outcome.v1",source:"CLIENT_BROWSER_OBSERVATION",sessionId:session.id,transactionId:knownId,operationId,result:copy(result)});
   need(result.projection?.status==="CONFIRMED"&&/^[0-9a-f]{64}$/.test(result.operation?.hash??""),"Original transfer is unresolved; inspect its retained hash before any further submission");
   post("RAMPS_SIGN_SUCCESS",{txHash:result.operation.hash,walletAddress:selection.walletAddress});return;
  }
  if(type==="RAMPS_DEPOSIT_ADDRESS")throw new Error("This selected partner profile is non-custodial; retain the original request and select a separately authorized custodial integration");
  if(type==="RAMPS_CLOSE"){closed=true;token="";win.removeEventListener("message",listener);frame.remove();onClose(copy(lastState));}
 }
 function listener(message){
  if(closed||message.origin!==env.origin||message.source!==frame.contentWindow||!object(message.data)||typeof message.data.type!=="string")return;
  const {type}=message.data;if(!["RAMPS_READY","RAMPS_CHECK_BALANCE","RAMPS_TRANSACTION_CREATED","RAMPS_SIGN_TRANSACTION","RAMPS_DEPOSIT_ADDRESS","RAMPS_TRANSACTION_COMPLETE","RAMPS_TRANSACTION_FAILED","RAMPS_SIGN_ERROR","RAMPS_CLOSE"].includes(type))return;
  let payload;try{payload=message.data.payload===undefined?null:copy(message.data.payload);}catch(error){onError(error);return;}
  tail=tail.then(()=>handle(type,payload)).catch(error=>{if(type==="RAMPS_SIGN_TRANSACTION"||type==="RAMPS_DEPOSIT_ADDRESS")post("RAMPS_SIGN_ERROR",{error:String(error?.message??error)});onError(error);});
 }
 win.addEventListener("message",listener);container.append(frame);
 return {iframe:frame,sessionId:session.id,getState:()=>lastState===null?null:copy(lastState),async destroy(){closed=true;token="";win.removeEventListener("message",listener);frame.remove();if(submission?.close)await submission.close();await tail;}};
}
