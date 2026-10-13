// MIT. Declarative commissioning programmes over original saved Flowable operations.
export const FLOWABLE_PROGRAMME_SCHEMA='stellar-forge.flowable-programme.v1';
const kinds=new Set(['release','process','task','migration','decisionRelease','decisionEvaluation','caseRelease','caseInstance','casePlanItem','caseTask']);
const fields=new Set(['processInstanceId','taskId','caseInstanceId','planItemInstanceId']);
const documents=new Set(['response','before','after','reconciliation','selection']);
const badKeys=new Set(['__proto__','prototype','constructor']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>JSON.parse(JSON.stringify(value));
function need(ok,message){if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_PROGRAMME_INVALID',status:400});}
const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)&&(!required||value.trim());
const key=value=>!badKeys.has(value)&&typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(value);
function keys(value,allowed,label){
 need(plain(value),label+' must be an object.');
 for(const name of Object.keys(value))need(allowed.includes(name)&&!badKeys.has(name),label+' has an unknown field: '+name);
}
export function programmePointer(value,pointer){
 need(typeof pointer==='string'&&(pointer===''||pointer.startsWith('/'))&&pointer.length<=2000,'Use an original JSON pointer.');
 if(pointer==='')return value;
 for(const raw of pointer.slice(1).split('/')){
  need(!/~(?:[^01]|$)/.test(raw),'Invalid JSON pointer escape.');
  const part=raw.replaceAll('~1','/').replaceAll('~0','~');
  need(!badKeys.has(part)&&value!==null&&typeof value==='object'&&Object.hasOwn(value,part),'The selected original field is absent: '+pointer);
  value=value[part];
 }return value;
}
function sourceContract(source,previous,dependencies,depth=0){
 need(depth<=4,'Native source selectors are nested too deeply.');
 keys(source,['step','document','pointer','where','valuePointer'],'Native source selector');
 need(key(source.step)&&previous.has(source.step),'Bind only an earlier programme step.');
 need(documents.has(source.document)&&text(source.pointer,2000),'Select an original operation document and JSON pointer.');
 need(source.pointer===''||source.pointer.startsWith('/'),'Use a complete JSON pointer.');
 dependencies.add(source.step);
 if(source.valuePointer!==undefined)need(text(source.valuePointer,2000)&&(source.valuePointer===''||source.valuePointer.startsWith('/')),'Invalid selected value pointer.');
 if(source.where!==undefined){
  need(plain(source.where)&&Object.keys(source.where).length>0&&Object.keys(source.where).length<=20,'An original row selector needs one to twenty fields.');
  for(const[name,value]of Object.entries(source.where)){
   need(!badKeys.has(name)&&text(name,200,true),'Invalid native row field.');
   if(plain(value))sourceContract(value,previous,dependencies,depth+1);
   else need(value===null||['string','boolean'].includes(typeof value)||Number.isSafeInteger(value),'Match exact native strings, booleans or safe integers.');
  }
 }
}
export function validateFlowableProgramme(value){
 keys(value,['schema','key','label','note','sources','steps'],'Programme');
 need(value.schema===FLOWABLE_PROGRAMME_SCHEMA&&key(value.key)&&text(value.label,300,true)&&text(value.note??'',20000),'Use a named complete Flowable programme.');
 need(Array.isArray(value.steps)&&value.steps.length>0&&value.steps.length<=500,'A programme needs one to five hundred native steps.');
 need(Array.isArray(value.sources??[])&&(value.sources??[]).length<=500,'Use a complete source inventory of at most five hundred members.');
 const names=new Set();
 for(const source of value.sources??[]){
  keys(source,['name','bytes','sha256','mediaType','contentBase64'],'Source member');
  need(text(source.name,1000,true)&&!names.has(source.name)&&!source.name.includes('\\')&&!source.name.split('/').some(p=>!p||p==='.'||p==='..'),'Use distinct relative source names.');
  need(Number.isSafeInteger(source.bytes)&&source.bytes>=0&&source.bytes<=16*1024*1024&&/^[a-f0-9]{64}$/.test(source.sha256??'')&&
    text(source.mediaType??'application/octet-stream',200,true)&&typeof source.contentBase64==='string'&&source.contentBase64.length<=24*1024*1024,'Retain each complete source and its identity.');
  names.add(source.name);
 }
 const previous=new Set(),steps=[];
 for(const step of value.steps){
  keys(step,['key','label','kind','selection','after','bindings','note'],'Programme step');
  need(key(step.key)&&!previous.has(step.key)&&kinds.has(step.kind)&&text(step.label,300,true)&&text(step.note??'',20000),'Use distinct named original operation steps.');
  need(plain(step.selection)&&text(step.selection.action,100,true),'Each step selects an original native action.');
  need(Array.isArray(step.after??[])&&(step.after??[]).every(name=>previous.has(name)),'A step can depend only on earlier steps.');
  need(Array.isArray(step.bindings??[])&&(step.bindings??[]).length<=100,'Keep complete native bindings.');
  const dependencies=new Set(step.after??[]),targets=new Set();
  for(const binding of step.bindings??[]){
   keys(binding,['field','token','from'],'Native binding');
   need((binding.field===undefined)!==(binding.token===undefined),'Select one native field or quoted body token.');
   if(binding.field!==undefined)need(fields.has(binding.field),'Select an original native instance or work ID field.');
   else need(typeof binding.token==='string'&&/^__[A-Z0-9_]{1,100}__$/.test(binding.token)&&typeof step.selection.bodyText==='string'&&
     step.selection.bodyText.includes(JSON.stringify(binding.token)),'The complete quoted placeholder must occur in the original body text.');
   const target=binding.field??binding.token;need(!targets.has(target),'A native target has more than one binding.');targets.add(target);
   sourceContract(binding.from,previous,dependencies);
  }
  steps.push({...copy(step),dependencies:[...dependencies]});previous.add(step.key);
 }
 return{...copy(value),sources:copy(value.sources??[]),steps};
}
export async function resolveProgrammeSelection(step,readDocument){
 const evidence=[],cache=new Map();
 async function sourceValue(source,depth=0){
  need(depth<=4,'Native selector nesting exceeds the original contract.');
  const cacheKey=source.step+'\n'+source.document;
  if(!cache.has(cacheKey))cache.set(cacheKey,await readDocument(source.step,source.document));
  const original=cache.get(cacheKey);need(plain(original)&&Object.hasOwn(original,'value')&&original.record,'Read the complete saved original document.');
  let value=programmePointer(original.value,source.pointer);
  if(source.where!==undefined){
   need(Array.isArray(value),'The native selector must address an original row collection.');
   const matches={};
   for(const[name,expected]of Object.entries(source.where))matches[name]=plain(expected)?await sourceValue(expected,depth+1):expected;
   const rows=value.filter(row=>plain(row)&&Object.entries(matches).every(([name,expected])=>Object.hasOwn(row,name)&&row[name]===expected));
   need(rows.length===1,'The original native selector must match exactly one row; matched '+rows.length+'.');
   value=rows[0];
  }
  if(source.valuePointer!==undefined)value=programmePointer(value,source.valuePointer);
  evidence.push({source:copy(source),record:copy(original.record),value:copy(value)});
  return value;
 }
 const selection=copy(step.selection);
 for(const binding of step.bindings??[]){
  const value=await sourceValue(binding.from);
  need(typeof value==='string'&&value.length>0&&value.length<=2000&&!/[\u0000-\u001f\u007f]/.test(value),'Bind the exact native string identifier.');
  if(binding.field)selection[binding.field]=value;
  else{
   const token=JSON.stringify(binding.token);need(selection.bodyText.includes(token),'The original body token is absent.');
   selection.bodyText=selection.bodyText.split(token).join(JSON.stringify(value));
  }
 }
 return{selection,evidence};
}
export function programmeProgress(spec,attempts,records){
 const rows=spec.steps.map(step=>{
  const history=Object.hasOwn(attempts,step.key)?attempts[step.key]:[];
  const selected=history.at(-1),record=selected?records[selected.operationId]??null:null;
  const state=record?.value?.state??(selected?'PREPARING':'NOT_STARTED');
  return{key:step.key,label:step.label,kind:step.kind,dependencies:step.dependencies,attempts:history.length,
   selected:selected??null,record:record?{kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256,
    state,phase:record.value.phase,dispatchedAt:record.value.dispatchedAt??null}:null,state};
 });
 const byKey=new Map(rows.map(row=>[row.key,row]));
 for(const row of rows){
  row.waitingFor=row.dependencies.filter(name=>byKey.get(name).state!=='CONFIRMED');
  row.ready=row.waitingFor.length===0&&(!row.selected||(!row.record?.dispatchedAt&&['STALE','INVALID','PREPARE_FAILED','INTERRUPTED'].includes(row.state)));
 }
 const confirmed=rows.filter(row=>row.state==='CONFIRMED').length;
 return{rows,total:rows.length,confirmed,state:confirmed===rows.length?'COMPLETED':rows.some(row=>row.selected)?'IN_PROGRESS':'SAVED',
  next:rows.find(row=>row.ready)?.key??null,
  basis:rows.map(row=>({key:row.key,record:row.record?{kind:row.record.kind,id:row.record.id,revision:row.record.revision,sha256:row.record.sha256}:null}))};
}
