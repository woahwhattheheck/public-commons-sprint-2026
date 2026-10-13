import {createPublicKey,verify as verifySignature,createHash} from "node:crypto";
import {MONEYGRAM_SOURCE,environment,normalizeSessionInput,projectMoneyGramStatus,stellarPublicKey,need,object,copy,text,widgetURL} from "./moneygram-core.mjs";
const digest=(s)=>createHash("sha256").update(s).digest("hex");
export const MONEYGRAM_ACTIONS=[
 {id:"moneygram.session.create",label:"Create a MoneyGram widget session",mode:"external-write",fields:[{name:"walletAddress",type:"string",required:true},{name:"flow",type:"on-ramp|off-ramp",required:true}],origins:["https://playground.xramps.moneygram.com","https://xramps.moneygram.com"],source:MONEYGRAM_SOURCE},
 {id:"moneygram.status.get",label:"Read current MoneyGram transaction status",mode:"read",fields:[{name:"sessionId",type:"string",required:true},{name:"transactionId",type:"string",required:true}],origins:["https://playground.xramps.moneygram.com","https://xramps.moneygram.com"],source:MONEYGRAM_SOURCE},
 {id:"moneygram.webhook.verify",label:"Verify an original MoneyGram status notification",mode:"read",fields:[{name:"rawBody",type:"multiline",required:true},{name:"signatureHeader",type:"string",required:true}],origins:["https://playground.xramps.moneygram.com","https://xramps.moneygram.com"],source:MONEYGRAM_SOURCE}
];
function time(value,label){const t=typeof value==="number"?value:Date.parse(value);need(Number.isSafeInteger(t)&&t>=0,label+" must be a valid observed millisecond timestamp");return t;}
function metadata(x){return {exchangeId:x.exchangeId,status:x.status,bytes:x.bytes,sha256:x.sha256,observedAt:x.observedAt??null};}
function originalJSON(x){need(x.status>=200&&x.status<300,"MoneyGram returned HTTP "+x.status);need(!x.parseError,"MoneyGram response is not complete valid JSON");let p=x.parsed;if(p===undefined){need(typeof x.bodyBase64==="string","Original response body is unavailable");p=JSON.parse(Buffer.from(x.bodyBase64,"base64").toString("utf8"));}need(object(p),"MoneyGram response must be an object");return p;}
function freezeInput(value){need(object(value),"Require complete action input");return copy(value);}
function selectedStatus(input){return {sessionId:text(input.sessionId,"Session capability ID",256),transactionId:text(input.transactionId,"Ramps transaction ID",256)};}
export function verifyMoneyGramWebhook({rawBody,signatureHeader,environment:envName,registeredWebhookUrl,receivedAt}){
 const env=environment(envName);need(typeof rawBody==="string"&&Buffer.byteLength(rawBody,"utf8")<=2097152,"Require complete notification JSON within two MiB");
 const url=new URL(registeredWebhookUrl);need(url.protocol==="https:"&&!url.username&&!url.password&&!url.search&&!url.hash&&(!url.port||["443","4443","10443"].includes(url.port)),"Require original registered HTTPS webhook URL without query");
 need(url.hostname&&!/^\d+(?:\.\d+){3}$/.test(url.hostname)&&!url.hostname.includes(":"),"MoneyGram webhook registration requires a domain");
 const header=text(signatureHeader,"Original Signature header",2048),parts={};
 for(const piece of header.split(",")){const i=piece.indexOf("=");need(i>0,"Invalid Signature component");const key=piece.slice(0,i).trim(),v=piece.slice(i+1).trim();need((key==="t"||key==="s")&&!Object.hasOwn(parts,key),"Duplicate or unknown Signature component");parts[key]=v;}
 need(typeof parts.t==="string"&&/^\d{1,16}$/.test(parts.t)&&typeof parts.s==="string"&&/^[A-Za-z0-9+/]+={0,2}$/.test(parts.s),"Invalid original timestamp or base64 signature");
 const sig=Buffer.from(parts.s,"base64");need(sig.length===64&&sig.toString("base64")===parts.s,"Require exact canonical 64-byte Ed25519 signature");
 const body=JSON.parse(rawBody);need(object(body)&&typeof body.message==="string","Require MoneyGram {message:string} wrapper");
 const signedText=parts.t+"."+url.hostname+"."+body.message;
 const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(stellarPublicKey(env.webhookKey))]),format:"der",type:"spki"});
 need(verifySignature(null,Buffer.from(signedText,"utf8"),key,sig),"MoneyGram notification signature is invalid");
 const now=time(receivedAt,"Original receipt time"),stamp=BigInt(parts.t)*1000n,age=BigInt(now)-stamp;
 need(age>=-300000n&&age<=3900000n,"MoneyGram notification is outside the 65-minute retry/five-minute-future window");
 const message=JSON.parse(body.message);need(object(message)&&object(message.transaction),"Require signed original transaction");
 const tx=message.transaction;for(const name of ["id","kind","status"])text(tx[name],"Signed transaction "+name,256);
 need(tx.network===undefined,"This source profile is Stellar; Solana notifications require their own profile");
 need(tx.kind==="deposit"||tx.kind==="withdrawal","Unsupported signed Stellar transaction kind");
 for(const name of ["amount_in","amount_out","amount_fee"]){if(tx[name]!==undefined)need(typeof tx[name]==="string"&&/^\d+(?:\.\d+)?$/.test(tx[name]),"Signed monetary values must remain original decimal strings");}
 return {schema:"bim.moneygram.webhook-verification.v1",verification:"VERIFIED",environment:env.name,receivedAt:new Date(now).toISOString(),signatureTimestamp:parts.t,registeredWebhookHost:url.hostname,publicKey:env.webhookKey,rawBody,rawBodySha256:digest(rawBody),message:body.message,messageSha256:digest(body.message),signatureHeader,authenticatedFields:["timestamp","registeredWebhookHost","message"],transaction:copy(tx),mgiTransactionId:tx.id,requiresStatusRead:true,providerStatus:null,settlementConfirmed:false,timestampSemantics:"Webhook data timestamps are informational; signed header time is the verification time basis",source:MONEYGRAM_SOURCE};
}
export function createMoneyGramAdapter(configuration){
 const cfg=copy(configuration);const env=environment(cfg.environment);
 const adapter={
 id:"moneygram",label:"MoneyGram Stellar cash ramps",origins:["https://playground.xramps.moneygram.com","https://xramps.moneygram.com"],actions:MONEYGRAM_ACTIONS.map(copy),
 async prepare(actionId,input,ctx){
  need(actionId==="moneygram.session.create","This MoneyGram action has no external write preparation");const selected=normalizeSessionInput(freezeInput(input),env.name);text(cfg.secretAlias,"Server MoneyGram secret alias",256);
  return {status:"PREPARED",unsignedPayload:{method:"POST",url:env.api+"/v1/sessions",body:{walletAddress:selected.walletAddress,chain:"stellar"}},selection:selected,execute:{actionId,input:{walletAddress:selected.walletAddress,flow:selected.flow}},source:MONEYGRAM_SOURCE};
 },
 async execute(actionId,input,ctx){
  const selected=freezeInput(input);need(ctx&&typeof ctx.http==="function","Require the original backend HTTP/capture context");
  if(actionId==="moneygram.session.create"){
   const s=normalizeSessionInput(selected,env.name);text(cfg.secretAlias,"Server MoneyGram secret alias",256);need(typeof ctx.exposeSession==="function","Require private session-capability custody");
   const started=time(ctx.now,"Frozen original request time"),expiresAt=new Date(started+3600000).toISOString();
   const body=JSON.stringify({walletAddress:s.walletAddress,chain:"stellar"});
   const exchange=await ctx.http({url:env.api+"/v1/sessions",method:"POST",headers:{"content-type":"application/json"},bodyBase64:Buffer.from(body,"utf8").toString("base64"),credential:cfg.secretAlias,semantics:"write",privateResponse:true});
   const value=originalJSON(exchange);text(value.sessionToken,"Original session token",32768);text(value.sessionId,"Original session ID",256);
   const url=widgetURL(text(value.widgetUrl,"Original widget URL",8192),env.name,s.flow);
   if(value.walletType!==undefined)need(value.walletType==="non-custodial","This selected adapter requires a non-custodial MoneyGram partner profile");
   const session=await ctx.exposeSession({kind:"moneygram.widget",expiresAt,public:{walletAddress:s.walletAddress,environment:env.name,apiOrigin:new URL(env.api).origin,flow:s.flow,chain:"stellar",asset:"USDC",walletType:"non-custodial",providerSessionId:value.sessionId,widgetUrl:url,language:typeof value.language==="string"?value.language:null,exchange:metadata(exchange)},secret:{sessionToken:value.sessionToken}});
   return {schema:"bim.moneygram.session.v1",session,widgetUrl:url,walletAddress:s.walletAddress,flow:s.flow,exchange:{...metadata(exchange),withheldPrivate:true},source:MONEYGRAM_SOURCE};
  }
  if(actionId==="moneygram.status.get"){
   const s=selectedStatus(selected);need(typeof ctx.getSession==="function","Require original retained session descriptor");const session=await ctx.getSession(s.sessionId);
   need(session?.kind==="moneygram.widget"&&session.public?.environment===env.name,"Selected session belongs to another provider/environment");
   const bindings=session.transactionIds??[];need(bindings.some(x=>(typeof x==="string"?x:x?.transactionId??x?.id)===s.transactionId),"Retain the actual widget-created transaction evidence before selecting its status");
   const exchange=await ctx.http({url:env.api+"/v1/transactions/"+encodeURIComponent(s.transactionId)+"/status?sync=true",method:"GET",credential:"session:"+s.sessionId,semantics:"read"});
   const value=originalJSON(exchange);
   return {schema:"bim.moneygram.status-receipt.v1",exchange:metadata(exchange),projection:projectMoneyGramStatus(value,{transactionId:s.transactionId,session}),original:value,source:MONEYGRAM_SOURCE};
  }
  if(actionId==="moneygram.webhook.verify"){
   need(typeof cfg.registeredWebhookUrl==="string","Select the original registered webhook URL");
   return verifyMoneyGramWebhook({rawBody:selected.rawBody,signatureHeader:selected.signatureHeader,environment:env.name,registeredWebhookUrl:cfg.registeredWebhookUrl,receivedAt:ctx.now});
  }
  throw new Error("Unknown MoneyGram action "+actionId);
 }
 };
 return adapter;
}
