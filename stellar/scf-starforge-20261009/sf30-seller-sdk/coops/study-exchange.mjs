// MIT. Complete study deliveries and returned-file comparison reuse native immutable exports.
import {open,readFile,readdir,lstat,rm,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {jsonBytes,stable,privateDirectory} from '../stellar-expert/store.mjs';
import {materializeExport,retainedExport,tableProjection} from './exports.mjs';
import {studyDigest,studyEditions,iterateStudyRows,STUDY_LIMITS} from './study.mjs';
import {fault,text,hashBytes} from './provider.mjs';
import {SOURCE_CONTRACT} from './schema.mjs';
const MAX=STUDY_LIMITS.returnBytes,CHUNK=STUDY_LIMITS.chunkBytes,ROW_MAX=2*1024*1024,PART_MAX=16*1024*1024;
const key=s=>hashBytes(Buffer.from(s)).slice(0,24);
const csvCell=value=>{const s=String(value??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=value=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value);
export function exportId(identity,part){return 'export-'+key(identity+':'+part);}
function fileItem(id,study,createdAt,format,name,type){
 return{id,kind:'study',studyId:study.id,studyRevision:study.revision,studySha256:study.sha256,format,name,type,createdAt};
}
function freshCounts(study){return{rows:0,populatedNumericValues:0,unavailableValues:0,byMember:study.selection.members.map(m=>({memberId:m.id,editionId:m.editionId,stationId:m.stationId,rows:0,populatedNumericValues:0,unavailableValues:0,quality:{}}))};}
function countRow(counts,memberId,row){
 const target=counts.byMember.find(m=>m.memberId===memberId),valid=!['missing','null'].includes(row.valueType)&&numeric(row.value);
 for(const c of [counts,target]){c.rows++;c[valid?'populatedNumericValues':'unavailableValues']++;}
 const raw=row.quality||'not_reported',q=raw.length<=100&&(Object.hasOwn(target.quality,raw)||Object.keys(target.quality).length<128)?raw:'other_original_quality';target.quality[q]=(target.quality[q]??0)+1;if(q!==raw)target.qualitySummaryLimited=true;
}
async function tableFile(store,{id,study,createdAt,format}){
 const {columns,project}=tableProjection(study.selection.mapping,study.selection.table),counts=freshCounts(study);
 const item=fileItem(exportId(id,format),study,createdAt,format,'coastal-study-'+id.slice(-12)+'.'+format,format==='csv'?'text/csv; charset=utf-8':'application/x-ndjson; charset=utf-8');
 return materializeExport(store,item,async function*(){
  if(format==='csv')yield columns.map(csvCell).join(',')+'\r\n';
  for await(const {memberId,row} of iterateStudyRows(store,study)){
   countRow(counts,memberId,row);const selected=project(row);
   yield format==='csv'?columns.map(c=>csvCell(selected[c])).join(',')+'\r\n':JSON.stringify(selected)+'\n';
  }
 },{result:async()=>({columns,counts,order:'Ordered study members, then original response and row order. No global sort or interpolation.'})});
}
function sourceRecords(editions){
 const result=new Map();
 for(const edition of editions.values())for(const [kind,list] of [['accepted',edition.pages],['failed',edition.failedResponses??[]]])for(let i=0;i<list.length;i++){
  const r=list[i],old=result.get(r.sha256);
  if(old&&old.bytes!==r.bytes)throw fault('COOPS_STUDY_SOURCE_CHANGED','The original response digest has conflicting size metadata.',409);
  const item=old??{path:'sources/'+r.sha256+'.response',sha256:r.sha256,bytes:r.bytes,uses:[]};
  item.uses.push({editionId:edition.id,kind,index:i,receipt:r});result.set(r.sha256,item);
 }
 return [...result.values()];
}
function tarHeader(name,size){
 if(Buffer.byteLength(name)>100||!Number.isSafeInteger(size)||size<0||size>MAX)throw fault('COOPS_STUDY_ARCHIVE','A selected source member cannot be represented in the bounded archive.');
 const b=Buffer.alloc(512),put=(s,o,n)=>b.write(s,o,n,'ascii'),oct=(n,w)=>n.toString(8).padStart(w-1,'0')+'\0';
 put(name,0,100);put(oct(0o600,8),100,8);put(oct(0,8),108,8);put(oct(0,8),116,8);
 put(oct(size,12),124,12);put(oct(0,12),136,12);b.fill(32,148,156);put('0',156,1);
 put('ustar\0',257,6);put('00',263,2);put('coastal',265,32);put('coastal',297,32);
 let sum=0;for(const c of b)sum+=c;put(sum.toString(8).padStart(6,'0')+'\0 ',148,8);return b;
}
async function* archiveFile(name,descriptor,source){
 yield tarHeader(name,descriptor.bytes);const digest=createHash('sha256');let bytes=0;
 for await(const value of source()){const part=Buffer.from(value);bytes+=part.length;if(bytes>descriptor.bytes)throw fault('COOPS_STUDY_SOURCE_CHANGED','A selected archive member grew while being copied.',409);digest.update(part);yield part;}
 if(bytes!==descriptor.bytes||digest.digest('hex')!==descriptor.sha256)throw fault('COOPS_STUDY_SOURCE_CHANGED','A selected archive member differs from its pinned bytes.',409);
 const pad=(512-bytes%512)%512;if(pad)yield Buffer.alloc(pad);
}
function reportDocument(study,review,counts){
 const s=study.selection;
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+html(s.name)+'</title><style>body{font:16px/1.5 system-ui;margin:2rem auto;max-width:80rem;padding:0 1rem;color:#202020}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;text-align:left;padding:.45rem;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}h1{font-size:2rem}.pin{overflow-wrap:anywhere}small{color:#444}</style><h1>'+html(s.name)+'</h1><p>'+html(s.project)+'</p><p>'+html(s.question)+'</p><p><b>Responsible team:</b> '+html(s.owner)+'</p><p class="pin">Study '+html(study.id)+' · revision '+study.revision+' · '+html(study.sha256)+'</p><h2>Selected source and quantities</h2><p>'+html(s.method)+'</p><p>'+counts.rows+' rows; '+counts.populatedNumericValues+' populated numeric values; '+counts.unavailableValues+' values absent, null, empty or otherwise nonnumeric. These are selected returned-row counts, not a completeness claim.</p><div class="scroll"><table><thead><tr><th>Station / member</th><th>Selected period / products</th><th>Native basis</th><th>Source outcome</th><th>Selected rows / populated values</th></tr></thead><tbody>'+
  s.members.map(m=>{const c=counts.byMember.find(c=>c.memberId===m.id);return'<tr><td>'+html(m.stationId)+' · '+html(m.stationName)+'<br><small class="pin">'+html(m.id)+'</small></td><td>'+html(m.selection.beginDate)+' → '+html(m.selection.endDate)+'<br>'+html(m.selection.products.join(', '))+'</td><td>'+html(m.basis.datum)+' / '+html(m.basis.units)+' / '+html(m.basis.timeZone)+'</td><td>'+(m.sourceComplete?'All selected requests have a recorded outcome':'Unfinished selected source requests')+'<br>'+m.unavailableRequests.length+' unavailable requests</td><td>'+c.rows+' / '+c.populatedNumericValues+'</td></tr>';}).join('')+
  '</tbody></table></div><h2>Review</h2><p>'+html(review.actor)+' · '+html(review.createdAt)+' · '+html(review.status)+'</p><p>'+html(review.note)+'</p><ul>'+s.warnings.map(w=>'<li>'+html(w.message)+'</li>').join('')+'</ul><h2>Receiving convention</h2><p>'+html(s.mapping.name)+' · revision '+s.mapping.revision+'</p><p>'+html(s.mapping.note)+'</p><pre>'+html(JSON.stringify(s.mapping.columns,null,2))+'</pre><h2>Reopen the source delivery</h2><p>Keep the TAR archive and delivery manifest with the CSV or JSONL. The archive includes each selected complete edition, original response bodies, original mapping input when supplied, the reviewed study, this report and both model-input files. The original source station datums and epochs remain separately attributable. Values from different stations have not been converted to a common vertical surface.</p><p>Import CSV columns as text to preserve identifiers, numerical lexical precision and empty values. JSONL carries the same original strings and explicit valueType. Neither format evaluates spreadsheet formulas.</p><details><summary>Complete study selection and source evidence</summary><pre>'+html(JSON.stringify(study,null,2))+'</pre></details><details><summary>Actual source contract</summary><pre>'+html(JSON.stringify(SOURCE_CONTRACT,null,2))+'</pre></details></html>';
}
export async function writeStudyRelease(store,{id,study,review,createdAt}){
 const editions=await studyEditions(store,study),csv=await tableFile(store,{id,study,createdAt,format:'csv'}),jsonl=await tableFile(store,{id,study,createdAt,format:'jsonl'});
 if(stable(csv.result)!==stable(jsonl.result))throw fault('COOPS_STUDY_EXPORT_CHANGED','The two complete row exports disagree on their pinned projection.',409);
 const records=sourceRecords(editions),files=[csv,jsonl],small=[],add=(path,value)=>{const bytes=Buffer.isBuffer(value)?value:jsonBytes(value);small.push({path,bytes:bytes.length,sha256:hashBytes(bytes),body:bytes});};
 add('study.json',study);add('review.json',review);add('mapping.json',study.selection.mapping);
 for(const e of editions.values())add('editions/'+e.id+'.json',e);
 const mappingSource=study.selection.mapping.sourceFile;
 if(mappingSource){const bytes=await store.object(mappingSource.sha256);if(bytes.length!==mappingSource.bytes)throw fault('COOPS_STUDY_MAPPING_CHANGED','The original mapping input differs from its selected byte count.',409);add('mapping-original.json',bytes);}
 const report=await materializeExport(store,fileItem(exportId(id,'report'),study,createdAt,'report','coastal-study-'+id.slice(-12)+'.html','text/html; charset=utf-8'),async function*(){yield reportDocument(study,review,csv.result.counts);});files.push(report);
 const archiveMembers=[...small.map(({body,...r})=>r),...records.map(({uses,...r})=>r),...files.map(f=>({path:f.format==='report'?'review.html':'model-input.'+f.format,bytes:f.bytes,sha256:f.sha256,exportId:f.id}))];
 const manifest={schema:'stellar-forge.coops-study-delivery.v1',id,createdAt,studyId:study.id,studyRevision:study.revision,studySha256:study.sha256,
  review,columns:csv.result.columns,mapping:study.selection.mapping,selection:study.selection.members,
  counts:csv.result.counts,sourceResponses:records,files:archiveMembers,source:SOURCE_CONTRACT,
  receiving:'The selected CSV or JSONL is compared by exact editionId, recordId, sourcePageSha256 and sourceRecord. Returned rows may be reordered. No NOAA source is replaced by a receiving decision.',
  packageScope:'Complete original source editions and all their accepted/failed response bodies, not a claim that every requested measurement exists.'};
 const manifestRaw=jsonBytes(manifest),manifestDescriptor={path:'manifest.json',bytes:manifestRaw.length,sha256:hashBytes(manifestRaw)};
 const manifestFile=await materializeExport(store,fileItem(exportId(id,'manifest'),study,createdAt,'manifest','coastal-study-'+id.slice(-12)+'.manifest.json','application/json; charset=utf-8'),async function*(){yield manifestRaw;});files.push(manifestFile);
 const archive=await materializeExport(store,fileItem(exportId(id,'archive'),study,createdAt,'source-archive','coastal-study-'+id.slice(-12)+'.tar','application/x-tar'),async function*(){
  yield* archiveFile('manifest.json',manifestDescriptor,async function*(){yield manifestRaw;});
  for(const f of small)yield* archiveFile(f.path,f,async function*(){yield f.body;});
  for(const f of records)yield* archiveFile(f.path,f,async function*(){yield await store.object(f.sha256);});
  for(const f of [csv,jsonl,report]){const original=await retainedExport(store,f);yield* archiveFile(f.format==='report'?'review.html':'model-input.'+f.format,f,original.stream);}
  yield Buffer.alloc(1024);
 });
 files.push(archive);
 return{schema:'stellar-forge.coops-study-release.v1',id,studyId:study.id,studyRevision:study.revision,studySha256:study.sha256,createdAt,
  study:structuredClone(study),review:structuredClone(review),manifest,manifestSha256:manifestFile.sha256,files,counts:csv.result.counts};
}
export function uploadStart(release,input,id,createdAt){
 if(!['csv','jsonl'].includes(input.format)||!release.files.some(f=>f.format===input.format))throw fault('COOPS_STUDY_RETURN','Select the corresponding released CSV or JSONL.');
 const filename=text(input.filename,'the original returned filename',255);
 if(/[\\/\x00-\x1f\x7f]/.test(filename)||!filename.toLowerCase().endsWith('.'+input.format))throw fault('COOPS_STUDY_RETURN','Keep one returned filename with the selected CSV or JSONL extension.');
 if(!Number.isSafeInteger(input.bytes)||input.bytes<0||input.bytes>MAX)throw fault('COOPS_STUDY_RETURN','The returned file must fit the 1 GiB bounded intake.');
 return{id,releaseId:release.id,studyId:release.studyId,studyRevision:release.studyRevision,studySha256:release.studySha256,
  format:input.format,filename,bytes:input.bytes,createdAt,note:text(input.note??'','the returned-file source note',12000,true),chunks:[],state:'RECEIVING',receivedBytes:0};
}
export function chunkInput(input){
 if(typeof input.base64!=='string'||!input.base64.length||input.base64.length>Math.ceil(CHUNK/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw fault('COOPS_STUDY_CHUNK','Supply one canonical base64 chunk of at most 1 MiB.');
 const bytes=Buffer.from(input.base64,'base64');
 if(bytes.toString('base64')!==input.base64||bytes.length>CHUNK||!Number.isSafeInteger(input.offset)||input.offset<0||input.offset%CHUNK)throw fault('COOPS_STUDY_CHUNK','Use the exact file chunk and its original 1 MiB boundary.');
 return{bytes,descriptor:{offset:input.offset,bytes:bytes.length,sha256:hashBytes(bytes)}};
}
export function retainChunk(upload,descriptor){
 if(descriptor.offset+descriptor.bytes>upload.bytes||descriptor.bytes!==Math.min(CHUNK,upload.bytes-descriptor.offset))throw fault('COOPS_STUDY_CHUNK','The chunk differs from the selected original file size.');
 const existing=upload.chunks.find(c=>c.offset===descriptor.offset);
 if(existing&&stable(existing)!==stable(descriptor))throw fault('COOPS_STUDY_RETURN_CHANGED','The selected file differs from the retained chunk. Preserve this intake and start a separate return for the changed file.',409);
 if(!existing&&upload.state!=='RECEIVING')throw fault('COOPS_STUDY_RETURN_SEALED','This returned file is sealed for its original comparison. Reopen that operation.',409);
 if(!existing){if(descriptor.offset!==upload.receivedBytes)throw fault('COOPS_STUDY_CHUNK_ORDER','Resume at the original next offset.',409);upload.chunks.push(descriptor);upload.receivedBytes+=descriptor.bytes;}
 return{id:upload.id,state:upload.state,receivedBytes:upload.receivedBytes,bytes:upload.bytes,nextOffset:upload.receivedBytes};
}
async function returnedFile(store,{upload,release,createdAt}){
 if(upload.receivedBytes!==upload.bytes||upload.chunks.reduce((n,c)=>n+c.bytes,0)!==upload.bytes)throw fault('COOPS_STUDY_RETURN_INCOMPLETE','Retain every original file chunk before comparing this return.',409);
 const identity=studyDigest({releaseId:release.id,format:upload.format,filename:upload.filename,bytes:upload.bytes,chunks:upload.chunks});
 return materializeExport(store,{...fileItem(exportId(upload.id,'original'),release.study,createdAt,'returned-'+upload.format,upload.filename,upload.format==='csv'?'text/csv; charset=utf-8':'application/x-ndjson; charset=utf-8'),uploadId:upload.id,releaseId:release.id,chunkManifestSha256:identity},async function*(){
  let offset=0;for(const c of upload.chunks){if(c.offset!==offset)throw fault('COOPS_STUDY_RETURN_INCOMPLETE','The returned file has a missing chunk.',409);const bytes=await store.object(c.sha256);if(bytes.length!==c.bytes)throw fault('COOPS_STUDY_RETURN_CHANGED','A retained file chunk changed.',409);yield bytes;offset+=bytes.length;}
 });
}
async function* texts(source){
 const decoder=new TextDecoder('utf-8',{fatal:true});try{for await(const b of source)yield decoder.decode(b,{stream:true});const tail=decoder.decode();if(tail)yield tail;}catch(e){if(e instanceof TypeError)throw fault('COOPS_RETURN_FORMAT','The returned file is not complete valid UTF-8.');throw e;}
}
async function* csvRecords(source){
 let row=[],field='',mode=0,skipLF=false,first=true,active=false,recordSize=0;
 for await(let text of texts(source)){
  if(first&&text.length){first=false;if(text.charCodeAt(0)===0xfeff)text=text.slice(1);}
  for(const c of text){
   if(skipLF){skipLF=false;if(c==='\n')continue;}
   if((recordSize+=Buffer.byteLength(c))>ROW_MAX)throw fault('COOPS_RETURN_FORMAT','One returned CSV record exceeds 2 MiB.');
   if(mode===1){active=true;if(c==='"')mode=2;else field+=c;}
   else if(mode===2){
    if(c==='"'){field+='"';mode=1;}else if(c===','){row.push(field);field='';mode=0;active=true;}
    else if(c==='\n'||c==='\r'){row.push(field);yield row;row=[];field='';mode=0;active=false;recordSize=0;skipLF=c==='\r';}
    else throw fault('COOPS_RETURN_FORMAT','A quoted CSV value has text after its closing quote.');
   }else if(c==='"'){if(field)throw fault('COOPS_RETURN_FORMAT','A CSV quote occurs inside an unquoted value.');mode=1;active=true;}
   else if(c===','){row.push(field);field='';active=true;}
   else if(c==='\n'||c==='\r'){row.push(field);yield row;row=[];field='';active=false;recordSize=0;skipLF=c==='\r';}
   else {field+=c;active=true;}
   if(field.length>ROW_MAX||row.length>64)throw fault('COOPS_RETURN_FORMAT','One returned CSV record exceeds its declared field/column limit.');
  }
 }
 if(mode===1)throw fault('COOPS_RETURN_FORMAT','The returned CSV ends inside a quoted field.');
 if(active||row.length||field){row.push(field);yield row;}
}
function jsonStrings(line){
 if(Buffer.byteLength(line)>ROW_MAX)throw fault('COOPS_RETURN_FORMAT','One returned JSONL record exceeds 2 MiB.');
 let i=0;const ws=()=>{while(/[ \t\r]/.test(line[i]??'\u0000'))i++;};
 function string(){
  if(line[i]!=='"')throw fault('COOPS_RETURN_FORMAT','Returned JSONL keys and values must be original JSON strings.');
  const begin=i++;let escaped=false;
  while(i<line.length){const c=line[i++];if(!escaped&&c==='"'){try{return JSON.parse(line.slice(begin,i));}catch{break;}}if(!escaped&&c==='\\')escaped=true;else escaped=false;}
  throw fault('COOPS_RETURN_FORMAT','A returned JSONL string is incomplete or invalid.');
 }
 ws();if(line[i++]!=='{')throw fault('COOPS_RETURN_FORMAT','Every returned JSONL row must be one object.');ws();
 const entries=[],keys=new Set();
 if(line[i]!=='}')for(;;){const k=string();if(keys.has(k))throw fault('COOPS_RETURN_FORMAT','A returned JSONL row repeats a column.');keys.add(k);ws();if(line[i++]!==':')throw fault('COOPS_RETURN_FORMAT','A returned JSONL object is malformed.');ws();const v=string();entries.push([k,v]);ws();if(line[i]!==',')break;i++;ws();}
 if(line[i++]!=='}')throw fault('COOPS_RETURN_FORMAT','A returned JSONL object is malformed.');ws();if(i!==line.length)throw fault('COOPS_RETURN_FORMAT','A returned JSONL row has trailing content.');
 return Object.fromEntries(entries);
}
async function* mappedRows(source,format,columns){
 if(format==='csv'){
  let index=0;
  for await(const record of csvRecords(source)){
   if(index++===0){if(stable(record)!==stable(columns))throw fault('COOPS_RETURN_FORMAT','The returned CSV headings/order differ from the exact released mapping. Review a new mapping separately.');continue;}
   if(record.length!==columns.length)throw fault('COOPS_RETURN_FORMAT','Returned CSV record '+index+' does not match its original headings.');
   yield Object.fromEntries(columns.map((c,i)=>[c,record[i]]));
  }
  if(!index)throw fault('COOPS_RETURN_FORMAT','The returned CSV has no complete original header.');
 }else{
  let pending='',first=true;
  for await(let part of texts(source)){
   if(first&&part.length){first=false;if(part.charCodeAt(0)===0xfeff)part=part.slice(1);}
   pending+=part;let at;
   while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line.trim())throw fault('COOPS_RETURN_FORMAT','A returned JSONL row is blank.');const row=jsonStrings(line);if(Object.keys(row).length!==columns.length||columns.some(c=>!Object.hasOwn(row,c)))throw fault('COOPS_RETURN_FORMAT','The returned JSONL columns differ from the exact released mapping.');yield row;}
   if(Buffer.byteLength(pending)>ROW_MAX)throw fault('COOPS_RETURN_FORMAT','One returned JSONL record exceeds 2 MiB.');
  }
  if(pending){const row=jsonStrings(pending);if(Object.keys(row).length!==columns.length||columns.some(c=>!Object.hasOwn(row,c)))throw fault('COOPS_RETURN_FORMAT','The returned JSONL columns differ from the exact released mapping.');yield row;}
 }
}
async function appendPrivate(path,bytes){
 const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
 try{let offset=0;while(offset<bytes.length){const r=await file.write(bytes,offset,bytes.length-offset);if(!r.bytesWritten)throw fault('COOPS_STUDY_WRITE','The comparison writer stopped.',507);offset+=r.bytesWritten;}}finally{await file.close();}
}
async function partitionRows(root,tag,selected,format,columns,keyColumns){
 const buckets=new Map(),sizes=new Map();let rows=0;
 const flush=async p=>{const value=buckets.get(p);if(!value)return;await appendPrivate(join(root,tag+'-'+p+'.jsonl'),Buffer.from(value));buckets.delete(p);};
 for await(const row of mappedRows(selected.stream(),format,columns)){
  const values=keyColumns.map(c=>row[c]);if(values.some(v=>typeof v!=='string'||!v.length||Buffer.byteLength(v)>2048))throw fault('COOPS_RETURN_IDENTITY','A returned row omits an original source identity column.');
  const id=stable(values),part=hashBytes(Buffer.from(id)).slice(0,2),line=JSON.stringify([id,row])+'\n',bytes=Buffer.byteLength(line);
  sizes.set(part,(sizes.get(part)??0)+bytes);if(sizes.get(part)>PART_MAX)throw fault('COOPS_RETURN_PARTITION','A comparison identity partition exceeds 16 MiB. Retain this return and select a smaller study window for complete comparison.');
  buckets.set(part,(buckets.get(part)??'')+line);if(Buffer.byteLength(buckets.get(part))>=65536)await flush(part);rows++;
 }
 for(const part of buckets.keys())await flush(part);return{rows,parts:[...sizes.keys()]};
}
async function partitionMap(path){
 let text;try{text=await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return new Map();throw e;}
 if(Buffer.byteLength(text)>PART_MAX)throw fault('COOPS_RETURN_PARTITION','A comparison partition changed size.',409);
 const map=new Map();for(const line of text.split('\n'))if(line){const [key,row]=JSON.parse(line);const group=map.get(key)??[];group.push(row);map.set(key,group);}return map;
}

async function comparisonScratch(store,id,upload){
 // This namespace belongs to the original reserved finish operation. The native
 // writer lease plus the operation map prevents a concurrent comparison owner.
 const operation=store.read().operations[upload.finishingOperationId];
 if(operation?.action!=='study.return.finish'||operation.payload.uploadId!==upload.id||operation.context?.upload?.id!==upload.id)
  throw fault('COOPS_STUDY_RETURN_OWNER','Resume the original retained finish operation before using its comparison workspace.',409);
 const root=await privateDirectory(join(store.root,'exports','.study-return-'+id),{create:true});
 const entries=await readdir(root),owned=[];
 for(const name of entries){
  if(!/^(before|after)-[a-f0-9]{2}\.jsonl$/.test(name))throw fault('COOPS_STUDY_RETURN_OWNER','An unrecognized comparison file is preserved for inspection.',409);
  const path=join(root,name),s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o077)||typeof process.getuid==='function'&&s.uid!==process.getuid())
   throw fault('COOPS_STUDY_RETURN_OWNER','A comparison file changed ownership or type; preserve it.',409);
  owned.push(path);
 }
 for(const path of owned)await unlink(path);
 return root;
}

