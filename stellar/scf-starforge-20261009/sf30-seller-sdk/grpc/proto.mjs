import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import protobuf from 'protobufjs';
import protoLoader from '@grpc/proto-loader';

export const PROTO_SOURCE_SCHEMA = 'sf30-grpc-proto-source-v1';
export const PROTO_LIMITS = Object.freeze({files:512, fileBytes:4*1024*1024, sourceBytes:32*1024*1024, types:8192, fields:65536});
export const GRPC_OBJECT_OPTIONS = Object.freeze({keepCase:true, longs:String, enums:String, bytes:String, defaults:false, arrays:false, objects:false, oneofs:false, json:false});
const SCALARS = new Set(['double','float','int32','uint32','sint32','fixed32','sfixed32','int64','uint64','sint64','fixed64','sfixed64','bool','string','bytes']);
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function requireValue(ok,message,code='grpc_proto_source') { if(!ok){const error=new Error(message);error.code=code;throw error;} }
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function stable(value,depth=0){
  requireValue(depth<=96,'The captured descriptor is nested too deeply.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){requireValue(Number.isFinite(value),'Descriptor numbers must be finite.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(item=>stable(item,depth+1)).join(',')+']';
  requireValue(plain(value),'Descriptors must contain JSON values.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key],depth+1)).join(',')+'}';
}
function protoPath(value){
  requireValue(typeof value==='string'&&value.length>0&&value.length<=1024&&!value.includes('\\')&&!/[\0\r\n]/.test(value)&&!path.posix.isAbsolute(value)&&value.endsWith('.proto'),'Use a relative .proto path within the selected source directory.');
  requireValue(value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'),'A .proto import must stay within its selected directory.');
  return value;
}
function entries(value){
  requireValue(Array.isArray(value)&&value.length>0&&value.length<=PROTO_LIMITS.files,'Choose at least one service .proto entrypoint.');
  const result=value.map(protoPath);
  requireValue(new Set(result).size===result.length,'Choose each .proto entrypoint once.');
  return result.sort();
}
function candidates(name,from){
  const target=protoPath(name),relative=from?path.posix.join(path.posix.dirname(from),target):target;
  return [...new Set([target,protoPath(relative)])];
}
function parseText(content,filename,root=new protobuf.Root()){
  const previous=protobuf.parse.filename;
  try{protobuf.parse.filename=filename;return protobuf.parse(content,root,{keepCase:true,alternateCommentMode:true});}
  catch(error){const problem=new Error('Cannot parse '+filename+': '+error.message);problem.code='grpc_proto_parse';throw problem;}
  finally{protobuf.parse.filename=previous;}
}
function fullName(value){return value.fullName.replace(/^\./,'');}
function reflected(root){
  const result=[];
  function visit(value){if(value instanceof protobuf.Type||value instanceof protobuf.Enum||value instanceof protobuf.Service)result.push(value);for(const child of value.nestedArray||[])visit(child);}
  visit(root);return result;
}
function builtinIndex(){
  const files=new Map(),types=new Map();
  for(const name of Object.keys(protobuf.common).sort()){
    if(!name.endsWith('.proto')||!plain(protobuf.common[name]))continue;
    const definition=JSON.parse(stable(protobuf.common[name]));
    const root=new protobuf.Root().addJSON(definition.nested||{}),items=reflected(root);
    files.set(name,{definition,items});
    for(const item of items)types.set(fullName(item),name);
  }
  return {files,types};
}
function resolveBuiltinReference(type,reference,index){
  if(SCALARS.has(reference))return null;
  if(reference.startsWith('.'))return index.types.get(reference.slice(1))||null;
  let scope=fullName(type);
  for(;;){const found=index.types.get(scope?scope+'.'+reference:reference);if(found)return found;const at=scope.lastIndexOf('.');if(at<0){if(scope==='')break;scope='';}else scope=scope.slice(0,at);}
  return null;
}
function sourceIdentity(source){
  return digest(stable({schema:source.schema,entrypoints:source.entrypoints,
    files:source.files.map(file=>({path:file.path,bytes:file.bytes,sha256:file.sha256})),
    builtins:source.builtins.map(file=>({path:file.path,bytes:file.bytes,sha256:file.sha256}))}));
}
function stamp(stat){return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');}


let nativeRuntime;
function originalLoaderRuntime(){
  if(nativeRuntime)return nativeRuntime;
  requireValue(protobuf.util.Long&&typeof protobuf.util.longToHash==='function'&&typeof protobuf.util.longFromHash==='function','The pinned protobuf runtime must retain exact 64-bit integers.','grpc_runtime_integer_support');
  const model={nested:{sf30_runtime_probe:{nested:{
    Values:{fields:{signed:{id:1,keyType:'int64',type:'string'},unsigned:{id:2,keyType:'uint64',type:'string'},flags:{id:3,keyType:'bool',type:'string'},string_keys:{id:4,keyType:'string',type:'string'}}},
    Service:{methods:{RoundTrip:{requestType:'Values',responseType:'Values'}}}
  }}}};
  const wire=protoLoader.fromJSON(model,GRPC_OBJECT_OPTIONS)['sf30_runtime_probe.Service'].RoundTrip;
  const signed={'0':'zero','12345678':'eight_decimal','9007199254740993':'large','3472328296227680304':'digit_hash','-9223372036854775808':'minimum','9223372036854775807':'maximum'};
  const unsigned={'0':'zero','12345678':'eight_decimal','9007199254740993':'large','3472328296227680304':'digit_hash','18446744073709551615':'maximum'};
  const stringKeys=Object.fromEntries([['__proto__','prototype_name'],['constructor','constructor_name'],['','empty_name'],['ordinary','ordinary_name']]);
  const hashMap=(values,isUnsigned)=>Object.fromEntries(Object.entries(values).map(([key,value])=>[protobuf.util.longToHash(protobuf.util.Long.fromString(key,isUnsigned)),value]));
  const run=(useHashes,emptyFalse=false)=>wire.responseDeserialize(wire.responseSerialize({signed:useHashes?hashMap(signed,false):signed,unsigned:useHashes?hashMap(unsigned,true):unsigned,flags:emptyFalse?{'':'false_value',true:'true_value'}:{false:'false_value',true:'true_value'},string_keys:stringKeys}));
  let first;
  try{first=run(false);}catch(error){const problem=new Error('The original gRPC loader cannot round-trip its own map representation: '+error.message);problem.code='grpc_runtime_map_keys';throw problem;}
  requireValue(plain(first.string_keys)&&Object.keys(first.string_keys).length===Object.keys(stringKeys).length&&Object.entries(stringKeys).every(([key,value])=>own(first.string_keys,key)&&first.string_keys[key]===value),'The pinned loader must preserve every string map key, including empty, constructor, and __proto__ keys. Install the retained protobuf runtime closure.','grpc_runtime_map_keys');
  let emptyFalse=false;
  if(first.flags?.false!=='false_value'||first.flags?.true!=='true_value'){
    first=run(false,true);emptyFalse=true;
    requireValue(first.flags?.false==='false_value'&&first.flags?.true==='true_value','The pinned loader has no faithful boolean map input representation.','grpc_runtime_map_keys');
  }
  function outputFormat(actual){
    const key=Object.keys(actual.signed||{}).find(key=>actual.signed[key]==='large');
    if(key==='9007199254740993')return 'decimal';
    if(key===protobuf.util.longToHash(protobuf.util.Long.fromString('9007199254740993',false)))return 'hash';
    return null;
  }
  function matches(actual,format){
    if(!format)return false;
    for(const [name,expected,isUnsigned]of [['signed',signed,false],['unsigned',unsigned,true]]){
      const observed=actual[name];if(!plain(observed)||Object.keys(observed).length!==Object.keys(expected).length)return false;
      for(const [key,value]of Object.entries(observed)){
        let decimal;
        try{decimal=format==='hash'?protobuf.util.longFromHash(key,isUnsigned).toString():key;}catch{return false;}
        if(!own(expected,decimal)||expected[decimal]!==value)return false;
      }
    }
    return true;
  }
  let format=outputFormat(first),input='decimal';
  if(!matches(first,format)){
    const second=run(true,emptyFalse);format=outputFormat(second);input='hash';
    requireValue(matches(second,format),'The pinned loader cannot preserve signed and unsigned 64-bit map keys, including eight-digit decimal keys.','grpc_runtime_map_keys');
  }
  nativeRuntime=Object.freeze({long_map_input:input,long_map_keys:format,boolean_map_false_input:emptyFalse?'empty_string':'false',boolean_map_keys:'true_or_false',string_map_keys:'all_original_keys',probe:'original_loader_encode_decode'});
  return nativeRuntime;
}

export async function captureProtoSource({directory,entrypoints}={}){
  requireValue(typeof directory==='string'&&directory.length>0,'Select the existing .proto source directory.');
  const entry=entries(entrypoints),base=await fs.realpath(directory),baseBefore=await fs.lstat(base,{bigint:true});
  requireValue(baseBefore.isDirectory()&&!baseBefore.isSymbolicLink(),'The .proto source must remain its selected directory.');
  const files=new Map(),builtins=new Map(),observed=new Map(),directories=new Map(),nativeBuiltins=builtinIndex();
  let total=0;
  function account(bytes){total+=bytes;requireValue(total<=PROTO_LIMITS.sourceBytes,'The complete .proto source exceeds 32 MiB.');requireValue(files.size+builtins.size<=PROTO_LIMITS.files,'The complete .proto source exceeds 512 files.');}
  async function readFile(relative){
    const components=relative.split('/');let cursor=base,checkedFile;
    for(let i=0;i<components.length;i++){
      cursor=path.join(cursor,components[i]);let stat;
      try{stat=await fs.lstat(cursor,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
      requireValue(!stat.isSymbolicLink(),'Copy the imported source file into the selected directory instead of using a symbolic link: '+relative);
      requireValue(i===components.length-1?stat.isFile():stat.isDirectory(),'The imported source path is not a regular file: '+relative);
      if(i===components.length-1)checkedFile=stat;
      else{
        const identity=String(stat.dev)+':'+String(stat.ino),name=components.slice(0,i+1).join('/');
        requireValue(!directories.has(name)||directories.get(name)===identity,'An imported source directory changed during capture: '+name,'grpc_proto_source_changed');
        directories.set(name,identity);
      }
    }
    const handle=await fs.open(cursor,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW||0));
    try{
      const before=await handle.stat({bigint:true});
      requireValue(stamp(before)===stamp(checkedFile),'The opened .proto file differs from its checked source path: '+relative,'grpc_proto_source_changed');
      requireValue(before.isFile()&&before.size<=BigInt(PROTO_LIMITS.fileBytes),'The .proto file exceeds 4 MiB: '+relative);
      const chunks=[];let bytes=0;
      for(;;){const chunk=Buffer.allocUnsafe(Math.min(65536,PROTO_LIMITS.fileBytes+1-bytes));const read=await handle.read(chunk,0,chunk.length,null);if(!read.bytesRead)break;bytes+=read.bytesRead;requireValue(bytes<=PROTO_LIMITS.fileBytes,'The .proto file grew beyond 4 MiB: '+relative);chunks.push(chunk.subarray(0,read.bytesRead));}
      const after=await handle.stat({bigint:true});
      requireValue(stamp(before)===stamp(after),'The .proto file changed while being captured: '+relative,'grpc_proto_source_changed');
      const raw=Buffer.concat(chunks,bytes);let content;
      try{content=utf8.decode(raw);}catch{requireValue(false,'The .proto file is not valid UTF-8: '+relative);}
      requireValue(Buffer.from(content,'utf8').equals(raw),'The source text did not preserve its original UTF-8 bytes: '+relative);
      observed.set(relative,stamp(after));return {path:relative,content,bytes,sha256:digest(raw)};
    }finally{await handle.close();}
  }
  async function visit(name,from='',weak=false){
    for(const candidate of candidates(name,from)){
      if(files.has(candidate)||builtins.has(candidate))return candidate;
      const file=await readFile(candidate);
      if(!file)continue;
      files.set(candidate,file);account(file.bytes);
      const parsed=parseText(file.content,candidate);
      for(const imported of parsed.imports||[])await visit(imported,candidate,false);
      for(const imported of parsed.weakImports||[])await visit(imported,candidate,true);
      return candidate;
    }
    const builtin=nativeBuiltins.files.get(name);
    if(builtin){
      const definition=JSON.parse(stable(builtin.definition)),raw=Buffer.from(stable(definition),'utf8');
      builtins.set(name,{path:name,definition,bytes:raw.length,sha256:digest(raw)});account(raw.length);
      const dependencies=new Set();
      for(const type of builtin.items){
        for(const field of type.fieldsArray||[]){const dependency=resolveBuiltinReference(type,field.type,nativeBuiltins);if(dependency&&dependency!==name)dependencies.add(dependency);}
        for(const method of type.methodsArray||[]){for(const reference of [method.requestType,method.responseType]){const dependency=resolveBuiltinReference(type,reference,nativeBuiltins);if(dependency&&dependency!==name)dependencies.add(dependency);}}
      }
      for(const dependency of [...dependencies].sort())await visit(dependency,'',false);
      return name;
    }
    if(weak)return null;
    requireValue(false,'Missing imported .proto '+name+(from?' from '+from:'')+'. Include it in the selected source directory.','grpc_proto_import_missing');
  }
  for(const name of entry)await visit(name);
  for(const [name,identity]of directories){
    const current=await fs.lstat(path.join(base,name),{bigint:true});
    requireValue(current.isDirectory()&&!current.isSymbolicLink()&&String(current.dev)+':'+String(current.ino)===identity,'An imported source directory changed before capture completed: '+name,'grpc_proto_source_changed');
  }
  for(const [name,original]of observed){
    const current=await fs.lstat(path.join(base,name),{bigint:true});
    requireValue(current.isFile()&&!current.isSymbolicLink()&&stamp(current)===original,'The .proto import closure changed before capture completed: '+name,'grpc_proto_source_changed');
  }
  const baseAfter=await fs.lstat(base,{bigint:true});
  requireValue(baseAfter.isDirectory()&&!baseAfter.isSymbolicLink()&&baseAfter.dev===baseBefore.dev&&baseAfter.ino===baseBefore.ino,'The selected .proto directory changed during capture.','grpc_proto_source_changed');
  const source={schema:PROTO_SOURCE_SCHEMA,entrypoints:entry,files:[...files.values()].sort((a,b)=>a.path>b.path?1:a.path<b.path?-1:0),builtins:[...builtins.values()].sort((a,b)=>a.path>b.path?1:a.path<b.path?-1:0)};
  source.sha256=sourceIdentity(source);
  compileProtoSource(source);
  return source;
}

export function compileProtoSource(input){
  requireValue(plain(input)&&input.schema===PROTO_SOURCE_SCHEMA,'Use a complete retained gRPC .proto source.');
  const entrypoints=entries(input.entrypoints);
  requireValue(Array.isArray(input.files)&&Array.isArray(input.builtins||[])&&input.files.length+(input.builtins||[]).length<=PROTO_LIMITS.files,'The retained source file inventory is invalid.');
  const files=[],builtins=[],names=new Set();let total=0;
  for(const [kind,items]of [['file',input.files],['builtin',input.builtins||[]]]){
    for(const item of items){
      requireValue(plain(item),'A captured source entry must be an object.');
      const name=protoPath(item.path);requireValue(!names.has(name),'The retained source repeats '+name);names.add(name);
      let value,raw;
      if(kind==='file'){requireValue(typeof item.content==='string','A .proto source entry is missing its text.');raw=Buffer.from(item.content,'utf8');requireValue(utf8.decode(raw)===item.content,'The retained source text contains invalid Unicode.');requireValue(raw.length<=PROTO_LIMITS.fileBytes,'A retained .proto file exceeds 4 MiB.');value={path:name,content:item.content};}
      else{requireValue(name.startsWith('google/protobuf/')&&plain(item.definition),'Use a captured standard protobuf descriptor.');raw=Buffer.from(stable(item.definition),'utf8');value={path:name,definition:JSON.parse(raw.toString('utf8'))};}
      total+=raw.length;requireValue(total<=PROTO_LIMITS.sourceBytes,'The complete retained source exceeds 32 MiB.');
      requireValue(item.bytes===raw.length&&item.sha256===digest(raw),'The retained source bytes changed: '+name,'grpc_proto_source_changed');
      (kind==='file'?files:builtins).push({...value,bytes:raw.length,sha256:item.sha256});
    }
  }
  files.sort((a,b)=>a.path>b.path?1:a.path<b.path?-1:0);builtins.sort((a,b)=>a.path>b.path?1:a.path<b.path?-1:0);
  const source={schema:PROTO_SOURCE_SCHEMA,entrypoints,files,builtins};
  source.sha256=sourceIdentity(source);
  requireValue(input.sha256===source.sha256,'The complete .proto source identity changed.','grpc_proto_source_changed');
  for(const name of entrypoints)requireValue(files.some(file=>file.path===name),'A service entrypoint is absent from the captured .proto files: '+name);
  const root=new protobuf.Root(),parsedFiles=new Map(),missingWeak=[];
  for(const item of builtins)root.addJSON(item.definition.nested||{});
  for(const item of files)parsedFiles.set(item.path,parseText(item.content,item.path,root));
  for(const [name,parsed]of parsedFiles){
    for(const [weak,imports]of [[false,parsed.imports||[]],[true,parsed.weakImports||[]]]){
      for(const imported of imports){const found=candidates(imported,name).find(candidate=>names.has(candidate));if(!found){if(weak)missingWeak.push({from:name,path:imported});else requireValue(false,'The retained import '+imported+' from '+name+' is absent.','grpc_proto_import_missing');}}
    }
  }
  try{root.resolveAll();}catch(error){const problem=new Error('The captured protobuf types do not resolve: '+error.message);problem.code='grpc_proto_types';throw problem;}
  const objects=reflected(root);requireValue(objects.length<=PROTO_LIMITS.types,'The protobuf contract has too many types.');
  requireValue(objects.reduce((n,type)=>n+(type.fieldsArray||[]).length,0)<=PROTO_LIMITS.fields,'The protobuf contract has too many fields.');
  const definition=protoLoader.fromJSON(root.toJSON(),GRPC_OBJECT_OPTIONS);
  const methods=Object.create(null),services=[],messages=[],enums=[];
  for(const object of objects){
    const name=fullName(object);
    if(object instanceof protobuf.Service){
      const service={name,methods:[]};
      for(const method of object.methodsArray){
        method.resolve();const methodPath='/'+name+'/'+method.name,wire=definition[name]?.[method.name];
        requireValue(wire&&typeof wire.requestSerialize==='function'&&typeof wire.responseDeserialize==='function','The original gRPC loader did not compile '+methodPath);
        const record={path:methodPath,service:name,name:method.name,requestType:fullName(method.resolvedRequestType),responseType:fullName(method.resolvedResponseType),requestStream:!!method.requestStream,responseStream:!!method.responseStream,unary:!method.requestStream&&!method.responseStream};
        methods[methodPath]={...record,requestMessage:method.resolvedRequestType,responseMessage:method.resolvedResponseType,definition:wire};
        service.methods.push(record);
      }
      services.push(service);
    }else if(object instanceof protobuf.Type){
      messages.push({name,fields:object.fieldsArray.map(field=>({name:field.name,id:field.id,type:field.resolvedType?fullName(field.resolvedType):field.type,scalar:SCALARS.has(field.type),repeated:!!field.repeated,map:!!field.map,keyType:field.keyType||null,required:!!field.required,oneof:field.partOf?.name||null,jsonName:field.getOption('json_name')||field.name,comment:field.comment||null})),oneofs:(object.oneofsArray||[]).map(oneof=>({name:oneof.name,fields:[...oneof.oneof],synthetic:!!oneof.isProto3Optional}))});
    }else if(object instanceof protobuf.Enum){enums.push({name,values:Object.entries(object.values).map(([name,number])=>({name,number})),allowAlias:object.getOption('allow_alias')===true});}
  }
  services.sort((a,b)=>a.name>b.name?1:a.name<b.name?-1:0);messages.sort((a,b)=>a.name>b.name?1:a.name<b.name?-1:0);enums.sort((a,b)=>a.name>b.name?1:a.name<b.name?-1:0);
  requireValue(services.some(service=>service.methods.length),'The captured source contains no gRPC service methods.','grpc_proto_no_services');
  const inventory={schema:'sf30-grpc-inventory-v1',source_sha256:source.sha256,entrypoints:[...entrypoints],files:files.map(({path,bytes,sha256})=>({path,bytes,sha256,kind:'proto'})),builtins:builtins.map(({path,bytes,sha256})=>({path,bytes,sha256,kind:'runtime_descriptor'})),missing_weak_imports:missingWeak,services,messages,enums,method_count:Object.keys(methods).length,unary_method_count:Object.values(methods).filter(method=>method.unary).length,representation:{field_names:'captured descriptor names',longs:'decimal strings',bytes:'base64',enums:'declared names or integer values',well_known_types:'native message fields',defaults:'absent fields are not filled'}};
  return {source,inventory,methods,root,definition,runtime:originalLoaderRuntime()};
}
