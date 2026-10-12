// Prepare the same existing disposable Lightdash estate for one complete receiving.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,mkdir,realpath,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {check,readJson,saveJson,fileIdentity,verifyManifest,inventory,objectDigest,digest} from '../native/files.mjs';
import {normalizeConnection,UPSTREAM} from '../native/contract.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),APP=path.dirname(HERE);
export const RECEIVING_SCHEMA='lightdash-commissioning.receiving.v1';
const shaPattern=/^[a-f0-9]{64}$/;
async function selectedFile(value,label){
 check(value&&path.isAbsolute(value.file)&&shaPattern.test(value.sha256),'LIGHTDASH_RECEIVING_INPUT','Supply the exact '+label+' file and SHA256.');
 const actual=await fileIdentity(value.file);check(actual.sha256===value.sha256&&(value.bytes===undefined||actual.bytes===value.bytes),'LIGHTDASH_RECEIVING_INPUT',label+' changed.');
 return {file:await realpath(value.file),...actual};
}
export async function verifyExample(directory,licenseFile){
 check(path.isAbsolute(directory),'LIGHTDASH_EXAMPLE','Use the actual complete upstream example directory.');
 directory=await realpath(directory);
 const original=await readJson(path.join(HERE,'upstream.json')),files=await inventory(directory);
 check(original.commit===UPSTREAM.commit&&original.files.length===189&&files.length===189,'LIGHTDASH_EXAMPLE','The full original 189-file example is required.');
 const names=new Map(files.map(f=>[f.path,f]));
 for(const selected of original.files){
  const actual=names.get(selected.path);check(actual&&actual.bytes===selected.bytes&&actual.executable===(selected.mode==='100755'),'LIGHTDASH_EXAMPLE','An original source path, size or executable bit changed.',{path:selected.path});
  const bytes=await readFile(path.join(directory,selected.path));
  const blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  check(blob===selected.gitBlob,'LIGHTDASH_EXAMPLE','Original example bytes differ from the pinned Git blob.',{path:selected.path});
 }
 const license=original.licenses.find(x=>x.role==='upstream-root'),actualLicense=await fileIdentity(licenseFile);
 check(actualLicense.bytes===license.bytes&&actualLicense.sha256===license.sha256,'LIGHTDASH_LICENSE','Retain the exact upstream root license alongside the complete example.');
 return {directory,files,bytes:files.reduce((n,f)=>n+f.bytes,0),sourceSha256:objectDigest(files),upstreamManifest:{file:path.join(HERE,'upstream.json'),...await fileIdentity(path.join(HERE,'upstream.json'))},upstreamLicense:{file:await realpath(licenseFile),...actualLicense}};
}
function noSecrets(value,label='input'){
 if(!value||typeof value!=='object')return;
 for(const [key,v]of Object.entries(value)){
  check(!/^(password|token|secret|api[_-]?key|authorization|private[_-]?key)$/i.test(key)||v===null||v==='','LIGHTDASH_PRIVATE_INPUT','Use host environment references instead of literal '+label+'.'+key+'.');
  if(v&&typeof v==='object')noSecrets(v,label+'.'+key);
 }
}
export async function prepareReceiving(selection){
 check(selection&&typeof selection==='object'&&!Array.isArray(selection),'LIGHTDASH_RECEIVING_INPUT','Use a complete receiving selection.');
 for(const k of Object.keys(selection))check(['operationId','appRoot','sourceManifest','exampleDirectory','upstreamLicenseFile','connection','estate','browser','outputDirectory','operationTimeoutMs'].includes(k),'LIGHTDASH_RECEIVING_INPUT','Unknown receiving selection field: '+k);
 check(typeof selection.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(selection.operationId),'LIGHTDASH_RECEIVING_INPUT','Keep the existing business operation ID.');
 const appRoot=await realpath(selection.appRoot??APP);
 check(appRoot===APP,'LIGHTDASH_RECEIVING_SOURCE','Run prepare from the selected complete application source.');
 const manifest=await selectedFile(selection.sourceManifest,'complete application manifest');
 check(manifest.file===path.join(appRoot,'source-manifest.json'),'LIGHTDASH_RECEIVING_SOURCE','Use this complete app source-manifest.json.');
 const app=await verifyManifest({directory:appRoot,manifestFile:manifest.file,manifestSha256:manifest.sha256});
 const connection=selection.connection;noSecrets(connection);
 const normalized=await normalizeConnection(connection);
 const example=await verifyExample(selection.exampleDirectory,selection.upstreamLicenseFile??path.join(HERE,'licenses','Lightdash-LICENSE.txt'));
 const estate=await selectedFile(selection.estate,'original prepared-estate receipt'),observed=await readJson(estate.file);
 check(observed.schema==='lightdash-commissioning.prepared-estate.v1'&&observed.operationId===selection.operationId&&observed.disposable===true&&observed.origin===normalized.origin&&observed.projectUuid===normalized.projectUuid,'LIGHTDASH_ESTATE','The estate receipt must identify this same original disposable project and operation.');
 check(typeof observed.serverVersion==='string'&&observed.serverVersion.length>0&&typeof observed.dbtVersion==='string'&&typeof observed.dbtAdapterVersion==='string','LIGHTDASH_ESTATE','Retain actual server, dbt core and adapter versions from the original prepared estate.');
 check(Array.isArray(observed.images)&&['lightdash','postgres'].every(role=>observed.images.some(i=>i.role===role&&typeof i.reference==='string'&&/^sha256:[a-f0-9]{64}$/.test(i.digest))),'LIGHTDASH_ESTATE','Retain actual resolved Lightdash and PostgreSQL image digests, not mutable tags alone.');
 check(Array.isArray(observed.evidence)&&observed.evidence.length>0,'LIGHTDASH_ESTATE','Retain the original image/runtime/project preparation logs.');
 const evidence=[];for(const item of observed.evidence)evidence.push(await selectedFile(item,'estate observation'));
 check(selection.browser&&path.isAbsolute(selection.browser.moduleFile)&&path.isAbsolute(selection.browser.executable),'LIGHTDASH_BROWSER','Select the existing actual Playwright module and browser executable.');
 const browser={moduleFile:await realpath(selection.browser.moduleFile),executable:await realpath(selection.browser.executable)};
 for(const key of Object.keys(selection.browser))check(['moduleFile','executable'].includes(key),'LIGHTDASH_BROWSER','Unknown browser selection.');
 browser.moduleIdentity=await fileIdentity(browser.moduleFile);browser.executableIdentity=await fileIdentity(browser.executable);
 check(path.isAbsolute(selection.outputDirectory),'LIGHTDASH_RECEIVING_OUTPUT','Use an absolute persistent output directory on the same receiving host.');
 const outputDirectory=path.resolve(selection.outputDirectory);
 for(const source of [appRoot,example.directory])check(outputDirectory!==source&&!outputDirectory.startsWith(source+path.sep)&&!source.startsWith(outputDirectory+path.sep),'LIGHTDASH_RECEIVING_OUTPUT','Keep receiving output separate from complete application and example source.');
 await mkdir(outputDirectory,{recursive:true,mode:0o700});check(await realpath(outputDirectory)===outputDirectory&&(await lstat(outputDirectory)).isDirectory(),'LIGHTDASH_RECEIVING_OUTPUT','Receiving output must be an actual canonical directory.');
 const timeout=selection.operationTimeoutMs??7200000;check(Number.isSafeInteger(timeout)&&timeout>=60000&&timeout<=86400000,'LIGHTDASH_RECEIVING_INPUT','Select a complete-operation wait between one minute and 24 hours.');
 const input={schema:RECEIVING_SCHEMA,operationId:selection.operationId,appRoot,applicationSource:{manifestFile:manifest.file,manifestSha256:manifest.sha256,files:app.files.length,bytes:app.bytes},example,connection,connectionSha256:objectDigest(normalized),estate:{...estate,observed:{schema:observed.schema,operationId:observed.operationId,disposable:true,origin:observed.origin,projectUuid:observed.projectUuid,serverVersion:observed.serverVersion,dbtVersion:observed.dbtVersion,dbtAdapterVersion:observed.dbtAdapterVersion,images:observed.images},evidence},browser,outputDirectory,operationTimeoutMs:timeout};
 const file=path.join(outputDirectory,'receiving-input.json');await saveJson(file,input,{createOnly:true});
 return {schema:RECEIVING_SCHEMA,operationId:input.operationId,file,...await fileIdentity(file),workspaceDirectory:path.join(outputDirectory,'workspace'),command:[normalized.runtime.python.path,'-I','-B',path.join(HERE,'host.py'),'--input',file,'--input-sha256',(await fileIdentity(file)).sha256]};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const {values}=parseArgs({options:{selection:{type:'string'}}});check(values.selection,'LIGHTDASH_RECEIVING_INPUT','Use --selection /absolute/private-selection.json.');
 const result=await prepareReceiving(await readJson(values.selection));console.log(JSON.stringify(result));
}
