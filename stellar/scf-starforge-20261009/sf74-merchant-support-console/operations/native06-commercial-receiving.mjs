// MIT. Full same-case receiving of the already completed BC08 native06 merchant.
// This program opens retained sources; it never starts a seller, buyer or provider.
import {readFile,mkdir,lstat,rename,open,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname,isAbsolute,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const OPERATION='BC08-SF74-NATIVE06-COMMERCIAL-RECEIVING-20261012';
const ORIGINAL_OPERATION='BC08-SF97-COSTS-JOINED-20261012-06';
const ORIGINAL_REPORT_OPERATION='SCF-MERCHANT-ROUTE-COST-DECISIONS-20261011-BC08';
const ORIGINAL_BACKUP_SHA='df938ab5a61d87a9871934b487dcda5e5b12b79b3f4a02ffd46ca2e409c2a81d';
const ORIGINAL_REPORT_SHA='541fe36fbd691c3c5ced478cda2dd995ea10218b488fa821e33d7d41518a02cd';
const ORIGINAL_NATIVE_SHA='22ec17eab5f5dc34d70e57a114be36df55eaa4d164e4b01bda03038fce20d9cb';
const PLAN='fef5feec-4448-4d13-a12a-ae9bafc554ce';
const VERSION='7f9e6154-7292-4fbf-acf0-cc6e4e4aea94';
const COST='ad6626eb-53bd-4743-90e0-2aad92cb69fe';
const SUPPLIER='572bd78b-18d9-4b54-a112-85b952694bf0';
const IDS={
  "senderCase": "92a69038-6b0b-4daa-9cd3-5900e3d37687",
  "backup": "8af67d85-70c1-42c2-a141-1a8486092146",
  "pricingAttach": "0a534a83-406d-4e77-b29f-23c659286581",
  "backupAttach": "2eaa681d-01a4-4a47-9a5f-15f6d2f3c610",
  "planUpdate": "21ee1add-7501-45e9-b6e8-ba5e8fcdbb97",
  "sourceReport": "21c3db93-aca7-411e-9648-acb8066584c8",
  "draftSave": "bbb26f45-ba44-4c28-b5d7-152b79e17e76",
  "technicalReceiving": "b17d9399-e7c7-487c-9332-c72f049c364a",
  "technicalMaterial": "52283c18-b93a-4c26-882b-3316d286ed34",
  "receiverEdit": "7a7bc725-a383-4af0-a890-f378b3ba87b0",
  "receiverExport": "bcdc3ab4-3999-4c92-ae49-f9e368c93434",
  "saveTasks": "1ae8f05f-83c0-4aea-a655-f03459497d3c",
  "quotePublish": "c8c2f7c6-1e67-4384-80e3-62f2e641955f",
  "senderExport": "28d955a4-74b8-457b-9053-6f568f7ed0fd",
  "packageReceive": "d8272c6e-3a59-41ac-a9fa-0c3767c7ed68",
  "completeTasks": "b50c4ab3-57e3-4d99-b86a-c23c3a2cd529"
};
const ACTOR='BC08 original native06 quotation receiver';
const TASKS=[
 {id:'operator-native06-scope',title:'Retain the original native06 merchant scope and selected quotation',
  acceptance:'The selected plan, pricing version, original supplier quote, observed route identities and complete backup remain exact. The saved quotation uses original selected monthly volumes and USD valuations.'},
 {id:'operator-native06-case-delivery',title:'Receive the complete original case and source history',
  acceptance:'The original native case package manifest and every retained file are checked by the existing receiver. Original quote and sender case identity survive import and later local case edits.'},
 {id:'operator-native06-pricing-restore',title:'Restore the original pricing and cost workspace independently',
  acceptance:'The received archive reopens the same plan, scenario, version and cost edition. All original supplier bytes and source bindings match. A subsequent original receiving retry preserves the receiver’s saved local edit.'},
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b,label)=>{if(canonical(a)!==canonical(b))throw Object.assign(new Error(label),{code:'RECEIVING_ORIGINAL_CHANGED'});};
const ensure=(ok,message,code='RECEIVING_OPERATION')=>{if(!ok)throw Object.assign(new Error(message),{code});};
const absolute=(p,label)=>{ensure(typeof p==='string'&&isAbsolute(p)&&resolve(p)===p&&p!=='/','Use an absolute normalized '+label);return p;};
async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);ensure(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0,'Use an owned private directory: '+path);return path;}
async function optional(path){try{return await readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function syncDirectory(path){const h=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await h.sync();}finally{await h.close();}}
async function savedJson(path,value){
 const bytes=encoded(value),previous=await optional(path);
 if(previous){equal(JSON.parse(previous),value,'Retained request differs: '+path);return JSON.parse(previous);}
 await privateDirectory(dirname(path));const tmp=path+'.writing-'+randomUUID();let h;
 try{
  h=await open(tmp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;
  try{await link(tmp,path);}catch(error){if(error.code!=='EEXIST')throw error;equal(JSON.parse(await readFile(path)),value,'Concurrent retained request differs');}
  await syncDirectory(dirname(path));
 }finally{await h?.close().catch(()=>{});await unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return value;
}
async function checkpoint(path,value){const tmp=path+'.writing-'+randomUUID();let h;try{h=await open(tmp,'wx',0o600);await h.writeFile(encoded(value));await h.sync();await h.close();h=null;await rename(tmp,path);await syncDirectory(dirname(path));}finally{await h?.close().catch(()=>{});}}
async function checkedFile(path,expected){const s=await lstat(path);ensure(s.isFile()&&!s.isSymbolicLink(),'Use an original regular file');const b=await readFile(path);equal({bytes:b.length,sha256:sha(b)},expected,'Original input changed: '+path);return b;}
function descriptor(path,bytes){return {path,bytes:bytes.length,sha256:sha(bytes)};}
async function requestAt(root,name,make){const path=join(root,'requests',name+'.json'),prior=await optional(path);return prior?JSON.parse(prior):savedJson(path,await make());}
async function reportAt(root,name,value){const path=join(root,'reports',name+'.json');const prior=await optional(path);if(prior)return JSON.parse(prior);return savedJson(path,value);}
async function child(command,args,options={}){return new Promise((resolveChild,reject)=>{const p=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options});let out='',err='';p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',s=>{out+=s;if(out.length>4*1024*1024)p.kill('SIGTERM');});p.stderr.on('data',s=>{err+=s;if(err.length>4*1024*1024)p.kill('SIGTERM');});p.on('error',reject);p.on('close',(code,signal)=>code===0?resolveChild({stdout:out,stderr:err}):reject(Object.assign(new Error('Original child did not complete: '+(err||out).slice(-12000)),{code:'RECEIVING_CHILD',exitCode:code,signal})));});}
async function wholeArchive(base,output,python,environment){
 const script="import hashlib,json,os,stat,sys,uuid,zipfile\nfrom pathlib import Path\nbase=Path(sys.argv[1]); target=Path(sys.argv[2]); receipt=Path(str(target)+'.json')\nSCHEMA='stellar-forge.native06-commercial-operating-files.v1'\nOPERATION='BC08-SF74-NATIVE06-COMMERCIAL-RECEIVING-20261012'\ndef digest(path):\n    h=hashlib.sha256()\n    with path.open('rb') as f:\n        for b in iter(lambda:f.read(262144),b''): h.update(b)\n    return h.hexdigest()\ndef regular(path):\n    s=path.lstat()\n    if not stat.S_ISREG(s.st_mode): raise RuntimeError('Expected an original regular file: '+str(path))\n    return s\ndef inventory():\n    files=[]\n    for p in sorted(base.rglob('*')):\n        rel=p.relative_to(base).as_posix()\n        if rel.split('/')[0] in ('browser-tmp','source') or rel=='DELIVERY.json': continue\n        s=p.lstat()\n        if stat.S_ISLNK(s.st_mode): raise RuntimeError('Do not package a private-state symlink: '+rel)\n        if stat.S_ISDIR(s.st_mode): continue\n        if not stat.S_ISREG(s.st_mode): raise RuntimeError('Unsupported operating file: '+rel)\n        files.append({'path':rel,'bytes':s.st_size,'sha256':digest(p)})\n    if not any(r['path']=='RESULT.json' for r in files): raise RuntimeError('Complete result is missing')\n    return files\nfiles=inventory()\nmanifest={'schema':SCHEMA,'operation':OPERATION,'files':files}\ndef inspect(path):\n    regular(path)\n    with zipfile.ZipFile(path,'r') as z:\n        members=z.infolist(); names=[r.filename for r in members]\n        expected=[r['path'] for r in files]+['OPERATING-FILES.json']\n        if len(names)!=len(set(names)) or set(names)!=set(expected): raise RuntimeError('Complete archive file set changed')\n        info=z.getinfo('OPERATING-FILES.json')\n        if info.file_size>32*1024*1024: raise RuntimeError('Archive manifest is too large')\n        if json.loads(z.read(info))!=manifest: raise RuntimeError('Archive original-file manifest changed')\n        for row in files:\n            info=z.getinfo(row['path'])\n            if info.file_size!=row['bytes'] or info.is_dir(): raise RuntimeError('Archive original-file length changed: '+row['path'])\n            h=hashlib.sha256(); total=0\n            with z.open(info) as f:\n                for b in iter(lambda:f.read(262144),b''):\n                    total+=len(b); h.update(b)\n                    if total>row['bytes']: raise RuntimeError('Archive member exceeds its original length')\n            if total!=row['bytes'] or h.hexdigest()!=row['sha256']: raise RuntimeError('Archive original bytes changed: '+row['path'])\n    return {'schema':'stellar-forge.native06-commercial-operating-archive.v1','path':str(target),\n            'bytes':path.stat().st_size,'sha256':digest(path),'files':len(files)+1}\ndef sync_directory(path):\n    d=os.open(path,os.O_RDONLY|os.O_DIRECTORY)\n    try: os.fsync(d)\n    finally: os.close(d)\ndef retain_receipt(value):\n    body=(json.dumps(value,indent=2)+'\\n').encode()\n    if receipt.exists():\n        regular(receipt)\n        if json.loads(receipt.read_bytes())!=value: raise RuntimeError('Original archive receipt changed')\n        return\n    tmp=receipt.with_name(receipt.name+'.writing.'+uuid.uuid4().hex)\n    try:\n        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\n        with os.fdopen(fd,'wb') as f: f.write(body);f.flush();os.fsync(f.fileno())\n        try: os.link(tmp,receipt)\n        except FileExistsError:\n            regular(receipt)\n            if json.loads(receipt.read_bytes())!=value: raise RuntimeError('Concurrent archive receipt differs')\n        sync_directory(receipt.parent)\n    finally:\n        try: tmp.unlink()\n        except FileNotFoundError: pass\ntarget.parent.mkdir(parents=True,exist_ok=True,mode=0o700)\nparent=target.parent.lstat()\nif not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid() or parent.st_mode&0o077: raise RuntimeError('Use an owned private archive directory')\nif target.exists() or target.is_symlink():\n    result=inspect(target);retain_receipt(result);print(json.dumps(result));sys.exit(0)\n# A completed staging archive is recoverable after a lost atomic-publication response.\n# Incomplete staging files remain preserved; the original source files are never removed.\ntemporary=None\nfor candidate in sorted(target.parent.glob(target.name+'.writing.*')):\n    try: inspect(candidate)\n    except (zipfile.BadZipFile,EOFError,RuntimeError,ValueError): continue\n    temporary=candidate;break\nif temporary is None:\n    temporary=target.with_name(target.name+'.writing.'+uuid.uuid4().hex)\n    with zipfile.ZipFile(temporary,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:\n        for row in files: z.write(base/row['path'],row['path'])\n        z.writestr('OPERATING-FILES.json',json.dumps(manifest,indent=2)+'\\n')\n    os.chmod(temporary,0o600)\n    with temporary.open('rb') as f: os.fsync(f.fileno())\n    inspect(temporary)\ntry: os.link(temporary,target)\nexcept FileExistsError: inspect(target)\nsync_directory(target.parent)\nresult=inspect(target);retain_receipt(result)\ntemporary.unlink();sync_directory(target.parent)\nprint(json.dumps(result))\n";
 const r=await child(python,['-c',script,base,output],{env:environment});return JSON.parse(r.stdout);
}
async function verifiedSource(root,expected){
 ensure(/^[0-9a-f]{64}$/.test(expected??''),'Pin the complete literal source manifest SHA-256');
 const bytes=await readFile(join(root,'SOURCE-MANIFEST.json'));ensure(sha(bytes)===expected,'The complete source manifest differs');
 const manifest=JSON.parse(bytes);ensure(manifest.schema==='stellar-forge.native06-commercial-source-manifest.v1'&&Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=10000,'Use the complete source file manifest');
 const seen=new Set(),parents=new Set();
 for(const row of manifest.files){
  ensure(typeof row.path==='string'&&row.path&&!row.path.includes('\\')&&!row.path.includes('\0')&&!row.path.startsWith('/')&&row.path.split('/').every(x=>x&&x!=='.'&&x!=='..')&&!seen.has(row.path),'Invalid or duplicate source path');seen.add(row.path);
  const path=join(root,row.path);let parent=dirname(path);
  while(parent===root||parent.startsWith(root+sep)){if(parents.has(parent))break;const st=await lstat(parent);ensure(st.isDirectory()&&!st.isSymbolicLink(),'Use literal source directories');parents.add(parent);if(parent===root)break;parent=dirname(parent);}
  const body=await checkedFile(path,{bytes:row.bytes,sha256:row.sha256});
  ensure(createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex')===row.blob,'Original Git source identity differs: '+row.path);
 }
 return {bytes,pin:{bytes:bytes.length,sha256:expected},manifest};
}

export async function receiveNative06(config){
 const allowed=['source','sourceManifestSha256','directory','backup','report','nativeReport','playwright','chromium','browserTmp','python','archive'];
 ensure(config&&typeof config==='object'&&!Array.isArray(config)&&Object.keys(config).every(k=>allowed.includes(k)),'Use the reviewed receiving configuration');
 const source=absolute(config.source,'source directory'),base=absolute(config.directory,'receiving directory');
 const sourceChecked=await verifiedSource(source,config.sourceManifestSha256);
 ensure(source!==base&&!source.startsWith(base+sep),'Keep immutable public source outside the private operating case');
 await privateDirectory(base);for(const name of ['requests','reports','inputs','screenshots','archives'])await privateDirectory(join(base,name));
 const environment={...process.env},python=config.python||environment.SCF_PYTHON||'python3';
 const browserTmp=await privateDirectory(absolute(config.browserTmp,'private browser directory'));
 ensure(browserTmp!==base&&!browserTmp.startsWith(base+sep),'Keep browser scratch outside the retained operating state');
 const archivePath=absolute(config.archive,'complete archive');ensure(archivePath!==base&&!archivePath.startsWith(base+sep),'Keep the final archive outside its original operating directory');
 await privateDirectory(dirname(archivePath));
 const pins={backup:{bytes:422912,sha256:ORIGINAL_BACKUP_SHA},report:{bytes:21783,sha256:ORIGINAL_REPORT_SHA},nativeReport:{bytes:5034,sha256:ORIGINAL_NATIVE_SHA}};
 const files={};for(const key of Object.keys(pins))files[key]=await checkedFile(absolute(config[key],key),pins[key]);
 const original=JSON.parse(files.report),native=JSON.parse(files.nativeReport);
 ensure(original.operation===ORIGINAL_REPORT_OPERATION&&original.externalProviderCalls===0&&original.chainTransactions===0,'Use the actual completed native06 observation with its original transport classification');
 equal(original.scenarioPlan.planId,PLAN,'Original plan differs');equal(original.applied.pricingVersion,VERSION,'Original pricing differs');
 equal(original.applied.edition,COST,'Original cost edition differs');equal(original.quoteSourceId,SUPPLIER,'Original supplier quote differs');
 const request={schema:'stellar-forge.native06-commercial-receiving-request.v1',operation:OPERATION,
  source,sourceManifest:sourceChecked.pin,originalOperation:ORIGINAL_OPERATION,originalReportOperation:ORIGINAL_REPORT_OPERATION,pins,ids:IDS,planId:PLAN,version:VERSION,costEdition:COST,supplierSource:SUPPLIER,
  paths:{directory:base,backup:config.backup,report:config.report,nativeReport:config.nativeReport,playwright:absolute(config.playwright,'Playwright module'),chromium:absolute(config.chromium,'Chromium executable'),browserTmp,archive:absolute(config.archive,'complete archive')},
  python};
 let originalRequest=await optional(join(base,'operation.json'));
 const binding=originalRequest?JSON.parse(originalRequest):await savedJson(join(base,'operation.json'),{...request,startedAt:new Date().toISOString()});
 const {startedAt,...bound}=binding;equal(bound,request,'This operating directory belongs to a different source, original case or command');
 const completed=await optional(join(base,'RESULT.json'));
 if(completed){
  const result=JSON.parse(completed);ensure(result.schema==='stellar-forge.native06-commercial-receiving-result.v1'&&result.state==='COMPLETE'&&result.operation===OPERATION,'Retained result belongs to another operation');
  equal({originalOperation:result.originalOperation,originalBackup:result.originalBackup,senderCase:result.senderCase,costEdition:result.costEdition,sourceManifest:result.sourceManifest},{originalOperation:ORIGINAL_OPERATION,originalBackup:pins.backup,senderCase:IDS.senderCase,costEdition:COST,sourceManifest:sourceChecked.pin},'Completed original receiving selection changed');
  const archive=await wholeArchive(base,archivePath,python,environment);await savedJson(join(base,'DELIVERY.json'),{result:'RESULT.json',archive});
  process.stdout.write(JSON.stringify({state:'COMPLETE',operation:OPERATION,replayed:true,result:join(base,'RESULT.json'),archive})+'\n');return {...result,archive,replayed:true};
 }
 const progressPath=join(base,'progress.json');
 let progress=JSON.parse(await optional(progressPath)||'{"stages":{}}');progress={schema:'stellar-forge.native06-commercial-receiving-progress.v1',operation:OPERATION,...progress};
 async function complete(name,value){const prior=await reportAt(base,name,value);progress.stages[name]={state:'COMPLETE',report:'reports/'+name+'.json'};progress.updatedAt=new Date().toISOString();await checkpoint(progressPath,progress);process.stdout.write(JSON.stringify({stage:name,state:'COMPLETE'})+'\n');return prior;}
 const load=rel=>import(pathToFileURL(join(source,rel)).href);
 const root='stellar/scf-starforge-20261009/';
 const api=await load(root+'sf74-merchant-support-console/commercial/receiving.mjs');
 const {openCaseStore,retainCaseArtifact}=await load(root+'sf74-merchant-support-console/case-store.mjs');
 const {parseWorkspace,serializeWorkspace,workspaceDraft}=await load(root+'sf74-merchant-support-console/workspace-file.mjs');
 const {newCommissioning,encodeCommissioningBytes}=await load(root+'sf74-merchant-support-console/commissioning.mjs');
 const {operateCaseCommissioning}=await load(root+'sf74-merchant-support-console/case-commissioning.mjs');
 const {openCaseCommercial,commercialWorkspaceId}=await load(root+'sf74-merchant-support-console/case-commercial.mjs');
 const {emptyCommercialDraft}=await load(root+'sf74-merchant-support-console/commercial-quote.mjs');
 const {inspectCommercialPricingSource}=await load(root+'sf74-merchant-support-console/commercial-pricing.mjs');
 const {restoreCostWorkspace}=await load(root+'sf97-merchant-revenue-ops/economics/archive.mjs');
 const {openWorkspace}=await load(root+'sf97-merchant-revenue-ops/workspace/model.mjs');
 const {openPlanningWorkspace}=await load(root+'sf97-merchant-revenue-ops/planning/workspace.mjs');
 const {createCaseSourceDelivery}=await load(root+'sf74-merchant-support-console/case-source-delivery.mjs');
 const {start}=await load(root+'sf74-merchant-support-console/server.mjs');
 for(const key of Object.keys(files))await retainCaseArtifact(join(base,'inputs',key==='backup'?'native06-pricing-workspace.tar':key+'.json'),files[key]);
 await retainCaseArtifact(join(base,'inputs','SOURCE-MANIFEST.json'),sourceChecked.bytes);
 for(const row of sourceChecked.manifest.files){const target=join(base,'public-source',row.path);await privateDirectory(dirname(target));await retainCaseArtifact(target,await readFile(join(source,row.path)));}
 await retainCaseArtifact(join(base,'public-source','SOURCE-MANIFEST.json'),sourceChecked.bytes);
 await complete('original-inputs',{operation:ORIGINAL_OPERATION,pins,plan:original.scenarioPlan,pricing:original.applied,externalProviderCalls:0,chainTransactions:0,nativeTransport:native.providerTransport??native.transport??null});
 const senderPricing=join(base,'sender-pricing'),senderCases=join(base,'sender-cases'),senderSources=join(base,'sender-sources'),sourceDirectory=join(base,'pricing-source');
 await restoreCostWorkspace({archive:config.backup,directory:senderPricing,expectedArchiveSha256:ORIGINAL_BACKUP_SHA});
 const versionRoot=join(senderPricing,'versions',VERSION),model=await openWorkspace({directory:senderPricing,config:join(versionRoot,'seller.json'),snapshot:join(versionRoot,'snapshot.json')});
 const planning=await openPlanningWorkspace({model,directory:senderPricing});
 const captured=await api.captureCommercialReceivingSource({model,planning,planId:PLAN,backupRequestId:IDS.backup,directory:sourceDirectory});
 const selected=inspectCommercialPricingSource(captured.pricingSource);
 equal({plan:selected.planId,version:selected.version},{plan:PLAN,version:VERSION},'Captured original pricing selection changed');
 ensure(captured.costOrigin?.edition===COST,'The quoted cost source was not carried with this plan');
 await complete('pricing-source',{sourceSha256:captured.sourceSha256,pricing:captured.source.pricing,backup:captured.source.backup,costOrigin:captured.costOrigin});
 const store=await openCaseStore(senderCases),commercial=openCaseCommercial({store,workspaceId:commercialWorkspaceId(senderCases)});
 const caseName='Native06 Linkup merchant · quotation and complete source receiving';
 const notes='Internal Commons operator delivery using the completed native06 controlled Linkup/RPC observations. No external customer response, provider bill, source request or payment is created.';
 const initial=await requestAt(base,'create-case',async()=>({
  id:IDS.senderCase,expectedRevision:null,workspaceText:await serializeWorkspace({name:caseName,inputs:{},sources:{},termsText:'',baselineOnly:false,commissioning:newCommissioning()},{now:startedAt}),
  metadata:{merchant:'Native06 Linkup search and answer merchant',owner:ACTOR,status:'in_progress',followUpOn:'',nextAction:'Receive the exact selected quote and independent pricing restore',notes},supportText:null}));
 let record;
 try{record=await store.read(IDS.senderCase);}
 catch(e){if(!['CASE_NOT_FOUND','ENOENT'].includes(e.code))throw e;await store.save(initial);record=await store.read(IDS.senderCase);}
 ensure(record.name===caseName,'The fixed case UUID belongs to another original case');
 async function command(targetStore,id,name,type,payload,requestId){
  const args=await requestAt(base,name,async()=>{const r=await targetStore.read(id),w=await parseWorkspace(r.workspaceText);
   return {id,expectedRevision:r.revision,command:{type,requestId,actor:ACTOR,expectedRevision:(w.commissioning??newCommissioning()).revision,payload}};});
  return operateCaseCommissioning(targetStore,args);
 }
 await command(store,IDS.senderCase,'scope','update_plan',{
  title:'Native06 complete quotation and source receiving',customerTask:'Receive the selected original merchant quote and restore its complete pricing/cost inputs in a separate workspace.',
  payer:'Internal Commons operation; no invoice or new payment',merchant:'Native06 Linkup search and answer merchant',buyer:'Commons independent operator',
  implementationOwner:ACTOR,receivingOwner:ACTOR,sourceLocation:'urn:stellar-forge:operation:'+ORIGINAL_OPERATION,
  merchantHost:'No seller is started by this operation',buyerApplication:'Original Merchant Support and pricing workspace',
  outputDefinition:'A saved source-bound quote, complete case/history package, independently restored original pricing/cost workspace and actual technical receiving record.',
  repeatTrigger:'Same original request IDs after interruption or source relocation',supportOwner:ACTOR,supportBoundary:'Local retained-source receiving; no provider purchase, chain transaction, external customer response or inferred provider billing.',
  commercialReference:'urn:stellar-forge:plan:'+PLAN,notes},IDS.planUpdate);
 await command(store,IDS.senderCase,'operator-tasks','save_tasks',{tasks:TASKS.map(row=>({...row,owner:ACTOR,status:'in_progress',notes,dependencies:[]}))},IDS.saveTasks);
 await command(store,IDS.senderCase,'original-report','add_material',{id:'native06-original-report',name:'native06-economics-journey.json',mediaType:'application/json',
  data:encodeCommissioningBytes(files.report),kind:'observation',description:'Original completed native06 report, preserved byte for byte with its transport and payment classifications.',
  taskIds:TASKS.map(t=>t.id),editionId:null,reference:'urn:stellar-forge:operation:'+ORIGINAL_OPERATION},IDS.sourceReport);
 const attachment=await requestAt(base,'attach-pricing-backup',async()=>({casesDirectory:senderCases,id:IDS.senderCase,expectedRevision:(await store.read(IDS.senderCase)).revision,
  pricingRequestId:IDS.pricingAttach,attachmentRequestId:IDS.backupAttach,actor:ACTOR,
  bindingReason:'This case is the internal receiving continuation of the exact native06 merchant, same saved plan '+PLAN+', pricing '+VERSION+' and cost edition '+COST+'. The quote preserves its original two route identities and saved volumes. No unrelated Service case is reused.',
  directory:sourceDirectory,expectedSourceSha256:captured.sourceSha256}));
 const attached=await api.attachCommercialReceivingSource({...attachment,store});
 await complete('source-attached',attached);
 const draft=await requestAt(base,'selected-quote-draft',async()=>{
  const value=emptyCommercialDraft();value.title='Native06 merchant · selected route plan and complete receiving';
  value.customer={name:'Commons internal merchant receiving',contact:ACTOR};
  value.pricingSourceId=selected.id;
  value.pricing.routes=selected.rows.map(row=>({routeId:row.routeId,monthlyRequests:row.monthlyRequests}));
  value.terms={scope:'Receive the original selected native06 Linkup merchant plan and its source-bound quotation in the original Merchant Support product.',
   deliverables:'Original selected route quotation; complete case, source files and immutable history; retained full pricing backup; independent native pricing/cost restore and exact original supplier bytes; technical receiving and continued local case reopen.',
   exclusions:'This quotation does not assert an external buyer agreement, new deployment, supplier debit, invoice, cash receipt, provider acquisition or chain transaction.',
   payment:'The route USD amounts and monthly request quantities are retained from the selected original saved pricing scenario. This internal operational quotation creates no payment obligation or transfer of funds.',
   acceptance:'Technical receiving requires the complete native package and exact plan, pricing version, cost edition and original source bytes to reopen independently. Any external customer response must be recorded separately from its actual message.'};
  value.notes=notes+' Original supplier input is QUOTE, not BILL. Original observed HTTP response completion and settlement remain separate.';
  return value;
 });
 const draftArgs=await requestAt(base,'save-quote-draft',async()=>({id:IDS.senderCase,expectedRevision:(await store.read(IDS.senderCase)).revision,requestId:IDS.draftSave,actor:ACTOR,draft}));
 await commercial.saveDraft(draftArgs);
 const viewBefore=await commercial.read({id:IDS.senderCase});
 const reviewed=await commercial.preview({id:IDS.senderCase,expectedRevision:viewBefore.revision,draft});
 ensure(!reviewed.review.issues.some(row=>row.severity!=='info'),'The original quote review needs a resolved operator issue before publication');
 await complete('quote-review',reviewed.review);
 let browser,host,senderDelivery,receiverDelivery;
 try{
  let view=await commercial.read({id:IDS.senderCase});
  let quote=view.quotes.find(q=>q.reviewSha256===reviewed.review.reviewSha256&&q.draftSha256===reviewed.review.draftSha256);
  const pendingPublish=await optional(join(base,'requests','browser-publish.json'));
  if(!quote&&pendingPublish){const args=JSON.parse(pendingPublish);await commercial.publish({id:IDS.senderCase,...args});view=await commercial.read({id:IDS.senderCase});quote=view.quotes.find(q=>q.id===args.requestId);}
  const previousBrowser=await optional(join(base,'reports','browser-quotation.json'));
   if(previousBrowser){
    const prior=JSON.parse(previousBrowser);ensure(quote&&quote.id===prior.quoteId&&quote.sha256===prior.quoteSha256,'Retained browser quote differs');
    ensure(Array.isArray(prior.screenshots)&&prior.screenshots.length===2,'Retained browser screenshot identities are missing');
    for(const row of prior.screenshots){ensure(['sender-quote-desktop.png','sender-quote-390.png'].includes(row.name),'Retained browser screenshot path differs');await checkedFile(join(base,'screenshots',row.name),{bytes:row.bytes,sha256:row.sha256});}
   }else{
   host=await start({casesDir:senderCases,sourceDir:senderSources,environment,runCapture:async()=>{throw new Error('This original receiving operation never requests a seller capture');}});
  const pw=await import(pathToFileURL(config.playwright).href);
  browser=await pw.chromium.launch({executablePath:config.chromium,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking'],
   env:{...environment,TMPDIR:browserTmp}});
  const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(String(e)));const origin=new URL(host.url).origin;
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!['data:','about:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
   if(route.request().method()==='POST'&&url.pathname==='/api/cases/'+IDS.senderCase+'/commercial/publish'){
    const body=route.request().postDataJSON();equal(body.reviewSha256,reviewed.review.reviewSha256,'Browser reviewed another quotation');
    equal(body.draft,draft,'Browser changed the selected saved quote draft');await savedJson(join(base,'requests','browser-publish.json'),body);
   }return route.continue();
  });
  await page.goto(new URL('/commercial?case='+IDS.senderCase,host.url).href,{waitUntil:'networkidle'});
  await page.locator('#quotation-root [data-tab="quote"]').waitFor();
  if(!quote){
   await page.locator('#quotation-root [data-tab="quote"]').click();
   await page.locator('#quotation-root [data-action="preview"]').click();
   await page.locator('#quotation-root [data-action="publish"]').waitFor();
   ensure(await page.locator('#quotation-root [data-action="publish"]').isEnabled(),'The original browser quote review did not permit publication');
   const response=page.waitForResponse(r=>r.url().endsWith('/api/cases/'+IDS.senderCase+'/commercial/publish')&&r.request().method()==='POST');
   await page.locator('#quotation-root [data-action="publish"]').click();const returned=await response;
   ensure(returned.ok(),'Original browser quote publication failed');const result=await returned.json();quote=result.quote;
   await page.locator('#cq-selected-quote').waitFor();equal(await page.locator('#cq-selected-quote').inputValue(),quote.id,'Browser did not select the published quote');
  }else{await page.locator('#quotation-root [data-tab="editions"]').click();await page.locator('#cq-selected-quote').selectOption(quote.id);}
  await page.screenshot({path:join(base,'screenshots','sender-quote-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(base,'screenshots','sender-quote-390.png'),fullPage:true});
  const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  ensure(layout.scrollWidth<=layout.width,'Original quotation has page-level overflow at390px');
  ensure(errors.length===0,'The original quotation emitted a browser error');ensure(external.length===0,'The original receiving page attempted an external request');
  const screenshots=[];for(const name of ['sender-quote-desktop.png','sender-quote-390.png']){const body=await readFile(join(base,'screenshots',name));screenshots.push({name,bytes:body.length,sha256:sha(body)});}
   await complete('browser-quotation',{quoteId:quote.id,quoteSha256:quote.sha256,reviewSha256:quote.reviewSha256,layout,errors,externalRequests:external,screenshots,transport:'Actual original local Merchant Support browser'});
  await browser.close();browser=null;await host.close();host=null;
   }
  view=await commercial.read({id:IDS.senderCase});quote=view.quotes.find(q=>q.id===quote.id);
  ensure(quote&&quote.originCaseId===IDS.senderCase&&quote.receiving.length===0,'Quote origin or customer-response history changed');
  const senderReview=await api.inspectCommercialCase({store,casesDirectory:senderCases,id:IDS.senderCase,quoteId:quote.id,quoteSha256:quote.sha256,archiveSha256:attached.archiveSha256});
  await complete('sender-quote-reopened',senderReview);
  senderDelivery=await createCaseSourceDelivery({store,directory:senderSources,python,environment});
  const senderExportArgs=await requestAt(base,'export-sender',async()=>({casesDirectory:senderCases,id:IDS.senderCase,revision:(await store.read(IDS.senderCase)).revision,
   quoteId:quote.id,quoteSha256:quote.sha256,archiveSha256:attached.archiveSha256,directory:join(base,'sender-case-package'),exportId:IDS.senderExport}));
  const exported=await api.exportCommercialCasePackage({...senderExportArgs,store,sourceDelivery:senderDelivery,python,environment});
  await complete('sender-whole-package',exported);await senderDelivery.close();senderDelivery=null;
  const receiverCases=join(base,'receiver-cases'),receiverSources=join(base,'receiver-sources'),receivingRoot=join(base,'receiving');
  const receiverStore=await openCaseStore(receiverCases);receiverDelivery=await createCaseSourceDelivery({store:receiverStore,directory:receiverSources,python,environment});
  const receiveArgs=await requestAt(base,'receive-whole-case',async()=>({directory:senderExportArgs.directory,receivingDirectory:receivingRoot,casesDirectory:receiverCases,
   requestId:IDS.packageReceive,actor:ACTOR,expectedManifestSha256:exported.casePackage.manifestSha256,quoteId:quote.id,quoteSha256:quote.sha256,archiveSha256:attached.archiveSha256}));
  const received=await api.receiveCommercialCasePackage({...receiveArgs,sourceDelivery:receiverDelivery,python,environment});
  await complete('received-whole-case',received);
  const receiverId=received.caseReceiving.case.id;
  const restored=await api.restoreCommercialPricingWorkspace({store:receiverStore,casesDirectory:receiverCases,id:receiverId,revision:received.caseReceiving.case.importedRevision,
   quoteId:quote.id,quoteSha256:quote.sha256,archiveSha256:attached.archiveSha256,archive:join(base,'archives','received-original-pricing.tar'),directory:join(base,'restored-pricing')});
  equal({plan:restored.planId,version:restored.version,cost:restored.costEdition?.edition},{plan:PLAN,version:VERSION,cost:COST},'Original pricing/cost restore differs');
  await complete('independent-original-pricing-restore',restored);
  const restoreReport={schema:'stellar-forge.native06-commercial-technical-receiving.v1',operation:OPERATION,originalOperation:ORIGINAL_OPERATION,
   quote:{id:quote.id,sha256:quote.sha256,originCaseId:quote.originCaseId},sourceCase:exported.casePackage.case,receivedCase:received.caseReceiving.case,
   packageManifestSha256:exported.casePackage.manifestSha256,pricing:restored,sourceHashes:pins,observedAt:new Date().toISOString(),
   newProviderCalls:0,newPurchases:0,newChainTransactions:0,customerResponse:'NOT_RECORDED'};
  const technical=await requestAt(base,'technical-result',async()=>restoreReport);
  await command(receiverStore,receiverId,'technical-material','add_material',{id:'native06-independent-restore',name:'native06-independent-restore.json',mediaType:'application/json',
   data:encodeCommissioningBytes(encoded(technical)),kind:'observation',description:'Actual complete case receiving and independent original pricing/cost restore.',
   taskIds:TASKS.map(t=>t.id),editionId:null,reference:'urn:stellar-forge:operation:'+OPERATION},IDS.technicalMaterial);
  await command(receiverStore,receiverId,'technical-receiving','record_receiving',{id:IDS.technicalReceiving,editionId:null,taskIds:TASKS.map(t=>t.id),
   materialIds:['native06-independent-restore','commercial-backup:'+IDS.backupAttach],outcome:'accepted',kind:'technical',observedAt:technical.observedAt,
   reference:'urn:stellar-forge:operation:'+OPERATION,notes:'Exact original files, case package, quotation, selected plan and cost edition were reopened by their existing native engines. This is an internal technical result; no external customer acceptance or payment was observed.',supersedesId:null},IDS.technicalReceiving);
  await command(receiverStore,receiverId,'complete-operator-tasks','save_tasks',{tasks:TASKS.map(t=>({id:t.id,status:'done'}))},IDS.completeTasks);
  const editArgs=await requestAt(base,'continued-receiver-case',async()=>{const r=await receiverStore.read(receiverId);return {id:receiverId,expectedRevision:r.revision,workspaceText:r.workspaceText,
   metadata:{...r.metadata,status:'ready',nextAction:'Review the complete source-bound quotation and actual technical receiving packet',notes:r.metadata.notes+'\nIndependent receiver continued this case after the original package import. Original source/quote/customer-response identities remain preserved.'}};});
  const beforeEdit=await receiverStore.read(receiverId);
   if(canonical({workspaceText:beforeEdit.workspaceText,metadata:beforeEdit.metadata})!==canonical({workspaceText:editArgs.workspaceText,metadata:editArgs.metadata}))await receiverStore.save(editArgs);
   const beforeRetry=await receiverStore.read(receiverId);
  const retry=await api.receiveCommercialCasePackage({...receiveArgs,sourceDelivery:receiverDelivery,python,environment});
  const afterRetry=await receiverStore.read(receiverId);equal(afterRetry.revision,beforeRetry.revision,'Original package replay overwrote later local work');
  equal(retry.caseReceiving.case.importedRevision,received.caseReceiving.case.importedRevision,'Original imported edition changed');
  const receiverCommercial=openCaseCommercial({store:receiverStore,workspaceId:commercialWorkspaceId(receiverCases)});
  const fresh=await receiverCommercial.read({id:receiverId}),receivedQuote=fresh.quotes.find(q=>q.id===quote.id);
  equal({id:receivedQuote.id,sha256:receivedQuote.sha256,originCaseId:receivedQuote.originCaseId,receiving:receivedQuote.receiving},
   {id:quote.id,sha256:quote.sha256,originCaseId:IDS.senderCase,receiving:[]},'Received quote or customer-response history changed');
  await complete('receiver-continued-and-replayed',{case:{id:receiverId,revision:afterRetry.revision,importedRevision:received.caseReceiving.case.importedRevision},originalQuote:{id:quote.id,sha256:quote.sha256,originCaseId:IDS.senderCase},technicalReceivingId:IDS.technicalReceiving,retry,customerResponses:0});
  const receiverExportArgs=await requestAt(base,'export-receiver',async()=>({casesDirectory:receiverCases,id:receiverId,revision:afterRetry.revision,
   quoteId:quote.id,quoteSha256:quote.sha256,archiveSha256:attached.archiveSha256,directory:join(base,'receiver-case-package'),exportId:IDS.receiverExport}));
  const finalPackage=await api.exportCommercialCasePackage({...receiverExportArgs,store:receiverStore,sourceDelivery:receiverDelivery,python,environment});
  await complete('receiver-whole-package',finalPackage);await receiverDelivery.close();receiverDelivery=null;
  const result={schema:'stellar-forge.native06-commercial-receiving-result.v1',operation:OPERATION,state:'COMPLETE',startedAt,completedAt:new Date().toISOString(),
   originalOperation:ORIGINAL_OPERATION,originalBackup:pins.backup,senderCase:IDS.senderCase,receiverCase:receiverId,quote:{id:quote.id,sha256:quote.sha256,originCaseId:IDS.senderCase},
   sourceSelection:captured.source.pricing,sourceManifest:sourceChecked.pin,costEdition:COST,technicalReceivingId:IDS.technicalReceiving,
   senderPackage:exported.casePackage,receiverPackage:finalPackage.casePackage,restored,customerResponses:0,newPurchases:0,newProviderCalls:0,newChainTransactions:0,
   classification:'Original native06 controlled transport is retained. Supplier input is a quotation; this receiving operation records only actual local technical outcomes.'};
  await savedJson(join(base,'RESULT.json'),result);
  const archive=await wholeArchive(base,archivePath,python,environment);await savedJson(join(base,'DELIVERY.json'),{result:'RESULT.json',archive});
  process.stdout.write(JSON.stringify({state:'COMPLETE',operation:OPERATION,result:join(base,'RESULT.json'),archive})+'\n');
  return {...result,archive};
 }finally{await browser?.close().catch(()=>{});await host?.close().catch(()=>{});await senderDelivery?.close().catch(()=>{});await receiverDelivery?.close().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{ensure(process.argv.length===3,'Usage: node native06-commercial-receiving.mjs ABSOLUTE_CONFIG_JSON');const file=absolute(process.argv[2],'configuration');await receiveNative06(JSON.parse(await readFile(file,'utf8')));}
 catch(error){process.stderr.write(JSON.stringify({state:'INCOMPLETE',code:error.code||error.name,message:error.message})+'\n');process.exitCode=1;}
}
