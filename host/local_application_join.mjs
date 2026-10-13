#!/usr/bin/env node
// MIT. Local application-file receiving through the installed original lead CLI.
// This helper performs no network calls and contains no customer records.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const MAX_REQUEST = 7 * 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const need = (ok,message) => { if (!ok) throw new Error(message); };
const json = value => JSON.stringify(value,null,2)+'\n';
const safeId = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const relativeName = name => typeof name==='string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && name.split('/').every(part=>part && part!=='.' && part!=='..' && !/[. ]$/.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
const mediaType = name => ({json:'application/json',html:'text/html',htm:'text/html',csv:'text/csv',tsv:'text/tab-separated-values',md:'text/markdown',txt:'text/plain',js:'text/javascript',mjs:'text/javascript',cjs:'text/javascript',css:'text/css',svg:'image/svg+xml',pdf:'application/pdf',zip:'application/zip',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}[name.split('.').at(-1).toLowerCase()] || 'application/octet-stream');
export function planApplicationFiles(working,originalFiles,options,hashText){
 need(working && working.pack?.id===options.pack,'Select the already-owned original customer working record.');
 const edition=working.editions?.find(row=>row.id===options.edition);
 need(edition && !(working.withdrawals||[]).some(row=>row.edition_id===edition.id),'Choose an active original lead edition.');
 need(typeof hashText==='function','Supply the actual SHA256 function.');
 need(Array.isArray(originalFiles)&&originalFiles.length,'The complete application directory is empty.');
 const names=new Set(),desktopNames=new Set(),existing=new Map();
 for(const row of working.customer_files||[]){const name=row.document?.name;need(!existing.has(name),'Existing customer files have ambiguous names: '+name);existing.set(name,row);}
 const prefixFor=value=>value && value!=='.'?value.replace(/\/$/,'')+'/':'';
 const prefix=prefixFor(options.prefix),archivePrefix=options.archivePrefix===undefined?prefix:prefixFor(options.archivePrefix);
 for(const selected of [prefix,archivePrefix])if(selected)need(relativeName(selected.slice(0,-1)),'Choose an ordinary relative customer folder prefix.');
 const files=originalFiles.map(file=>{
  need(relativeName(file.relative),'Application filename is not portable: '+file.relative);
  const name=(file.archive?archivePrefix:prefix)+file.relative;need(name.length<=240,'Customer filename exceeds the maintained Core limit.');
  need(!names.has(name)&&!desktopNames.has(name.toLowerCase()),'Repeated or case-colliding application filename: '+name);
  names.add(name);desktopNames.add(name.toLowerCase());
  need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&/^[a-f0-9]{64}$/.test(file.sha256),'Keep exact original file identity.');
  const previous=existing.get(name),same=previous && previous.document.bytes===file.bytes && previous.document.sha256===file.sha256;
  const fileId=previous?.id || options.pack.slice(0,112)+':app:'+hashText(name).slice(0,32);
  need(safeId(fileId),'The derived file ID exceeds the original Core format.');
  const document=previous ? clone(previous.document) : {name,title:file.relative,description:options.description || 'Complete editable application, original source and operating files.',type:mediaType(name),lead_ids:edition.leads.map(row=>row.id),source_url:options.sourceUrl||''};
  delete document.content_base64;delete document.bytes;delete document.sha256;
  if(!same && options.sourceUrl)document.source_url=options.sourceUrl;
  return {id:fileId,name,relative:file.relative,path:file.path,bytes:file.bytes,sha256:file.sha256,unchanged:!!same,document,previous:previous?{id:previous.id,revision:previous.revision,sha256:previous.sha256}:null};
 });
 const fileIds=new Set(files.map(row=>row.id)),packages=(working.customer_packages||[]).filter(p=>p.edition_id===edition.id),replaced=new Set((working.customer_packages||[]).map(p=>p.supersedes).filter(Boolean));
 let previous=null;
 if(options.supersedes){previous=(working.customer_packages||[]).find(p=>p.id===options.supersedes);need(previous && previous.pack_id===options.pack,'Select the actual earlier application package in this customer.');need(!replaced.has(previous.id),'That earlier package already has a successor; select its current successor.');}
 else {
  const candidates=packages.filter(p=>!replaced.has(p.id)&&p.files.some(f=>fileIds.has(f.id)));
  need(candidates.length<=1,'Several current application packages overlap these files. Select the actual earlier package with --supersedes.');
  previous=candidates[0]||null;
 }
 if(previous)need(typeof options.reason==='string'&&options.reason.trim(),'Record the application-revision reason with --reason.');
 const batches=[];let batch=[],size=400;
 for(const file of files.filter(row=>!row.unchanged)){
  const estimated=4*Math.ceil(file.bytes/3)+JSON.stringify(file.document).length+file.id.length+400;
  need(estimated<=MAX_REQUEST,'The complete file exceeds the installed CLI request limit: '+file.name+'. Keep the original file; use the maintained retained-archive route when appropriate.');
  if(batch.length && size+estimated>MAX_REQUEST){batches.push(batch);batch=[];size=400;}
  batch.push(file);size+=estimated;
 }
 if(batch.length)batches.push(batch);
 return {files,batches,previous_package:previous?{id:previous.id,sha256:previous.sha256,files:clone(previous.files)}:null,edition_sha256:edition.sha256};
}
export function packageSelection(working,plan,options){
 const current=new Map((working.customer_files||[]).map(row=>[row.id,row]));
 const files=plan.files.map(expected=>{
  const row=current.get(expected.id);
  need(row && row.document.name===expected.name && row.document.bytes===expected.bytes && row.document.sha256===expected.sha256,'The saved file does not match the complete local source: '+expected.name);
  if(expected.unchanged)need(row.revision===expected.previous.revision&&row.sha256===expected.previous.sha256,'An unchanged file revision advanced unexpectedly: '+expected.name);
  return {id:row.id,revision:row.revision,sha256:row.sha256};
 });
 const selectedIds=new Set(files.map(row=>row.id));
 for(const reference of plan.previous_package?.files||[]){
  if(selectedIds.has(reference.id))continue;
  const row=current.get(reference.id),saved=row&&[...row.history,row].find(version=>version.revision===reference.revision&&version.sha256===reference.sha256);
  need(saved,'A member of the earlier package lost its exact saved revision: '+reference.id);
  files.push(clone(reference));selectedIds.add(reference.id);
 }
 return {id:options.packageId,pack_id:options.pack,edition_id:options.edition,title:options.title,instructions:options.instructions,files,supersedes:plan.previous_package?.id||'',reason:plan.previous_package?options.reason:''};
}
export function assertFilePredecessors(current,files){
 const index=new Map((current.customer_files||[]).map(row=>[row.id,row]));
 for(const file of files){
  const row=index.get(file.id);
  if(file.previous)need(row&&row.revision===file.previous.revision&&row.sha256===file.previous.sha256,'The original file changed concurrently: '+file.name+'. Retain this request and reconcile its original input.');
  else need(!row && !(current.customer_files||[]).some(row=>row.document.name===file.name),'A concurrent file now occupies '+file.name+'. Review it before preparing another operation.');
 }
}
export function validateFinalJoin(before,after,selection,plan){
 for(const key of Object.keys(before).filter(key=>!['sha256','customer_files','customer_packages'].includes(key)))need(JSON.stringify(before[key]??[])===JSON.stringify(after[key]??[]),'The local join changed the original '+key+' records.');
 const packet=after.customer_packages?.find(row=>row.id===selection.id);
 need(packet && packet.edition_id===selection.edition_id && packet.supersedes===(selection.supersedes||''),'The selected package successor was not retained.');
 need(JSON.stringify(packet.files)===JSON.stringify(selection.files),'The package lost its exact saved file revisions.');
 for(const old of before.customer_files||[]){
  const row=after.customer_files?.find(file=>file.id===old.id);
  need(row,'An original customer file disappeared.');
  if(row.revision===old.revision)need(JSON.stringify(row)===JSON.stringify(old),'An original file changed without a revision.');
  else {
   need(row.revision===old.revision+1,'A file advanced outside this application join.');
   need(JSON.stringify(row.history.slice(0,old.history.length))===JSON.stringify(old.history),'Original file history changed.');
   const retained=row.history.at(-1);
   need(retained.revision===old.revision&&retained.sha256===old.sha256&&JSON.stringify(retained.document)===JSON.stringify(old.document),'The complete preceding file revision was not retained.');
  }
 }
 for(const old of before.customer_packages||[])need(JSON.stringify(after.customer_packages.find(p=>p.id===old.id))===JSON.stringify(old),'An earlier package changed.');
 packageSelection(after,plan,{...selection,pack:selection.pack_id,edition:selection.edition_id,packageId:selection.id});
 return {package_id:packet.id,package_sha256:packet.sha256,files:packet.files.length,inherited_files:packet.files.length-plan.files.length,unchanged_files:plan.files.filter(f=>f.unchanged).length,changed_files:plan.files.filter(f=>!f.unchanged).length};
}
function hashBytes(bytes){return createHash('sha256').update(bytes).digest('hex');}
function writeOriginal(filename,bytes){
 const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8');
 if(fs.existsSync(filename)){need(fs.readFileSync(filename).equals(data),'Existing output has different content; preserve it: '+filename);return;}
 fs.writeFileSync(filename,data,{flag:'wx'});
}
function readJSON(filename){return JSON.parse(fs.readFileSync(filename,'utf8'));}
function inside(root,target){const relative=path.relative(root,target);return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function ordinaryDirectory(filename){const stat=fs.lstatSync(filename);need(stat.isDirectory()&&!stat.isSymbolicLink(),'Select an existing ordinary directory: '+filename);}
function walkFiles(directory){
 const out=[];
 function walk(current){
  for(const item of fs.readdirSync(current,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const file=path.join(current,item.name),stat=fs.lstatSync(file);
   need(!stat.isSymbolicLink(),'Application sources must be ordinary files, not symbolic links: '+file);
   if(stat.isDirectory())walk(file);
   else {need(stat.isFile(),'Unsupported application entry: '+file);const bytes=fs.readFileSync(file);out.push({relative:path.relative(directory,file).split(path.sep).join('/'),path:file,bytes:bytes.length,sha256:hashBytes(bytes)});}
  }
 }
 walk(directory);return out;
}
function verifyApplicationManifest(directory,files){
 const manifest=files.find(file=>file.relative==='Files.json');
 need(manifest,'Build the complete application directory first; its original Files.json is required.');
 const source=readJSON(manifest.path);need(Array.isArray(source.files)&&source.files.length,'The application manifest must retain all original members.');
 const seen=new Set(),byName=new Map(files.map(file=>[file.relative,file]));
 for(const member of source.files){
  const name=member.name??member.path;need(relativeName(name)&&!seen.has(name),'The application manifest contains a repeated or invalid member.');seen.add(name);
  const actual=byName.get(name);need(actual&&actual.bytes===member.bytes&&actual.sha256===member.sha256,'Application member differs from the built manifest: '+name);
 }
 const extras=files.filter(file=>file.relative!=='Files.json'&&!seen.has(file.relative));
 need(extras.every(file=>/\.zip$/i.test(file.relative)),'The application directory contains files outside its complete manifest. Build into a dedicated directory.');
 return {schema:source.schema,members:source.files.length,archives:extras.map(file=>file.relative)};
}
function invokeCLI(cli,args){
 const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
 if(result.error)throw result.error;
 need(result.status===0,'The installed lead CLI failed: '+String(result.stderr||result.stdout).slice(0,5000));
 try{return JSON.parse(result.stdout);}catch{throw new Error('The installed lead CLI did not return its complete JSON result.');}
}
const HELP='Local application join through the already-installed private lead CLI\n\nnode host/local_application_join.mjs --cli /authorized/commons/tools/revenue_owner_console_20261010/lead_fulfillment_cli.mjs --workspace /existing/workspace --pack PACK --edition EDITION --directory /complete/built-application --out /new/Working_Record.json --operation STABLE_ID --package-id NEW_PACKAGE --prefix Application --title "Complete application" --instructions "Open START_HERE.md and the offline editor." --source-url PUBLIC_SOURCE_URL [--archive-prefix .] [--supersedes CURRENT_PACKAGE --reason "Reviewed source revision"]\n\nNo network calls or customer-payload uploads. Every original file is read locally; exact saved Core seals select the immutable package. The original workspace must already contain the chosen customer and edition. Reuse unchanged arguments and request files to resume.\n';
function parse(argv){
 if(!argv.length||argv.includes('--help'))return {help:true};
 const names=new Set(['cli','workspace','pack','edition','directory','out','operation','package-id','prefix','title','instructions','description','source-url','supersedes','reason','archive-prefix']),options={};
 for(let i=0;i<argv.length;i+=2){const key=argv[i].replace(/^--/,'');need(argv[i].startsWith('--')&&names.has(key)&&argv[i+1]!==undefined&&!Object.hasOwn(options,key),'Use each supported named option once.');options[key]=argv[i+1];}
 for(const key of ['cli','workspace','pack','edition','directory','out','operation','package-id','title','instructions'])need(options[key],'Supply --'+key+'.');
 for(const key of ['pack','edition','operation','package-id'])need(safeId(options[key]),'Use an ordinary stable '+key+' ID.');
 need(options.operation.length<=140,'Leave room in the operation ID for complete file-batch suffixes.');
 return {...options,packageId:options['package-id'],sourceUrl:options['source-url']||'',archivePrefix:options['archive-prefix']};
}
export function runLocalApplicationJoin(argv=process.argv.slice(2)){
 const options=parse(argv);if(options.help){process.stdout.write(HELP);return;}
 const cli=path.resolve(options.cli),directory=path.resolve(options.directory),workspace=path.resolve(options.workspace),out=path.resolve(options.out),stateDirectory=out+'.join';
 need(fs.lstatSync(cli).isFile(),'Choose the actual installed lead CLI.');
 ordinaryDirectory(directory);ordinaryDirectory(workspace);ordinaryDirectory(path.dirname(out));
 need(!inside(directory,out)&&!inside(directory,stateDirectory),'Keep receiving outputs outside the source application directory.');
 const files=walkFiles(directory),manifest=verifyApplicationManifest(directory,files);
 for(const file of files)file.archive=manifest.archives.includes(file.relative);
 const inputs={...options,cli,directory,workspace,out,source_files:files.map(({relative,bytes,sha256})=>({relative,bytes,sha256})),application_manifest:manifest};
 const fingerprint=hashBytes(Buffer.from(json(inputs)));
 need(!fs.existsSync(out)||fs.existsSync(path.join(stateDirectory,'Input.json')),'The output already exists outside this saved operation. Preserve it and select a new output filename.');
 if(!fs.existsSync(stateDirectory))fs.mkdirSync(stateDirectory);
 ordinaryDirectory(stateDirectory);need(!fs.existsSync(path.join(stateDirectory,'Concurrent_Change.json')),'This local join recorded a concurrent change. Preserve its requests and reconcile with the original owner before preparing a new operation.');writeOriginal(path.join(stateDirectory,'Input.json'),json({...inputs,fingerprint}));
 const completed=path.join(stateDirectory,'Completed.json');
 if(fs.existsSync(completed)){const saved=readJSON(completed);need(saved.input_sha256===fingerprint&&fs.existsSync(out),'Retain the completed original output.');need(hashBytes(fs.readFileSync(out))===saved.working_record.sha256,'Completed working record bytes changed.');need(fs.existsSync(saved.customer_package.path)&&hashBytes(fs.readFileSync(saved.customer_package.path))===saved.customer_package.sha256,'Completed customer package bytes changed.');return saved;}
 const call=(args,label)=>{
  const result=invokeCLI(cli,args),content=json(result);
  let target=path.join(stateDirectory,label+'.json'),attempt=1;
  while(fs.existsSync(target)){
   if(fs.readFileSync(target,'utf8')===content)return result;
   target=path.join(stateDirectory,label+'-attempt-'+String(++attempt).padStart(3,'0')+'.json');
  }
  writeOriginal(target,content);return result;
 };
 const verifyRoot=(requestPath,expected)=>{
  const prepared=readJSON(requestPath).expected_root_sha256;
  if(prepared!==expected){
   writeOriginal(path.join(stateDirectory,'Concurrent_Change.json'),json({request_path:requestPath,reviewed_root_sha256:expected,prepared_root_sha256:prepared}));
   throw new Error('The workspace changed during preparation. No apply was issued for this request. Preserve the saved inputs and reconcile the current source with its owner.');
  }
 };
 const snapshot=label=>{
  const state=call(['state','--workspace',workspace,'--pack',options.pack],label+'-state');
  need(/^[a-f0-9]{64}$/.test(state.root_sha256),'The installed CLI must return the current original workspace seal.');
  const target=path.join(stateDirectory,label+'-'+state.root_sha256+'.json');
  if(!fs.existsSync(target))call(['export','--workspace',workspace,'--pack',options.pack,'--format','working-record','--out',target],label+'-export');
  return {root_sha256:state.root_sha256,working:readJSON(target)};
 };
 const beforePath=path.join(stateDirectory,'Before.json');
 if(!fs.existsSync(beforePath))call(['export','--workspace',workspace,'--pack',options.pack,'--format','working-record','--out',beforePath],'Before-export');
 const before=readJSON(beforePath),plan=planApplicationFiles(before,files,options,text=>hashBytes(Buffer.from(text,'utf8')));
 writeOriginal(path.join(stateDirectory,'Plan.json'),json(plan));
 for(let index=0;index<plan.batches.length;index++){
  const suffix=String(index+1).padStart(3,'0'),inputPath=path.join(stateDirectory,'Files-'+suffix+'.json'),requestPath=path.join(stateDirectory,'Files-'+suffix+'-Request.json');
  const input={pack_id:options.pack,files:plan.batches[index].map(file=>({id:file.id,source_path:file.path,document:file.document}))};
  writeOriginal(inputPath,json(input));
  const checked=fs.existsSync(requestPath)?null:snapshot('Before-files-'+suffix);
  if(checked)assertFilePredecessors(checked.working,plan.batches[index]);
  call(['prepare-customer-files','--workspace',workspace,'--source',inputPath,'--operation',options.operation+':files-'+suffix,'--out',requestPath],'Files-'+suffix+'-Prepare');
  if(checked)verifyRoot(requestPath,checked.root_sha256);
  call(['apply','--workspace',workspace,'--request',requestPath],'Files-'+suffix+'-Apply');
 }
 const selectionPath=path.join(stateDirectory,'Package_Selection.json'),packageRequest=path.join(stateDirectory,'Package_Request.json');
 const checked=fs.existsSync(packageRequest)?null:snapshot('Before-package');
 const selection=checked?packageSelection(checked.working,plan,options):readJSON(selectionPath);
 writeOriginal(selectionPath,json(selection));
 call(['prepare-customer-package','--workspace',workspace,'--source',selectionPath,'--operation',options.operation+':package','--out',packageRequest],'Package-prepare');
 if(checked)verifyRoot(packageRequest,checked.root_sha256);
 call(['apply','--workspace',workspace,'--request',packageRequest],'Package-apply');
 call(['export','--workspace',workspace,'--pack',options.pack,'--format','working-record','--out',out],'Working-record-export');
 const joined=validateFinalJoin(before,readJSON(out),selection,plan),packageZip=path.join(stateDirectory,'Complete_Customer_Package.zip');
 call(['export','--workspace',workspace,'--pack',options.pack,'--package-id',options.packageId,'--format','customer-package-zip','--out',packageZip],'Customer-package-export');
 const result={input_sha256:fingerprint,pack_id:options.pack,edition_id:options.edition,...joined,working_record:{path:out,bytes:fs.statSync(out).size,sha256:hashBytes(fs.readFileSync(out))},customer_package:{path:packageZip,bytes:fs.statSync(packageZip).size,sha256:hashBytes(fs.readFileSync(packageZip))},request_directory:stateDirectory};
 writeOriginal(completed,json(result));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=runLocalApplicationJoin();if(result)process.stdout.write(json(result));}
 catch(error){process.stderr.write('Local application join: '+error.message+'\n');process.exitCode=1;}
}
