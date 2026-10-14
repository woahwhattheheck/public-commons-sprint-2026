// MIT. Exact version-selected current Principal public contract ABI.
import * as fs from 'node:fs';
import {need,keys,integer,address,sha,identity,clone,text} from './value.mjs';
export const API=JSON.parse(fs.readFileSync(new URL('../CONTRACT_API.json',import.meta.url),'utf8'));
need(API.schema==='principal.contract-api.v2','CURRENT_SOURCE_EDITION_REQUIRED');
export const API_SHA256=identity(API);
export const makeCatalogue=api=>Object.entries(api.contracts).flatMap(([contract,spec])=>Object.entries(spec.methods).map(([method,value])=>({
 id:contract+'.'+method,label:method.replaceAll('_',' '),contract,method,readOnly:value.readOnly===true,returns:value.returns,
 fields:Object.entries(value.args).map(([name,type])=>({name,type,required:true,description:['i128','u64','u32'].includes(type)?'Exact integer string in the selected original ABI units':api.types?.[type]?'Complete '+type+' JSON with original exact integer strings and contract addresses':type,default:type==='bool'?false:type==='Vec<Address>'?[]:api.types?.[type]?Object.fromEntries(Object.entries(api.types[type]).map(([k,t])=>[k,t==='bool'?false:''])):''})),
 description:value.description??'Use the exact selected deployed contract and original authorization.',
 sourcePath:spec.sourcePath,sourceSha256:spec.sourceSha256
})));
export const catalogue=makeCatalogue(API);
export function action(id,api=API){const a=makeCatalogue(api).find(v=>v.id===id);need(a,'UNKNOWN_ACTION',{id});return a;}
export function parameters(id,input,api=API){
 const a=action(id,api);keys(input,a.fields.map(f=>f.name));const result={};
 for(const f of a.fields){const v=input[f.name];
  if(['u32','u64','i128'].includes(f.type))result[f.name]=integer(v,f.type);
  else if(f.type==='Address')result[f.name]=address(v);
  else if(f.type==='BytesN<32>')result[f.name]=sha(v);
  else if(f.type==='bool'){need(typeof v==='boolean','BOOLEAN_REQUIRED');result[f.name]=v;}
  else if(f.type==='String'){need(typeof v==='string'&&v.isWellFormed()&&!v.includes('\0')&&Buffer.byteLength(v)<=60000,'ABI_STRING_REQUIRED');result[f.name]=v;}
  else if(f.type==='Vec<Address>'){need(Array.isArray(v)&&v.length<=1000,'COMPLETE_ADDRESS_VECTOR_REQUIRED');result[f.name]=v.map(address);}
  else if(api.types?.[f.type]){result[f.name]=typed(f.type,v,api);}
  else throw Object.assign(new Error('UNSUPPORTED_ABI_TYPE'),{code:'UNSUPPORTED_ABI_TYPE',details:{type:f.type}});
 }
 return result;
}
function typed(type,value,api){
 const shape=api.types[type];need(shape&&typeof value==='object'&&value!==null&&!Array.isArray(value),'ABI_OBJECT_REQUIRED',{type});
 keys(value,Object.keys(shape));const out={};
 for(const [name,field]of Object.entries(shape)){
  const v=value[name];if(['u32','u64','i128'].includes(field))out[name]=integer(v,field);
  else if(field==='Address')out[name]=address(v);
  else if(field==='bool'){need(typeof v==='boolean','BOOLEAN_REQUIRED');out[name]=v;}
  else throw Object.assign(new Error('UNSUPPORTED_ABI_FIELD'),{code:'UNSUPPORTED_ABI_FIELD',details:{type,field}});
 }
 return out;
}
export function invocation(config,id,input,send,api=API){
 const a=action(id,api),p=parameters(id,input,api),c=config.contracts?.[a.contract];
 need(c&&c.id&&c.wasmSha256,'CONTRACT_BINDING_REQUIRED',{contract:a.contract});
 need(config.network?.rpcUrl&&config.network?.passphrase&&config.stellar?.configDirectory&&config.sourceAccount?.alias&&config.sourceAccount?.address,'NATIVE_BINDINGS_REQUIRED');
 const args=['--config-dir',config.stellar.configDirectory,'contract','invoke','--id',address(c.id),'--rpc-url',config.network.rpcUrl,'--network-passphrase',config.network.passphrase,'--source-account',send?config.sourceAccount.alias:address(config.sourceAccount.address),'--send',send?'yes':'no','--',a.method];
 for(const f of a.fields)args.push('--'+f.name+'='+((['String','Vec<Address>'].includes(f.type)||api.types?.[f.type])?JSON.stringify(p[f.name]):String(p[f.name])));
 return{action:clone(a),parameters:p,argv:args,contract:clone(c),apiSha256:identity(api)};
}
