/* MIT. Complete response collaboration files; no network or workspace persistence. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CanadaBuysResponseReview=factory();})(globalThis,function(){
'use strict';
const TRANSFER_SCHEMA='starforge.canadabuys.response-review-transfer.v1';
const DOCUMENT_SCHEMA='starforge.canadabuys.response-review-document.v1';
const MAX_ATTACHMENT_BYTES=8*1024*1024,MAX_ATTACHMENTS_BYTES=16*1024*1024,MAX_FILE_BYTES=64*1024*1024;
const STATES=['UNREVIEWED','PROPOSED','CONFIRMED','NEEDS_WORK'],HASH=/^[a-f0-9]{64}$/;
const fail=(code,message,details)=>{const error=new Error(message);error.code=code;error.details=details;throw error;};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
function canonical(x,depth=0){
 if(depth>80)fail('RESPONSE_DEPTH','The complete file nesting exceeds its supported depth.');
 if(x===null||typeof x==='string'||typeof x==='boolean')return JSON.stringify(x);
 if(typeof x==='number'&&Number.isFinite(x))return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(v=>canonical(v,depth+1)).join(',')+']';
 if(plain(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k],depth+1)).join(',')+'}';
 fail('RESPONSE_JSON','Use complete JSON values without undefined or nonfinite numbers.');
}
const equal=(a,b)=>canonical(a)===canonical(b);
const string=(value,label,max=131072)=>{if(typeof value!=='string'||value.length>max)fail('RESPONSE_FIELD',label+' must be text within '+max+' characters.');return value;};
const nonempty=(value,label,max)=>{string(value,label,max);if(!value.trim())fail('RESPONSE_FIELD',label+' is required.');return value;};
function iso(value,label){nonempty(value,label,100);if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))fail('RESPONSE_TIME',label+' needs a complete offset timestamp.');return value;}
function list(x,label,maximum=1000){if(!Array.isArray(x)||x.length>maximum)fail('RESPONSE_FIELD',label+' must be a complete list of at most '+maximum+' items.');return x;}
function unique(rows,label){const ids=new Set();for(const row of rows){if(!plain(row))fail('RESPONSE_FIELD',label+' items must be objects.');nonempty(row.id,label+' id',512);if(ids.has(row.id))fail('RESPONSE_DUPLICATE','Repeated '+label+' id: '+row.id);ids.add(row.id);}return rows;}
async function digest(text,options={}){
 if(options.hash)return options.hash(text);
 if(!globalThis.crypto?.subtle)fail('RESPONSE_DIGEST','Open this file in a browser with local Web Crypto support.');
 const bytes=new TextEncoder().encode(text),value=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(value),x=>x.toString(16).padStart(2,'0')).join('');
}
function base64Bytes(value){
 string(value,'Attachment Base64',Math.ceil(MAX_ATTACHMENT_BYTES/3)*4);
 // Inspect each character once; a repeated-group regex exhausts the V8 stack
 // on valid attachments below the supported 8 MiB byte limit.
 if(value.length%4!==0)fail('RESPONSE_ATTACHMENT','Use complete standard Base64 attachment bytes.');
 const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,dataEnd=value.length-padding;
 for(let i=0;i<dataEnd;i++){
  const c=value.charCodeAt(i);
  if(!((c>=65&&c<=90)||(c>=97&&c<=122)||(c>=48&&c<=57)||c===43||c===47))fail('RESPONSE_ATTACHMENT','Use complete standard Base64 attachment bytes.');
 }
 if(value.length/4*3-padding>MAX_ATTACHMENT_BYTES)fail('RESPONSE_ATTACHMENT_CAPACITY','Each attached file is limited to 8 MiB.');
 const text=typeof atob==='function'?atob(value):Buffer.from(value,'base64').toString('binary');
 const bytes=Uint8Array.from(text,c=>c.charCodeAt(0));
 if(bytes.length>MAX_ATTACHMENT_BYTES)fail('RESPONSE_ATTACHMENT_CAPACITY','Each attached file is limited to 8 MiB.');
 return bytes;
}
async function digestBytes(bytes,options={}){
 if(options.hashBytes)return options.hashBytes(bytes);
 if(!globalThis.crypto?.subtle)fail('RESPONSE_DIGEST','Web Crypto is required to inspect attachment bytes.');
 const value=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(value),x=>x.toString(16).padStart(2,'0')).join('');
}
function validateMaster(master){
 if(!plain(master)||!plain(master.binding)||!plain(master.originalRow))fail('RESPONSE_MASTER','Open the complete original response master with its original source row.');
 for(const k of ['noticeId','sourceId','entryId'])nonempty(master.binding[k],'Original '+k,512);
 if(!HASH.test(master.binding.rowSha256||''))fail('RESPONSE_MASTER','The original row SHA256 is required.');
 unique(list(master.responses,'Response answers',500),'response');
 for(const row of master.responses){nonempty(row.title,'Response title',4096);string(row.draft,'Draft answer');}
 unique(list(master.annexes,'Response annexes',100),'annex');
 for(const annex of master.annexes){nonempty(annex.title,'Annex title',4096);for(const section of list(annex.sections,'Annex sections',500)){if(!plain(section))fail('RESPONSE_MASTER','Each annex section must be complete.');nonempty(section.title,'Section title',4096);string(section.text,'Section text');}}
 if(!master.responses.length)fail('RESPONSE_MASTER','The original response master has no answers.');
 canonical(master);return master;
}
function initialContent(master){
 validateMaster(master);
 const row=(id,text)=>({id,text,comment:'',status:'UNREVIEWED',reviewer:'',reviewedAt:null,evidenceIds:[]});
 return {respondent:{name:'',organization:'',role:'',notes:''},
  answers:master.responses.map(x=>row(x.id,x.draft)),
  annexes:master.annexes.flatMap(a=>a.sections.map((s,i)=>({...row(a.id+'/'+i,s.text),title:a.title+' — '+s.title})))};
}
function validateContent(value,master,attachmentIds){
 if(!plain(value)||!plain(value.respondent))fail('RESPONSE_CONTENT','Keep the complete response content and respondent.');
 for(const k of ['name','organization','role','notes'])string(value.respondent[k],'Respondent '+k,k==='notes'?32768:4096);
 const original=initialContent(master);
 for(const group of ['answers','annexes']){
  const rows=unique(list(value[group],group,5000),group);
  if(rows.length!==original[group].length||rows.some((r,i)=>r.id!==original[group][i].id))fail('RESPONSE_SELECTION','Keep every original '+group+' identity and its original order.');
  for(const row of rows){
   string(row.text,'Response text');string(row.comment,'Response comment',32768);
   if(!STATES.includes(row.status))fail('RESPONSE_REVIEW','Choose an explicit supplier review state.');
   string(row.reviewer,'Reviewer',4096);
   if(row.reviewedAt!==null)iso(row.reviewedAt,'Review time');
   if(row.status!=='UNREVIEWED'&&(!row.reviewer.trim()||row.reviewedAt===null))fail('RESPONSE_REVIEW','A proposed, confirmed or needs-work entry needs its named reviewer and time.');
   const refs=list(row.evidenceIds,'Attachment references',1000);if(new Set(refs).size!==refs.length)fail('RESPONSE_DUPLICATE','Attachment references must be unique.');
   for(const id of refs){if(!HASH.test(id)||attachmentIds&&!attachmentIds.has(id))fail('RESPONSE_ATTACHMENT_REFERENCE','A selected response attachment is missing: '+id);}
   if(group==='annexes'&&row.title!==original[group].find(x=>x.id===row.id).title)fail('RESPONSE_SELECTION','Keep the original annex section title.');
  }
 }
 canonical(value);return value;
}
function validateDocument(document){
 if(!plain(document)||document.schema!==DOCUMENT_SCHEMA)fail('RESPONSE_DOCUMENT','Open a complete saved response-review document.');
 nonempty(document.id,'Document identity',512);nonempty(document.title,'Document title',4096);
 validateMaster(document.master);
 if(!equal(document.binding,document.master.binding))fail('RESPONSE_BINDING','The response binding differs from the original master.');
 if(!plain(document.workshare)||document.workshare.noticeId!==document.binding.noticeId)fail('RESPONSE_WORKSHARE','Keep the complete workshare for this notice.');
 list(document.attachments,'Retained attachments',1000);list(document.merges,'Response merge history',1000);
 validateContent(document.content,document.master,new Set(document.attachments.map(a=>a.id)));return document;
}
function author(value){if(!plain(value))fail('RESPONSE_AUTHOR','Enter the complete author identity.');for(const k of ['name','organization','role'])string(value[k],'Author '+k,4096);return value;}
function editionBody(x){const {sha256,...body}=x;return body;}
async function validateAttachments(attachments,options={}){
 const rows=unique(list(attachments,'Attachments',1000),'attachment');let total=0;
 for(const a of rows){
  if(!HASH.test(a.id)||a.sha256!==a.id)fail('RESPONSE_ATTACHMENT','Attachment identity must equal its SHA256.');
  nonempty(a.name,'Attachment filename',1024);string(a.mime,'Attachment media type',512);string(a.description,'Attachment description',32768);string(a.addedBy,'Attachment author',4096);
  if(/[\\/\u0000-\u001f\u007f]/.test(a.name)||a.name==='.'||a.name==='..')fail('RESPONSE_FILENAME','Use a filename without a directory or control characters.');
  const bytes=base64Bytes(a.base64);
  if(bytes.length!==a.bytes||await digestBytes(bytes,options)!==a.sha256)fail('RESPONSE_ATTACHMENT_CHANGED','The full bytes differ for '+a.name+'.');
  total+=bytes.length;if(total>MAX_ATTACHMENTS_BYTES)fail('RESPONSE_ATTACHMENT_CAPACITY','Complete attached files are limited to 16 MiB in this response workspace.');
 }
 return rows;
}
async function createTransfer(base,options={}){
 validateDocument(base.document);nonempty(base.workspaceId,'Original workspace',512);
 if(!plain(base.record)||base.record.id!==base.document.id)fail('RESPONSE_RECORD','The native response record and document must agree.');
 const transfer={schema:TRANSFER_SCHEMA,transferId:await digest(canonical(base),options),base:clone(base),
  draft:{content:clone(base.document.content),author:{name:'',organization:'',role:''},note:''},
  attachments:clone(base.document.attachments),editions:[]};
 return validateTransfer(transfer,options);
}
async function validateTransfer(input,options={}){
 if(!plain(input)||input.schema!==TRANSFER_SCHEMA)fail('RESPONSE_TRANSFER','Open the complete response-review working file.');
 const value=clone(input);
 if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_FILE_BYTES)fail('RESPONSE_FILE_CAPACITY','The complete working file exceeds 64 MiB.');
 if(!plain(value.base)||!HASH.test(value.transferId||''))fail('RESPONSE_TRANSFER','The original saved response selection is missing.');
 validateDocument(value.base.document);nonempty(value.base.workspaceId,'Original workspace',512);
 if(!plain(value.base.record)||value.base.record.id!==value.base.document.id)fail('RESPONSE_RECORD','The native response identity differs.');
 if(await digest(canonical(value.base),options)!==value.transferId)fail('RESPONSE_BASE_CHANGED','The original saved response selection changed.');
 await validateAttachments(value.attachments,options);
 const ids=new Set(value.attachments.map(x=>x.id));
 for(const a of value.base.document.attachments){const actual=value.attachments.find(x=>x.id===a.id);if(!actual||!equal(a,actual))fail('RESPONSE_ATTACHMENT_CHANGED','Keep every original complete attachment.');}
 if(!plain(value.draft))fail('RESPONSE_DRAFT','Keep the complete draft.');
 author(value.draft.author);string(value.draft.note,'Draft note',32768);
 validateContent(value.draft.content,value.base.document.master,ids);
 const editions=list(value.editions,'Authored editions',1000);
 for(let i=0;i<editions.length;i++){
  const e=editions[i];if(!plain(e)||e.revision!==i+1)fail('RESPONSE_EDITION','Keep contiguous complete authored editions.');
  iso(e.at,'Edition time');author(e.author);nonempty(e.author.name,'Edition author',4096);string(e.note,'Edition note',32768);
  validateContent(e.content,value.base.document.master,ids);
  const chosen=list(e.attachmentIds,'Edition attachments',1000);if(new Set(chosen).size!==chosen.length||chosen.some(id=>!ids.has(id)))fail('RESPONSE_EDITION','An edition attachment is absent.');
  for(const row of [...e.content.answers,...e.content.annexes])if(row.evidenceIds.some(id=>!chosen.includes(id)))fail('RESPONSE_EDITION','An edition omits a referenced attachment.');
  if(!HASH.test(e.sha256||'')||await digest(canonical(editionBody(e)),options)!==e.sha256)fail('RESPONSE_EDITION_CHANGED','An authored edition differs from its complete digest.');
 }
 return value;
}
async function checkpoint(input,{author:identity,note='',at=new Date().toISOString(),...options}={}){
 const value=await validateTransfer(input,options);author(identity);nonempty(identity.name,'Edition author',4096);iso(at,'Edition time');string(note,'Edition note',32768);
 value.draft.author=clone(identity);value.draft.note=note;
 const body={revision:value.editions.length+1,at,author:clone(identity),note,content:clone(value.draft.content),attachmentIds:value.attachments.map(x=>x.id)};
 value.editions.push({...body,sha256:await digest(canonical(body),options)});
 return value;
}
async function serialize(input,options={}){return JSON.stringify(await validateTransfer(input,options),null,2)+'\n';}
async function attach(input,selection,options={}){
 const value=await validateTransfer(input,options),bytes=base64Bytes(selection.base64),hash=await digestBytes(bytes,options);
 const a={id:hash,sha256:hash,name:selection.name,mime:selection.mime||'application/octet-stream',bytes:bytes.length,base64:selection.base64,description:selection.description||'',addedBy:selection.addedBy||''};
 const prior=value.attachments.find(x=>x.id===hash);
 if(prior){if(prior.base64!==a.base64)fail('RESPONSE_ATTACHMENT_CHANGED','A retained digest has different bytes.');return value;}
 value.attachments.push(a);await validateAttachments(value.attachments,options);return value;
}
const pointer=x=>x.replace(/~/g,'~0').replace(/\//g,'~1');
function fields(content){
 const out=new Map();
 for(const key of ['name','organization','role','notes'])out.set('/respondent/'+key,{section:'Respondent',label:key,value:content.respondent[key]});
 for(const group of ['answers','annexes'])for(const row of content[group])for(const key of ['text','comment','status','reviewer','reviewedAt','evidenceIds'])
  out.set('/'+group+'/'+pointer(row.id)+'/'+key,{section:group==='answers'?'Response '+row.id:row.title,label:key,value:row[key]});
 return out;
}
function compareContent(baseline,current,returned){
 const a=fields(baseline),b=fields(current),c=fields(returned);
 if(a.size!==b.size||a.size!==c.size||[...a.keys()].some(k=>!b.has(k)||!c.has(k)))fail('RESPONSE_SELECTION','Compare the same complete original response selection.');
 const rows=[];
 for(const [path,item]of a){
  const x=item.value,y=b.get(path).value,z=c.get(path).value,bc=equal(x,y),br=equal(x,z),cr=equal(y,z);
  rows.push({path,section:item.section,label:item.label,baseline:clone(x),current:clone(y),returned:clone(z),
   status:bc&&br?'UNCHANGED':bc?'RETURN_ONLY':br?'CURRENT_ONLY':cr?'SAME':'CONFLICT'});
 }
 return rows;
}
function applyChoices(current,returned,comparison,choices){
 if(!plain(choices))fail('RESPONSE_CHOICES','Choose the current or returned value for every proposed change.');
 const rows=Array.isArray(comparison)?comparison:comparison.rows,values=new Map(),allowed=new Set(rows.filter(r=>['RETURN_ONLY','CONFLICT'].includes(r.status)).map(r=>r.path));
 for(const path of Object.keys(choices))if(!allowed.has(path)||!['current','returned'].includes(choices[path]))fail('RESPONSE_CHOICE','A selected field is absent or does not need a choice: '+path);
 for(const row of rows){
  if(allowed.has(row.path)&&!Object.hasOwn(choices,row.path))fail('RESPONSE_CHOICE_REQUIRED','Choose a value for '+row.section+' / '+row.label+'.');
  values.set(row.path,allowed.has(row.path)&&choices[row.path]==='returned'?row.returned:row.current);
 }
 const out=clone(current);
 for(const key of ['name','organization','role','notes'])out.respondent[key]=clone(values.get('/respondent/'+key));
 for(const group of ['answers','annexes'])for(const row of out[group])for(const key of ['text','comment','status','reviewer','reviewedAt','evidenceIds'])row[key]=clone(values.get('/'+group+'/'+pointer(row.id)+'/'+key));
 return out;
}
function resolveReviewAttribution(before,returned,selected){
 const after=clone(selected);
 const resets=[],tuple=row=>({text:row.text,evidenceIds:row.evidenceIds,status:row.status,reviewer:row.reviewer,reviewedAt:row.reviewedAt});
 for(const group of ['answers','annexes'])for(const row of after[group]){
  if(row.status==='UNREVIEWED'){
   if(row.reviewer!==''||row.reviewedAt!==null){row.reviewer='';row.reviewedAt=null;resets.push({group,id:row.id,reason:'Unreviewed content carries no completed supplier review attribution.'});}
   continue;
  }
  const current=before[group].find(x=>x.id===row.id),incoming=returned[group].find(x=>x.id===row.id);
  const actual=canonical(tuple(row));
  if(![current,incoming].some(original=>original&&canonical(tuple(original))===actual)){
   row.status='UNREVIEWED';row.reviewer='';row.reviewedAt=null;
   resets.push({group,id:row.id,reason:'The selected text, supporting evidence and review attribution do not match one complete current or returned reviewed entry.'});
  }
 }
 return {content:after,resets};
}

function markdown(document){
 validateDocument(document);
 const lines=['# '+document.title,'',document.master.responseBasis||'Response engineering draft.','',
  '## Original workshare scope','',document.master.workshareScope||'','',
  '## Respondent','',...Object.entries(document.content.respondent).map(([k,v])=>k+': '+v),'',
  'Review states and identities below are attributed supplier entries. The saved bid decision and contractual acceptance remain separate.',''];
 for(const row of document.content.answers){const original=document.master.responses.find(x=>x.id===row.id);
  lines.push('## '+original.title,'','Original coverage: '+(original.sourceRequirement?.requirement||''),'',
   '### Response',row.text,'','### Supplier review',row.status+' — '+row.reviewer+(row.reviewedAt?' — '+row.reviewedAt:''),'',row.comment,'',
   'Response workshare deliverable: '+(original.deliverable||''),'','Response workshare acceptance: '+(original.acceptance||''),'',
   ...(original.proposedPilotAcceptance?['Proposed platform/pilot criterion: '+original.proposedPilotAcceptance,'']:[]),
   'Referenced attachments: '+(row.evidenceIds.join(', ')||'None selected'),'');}
 for(const row of document.content.annexes)lines.push('## '+row.title,'',row.text,'','Supplier review: '+row.status+' — '+row.reviewer,'',row.comment,'');
 lines.push('## Original source index','');
 for(const s of document.master.sources||[])lines.push('### '+s.id+' — '+s.title,'',s.url||'','',s.summary||'','');
 lines.push('## Complete attached originals','');for(const a of document.attachments)lines.push('- '+a.name+' — '+a.bytes+' bytes; SHA256 '+a.sha256+'; '+a.description);
 return lines.join('\n')+'\n';
}
return {TRANSFER_SCHEMA,DOCUMENT_SCHEMA,MAX_ATTACHMENT_BYTES,MAX_ATTACHMENTS_BYTES,MAX_FILE_BYTES,STATES,canonical,clone,equal,
 initialContent,validateMaster,validateContent,validateDocument,validateTransfer,createTransfer,checkpoint,serialize,attach,compareContent,applyChoices,resolveReviewAttribution,markdown};
});
