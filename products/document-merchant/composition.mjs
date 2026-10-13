// MIT. Complete dataset and template preparation for the original document batch.
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {
  absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,canonical,plain
} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {initialRecord} from '../prepaid-api/records.mjs';
import {documentProvider,defaultDocumentSettings,documentError} from './contracts.mjs';
import {
  DOCUMENT_BATCH_SCHEMA,normalizeDocumentBatch,prepareDocumentBatch,readDocumentBatch,
  exportDocumentBatch
} from './batch.mjs';

export const DOCUMENT_COMPOSITION_SCHEMA='stellar-forge.document-composition.v1';
export const DOCUMENT_COMPOSITION_PLAN_SCHEMA='stellar-forge.document-composition-plan.v1';
const MiB=1048576;
const MAX_DATA=16*MiB,MAX_TEMPLATE=MiB,MAX_PLAN=192*MiB,MAX_RECORDS=100000;
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME=/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN=new Set(['__proto__','prototype','constructor']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>canonical(a)===canonical(b);
const copied=value=>structuredClone(value);
const bytes=value=>Buffer.byteLength(value,'utf8');
const fileName=format=>format==='html'?'html':'md';
const media=format=>format==='html'?'text/html':'text/markdown';
const fail=(code,message)=>{throw documentError(code,message??code);};
function requireValue(value,code,message){if(!value)fail(code,message);}
function strictObject(value,names,code){
  requireValue(plain(value)&&Object.keys(value).every(key=>names.includes(key)),code);
}
function boundedText(value,max,code){
  requireValue(typeof value==='string'&&value.length>0&&value.length<=max&&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),code);return value;
}
function localPath(value){
  boundedText(value,4096,'DOCUMENT_COMPOSITION_SOURCE_PATH_REQUIRED');
  requireValue(!isAbsolute(value)&&!value.includes('\\')&&!value.split('/').some(x=>x===''||x==='.'||x==='..'),
    'DOCUMENT_COMPOSITION_SOURCE_PATH_INVALID');return value;
}
function sourcePath(root,name){
  const path=resolve(root,localPath(name)),part=relative(root,path);
  requireValue(part&&!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part),
    'DOCUMENT_COMPOSITION_SOURCE_OUTSIDE_ROOT');return path;
}
function pointerParts(value){
  requireValue(typeof value==='string'&&value.length<=1024&&(value===''||value.startsWith('/'))&&
    !/~(?:[^01]|$)/.test(value),'DOCUMENT_COMPOSITION_POINTER_INVALID');
  return value===''?[]:value.slice(1).split('/').map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~'));
}
function pointer(root,value){
  let current=root;
  for(const key of pointerParts(value)){
    if(current===null||typeof current!=='object'||!Object.hasOwn(current,key))return undefined;
    current=current[key];
  }
  return current;
}
function safeName(value){
  requireValue(NAME.test(value??'')&&!FORBIDDEN.has(value),'DOCUMENT_COMPOSITION_BINDING_NAME_INVALID');
  return value;
}
function scalar(value){
  return value===null||['string','number','boolean'].includes(typeof value);
}
function usableKey(value){
  requireValue(['string','number'].includes(typeof value)&&String(value).trim().length>0&&
    String(value).length<=512&&!(typeof value==='number'&&!Number.isSafeInteger(value)),
    'DOCUMENT_COMPOSITION_RECORD_KEY_REQUIRED');return String(value);
}
function checkedData(value,depth=0){
  requireValue(depth<=64,'DOCUMENT_COMPOSITION_DATA_TOO_DEEP');
  if(typeof value==='number')requireValue(Number.isFinite(value)&&
    (!Number.isInteger(value)||Number.isSafeInteger(value)),'DOCUMENT_COMPOSITION_UNSAFE_NUMBER',
    'Use a string for identifiers and integers outside the exact JavaScript integer range.');
  if(value&&typeof value==='object')for(const member of Object.values(value))checkedData(member,depth+1);
  return value;
}
export function documentCompositionTemplate(provider='mintpdf'){
  const service=documentProvider(provider);
  return {
    schema:DOCUMENT_COMPOSITION_SCHEMA,id:'orders-2026-10-12',name:'Order documents',
    provider:service.id,merchantOrigin:null,
    dataset:{source:'orders.json',format:'json',recordsPointer:''},
    recordKey:'/order_id',taskReference:'order-{{order_id}}',bindings:{},
    templates:[
      {id:'invoice',source:'invoice.html',format:'html',title:'Invoice {{order_id}}',
        label:'Invoice {{order_id}}',settings:defaultDocumentSettings(service.id)},
      {id:'greeting',source:'greeting.html',format:'html',title:'Greeting for {{order_id}}',
        label:'Greeting for {{order_id}}',when:{pointer:'/gift_message',notEmpty:true},
        settings:defaultDocumentSettings(service.id)}
    ],
    maxGeneratedBytes:16*MiB
  };
}
function correctionLineage(value,templates,id){
  strictObject(value,['schema','mode','reason','parent','documents'],'DOCUMENT_CORRECTION_LINEAGE_INVALID');
  requireValue(value.schema==='stellar-forge.document-correction.v1'&&
    ['correction','repeat'].includes(value.mode),'DOCUMENT_CORRECTION_LINEAGE_INVALID');
  strictObject(value.parent,['id','sourceSha256'],'DOCUMENT_CORRECTION_PARENT_REQUIRED');
  requireValue(ID.test(value.parent.id??'')&&value.parent.id!==id&&HASH.test(value.parent.sourceSha256??''),
    'DOCUMENT_CORRECTION_PARENT_REQUIRED');
  requireValue(Array.isArray(value.documents)&&value.documents.length>0&&value.documents.length<=2000,
    'DOCUMENT_CORRECTION_SELECTION_REQUIRED');
  const pairs=new Set(),ids=new Set(),templateIds=new Set(templates.map(item=>item.id));
  const documents=value.documents.map(item=>{
    strictObject(item,['id','recordKey','templateId','taskReference','sourceSha256'],'DOCUMENT_CORRECTION_SELECTION_INVALID');
    const key=usableKey(item.recordKey),pair=canonical([key,item.templateId]);
    requireValue(typeof item.recordKey==='string'&&ID.test(item.id??'')&&!ids.has(item.id)&&
      templateIds.has(item.templateId)&&!pairs.has(pair)&&HASH.test(item.sourceSha256??''),
      'DOCUMENT_CORRECTION_SELECTION_INVALID');
    ids.add(item.id);pairs.add(pair);
    return {id:item.id,recordKey:key,templateId:item.templateId,
      taskReference:boundedText(item.taskReference,800,'DOCUMENT_CORRECTION_TASK_REQUIRED'),
      sourceSha256:item.sourceSha256};
  });
  return {schema:value.schema,mode:value.mode,
    reason:boundedText(value.reason,2000,'DOCUMENT_CORRECTION_REASON_REQUIRED'),
    parent:{id:value.parent.id,sourceSha256:value.parent.sourceSha256},documents};
}
function assertCorrectionDocuments(config,documents){
  if(!config.correction)return;
  const selectedTemplates=new Set(config.correction.documents.map(item=>item.templateId));
  requireValue(config.templates.every(item=>selectedTemplates.has(item.id)),
    'DOCUMENT_CORRECTION_TEMPLATE_SELECTION_CHANGED');
  const expected=new Map(config.correction.documents.map(item=>[canonical([item.recordKey,item.templateId]),item]));
  requireValue(documents.length===expected.size,'DOCUMENT_CORRECTION_SELECTION_CHANGED',
    'Every selected original document must produce exactly one replacement. Check its record and template condition.');
  const seen=new Set();
  for(const item of documents){
    const key=canonical([item.recordKey,item.templateId]),original=expected.get(key);
    requireValue(original&&!seen.has(key)&&item.taskReference===original.taskReference,
      'DOCUMENT_CORRECTION_TASK_CHANGED','Keep each selected record key and original business task reference.');
    if(config.correction.mode==='repeat')requireValue(item.sha256===original.sourceSha256,
      'DOCUMENT_CORRECTION_REPEAT_SOURCE_CHANGED','An unchanged repeat must retain the original document source. Select correction to edit it.');
    seen.add(key);
  }
}
export function normalizeDocumentComposition(value){
  strictObject(value,['schema','id','name','provider','merchantOrigin','dataset','recordKey',
    'taskReference','bindings','templates','maxGeneratedBytes','correction'],'DOCUMENT_COMPOSITION_REQUIRED');
  requireValue(value.schema===DOCUMENT_COMPOSITION_SCHEMA&&ID.test(value.id??''),
    'DOCUMENT_COMPOSITION_ID_REQUIRED');
  const service=documentProvider(value.provider);
  let origin;try{origin=new URL(value.merchantOrigin);}catch{fail('DOCUMENT_COMPOSITION_MERCHANT_REQUIRED');}
  requireValue(origin.protocol==='https:'&&origin.origin===value.merchantOrigin&&!origin.username&&!origin.password,
    'DOCUMENT_COMPOSITION_MERCHANT_REQUIRED');
  strictObject(value.dataset,['source','format','delimiter','recordsPointer','group'],
    'DOCUMENT_COMPOSITION_DATASET_REQUIRED');
  const dataset={source:localPath(value.dataset.source),format:value.dataset.format};
  requireValue(['csv','json'].includes(dataset.format),'DOCUMENT_COMPOSITION_DATASET_FORMAT_INVALID');
  if(dataset.format==='csv'){
    requireValue(value.dataset.recordsPointer===undefined,'DOCUMENT_COMPOSITION_CSV_POINTER_INVALID');
    dataset.delimiter=value.dataset.delimiter??',';
    requireValue([',',';','\t'].includes(dataset.delimiter),'DOCUMENT_COMPOSITION_CSV_DELIMITER_INVALID');
  }else{
    requireValue(value.dataset.delimiter===undefined,'DOCUMENT_COMPOSITION_JSON_DELIMITER_INVALID');
    dataset.recordsPointer=value.dataset.recordsPointer??'';pointerParts(dataset.recordsPointer);
  }
  if(value.dataset.group!==undefined){
    const group=value.dataset.group;
    strictObject(group,['key','itemsAs','itemFields'],'DOCUMENT_COMPOSITION_GROUP_INVALID');
    boundedText(group.key,200,'DOCUMENT_COMPOSITION_GROUP_KEY_REQUIRED');
    requireValue(Array.isArray(group.itemFields)&&group.itemFields.length>0&&group.itemFields.length<=200&&
      new Set(group.itemFields).size===group.itemFields.length&&
      group.itemFields.every(x=>typeof x==='string'&&x.length>0&&x.length<=200)&&
      !group.itemFields.includes(group.key),'DOCUMENT_COMPOSITION_GROUP_FIELDS_INVALID');
    dataset.group={key:group.key,itemsAs:safeName(group.itemsAs),itemFields:[...group.itemFields]};
  }
  pointerParts(value.recordKey);
  const bindings=value.bindings??{};
  requireValue(plain(bindings)&&Object.keys(bindings).length<=200,'DOCUMENT_COMPOSITION_BINDINGS_INVALID');
  for(const [name,path]of Object.entries(bindings)){safeName(name);pointerParts(path);}
  requireValue(Array.isArray(value.templates)&&value.templates.length>0&&value.templates.length<=8,
    'DOCUMENT_COMPOSITION_TEMPLATES_REQUIRED');
  const seen=new Set();
  const templates=value.templates.map(item=>{
    strictObject(item,['id','source','format','title','label','settings','when'],
      'DOCUMENT_COMPOSITION_TEMPLATE_INVALID');
    requireValue(ID.test(item.id??'')&&!seen.has(item.id),'DOCUMENT_COMPOSITION_TEMPLATE_ID_INVALID');
    seen.add(item.id);
    requireValue(service.formats.includes(item.format),'DOCUMENT_COMPOSITION_FORMAT_UNSUPPORTED');
    let when;
    if(item.when!==undefined){
      strictObject(item.when,['pointer','equals','notEmpty'],'DOCUMENT_COMPOSITION_CONDITION_INVALID');
      pointerParts(item.when.pointer);
      requireValue(Object.hasOwn(item.when,'equals')!==Object.hasOwn(item.when,'notEmpty'),
        'DOCUMENT_COMPOSITION_CONDITION_INVALID');
      if(Object.hasOwn(item.when,'equals'))requireValue(scalar(item.when.equals)&&
        (typeof item.when.equals!=='number'||Number.isFinite(item.when.equals)),
        'DOCUMENT_COMPOSITION_CONDITION_INVALID');
      else requireValue(item.when.notEmpty===true,'DOCUMENT_COMPOSITION_CONDITION_INVALID');
      when=copied(item.when);
    }
    return {id:item.id,source:localPath(item.source),format:item.format,
      title:boundedText(item.title,2000,'DOCUMENT_COMPOSITION_TITLE_REQUIRED'),
      label:boundedText(item.label??item.title,2000,'DOCUMENT_COMPOSITION_LABEL_REQUIRED'),
      settings:copied(item.settings??defaultDocumentSettings(service.id)),...(when?{when}:{})};
  });
  const maxGeneratedBytes=value.maxGeneratedBytes??16*MiB;
  requireValue(Number.isSafeInteger(maxGeneratedBytes)&&maxGeneratedBytes>=1&&maxGeneratedBytes<=64*MiB,
    'DOCUMENT_COMPOSITION_OUTPUT_ALLOWANCE_INVALID');
  return {schema:DOCUMENT_COMPOSITION_SCHEMA,id:value.id,
    name:boundedText(value.name,200,'DOCUMENT_COMPOSITION_NAME_REQUIRED'),
    provider:service.id,merchantOrigin:origin.origin,dataset,recordKey:value.recordKey,
    taskReference:boundedText(value.taskReference,2000,'DOCUMENT_COMPOSITION_TASK_REQUIRED'),
    bindings:copied(bindings),templates,maxGeneratedBytes,
    ...(Object.hasOwn(value,'correction')?{correction:correctionLineage(value.correction,templates,value.id)}:{})};
}

