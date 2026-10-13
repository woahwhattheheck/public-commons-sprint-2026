import {readFile,mkdir,writeFile,rename,rm,lstat,open} from 'node:fs/promises';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {sha256Utf8,sha256Bytes} from './sha256.mjs';

import {base64Decode,sourcePath,parseRecovery,workingHTML,completeFiles,zipBytes,json} from './portable.mjs';

export const SOURCE_FILES=['engine.mjs','sha256.mjs','portable.mjs','app.mjs','style.css','template.html','build.mjs','cli.mjs','README.md','BROWSER_OPERATING.md','API.md','CORE_OPERATING.md','templates/observations.csv','run_browser_receiving.mjs'];
export async function loadSource(root=dirname(fileURLToPath(import.meta.url))){
  const source={};
  for(const path of SOURCE_FILES){const full=join(root,path),stat=await lstat(full);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Use the complete regular source file '+path+'.');source[path]=await readFile(full,'utf8');}
  const helper=join(root,'..','migration-receiving','continuation.mjs'),stat=await lstat(helper);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Retain the original migration receiving helper.');source['migration-receiving/continuation.mjs']=await readFile(helper,'utf8');
  return source;
}
function bytes(file){return file.base64!==undefined?base64Decode(file.base64):new TextEncoder().encode(file.content);}
export async function publishFile(path,data){
  const output=resolve(path),body=typeof data==='string'?new TextEncoder().encode(data):data;await mkdir(dirname(output),{recursive:true});
  const temp=output+'.'+randomUUID()+'.tmp';let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;
    // Link publishes create-only; retain an identical completed output after a lost reply.
    const {link}=await import('node:fs/promises');
    try{await link(temp,output);}catch(e){if(e.code!=='EEXIST')throw e;const stat=await lstat(output);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Existing output is not an original regular file: '+output);const previous=await readFile(output);if(sha256Bytes(previous).sha256!==sha256Bytes(body).sha256)throw Error('The existing output contains different original bytes: '+output);}
    return{path:output,...sha256Bytes(body)};
  }finally{await handle?.close().catch(()=>{});await rm(temp,{force:true});}
}
export async function publishDirectory(directory,files){
  const out=resolve(directory),parent=dirname(out);await mkdir(parent,{recursive:true});
  const stage=out+'.'+randomUUID()+'.tmp';await mkdir(stage,{mode:0o700});
  const manifest=[];
  try{
    const names=new Set();
    for(const file of files){
      if(typeof file.path!=='string'||file.path.includes('\\')||file.path.startsWith('/')||file.path.split('/').some(x=>!x||x==='.'||x==='..')||names.has(file.path))throw Error('Use distinct complete relative output paths.');
      names.add(file.path);const data=bytes(file);const target=resolve(stage,file.path);if(relative(stage,target).startsWith('..'+sep))throw Error('Output path escapes the complete package.');
      await mkdir(dirname(target),{recursive:true});const handle=await open(target,'wx',0o600);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
      manifest.push({path:file.path,...sha256Bytes(data)});
    }
    try{await rename(stage,out);}catch(e){
      if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;
      const stat=await lstat(out);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('The original output destination is not a regular directory.');
      // A completed same-operation directory is adopted only after all original selected bytes match.
      for(const file of manifest){const target=join(out,file.path),stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('A saved complete output is not regular: '+target);const retained=await readFile(target);if(retained.length!==file.bytes||sha256Bytes(retained).sha256!==file.sha256)throw Error('A saved complete output differs: '+target);}
    }
    return{directory:out,files:manifest};
  }finally{await rm(stage,{recursive:true,force:true});}
}
export async function build({out,workspacePath=null,copyId=null,sourceRoot=null}){
  const source=await loadSource(sourceRoot||dirname(fileURLToPath(import.meta.url)));
  const record=workspacePath?parseRecovery(await readFile(resolve(workspacePath),'utf8')):null;
  if(record&&copyId)record.copyId=copyId;
  const files=record?completeFiles(source,record):[
    {path:'Tourism_Series_Workspace.html',content:workingHTML(source)},
    ...Object.entries(source).map(([path,content])=>({path:'source/'+sourcePath(path),content}))
  ];
  const archive=zipBytes(files);
  // Large archive bytes are passed directly, not through the original-file decoder's 32 MiB cap.
  const result=await publishDirectory(out,files);
  const zip=await publishFile(join(result.directory,'Tourism_Series_Complete.zip'),archive);
  return{schema:'commons.tourism-series-build.v1',...result,zip,workspaceId:record?.workspace.id||null,revision:record?.workspace.revision||0};
}
function flags(argv){const result={};for(let i=0;i<argv.length;i+=2){if(!['--out','--workspace','--copy-id'].includes(argv[i])||!argv[i+1]||result[argv[i]])throw Error('Usage: node build.mjs --out NEW_DIRECTORY [--workspace WORKING_JSON] [--copy-id ORIGINAL_BROWSER_COPY_ID]');result[argv[i]]=argv[i+1];}if(!result['--out'])throw Error('Supply --out NEW_DIRECTORY.');return result;}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const args=flags(process.argv.slice(2));console.log(json(await build({out:args['--out'],workspacePath:args['--workspace'],copyId:args['--copy-id']})));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