export async function compareStudyReturn(store,{id,upload,release,createdAt}){
 const original=release.files.find(f=>f.format===upload.format),returned=await returnedFile(store,{upload,release,createdAt}),columns=release.manifest.columns,
  fields=release.manifest.mapping.columns,keyColumns=['editionId','recordId','sourcePageSha256','sourceRecord'].map(k=>fields.find(c=>c.source===k)?.heading);
 if(keyColumns.some(c=>!c))throw fault('COOPS_STUDY_MAPPING_PIN','The original release lacks its complete identity mapping.',409);
 const summary={schema:'stellar-forge.coops-study-return-comparison.v1',id,uploadId:upload.id,releaseId:release.id,studyId:release.studyId,studyRevision:release.studyRevision,
  studySha256:release.studySha256,createdAt,original:{id:original.id,bytes:original.bytes,sha256:original.sha256},returned:{id:returned.id,filename:upload.filename,bytes:returned.bytes,sha256:returned.sha256},
  mapping:release.manifest.mapping,keyColumns,valid:false,complete:false,counts:{unchanged:0,changed:0,added:0,missing:0,ambiguous:0},expectedRows:null,returnedRows:null,examples:[],errors:[],
  method:'Exact mapped strings, grouped by original editionId/recordId/sourcePageSha256/sourceRecord. Reordering is allowed; duplicate identities remain ambiguous. A returned change is receiving evidence, not a NOAA source correction.'};
 let temporary=null,exampleBytes=0;
 const comparisonItem={...fileItem(exportId(id,'comparison'),release.study,createdAt,'comparison','coastal-study-return-'+id.slice(-12)+'.jsonl','application/x-ndjson; charset=utf-8'),
  returnId:id,releaseId:release.id,originalSha256:original.sha256,returnedSha256:returned.sha256};
 const comparison=await materializeExport(store,comparisonItem,async function*(){
  temporary=await comparisonScratch(store,id,upload);
  try{
   const before=await retainedExport(store,original),after=await retainedExport(store,returned);
   let a,b;
   try{a=await partitionRows(temporary,'before',before,upload.format,columns,keyColumns);summary.expectedRows=a.rows;
    b=await partitionRows(temporary,'after',after,upload.format,columns,keyColumns);summary.returnedRows=b.rows;}
   catch(error){
    if(!['COOPS_RETURN_FORMAT','COOPS_RETURN_IDENTITY','COOPS_RETURN_PARTITION'].includes(error.code))throw error;
    summary.errors.push({code:error.code,message:error.message});yield JSON.stringify({kind:'unresolved_return',error:summary.errors[0]})+'\n';return;
   }
   for(const part of [...new Set([...a.parts,...b.parts])].sort()){
    const left=await partitionMap(join(temporary,'before-'+part+'.jsonl')),right=await partitionMap(join(temporary,'after-'+part+'.jsonl'));
    for(const identity of [...new Set([...left.keys(),...right.keys()])].sort()){
     const beforeRows=left.get(identity)??[],afterRows=right.get(identity)??[];let change;
     if(beforeRows.length>1||afterRows.length>1)change={kind:'ambiguous',identity:JSON.parse(identity),before:beforeRows,after:afterRows};
     else if(!beforeRows.length)change={kind:'added',identity:JSON.parse(identity),after:afterRows[0]};
     else if(!afterRows.length)change={kind:'missing',identity:JSON.parse(identity),before:beforeRows[0]};
     else{
      const changes=columns.filter(c=>beforeRows[0][c]!==afterRows[0][c]).map(column=>({column,before:beforeRows[0][column],after:afterRows[0][column]}));
      change=changes.length?{kind:'changed',identity:JSON.parse(identity),changes,before:beforeRows[0],after:afterRows[0]}:{kind:'unchanged',identity:JSON.parse(identity)};
     }
     summary.counts[change.kind]++;const line=JSON.stringify(change);if(change.kind!=='unchanged'&&summary.examples.length<50&&exampleBytes+Buffer.byteLength(line)<=256*1024){summary.examples.push(change);exampleBytes+=Buffer.byteLength(line);}else if(change.kind!=='unchanged')summary.examplesLimited=true;yield line+'\n';
    }
    for(const tag of ['before','after'])await unlink(join(temporary,tag+'-'+part+'.jsonl')).catch(e=>{if(e.code!=='ENOENT')throw e;});
   }
   summary.valid=true;summary.complete=true;
  }finally{await rm(temporary,{recursive:true,force:true});temporary=null;}
 },{result:async()=>summary});
 const retained=comparison.result;
 if(!retained||retained.id!==id||retained.returned.sha256!==returned.sha256)throw fault('COOPS_STUDY_RETURN_RECEIPT','The retained comparison result differs from this original return.',409);
 const summaryFile=await materializeExport(store,fileItem(exportId(id,'summary'),release.study,createdAt,'return-summary','coastal-study-return-'+id.slice(-12)+'.json','application/json; charset=utf-8'),async function*(){yield jsonBytes({...retained,comparisonSha256:comparison.sha256,comparisonExportId:comparison.id});});
 return{id,schema:'stellar-forge.coops-study-return.v1',uploadId:upload.id,releaseId:release.id,studyId:release.studyId,studyRevision:release.studyRevision,studySha256:release.studySha256,
  createdAt,filename:upload.filename,format:upload.format,original:returned,comparisonSha256:comparison.sha256,comparisonExportId:comparison.id,summary:retained,files:[returned,comparison,summaryFile]};
}
