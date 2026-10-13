// MIT. Exact issued request input and private SDP bearer authentication.
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

export function credentialBinding(config){
 const token=config.token??null;
 invariant(token===null||typeof token==='string','PRIVATE_CREDENTIAL_BINDING_INVALID');
 return sha256(Buffer.from('amero-provider-binding\0'+config.provider+'\0'+canonicalJSON({token,authMode:config.authMode??null})));
}
export function authenticationSelection(config,action){
 const {entry}=actionContract(action);
 if(entry.provider==='horizon')return null;
 if(entry.provider==='escala')return {protocol:'escala-published-mock-unauthenticated',securityImplemented:false};
 invariant(config.authMode==='apiKey'||config.authMode==='jwt','SDP_AUTH_MODE_REQUIRED');
 return {protocol:'sdp-authorization-bearer',authMode:config.authMode,
  source:'sources/sdp-original-source.json',tenantName:config.tenantName??null};
}
export function injectAuthentication(request,config,headers){
 invariant(canonicalJSON(authenticationSelection(config,request.action))===canonicalJSON(request.authentication),'PREPARED_AUTHENTICATION_SELECTION_CHANGED');
 if(config.provider==='escala')return request.authentication;
 invariant(config.provider==='sdp','AUTHENTICATION_PROVIDER_UNSUPPORTED');
 invariant(typeof config.token==='string'&&config.token.length&&!/[\r\n\0 ]/.test(config.token),'SDP_PRIVATE_TOKEN_REQUIRED');
 if(config.authMode==='apiKey')invariant(config.token.startsWith('SDP_'),'SDP_API_KEY_PREFIX_REQUIRED');
 invariant(!headers.has('Authorization'),'SECURITY_HEADER_ALREADY_PRESENT');
 headers.set('Authorization','Bearer '+config.token);
 return {protocol:'sdp-authorization-bearer',authMode:config.authMode,tenantName:config.tenantName??null};
}
