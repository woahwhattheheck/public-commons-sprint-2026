// SPDX-License-Identifier: MIT
// Portable whole-review state. Provider data stays in the original project model.
import {validateProject,textPin,digest,clone,MAX_BYTES} from './project.mjs';
export const SESSION_SCHEMA='tjlabs.twenty-review-working.v1';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const need=(v,m)=>{if(!v)throw Error(m);};
const json=v=>JSON.stringify(v,null,2)+'\n';
export const TABS=['mapping','population','sources','history','native'];
export function initialSession(){return {schema:SESSION_SCHEMA,project:null,projectSha256:null,intake:{capture:null,mapping:null},editor:{mappingText:'',actor:'',reason:'',approve:false,projectId:'',title:'',fieldDrafts:{},tableDrafts:{}},view:{tab:'mapping',table:'',side:'source',query:'',offset:0,mappingTable:'0',mappingField:'new'}};}
function source(value,label){if(value===null)return;need(object(value)&&typeof value.filename==='string'&&value.filename.length<=4096&&typeof value.text==='string','Retain the complete '+label+' filename and text.');const pin=textPin(value.text);need(pin.bytes===value.bytes&&pin.sha256===value.sha256,'Original '+label+' file identity differs.');need(pin.bytes<=MAX_BYTES,'Original '+label+' exceeds 512 MiB.');}
export function receiveSession(input){
 let v=clone(input);
 if(v?.schema==='tjlabs.provider-migration-project.v1'){const s=initialSession();s.project=validateProject(v);s.projectSha256=digest(v);s.editor.mappingText=json(v.mapping);s.editor.projectId=v.id;s.editor.title=v.title;v=s;}
 if(v?.schema==='tjlabs.provider-migration-working.v1'){need(typeof v.mappingText==='string'&&typeof v.actor==='string'&&typeof v.reason==='string'&&typeof v.approve==='boolean','Malformed original working editor.');need(v.projectSha256===digest(v.project),'Original working project differs.');const s=receiveSession(v.project);Object.assign(s.editor,{mappingText:v.mappingText,actor:v.actor,reason:v.reason,approve:v.approve});v=s;}
 need(object(v)&&v.schema===SESSION_SCHEMA,'Open a complete Twenty review workspace or original provider project.');
 need(v.project===null||object(v.project),'Invalid selected project.');if(v.project!==null){validateProject(v.project);need(v.projectSha256===digest(v.project),'The selected project differs from its retained identity.');}else need(v.projectSha256===null,'An empty project cannot have a source identity.');
 need(object(v.intake)&&Object.keys(v.intake).sort().join(',')==='capture,mapping','Retain both original intake slots.');source(v.intake.capture,'capture');source(v.intake.mapping,'mapping');
 const e=v.editor;need(object(e)&&typeof e.approve==='boolean'&&object(e.fieldDrafts)&&object(e.tableDrafts),'Retain a complete typed editor.');
 for(const [key,limit]of [['mappingText',MAX_BYTES],['actor',20000],['reason',20000],['projectId',120],['title',300]])need(typeof e[key]==='string'&&e[key].length<=limit,'Malformed editor '+key+'.');
 need(Object.keys(e.fieldDrafts).length<=25000,'Too many retained field drafts.');
 const keys=['name','type','nullable','precision','scale','sourcePointer','targetPointer','sourceMissing','targetMissing','sourceValue','targetValue','sourceTransform','targetTransform','basisSha256'];
 for(const [key,d]of Object.entries(e.fieldDrafts)){need(/^(0|[1-9]\d*)\|(new|0|[1-9]\d*)$/.test(key)&&object(d),'Invalid retained field draft identity.');need(Object.keys(d).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(d,k)),'Unknown retained field draft input.');for(const [k,x]of Object.entries(d))need(k==='nullable'?typeof x==='boolean':typeof x==='string'&&x.length<=MAX_BYTES,'Invalid retained field input '+k+'.');need(['text','integer','decimal','boolean','date','timestamp'].includes(d.type)&&['error','null','value'].includes(d.sourceMissing)&&['error','null','value'].includes(d.targetMissing)&&/^[a-f0-9]{64}$/.test(d.basisSha256),'Malformed retained field selection or original basis.');}
 for(const [key,d]of Object.entries(e.tableDrafts)){need(/^(0|[1-9]\d*)$/.test(key)&&object(d)&&Object.keys(d).length===5&&['name','sourceObject','targetObject','primaryKey','basisSha256'].every(k=>Object.prototype.hasOwnProperty.call(d,k))&&Object.values(d).every(x=>typeof x==='string'&&x.length<=MAX_BYTES),'Malformed retained table draft.');}
 const w=v.view;need(object(w)&&TABS.includes(w.tab)&&['source','expected'].includes(w.side)&&typeof w.table==='string'&&typeof w.query==='string'&&Number.isSafeInteger(w.offset)&&w.offset>=0&&w.offset%100===0&&typeof w.mappingTable==='string'&&/^(0|[1-9]\d*)$/.test(w.mappingTable)&&typeof w.mappingField==='string'&&/^(new|0|[1-9]\d*)$/.test(w.mappingField),'Malformed saved view.');
 need(textPin(json(v)).bytes<=MAX_BYTES,'The complete portable review exceeds 512 MiB. Export the current copy before selecting more data.');
 return v;
}
export function serializeSession(input){return json(receiveSession(input));}
export function retainFile(file,text){const out={filename:file.name,text,...textPin(text)};source(out,'selected');return out;}
