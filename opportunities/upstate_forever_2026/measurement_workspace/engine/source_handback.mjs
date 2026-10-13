/** Complete, immutable scientist handbacks, owned by the original Measurements workspace. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {crc32} from 'node:zlib';
import {hash,stable} from './normalise.mjs';
import {InputError} from './parse.mjs';
import {installLargeFileReads} from './large_intake.mjs';
import {MeasurementWorkspace} from './workspace.mjs';
import {zipMembers} from './collection_zip.mjs';
import {buildSourceHandback,returnedTable,handbackCsv,HANDBACK_FORMAT} from './source_handback_core.mjs';
import {textWorkbook} from './source_handback_xlsx.mjs';
installLargeFileReads(MeasurementWorkspace);
const json=v=>JSON.stringify(v,null,2)+'\n';
const identity=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=(v,m,status=409)=>{if(!v)throw new InputError(m,status);};
const root=w=>path.join(w.directory,'source-handbacks');
const safeName=name=>{need(typeof name==='string'&&name.length>0&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[:\x00-\x1f\x7f]/.test(p)),'Invalid handback member name',400);return name;};
const fileRoot=(w,id)=>{need(identity(id),'Invalid handback identity',400);return path.join(root(w),id);};
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function selection(input,publish=false){
 need(input&&typeof input==='object'&&!Array.isArray(input),'Choose the original handback selection',400);
 const allowed=new Set(['expectedRevision','sourceIds','exportIds',...(publish?['previewSha256','title','note']:[])]);
 for(const key of Object.keys(input))need(allowed.has(key),'Unknown handback field: '+key,400);
 need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,'Choose the inspected workspace revision',400);
 for(const key of ['sourceIds','exportIds'])need(Array.isArray(input[key]??[])&&(input[key]||[]).every(x=>typeof x==='string'&&x)&&new Set(input[key]||[]).size===(input[key]||[]).length,'Choose distinct original '+key,400);
 need(input.sourceIds?.length,'Choose at least one original source',400);
 const out={expectedRevision:input.expectedRevision,sourceIds:[...input.sourceIds],exportIds:[...(input.exportIds||[])]};
 if(publish){need(identity(input.previewSha256),'Inspect the whole source return before publishing',400);
  need(typeof input.title==='string'&&input.title.trim()&&input.title.length<=240,'Name this return within 240 characters',400);
  need(typeof input.note==='string'&&input.note.length<=12000,'Return note must be text within 12,000 characters',400);
  Object.assign(out,{previewSha256:input.previewSha256,title:input.title,note:input.note});
 }
 return out;
}
function snapshot(w,request){const value=w.fullSnapshot({expected_revision:request.expectedRevision});return {...value,nativeDomainBound:w.nativeDomain!==null};}
function viewOf(s,input){const view=buildSourceHandback(s,input);return {...view,previewSha256:hash(stable(view))};}
export function previewHandback(w,input){const request=selection(input);return viewOf(snapshot(w,request),request);}
function manifests(w){const dir=root(w);if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(identity).map(id=>readManifest(w,id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
export function handbackCatalog(w){
 const value=w.readConsistent(()=>{const summary=w.summary();return {revision:summary.revision,sources:summary.imports.map(x=>({id:x.id,label:x.label,kind:x.kind,sha:x.sha,summary:x.summary})),results:w.db.prepare('SELECT id,kind,revision,created_at AS createdAt FROM exports ORDER BY created_at DESC').all()};});
 return {...value,editions:manifests(w)};
}
function requestId(request){return hash(stable({format:HANDBACK_FORMAT,request}));}
function checkManifest(m){
 need(m?.format===HANDBACK_FORMAT&&identity(m.id)&&m.requestFingerprint===m.id,'Unknown source return manifest');
 const request=selection(m.selection,true);need(requestId(request)===m.id&&m.revision===request.expectedRevision&&m.title===request.title&&m.note===request.note,'Handback selection differs from its identity');
 need(typeof m.createdAt==='string'&&Number.isFinite(Date.parse(m.createdAt))&&Array.isArray(m.files),'Incomplete return manifest');
 const names=new Set();for(const f of m.files){safeName(f.name);need(f.name!=='manifest.json'&&!names.has(f.name)&&identity(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0,'Invalid retained member');names.add(f.name);}
 for(const name of ['project.json','native-context.json','source-return.json','README.md','report.html'])need(names.has(name),'Complete return is missing '+name);
 return m;
}
export function readManifest(w,id){
 try{const m=checkManifest(readJSON(path.join(fileRoot(w,id),'manifest.json')));need(m.id===id,'Return identity differs');return m;}
 catch(e){if(e.code==='ENOENT')throw new InputError('Saved source return not found',404);throw e;}
}
export function handbackMember(w,id,name){
 safeName(name);const manifest=readManifest(w,id);
 if(name==='manifest.json')return {data:Buffer.from(json(manifest)),type:'application/json'};
 const member=manifest.files.find(x=>x.name===name);need(member,'Source return member not found',404);
 const data=fs.readFileSync(path.join(fileRoot(w,id),name));need(data.length===member.bytes&&hash(data)===member.sha256,'Retained source return member changed: '+name);
 const type=name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.json')?'application/json':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/octet-stream';
 return {data,type};
}
export function readHandbackView(w,id){const value=JSON.parse(handbackMember(w,id,'source-return.json').data);const m=readManifest(w,id);need(value.previewSha256===m.selection.previewSha256,'Returned view differs from its manifest');return value;}
export function handbackBundle(w,id){
 const m=readManifest(w,id),members=m.files.map(f=>({name:f.name,data:handbackMember(w,id,f.name).data}));
 members.push({name:'manifest.json',data:Buffer.from(json(m))});const data=zipMembers(members);
 return {filename:'source-return-'+id.slice(0,16)+'.zip',bytes:data.length,sha256:hash(data),contentBase64:data.toString('base64')};
}
function companions(w,selected){
 const dir=path.join(w.directory,'collections'),out=[];if(!fs.existsSync(dir))return out;
 for(const id of fs.readdirSync(dir).filter(identity)){
  const base=path.join(dir,id);if(!fs.existsSync(path.join(base,'complete.json')))continue;
  const doc=readJSON(path.join(base,'collection.json'));need(hash(stable(doc))===id,'Retained source collection changed');
  if(!doc.files.some(f=>selected.includes(f.importId)))continue;
  out.push({name:'collections/'+id+'/collection.json',data:Buffer.from(json(doc))});
  // Retain the entire selected collection, including original workbooks and companion files.
  for(const f of doc.files){const name=safeName(f.path),data=fs.readFileSync(path.join(base,'sources',name));need(data.length===f.bytes&&hash(data)===f.sha256,'Original collection member changed: '+name);
   out.push({name:'collections/'+id+'/sources/'+name,data});}
 }
 return out;
}
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function report(view,request,sourceFiles,workbook){
 const sources=view.sources.map((s,i)=>'<tr><td>'+escape(s.label)+'</td><td>'+s.counts.rows+'</td><td>'+s.counts.linkedRows+'</td><td>'+s.counts.rejectedRows+'</td><td>'+s.counts.unmatchedRows+'</td><td><a href="'+sourceFiles[i].originalPath+'">Original</a> · <a href="'+sourceFiles[i].returnedPath+'">Returned CSV</a> · <a href="'+sourceFiles[i].rowsPath+'">Complete rows</a></td></tr>').join('');
 const records=view.records.map(r=>'<tr><td>'+escape(r.stationId)+'<br><code>'+escape(r.sourceResultId||r.id)+'</code></td><td>'+escape(r.sampledDate)+'<br>'+escape(r.sampledAt)+'<br>'+escape(r.timeZone)+'</td><td>'+escape(r.characteristic)+'<br>'+escape(r.basis)+' / '+escape(r.fraction)+'</td><td>'+escape(r.reportedValue)+' '+escape(r.reportedUnit)+'</td><td>'+escape(r.value??'')+' '+escape(r.unit)+'<br>'+escape(r.censor)+' ['+escape(r.lower??'')+', '+escape(r.upper??'')+']</td><td>'+escape(r.mapping?.reachId||'Unassigned')+'</td><td>'+escape(r.review.state)+'<br>'+escape(r.eligible.reasons.join(', ')||'Eligible measured input')+'</td></tr>').join('');
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(request.title)+'</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#222;background:#fff}main{max-width:1280px;margin:auto;padding:24px}h1{font-size:28px;line-height:1.25}h2{font-size:20px;margin-top:28px}a{color:inherit;text-decoration:underline}p{max-width:90ch;white-space:pre-wrap}table{border-collapse:collapse;width:100%;min-width:750px}th,td{padding:10px;border:1px solid #ccc;text-align:left;vertical-align:top}th{background:#eee}code{overflow-wrap:anywhere}.scroll{overflow:auto}small{color:#555}@media(max-width:600px){main{padding:14px}h1{font-size:24px}}</style><main><h1>'+escape(request.title)+'</h1><p>'+escape(request.note)+'</p><p>Measurements revision '+view.revision+' · '+view.counts.sourceRows+' source rows · '+view.counts.records+' native records · '+view.counts.savedResults+' selected saved results.</p><p>'+(workbook?'<a href="returned-workbook.xlsx">Open returned workbook</a> · ':'')+'<a href="source-return.json">Complete row return</a> · <a href="project.json">Editable native project</a> · <a href="README.md">Working instructions</a></p><p>Original files remain unchanged. Return columns contain the current native review, mapping and eligibility. Selected saved results retain their own original revision. Workbook values are literal text; CSV formula-like fields carry an apostrophe for safe spreadsheet opening.</p><h2>Original sources and complete returns</h2><div class="scroll"><table><thead><tr><th>Source</th><th>Rows</th><th>Linked</th><th>Rejected</th><th>Unmatched</th><th>Files</th></tr></thead><tbody>'+sources+'</tbody></table></div><h2>Native measurements and reviews</h2><div class="scroll"><table><thead><tr><th>Station / result</th><th>Source date / time</th><th>Constituent</th><th>Reported</th><th>Normalized / bounds</th><th>Reach</th><th>Review / eligibility</th></tr></thead><tbody>'+records+'</tbody></table></div><h2>Saved scientific results</h2><ul>'+view.results.map((r,i)=>'<li><a href="results/'+i+'.json">'+escape(r.kind)+'</a> · original revision '+r.revision+' · '+escape(r.id)+'</li>').join('')+'</ul></main></html>';
}
function buildMembers(w,s,view,request){
 const members=[],add=(name,data)=>members.push({name:safeName(name),data:Buffer.isBuffer(data)?data:Buffer.from(data)}),sourceFiles=[],tables=[];
 add('project.json',json(s.portable));add('native-context.json',json({revision:s.revision,total:s.total,records:s.records,summary:s.summary,nativeDomainBound:s.nativeDomainBound}));add('source-return.json',json(view));
 for(let i=0;i<view.sources.length;i++){const source=view.sources[i],original=s.portable.tables.imports.find(x=>x.id===source.id),stem=String(i+1).padStart(3,'0')+'-'+source.id.slice(0,12);
  const paths={id:source.id,label:source.label,sha256:source.sha256,originalPath:'originals/'+stem+(source.kind==='usgs-daily'?'.geojson':'.csv'),returnedPath:'returns/'+stem+'.csv',rowsPath:'returns/'+stem+'.json'};
  need(hash(original.content)===source.sha256,'Retained original source changed: '+source.label);
  add(paths.originalPath,original.content);const table=returnedTable(source);tables.push({...table,label:source.label});add(paths.returnedPath,handbackCsv(table));add(paths.rowsPath,json(source));sourceFiles.push(paths);
 }
 for(let i=0;i<view.results.length;i++)add('results/'+i+'.json',json(view.results[i]));
 if(w)for(const item of companions(w,request.sourceIds))add(item.name,item.data);
 let workbook=null,workbookNote='';
 try{const value=textWorkbook(tables);add('returned-workbook.xlsx',value.data);workbook=value.sheets;}catch(e){if(!(e instanceof InputError))throw e;workbookNote=e.message;}
 const instructions='# '+request.title+'\n\n'+request.note+'\n\n## Open and use this return\n\nOpen report.html for the complete source inventory and native reviews. returned-workbook.xlsx keeps original columns first and appends current native review/result columns. All workbook cells are literal text, preserving leading zeros, source dates, timezone strings and formula text. Individual returns/*.csv contain the same rows. Spreadsheet-formula-like CSV cells are prefixed with an apostrophe; the unchanged originals and exact row JSON retain the original strings. Malformed surplus cells are retained in explicit extra columns. Blank source rows and rejected/unmatched rows remain visible.\n\nEach selected source is retained byte-for-byte under originals/. All members of its retained source collection, including companion workbooks, formulas, merged cells and cached values, remain unchanged under collections/. The returned workbook is a separate review file; original workbook cells are never rewritten.\n\nsource-return.json and returns/*.json retain complete row identities, original values, native records, reviews, eligibility, rejection reasons and saved-result associations. Results/*.json keep complete saved results with their original workspace revision, input, temporal support, rationale and assumptions. No result is recalculated or annualized by this return operation.\n\n## Continue scientific work\n\nproject.json is the complete original Measurements portable project, including all original imports and their reviews. Reopen it through the existing Measurements receive operation into an empty native Measurements workspace. It may include other imports needed for the original complete project. native-context.json retains the complete corresponding native display and domain context. Use the original mapping/review/calculation controls for scientific changes.\n\nTo reopen this exact return on another installation, use Receive returned ZIP in Source returns, or the source-handback-receive CLI. Receiving a return retains its self-contained edition without replacing the current scientific project. Original companions and this edition can be inspected independently.\n\nThis edition pins measurements revision '+view.revision+'. Current eligibility and a selected older saved result can differ because the result keeps its own revision. Discrete sample concentration and daily-flow pairing retain their original support; native annual model loads remain separate. Source dates/timezones, censoring, constituents, fractions, units and review choices are not inferred by the exporter.\n\n'+(workbookNote?'## Workbook capacity\n\n'+workbookNote+'\n':'');
 add('README.md',instructions);add('report.html',report(view,request,sourceFiles,workbook));
 return {members,sourceFiles,workbook,workbookNote};
}
function publishMembers(w,manifest,members){
 fs.mkdirSync(root(w),{recursive:true});const target=fileRoot(w,manifest.id);
 if(fs.existsSync(path.join(target,'manifest.json')))return readManifest(w,manifest.id);
 const stage=fs.mkdtempSync(path.join(root(w),'.build-'));
 try{for(const {name,data}of [...members,{name:'manifest.json',data:Buffer.from(json(manifest))}]){const file=path.join(stage,safeName(name));fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  try{fs.renameSync(stage,target);}catch(e){if(!fs.existsSync(path.join(target,'manifest.json')))throw e;const old=readManifest(w,manifest.id);need(stable(old.selection)===stable(manifest.selection),'A different return occupies this identity');}
  return readManifest(w,manifest.id);
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
export function publishHandback(w,input){
 const request=selection(input,true),id=requestId(request);
 if(fs.existsSync(path.join(fileRoot(w,id),'manifest.json')))return readManifest(w,id);
 const s=snapshot(w,request),view=viewOf(s,request);need(view.previewSha256===request.previewSha256,'Original source view changed after inspection. Preview it again.');
 const built=buildMembers(w,s,view,request),manifest={format:HANDBACK_FORMAT,id,requestFingerprint:id,revision:s.revision,createdAt:new Date().toISOString(),title:request.title,note:request.note,selection:request,counts:view.counts,sources:built.sourceFiles,workbook:built.workbook,workbookNote:built.workbookNote,files:built.members.map(m=>({name:m.name,bytes:m.data.length,sha256:hash(m.data)}))};
 return publishMembers(w,checkManifest(manifest),built.members);
}
/** Only the exact ordinary stored ZIP emitted above is accepted; no path extraction or executable processing. */
function storedMembers(data){
 const end=data.length-22;need(end>=0&&data.readUInt32LE(end)===0x06054b50&&data.readUInt16LE(end+20)===0,'Choose the complete original source-return ZIP');
 const count=data.readUInt16LE(end+10),centralSize=data.readUInt32LE(end+12),centralOffset=data.readUInt32LE(end+16);
 need(data.readUInt16LE(end+4)===0&&data.readUInt16LE(end+6)===0&&data.readUInt16LE(end+8)===count&&centralOffset+centralSize===end,'Unsupported ZIP layout');
 const members=new Map();let pos=0,central=centralOffset;
 for(let i=0;i<count;i++){
  need(pos+30<=centralOffset&&data.readUInt32LE(pos)===0x04034b50&&data.readUInt16LE(pos+6)===0x0800&&data.readUInt16LE(pos+8)===0,'Use the original uncompressed source return');
  const size=data.readUInt32LE(pos+18),raw=data.readUInt32LE(pos+22),n=data.readUInt16LE(pos+26),extra=data.readUInt16LE(pos+28),checksum=data.readUInt32LE(pos+14),start=pos+30+n+extra;
  need(size===raw&&extra===0&&start+size<=centralOffset,'Incomplete ZIP member');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(pos+30,pos+30+n));safeName(name);need(!members.has(name),'Duplicate ZIP member');
  const body=data.subarray(start,start+size);need(crc32(body)===checksum,'ZIP member checksum differs');
  need(central+46<=end&&data.readUInt32LE(central)===0x02014b50&&data.readUInt16LE(central+8)===0x0800&&data.readUInt16LE(central+10)===0&&data.readUInt32LE(central+16)===checksum&&data.readUInt32LE(central+20)===size&&data.readUInt32LE(central+24)===raw&&data.readUInt16LE(central+28)===n&&data.readUInt16LE(central+30)===0&&data.readUInt16LE(central+32)===0&&data.readUInt32LE(central+42)===pos&&central+46+n<=end&&data.subarray(central+46,central+46+n).equals(data.subarray(pos+30,pos+30+n)),'ZIP directory differs from original members');
  members.set(name,body);pos=start+size;central+=46+n;
 }
 need(pos===centralOffset&&central===end,'ZIP contains unaccounted bytes');return members;
}
function validateNativeContext(project,context){
 need(Number.isSafeInteger(project?.revision)&&context?.revision===project.revision&&Array.isArray(context.records)&&Array.isArray(context.summary?.reaches)&&typeof context.nativeDomainBound==='boolean','Retain the complete native revision and display context');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'source-return-native-'));let received;
 try{
  if(context.nativeDomainBound)fs.writeFileSync(path.join(directory,'reaches.json'),json(context.summary.reaches));
  received=new MeasurementWorkspace(directory);
  // Existing original receive validates source parsing, IDs, source-line links and native tables.
  received.receive(project);
  const actual=received.fullSnapshot();
  need(stable(actual.records)===stable(context.records)&&actual.total===context.total,'Returned native record views differ from their original project');
  const left={...actual.summary},right={...context.summary};delete left.revision;delete right.revision;
  need(stable(left)===stable(right),'Returned source/domain summary differs from its original project');
 }finally{try{received?.close();}finally{fs.rmSync(directory,{recursive:true,force:true});}}
}
export function receiveHandbackBytes(w,data){
 const members=storedMembers(data);need(members.has('manifest.json'),'Complete source return manifest is missing');
 const m=checkManifest(JSON.parse(members.get('manifest.json')));need(members.size===m.files.length+1,'Source return contains unlisted or missing files');
 for(const f of m.files){const b=members.get(f.name);need(b&&b.length===f.bytes&&hash(b)===f.sha256,'Source return file differs: '+f.name);}
 const project=JSON.parse(members.get('project.json')),context=JSON.parse(members.get('native-context.json')),returned=JSON.parse(members.get('source-return.json'));
 validateNativeContext(project,context);
 const rebuilt=viewOf({...context,portable:project},m.selection);need(rebuilt.previewSha256===m.selection.previewSha256&&stable(rebuilt)===stable(returned),'Returned rows differ from their complete native sources');
 need(Array.isArray(m.sources)&&stable(m.sources.map(x=>x.id))===stable(rebuilt.sourceIds),'Return source inventory differs');
 const generated=buildMembers(null,{...context,portable:project},rebuilt,m.selection);
 need(stable(m.sources)===stable(generated.sourceFiles)&&stable(m.workbook)===stable(generated.workbook)&&m.workbookNote===generated.workbookNote&&stable(m.counts)===stable(rebuilt.counts),'Return inventory or workbook definition differs');
 const allowed=new Set(generated.members.map(x=>x.name));
 for(const x of generated.members)need(members.get(x.name)?.equals(x.data),'Derived return file differs from its original native values: '+x.name);
 for(const f of m.files)if(!allowed.has(f.name))need(/^collections\/[a-f0-9]{64}\/(collection\.json|sources\/.+)$/.test(f.name),'Unknown extra return member');
 const collectionIds=[...new Set(m.files.filter(f=>f.name.startsWith('collections/')).map(f=>f.name.split('/')[1]))];
 for(const id of collectionIds){const prefix='collections/'+id+'/',docBytes=members.get(prefix+'collection.json');need(docBytes,'Original collection manifest is absent');const doc=JSON.parse(docBytes);need(hash(stable(doc))===id&&Array.isArray(doc.files)&&doc.files.some(f=>rebuilt.sourceIds.includes(f.importId)),'Original collection does not belong to selected sources');
  const expected=new Set([prefix+'collection.json']);for(const f of doc.files){const name=prefix+'sources/'+safeName(f.path),b=members.get(name);need(b&&b.length===f.bytes&&hash(b)===f.sha256,'Original companion file differs');expected.add(name);}
  for(const f of m.files.filter(f=>f.name.startsWith(prefix)))need(expected.has(f.name),'Unlisted original companion file');
 }
 for(const s of m.sources){const source=project.tables.imports.find(x=>x.id===s.id),b=members.get(s.originalPath);need(source&&b&&hash(b)===source.sha&&b.equals(Buffer.from(source.content)),'Original source bytes differ in returned edition');}
 return publishMembers(w,m,m.files.map(f=>({name:f.name,data:members.get(f.name)})));
}
export function receiveHandback(w,input){
 need(typeof input?.contentBase64==='string'&&input.contentBase64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)&&identity(input.sha256),'Receive the complete ZIP and its checksum',400);
 const data=Buffer.from(input.contentBase64,'base64');need(data.toString('base64')===input.contentBase64,'Returned ZIP encoding is not canonical',400);need(hash(data)===input.sha256,'Returned ZIP checksum differs');return receiveHandbackBytes(w,data);
}
export function handbackOperation(w,method,parts,query,body={}){
 if(parts.length===0&&method==='GET')return handbackCatalog(w);
 if(parts.length===0&&method==='POST')return publishHandback(w,body);
 if(parts.length===1&&parts[0]==='preview'&&method==='POST')return previewHandback(w,body);
 if(parts.length===1&&parts[0]==='receive'&&method==='POST')return receiveHandback(w,body);
 if(parts.length===1&&method==='GET')return readManifest(w,parts[0]);
 if(parts.length===2&&parts[1]==='view'&&method==='GET')return readHandbackView(w,parts[0]);
 if(parts.length===2&&parts[1]==='bundle'&&method==='GET')return handbackBundle(w,parts[0]);
 throw new InputError('Source return operation not found',404);
}