/** Read complete delimited records, including quoted separators, quotes and line breaks. */
export function parseDocumentCsv(source,{delimiter=','}={}){
  requireValue(typeof source==='string'&&bytes(source)<=MAX_DATA&&[',',';','\t'].includes(delimiter),
    'DOCUMENT_COMPOSITION_CSV_REQUIRED');
  const input=source.charCodeAt(0)===0xfeff?source.slice(1):source;
  const rows=[];let row=[],field='',state='start',ended=false;
  function cell(){row.push(field);field='';state='start';}
  function record(){cell();rows.push(row);row=[];ended=true;
    requireValue(rows.length<=MAX_RECORDS+1,'DOCUMENT_COMPOSITION_TOO_MANY_RECORDS');}
  for(let i=0;i<input.length;i++){
    const char=input[i];ended=false;
    if(state==='quoted'){
      if(char==='"'){if(input[i+1]==='"'){field+='"';i++;}else state='after';}
      else field+=char;
      continue;
    }
    if(char===delimiter){cell();continue;}
    if(char==='\r'||char==='\n'){
      if(char==='\r'&&input[i+1]==='\n')i++;
      record();continue;
    }
    if(state==='after')fail('DOCUMENT_COMPOSITION_CSV_SYNTAX',
      'Unexpected content after a closing quote in record '+(rows.length+1)+'.');
    if(char==='"'){
      requireValue(state==='start','DOCUMENT_COMPOSITION_CSV_SYNTAX',
        'A quote must begin its field in record '+(rows.length+1)+'.');state='quoted';continue;
    }
    field+=char;state='unquoted';
  }
  requireValue(state!=='quoted','DOCUMENT_COMPOSITION_CSV_SYNTAX','The final quoted field is incomplete.');
  if(!ended&&(input.length>0||row.length||field))record();
  requireValue(rows.length>=2,'DOCUMENT_COMPOSITION_CSV_RECORDS_REQUIRED');
  const headers=rows.shift();
  requireValue(headers.length>0&&headers.length<=200&&new Set(headers).size===headers.length&&
    headers.every(x=>x.length>0&&x.length<=200),'DOCUMENT_COMPOSITION_CSV_HEADERS_INVALID');
  return rows.map((values,index)=>{
    requireValue(values.length===headers.length,'DOCUMENT_COMPOSITION_CSV_COLUMNS_CHANGED',
      'Record '+(index+2)+' has '+values.length+' fields; the header has '+headers.length+'.');
    const record=Object.create(null);
    headers.forEach((key,column)=>{record[key]=values[column];});return record;
  });
}
function groupRecords(records,group){
  if(!group)return records;
  const groups=new Map(),itemFields=new Set(group.itemFields);
  for(const row of records){
    requireValue(Object.hasOwn(row,group.key)&&!Object.hasOwn(row,group.itemsAs)&&
      group.itemFields.every(key=>Object.hasOwn(row,key)),'DOCUMENT_COMPOSITION_GROUP_RECORD_INVALID');
    const key=usableKey(row[group.key]),header={},item={};
    for(const name of Object.keys(row)){
      if(itemFields.has(name))Object.defineProperty(item,name,{value:row[name],enumerable:true,writable:true,configurable:true});
      else Object.defineProperty(header,name,{value:row[name],enumerable:true,writable:true,configurable:true});
    }
    const current=groups.get(key);
    if(current){
      requireValue(equal(current.header,header),'DOCUMENT_COMPOSITION_GROUP_HEADER_CHANGED',
        'Rows in group '+key+' disagree outside the selected item fields.');
      current.items.push(item);
    }else groups.set(key,{header,items:[item]});
  }
  return [...groups.values()].map(({header,items})=>({...header,[group.itemsAs]:items}));
}
export function parseDocumentDataset(source,configuration){
  requireValue(typeof source==='string'&&bytes(source)>0&&bytes(source)<=MAX_DATA,
    'DOCUMENT_COMPOSITION_DATASET_SIZE_INVALID');
  let records;
  if(configuration.format==='csv')records=parseDocumentCsv(source,{delimiter:configuration.delimiter??','});
  else{
    let parsed;
    try{parsed=JSON.parse(source.charCodeAt(0)===0xfeff?source.slice(1):source);}
    catch{fail('DOCUMENT_COMPOSITION_JSON_INVALID');}
    checkedData(parsed);
    records=pointer(parsed,configuration.recordsPointer??'');
  }
  requireValue(Array.isArray(records)&&records.length>0&&records.length<=MAX_RECORDS&&records.every(plain),
    'DOCUMENT_COMPOSITION_RECORDS_REQUIRED');
  return {sourceRecords:records.length,records:groupRecords(records,configuration.group)};
}

