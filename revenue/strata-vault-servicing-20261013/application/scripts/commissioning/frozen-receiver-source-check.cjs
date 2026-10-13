'use strict';
async function runFrozenReceiverCheck(files,loadModules,sha,encode64){
 const enc=s=>{const a=[];for(const c of unescape(encodeURIComponent(s)))a.push(c.charCodeAt(0));return new Uint8Array(a)};
 class Bytes extends Uint8Array{toString(kind='utf8'){if(kind==='base64')return encode64(this.toString());let p='';for(const b of this)p+='%'+b.toString(16).padStart(2,'0');return decodeURIComponent(p)}equals(b){return this.length===b.length&&this.every((v,i)=>v===b[i])}}
 const Buffer={from:s=>new Bytes(typeof s==='string'?enc(s):s),isBuffer:s=>s instanceof Bytes};
 const normalize=p=>{const a=[];for(const part of p.split('/'))if(part==='..')a.pop();else if(part&&part!=='.')a.push(part);return'/'+a.join('/')};
 const resolve=(...p)=>normalize(p.join('/')),join=resolve,dirname=p=>p.slice(0,p.lastIndexOf('/'))||'/',relative=(a,b)=>b.startsWith(a+'/')?b.slice(a.length+1):'../outside',sep='/';
 const disk=new Map(),dirs=new Set(['/','/repo','/repo/scripts','/repo/scripts/commissioning','/private','/private/course']);let serial=0,fail=null,networkCalls=0;
 const error=(code)=>Object.assign(Error(code),{code});const stat=(path)=>({size:disk.get(path)?.length||0,mode:dirs.has(path)?0o40700:0o100600,isDirectory:()=>dirs.has(path),isFile:()=>disk.has(path),isSymbolicLink:()=>false});
 const fds=new Map();
 const fs={constants:{O_RDONLY:1,O_WRONLY:2,O_CREAT:4,O_EXCL:8,O_NOFOLLOW:16,O_DIRECTORY:32},mkdirSync(p){if(dirs.has(p)||disk.has(p))throw error('EEXIST');if(!dirs.has(dirname(p)))throw error('ENOENT');dirs.add(p)},lstatSync(p){if(!dirs.has(p)&&!disk.has(p))throw error('ENOENT');return stat(p)},realpathSync(p){if(!dirs.has(p)&&!disk.has(p))throw error('ENOENT');return p},existsSync:p=>dirs.has(p)||disk.has(p),openSync(p,flags){if(flags&4){if(disk.has(p)&&flags&8)throw error('EEXIST');disk.set(p,Buffer.from(''))}else if(!disk.has(p)&&!dirs.has(p))throw error('ENOENT');const id=++serial;fds.set(id,p);return id},fstatSync:id=>stat(fds.get(id)),readFileSync:id=>{const p=typeof id==='number'?fds.get(id):id;if(!disk.has(p))throw error('ENOENT');return Buffer.from(disk.get(p))},writeFileSync(id,b){disk.set(fds.get(id),Buffer.from(b))},fsyncSync(){},closeSync:id=>fds.delete(id),linkSync(a,b){if(fail===b){fail=null;throw Error('synthetic interrupted publication')}if(disk.has(b))throw error('EEXIST');disk.set(b,Buffer.from(disk.get(a)))},unlinkSync:p=>disk.delete(p)};
 const current='/repo/scripts/commissioning';for(const[p,body]of Object.entries(files))disk.set('/repo/'+p,Buffer.from(body));
 const createHash=()=>{let input='';return{update(b){input+=typeof b==='string'?b:b.toString();return this},digest:()=>sha(input)}};
 async function loadCLI(dir){
  const map={};for(const n of ['selection.mjs','capture.mjs','report.mjs'])map['scripts/commissioning/'+n]=disk.get(dir+'/'+n).toString();
  const core=loadModules(map,sha,encode64),text=disk.get(dir+'/cli.mjs').toString().replace(/^#![^\n]*\n/,'').replace(/^import .*?;\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url',JSON.stringify('file://'+dir+'/cli.mjs')).replaceAll('await import(','await importModule(');
  const args={fs,resolve,join,dirname,relative,sep,fileURLToPath:u=>u.replace(/^file:\/\//,''),pathToFileURL:p=>({href:'file://'+p}),randomUUID:()=> 'uuid-'+(++serial),createHash,...core,createStellarTransport:async()=>{networkCalls++;throw Error('No native transport in this fixture')},Buffer,process:{platform:'linux',argv:[]},console:{log(){},error(){}},importModule:async url=>loadCLI(dirname(url.replace(/^file:\/\//,'')))};
  return new Function(...Object.keys(args),text+';return {main,retainOriginalReceiver,receiverManifest,expectedArtifacts};')(...Object.values(args));
 }
 const first=await loadCLI(current);
 fail='/private/course/.receiver/report.mjs';let interrupted=false;
 try{first.retainOriginalReceiver('/private/course',true)}catch{interrupted=true}if(!interrupted||!disk.has('/private/course/.receiver-source.json'))throw Error('Full original source not retained before interrupted materialization.');
 const original=JSON.parse(disk.get('/private/course/.receiver-source.json').toString());
 disk.set(current+'/report.mjs',Buffer.from(files['scripts/commissioning/report.mjs'].replace('Read-only commissioning review','FOLLOWING EDITION')));
 first.retainOriginalReceiver('/private/course',true);
 if(disk.get('/private/course/.receiver/report.mjs').toString()!==files['scripts/commissioning/report.mjs'])throw Error('Original receiver not restored after upgrade.');
 const core=loadModules(files,sha,encode64),checkModule={exports:{}};
 new Function('module','exports',files['scripts/commissioning/source-checks.cjs'])(checkModule,checkModule.exports);
 const executed=await checkModule.exports.runCommissioningSourceChecks(core,JSON.parse(files['scripts/commissioning/selection.example.json']),JSON.parse(files['scripts/commissioning/SOURCE_ANCHORS.json']));
 const cap=executed.illustrativeCapture;cap.receiverSource=original.files.map(({content,...m})=>m);delete cap.sha256;cap.sha256=core.hash(cap);
 disk.set('/private/course/complete.json',Buffer.from(JSON.stringify(cap)));disk.set('/private/course/request.json',Buffer.from(JSON.stringify(cap.request)));
 const upgraded=await loadCLI(current);fail='/private/course/report/report.html';interrupted=false;
 try{await upgraded.main(['render','--output','/private/course'])}catch(e){interrupted=true}
 if(!interrupted||!disk.has('/private/course/report/ARTIFACTS.json'))throw Error('Artifact interruption was not retained.');
 const resumed=await upgraded.main(['render','--output','/private/course']);const checked=await upgraded.main(['verify','--output','/private/course']);
 const html=disk.get('/private/course/report/report.html').toString();if(html.includes('FOLLOWING EDITION')||!html.includes('Read-only commissioning review'))throw Error('Renderer upgrade changed original report.');
 // A co-edited report+manifest must not masquerade as original rendered output.
 disk.set('/private/course/report/report.html',Buffer.from('changed report'));
 const manifest=JSON.parse(disk.get('/private/course/report/ARTIFACTS.json').toString());const row=manifest.files.find(r=>r.path==='report.html');row.bytes=Buffer.from('changed report').length;row.sha256=sha('changed report');disk.set('/private/course/report/ARTIFACTS.json',Buffer.from(JSON.stringify(manifest)));
 let rejected=false;try{await upgraded.main(['verify','--output','/private/course'])}catch{rejected=true}
 if(!rejected||networkCalls!==0)throw Error('Artifact verification failed integrity/no-network boundary.');
 return{schema:'strata.commissioning-original-renderer-course/v1',nativeExecuted:false,providerCalls:0,filesystem:'in-memory NodeFS contract fixture; no physical permission claim',actualCLIAndModuleBodies:true,checks:['Interrupted full-source materialization recovers original bodies after installed report upgrade','Artifact-only retry routes through exact original receiver','Manifest-first interrupted report publishing resumes the original renderer','Complete four-artifact verification succeeds','Co-edited report+manifest rejected by original renderer recomputation'],resumeStatus:resumed.status,verifyStatus:checked.status};
}
module.exports={runFrozenReceiverCheck};
