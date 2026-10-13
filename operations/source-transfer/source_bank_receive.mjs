#!/usr/bin/env node
/** Materialize source changes into a fresh copy of an existing application. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createSourceBankComposer}=require('./source_bank_compose.cjs');
const {createSourceCarrierCodec}=require('./v8_source_carrier_codec.cjs');
const codec=createSourceCarrierCodec();
const textDecoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const MAX=64*1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const identify=s=>{codec.identity(s,{maxBytes:MAX});const b=Buffer.from(s,'utf8');return{bytes:b.length,sha256:sha(b)};};
const usage='node source_bank_receive.mjs --application DIR --bank BANK.json --expect DECODED_SHA256 [--bank BANK2.json --expect SHA256] --source-prefix REPO/APP --output FRESH_DIR [--operation-id ID] [--plan]';
function readRegular(file,limit=MAX){
  const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Expected regular file: '+file);
  if(s.size>limit)throw Error('File exceeds '+limit+' bytes: '+file);
  const b=fs.readFileSync(file);if(b.length>limit)throw Error('File grew beyond size limit: '+file);return b;
}
function safeMember(root,member){
  if(typeof member!=='string'||!member||member.includes('\\')||member.includes('\0')||/^[A-Za-z]:/.test(member)||member.startsWith('/')||member.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Unsafe source path');
  const parts=member.split('/');let current=root;
  for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);if(fs.existsSync(current)){const st=fs.lstatSync(current);if(st.isSymbolicLink()||(i<parts.length-1&&!st.isDirectory()))throw Error('Source path crosses link/non-directory: '+member);}}
  return path.join(root,...parts);
}
function parseArgs(argv){
  const options={banks:[],sourcePrefix:'',plan:false};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];if(key==='--plan'){options.plan=true;continue;}if(key==='--help'){console.log(usage);return null;}
    const value=argv[++i];if(!value||value.startsWith('--'))throw Error('Missing value for '+key);
    if(key==='--bank')options.banks.push({file:value});
    else if(key==='--expect'){const item=options.banks.at(-1);if(!item||item.sha256||!/^[a-f0-9]{64}$/.test(value))throw Error('--expect must follow its --bank');item.sha256=value;}
    else {const names={'--application':'application','--source-prefix':'sourcePrefix','--output':'output','--operation-id':'operationId'};if(!names[key]||options[names[key]]&&names[key]!=='sourcePrefix')throw Error('Unknown/repeated option: '+key);options[names[key]]=value;}
  }
  if(!options.application||!options.banks.length||options.banks.some(b=>!b.sha256)||(!options.plan&&!options.output))throw Error(usage);
  return options;
}
function loadBank(item){
  const raw=readRegular(item.file),container=JSON.parse(textDecoder.decode(raw));
  const body=container.schema==='commons.artifact-base64/v1'?codec.decodeText(container,{maxBytes:MAX,maxCompressedBytes:MAX}):textDecoder.decode(raw);
  const actual=identify(body);if(actual.sha256!==item.sha256)throw Error('Decoded bank SHA256 differs: '+item.file);
  return {bank:JSON.parse(body),receipt:{file:path.resolve(item.file),...actual}};
}
function enumerateFiles(root){
  const found=[];
  function visit(dir,relative=''){
    for(const name of fs.readdirSync(dir).sort()){const full=path.join(dir,name),local=relative?relative+'/'+name:name,stat=fs.lstatSync(full);if(stat.isSymbolicLink())throw Error('Application contains a symlink; use its existing real source tree: '+local);if(stat.isDirectory())visit(full,local);else if(stat.isFile())found.push({path:local,stat});else throw Error('Application contains a special file: '+local);}
  }
  visit(root);return found;
}
function run(options){
  const application=fs.realpathSync(options.application);if(!fs.statSync(application).isDirectory())throw Error('--application must be a directory');
  const loaded=options.banks.map(loadBank),composer=createSourceBankComposer({identity:identify}),prefix=options.sourcePrefix.replace(/\/$/,''),current=Object.create(null);
  for(const entry of loaded){
    composer.validateBank(entry.bank);
    for(const f of entry.bank.files){
      if(prefix&&!f.path.startsWith(prefix+'/'))throw Error('Member outside requested source prefix: '+f.path);
      const local=prefix?f.path.slice(prefix.length+1):f.path,dest=safeMember(application,local);
      if(fs.existsSync(dest)){const bytes=readRegular(dest);current[local]={content:textDecoder.decode(bytes),mode:fs.statSync(dest).mode&0o777};}
    }
  }
  const plan=composer.compose({banks:loaded.map(x=>x.bank),current,sourcePrefix:prefix});
  const receipt={schema:'commons.source-receiving/v1',operation_id:options.operationId||null,application,banks:loaded.map(x=>x.receipt),changes:plan.changes.map(({content,...rest})=>rest),steps:plan.steps};
  if(options.plan){console.log(JSON.stringify({...receipt,state:'planned'},null,2));return;}
  const requested=path.resolve(options.output),parent=fs.realpathSync(path.dirname(requested)),output=path.join(parent,path.basename(requested)),relative=path.relative(application,output);
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Output must be outside the original application');
  if(fs.existsSync(output))throw Error('Output already exists: '+output);
  const originals=enumerateFiles(application);
  // mkdir is the exclusive claim. All source-bank and anchor checks precede it.
  fs.mkdirSync(output,{mode:0o700});
  let copied=0;
  try{
    for(const entry of originals){
      const source=safeMember(application,entry.path),bytes=readRegular(source,MAX),target=path.join(output,...entry.path.split('/'));
      if(Object.prototype.hasOwnProperty.call(current,entry.path)&&sha(bytes)!==identify(current[entry.path].content).sha256)throw Error('Source changed during receiving: '+entry.path);
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx',mode:entry.stat.mode&0o777});copied++;
    }
    for(const change of plan.changes){
      const target=path.join(output,...change.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});
      if(fs.existsSync(target))fs.unlinkSync(target);
      const mode=typeof change.mode==='number'?change.mode:change.mode?parseInt(String(change.mode).slice(-3),8):0o644;
      fs.writeFileSync(target,change.content,{encoding:'utf8',flag:'wx',mode});
      const bytes=readRegular(target);if(bytes.length!==change.bytes||sha(bytes)!==change.sha256)throw Error('Written source differs: '+change.path);
    }
    console.log(JSON.stringify({...receipt,state:'source-staged',output,copied_files:copied,changed_files:plan.changes.length},null,2));
  }catch(error){
    // The exclusive new output remains available for diagnosis. The original
    // application and Workspace are never changed by this receiver.
    error.message+='; incomplete fresh output: '+output;throw error;
  }
}
try{const options=parseArgs(process.argv.slice(2));if(options)run(options);}catch(error){console.error(error.message);process.exitCode=1;}
