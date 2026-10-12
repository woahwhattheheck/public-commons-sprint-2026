import protobuf from 'protobufjs';

export const GRPC_VALUE_REPRESENTATION = 'sf30-grpc-native-json-v1';
export const GRPC_VALUE_LIMITS = Object.freeze({depth:64,nodes:262144,bytes:64*1024*1024});
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const plain = value => value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const SIGNED32 = new Set(['int32','sint32','sfixed32']);
const UNSIGNED32 = new Set(['uint32','fixed32']);
const SIGNED64 = new Set(['int64','sint64','sfixed64']);
const UNSIGNED64 = new Set(['uint64','fixed64']);
const FLOATS = new Set(['float','double']);
const FLOAT_TOKENS = Object.freeze(['NaN','Infinity','-Infinity','-0']);
const BASE64_PATTERN = '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';
const BASE64 = new RegExp(BASE64_PATTERN);
const DECIMAL = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const MIN64 = -(1n<<63n),MAX64 = (1n<<63n)-1n,MAXU64 = (1n<<64n)-1n;
const FLOAT32_MAX = 3.4028234663852886e38;
const schemaCache = new WeakMap();
const fullName = type => type.fullName.replace(/^\./,'');

function invalid(context,location,message){
  const error=new Error(location+': '+message);
  error.code=context.direction==='response'?'grpc_response_invalid':'grpc_request_invalid';
  error.field_path=location;
  throw error;
}
function requireValue(context,ok,location,message){if(!ok)invalid(context,location,message);}
function at(location,key){return location+'['+JSON.stringify(key)+']';}
function contextFor(direction){return {direction,nodes:0,bytes:0,ancestors:new WeakSet()};}
function count(context,location,depth){
  requireValue(context,depth<=GRPC_VALUE_LIMITS.depth,location,'message nesting exceeds '+GRPC_VALUE_LIMITS.depth);
  requireValue(context,++context.nodes<=GRPC_VALUE_LIMITS.nodes,location,'the message contains too many values');
}
function textValue(context,value,location){
  requireValue(context,typeof value==='string',location,'expected a string');
  const bytes=Buffer.byteLength(value,'utf8');
  context.bytes+=bytes;
  requireValue(context,context.bytes<=GRPC_VALUE_LIMITS.bytes,location,'the message text exceeds 64 MiB');
  requireValue(context,Buffer.from(value,'utf8').toString('utf8')===value,location,'the string contains an unpaired Unicode surrogate');
  return value;
}
function container(context,value,location,action){
  requireValue(context,!context.ancestors.has(value),location,'a protobuf JSON message cannot contain a reference cycle');
  context.ancestors.add(value);
  try{return action();}finally{context.ancestors.delete(value);}
}
function objectKeys(context,value,location){
  requireValue(context,plain(value),location,'expected a JSON object');
  requireValue(context,Object.getOwnPropertySymbols(value).length===0,location,'symbol properties are not JSON fields');
  const keys=Object.keys(value);
  for(const key of keys)requireValue(context,own(Object.getOwnPropertyDescriptor(value,key),'value'),at(location,key),'accessor properties are not JSON fields');
  return keys;
}
function longValue(context,value,type,location){
  requireValue(context,typeof value==='string'&&value.length<=20&&DECIMAL.test(value),location,'expected a canonical decimal string for '+type);
  const integer=BigInt(value),unsigned=UNSIGNED64.has(type);
  requireValue(context,integer>=(unsigned?0n:MIN64)&&integer<=(unsigned?MAXU64:MAX64),location,'the decimal string is outside the '+type+' range');
  return value;
}
function integer32(context,value,type,location){
  const unsigned=UNSIGNED32.has(type);
  requireValue(context,typeof value==='number'&&Number.isInteger(value)&&value>=(unsigned?0:-2147483648)&&value<=(unsigned?4294967295:2147483647),location,'expected an integer in the '+type+' range');
  return Object.is(value,-0)?0:value;
}
function enumValue(context,value,type,location){
  if(typeof value==='string'){
    requireValue(context,own(type.values,value),location,'unknown '+fullName(type)+' enum name '+JSON.stringify(value));
    return value;
  }
  return integer32(context,value,'int32',location);
}
function scalar(context,value,field,location,depth){
  if(field.resolvedType instanceof protobuf.Type)return messageValue(context,value,field.resolvedType,location,depth);
  count(context,location,depth);
  if(field.resolvedType instanceof protobuf.Enum)return enumValue(context,value,field.resolvedType,location);
  const type=field.type;
  if(SIGNED64.has(type)||UNSIGNED64.has(type))return longValue(context,value,type,location);
  if(SIGNED32.has(type)||UNSIGNED32.has(type))return integer32(context,value,type,location);
  if(type==='bool'){requireValue(context,typeof value==='boolean',location,'expected a boolean');return value;}
  if(type==='string')return textValue(context,value,location);
  if(type==='bytes'){
    if(context.direction==='response'&&(Buffer.isBuffer(value)||value instanceof Uint8Array))value=Buffer.from(value).toString('base64');
    textValue(context,value,location);
    requireValue(context,BASE64.test(value)&&Buffer.from(value,'base64').toString('base64')===value,location,'expected canonical standard base64, including padding when needed');
    return value;
  }
  if(FLOATS.has(type)){
    if(typeof value==='string'){
      requireValue(context,FLOAT_TOKENS.includes(value),location,'expected a number or one of '+FLOAT_TOKENS.join(', '));
      return value;
    }
    requireValue(context,typeof value==='number',location,'expected a number');
    if(!Number.isFinite(value))return Number.isNaN(value)?'NaN':value>0?'Infinity':'-Infinity';
    if(Object.is(value,-0))return '-0';
    requireValue(context,type!=='float'||Math.abs(value)<=FLOAT32_MAX,location,'the finite value is outside the float32 range; use an explicit infinity token when intended');
    return value;
  }
  invalid(context,location,'unsupported protobuf field type '+type);
}
function keyValue(context,key,type,location){
  textValue(context,key,location);
  if(type==='string')return key;
  if(type==='bool'){
    requireValue(context,key==='true'||key==='false',location,'boolean map keys must be true or false');
    return key;
  }
  if(SIGNED64.has(type)||UNSIGNED64.has(type))return longValue(context,key,type,location);
  requireValue(context,(SIGNED32.has(type)||UNSIGNED32.has(type))&&DECIMAL.test(key)&&key.length<=11,location,'expected a canonical '+type+' map key');
  integer32(context,Number(key),type,location);
  return key;
}
function responseMapKey(context,key,field,location){
  if(context.direction!=='response'||(!SIGNED64.has(field.keyType)&&!UNSIGNED64.has(field.keyType)))return key;
  const format=context.longMapKeys;
  requireValue(context,format==='decimal'||format==='hash',location,'the original loader has no verified 64-bit map-key representation');
  if(format==='decimal')return key;
  requireValue(context,key.length===8&&[...key].every(character=>character.charCodeAt(0)<=255),location,'the original loader returned an invalid 64-bit map key');
  return protobuf.util.longFromHash(key,UNSIGNED64.has(field.keyType)).toString();
}
function mapValue(context,value,field,location,depth){
  count(context,location,depth);
  const keys=objectKeys(context,value,location);
  return container(context,value,location,()=>{
    const result=Object.create(null);
    for(const original of keys){
      const key=keyValue(context,responseMapKey(context,original,field,at(location,original)),field.keyType,at(location,original));
      let nativeKey=key;
      if(context.direction==='request'&&context.native&&(SIGNED64.has(field.keyType)||UNSIGNED64.has(field.keyType))){
        requireValue(context,context.longMapInput==='decimal'||context.longMapInput==='hash',at(location,key),'the original loader has no verified 64-bit map input representation');
        if(context.longMapInput==='hash')nativeKey=protobuf.util.longToHash(protobuf.util.Long.fromString(key,UNSIGNED64.has(field.keyType)));
      }
      if(context.direction==='request'&&context.native&&field.keyType==='bool'&&key==='false'){
        requireValue(context,context.booleanFalseInput==='false'||context.booleanFalseInput==='empty_string',at(location,key),'the original loader has no verified boolean map input representation');
        if(context.booleanFalseInput==='empty_string')nativeKey='';
      }
      requireValue(context,!own(result,nativeKey),at(location,key),'two map entries normalize to the same key');
      result[nativeKey]=scalar(context,value[original],field,at(location,key),depth+1);
    }
    return result;
  });
}
function repeatedValue(context,value,field,location,depth){
  count(context,location,depth);
  requireValue(context,Array.isArray(value),location,'expected an array');
  requireValue(context,value.length<=GRPC_VALUE_LIMITS.nodes,location,'the repeated field contains too many values');
  return container(context,value,location,()=>{
    const result=[];
    for(let index=0;index<value.length;index++){
      requireValue(context,own(value,index),at(location,index),'a repeated field cannot contain an empty array slot');
      result.push(scalar(context,value[index],field,at(location,index),depth+1));
    }
    return result;
  });
}
function messageValue(context,value,type,location,depth){
  count(context,location,depth);
  const keys=objectKeys(context,value,location);
  return container(context,value,location,()=>{
    const result=Object.create(null),oneofs=new Map();
    for(const key of keys){
      const here=at(location,key);
      requireValue(context,own(type.fields,key),here,'unknown field; use the exact captured descriptor field name');
      const field=type.fields[key];
      requireValue(context,value[key]!==undefined&&value[key]!==null,here,'omit an absent field; null and undefined are not native protobuf field values');
      if(field.partOf){
        const previous=oneofs.get(field.partOf.name);
        requireValue(context,previous===undefined,here,'choose only one field in '+field.partOf.name+(previous?' (already supplied '+previous+')':''));
        oneofs.set(field.partOf.name,key);
      }
      result[key]=field.map?mapValue(context,value[key],field,here,depth+1):field.repeated?repeatedValue(context,value[key],field,here,depth+1):scalar(context,value[key],field,here,depth+1);
    }
    for(const field of type.fieldsArray)if(field.required)requireValue(context,own(result,field.name),at(location,field.name),'this proto2 field is required');
    return result;
  });
}
function selectedMethod(contract,methodPath){
  const method=contract?.methods?.[methodPath];
  if(!method||!(method.requestMessage instanceof protobuf.Type)||!(method.responseMessage instanceof protobuf.Type)){
    const error=new Error('Choose an original method from the captured gRPC service inventory.');error.code='grpc_method_unknown';throw error;
  }
  return method;
}
export function normalizeGrpcRequest(contract,methodPath,json){
  const method=selectedMethod(contract,methodPath),context=contextFor('request');
  context.longMapInput=contract.runtime?.long_map_input;
  context.booleanFalseInput=contract.runtime?.boolean_map_false_input;
  return messageValue(context,json,method.requestMessage,'request',0);
}
export function serializeGrpcRequest(contract,methodPath,json){
  const method=selectedMethod(contract,methodPath),context=contextFor('request');
  context.native=true;
  context.longMapInput=contract.runtime?.long_map_input;
  context.booleanFalseInput=contract.runtime?.boolean_map_false_input;
  const native=messageValue(context,json,method.requestMessage,'request',0);
  return method.definition.requestSerialize(native);
}
export function normalizeGrpcResponse(contract,methodPath,decoded){
  const method=selectedMethod(contract,methodPath),context=contextFor('response');
  context.longMapKeys=contract.runtime?.long_map_keys;
  return messageValue(context,decoded,method.responseMessage,'response',0);
}

