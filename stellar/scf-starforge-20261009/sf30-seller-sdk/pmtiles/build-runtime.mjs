// MIT. Build the complete selected runtime from original installed packages and native executables.
import {open,readFile,realpath,chmod,readdir} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {privateDirectory,readJson,readBytes,exists} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,plain,identifier,digest,hash,clone,pathName} from './model.mjs';
import {retainJson,retainFile,fileDescriptor,MAX_METADATA_BYTES} from './files.mjs';
import {readRuntime,loadNativeLibrary,withNativeLease,runNative,PYTHON_HOST_CONTRACT} from './native.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
export const PACKAGE_VERSIONS=Object.freeze({
  'pmtiles':'4.5.0','@maplibre/maplibre-gl-style-spec':'26.4.4','ol':'10.11.0',
  'maplibre-gl':'6.14.0','@geoblocks/ol-maplibre-layer':'2.0.0'
});
const FILE_KEYS=['pmtilesExecutable','martinExecutable','pythonExecutable','processLauncher','nativeBundle','previewScript','previewCss','previewWorker'];
async function outputFile(path,bytes){
  const {writeBytes}=await import('../../sf88-operator-buyer-cli/node/store.mjs');
  await privateDirectory(dirname(path));
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;need((await readBytes(path,bytes.length)).equals(bytes),'PMTILES_RUNTIME_BUILD_OUTPUT_CHANGED');}
  return {path,...await fileDescriptor(path,{limit:268435456})};
}
async function packageAt(modules,name){
  const root=await realpath(join(modules,...name.split('/'))),manifestPath=join(root,'package.json');
  const raw=await readFile(manifestPath),manifest=JSON.parse(raw);
  need(manifest.name===name&&typeof manifest.version==='string','PMTILES_ORIGINAL_PACKAGE_ID_CHANGED',name);
  return {root,manifest,path:manifestPath,bytes:raw.length,sha256:hash(raw)};
}
export async function buildPMTilesRuntime(input,{signal}={}){
  input=clone(input);signal?.throwIfAborted();
  need(plain(input)&&input.schema==='starforge.pmtiles-runtime-build.v1','PMTILES_RUNTIME_BUILD_INPUT_REQUIRED');
  identifier(input.requestId);
  need(process.platform==='linux'&&process.arch==='x64','PMTILES_LINUX_X64_REQUIRED');
  for(const key of ['destination','modulesDirectory','pmtilesExecutable','martinExecutable','pythonExecutable'])
    need(typeof input[key]==='string'&&isAbsolute(input[key]),'PMTILES_RUNTIME_BUILD_PATH_REQUIRED',key);
  const destination=await privateDirectory(resolve(input.destination)),modules=await realpath(input.modulesDirectory);
  await privateDirectory(join(destination,'locks'));
  return withNativeLease(join(destination,'locks'),'runtime-build',async leaseFd=>{
    const packages={};
    for(const [name,version] of Object.entries(PACKAGE_VERSIONS)){
      const actual=await packageAt(modules,name);
      need(actual.manifest.version===version,'PMTILES_SELECTED_PACKAGE_VERSION_REQUIRED',name+' must be '+version+'.');
      packages[name]=actual;
    }
    const esbuildPackage=await packageAt(modules,'esbuild');
    const require=createRequire(join(modules,'package.json')),esbuild=require(join(esbuildPackage.root,'lib','main.js'));
    need(typeof esbuild.build==='function'&&esbuild.version===esbuildPackage.manifest.version,'PMTILES_ESBUILD_ABI_CHANGED');
    const selectedExecutables={};
    for(const key of ['pmtilesExecutable','martinExecutable','pythonExecutable']){
      const path=await realpath(input[key]),descriptor=await fileDescriptor(path,{limit:268435456});
      need(descriptor.bytes>0,'PMTILES_NATIVE_EXECUTABLE_EMPTY');
      selectedExecutables[key]={path,...descriptor};
    }
    const sourceFiles={};
    for(const name of ['preview-entry.mjs','martin-launch.py','build-runtime.mjs'])
      sourceFiles[name]=await fileDescriptor(join(HERE,name));
    const request={schema:input.schema,requestId:input.requestId,modulesDirectory:modules,
      packages:Object.fromEntries(Object.entries(packages).map(([name,row])=>[name,{version:row.manifest.version,sha256:row.sha256}])),
      bundler:{name:'esbuild',version:esbuild.version,packageSha256:esbuildPackage.sha256},
      executables:selectedExecutables,sourceFiles};
    await retainJson(join(destination,'build-request.json'),request);
    const profilePath=join(destination,'runtime.json');
    if(await exists(profilePath)){
      const profile=await readRuntime(profilePath);
      need(profile.buildRequestSha256===digest(request),'PMTILES_RUNTIME_BUILD_REQUEST_CHANGED');
      return {profilePath,runtime:profile,reused:true};
    }
    await privateDirectory(join(destination,'bin'));await privateDirectory(join(destination,'web'));await privateDirectory(join(destination,'native'));
    const descriptors={};
    for(const key of ['pmtilesExecutable','martinExecutable']){
      const source=selectedExecutables[key],path=join(destination,'bin',key==='pmtilesExecutable'?'pmtiles':'martin');
      await retainFile(source.path,path,{expected:source,limit:268435456});await chmod(path,0o700);
      descriptors[key]={path,...await fileDescriptor(path,{limit:268435456})};
    }
    // The existing system interpreter retains its standard library; do not package an incomplete copied Python installation.
    descriptors.pythonExecutable=selectedExecutables.pythonExecutable;
    const launcher=join(destination,'native','martin-launch.py');
    await retainFile(join(HERE,'martin-launch.py'),launcher,{expected:sourceFiles['martin-launch.py']});
    descriptors.processLauncher={path:launcher,...sourceFiles['martin-launch.py']};
    const nativeEntry="import {PMTiles,tileIdToZxy} from 'pmtiles';\n"+
      "import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';\n"+
      "export {PMTiles,tileIdToZxy};\nexport const validateStyle=validateStyleMin;\n"+
      "export const versions="+JSON.stringify(PACKAGE_VERSIONS)+";\n";
    signal?.throwIfAborted();
    const native=await esbuild.build({stdin:{contents:nativeEntry,sourcefile:'pmtiles-original-native-entry.mjs',resolveDir:dirname(modules)},
      absWorkingDir:dirname(modules),nodePaths:[modules],bundle:true,format:'cjs',platform:'node',target:'node22',
      outfile:join(destination,'native','library.cjs'),write:false,metafile:true,legalComments:'inline',logLevel:'silent'});
    signal?.throwIfAborted();
    need(native.outputFiles.length===1,'PMTILES_NATIVE_BUNDLE_OUTPUT_CHANGED');
    descriptors.nativeBundle=await outputFile(join(destination,'native','library.cjs'),native.outputFiles[0].contents);
    const browser=await esbuild.build({entryPoints:[join(HERE,'preview-entry.mjs')],absWorkingDir:dirname(modules),nodePaths:[modules],
      bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:join(destination,'web','preview.js'),
      write:false,metafile:true,legalComments:'inline',logLevel:'silent'});
    signal?.throwIfAborted();
    const script=browser.outputFiles.find(row=>row.path.endsWith('/preview.js'));
    const css=browser.outputFiles.find(row=>row.path.endsWith('/preview.css'));
    need(script&&css&&browser.outputFiles.length===2,'PMTILES_BROWSER_BUNDLE_OUTPUT_CHANGED');
    descriptors.previewScript=await outputFile(join(destination,'web','preview.js'),script.contents);
    descriptors.previewCss=await outputFile(join(destination,'web','preview.css'),css.contents);
    const worker=join(packages['maplibre-gl'].root,'dist','maplibre-gl-worker.mjs');
    const workerDescriptor=await fileDescriptor(worker,{limit:268435456}),workerPath=join(destination,'web','maplibre-gl-worker.mjs');
    await retainFile(worker,workerPath,{expected:workerDescriptor,limit:268435456});
    descriptors.previewWorker={path:workerPath,...workerDescriptor};
    const sourceInputs=new Map();
    for(const metadata of [native.metafile,browser.metafile]){
      for(const name of Object.keys(metadata.inputs)){
        if(name==='<stdin>'||name==='pmtiles-original-native-entry.mjs')continue;
        const path=await realpath(resolve(dirname(modules),name));
        sourceInputs.set(path,await fileDescriptor(path,{limit:268435456}));
      }
    }
    for(const row of [...Object.values(packages),esbuildPackage])sourceInputs.set(row.path,{bytes:row.bytes,sha256:row.sha256});
    sourceInputs.set(worker,workerDescriptor);
    const retainedSources=[];
    for(const [original,descriptor] of [...sourceInputs].sort(([a],[b])=>a.localeCompare(b))){
      const sourcePath=join(destination,'source',descriptor.sha256);
      await retainFile(original,sourcePath,{expected:descriptor,limit:268435456});
      retainedSources.push({original,path:'source/'+descriptor.sha256,...descriptor});
    }
    const licenses=[];
    for(const [name,row] of Object.entries(packages)){
      for(const member of await readdir(row.root)){
        if(!/^(licen[sc]e|copying|notice)(\.|$)/i.test(member))continue;
        const path=join(row.root,member),descriptor=await fileDescriptor(path,{limit:MAX_METADATA_BYTES});
        const target='licenses/'+name.replaceAll('/','__')+'/'+member;
        await retainFile(path,join(destination,target),{expected:descriptor});
        licenses.push({package:name,path:target,...descriptor});
      }
    }
    const versions={};
    for(const [key,args,expected] of [['pmtilesExecutable',['version'],'1.31.2'],['martinExecutable',['--version'],'1.16.1']]){
      const record=await runNative(join(destination,'build-native',key),[descriptors[key].path,...args],{leaseFd,timeoutMs:15000,signal});
      const output=(await readBytes(join(destination,'build-native',key,record.stdout.path),1048576)).toString('utf8').trim();
      need(new RegExp('(^|[^0-9])v?'+expected.replaceAll('.','\\.')+'($|[^0-9])').test(output),'PMTILES_SELECTED_NATIVE_VERSION_REQUIRED',key+' must report '+expected+'.');
      versions[key]=output;
    }
    await runNative(join(destination,'build-native','python'),[descriptors.pythonExecutable.path,'-I','-c',
      'import ctypes,os,sys; assert sys.platform=="linux"; assert sys.version_info >= (3,11); print(sys.version)'],{leaseFd,timeoutMs:15000,signal});
    const profile={schema:'starforge.pmtiles-runtime.v1',buildRequestSha256:digest(request),buildDirectory:destination,pythonHostContract:PYTHON_HOST_CONTRACT,packages:clone(PACKAGE_VERSIONS),
      pmtilesVersion:versions.pmtilesExecutable,martinVersion:versions.martinExecutable,...descriptors,
      platform:{system:'linux',architecture:'x64',nodeMinimum:'22.16.0',pythonMinimum:'3.11',
        pythonRequirement:'An existing complete Linux Python3.11+ standard library installation, captured by hash and verified before each native launch.'}};
    const validated=await readRuntime(profile);await loadNativeLibrary(validated);
    await retainJson(join(destination,'build-sources.json'),{schema:'starforge.pmtiles-runtime-sources.v1',
      buildRequestSha256:digest(request),files:retainedSources,licenses,nativeEntry,nativeMetafile:native.metafile,browserMetafile:browser.metafile});
    await retainJson(profilePath,profile);
    return {profilePath,runtime:validated,reused:false};
  });
}