function expression(value){
  if(['.','@index','@number'].includes(value))return value;
  const text=value.startsWith('@root.')?value.slice(6):value;
  requireValue(text.length>0&&text.length<=1024&&text.split('.').every(part=>
    (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(part)||/^(?:0|[1-9][0-9]*)$/.test(part))&&!FORBIDDEN.has(part)),
    'DOCUMENT_COMPOSITION_TEMPLATE_EXPRESSION_INVALID','Use a selected field path in '+value+'.');
  return value;
}
export function compileDocumentTemplate(source){
  requireValue(typeof source==='string'&&source.length>0&&bytes(source)<=MAX_TEMPLATE,
    'DOCUMENT_COMPOSITION_TEMPLATE_SIZE_INVALID');
  requireValue(!source.includes('{{{'),'DOCUMENT_COMPOSITION_RAW_TEMPLATE_VALUE_UNSUPPORTED',
    'Keep markup in the template and insert data with two braces.');
  const root=[],stack=[{kind:'root',children:root}],token=/{{([\s\S]*?)}}/g;
  let offset=0,match;
  while((match=token.exec(source))){
    const branch=stack.at(-1);
    if(match.index>offset)branch.children.push({kind:'text',value:source.slice(offset,match.index)});
    const value=match[1].trim();offset=token.lastIndex;
    if(value.startsWith('#each ')||value.startsWith('#if ')){
      const kind=value.startsWith('#each ')?'each':'if',path=expression(value.slice(kind.length+2).trim());
      const node={kind,path,children:[],otherwise:[]};branch.children.push(node);
      requireValue(stack.length<17,'DOCUMENT_COMPOSITION_TEMPLATE_TOO_DEEP');
      stack.push({kind,node,children:node.children,hasElse:false});
    }else if(value==='else'){
      requireValue(stack.length>1&&!branch.hasElse,'DOCUMENT_COMPOSITION_TEMPLATE_BLOCK_INVALID');
      branch.hasElse=true;branch.children=branch.node.otherwise;
    }else if(value==='/each'||value==='/if'){
      requireValue(stack.length>1&&branch.kind===value.slice(1),'DOCUMENT_COMPOSITION_TEMPLATE_BLOCK_INVALID');
      stack.pop();
    }else{
      requireValue(!value.startsWith('#')&&!value.startsWith('/')&&value!=='',
        'DOCUMENT_COMPOSITION_TEMPLATE_EXPRESSION_INVALID');
      branch.children.push({kind:'value',path:expression(value)});
    }
  }
  requireValue(stack.length===1,'DOCUMENT_COMPOSITION_TEMPLATE_BLOCK_INVALID');
  if(offset<source.length)root.push({kind:'text',value:source.slice(offset)});
  requireValue(!root.some(node=>node.kind==='text'&&node.value.includes('{{')),
    'DOCUMENT_COMPOSITION_TEMPLATE_TOKEN_INCOMPLETE');
  return root;
}
function templateValue(context,path){
  if(path==='.')return context.value;
  if(path==='@index')return context.index;
  if(path==='@number')return context.index===undefined?undefined:context.index+1;
  const original=path.startsWith('@root.'),parts=(original?path.slice(6):path).split('.');
  let value=original?context.root:context.value;
  for(const key of parts){
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return undefined;
    value=value[key];
  }
  return value;
}
function truth(value){return Array.isArray(value)?value.length>0:Boolean(value);}
function html(value){return String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
function escaped(value,format){
  const text=String(value);
  if(format==='html')return html(text);
  if(format==='markdown')return text.replace(/[\\`*_[\]{}()#+\-.!|~<>]/g,'\\$&');
  return text;
}
/** No expressions are evaluated as code; values are scalar and escaped for the selected document format. */
export function renderDocumentTemplate(compiled,record,{format='html',maxBytes=MAX_TEMPLATE,maxIterations=100000}={}){
  requireValue(Array.isArray(compiled)&&plain(record)&&['html','markdown','text'].includes(format)&&
    Number.isSafeInteger(maxBytes)&&maxBytes>0&&Number.isSafeInteger(maxIterations)&&maxIterations>0,
    'DOCUMENT_COMPOSITION_TEMPLATE_CONTEXT_INVALID');
  const chunks=[];let total=0,iterations=0;
  function append(text){total+=bytes(text);requireValue(total<=maxBytes,'DOCUMENT_COMPOSITION_DOCUMENT_TOO_LARGE');chunks.push(text);}
  function walk(nodes,context){
    for(const node of nodes){
      if(node.kind==='text'){append(node.value);continue;}
      const value=templateValue(context,node.path);
      if(node.kind==='value'){
        requireValue(value!==undefined&&value!==null&&scalar(value),'DOCUMENT_COMPOSITION_TEMPLATE_VALUE_REQUIRED',
          'Supply the scalar field '+node.path+' or put it inside an optional block.');
        append(escaped(value,format));continue;
      }
      if(node.kind==='if'){walk(truth(value)?node.children:node.otherwise,context);continue;}
      requireValue(node.kind==='each'&&(value===undefined||value===null||Array.isArray(value)),
        'DOCUMENT_COMPOSITION_TEMPLATE_LIST_REQUIRED','Supply an array for '+node.path+'.');
      if(!value?.length){walk(node.otherwise,context);continue;}
      for(let index=0;index<value.length;index++){
        iterations++;requireValue(iterations<=maxIterations,'DOCUMENT_COMPOSITION_TEMPLATE_ITERATION_LIMIT');
        walk(node.children,{value:value[index],root:context.root,index});
      }
    }
  }
  walk(compiled,{value:record,root:record,index:undefined});return chunks.join('');
}
function selectedContext(record,bindings){
  if(Object.keys(bindings).length===0)return record;
  const result={};
  for(const [name,path]of Object.entries(bindings)){
    const value=pointer(record,path);
    if(value!==undefined)result[name]=value;
  }
  return result;
}
function included(record,when){
  if(!when)return true;
  const value=pointer(record,when.pointer);
  if(Object.hasOwn(when,'equals'))return value!==undefined&&equal(value,when.equals);
  return value!==undefined&&value!==null&&
    !(typeof value==='string'&&value.trim()==='')&&!(Array.isArray(value)&&value.length===0);
}
function descriptor(path,content,contentType,role){
  return {path,contentType,role,bytes:bytes(content),sha256:digest(content),content};
}
function reviewHtml(plan){
  const rows=plan.documents.map(item=>'<tr><td>'+html(item.recordKey)+'</td><td>'+html(item.templateId)+
    '</td><td>'+html(item.taskReference)+'</td><td><a href="'+html(item.source)+'">'+html(item.label)+
    '</a></td><td>'+item.bytes.toLocaleString('en-US')+'</td><td><code>'+html(item.sha256)+'</code></td></tr>').join('\n');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+html(plan.request.name)+'</title><style>body{font:15px system-ui,sans-serif;line-height:1.5;color:#202020;background:#fff;margin:36px;max-width:1600px}'+
    'h1{font-size:26px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ccc;text-align:left;vertical-align:top}'+
    'th{background:#eee}code{font-size:12px;overflow-wrap:anywhere}a{color:#222;text-decoration:underline}input{font:inherit;padding:8px;border:1px solid #888;min-width:280px}'+
    '.facts{display:flex;gap:32px;flex-wrap:wrap;margin:24px 0}.facts strong{display:block;font-size:22px}</style></head><body>'+
    '<h1>'+html(plan.request.name)+'</h1><p>Complete source documents prepared from the saved dataset and templates.</p>'+
    '<div class="facts"><div><strong>'+plan.counts.sourceRecords+'</strong>source records</div><div><strong>'+
    plan.counts.groupedRecords+'</strong>grouped records</div><div><strong>'+plan.documents.length+
    '</strong>documents</div><div><strong>'+plan.counts.parentTasks+'</strong>parent task references</div></div>'+
    '<p>Merchant: <code>'+html(plan.request.merchantOrigin)+'</code>. Provider: '+html(plan.request.provider)+
    '. The original batch preparation returns the current native price for these documents.</p>'+
    '<p><a href="inputs/dataset.'+plan.request.dataset.format+'">Original dataset</a> · <a href="inputs/composition-request.json">Selected mapping</a> · '+
    '<a href="batch-input.json">Original batch input</a></p>'+
    '<label>Find a record or document <input id="filter" type="search"></label>'+
    '<table><thead><tr><th>Record</th><th>Template</th><th>Task reference</th><th>Complete source</th><th>Bytes</th><th>SHA256</th></tr></thead><tbody>'+
    rows+'</tbody></table><script>document.getElementById("filter").addEventListener("input",function(){var q=this.value.toLowerCase();'+
    'document.querySelectorAll("tbody tr").forEach(function(r){r.hidden=!r.textContent.toLowerCase().includes(q);});});</script></body></html>\n';
}

/** Produce the complete portable source plan. Files are written only by prepare/restore. */
export function composeDocumentSources({request,dataset,templates}={}){
  const original=copied(request),config=normalizeDocumentComposition(request);
  requireValue(plain(templates)&&Object.keys(templates).length===config.templates.length&&
    config.templates.every(item=>typeof templates[item.id]==='string'),'DOCUMENT_COMPOSITION_TEMPLATE_SOURCES_REQUIRED');
  const {sourceRecords,records}=parseDocumentDataset(dataset,config.dataset);
  const prepared=config.templates.map(item=>({...item,body:compileDocumentTemplate(templates[item.id]),
    titleAst:compileDocumentTemplate(item.title),labelAst:compileDocumentTemplate(item.label)}));
  const taskAst=compileDocumentTemplate(config.taskReference),keys=new Set(),documents=[],files=[];
  const selectedPairs=config.correction?new Set(config.correction.documents.map(item=>canonical([item.recordKey,item.templateId]))):null;
  let generatedBytes=0,selectedRecords=0;
  files.push(descriptor('inputs/dataset.'+config.dataset.format,dataset,
    config.dataset.format==='csv'?'text/csv':'application/json','dataset'));
  files.push(descriptor('inputs/composition-request.json',encoded(original).toString('utf8'),'application/json','configuration'));
  for(const item of config.templates)files.push(descriptor('inputs/template-'+item.id+'.'+fileName(item.format),
    templates[item.id],media(item.format),'template'));
  for(let index=0;index<records.length;index++){
    const record=records[index],key=usableKey(pointer(record,config.recordKey));
    requireValue(!keys.has(key),'DOCUMENT_COMPOSITION_DUPLICATE_RECORD_KEY','Record key '+key+' appears more than once.');
    keys.add(key);
    const context=selectedContext(record,config.bindings),selected=prepared.filter(item=>included(record,item.when)&&(!selectedPairs||selectedPairs.has(canonical([key,item.id]))));
    if(selected.length===0)continue;
    selectedRecords++;
    const taskReference=renderDocumentTemplate(taskAst,context,{format:'text',maxBytes:800});
    for(const item of selected){
      requireValue(documents.length<2000,'DOCUMENT_COMPOSITION_TOO_MANY_DOCUMENTS');
      const title=renderDocumentTemplate(item.titleAst,context,{format:'text',maxBytes:800});
      const label=renderDocumentTemplate(item.labelAst,context,{format:'text',maxBytes:800});
      const content=renderDocumentTemplate(item.body,context,{format:item.format,
        maxBytes:documentProvider(config.provider).maxSourceBytes});
      generatedBytes+=bytes(content);
      requireValue(generatedBytes<=config.maxGeneratedBytes,'DOCUMENT_COMPOSITION_OUTPUT_ALLOWANCE_EXCEEDED');
      const id='doc-'+digest(canonical([config.id,key,item.id])).slice(0,48);
      const source='documents/'+id+'.'+fileName(item.format);
      const file=descriptor(source,content,media(item.format),'document');files.push(file);
      documents.push({id,recordIndex:index,recordKey:key,templateId:item.id,source,format:item.format,label,
        taskReference,title,settings:copied(item.settings),bytes:file.bytes,sha256:file.sha256});
    }
  }
  requireValue(documents.length>0,'DOCUMENT_COMPOSITION_NO_DOCUMENTS_SELECTED');
  assertCorrectionDocuments(config,documents);
  const batchInput={schema:DOCUMENT_BATCH_SCHEMA,id:config.id,name:config.name,
    provider:config.provider,merchantOrigin:config.merchantOrigin,documents:documents.map(item=>({
      id:item.id,label:item.label,source:item.source,format:item.format,
      input:{title:item.title,taskReference:item.taskReference,settings:copied(item.settings)}
    }))};
  // Reuse all original request/provider/whole-file rules before any preparation is saved.
  normalizeDocumentBatch(batchInput,{sourceRoot:'/document-composition'});
  const plan={schema:DOCUMENT_COMPOSITION_PLAN_SCHEMA,request:config,originalRequest:original,
    requestSha256:digest(canonical(original)),batchInput,
    counts:{sourceRecords,groupedRecords:records.length,selectedRecords,
      excludedRecords:records.length-selectedRecords,parentTasks:new Set(documents.map(x=>x.taskReference)).size,
      documents:documents.length,generatedBytes},documents,files};
  files.push(descriptor('batch-input.json',encoded(batchInput).toString('utf8'),'application/json','batch'));
  files.push(descriptor('preview.html',reviewHtml(plan),'text/html','preview'));
  requireValue(encoded(plan).length<=MAX_PLAN,'DOCUMENT_COMPOSITION_PLAN_TOO_LARGE');
  return plan;
}
function validatePlan(value){
  requireValue(plain(value)&&value.schema===DOCUMENT_COMPOSITION_PLAN_SCHEMA&&HASH.test(value.requestSha256??'')&&
    digest(canonical(value.originalRequest))===value.requestSha256&&
    equal(normalizeDocumentComposition(value.originalRequest),value.request)&&
    Array.isArray(value.files)&&Array.isArray(value.documents),'DOCUMENT_COMPOSITION_PLAN_INVALID');
  const expectedPaths=new Set(['inputs/dataset.'+value.request.dataset.format,'inputs/composition-request.json',
    ...value.request.templates.map(item=>'inputs/template-'+item.id+'.'+fileName(item.format)),
    'batch-input.json','preview.html',...value.documents.map(item=>item.source)]);
  requireValue(value.documents.length>0&&value.documents.length<=2000&&
    new Set(value.documents.map(x=>x.id)).size===value.documents.length&&
    value.files.length===expectedPaths.size,'DOCUMENT_COMPOSITION_PLAN_FILES_CHANGED');
  const actualPaths=new Set();
  for(const file of value.files){
    requireValue(plain(file)&&expectedPaths.has(file.path)&&!actualPaths.has(file.path)&&
      typeof file.content==='string'&&bytes(file.content)===file.bytes&&digest(file.content)===file.sha256,
      'DOCUMENT_COMPOSITION_PLAN_FILES_CHANGED');
    localPath(file.path);actualPaths.add(file.path);
  }
  const byPath=new Map(value.files.map(file=>[file.path,file]));
  requireValue(equal(parse(Buffer.from(byPath.get('batch-input.json').content,'utf8')),value.batchInput)&&
    equal(parse(Buffer.from(byPath.get('inputs/composition-request.json').content,'utf8')),value.originalRequest),
    'DOCUMENT_COMPOSITION_BATCH_INPUT_CHANGED');
  const normalized=normalizeDocumentBatch(value.batchInput,{sourceRoot:'/document-composition'});
  requireValue(normalized.id===value.request.id&&normalized.provider===value.request.provider&&
    normalized.merchantOrigin===value.request.merchantOrigin&&normalized.documents.length===value.documents.length&&
    value.documents.every((item,index)=>{
      const declared=normalized.documents[index],file=byPath.get(item.source);
      return ID.test(item.id)&&item.id===declared.id&&item.source===declared.source&&
        item.label===declared.label&&item.format===declared.format&&item.title===declared.input.title&&
        item.taskReference===declared.input.taskReference&&equal(item.settings,declared.input.settings)&&
        file.role==='document'&&file.bytes===item.bytes&&file.sha256===item.sha256&&
        item.id==='doc-'+digest(canonical([value.request.id,item.recordKey,item.templateId])).slice(0,48);
    }),'DOCUMENT_COMPOSITION_DOCUMENT_BINDING_CHANGED');
  requireValue(value.counts?.documents===value.documents.length&&
    value.counts.generatedBytes===value.documents.reduce((sum,item)=>sum+item.bytes,0)&&
    value.counts.parentTasks===new Set(value.documents.map(item=>item.taskReference)).size,
    'DOCUMENT_COMPOSITION_COUNTS_CHANGED');
  assertCorrectionDocuments(value.request,value.documents);
  return value;
}
async function readSource(path,maxBytes,signal){
  signal?.throwIfAborted();
  const raw=await ownedBytes(path,maxBytes,{privateMode:false});
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}
  catch{fail('DOCUMENT_COMPOSITION_UTF8_REQUIRED');}
}
export async function reviewDocumentComposition({request,sourceRoot,signal}={}){
  const config=normalizeDocumentComposition(request),root=absolute(sourceRoot);
  await ownedDirectory(root);
  const dataset=await readSource(sourcePath(root,config.dataset.source),MAX_DATA,signal);
  const templates=Object.fromEntries(await Promise.all(config.templates.map(async item=>
    [item.id,await readSource(sourcePath(root,item.source),MAX_TEMPLATE,signal)])));
  return composeDocumentSources({request,dataset,templates});
}
function planPath(directory){return join(absolute(directory),'composition-plan.json');}
async function materialize(directory,plan,lease,signal){
  for(const relativeDirectory of ['inputs','documents'])await ownedDirectory(join(directory,relativeDirectory),{create:true});
  for(const file of plan.files){
    signal?.throwIfAborted();lease.assertHeld();
    await writeExact(sourcePath(directory,file.path),Buffer.from(file.content,'utf8'));
  }
}
function receipt(directory,plan,raw){
  return {schema:'stellar-forge.document-composition-receiving.v1',directory,
    planPath:planPath(directory),sha256:digest(raw),bytes:raw.length,
    id:plan.request.id,sourceRoot:directory,batchDirectory:join(directory,'batch'),
    batchInputPath:join(directory,'batch-input.json'),
    previewPath:join(directory,'preview.html'),counts:copied(plan.counts),plan};
}
export async function readDocumentComposition(directory,{requireFiles=true,expectedSha256,signal}={}){
  directory=await ownedDirectory(absolute(directory));
  const raw=await ownedBytes(planPath(directory),MAX_PLAN);
  requireValue(expectedSha256===undefined||HASH.test(expectedSha256)&&digest(raw)===expectedSha256,
    'DOCUMENT_COMPOSITION_SOURCE_SELECTION_CHANGED');
  const plan=validatePlan(parse(raw));
  if(requireFiles)for(const file of plan.files){
    signal?.throwIfAborted();const current=await ownedBytes(sourcePath(directory,file.path),Math.max(file.bytes,1));
    requireValue(current.length===file.bytes&&digest(current)===file.sha256,
      'DOCUMENT_COMPOSITION_MATERIALIZED_SOURCE_CHANGED');
  }
  return receipt(directory,plan,raw);
}
export async function prepareDocumentComposition({request,sourceRoot,directory,signal,onProgress}={}){
  if(request!==undefined)normalizeDocumentComposition(request);
  directory=await ownedDirectory(absolute(directory),{create:request!==undefined});
  const lease=await acquireStateLease(directory);
  try{
    const plan=await initialRecord({directory,name:'composition-plan.json',lease,maxBytes:MAX_PLAN,
      validate:value=>{
        validatePlan(value);
        requireValue(request===undefined||value.requestSha256===digest(canonical(request)),
          'DOCUMENT_COMPOSITION_ORIGINAL_REQUEST_CHANGED');
        return value;
      },
      create:async()=>{
        requireValue(request!==undefined,'DOCUMENT_COMPOSITION_RETAINED_SOURCE_REQUIRED');
        return reviewDocumentComposition({request,sourceRoot,signal});
      }});
    validatePlan(plan);
    await materialize(directory,plan,lease,signal);
    await onProgress?.({stage:'DOCUMENT_SOURCES_PREPARED',id:plan.request.id,...plan.counts});
  }finally{await lease.close();}
  return readDocumentComposition(directory,{signal});
}
/** Receive the complete saved source artifact in a chosen directory, preserving every document byte. */
export async function receiveDocumentComposition({source,directory,expectedSha256,signal}={}){
  const raw=await ownedBytes(absolute(source),MAX_PLAN,{privateMode:false});
  requireValue(HASH.test(expectedSha256??'')&&digest(raw)===expectedSha256,
    'DOCUMENT_COMPOSITION_SOURCE_SELECTION_CHANGED');
  const plan=validatePlan(parse(raw));
  directory=await ownedDirectory(absolute(directory),{create:true});
  const lease=await acquireStateLease(directory);
  try{
    lease.assertHeld();await writeExact(planPath(directory),raw);
    await materialize(directory,plan,lease,signal);
  }finally{await lease.close();}
  return readDocumentComposition(directory,{expectedSha256,signal});
}
export async function prepareDocumentCompositionBatch({workspace,directory,request,sourceRoot,
  intakeAccessToken=null,signal,onProgress}={}){
  const source=await prepareDocumentComposition({directory,request,sourceRoot,signal,onProgress});
  const batch=await prepareDocumentBatch({workspace,directory:source.batchDirectory,
    request:source.plan.batchInput,sourceRoot:source.directory,intakeAccessToken,signal,onProgress});
  return {composition:{directory:source.directory,sha256:source.sha256,bytes:source.bytes,
      previewPath:source.previewPath,batchDirectory:batch.plan.directory,counts:source.counts},
    batch};
}
function bindBatch(composition,batch){
  const expected=normalizeDocumentBatch(composition.plan.batchInput,{sourceRoot:composition.directory});
  requireValue(equal(batch.plan.input,expected),'DOCUMENT_COMPOSITION_ORIGINAL_BATCH_CHANGED');
}
export async function readDocumentCompositionBatch({directory,workspace,signal}={}){
  const composition=await readDocumentComposition(directory,{requireFiles:false,signal});
  const batch=await readDocumentBatch(composition.batchDirectory);bindBatch(composition,batch);
  requireValue(!workspace||workspace.directory===batch.plan.workspaceDirectory,
    'DOCUMENT_COMPOSITION_ORIGINAL_CUSTOMER_CHANGED');
  return {composition,batch};
}
export async function exportDocumentComposition({workspace,directory,destination,signal,maxBytes}={}){
  const {composition,batch}=await readDocumentCompositionBatch({directory,workspace,signal});
  const exported=await exportDocumentBatch({workspace,plan:batch.plan,
    directory:absolute(destination),signal,maxBytes});
  const target=await ownedDirectory(absolute(destination)),lease=await acquireStateLease(target);
  try{
    const raw=await ownedBytes(composition.planPath,MAX_PLAN);
    requireValue(digest(raw)===composition.sha256,'DOCUMENT_COMPOSITION_SOURCE_SELECTION_CHANGED');
    lease.assertHeld();await writeExact(join(target,'composition-plan.json'),raw);
    const result={schema:'stellar-forge.document-composition-export.v1',
      id:composition.id,directory:target,
      source:{path:join(target,'composition-plan.json'),bytes:raw.length,sha256:composition.sha256},
      counts:composition.counts,batch:exported};
    await writeExact(join(target,'composition-export.json'),encoded(result));
    return result;
  }finally{await lease.close();}
}