function positiveDecimalPattern(maximum){
  const digits=String(maximum),parts=[];
  if(digits.length>1)parts.push(digits.length===2?'[1-9]':'[1-9][0-9]{0,'+(digits.length-2)+'}');
  let prefix='';
  for(let index=0;index<digits.length;index++){
    const high=Number(digits[index])-1,low=index===0?1:0,remaining=digits.length-index-1;
    if(high>=low){
      const digit=high===low?String(low):'['+low+'-'+high+']';
      parts.push(prefix+digit+(remaining===0?'':remaining===1?'[0-9]':'[0-9]{'+remaining+'}'));
    }
    prefix+=digits[index];
  }
  parts.push(digits);
  return '(?:'+parts.join('|')+')';
}
function integerKeyPattern(type){
  if(type==='bool')return '^(?:true|false)$';
  if(type==='string')return null;
  const unsigned=UNSIGNED32.has(type)||UNSIGNED64.has(type),wide=SIGNED64.has(type)||UNSIGNED64.has(type);
  const maximum=wide?(unsigned?MAXU64:MAX64):BigInt(unsigned?4294967295:2147483647);
  const negative=wide?1n<<63n:2147483648n;
  return '^(?:0|'+positiveDecimalPattern(maximum)+(unsigned?'':'|-'+positiveDecimalPattern(negative))+')$';
}
function pointer(value){return value.replace(/~/g,'~0').replace(/\//g,'~1');}
function messageSchema(type){
  const definitions=Object.create(null);
  const reference=key=>({$ref:'#/$defs/'+pointer(key)});
  function scalarSchema(field){
    if(field.resolvedType instanceof protobuf.Type)return ensureMessage(field.resolvedType);
    if(field.resolvedType instanceof protobuf.Enum)return ensureEnum(field.resolvedType);
    const kind=field.type;
    if(SIGNED64.has(kind)||UNSIGNED64.has(kind)){
      const key='scalar.'+kind;
      if(!own(definitions,key))definitions[key]={type:'string',pattern:integerKeyPattern(kind),'x-protobuf-type':kind,description:'Canonical decimal text in the exact '+kind+' range. JSON numbers are not accepted.'};
      return reference(key);
    }
    if(SIGNED32.has(kind)||UNSIGNED32.has(kind))return {type:'integer',minimum:UNSIGNED32.has(kind)?0:-2147483648,maximum:UNSIGNED32.has(kind)?4294967295:2147483647,'x-protobuf-type':kind};
    if(FLOATS.has(kind))return {oneOf:[{type:'number',...(kind==='float'?{minimum:-FLOAT32_MAX,maximum:FLOAT32_MAX}:{})},{type:'string',enum:[...FLOAT_TOKENS]}],'x-protobuf-type':kind,description:'Finite values use JSON numbers. NaN, infinities, and negative zero use explicit string tokens.'};
    if(kind==='bytes')return {type:'string',contentEncoding:'base64',pattern:BASE64_PATTERN,'x-protobuf-type':kind,description:'Canonical standard base64; include required padding.'};
    if(kind==='bool')return {type:'boolean','x-protobuf-type':kind};
    if(kind==='string')return {type:'string','x-protobuf-type':kind};
    throw new Error('Unsupported protobuf schema field '+field.fullName);
  }
  function ensureEnum(enumeration){
    const key='enum.'+fullName(enumeration);
    if(!own(definitions,key))definitions[key]={title:fullName(enumeration),oneOf:[{type:'string',enum:Object.keys(enumeration.values)},{type:'integer',minimum:-2147483648,maximum:2147483647}],'x-protobuf-enum':Object.fromEntries(Object.entries(enumeration.values)),description:'Declared enum names or signed 32-bit integer values. Unknown numeric values retain their wire value.'};
    return reference(key);
  }
  function ensureMessage(message){
    const key='message.'+fullName(message);
    if(own(definitions,key))return reference(key);
    const schema={type:'object',title:fullName(message),properties:Object.create(null),additionalProperties:false};
    definitions[key]=schema;
    const required=[];
    for(const field of message.fieldsArray){
      let value=scalarSchema(field);
      if(field.map){
        const pattern=integerKeyPattern(field.keyType);
        value={type:'object',additionalProperties:value,...(pattern?{propertyNames:{pattern}}:{}),'x-protobuf-map-key-type':field.keyType};
      }else if(field.repeated)value={type:'array',items:value};
      schema.properties[field.name]={...value,'x-protobuf-field-number':field.id,...(field.partOf?{'x-protobuf-oneof':field.partOf.name}:{}),...(field.comment?{description:field.comment}:{})};
      if(field.required)required.push(field.name);
    }
    if(required.length)schema.required=required;
    const groups=(message.oneofsArray||[]).filter(group=>group.oneof.length>1);
    if(groups.length){
      schema.allOf=groups.map(group=>({oneOf:[...group.oneof.map(name=>({required:[name]})),{not:{anyOf:group.oneof.map(name=>({required:[name]}))}}]}));
      schema['x-protobuf-oneofs']=Object.fromEntries(groups.map(group=>[group.name,[...group.oneof]]));
    }
    return reference(key);
  }
  const root=ensureMessage(type);
  return {$schema:'https://json-schema.org/draft/2020-12/schema',title:fullName(type),...root,$defs:definitions,'x-protobuf-representation':GRPC_VALUE_REPRESENTATION,description:'Native captured descriptor field names. Absent fields stay absent. Well-known types use their native message fields; Any is not automatically unpacked.'};
}
export function grpcMethodSchema(contract,methodPath){
  const method=selectedMethod(contract,methodPath);
  let cache=schemaCache.get(contract);
  if(!cache){cache=new Map();schemaCache.set(contract,cache);}
  if(!cache.has(methodPath))cache.set(methodPath,{
    request:messageSchema(method.requestMessage),response:messageSchema(method.responseMessage),
    method:{path:method.path,service:method.service,name:method.name,request_type:method.requestType,response_type:method.responseType,request_stream:method.requestStream,response_stream:method.responseStream,unary:method.unary},
    representation:{schema:GRPC_VALUE_REPRESENTATION,field_names:'captured descriptor names',longs:'decimal strings',bytes:'canonical standard base64',enum_values:'declared names or signed 32-bit integers',special_floats:[...FLOAT_TOKENS],well_known_types:'native message fields',null:'omit absent fields; null is not accepted',defaults:'absent fields are not filled'}
  });
  return structuredClone(cache.get(methodPath));
}
