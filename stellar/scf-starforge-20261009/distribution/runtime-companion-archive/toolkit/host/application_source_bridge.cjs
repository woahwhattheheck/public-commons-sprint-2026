#!/usr/bin/env node
'use strict';
// Compose the maintained collector through its public API; never load application modules.
const fs=require('node:fs'),path=require('node:path');
const api=require('./source_closure_cli.cjs');
const closure=require('./connected_javascript_source_closure.cjs');
const acorn=require('./vendor/acorn-source-closure/acorn.cjs');
function stable(v){return Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);}
function read(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size>256*1024*1024)throw Error('Select an ordinary bounded request file');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function main(){
 const args=process.argv.slice(2);
 if(args.length!==4||args[0]!=='--request'||args[2]!=='--response')throw Error('Use --request FILE --response NEW_FILE');
 const request=read(args[1]);
 if(!['collect','inspect'].includes(request.command))throw Error('Choose collect or inspect');
 const allowed=request.command==='collect'?['command','root','spec','output']:['command','input'];
 if(Object.keys(request).some(k=>!allowed.includes(k))||allowed.some(k=>typeof request[k]!=='string'||!request[k]))throw Error('Use the complete original command arguments');
 if(request.command==='inspect'){
  const packet=read(request.input);
  const actual=closure.inspectSourceClosure({files:packet.files,routes:packet.routes||[],
   resources:packet.selection?.resources||[],limits:packet.coverage?.limits,parse:acorn.parse,identify:api.identify});
  for(const key of ['files','routes','resolved','external','computed','errors','pending','coverage']){
   if(stable(actual[key])!==stable(packet[key]))throw Object.assign(Error('Original JavaScript analysis differs: '+key),{code:'APPLICATION_JAVASCRIPT_ANALYSIS'});
  }
 }
 const result=api[request.command](request);
 const fd=fs.openSync(path.resolve(args[3]),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
try{main();}catch(error){process.stderr.write(JSON.stringify({status:'ERROR',code:error.code||error.name,message:String(error.message||error),detail:error.detail})+'\n');process.exitCode=1;}
