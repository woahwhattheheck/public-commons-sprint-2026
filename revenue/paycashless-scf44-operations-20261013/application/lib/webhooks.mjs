// MIT. A callback signs its event.data representation and registered full URL.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {invariant,parseSourceJSON,sha256} from './source-json.mjs';
import {assertExactNativeNumbers} from './provider-auth.mjs';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function header(headers,name){
 const selected=Object.entries(headers??{}).filter(([key])=>key.toLowerCase()===name.toLowerCase());
 invariant(selected.length===1&&typeof selected[0][1]==='string','CALLBACK_HEADER_REQUIRED',{name});
 return selected[0][1];
}
export function verifyWebhook({provider,...input}){
 invariant(provider==='paycashless','PROVIDER_WEBHOOK_NOT_CONFIGURED');
 return verifyPaycashlessWebhook(input);
}
export function verifyPaycashlessWebhook({rawBody,headers,configuration,receivedAt}){
 invariant(configuration&&typeof configuration.apiSecret==='string'&&configuration.apiSecret.length,'PAYCASHLESS_WEBHOOK_SECRET_REQUIRED');
 invariant(typeof receivedAt==='string'&&Number.isFinite(Date.parse(receivedAt)),'PAYCASHLESS_WEBHOOK_RECEIVED_TIME_REQUIRED');
 invariant(typeof configuration.callbackUrl==='string'&&configuration.callbackUrl.length,'CALLBACK_REGISTERED_URL_REQUIRED');
 const url=new URL(configuration.callbackUrl);invariant(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'CALLBACK_HTTPS_URL_REQUIRED');
 invariant(['exact','lowercase'].includes(configuration.urlConvention),'CALLBACK_URL_CONVENTION_REQUIRED');
 const raw=Buffer.isBuffer(rawBody)?rawBody:Buffer.from(rawBody);
 const signature=header(headers,'Request-Signature'),timestamp=header(headers,'Request-Timestamp');
 invariant(/^[0-9a-fA-F]{128}$/.test(signature)&&/^\d+$/.test(timestamp),'CALLBACK_SIGNATURE_FORMAT');
 const parsed=parseSourceJSON(raw,{maxBytes:16*1024*1024}),value=parsed.value;
 invariant(plain(value)&&typeof value.event==='string'&&value.event.length&&plain(value.data),'PAYCASHLESS_EVENT_ENVELOPE_REQUIRED');
 // JSON.stringify is the published message. Reject numeric spellings that would
 // become a different exact amount when reconstructed by that algorithm.
 assertExactNativeNumbers(parsed);
 const dataJSON=JSON.stringify(value.data),callbackURL=configuration.urlConvention==='lowercase'?configuration.callbackUrl.toLowerCase():configuration.callbackUrl;
 const hmac=v=>createHmac('sha512',configuration.apiSecret).update(v).digest('hex');
 const dataHash=hmac(dataJSON),expected=Buffer.from(hmac(callbackURL+dataHash+timestamp),'hex'),observed=Buffer.from(signature,'hex');
 invariant(expected.length===observed.length&&timingSafeEqual(expected,observed),'PAYCASHLESS_SIGNATURE_MISMATCH');
 if(configuration.timestampUnit!==undefined||configuration.maxAgeMs!==undefined){
  invariant(['seconds','milliseconds'].includes(configuration.timestampUnit)&&Number.isSafeInteger(configuration.maxAgeMs)&&configuration.maxAgeMs>0,'CALLBACK_TIMESTAMP_POLICY_REQUIRED');
  const ms=BigInt(timestamp)*(configuration.timestampUnit==='seconds'?1000n:1n),received=BigInt(Date.parse(receivedAt)),future=configuration.futureToleranceMs??60000;
  invariant(Number.isSafeInteger(future)&&future>=0&&ms>=received-BigInt(configuration.maxAgeMs)&&ms<=received+BigInt(future),'CALLBACK_TIMESTAMP_WINDOW');
 }
 const resourceId=typeof value.data.id==='string'&&value.data.id.length?value.data.id:
  typeof value.data.accountRequestCode==='string'&&value.data.accountRequestCode.length?value.data.accountRequestCode:null;
 const eventId=resourceId?JSON.stringify([resourceId,callbackURL,timestamp,sha256(Buffer.from(dataJSON))]):null;
 return {verified:true,verifiedData:true,provider:'paycashless',eventId,eventType:value.event,eventTypeAuthenticated:false,
  authenticatedFields:['data','registeredCallbackUrl','signatureTimestamp'],transactionId:resourceId,projectable:eventId!==null,
  value,numberTokens:parsed.numberTokens,rawSha256:sha256(raw),bytes:raw.length,receivedAt,
  signatureTimestamp:timestamp,signatureAlgorithm:'HMAC-SHA512',signatureScope:'registered-callback-url+HMAC(JSON.stringify(event.data))+timestamp',
  callbackUrl:configuration.callbackUrl,urlConvention:configuration.urlConvention,dataJSONSha256:sha256(Buffer.from(dataJSON)),
  interpretation:'Signature authenticates data, registered URL and timestamp only. The retained envelope event label is unsigned; arrival does not establish current state.'};
}
