#!/usr/bin/env node
/** Reassemble the complete original saved-load comparison from bounded source parts. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const need=(v,m)=>{if(!v)throw Error(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function relative(name){
 need(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&!name.includes('\0'),'Use an ordinary relative source path');
 need(name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/[<>:"|?*\u0000-\u001f]/.test(p)&&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)),'Unsafe source path: '+name);return name;
}
function sync(name){if(process.platform==='win32')return;const fd=fs.openSync(name,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function directory(name){
 if(!fs.existsSync(name)){directory(path.dirname(name));fs.mkdirSync(name,{mode:0o700});sync(path.dirname(name));}
 const s=fs.lstatSync(name);need(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(name)===name,'Use a real ordinary directory: '+name);
 return name;
}
function checkedFile(root,name){relative(name);const full=path.join(root,...name.split('/'));let parent=root;for(const part of name.split('/').slice(0,-1)){parent=path.join(parent,part);const s=fs.lstatSync(parent);need(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(parent)===parent,'Source directory changed: '+parent);}return full;}
const identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
function read(name,limit,expected){
 const fd=fs.openSync(name,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const a=fs.fstatSync(fd);need(a.isFile()&&a.size<=limit,'Expected a bounded regular file: '+name);const b=fs.readFileSync(fd),end=fs.fstatSync(fd);
 need(identity(a)===identity(end)&&identity(end)===identity(fs.lstatSync(name)),'Source changed while reading: '+name);
 if(expected)need(b.length===expected.bytes&&sha(b)===expected.sha256,'Original file differs: '+name);return b;
 }finally{fs.closeSync(fd);}
}
function original(name,body,expected){
 directory(path.dirname(name));need(body.length===expected.bytes&&sha(body)===expected.sha256,'Output identity differs: '+name);
 if(fs.existsSync(name)){read(name,expected.bytes,expected);return;}
 const temp=path.join(path.dirname(name),'.load-receive-'+randomUUID());let fd,owned=false,error;
 try{fd=fs.openSync(temp,'wx',0o600);owned=true;fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
 try{fs.linkSync(temp,name);}catch(e){if(e.code!=='EEXIST')throw e;read(name,expected.bytes,expected);}
 }catch(e){error=e;}finally{
 if(fd!==undefined)try{fs.closeSync(fd);}catch(e){if(!error)error=e;}
 if(owned)try{fs.unlinkSync(temp);sync(path.dirname(name));}catch(e){if(!error)error=e;else error.cleanup_error=String(e);}
 }
 if(error)throw error;
}
function parse(b){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}
function base64(s){need(typeof s==='string'&&s.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(s),'Retain canonical base64');const b=Buffer.from(s,'base64');need(b.toString('base64')===s,'Noncanonical source base64');return b;}
function descriptor(d,maximum=128*1024*1024){need(d&&Number.isSafeInteger(d.bytes)&&d.bytes>=0&&d.bytes<=maximum&&validHash(d.sha256),'Retain the complete bounded byte identity');}
const opts={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];need(['--manifest','--output'].includes(k)&&v&&!v.startsWith('--')&&!opts[k],'Use --manifest SOURCE/transport.json --output NEW_DIRECTORY');opts[k]=v;}
need(opts['--manifest']&&opts['--output'],'Use --manifest SOURCE/transport.json --output NEW_DIRECTORY');
const manifestPath=path.resolve(opts['--manifest']),source=path.dirname(manifestPath),out=path.resolve(opts['--output']);directory(source);
const related=(a,b)=>{const r=path.relative(a,b);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
need(!related(source,out)&&!related(out,source),'Keep output separate from its complete source');
const raw=read(manifestPath,4*1024*1024),manifest=parse(raw);
need(manifest.schema==='upstate.flow-load-comparison-source-transport/v1'&&Array.isArray(manifest.files)&&manifest.files.length===30,'Select the complete30-file comparison transport');
need(validHash(manifest.id)&&validHash(manifest.selection?.before_id)&&validHash(manifest.selection?.after_id)&&manifest.selection.expected_comparison_id===manifest.id,'Retain the original pair and comparison identity');
const names=new Set(),parts=new Set();let total=0;
for(const file of manifest.files){
 relative(file.path);descriptor(file);const lower=file.path.toLowerCase();need(!names.has(lower)&&!['.receiving-source.json','received.json'].includes(lower),'Duplicate/reserved product path');names.add(lower);total+=file.bytes;
 descriptor(file.source_bank);need(Array.isArray(file.source_bank.parts)&&file.source_bank.parts.length>0,'Retain all ordered source pieces');
 let offset=0;for(const part of file.source_bank.parts){relative(part.path);descriptor(part,8*1024*1024);descriptor(part.decoded,4*1024*1024);descriptor(part.gzip,8*1024*1024);need(part.offset===offset&&!parts.has(part.path.toLowerCase()),'Repeated or unordered source piece');parts.add(part.path.toLowerCase());offset+=part.decoded.bytes;}
 need(offset===file.source_bank.bytes,'Source bank part lengths differ');
}
for(const name of names){let p=name.split('/');p.pop();while(p.length){need(!names.has(p.join('/')),'Product file is also a directory');p.pop();}}
need(total===manifest.total_bytes&&names.has('manifest.json'),'Complete product size or manifest differs');
directory(out);const identityPath=path.join(out,'.receiving-source.json');
if(!fs.existsSync(identityPath))need(fs.readdirSync(out).length===0,'Use a fresh output directory; resume only its original bound comparison');
const binding=json({schema:'upstate.flow-load-comparison-receiving/v1',transport:{bytes:raw.length,sha256:sha(raw)},id:manifest.id,selection:manifest.selection});
original(identityPath,binding,{bytes:binding.length,sha256:sha(binding)});
const deferred=new Map(),defer=new Set(['report.html','load-comparison.json','load-comparison.csv','load-comparison-selection.json','README.txt','manifest.json']);
for(const file of manifest.files){
 const chunks=[];for(let at=0;at<file.source_bank.parts.length;at++){
  const part=file.source_bank.parts[at],envelope=parse(read(checkedFile(source,part.path),part.bytes,part));
  need(envelope.schema==='commons.artifact-base64/v1'&&envelope.encoding==='gzip+base64'&&envelope.part===at+1&&envelope.parts===file.source_bank.parts.length&&envelope.offset===part.offset,'Source piece selection differs');
  need(envelope.original_bytes===part.decoded.bytes&&envelope.original_sha256===part.decoded.sha256&&envelope.gzip_bytes===part.gzip.bytes&&envelope.gzip_sha256===part.gzip.sha256,'Source piece identity differs');
  const compressed=base64(envelope.content_base64);need(compressed.length===part.gzip.bytes&&sha(compressed)===part.gzip.sha256,'Compressed source piece differs');
  const decoded=gunzipSync(compressed,{maxOutputLength:part.decoded.bytes});need(decoded.length===part.decoded.bytes&&sha(decoded)===part.decoded.sha256,'Decoded source piece differs');chunks.push(decoded);
 }
 const bytes=Buffer.concat(chunks);need(bytes.length===file.source_bank.bytes&&sha(bytes)===file.source_bank.sha256,'Complete source bank differs');
 const bank=parse(bytes);need(bank.schema==='commons.source-text-bank/v1'&&bank.file_count===1&&Array.isArray(bank.files)&&bank.files.length===1,'Select the original one-file source bank');
 const originalFile=bank.files[0];need(originalFile.path===file.path&&originalFile.bytes===file.bytes&&originalFile.sha256===file.sha256&&typeof originalFile.content==='string','Original selected file differs');
 const body=Buffer.from(originalFile.content,'utf8');need(body.length===file.bytes&&sha(body)===file.sha256,'Original complete body differs');
 if(file.path==='manifest.json'){
  const product=parse(body),expected=manifest.files.filter(f=>f.path!=='manifest.json').map(({path,bytes,sha256})=>({path,bytes,sha256}));
  need(product.schema==='upstate.complete-flow-load-comparison-files/v1'&&product.id===manifest.id&&same(product.selection,manifest.selection)&&same(product.files,expected),'Original product manifest or member order differs');
 }
 if(defer.has(file.path))deferred.set(file.path,{file,body});else original(path.join(out,...file.path.split('/')),body,file);
 process.stderr.write('Received '+file.path+' ('+file.bytes+' bytes)\n');
}
for(const name of ['load-comparison-selection.json','load-comparison.json','load-comparison.csv','README.txt','report.html','manifest.json']){
 const item=deferred.get(name);need(item,'Missing final product entry '+name);original(path.join(out,name),item.body,item.file);
}
const result={schema:'upstate.flow-load-comparison-receiving/v1',state:'complete',id:manifest.id,selection:manifest.selection,transport:{bytes:raw.length,sha256:sha(raw)},files:30,bytes:total,index:'report.html'};
const body=json(result);original(path.join(out,'RECEIVED.json'),body,{bytes:body.length,sha256:sha(body)});sync(out);process.stdout.write(JSON.stringify({...result,directory:out,node:process.version},null,2)+'\n');
