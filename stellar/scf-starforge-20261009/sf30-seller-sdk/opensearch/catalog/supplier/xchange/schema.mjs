// MIT. Validation and exact numeric JSON for the pinned ETIM xChange 2.0 schema.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { WorkspaceError, clone, canonical } from '../../../workspace/store.mjs';
const schemaBytes=readFileSync(new URL('./source/ETIM_xChange_Schema_V2.0_2025-11-27.json',import.meta.url));
if(createHash('sha256').update(schemaBytes).digest('hex')!=='5d05577f392661397fbbeff7a1e0486796a515ae65afbe8ab069ab1c9697f20a')throw new Error('XCHANGE_SCHEMA_SOURCE_CHANGED');
export const XCHANGE_SCHEMA=JSON.parse(schemaBytes.toString('utf8'));
export const XCHANGE_SCHEMA_SOURCE=Object.freeze({url:'https://etim.de/wp-content/uploads/2025/12/ETIM-xChange_V2.0-2025-11-27.zip',schemaUrl:'https://www.etim-international.com/xChange/20',schemaGitBlob:'e58d6c0ed08c65dd35eaf711d63301b095a69f6c',schemaSha256:'5d05577f392661397fbbeff7a1e0486796a515ae65afbe8ab069ab1c9697f20a',archiveSha256:'7493b2d6af6f6d79b51a366ccf7379161a6723dcd291755aff789a0b7e3a2608',revision:'2.0 / 2025-11-27',license:'https://www.apache.org/licenses/LICENSE-2.0',copyright:'2025 ETIM International'});
export const XCHANGE_SUPPLIER_SCHEMA=XCHANGE_SCHEMA.properties.Supplier.items;
export const XCHANGE_PRODUCT_SCHEMA=XCHANGE_SUPPLIER_SCHEMA.properties.Product.items;
export const XCHANGE_TRADE_SCHEMA=XCHANGE_PRODUCT_SCHEMA.properties.TradeItem.items;
export const pointerPart=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(v,k)=>Object.hasOwn(v,k);
const fail=(code,message)=>{throw new WorkspaceError(code,message,422);};
const KEYWORDS=new Set(['$copyright','$id','$license','$schema','additionalProperties','enum','exclusiveMaximum','format','items','maxLength','minItems','minLength','minimum','pattern','properties','required','title','type','uniqueItems']);
const patterns=new WeakMap();
(function inspect(node,path=''){for(const key of Object.keys(node))if(!KEYWORDS.has(key))throw new Error('XCHANGE_SCHEMA_KEYWORD:'+path+'/'+key);if(node.pattern)patterns.set(node,new RegExp(node.pattern,'u'));if(node.properties)for(const[k,v]of Object.entries(node.properties))inspect(v,path+'/properties/'+pointerPart(k));if(node.items)inspect(node.items,path+'/items');})(XCHANGE_SCHEMA);
const NUMBER=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
function numberParts(token){
  if(typeof token!=='string'||token.length>4096||!NUMBER.test(token))return null;
  const m=/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  const exponent=Number(m[4]??0)-(m[3]??'').length;
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100000)return null;
  let digits=(m[2]+(m[3]??'')).replace(/^0+/,'')||'0',e=exponent;
  if(digits==='0')return {sign:1,digits:'0',exponent:0};
  while(digits.endsWith('0')){digits=digits.slice(0,-1);e++;}
  return {sign:m[1]?-1:1,digits,exponent:e};
}
function numberIdentity(token){const n=numberParts(token);return n?String(n.sign)+':'+n.digits+':'+n.exponent:null;}
function compareNumber(a,b){const x=numberParts(a),y=numberParts(b);if(!x||!y)return null;if(x.sign!==y.sign)return x.sign<y.sign?-1:1;
  const ax=x.digits.length+x.exponent,ay=y.digits.length+y.exponent;
  if(ax!==ay)return (ax<ay?-1:1)*x.sign;
  const length=Math.max(x.digits.length,y.digits.length),xx=x.digits.padEnd(length,'0'),yy=y.digits.padEnd(length,'0');
  return (xx===yy?0:xx<yy?-1:1)*x.sign;
}
export function pointerGet(value,pointer){if(pointer==='')return value;if(typeof pointer!=='string'||!pointer.startsWith('/'))return undefined;let v=value;for(const encoded of pointer.slice(1).split('/')){if(/~(?:[^01]|$)/.test(encoded))return undefined;const k=encoded.replaceAll('~1','/').replaceAll('~0','~');if(v===null||typeof v!=='object'||!own(v,k))return undefined;v=v[k];}return v;}
export function validNumberToken(value){return numberParts(value)!==null;}
export function reconcileNumberTokens(value,tokens={}){
  if(!object(tokens))fail('XCHANGE_NUMBER_TOKENS','Numeric token metadata must be an exact JSON Pointer map.');
  const result={};
  for(const[path,token]of Object.entries(tokens)){
    if(!validNumberToken(token)||pointerGet(value,path)!==token)fail('XCHANGE_NUMBER_TOKEN_CHANGED','The numeric token at '+path+' must match its original exact string value; update value and metadata together.');
    result[path]=token;
  }
  return result;
}
function jsonIdentity(value,tokens,path=''){
  if(own(tokens,path))return 'number:'+numberIdentity(tokens[path]);
  if(Array.isArray(value))return '['+value.map((v,i)=>jsonIdentity(v,tokens,path+'/'+i)).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+jsonIdentity(value[k],tokens,path+'/'+pointerPart(k))).join(',')+'}';
  if(typeof value==='number')return 'number:'+numberIdentity(String(value));
  return JSON.stringify(value);
}
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const[y,m,d]=value.split('-').map(Number);const leap=y%4===0&&(y%100!==0||y%400===0);return m>=1&&m<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];}
function email(value){ // JSON Schema format-assertion's deliberately conservative mailbox syntax.
  if(value.length>320||/[\r\n\0]/.test(value))return false;
  const at=value.lastIndexOf('@');if(at<1||at===value.length-1)return false;
  const local=value.slice(0,at),domain=value.slice(at+1);
  const atom=/^[A-Za-z0-9!#$%&'*+\-/=?^_\x60{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_\x60{|}~]+)*$/;
  const quoted=/^"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"$/;
  return (atom.test(local)||quoted.test(local))&&(/^\[[^\]\s]+\]$/.test(domain)||domain.split('.').every(x=>/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(x)));
}
// RFC3986 AppendixA syntax, including non-HTTP absolute URIs.
function uri(value){
  const match=/^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(value);if(!match)return false;
  const atom="(?:[A-Za-z0-9\\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})";
  const pathPattern=new RegExp('^(?:'+atom+'|/)*$'),queryPattern=new RegExp('^(?:'+atom+'|[/?])*$');
  let rest=match[2];
  const hash=rest.indexOf('#');if(hash>=0){const fragment=rest.slice(hash+1);rest=rest.slice(0,hash);if(!queryPattern.test(fragment))return false;}
  const question=rest.indexOf('?');if(question>=0){const query=rest.slice(question+1);rest=rest.slice(0,question);if(!queryPattern.test(query))return false;}
  if(!rest.startsWith('//'))return pathPattern.test(rest);
  const slash=rest.indexOf('/',2),authority=rest.slice(2,slash<0?undefined:slash),path=slash<0?'':rest.slice(slash);
  if(!pathPattern.test(path))return false;
  const at=authority.lastIndexOf('@'),hostport=at<0?authority:authority.slice(at+1);
  if(at>=0&&!/^(?:[A-Za-z0-9\-._~!$&'()*+,;=:]|%[0-9A-Fa-f]{2})*$/.test(authority.slice(0,at)))return false;
  if(hostport.startsWith('[')){
    const end=hostport.indexOf(']');if(end<0||! /^(?::[0-9]*)?$/.test(hostport.slice(end+1)))return false;
    const ip=hostport.slice(1,end);
    if(/^[vV][0-9A-Fa-f]+\.[A-Za-z0-9\-._~!$&'()*+,;=:]+$/.test(ip))return true;
    if(ip.includes(':::')||(ip.match(/::/g)??[]).length>1)return false;
    const halves=ip.split('::');let units=0;
    for(const part of halves.flatMap(h=>h?h.split(':'):[])){
      if(part.includes('.')){const octets=part.split('.');if(part!==ip.split(':').at(-1)||octets.length!==4||octets.some(v=>!/^(?:0|[1-9][0-9]{0,2})$/.test(v)||Number(v)>255))return false;units+=2;}
      else{if(!/^[0-9A-Fa-f]{1,4}$/.test(part))return false;units++;}
    }
    return halves.length===2?units<8:units===8;
  }
  const colon=hostport.lastIndexOf(':'),host=colon<0?hostport:hostport.slice(0,colon);
  if(colon>=0&&!/^[0-9]*$/.test(hostport.slice(colon+1)))return false;
  return /^(?:[A-Za-z0-9\-._~!$&'()*+,;=]|%[0-9A-Fa-f]{2})*$/.test(host);
}
export function validateXChange(value,{schema=XCHANGE_SCHEMA,numberTokens={},path='',schemaPath='',omit=[]}={}){
  const findings=[],ignored=new Set(omit);
  const add=(code,p,message,sp)=>findings.push({severity:'error',code,path:path+p,message,rule:{url:XCHANGE_SCHEMA_SOURCE.schemaUrl,section:'JSON Schema '+(schemaPath+sp||'/')}});
  let tokens;try{tokens=reconcileNumberTokens(value,numberTokens);}catch(e){add(e.code??'XCHANGE_NUMBER_TOKENS','',e.message,'');tokens={};}
  (function untracked(v,p=''){if(typeof v==='number'&&(!Number.isFinite(v)||!Number.isSafeInteger(v)))add('XCHANGE_NATIVE_NUMBER_UNTRACKED',p,'Supply the exact numeric token as a string in a reasoned native-field correction, with matching numeric metadata.','');if(Array.isArray(v)){for(let i=0;i<v.length;i++)untracked(v[i],p+'/'+i);}else if(object(v)){for(const[k,x]of Object.entries(v))untracked(x,p+'/'+pointerPart(k));}})(value);
  function visit(v,n,p,sp,depth=0){
    if(n.type===undefined&&Object.keys(n).length===0)return;
    if(depth>128){add('XCHANGE_SCHEMA_DEPTH',p,'The value exceeds the original intake depth limit.',sp);return;}
    const numeric=own(tokens,p),token=numeric?tokens[p]:typeof v==='number'&&Number.isFinite(v)?String(v):null;
    const parts=token===null?null:numberParts(token);
    let valid=false;
    if(n.type==='object')valid=object(v);else if(n.type==='array')valid=Array.isArray(v);
    else if(n.type==='string')valid=typeof v==='string'&&!numeric;
    else if(n.type==='boolean')valid=typeof v==='boolean';
    else if(n.type==='number')valid=parts!==null;
    else if(n.type==='integer')valid=parts!==null&&parts.exponent>=0;
    if(!valid){add('XCHANGE_SCHEMA_TYPE',p,'Expected original JSON '+n.type+'.',sp+'/type');return;}
    if(n.enum&&!n.enum.some(x=>canonical(x)===canonical(v)))add('XCHANGE_SCHEMA_ENUM',p,'The value is absent from the selected original code list.',sp+'/enum');
    if(n.type==='object'){
      for(const key of n.required??[])if(!(p===''&&ignored.has(key))&&!own(v,key))add('XCHANGE_SCHEMA_REQUIRED',p+'/'+pointerPart(key),'The original schema requires '+key+'.',sp+'/required');
      for(const[k,x]of Object.entries(v)){if(p===''&&ignored.has(k))continue;const child=n.properties?.[k];if(!child){if(n.additionalProperties===false)add('XCHANGE_SCHEMA_ADDITIONAL_PROPERTY',p+'/'+pointerPart(k),'This field is absent from the pinned xChange 2.0 schema.',sp+'/additionalProperties');}else visit(x,child,p+'/'+pointerPart(k),sp+'/properties/'+pointerPart(k),depth+1);}
    }else if(n.type==='array'){
      if(n.minItems!==undefined&&v.length<n.minItems)add('XCHANGE_SCHEMA_MIN_ITEMS',p,'This original array needs at least '+n.minItems+' item(s).',sp+'/minItems');
      const seen=new Set();for(let i=0;i<v.length;i++){if(n.uniqueItems){const id=jsonIdentity(v[i],tokens,p+'/'+i);if(seen.has(id))add('XCHANGE_SCHEMA_UNIQUE_ITEMS',p+'/'+i,'This array repeats an original value.',sp+'/uniqueItems');seen.add(id);}if(n.items)visit(v[i],n.items,p+'/'+i,sp+'/items',depth+1);}
    }else if(n.type==='string'){
      const length=[...v].length;
      if(n.minLength!==undefined&&length<n.minLength)add('XCHANGE_SCHEMA_MIN_LENGTH',p,'At least '+n.minLength+' Unicode characters are required.',sp+'/minLength');
      if(n.maxLength!==undefined&&length>n.maxLength)add('XCHANGE_SCHEMA_MAX_LENGTH',p,'At most '+n.maxLength+' Unicode characters are allowed.',sp+'/maxLength');
      if(n.pattern&&!patterns.get(n).test(v))add('XCHANGE_SCHEMA_PATTERN',p,'The value does not match the original schema pattern.',sp+'/pattern');
      if(n.format&&!(n.format==='date'?date(v):n.format==='email'?email(v):n.format==='uri'?uri(v):false))add('XCHANGE_SCHEMA_FORMAT',p,'Use an original valid '+n.format+' value.',sp+'/format');
    }else if(parts){
      if(n.minimum!==undefined&&compareNumber(token,String(n.minimum))<0)add('XCHANGE_SCHEMA_MINIMUM',p,'The number is below the original minimum '+n.minimum+'.',sp+'/minimum');
      if(n.exclusiveMaximum!==undefined&&compareNumber(token,String(n.exclusiveMaximum))>=0)add('XCHANGE_SCHEMA_EXCLUSIVE_MAXIMUM',p,'The number must be below '+n.exclusiveMaximum+'.',sp+'/exclusiveMaximum');
    }
  }
  visit(value,schema,'','');
  return findings;
}
export function* exactJSON(value,{numberTokens={},schema=null,fieldOrder=null}={}){
  const tokens=reconcileNumberTokens(value,numberTokens);
  function* emit(v,path,n,preferred){
    if(own(tokens,path)){yield tokens[path];return;}
    if(Array.isArray(v)){yield '[';for(let i=0;i<v.length;i++){if(i)yield ',';yield*emit(v[i],path+'/'+i,n?.items,null);}yield ']';return;}
    if(object(v)){yield '{';const keys=[...new Set([...(n?.properties?Object.keys(n.properties):preferred??[]),...Object.keys(v)])].filter(k=>own(v,k));let first=true;for(const k of keys){if(!first)yield ',';first=false;yield JSON.stringify(k)+':';yield*emit(v[k],path+'/'+pointerPart(k),n?.properties?.[k],null);}yield '}';return;}
    if(typeof v==='number'&&(!Number.isFinite(v)||!Number.isSafeInteger(v)))fail('XCHANGE_NATIVE_NUMBER_UNTRACKED','Native numeric values must carry exact numeric-token metadata.');
    const text=JSON.stringify(v);if(text===undefined)fail('XCHANGE_JSON_VALUE','Unsupported JSON value.');yield text;
  }
  yield*emit(value,'',schema,fieldOrder);
}
export function sliceNumberTokens(tokens,prefix){const out={};for(const[path,value]of Object.entries(tokens??{}))if(path===prefix||path.startsWith(prefix+'/'))out[path.slice(prefix.length)]=value;return out;}
export function joinNumberTokens(groups){const out={};for(const[prefix,tokens]of groups)for(const[path,value]of Object.entries(tokens??{})){const key=prefix+path;if(own(out,key)&&out[key]!==value)fail('XCHANGE_NUMBER_TOKEN_CONFLICT','Conflicting token metadata.');out[key]=value;}return out;}
