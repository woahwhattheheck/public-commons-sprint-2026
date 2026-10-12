// MIT. Append-only contracts for the original dossier's workbook exchange.
import {extractionDigest,extractionTypedValue} from '../study-extraction.mjs';
import {requireValue,hashBytes,cellAt,cellColumn,cellRow,valueText} from './workbook.mjs';
export const TEMPLATE_SCHEMA='sf88-research-template-exchange/v1';
export const TEMPLATE_OPERATION_SCHEMA='sf88-research-template-operation/v1';
export const TEMPLATE_EVENT_FIELD='templateExchangeEvents';
export const TEMPLATE_ACTIONS=Object.freeze(['retain-template','revise-template','save-mapping','release-workbook','receive-return','review-return','record-extraction-draft']);
export const TEMPLATE_SECTIONS=Object.freeze(['overview','templates','template-editions','mappings','releases','returns','return-reviews','drafts','operations']);
export const digest=extractionDigest;
export const clone=value=>structuredClone(value);
export const same=(a,b)=>digest(a)===digest(b);
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function text(value,code,max=1000,empty=false){requireValue(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),code);return value;}
export function descriptor(value){
  requireValue(object(value)&&/^[a-f0-9]{64}$/u.test(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=64*1024*1024,'TEMPLATE_BLOB_INVALID');
  return {sha256:value.sha256,bytes:value.bytes};
}
export function input(value){
  requireValue(object(value)&&TEMPLATE_ACTIONS.includes(value.action),'TEMPLATE_ACTION_INVALID');
  const result={requestId:text(value.requestId,'TEMPLATE_REQUEST_ID_INVALID',170),expectedRevision:value.expectedRevision,
    actor:{id:text(value.actor?.id,'TEMPLATE_ACTOR_REQUIRED',180),name:text(value.actor?.name,'TEMPLATE_ACTOR_NAME_REQUIRED',200)},
    action:value.action,data:clone(value.data)};
  requireValue(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(result.requestId),'TEMPLATE_REQUEST_ID_INVALID');
  requireValue(Number.isSafeInteger(result.expectedRevision)&&result.expectedRevision>=1,'TEMPLATE_REVISION_REQUIRED');
  requireValue(object(result.data),'TEMPLATE_DATA_REQUIRED');
  text(result.data.reason,'TEMPLATE_REASON_REQUIRED',5000);
  requireValue(Buffer.byteLength(JSON.stringify(result))<=4*1024*1024,'TEMPLATE_REVIEW_TOO_LARGE',413);
  return result;
}
export function typedCell(typed,{mode='text'}={}){
  const value=extractionTypedValue(typed);
  requireValue(['text','number','boolean','json'].includes(mode),'TEMPLATE_OUTPUT_MODE_INVALID');
  if(value[0]==='NoneType')return {type:'blank',value:null};
  if(mode==='number'){
    requireValue(['str','number'].includes(value[0])&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value[1]),'TEMPLATE_EXPLICIT_NUMBER_REQUIRED');
    return {type:'number',value:value[1]};
  }
  if(mode==='boolean'){requireValue(value[0]==='bool','TEMPLATE_EXPLICIT_BOOLEAN_REQUIRED');return {type:'boolean',value:value[1]};}
  const plain=v=>v[0]==='array'?v[1].map(plain):v[0]==='object'?Object.fromEntries(v[1].map(([k,x])=>[k,plain(x)])):v[1];
  return {type:'text',value:mode==='json'?JSON.stringify(plain(value)):
    value[0]==='str'||value[0]==='number'?value[1]:value[0]==='bool'?(value[1]?'TRUE':'FALSE'):JSON.stringify(plain(value))};
}
export function pointer(value,path){
  text(path,'TEMPLATE_POINTER_INVALID',1000,true);requireValue(path===''||path.startsWith('/'),'TEMPLATE_POINTER_INVALID');
  let current=value;
  for(const token of path===''?[]:path.slice(1).split('/')){
    requireValue(!/~(?![01])/u.test(token),'TEMPLATE_POINTER_INVALID');
    const key=token.replace(/~1/gu,'/').replace(/~0/gu,'~');
    if(current===null||typeof current!=='object'||!Object.hasOwn(current,key))return {found:false};
    current=current[key];
  }
  return {found:true,value:clone(current)};
}
const tagged=value=>value===null?['NoneType',null]:typeof value==='string'?['str',value]:
  typeof value==='boolean'?['bool',value]:typeof value==='number'?['number',String(value)]:
  Array.isArray(value)?['array',value.map(tagged)]:['object',Object.entries(value).map(([k,v])=>[k,tagged(v)])];
