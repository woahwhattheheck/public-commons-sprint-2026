// MIT. Exact reflected FileDescriptorProto custody with the retained protobuf runtime.
import path from 'node:path';
import {createHash} from 'node:crypto';
import protobuf from 'protobufjs';
import descriptor from 'protobufjs/ext/descriptor/index.js';

export const DESCRIPTOR_SOURCE_SCHEMA = 'sf30-grpc-descriptor-source-v1';
export const PROTO_LIMITS = Object.freeze({files:512, fileBytes:4*1024*1024, sourceBytes:32*1024*1024, types:8192, fields:65536});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const hash=value=>createHash('sha256').update(value).digest('hex');
const scalar={1:'double',2:'float',3:'int64',4:'uint64',5:'int32',6:'fixed64',7:'fixed32',8:'bool',9:'string',12:'bytes',13:'uint32',15:'sfixed32',16:'sfixed64',17:'sint32',18:'sint64'};
const mapKeys=new Set([3,4,5,6,7,8,9,13,15,16,17,18]);
const longTypes=new Set([3,4,6,16,18]);
function need(ok,message,code='grpc_descriptor_source'){if(!ok){const error=new Error(message);error.code=code;throw error;}}
function stable(value){
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
}
function protoPath(value){
  need(typeof value==='string'&&value.length>0&&value.length<=1024&&value.endsWith('.proto')&&!value.includes('\\')&&!/[\0\r\n]/.test(value)&&!path.posix.isAbsolute(value),'Use the original relative .proto descriptor filename.');
  need(value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'A descriptor import must stay inside its captured source.');
  return value;
}
function identifier(value){need(typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value),'A protobuf descriptor has an invalid symbol name.');return value;}
function symbol(value){need(typeof value==='string'&&value.length<=2048&&/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value),'Use a fully qualified protobuf service name.');return value;}
function strings(value,check,label){
  need(Array.isArray(value)&&value.length>0&&value.length<=PROTO_LIMITS.files,'Choose a nonempty '+label+' selection.');
  const result=value.map(check);need(new Set(result).size===result.length,'Choose each '+label+' once.');return result.sort();
}
function decode(raw){
  need(raw instanceof Uint8Array&&raw.byteLength>0&&raw.byteLength<=PROTO_LIMITS.fileBytes,'A reflected descriptor must contain at most 4 MiB of original bytes.');
  let value;try{value=descriptor.FileDescriptorProto.decode(raw);}catch(error){need(false,'Cannot decode the original FileDescriptorProto: '+error.message,'grpc_descriptor_decode');}
  protoPath(value.name);
  need(!value.package||typeof value.package==='string'&&/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value.package),'A descriptor package is invalid.');
  need(!value.syntax||['proto2','proto3','editions'].includes(value.syntax),'The reflected protobuf syntax is unsupported.');
  if(value.syntax==='editions')need(value.edition===descriptor.Edition.EDITION_2023,'The retained protobuf runtime supports reflected edition 2023.','grpc_descriptor_edition');
  const dependencies=(value.dependency||[]).map(protoPath);
  need(dependencies.length<=PROTO_LIMITS.files&&new Set(dependencies).size===dependencies.length,'The descriptor repeats an import or has too many imports.');
  for(const list of [value.publicDependency||[],value.weakDependency||[]]){
    need(new Set(list).size===list.length&&list.every(n=>Number.isInteger(n)&&n>=0&&n<dependencies.length),'A descriptor import index is invalid.');
  }
  const services=(value.service||[]).map(service=>(value.package?value.package+'.':'')+identifier(service.name));
  need(new Set(services).size===services.length,'The descriptor repeats a service.');
  return {value,dependencies,services};
}
export function descriptorFile(rawBytes){
  need(rawBytes instanceof Uint8Array&&rawBytes.byteLength>0&&rawBytes.byteLength<=PROTO_LIMITS.fileBytes,'A reflected descriptor must contain at most 4 MiB of original bytes.');
  const raw=Buffer.from(rawBytes),{value,dependencies,services}=decode(raw);
  return {path:value.name,dependencies:[...dependencies],services:[...services],descriptorBase64:raw.toString('base64'),bytes:raw.length,sha256:hash(raw)};
}
function reflectionMetadata(value){
  need(plain(value)&&Object.keys(value).every(key=>['protocol','target','authority','inventorySha256'].includes(key)),'Use the original safe reflection observation.');
  need(value.protocol==='v1'||value.protocol==='v1alpha','Select reflection v1 or v1alpha.');
  const result={protocol:value.protocol,target:value.target,authority:value.authority??'',inventorySha256:value.inventorySha256};
  need(typeof result.target==='string'&&result.target.length>0&&result.target.length<=2048&&!/[\0-\x1f\x7f]/.test(result.target),'The reflection target is invalid.');
  need(typeof result.authority==='string'&&result.authority.length<=2048&&!/[\0-\x1f\x7f]/.test(result.authority),'The reflection authority is invalid.');
  need(typeof result.inventorySha256==='string'&&/^[a-f0-9]{64}$/.test(result.inventorySha256),'Retain the exact reflection inventory SHA256.');
  return result;
}
function normalized(input,requireIdentity){
  need(plain(input)&&(!requireIdentity||input.schema===DESCRIPTOR_SOURCE_SCHEMA),'Use a complete retained reflected descriptor source.');
  const entrypoints=strings(input.entrypoints,protoPath,'descriptor entrypoint'),services=strings(input.services,symbol,'service');
  need(Array.isArray(input.files)&&input.files.length>0&&input.files.length<=PROTO_LIMITS.files,'The descriptor file inventory is invalid.');
  need(input.builtins===undefined||Array.isArray(input.builtins)&&input.builtins.length===0,'Reflected imports must retain original descriptor bytes, including standard types.');
  const files=[],decoded=new Map();let total=0;
  for(const item of input.files){
    need(plain(item)&&typeof item.descriptorBase64==='string'&&item.descriptorBase64.length<=Math.ceil(PROTO_LIMITS.fileBytes/3)*4,'A descriptor entry is missing its original base64 bytes.');
    const raw=Buffer.from(item.descriptorBase64,'base64');
    need(raw.toString('base64')===item.descriptorBase64,'A descriptor must use canonical base64.');
    const detail=decode(raw),meta={path:detail.value.name,bytes:raw.length,sha256:hash(raw)};
    need(item.path===meta.path&&item.bytes===meta.bytes&&item.sha256===meta.sha256,'The original descriptor bytes or filename changed.','grpc_proto_source_changed');
    need(!decoded.has(meta.path),'The descriptor source repeats '+meta.path);
    total+=raw.length;need(total<=PROTO_LIMITS.sourceBytes,'The complete descriptor source exceeds 32 MiB.');
    decoded.set(meta.path,detail);files.push({path:meta.path,descriptorBase64:item.descriptorBase64,bytes:meta.bytes,sha256:meta.sha256});
  }
  const reachable=new Set(),visiting=new Set();
  function visit(name){
    need(decoded.has(name),'The reflected import closure is missing '+name+'.','grpc_proto_import_missing');
    if(reachable.has(name))return;
    need(!visiting.has(name),'The reflected import graph contains a cycle.','grpc_descriptor_import_cycle');
    visiting.add(name);
    for(const dependency of decoded.get(name).dependencies)visit(dependency);
    visiting.delete(name);reachable.add(name);
  }
  for(const name of entrypoints)visit(name);
  need(reachable.size===files.length,'Retain only the selected services and their transitive descriptor imports.');
  const owners=new Map();
  for(const [name,item]of decoded)for(const service of item.services){
    need(!owners.has(service),'The descriptor closure repeats service '+service);owners.set(service,name);
  }
  for(const service of services)need(owners.has(service)&&entrypoints.includes(owners.get(service)),'A selected service is missing from its original entrypoint: '+service);
  for(const name of entrypoints)need(services.some(service=>owners.get(service)===name),'Each descriptor entrypoint must declare a selected service.');
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const source={schema:DESCRIPTOR_SOURCE_SCHEMA,entrypoints,services,files,builtins:[],reflection:reflectionMetadata(input.reflection)};
  source.sha256=hash(stable({...source,files:files.map(({path,bytes,sha256})=>({path,bytes,sha256}))}));
  if(requireIdentity)need(input.sha256===source.sha256,'The complete reflected source identity changed.','grpc_proto_source_changed');
  return {source,decoded};
}
function namedJson(root,name){
  let item=root;
  for(const part of name.split('.')){need(item.nested&&own(item.nested,part),'The native descriptor loader lost '+name);item=item.nested[part];}
  return item;
}
function cBytes(text){
  const bytes=[];
  for(let i=0;i<text.length;){
    if(text[i]!=='\\'){const code=text.codePointAt(i),char=String.fromCodePoint(code);bytes.push(...Buffer.from(char));i+=char.length;continue;}
    i++;need(i<text.length,'A bytes default ends in an incomplete escape.');
    const key=text[i++],simple={a:7,b:8,f:12,n:10,r:13,t:9,v:11,'\\':92,"'":39,'"':34,'?':63};
    if(own(simple,key)){bytes.push(simple[key]);continue;}
    if(/[0-7]/.test(key)){let digits=key;while(digits.length<3&&i<text.length&&/[0-7]/.test(text[i]))digits+=text[i++];const number=parseInt(digits,8);need(number<=255,'A bytes default has an out-of-range escape.');bytes.push(number);continue;}
    if(key==='x'||key==='X'){let digits='';while(digits.length<2&&i<text.length&&/[0-9a-f]/i.test(text[i]))digits+=text[i++];need(digits.length>0,'A bytes default has an incomplete hexadecimal escape.');bytes.push(parseInt(digits,16));continue;}
    need(false,'A bytes default has an unsupported escape.');
  }
  return Buffer.from(bytes).toString('base64');
}
function nativeDefault(field){
  const text=field.defaultValue;
  if(field.type===9||field.type===14)return text;
  if(field.type===12)return cBytes(text);
  if(field.type===8){need(text==='true'||text==='false','A boolean default is invalid.');return text==='true';}
  if(field.type===1||field.type===2){
    if(text==='inf')return Infinity;if(text==='-inf')return -Infinity;if(text==='nan')return NaN;
    const number=Number(text);need(text.length>0&&Number.isFinite(number),'A floating-point default is invalid.');return number;
  }
  if(scalar[field.type]){
    let value;try{value=BigInt(text);}catch{need(false,'An integer default is invalid.');}
    // Native RPC conversion uses defaults:false. Keep the source text exact in
    // inventory; avoid presenting a rounded 64-bit native default as source data.
    if(longTypes.has(field.type)&&!Number.isSafeInteger(Number(value)))return undefined;
    const number=Number(value);need(Number.isSafeInteger(number),'A numeric default is outside the supported exact range.');return number;
  }
  need(false,'A message or group cannot declare a scalar default.');
}
function nativeRoot(decoded){
  const set={file:[...decoded.values()].map(item=>item.value)},fieldMetadata=new Map(),fileMetadata=[];
  let types=0,fields=0;
  function validateField(field,oneofs,syntax){
    identifier(field.name);
    need(Number.isInteger(field.number)&&field.number>0&&field.number<=536870911&&!(field.number>=19000&&field.number<=19999),'A protobuf field number is invalid.');
    need([1,2,3].includes(field.label)&&Number.isInteger(field.type)&&field.type>=1&&field.type<=18,'A descriptor field type or label is invalid.');
    if([10,11,14].includes(field.type))need(typeof field.typeName==='string'&&field.typeName.startsWith('.')&&symbol(field.typeName.slice(1)),'A descriptor field type reference is invalid.');
    else need(!field.typeName,'A scalar field must use its declared scalar type.');
    if(own(field,'oneofIndex'))need(Number.isInteger(field.oneofIndex)&&field.oneofIndex>=0&&field.oneofIndex<oneofs&&field.label===1,'A field has an invalid oneof membership.');
    if(field.proto3Optional)need(syntax==='proto3'&&own(field,'oneofIndex')&&field.label===1,'A proto3 optional field requires its original synthetic oneof.');
    if(syntax==='proto3')need(field.label!==2&&!own(field,'defaultValue'),'Proto3 fields cannot declare required presence or scalar defaults.');
    fields++;need(fields<=PROTO_LIMITS.fields,'The reflected contract has too many fields.');
  }
  function validateMessage(message,syntax,depth){
    need(depth<=64,'The reflected message hierarchy is too deep.');identifier(message.name);types++;
    need(types<=PROTO_LIMITS.types,'The reflected contract has too many types.');
    for(const oneof of message.oneofDecl||[])identifier(oneof.name);
    for(const field of message.field||[])validateField(field,(message.oneofDecl||[]).length,syntax);
    for(const field of message.extension||[])validateField(field,0,syntax);
    for(const nested of message.nestedType||[])validateMessage(nested,syntax,depth+1);
    for(const value of message.enumType||[]){identifier(value.name);types++;}
    for(const field of message.field||[])if(field.proto3Optional)need((message.field||[]).filter(other=>own(other,'oneofIndex')&&other.oneofIndex===field.oneofIndex).length===1,'A synthetic optional oneof must have one field.');
  }
  for(const item of set.file){
    const syntax=item.syntax||'proto2';
    for(const message of item.messageType||[])validateMessage(message,syntax,0);
    for(const field of item.extension||[])validateField(field,0,syntax);
    for(const value of item.enumType||[]){identifier(value.name);types++;}
    for(const service of item.service||[]){identifier(service.name);types++;for(const method of service.method||[]){identifier(method.name);need(method.inputType?.startsWith('.')&&method.outputType?.startsWith('.'),'A method requires fully qualified input and output types.');}}
  }
  need(types<=PROTO_LIMITS.types,'The reflected contract has too many types.');
  // The installed extension supplies the native reflection tree. Correct only
  // metadata that this pinned extension drops before rebuilding through its
  // original Root.fromJSON and the existing proto-loader path.
  let original;
  try{original=protobuf.Root.fromDescriptor(set);}catch(error){need(false,'The original descriptor types do not resolve: '+error.message,'grpc_proto_types');}
  const json=original.toJSON({keepComments:true}),mapEntries=new Map(),mapUses=new Map();
  function comments(item,locations,parts){const location=locations.get(parts.join('.'));if(location)item.comment=location.leadingComments||location.trailingComments||item.comment;}
  function options(item){return item.options||(item.options={});}
  function fileFeatures(file){
    if(!file.options?.features)return {};
    const converted=descriptor.FeatureSet.toObject(file.options.features,{enums:String}),result={};
    for(const [key,value]of Object.entries(converted)){
      need(typeof value==='string'&&!value.endsWith('_UNKNOWN'),'The reflected file uses an unsupported edition feature.','grpc_descriptor_edition');
      result[key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase())]=value;
    }
    return result;
  }
  function applyFileFeatures(item,features){
    if(Object.keys(features).length)options(item).features={...features,...(item.options?.features||{})};
  }
  function patchField(field,item,messageName,syntax){
    const opts=options(item);
    if(own(field,'jsonName'))opts.json_name=field.jsonName;
    if(field.proto3Optional)opts.proto3_optional=true;
    if(field.type===10)opts.features={...(opts.features||{}),message_encoding:'DELIMITED'};
    if(field.label===3&&[1,2,3,4,5,6,7,8,13,14,15,16,17,18].includes(field.type)){
      if(field.options&&own(field.options,'packed'))opts.packed=field.options.packed;
      else delete opts.packed;
    }
    if(own(field,'defaultValue')){
      const value=nativeDefault(field);
      if(value===undefined)delete opts.default;else opts.default=value;
    }
    fieldMetadata.set(messageName+'.'+field.name,{descriptorType:field.type,proto3Optional:!!field.proto3Optional,...(own(field,'defaultValue')?{declaredDefault:field.defaultValue}:{})});
  }
  function visitMessage(message,parentName,syntax,locations,parts){
    const name=parentName?parentName+'.'+message.name:message.name,item=namedJson(json,name);
    comments(item,locations,parts);
    if(message.options?.mapEntry)mapEntries.set('.'+name,{message,name,item,parentName});
    // The pinned descriptor extension accidentally marks parents of map-entry
    // types as map_entry as well; keep only the original message's own option.
    if(item.options&&message.options?.mapEntry!==true)delete item.options.map_entry;
    if(message.extensionRange?.length)item.extensions=message.extensionRange.map(range=>[range.start,range.end-1]);
    if(message.reservedRange?.length||message.reservedName?.length)item.reserved=[...(message.reservedRange||[]).map(range=>[range.start,range.end-1]),...(message.reservedName||[])];
    for(const [i,field]of (message.field||[]).entries()){
      need(item.fields&&own(item.fields,field.name),'The native descriptor loader lost field '+name+'.'+field.name);
      patchField(field,item.fields[field.name],name,syntax);comments(item.fields[field.name],locations,[...parts,2,i]);
    }
    for(const field of message.extension||[])if(item.nested&&own(item.nested,field.name))patchField(field,item.nested[field.name],name,syntax);
    for(const [i,nested]of (message.nestedType||[]).entries())visitMessage(nested,name,syntax,locations,[...parts,3,i]);
  }
  for(const file of set.file){
    const scope=file.package||'',syntax=file.syntax||'proto2',locations=new Map((file.sourceCodeInfo?.location||[]).map(location=>[(location.path||[]).join('.'),location]));
    // Native top-level types reset edition defaults. Bind the original file's
    // features to each top-level declaration so files sharing a package cannot
    // inherit another file's context or silently lose their own explicit rules.
    const features=fileFeatures(file);
    for(const declaration of [...(file.messageType||[]),...(file.enumType||[]),...(file.service||[]),...(file.extension||[])]){
      applyFileFeatures(namedJson(json,scope?scope+'.'+declaration.name:declaration.name),features);
    }
    fileMetadata.push({path:file.name,syntax,...(syntax==='editions'?{edition:file.edition}:{}),dependencies:[...(file.dependency||[])]});
    for(const [i,message]of (file.messageType||[]).entries())visitMessage(message,scope,syntax,locations,[4,i]);
    for(const field of file.extension||[]){const name=scope?scope+'.'+field.name:field.name;patchField(field,namedJson(json,name),scope,syntax);}
    for(const [i,service]of (file.service||[]).entries()){
      const item=namedJson(json,scope?scope+'.'+service.name:service.name);comments(item,locations,[6,i]);
      for(const [j,method]of (service.method||[]).entries())comments(item.methods[method.name],locations,[6,i,2,j]);
    }
  }
  function adaptMaps(message,parentName){
    const name=parentName?parentName+'.'+message.name:message.name,item=namedJson(json,name);
    for(const field of message.field||[]){
      const entry=mapEntries.get(field.typeName);if(!entry)continue;
      need(field.type===11&&field.label===3&&!own(field,'oneofIndex')&&entry.parentName===name,'A map-entry type must be used by its original repeated map field.');
      const members=entry.message.field||[],key=members.find(value=>value.number===1),value=members.find(value=>value.number===2);
      need(members.length===2&&key?.name==='key'&&value?.name==='value'&&key.label===1&&value.label===1&&mapKeys.has(key.type)&&value.type!==10&&!(entry.message.oneofDecl||[]).length,'The original map-entry descriptor is invalid.');
      const target=item.fields[field.name];target.keyType=scalar[key.type];target.type=value.typeName||scalar[value.type];delete target.rule;
      if(target.options)delete target.options.packed;
      mapUses.set(field.typeName,(mapUses.get(field.typeName)||0)+1);
    }
    for(const nested of message.nestedType||[])adaptMaps(nested,name);
  }
  for(const file of set.file)for(const message of file.messageType||[])adaptMaps(message,file.package||'');
  for(const [name,entry]of mapEntries){
    need(mapUses.get(name)===1,'A synthetic map-entry descriptor must belong to exactly one map field.');
    const parent=namedJson(json,entry.parentName);delete parent.nested[entry.message.name];
  }
  let root;try{root=protobuf.Root.fromJSON(json).resolveAll();}catch(error){need(false,'The retained descriptor runtime cannot compile: '+error.message,'grpc_proto_types');}
  for(const [name,metadata]of fieldMetadata){
    const at=name.lastIndexOf('.'),message=root.lookup(name.slice(0,at)),field=message instanceof protobuf.Type?message.fields[name.slice(at+1)]:null;
    if(field)field.descriptorMetadata=metadata;
  }
  return {root,metadata:{files:fileMetadata.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)}};
}
export function compileDescriptorSource(input){
  const {source,decoded}=normalized(input,true),{root,metadata}=nativeRoot(decoded);
  return {source,root,metadata};
}
export function createDescriptorSource(input){
  const {source,decoded}=normalized(input,false);nativeRoot(decoded);return source;
}

