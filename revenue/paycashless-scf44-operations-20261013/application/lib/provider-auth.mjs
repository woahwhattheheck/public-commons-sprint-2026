// MIT. Implements the complete retained Paycashless signing instructions.
import {createHmac} from 'node:crypto';
import {invariant,sha256,canonicalJSON,parseSourceJSON} from './source-json.mjs';
import {decimal} from './decimal.mjs';
import {actionContract} from './catalogue.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const at=(value,pointer)=>pointer.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~')).reduce((v,k)=>v[k],value);
export function assertExactNativeNumbers(parsed){
 for(const [pointer,token] of Object.entries(parsed.numberTokens)){
  const value=pointer===''?parsed.value:at(parsed.value,pointer);
  invariant(Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value))&&
    decimal(token)===decimal(String(value)),'REQUEST_NUMBER_NOT_EXACT',{pointer,token});
 }
 return parsed.value;
}
export function exactInput(args){
 invariant(plain(args),'OPERATION_ARGUMENTS_REQUIRED');
 invariant(!(Object.hasOwn(args,'inputJSON')&&Object.hasOwn(args,'input')),'INPUT_FORMS_EXCLUSIVE');
 if(Object.hasOwn(args,'inputJSON')){
  invariant(typeof args.inputJSON==='string','INPUT_JSON_TEXT_REQUIRED');
  return assertExactNativeNumbers(parseSourceJSON(Buffer.from(args.inputJSON),{maxBytes:8*1024*1024}));
 }
 invariant(plain(args.input??{}),'OPERATION_INPUT_REQUIRED');
 return assertExactNativeNumbers(parseSourceJSON(Buffer.from(JSON.stringify(args.input??{}))));
}
// This is the publisher's exact object-recursion rule: array contents are not sorted.
export function signedBodyValue(value){
 if(!plain(value))return value;
 const output=Object.create(null);
 for(const key of Object.keys(value).sort())output[key]=plain(value[key])?signedBodyValue(value[key]):value[key];
 return output;
}
export function signedBodyJSON(value){return JSON.stringify(signedBodyValue(value));}
export function authenticationSelection(config,action){
 const {entry}=actionContract(action);
 if(entry.provider!=='paycashless')return null;
 return {protocol:'paycashless-bearer-hmac-sha512.v1',bearer:'apiKey',signing:'apiSecret',
  requestPath:'lowercase-path-excluding-query',body:'published-object-sort-JSON.stringify',
  source:'https://docs.paycashless.com/api-signature.md',authenticationSource:'https://docs.paycashless.com/api-reference/authentication.md',sourceReceipts:'sources/provider-source-receipts.json'};
}
export function credentialBinding(config){
 const selected=config.provider==='paycashless'?{apiKey:config.apiKey??null,apiSecret:config.apiSecret??null}:{token:config.token??null};
 invariant(Object.values(selected).every(v=>v===null||typeof v==='string'),'PRIVATE_CREDENTIAL_BINDING_INVALID');
 return sha256(Buffer.from('paycashless-provider-binding\0'+config.provider+'\0'+canonicalJSON(selected)));
}
export function signPaycashlessRequest({path,body=null,timestamp,secret}){
 invariant(typeof path==='string'&&path.startsWith('/')&&!/[?#]/.test(path),'SIGNING_PATH_INVALID');
 invariant(typeof secret==='string'&&secret.length&&!/[\r\n\0]/.test(secret),'PAYCASHLESS_API_SECRET_REQUIRED');
 invariant(typeof timestamp==='string'&&/^\d{10}$/.test(timestamp),'SIGNATURE_SECONDS_REQUIRED');
 const hmac=value=>createHmac('sha512',secret).update(value).digest('hex');
 const bodyHash=body===null?null:hmac(body);
 return {signature:hmac(path.toLowerCase()+(bodyHash??'')+timestamp),timestamp,bodyHash};
}
export function injectPaycashlessAuthentication(request,config,headers,url){
 invariant(canonicalJSON(authenticationSelection(config,request.action))===canonicalJSON(request.authentication),'PREPARED_AUTHENTICATION_SELECTION_CHANGED');
 invariant(typeof config.apiKey==='string'&&config.apiKey.length&&!/[\r\n\0]/.test(config.apiKey),'PAYCASHLESS_API_KEY_REQUIRED');
 for(const name of ['Authorization','Request-Signature','Request-Timestamp'])invariant(!headers.has(name),'SECURITY_HEADER_ALREADY_PRESENT',{name});
 const body=request.bodyBase64===null?null:Buffer.from(request.bodyBase64,'base64');
 const signed=signPaycashlessRequest({path:url.pathname,body,timestamp:String(Math.floor(Date.now()/1000)),secret:config.apiSecret});
 headers.set('Authorization','Bearer '+config.apiKey);
 headers.set('Request-Signature',signed.signature);headers.set('Request-Timestamp',signed.timestamp);
 return {protocol:request.authentication.protocol,timestamp:signed.timestamp,path:url.pathname.toLowerCase(),bodyHash:signed.bodyHash};
}