export function mappingBindings(raw,inspection,publication){
  requireValue(Array.isArray(raw)&&raw.length>0&&raw.length<=20000,'TEMPLATE_BINDINGS_REQUIRED');
  const keys=new Set(),ids=new Set(),rows=new Map(publication.rows.map(r=>[r.result.resultId,r.result]));
  const bound=raw.map((binding,index)=>{
    requireValue(object(binding),'TEMPLATE_BINDING_INVALID');
    const sheet=text(binding.sheet,'TEMPLATE_SHEET_REQUIRED',200),cell=text(binding.cell,'TEMPLATE_CELL_REQUIRED',20);
    cellColumn(cell);requireValue(cellRow(cell)<=1048576,'TEMPLATE_CELL_INVALID');
    const key=sheet+'\n'+cell;requireValue(!keys.has(key),'TEMPLATE_DUPLICATE_TARGET');keys.add(key);
    const target=cellAt(inspection,sheet,cell);requireValue(target.formula===null,'TEMPLATE_FORMULA_TARGET_REQUIRES_MAPPING');
    const resultId=text(binding.resultId,'TEMPLATE_RESULT_REQUIRED',500),row=rows.get(resultId);
    requireValue(row&&row.editionId===binding.editionId,'TEMPLATE_RESULT_EDITION_CHANGED');
    const id=text(binding.id??'cell-'+index,'TEMPLATE_BINDING_ID_INVALID',200);requireValue(!ids.has(id),'TEMPLATE_BINDING_ID_DUPLICATE');ids.add(id);
    const mode=binding.mode??'text',component=binding.component??'value';
    let fieldId=null,source,typed;
    if(binding.pointer!==undefined){
      const selected=pointer(row.record,binding.pointer);requireValue(selected.found,'TEMPLATE_RECORD_POINTER_MISSING');
      source={kind:'record',pointer:binding.pointer,value:selected.value};
      typed=binding.typed===true?extractionTypedValue(selected.value):tagged(selected.value);
    }else{
      fieldId=text(binding.fieldId,'TEMPLATE_FIELD_REQUIRED',200);
      const answer=row.record?.values?.[fieldId];
      requireValue(answer&&Array.isArray(answer.value),'TEMPLATE_RESOLVED_FIELD_REQUIRED');
      requireValue(['value','status','note','context','bases'].includes(component),'TEMPLATE_ANSWER_COMPONENT_INVALID');
      source={kind:'answer',fieldId,component,status:answer.status,value:clone(answer.value),
        bases:clone(answer.bases??[]),context:clone(answer.context??{}),note:answer.note??''};
      typed=component==='value'?answer.value:tagged(answer[component]??(component==='note'?'':null));
    }
    const result={id,sheet,cell,resultId,editionId:row.editionId,resultSetId:row.record.resultSet.id,rowId:row.record.row.id,fieldId,component,mode,
      expectedFingerprint:target.fingerprint,originalCell:target,source,output:typedCell(typed,{mode})};
    if(binding.rowIdentity){
      const identity=binding.rowIdentity;
      requireValue(/^[A-Z]{1,3}$/u.test(identity.column)&&identity.value===resultId,'TEMPLATE_ROW_IDENTITY_INVALID');
      requireValue(identity.column!==cellColumn(cell),'TEMPLATE_ROW_IDENTITY_OVERLAP');
      result.rowIdentity={column:identity.column,value:identity.value};
    }
    if(inspection.format==='csv'&&result.output.type==='text'&&/^[=+\-@\t\r]/u.test(result.output.value)){
      result.output={type:'text',value:"'"+result.output.value};result.csvLiteralPrefix=true;
    }
    return result;
  });
  const identityRows=new Map();
  for(const binding of bound){
    if(!binding.rowIdentity)continue;
    const {column,value}=binding.rowIdentity,row=cellRow(binding.cell),key=JSON.stringify([binding.sheet,column,value]);
    requireValue(!identityRows.has(key)||identityRows.get(key)===row,'TEMPLATE_RESULT_IDENTITY_MULTIPLE_ROWS');
    identityRows.set(key,row);
    const worksheet=inspection.sheets.find(s=>s.name===binding.sheet);
    const present=worksheet.cells.filter(c=>cellColumn(c.address)===column&&valueText(c.value)===value);
    requireValue(present.every(c=>cellRow(c.address)===row),'TEMPLATE_RESULT_IDENTITY_ALREADY_ON_ANOTHER_ROW');
  }
  return bound;
}
export function model(state){
  const result={templates:[],editions:[],mappings:[],releases:[],returns:[],reviews:[],drafts:[],operations:clone(state[TEMPLATE_EVENT_FIELD]??[])};
  for(const op of result.operations){
    for(const [field,list] of [['template','templates'],['edition','editions'],['mapping','mappings'],['release','releases'],['return','returns'],['review','reviews'],['draft','drafts']])
      if(op.result[field])result[list].push(op.result[field]);
  }
  return result;
}
export function templateExchangeBlobs(state){
  const all=new Map();
  for(const event of state[TEMPLATE_EVENT_FIELD]??[]){
    for(const item of event.blobs??[]){
      const d=descriptor(item),prior=all.get(d.sha256);
      requireValue(!prior||prior.bytes===d.bytes,'TEMPLATE_BLOB_LENGTH_CONFLICT');all.set(d.sha256,d);
    }
  }
  return [...all.values()];
}
export function eventId(state,request,prefix='txo'){return prefix+'_'+digest({dossierId:state.id,requestId:request.requestId});}
export function sourceContext(state){
  const content=Object.fromEntries(Object.entries(state).filter(([k])=>!['revision','previous','updatedAt','change',TEMPLATE_EVENT_FIELD].includes(k)));
  return {sha256:digest(content),revision:state.revision};
}
export function validateTemplateExchangeState(state){
  requireValue(state[TEMPLATE_EVENT_FIELD]===undefined||Array.isArray(state[TEMPLATE_EVENT_FIELD]),'TEMPLATE_HISTORY_INVALID');
  const seen=new Set();let lastRevision=0;
  for(const event of state[TEMPLATE_EVENT_FIELD]??[]){
    const request=input(event.request);
    requireValue(event.schema===TEMPLATE_OPERATION_SCHEMA&&event.id===eventId(state,request)&&event.dossierId===state.id&&!seen.has(event.requestId),'TEMPLATE_HISTORY_INVALID');
    seen.add(event.requestId);
    requireValue(same(request,event.request)&&digest(request)===event.requestSha256&&event.requestId===request.requestId&&event.action===request.action&&same(event.actor,request.actor),'TEMPLATE_REQUEST_CHANGED');
    const {sha256,...content}=event;requireValue(digest(content)===sha256,'TEMPLATE_OPERATION_CHANGED');
    requireValue(Number.isSafeInteger(event.revision)&&event.revision===event.originalRevision+1&&event.revision<=state.revision&&event.originalRevision>=lastRevision,'TEMPLATE_OPERATION_REVISION_INVALID');
    requireValue(event.originalRevision===request.expectedRevision&&/^[a-f0-9]{64}$/u.test(event.originalRevisionSha256)&&Number.isFinite(Date.parse(event.createdAt)),'TEMPLATE_REQUEST_REVISION_CHANGED');
    requireValue(object(event.result)&&Array.isArray(event.blobs),'TEMPLATE_RESULT_INVALID');
    lastRevision=event.revision;
  }
  templateExchangeBlobs(state);
}
