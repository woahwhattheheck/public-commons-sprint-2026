// MIT. Field review of complete original native documents, with lossless JSON number comparison.
import { createHash } from 'node:crypto';
export const TYK_DEFINITION_REVIEW_SCHEMA='stellar-forge.tyk-definition-review.v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const bytes=value=>Buffer.byteLength(value,'utf8');
const fail=message=>Object.assign(new Error(message),{code:'TYK_REVIEW_SOURCE_INVALID',status:400});
const NUMBER=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
function decimal(token){
  const match=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  const [,sign,integer,fraction='',exponent='0']=match;
  let digits=(integer+fraction).replace(/^0+/,'');
  if(!digits)return '0';
  if(exponent.length>1024)return 'lexeme:'+token;
  const trailing=/0+$/.exec(digits)?.[0].length??0;
  if(trailing)digits=digits.slice(0,-trailing);
  return sign+digits+'e'+String(BigInt(exponent)-BigInt(fraction.length)+BigInt(trailing));
}
/** Keep original character spans and decimal lexemes; parsed JS numbers never determine a difference. */
function document(text){
  if(typeof text!=='string')throw fail('A complete original document is required.');
  try{JSON.parse(text);}catch{return {type:'text',start:0,end:text.length,sha256:hash(text)};}
  let at=0;
  const whitespace=()=>{while(at<text.length&&/[\t\n\r ]/.test(text[at]))at++;};
  function string(){
    const start=at++;
    while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"')break;}
    return {start,end:at,value:JSON.parse(text.slice(start,at))};
  }
  function value(depth=0){
    if(depth>1024)throw fail('The native JSON document exceeds the supported review nesting depth.');
    whitespace();const start=at,c=text[at];let type,parts,children;
    if(c==='{'){
      type='object';children=new Map();at++;whitespace();
      if(text[at]!=='}')for(;;){
        const key=string().value;whitespace();at++;
        if(children.has(key))throw fail('The native JSON object repeats a member name; review its original text.');
        children.set(key,value(depth+1));whitespace();
        if(text[at]===','){at++;whitespace();continue;}break;
      }
      at++;parts=[...children].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,node])=>[key,node.sha256]);
    }else if(c==='['){
      type='array';children=[];at++;whitespace();
      if(text[at]!==']')for(;;){children.push(value(depth+1));whitespace();if(text[at]===','){at++;continue;}break;}
      at++;parts=children.map(node=>node.sha256);
    }else if(c==='"'){type='string';parts=string().value;}
    else if(text.startsWith('true',at)){type='boolean';parts=true;at+=4;}
    else if(text.startsWith('false',at)){type='boolean';parts=false;at+=5;}
    else if(text.startsWith('null',at)){type='null';parts=null;at+=4;}
    else{type='number';NUMBER.lastIndex=at;const token=NUMBER.exec(text)?.[0];if(!token)throw fail('Invalid native JSON value.');at+=token.length;parts=decimal(token);}
    return {type,start,end:at,sha256:hash(JSON.stringify([type,parts])),...(children?{children}:{})};
  }
  try{const root=value();whitespace();if(at!==text.length)throw fail('The native document has trailing content.');return root;}
  catch(error){
    if(error.code!=='TYK_REVIEW_SOURCE_INVALID')throw error;
    // Repeated keys and extreme nesting remain a complete exact-text comparison.
    return {type:'text',start:0,end:text.length,sha256:hash(text),note:error.message};
  }
}
const pointer=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
function category(path){
  const selected=path.toLowerCase();
  if(/(?:^|\/)(?:security|securityschemes|authentication|auth(?:_configs)?|oauth2?|oauth_meta|use_keyless|use_standard_auth|enable_jwt|jwt|jwt_[^/]*|hmac[^/]*|basic_auth[^/]*|use_basic_auth|certificate[^/]*|session[^/]*|token[^/]*)(?:\/|$)/.test(selected))return 'authentication';
  if(/(?:^|\/)(?:target_url|targeturl|upstream|upstreams|servers|transport|load_balancing_targets|service_discovery)(?:\/|$)/.test(selected))return 'upstream';
  if(/(?:^|\/)(?:middleware|extended_paths|cache_options|global_headers|global_headers_remove|transform[^/]*|custom_middleware|plugins|cors|rate_limit|quotas?)(?:\/|$)/.test(selected))return 'middleware';
  if(/(?:^|\/)(?:paths|listen_path|listenpath|routing|domain|version_data|versions|versioning|strip_listen_path)(?:\/|$)/.test(selected))return 'routing';
  return 'metadata';
}
function preview(text,node){
  if(!node)return null;
  const original=text.slice(node.start,node.end),maximum=1200;
  return {type:node.type,sha256:hash(original),semanticSha256:node.sha256,bytes:bytes(original),
    preview:original.slice(0,maximum),truncated:original.length>maximum};
}
function changesFor(apiId,before,after){
  const left=before.state==='PRESENT'?document(before.definitionText):null;
  const right=after.state==='PRESENT'?document(after.definitionText):null,changes=[];
  function walk(a,b,path){
    if(a?.sha256===b?.sha256&&Boolean(a)===Boolean(b))return;
    if(a&&b&&a.type===b.type&&a.type==='object'){
      for(const key of [...new Set([...a.children.keys(),...b.children.keys()])].sort())
        walk(a.children.get(key),b.children.get(key),path+'/'+pointer(key));
      return;
    }
    if(a&&b&&a.type===b.type&&a.type==='array'){
      for(let index=0;index<Math.max(a.children.length,b.children.length);index++)
        walk(a.children[index],b.children[index],path+'/'+index);
      return;
    }
    changes.push({apiId,path,category:category(path),change:a?(b?'CHANGED':'REMOVED'):'ADDED',
      before:preview(before.definitionText??'',a),after:preview(after.definitionText??'',b)});
  }
  walk(left,right,'');
  return {changes,comparison:left?.type==='text'||right?.type==='text'?'COMPLETE_TEXT':'LOSSLESS_JSON',
    notes:[left?.note,right?.note].filter(Boolean)};
}
function source(value){
  if(!value||!['PRESENT','ABSENT','PENDING'].includes(value.state))throw fail('Declare the original source presence.');
  if(value.state==='PRESENT'&&typeof value.definitionText!=='string')throw fail('Retain the complete native source text.');
  return {state:value.state,...(value.reference?{reference:value.reference}:{}),
    ...(value.kind?{kind:value.kind}:{}),...(value.role?{role:value.role}:{})};
}
/** Input pairs retain their complete documents separately as original content-addressed source blobs. */
export function buildTykDefinitionReview({stage,planSha256,pairs=[]}={}){
  if(!['REQUEST_PREPARED','NATIVE_CONVERSION','CURRENT_READBACK'].includes(stage)||
    !/^[a-f0-9]{64}$/.test(planSha256??'')||!Array.isArray(pairs))throw fail('Use the saved native request and its review phase.');
  const sources=[],changes=[],summary={apis:pairs.length,changedApis:0,unchangedApis:0,pendingApis:0,
    changes:0,added:0,removed:0,changed:0,byCategory:{routing:0,authentication:0,middleware:0,upstream:0,metadata:0}};
  for(const pair of pairs){
    if(typeof pair.apiId!=='string'||!pair.apiId)throw fail('Retain the selected API identity.');
    const before=source(pair.before),after=source(pair.after);
    const pending=before.state==='PENDING'||after.state==='PENDING';
    const result=pending?{changes:[],comparison:'AWAITING_NATIVE_DOCUMENT',notes:[]}:changesFor(pair.apiId,pair.before,pair.after);
    const offset=changes.length;for(const change of result.changes)changes.push(change);
    if(pending)summary.pendingApis++;else if(result.changes.length)summary.changedApis++;else summary.unchangedApis++;
    sources.push({apiId:pair.apiId,beforeApiId:pair.beforeApiId??pair.apiId,afterApiId:pair.afterApiId??pair.apiId,
      relationship:pair.relationship??'SAME_NATIVE_API',before,after,comparison:result.comparison,notes:result.notes,
      changes:result.changes.length,changeOffset:offset});
  }
  for(const change of changes){summary.changes++;summary[change.change.toLowerCase()]++;summary.byCategory[change.category]++;}
  return {schema:TYK_DEFINITION_REVIEW_SCHEMA,stage,planSha256,summary,sources,changes};
}
