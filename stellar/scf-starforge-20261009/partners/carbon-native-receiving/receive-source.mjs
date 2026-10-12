// MIT. Receive the complete original source parcel into one NEW private directory.
// Run: node --input-type=module - DOWNLOADS NEW_SOURCE_ROOT < receive-source.mjs.txt
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,relative,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const [inputArg,outputArg]=process.argv.slice(2);
if(!inputArg||!outputArg)throw new Error('Provide the download directory and a new private source directory.');
const input=resolve(inputArg),output=resolve(outputArg);
const read=async name=>readFile(join(input,name),'utf8');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const gitBlob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
const check=(value,message)=>{if(!value)throw new Error(message);};
const manifest=JSON.parse(await read('carbon-native-source-manifest.json'));
check(manifest.schema==='stellar-forge.native-source-manifest.v1','Use the complete original source manifest.');
try{await lstat(output);throw new Error('Choose a new directory; existing work will not be replaced.');}
catch(error){if(error.code!=='ENOENT')throw error;}
const inventory=new Map(manifest.files.map(row=>[row.path,row])),files=new Map();
for(const part of manifest.parts){
  const content=await read(part.name);
  check(Buffer.byteLength(content)===part.bytes&&gitBlob(content)===part.gitBlobSha1,'Source part changed: '+part.name);
  const source=JSON.parse(content);
  check(source.schema==='stellar-forge.native-source-part.v1','Invalid source part: '+part.name);
  for(const file of source.files){
    const expected=inventory.get(file.path);
    check(expected&&!files.has(file.path),'Unexpected or duplicate original file: '+file.path);
    check(typeof file.content==='string'&&Buffer.byteLength(file.content)===expected.bytes&&gitBlob(file.content)===expected.gitBlobSha1,
      'Original file content changed: '+file.path);
    const target=resolve(output,file.path),local=relative(output,target);
    check(local&&!local.startsWith('..')&&!isAbsolute(local)&&!file.path.includes('\\'),'Unsafe source path.');
    files.set(file.path,file.content);
  }
}
check(files.size===inventory.size,'A complete source part is missing.');
const handoverParts=[];
for(const name of manifest.handover.parts){
  const part=JSON.parse(await read(name));
  check(part.schema==='stellar-forge.text-artifact-part.v1'&&part.wholeSha256===manifest.handover.sha256,
    'Use the matching full handover parts.');
  check(typeof part.content==='string'&&Buffer.byteLength(part.content)===part.partBytes&&sha256(part.content)===part.partSha256,
    'Handover part changed: '+name);
  handoverParts.push(part);
}
handoverParts.sort((a,b)=>a.part-b.part);
check(handoverParts.every((row,i)=>row.part===i+1&&row.parts===handoverParts.length),'A handover part is missing or repeated.');
const handover=handoverParts.map(row=>row.content).join('');
check(Buffer.byteLength(handover)===manifest.handover.bytes&&sha256(handover)===manifest.handover.sha256,'The whole editable handover changed.');
const saved=JSON.parse(handover);
check(saved.schema==='stellar-forge.stellarcarbon-handover.v1','Use the complete editable Stellarcarbon handover.');
await mkdir(output,{mode:0o700});
for(const [path,content] of files){await mkdir(dirname(join(output,path)),{recursive:true,mode:0o700});await writeFile(join(output,path),content,{flag:'wx',mode:0o600});}
await mkdir(join(output,'receiving'),{recursive:true,mode:0o700});
await writeFile(join(output,'receiving','stellarcarbon-current-handover.json'),handover,{flag:'wx',mode:0o600});
await writeFile(join(output,'receiving','source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({sourceRoot:output,sourceCommit:manifest.sourceCommit,files:files.size,handoverBytes:Buffer.byteLength(handover),
  nextCommand:'node '+join(output,'receiving','receive-native.mjs')+' --source-root '+output+' --output NEW_PRIVATE_RUN_DIRECTORY'},null,2));
