// MIT. Actual HDF Group files through the original complete HDF5 workbench.
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,open,rename,lstat,mkdir,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Hdf5Workbench} from '../controller.mjs';
import {serveHdf5} from '../server.mjs';
import {privateDirectory,copyExact,exact,verifiedFile,sha,json,syncDirectory} from '../custody.mjs';

const {values}=parseArgs({options:{directory:{type:'string'},gzip:{type:'string'},compound:{type:'string'},python:{type:'string'},
  'publisher-config':{type:'string'},'source-root':{type:'string'},'source-manifest':{type:'string'},'source-manifest-sha256':{type:'string'},browser:{type:'boolean'},'playwright-module':{type:'string'},'chromium-executable':{type:'string'}}});
if(!values.directory||!values.gzip||!values.compound)throw new Error('Use native-receiving.py --directory PRIVATE --gzip ORIGINAL.h5 --compound ORIGINAL.h5 [--browser].');
if(Number(process.env.HDF5_RECEIVING_PARENT)!==process.ppid||!/^[0-9]+$/.test(process.env.HDF5_RECEIVING_LOCK_FD??''))throw new Error('Use the original Python native-receiving.py owner launcher.');
const root=await privateDirectory(values.directory),lock=await open('/proc/self/fd/'+process.env.HDF5_RECEIVING_LOCK_FD,'r');
try{
 const [held,named]=await Promise.all([lock.stat({bigint:true}),lstat(join(root,'native-receiving.lock'),{bigint:true})]);
 if(held.dev!==named.dev||held.ino!==named.ino)throw new Error('Original receiving lock descriptor differs.');
}finally{await lock.close();}
const inputs=await privateDirectory(join(root,'inputs'),{create:true}),results=await privateDirectory(join(root,'results'),{create:true});
const python=values.python??process.env.HDF5_RECEIVING_PYTHON;
const expected={
 gzip:{bytes:9294,sha256:'07c50229724a3e09f7f0acd6092dde6bf16bdcb092ab539fc757233afc9af653',name:'h5ex_d_gzip.h5'},
 compound:{bytes:8400,sha256:'39b95903cf9e6d1e86688b85219797d9b77678c2a785807be10ee5cfea8b370a',name:'h5ex_t_cmpd.h5'}
};
for(const [kind,item] of Object.entries(expected))await copyExact(resolve(values[kind]),join(inputs,item.name),item);
let publisherConfig=null;
if(values['publisher-config']){
 const bytes=await readFile(resolve(values['publisher-config']));
 if(bytes.length>65536)throw new Error('Select a bounded original publisher configuration.');
 publisherConfig=JSON.parse(bytes);
 if(!publisherConfig||Object.keys(publisherConfig).some(k=>!['payment','origin','path'].includes(k)))throw new Error('Publisher configuration is payment, origin and path.');
}
if(!values['source-root']||!values['source-manifest']||!/^[a-f0-9]{64}$/.test(values['source-manifest-sha256']??''))throw new Error('Bind the complete selected source root, source manifest and its exact SHA-256 before native receiving.');
const sourceRoot=await realpath(resolve(values['source-root'])),manifestBytes=await readFile(resolve(values['source-manifest']));
if(manifestBytes.length>4*1024*1024||sha(manifestBytes)!==values['source-manifest-sha256'])throw new Error('Selected complete source manifest differs.');
const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
if(manifest.schema!=='stellar-forge.hdf5-receiving-source.v1'||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>4096)throw new Error('Select the complete original source inventory.');
const selectedFiles=new Set();
for(const file of manifest.files){
 if(typeof file.path!=='string'||file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some(x=>!x||x==='.'||x==='..')||selectedFiles.has(file.path))throw new Error('Invalid or duplicate selected source member.');
 selectedFiles.add(file.path);
 const path=join(sourceRoot,file.path);if(await realpath(path)!==path)throw new Error('Selected source members must retain their original canonical path.');
 const opened=await verifiedFile(path,{bytes:file.bytes,sha256:file.sha256},32*1024*1024);await opened.handle.close();
}
const hdf5Prefix='stellar/scf-starforge-20261009/sf30-seller-sdk/hdf5/';
for(const name of ['core.py','native.py','workspace.py','cli.py','bridge.mjs','custody.mjs','controller.mjs','server.mjs','app.mjs',
 'public/app.js','public/index.html','public/style.css','README.md','requirements.txt','examples/native-receiving.py','examples/native-receiving.mjs','examples/native-browser.mjs']){
 if(!selectedFiles.has(hdf5Prefix+name))throw new Error('Complete source inventory is missing '+name);
}
if(await realpath(fileURLToPath(import.meta.url))!==join(sourceRoot,hdf5Prefix+'examples/native-receiving.mjs'))throw new Error('This programme is not the selected original source entry.');
const pythonCode=[
 'import hashlib,json,os,pathlib,sys',
 'import h5py,numpy',
 'def digest(path):',
 ' h=hashlib.sha256()',
 ' with open(path,"rb") as stream:',
 '  for block in iter(lambda:stream.read(1048576),b""):h.update(block)',
 ' return {"path":path,"bytes":os.path.getsize(path),"sha256":h.hexdigest()}',
 'paths={os.path.realpath(module.__file__) for name,module in sys.modules.items() if (name=="h5py" or name.startswith("h5py.") or name=="numpy" or name.startswith("numpy.")) and getattr(module,"__file__",None)}',
 'for line in pathlib.Path("/proc/self/maps").read_text().splitlines():',
 ' path=line.split()[-1]',
 ' if path.startswith("/") and any(part in path for part in ("h5py","numpy","libpython")):paths.add(os.path.realpath(path))',
 'print(json.dumps({"python":sys.version,"executable":digest(os.path.realpath(sys.executable)),"h5py":h5py.__version__,"hdf5":h5py.version.hdf5_version,"numpy":numpy.__version__,"loadedRuntimeFiles":[digest(path) for path in sorted(paths) if os.path.isfile(path)]}))'
].join('\n');
const runtimeResult=await promisify(execFile)(python,['-B','-c',pythonCode],{timeout:30000,maxBuffer:1024*1024,
 env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',PYTHONDONTWRITEBYTECODE:'1',HDF5_PLUGIN_PRELOAD:'::'}});
const pythonRuntime=JSON.parse(runtimeResult.stdout);
const nodePath=await realpath(process.execPath),nodeFile=await verifiedFile(nodePath);
let nodeRuntime;try{nodeRuntime={version:process.version,platform:process.platform,arch:process.arch,executable:{path:nodePath,bytes:nodeFile.bytes,sha256:nodeFile.sha256}};}finally{await nodeFile.handle.close();}
let browserRuntime=null;
if(values.browser){
 const require=createRequire(import.meta.url),selectedModule=values['playwright-module']?resolve(values['playwright-module']):'playwright';
 const resolved=require.resolve(selectedModule),playwright=require(selectedModule),browserPath=await realpath(values['chromium-executable']?resolve(values['chromium-executable']):playwright.chromium.executablePath());
 const browserFile=await verifiedFile(browserPath,undefined,1024*1024*1024);
 try{browserRuntime={modulePath:resolved,moduleSha256:sha(await readFile(resolved)),executable:{path:browserPath,bytes:browserFile.bytes,sha256:browserFile.sha256}};}finally{await browserFile.handle.close();}
}
await exact(join(root,'selected-source-manifest.json'),manifestBytes);

const intent={schema:'stellar-forge.hdf5-native-receiving.v1',directory:root,python,inputs:expected,
 source:{root:sourceRoot,manifestSha256:sha(manifestBytes),files:manifest.files.length},runtime:{node:nodeRuntime,python:pythonRuntime,browser:browserRuntime},
 publisherConfigurationSha256:publisherConfig?sha(json(publisherConfig)):null,browser:!!values.browser,
 playwrightModule:values['playwright-module']?resolve(values['playwright-module']):null,chromiumExecutable:values['chromium-executable']?resolve(values['chromium-executable']):null};
await exact(join(root,'native-intent.json'),json(intent));const intentSha256=sha(json(intent));
const attempt=randomUUID(),report={schema:'stellar-forge.hdf5-native-result.v1',intentSha256,attempt,startedAt:new Date().toISOString(),
 sourceKind:'HDF Group published format examples',inputs:expected,phases:{},completed:false};
await privateDirectory(join(root,'attempts'),{create:true});
const attempted=join(root,'attempts',attempt+'.json');
async function record(){
 const pending=attempted+'.pending',output=await open(pending,'w',0o600);
 try{await output.writeFile(json(report));await output.sync();}finally{await output.close();}
 await rename(pending,attempted);await syncDirectory(dirname(attempted));
}
const stopped=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stopped.abort(new Error('Original receiving owner interrupted.')));
function check(){stopped.signal.throwIfAborted();}
async function phase(name,work){check();try{const result=await work();report.phases[name]={status:'completed',result};await record();process.stdout.write(JSON.stringify({phase:name,status:'completed'})+'\n');return result;}catch(error){report.phases[name]={status:'failed',error:{code:error.code??error.name,message:error.message}};await record();throw error;}}
async function original(workbench,action,payload){
 let existing;
 try{existing=await workbench.call('operation.get',{ident:payload.operation});}catch(error){if(error.status!==404)throw error;}
 if(existing){
   // Re-enter the original API with the exact same payload; it checks request identity,
   // including original source/destination paths, and verifies completed artifacts.
   return workbench.call(action,payload);
 }
 return workbench.call(action,payload);
}
let source,receiver,server;
try{
 const directory=await privateDirectory(join(root,'source-workspace'),{create:true});
 source=new Hdf5Workbench({directory,python,inputRoots:[inputs]});
 const imported={};
 for(const [kind,item] of Object.entries(expected)){
  imported[kind]=await phase('retain-'+kind,()=>original(source,'source.import',{operation:'hdfgroup-'+kind+'-import',
   source_id:'hdfgroup-'+kind,label:kind==='gzip'?'HDF Group gzip array example':'HDF Group compound datatype example',
   path:join(inputs,item.name),expected_head:null,origin:{name:item.name,url:'https://docs.hdfgroup.org/archive/support/ftp/HDF5/examples/files/exbyapi/'+item.name+'.html',
   description:'Published HDF Group API format example; original values are unchanged.'}}));
 }
 const arrays={};
 for(const kind of Object.keys(expected)){
  arrays[kind]=await phase('inspect-'+kind,()=>source.call('inspect',{version:imported[kind].version.id,path:'/DS1'}));
  if(arrays[kind].kind!=='dataset'||arrays[kind].valueAccess!=='selected-file')throw new Error('The actual example dataset is not the selected self-contained native object.');
 }
 if(JSON.stringify(arrays.gzip.shape)!=='["32","64"]')throw new Error('Original published gzip example shape differs.');
 const selected=await phase('select-gzip',()=>original(source,'selection.save',{operation:'hdfgroup-gzip-select',version:imported.gzip.version.id,
  selection:{dataset:'/DS1',axes:[{start:'1',count:'4',stride:'2',block:'2'},{start:'2',count:'5',stride:'3',block:'1'}]}}));
 const names=(arrays.compound.dtype.fields??[]).map(x=>x.name);
 for(const name of ['Serial number','Location'])if(!names.includes(name))throw new Error('Original compound field is absent: '+name);
 if(arrays.compound.shape?.length!==1)throw new Error('The original compound example dataspace changed.');
 const compound=await phase('select-compound',()=>original(source,'selection.save',{operation:'hdfgroup-compound-select',version:imported.compound.version.id,
  selection:{dataset:'/DS1',fields:['Location','Serial number'],axes:[{start:'0',count:String(Math.min(3,Number(arrays.compound.shape[0]))),stride:'1',block:'1'}]}}));
 const editions={};
 for(const [kind,selection] of Object.entries({gzip:selected,compound})){
  editions[kind]=await phase('extract-'+kind,()=>original(source,'selection.extract',{operation:'hdfgroup-'+kind+'-extract',selection_id:selection.id}));
  await phase('read-'+kind,async()=>{
   const pages=[];let offset='0',total=0;
   for(;;){const page=await source.call('result.page',{edition:editions[kind].id,offset,limit:7});pages.push(page);total+=page.rows.length;if(!page.next)break;offset=page.next;}
   if(String(total)!==editions[kind].array.rows)throw new Error('Actual result pages did not cover the retained edition.');
   await exact(join(results,kind+'-values.json'),json(pages));return {pages:pages.length,elements:String(total),edition:editions[kind].id};
  });
 }
 const projection=await phase('native-dataset-query',async()=>{
  const pages=[];let cursor=null,total=0;
  do{
   const query=new URLSearchParams({limit:'7'});if(cursor)query.set('cursor',cursor);
   const response=await source.call('dataset.query',{edition:editions.gzip.id,query:query.toString()});
   if(response.native.status!==200)throw new Error('Original dataset handler did not accept the exact projection.');
   const body=response.native.body;pages.push(body);total+=body.rows.length;cursor=body.page.nextCursor;
  }while(cursor);
  if(total!==40)throw new Error('The selected gzip projection must contain its exact 40 elements.');
  await exact(join(results,'dataset-pages.json'),json(pages));return {rows:total,pages:pages.length,snapshot:pages[0].dataset.snapshot};
 });
 const deliveries={};
 for(const kind of Object.keys(editions))deliveries[kind]=await phase('export-'+kind,()=>original(source,'edition.export',{operation:'hdfgroup-'+kind+'-export',edition:editions[kind].id}));
 receiver=new Hdf5Workbench({directory:await privateDirectory(join(root,'receiver-workspace'),{create:true}),python,inputRoots:[join(directory,'deliveries')]});
 for(const [kind,delivery] of Object.entries(deliveries)){
  await phase('receive-'+kind,()=>original(receiver,'edition.receive',{operation:'hdfgroup-'+kind+'-receive',archive_path:delivery.path,expected_sha:delivery.archive.sha256}));
  const received=await receiver.call('edition.get',{ident:editions[kind].id});
  if(JSON.stringify(received)!==JSON.stringify(editions[kind]))throw new Error('Independent receiving changed the selected immutable edition.');
 }
 if(publisherConfig)await phase('original-publisher-prepare',async()=>{
  const result=await source.call('publisher.prepare',{edition:editions.gzip.id,...publisherConfig});
  const state=await source.call('publisher.state');
  const identity=value=>{
   const draft=value?.result?.draft,native=draft?.socrata;
   if(value?.schema!=='stellar-forge.hdf5-publisher-prepared.v1'||typeof draft?.id!=='string'||!draft.id||
      ![value.requestSha256,draft.configHash,draft.csvHash,native?.packageKey,native?.sourceSha256,native?.originalSellerSha256]
       .every(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)))throw new Error('Original publisher returned no complete stable source/draft binding.');
   return {schema:value.schema,editionId:value.editionId,sourceVersion:value.sourceVersion,requestSha256:value.requestSha256,
    packageDirectory:value.packageDirectory,nativePackageDirectory:value.result.packageDirectory,
    draft:{id:draft.id,configHash:draft.configHash,csvHash:draft.csvHash,sourceBytes:draft.sourceBytes,
     packageKey:native.packageKey,sourceSha256:native.sourceSha256,originalSellerSha256:native.originalSellerSha256,nativeSnapshot:native.nativeSnapshot}};
  };
  const stable=identity(result);await exact(join(results,'publisher-binding.json'),json(stable));
  const historical=join(results,'publisher-prepared.json');let first;
  try{first=await readFile(historical);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(first){
   if(!json(identity(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(first)))).equals(json(stable)))
     throw new Error('The retained first publisher response belongs to another source/draft binding.');
   await exact(historical,first);
  }else await exact(historical,json(result));
  // The first full response is historical. This attempt records the current target,
  // draft revision, initialized flag and act() state without calling them immutable.
  return {binding:stable,prepared:result,state};
 });
 await receiver.close();receiver=null;await source.close();source=null;
 await phase('reopen-and-reuse',async()=>{
  const opened=new Hdf5Workbench({directory,python,inputRoots:[inputs]});
  const received=new Hdf5Workbench({directory:join(root,'receiver-workspace'),python,inputRoots:[join(directory,'deliveries')]});
  try{
   const result={};
   for(const kind of Object.keys(editions)){
    const read=await received.call('edition.get',{ident:editions[kind].id});
    const resume=await opened.call('operation.resume',{ident:'hdfgroup-'+kind+'-export'});
    if(read.id!==editions[kind].id||resume.archive.sha256!==deliveries[kind].archive.sha256)throw new Error('Original reopen/reuse identity differs.');
    result[kind]={edition:read.id,archive:resume.archive};
   }
   return result;
  }finally{await Promise.allSettled([opened.close(),received.close()]).then(outcomes=>{const errors=outcomes.filter(x=>x.status==='rejected').map(x=>x.reason);if(errors.length)throw new AggregateError(errors,'Reopened original workspaces did not close normally.');});}
 });
 if(values.browser){
  server=await serveHdf5({directory,python,inputRoots:[inputs]});
  const {browserJourney}=await import('./native-browser.mjs');
  await phase('actual-operator-browser',()=>browserJourney({server,root,attempt,intentSha256,editions,imported,arrays,deliveries,
   playwrightModule:values['playwright-module'],chromiumExecutable:values['chromium-executable'],signal:stopped.signal}));
  await server.close();server=null;
 }
 report.completed=true;report.finishedAt=new Date().toISOString();report.editions=Object.fromEntries(Object.entries(editions).map(([key,value])=>[key,value.id]));
 report.deliveries=deliveries;await record();
 await exact(join(root,'native-result.json'),json({schema:report.schema,intentSha256,inputs:expected,editions:report.editions,
   deliveries:Object.fromEntries(Object.entries(deliveries).map(([key,value])=>[key,{editionId:value.editionId,archive:value.archive}])),
   nativeDatasetSnapshot:projection.snapshot,browserCompleted:!!values.browser,publisherPrepared:!!publisherConfig,completed:true}));
 process.stdout.write(JSON.stringify({status:'completed',result:attempted,intentSha256,editions:report.editions,deliveries:Object.fromEntries(Object.entries(deliveries).map(([key,value])=>[key,value.archive]))})+'\n');
}catch(error){
 report.error={code:error.code??error.name,message:error.message};await record();throw error;
}finally{
 const errors=[];for(const owner of [server,receiver,source])if(owner)try{await owner.close();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'One original receiving owner closed with an interrupted outcome.');
}
