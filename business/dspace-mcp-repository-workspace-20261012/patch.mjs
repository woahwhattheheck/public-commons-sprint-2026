import {createHash} from 'node:crypto';
export const clone=v=>structuredClone(v);
export const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
export const json=v=>JSON.stringify(stable(v));
export const digest=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:typeof v==='string'?v:json(v)).digest('hex');
export function fail(code,message,status=400,extra={}){throw Object.assign(new Error(message),{code,status,...extra});}
export function requireText(v,label,max=1000){if(typeof v!=='string'||!v.trim()||v.length>max)fail('INVALID_INPUT',label+' is required (up to '+max+' characters).');return v.trim();}
export function pointer(path){if(typeof path!=='string'||!path.startsWith('/'))fail('INVALID_PATCH','JSON Pointer must start with /.');return path.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~')).map(s=>{if(['__proto__','constructor','prototype'].includes(s))fail('INVALID_PATCH','Unsupported object key.');return s;});}
export const encodePointer=parts=>'/'+parts.map(s=>String(s).replace(/~/g,'~0').replace(/\//g,'~1')).join('/');
export function at(value,path){let v=value;for(const key of Array.isArray(path)?path:pointer(path)){if(v===null||typeof v!=='object'||!Object.hasOwn(v,key))return {present:false};v=v[key];}return {present:true,value:clone(v)};}
function parent(doc,parts){let v=doc;for(const k of parts.slice(0,-1)){if(v===null||typeof v!=='object'||!Object.hasOwn(v,k))fail('INVALID_PATCH','Patch parent does not exist: '+encodePointer(parts));v=v[k];}if(v===null||typeof v!=='object')fail('INVALID_PATCH','Patch parent is not a container.');return v;}
function index(container,key,add){if(!Array.isArray(container))return key;if(key==='-'&&add)return container.length;if(!/^(0|[1-9][0-9]*)$/.test(key))fail('INVALID_PATCH','Invalid array index.');const i=Number(key);if(i>container.length||(!add&&i===container.length))fail('INVALID_PATCH','Array index is outside the current value.');return i;}
export function applyPatch(source,operations,{root='metadata'}={}){
 const doc=clone(source);
 if(!Array.isArray(operations)||operations.length===0||operations.length>200)fail('INVALID_PATCH','Provide 1–200 patch operations.');
 for(const op of operations){
  if(!['add','remove','replace','move'].includes(op.op))fail('INVALID_PATCH','Use an original supported patch operation.');
  const parts=pointer(op.path);if(parts[0]!==root||parts.length<2)fail('INVALID_PATCH','Patch paths must be inside /'+root+'/.');
  let val=op.value;
  if(op.op==='move'){const from=pointer(op.from);if(from[0]!==root||from.length<2)fail('INVALID_PATCH','Move source must use the same metadata root.');if(parts.length>from.length&&from.every((v,i)=>parts[i]===v))fail('INVALID_PATCH','Cannot move a parent into its child.');const old=at(doc,from);if(!old.present)fail('INVALID_PATCH','Move source is absent.');val=old.value;const p=parent(doc,from),k=index(p,from.at(-1),false);if(Array.isArray(p))p.splice(k,1);else delete p[k];}
  const p=parent(doc,parts),k=index(p,parts.at(-1),op.op==='add'||op.op==='move');
  if(op.op==='remove'||op.op==='replace'){if(!Object.hasOwn(p,k))fail('INVALID_PATCH','The patched value is absent: '+op.path);}
  if(op.op==='remove'){if(Array.isArray(p))p.splice(k,1);else delete p[k];}
  else {if(op.op!=='move'&&!Object.hasOwn(op,'value'))fail('INVALID_PATCH','Add/replace requires a value.');if(Array.isArray(p)&&(op.op==='add'||op.op==='move'))p.splice(k,0,clone(val));else p[k]=clone(val);}
 }
 return doc;
}
export function fieldChanges(before,after,operations,root='metadata'){
 const paths=new Set();
 for(const op of operations)for(const p of [op.path,op.from].filter(Boolean)){const parts=pointer(p);paths.add(encodePointer(parts.slice(0,root==='sections'?3:2)));}
 return [...paths].map(path=>({path,before:at(before,path),after:at(after,path)}));
}
export function semanticField(entry){
 if(!entry.present||Array.isArray(entry.value)&&entry.value.length===0)return {present:false};
 if(!Array.isArray(entry.value))return entry;
 return {present:true,value:entry.value.map(v=>{if(!v||typeof v!=='object'||!Object.hasOwn(v,'value'))return v;const {place,...rest}=v;return {language:null,authority:null,confidence:-1,...rest};})};
}
export function checkChanges(doc,changes,side='before'){return changes.filter(c=>json(semanticField(at(doc,c.path)))!==json(semanticField(c[side])));}
export function inverseOperations(doc,changes){return changes.map(c=>{const current=at(doc,c.path),target=c.before;if(!target.present)return current.present?{op:'remove',path:c.path}:null;return {op:current.present?'replace':'add',path:c.path,value:clone(target.value)};}).filter(Boolean);}
export function simpleMetadata(input){const out={};for(const [key,val] of Object.entries(input||{})){if(!/^[a-zA-Z0-9_.-]+$/.test(key)||!Array.isArray(val)&&typeof val!=='string')fail('INVALID_METADATA','Use schema-qualified metadata keys and string values.');const values=Array.isArray(val)?val:[val];if(values.some(v=>typeof v!=='string'))fail('INVALID_METADATA','New-item metadata values must be strings.');out[key]=values.map((value,place)=>({value,language:null,authority:null,confidence:-1,place}));}return out;}
export function metadataContains(doc,expected){return Object.entries(expected||{}).every(([key,values])=>json((doc.metadata?.[key]||[]).map(x=>x.value))===json(values.map(x=>x.value)));}

