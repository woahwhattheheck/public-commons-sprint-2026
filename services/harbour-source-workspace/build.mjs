import {readFile,mkdir,lstat,open,link,rm,rename,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {sha256Bytes,sha256Utf8} from './sha256.mjs';
import * as Portable from './portable.mjs';
export const SOURCE_FILES=['engine.mjs','sha256.mjs','API.md','cli.mjs','CORE_OPERATING.md','receiving-fixture.mjs','portable.mjs','store.mjs','app.mjs','style.css','template.html','build.mjs','README.md','BROWSER_OPERATING.md','run_browser_receiving.mjs'];
async function regular(file){const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Retain a complete regular source file: '+file);return readFile(file);}
async function sourceText(file){const body=await regular(file),text=body.toString('utf8');if(!Buffer.from(text,'utf8').equals(body))throw Error('Retain valid exact UTF-8 original bytes: '+file);return text;}
export async function loadSource(root=dirname(fileURLToPath(import.meta.url))){
 const source={};for(const name of SOURCE_FILES)source[name]=await sourceText(join(root,name));
 source['migration-receiving/continuation.mjs']=await sourceText(join(root,'..','migration-receiving','continuation.mjs'));return source;
}
export async function publishFile(file,body){
 const output=resolve(file),bytes=typeof body==='string'?Buffer.from(body):Buffer.from(body),temporary=output+'.'+randomUUID()+'.tmp';await mkdir(dirname(output),{recursive:true});let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,output);}catch(error){if(error.code!=='EEXIST')throw error;if(!(await regular(output)).equals(bytes))throw Error('The original output path contains different complete bytes: '+output);}
  return{path:output,...sha256Bytes(bytes)};
 }finally{await handle?.close().catch(()=>{});await rm(temporary,{force:true});}
}
async function members(root,prefix=''){const rows=[];for(const name of await readdir(join(root,prefix))){const path=prefix?prefix+'/'+name:name,stat=await lstat(join(root,path));if(stat.isSymbolicLink())throw Error('The complete output contains a symbolic link.');if(stat.isDirectory())rows.push(...await members(root,path));else if(stat.isFile())rows.push(path);else throw Error('The complete output contains a nonregular member.');}return rows.sort();}
export async function publishDirectory(directory,files){
 const output=resolve(directory),stage=output+'.'+randomUUID()+'.tmp',selected=[];await mkdir(dirname(output),{recursive:true});await mkdir(stage,{mode:0o700});
 try{
  const names=new Set();for(const file of files){if(typeof file.path!=='string'||file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||names.has(file.path))throw Error('Retain distinct safe relative output paths.');names.add(file.path);
   const bytes=Portable.memberBytes(file),identity=sha256Bytes(bytes);if((file.bytes!==undefined&&identity.bytes!==file.bytes)||(file.sha256!==undefined&&identity.sha256!==file.sha256))throw Error('Selected complete output differs: '+file.path);
   await publishFile(join(stage,file.path),bytes);selected.push({path:file.path,...identity});
  }
  try{await rename(stage,output);}catch(error){
   if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;
   const stat=await lstat(output);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Keep the original complete output directory.');
   if(JSON.stringify(await members(output))!==JSON.stringify(selected.map(f=>f.path).sort()))throw Error('The existing output directory selects different complete members.');
   for(const file of selected){const bytes=await regular(join(output,file.path)),identity=sha256Bytes(bytes);if(identity.bytes!==file.bytes||identity.sha256!==file.sha256)throw Error('The retained output differs: '+file.path);}
  }
  return{directory:output,files:selected};
 }finally{await rm(stage,{recursive:true,force:true});}
}
export async function build({out,workspacePath=null,copyId=null,sourceRoot=null}){
 const source=await loadSource(sourceRoot||dirname(fileURLToPath(import.meta.url))),record=workspacePath?Portable.parseRecovery(await sourceText(resolve(workspacePath))):null;
 if(record&&copyId)record.copyId=copyId;
 const text=(path,type,body)=>({path,type,text:body,...sha256Utf8(body)});
 const files=record?Portable.completeFiles(source,record):[text('Harbour_Source_Workspace.html','text/html',Portable.workingHTML(source)),text('START_HERE.txt','text/plain','Open Harbour_Source_Workspace.html. This reusable application begins empty. Keep this complete directory and its source together. The supplied source has no customer records. See source/harbour-source-workspace/README.md for exact controls and full exit.\n'),...Object.entries(source).map(([name,body])=>text('source/'+Portable.sourcePath(name),'text/plain',body))];
 const zip=Portable.zipBytes(files),manifest={schema:'commons.harbour-source-build.v1',workspaceId:record?.workspace.id||null,revision:record?.workspace.revision||0,copyId:record?.copyId||null,files:files.map(({path,type,bytes,sha256})=>({path,type,bytes,sha256})),zip:{path:resolve(out)+'.zip',...sha256Bytes(zip)}};
 // The complete selected directory is published atomically; a lost archive reply resumes create-only.
 const directory=await publishDirectory(out,[...files,text('BUILD.json','application/json',Portable.json(manifest))]);
 // ZIP is outside the immutable member directory so repeated directory comparison remains exact.
 const archive=await publishFile(resolve(out)+'.zip',zip);
 return{...manifest,...directory,archive};
}
function flags(argv){const out={};for(let i=0;i<argv.length;i+=2){if(!['--out','--workspace','--copy-id'].includes(argv[i])||!argv[i+1]||out[argv[i]])throw Error('Usage: node build.mjs --out NEW_DIRECTORY [--workspace COMPLETE_JSON] [--copy-id ORIGINAL_COPY_ID]');out[argv[i]]=argv[i+1];}if(!out['--out'])throw Error('Supply a new complete --out directory.');return out;}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{const args=flags(process.argv.slice(2));console.log(Portable.json(await build({out:args['--out'],workspacePath:args['--workspace'],copyId:args['--copy-id']})));}catch(error){console.error(error.message);process.exitCode=1;}}
