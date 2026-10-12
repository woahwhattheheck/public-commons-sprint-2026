// MIT. Directus field meaning and lossless JSON over the original SF30 semantic contract.
import {createHash} from 'node:crypto';

export const SEMANTICS_SCHEMA='stellar-forge.directus-semantics.v1';
export const MAX_SOURCE_BYTES=256*1024*1024;
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const fault=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function canonical(value){
  function sorted(v,depth=0){
    if(depth>128)throw fault('DIRECTUS_STRUCTURE','The JSON nesting depth exceeds 128.');
    if(Array.isArray(v))return v.map(x=>sorted(x,depth+1));
    if(object(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k],depth+1)]));
    if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
    throw fault('DIRECTUS_JSON_VALUE','Use complete finite JSON values.');
  }
  return JSON.stringify(sorted(value));
}
export function text(value,label,max=4096){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw fault('DIRECTUS_TEXT',label+' must be nonempty printable text, up to '+max+' characters.');
  return value;
}
export function safeInputJSON(value){
  function check(v,depth=0){
    if(depth>100)throw fault('DIRECTUS_STRUCTURE','Input nesting exceeds 100.');
    if(typeof v==='number'&&(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v)))
      throw fault('DIRECTUS_INPUT_PRECISION','Supply exact patchJson for a number outside the safe integer range.');
    if(Array.isArray(v))v.forEach(x=>check(x,depth+1));
    else if(object(v))Object.values(v).forEach(x=>check(x,depth+1));
    else if(v!==null&&!['string','boolean','number'].includes(typeof v))
      throw fault('DIRECTUS_JSON_VALUE','Use complete JSON input.');
  }
  check(value);return canonical(value);
}

/** Nodes retain the exact numeric token and source span. Numbers never pass through Number(). */
export function parseNativeJSON(source){
  if(typeof source!=='string'||Buffer.byteLength(source)>MAX_SOURCE_BYTES)
    throw fault('DIRECTUS_JSON_SIZE','Use complete UTF-8 JSON within the source size limit.');
  let at=0,count=0;
  const fail=()=>{throw fault('DIRECTUS_SOURCE_JSON','Invalid or duplicate-key native JSON at character '+at+'.');};
  const space=()=>{while(at<source.length&&/[ \t\r\n]/.test(source[at]))at++;};
  function string(){
    const start=at++;
    while(at<source.length){const c=source[at++];if(c==='"'){
      try{return JSON.parse(source.slice(start,at));}catch{fail();}
    }if(c==='\\')at++;}
    fail();
  }
  function read(depth){
    if(depth>100||++count>2000000)throw fault('DIRECTUS_STRUCTURE','Native JSON exceeds its traversal limit.');
    space();const start=at,c=source[at];let type,value;
    if(c==='"'){type='string';value=string();}
    else if(c==='{'){
      type='object';value=Object.create(null);at++;space();
      if(source[at]==='}')at++;
      else while(true){
        space();if(source[at]!=='"')fail();const k=string();
        if(Object.hasOwn(value,k))fail();space();if(source[at++]!==':')fail();
        value[k]=read(depth+1);space();const next=source[at++];if(next==='}')break;if(next!==',')fail();
      }
    }else if(c==='['){
      type='array';value=[];at++;space();
      if(source[at]===']')at++;
      else while(true){value.push(read(depth+1));space();const next=source[at++];if(next===']')break;if(next!==',')fail();}
    }else{
      let found=false;
      for(const [word,result,kind] of [['true',true,'boolean'],['false',false,'boolean'],['null',null,'null']])
        if(source.startsWith(word,at)){at+=word.length;type=kind;value=result;found=true;break;}
      if(!found){
        const m=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(at));
        if(!m)fail();type='number';value=m[0];at+=m[0].length;
      }
    }
    return {type,value,start,end:at,source};
  }
  const node=read(0);space();if(at!==source.length)fail();return node;
}
export const nativeJSON=node=>node.source.slice(node.start,node.end);
export function nativePlain(node){
  if(node.type==='array')return node.value.map(nativePlain);
  if(node.type==='object')return Object.fromEntries(Object.entries(node.value).map(([k,v])=>[k,nativePlain(v)]));
  return node.value;
}
export function canonicalNative(node){
  if(node.type==='array')return '['+node.value.map(canonicalNative).join(',')+']';
  if(node.type==='object')return '{'+Object.keys(node.value).sort().map(k=>JSON.stringify(k)+':'+canonicalNative(node.value[k])).join(',')+'}';
  return node.type==='number'?node.value:JSON.stringify(node.value);
}
export function nativeContains(actual,expected){
  if(!actual||actual.type!==expected.type)return false;
  if(expected.type==='object')return Object.entries(expected.value).every(([k,v])=>nativeContains(actual.value[k],v));
  if(expected.type==='array')return actual.value.length===expected.value.length&&expected.value.every((v,i)=>nativeContains(actual.value[i],v));
  return actual.value===expected.value;
}
export function responseData(node){
  if(node.type!=='object'||!Object.hasOwn(node.value,'data'))throw fault('DIRECTUS_RESPONSE','The native response requires its original data member.');
  return node.value.data;
}
export function nativeCount(node,label){
  if(!node||!['number','string'].includes(node.type)||!/^(0|[1-9][0-9]*)$/.test(node.value)||
      BigInt(node.value)>BigInt(Number.MAX_SAFE_INTEGER))throw fault('DIRECTUS_COUNT',label+' must be an exact nonnegative safe integer.');
  return Number(node.value);
}
export function directusColumnNames(field){
  const suffix=field.replace(/[^A-Za-z0-9_]/g,'_').slice(0,24)+'_'+hash(field).slice(0,8);
  return {value:'value_'+suffix,state:'state_'+suffix};
}
export function buildDirectusSemantics(source,fields){
  const native=source.native_schema,columns=[],pairs=[];
  for(const field of fields){
    const found=native.fields.find(v=>v.field===field);
    if(!found)throw fault('DIRECTUS_FIELD_MISSING','The native schema does not declare '+field+'.');
    const names=directusColumnNames(field);
    const relations=native.relations.filter(v=>v.collection===source.scope.collection&&v.field===field||
      v.related_collection===source.scope.collection&&v.meta?.one_field===field);
    const definition={collection:source.scope.collection,field,sourcePath:field,type:found.type??'unknown',
      nullable:typeof found.schema?.is_nullable==='boolean'?found.schema.is_nullable:null,
      schema:found.schema??null,meta:found.meta??null,relations};
    const projected={name:names.value,datatype:'string',titles:field,
      'directus:encoding':'exact-json-value','directus:type':definition.type,
      'directus:stateColumn':names.state};
    const stateDefinition={sourcePath:field,role:'source-presence',sourceNullable:definition.nullable,
      values:['value','null','missing']};
    const stateProjected={name:names.state,datatype:'string',titles:field+' source presence',
      'directus:valueColumn':names.value};
    columns.push({name:names.value,type:'string',nullable:false,sourceField:field,encoding:'json',
      role:'value',stateColumn:names.state,sourceDefinition:definition,projectedDefinition:projected,issues:[]},
    {name:names.state,type:'string',nullable:false,sourceField:field,encoding:'native',role:'state',
      valueColumn:names.value,sourceDefinition:stateDefinition,projectedDefinition:stateProjected,issues:[]});
    pairs.push({field,...names});
  }
  const pk=source.scope.primary_key,pkPair=pairs.find(v=>v.field===pk);
  const sourceMeaning={provider:'directus',protocolVersion:'12.5',baseUrl:source.base_url,
    collection:source.scope.collection,query:source.scope.query,principal:source.principal,
    primaryField:pk,definitionNumericEncoding:'original-json-number-lexemes',
    captureManifestSha256:source.sha256,schemaSha256:source.schema_sha256};
  const payload={schema:SEMANTICS_SCHEMA,source:sourceMeaning,columns,
    primaryKey:{source:[pk],projected:pkPair?[pkPair.value]:[],complete:!!pkPair},
    aboutUrl:{source:source.base_url+'items/'+encodeURIComponent(source.scope.collection),template:null},
    virtualColumns:[],issues:[],directus:{collection:native.collection,fields:native.fields,relations:native.relations},
    csvw:{'@context':'http://www.w3.org/ns/csvw',tableSchema:{columns:columns.map(v=>v.projectedDefinition)}}};
  const {captureManifestSha256,schemaSha256,...meaning}=sourceMeaning;
  const definitionSha256=hash(canonical({...payload,source:meaning}));
  const semantics={...payload,definitionSha256,sha256:hash(canonical({...payload,definitionSha256}))};
  return {semantics,pairs};
}
