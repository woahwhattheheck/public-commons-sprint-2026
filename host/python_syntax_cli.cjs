#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {TextDecoder}=require('node:util');
const {sha256Utf8}=require('./connected_sha256.cjs');
const {PARSER,LIMITS,createPythonSyntaxInspector}=require('./connected_python_syntax.cjs');
const HELP='Parse retained Python source without running the selected application.\n\n'+
 '  node host/python_syntax_cli.cjs --input COMPLETE_SOURCE.json [--repository owner/name] [--path source.py ...] [--expected-sha256 SHA]\n\n'+
 'Uses the exact included Skulpt Python 3 grammar. This is not CPython AST, semantic compilation, dependency collection or native execution.\n'+
 'No network, package installation, source import or source-file mutation occurs.\n'+
 'Exit0: all selected source accepted by this parser. Exit2: parser did not accept selected source. Exit1: input/identity/adapter error.\n';
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function readSource(file,maximum){
 const fd=fs.openSync(path.resolve(file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.size>maximum)fail('PYTHON_SOURCE_FILE','Select a complete bounded regular source file.');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)break;offset+=count;}
  const after=fs.fstatSync(fd),named=fs.lstatSync(path.resolve(file)),extra=Buffer.alloc(1);
  if(offset!==before.size||fs.readSync(fd,extra,0,1,offset)!==0||before.size!==after.size||
   before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||
   named.dev!==before.dev||named.ino!==before.ino||named.isSymbolicLink())
    fail('PYTHON_SOURCE_CHANGED','The selected complete source changed while being read.');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 }finally{fs.closeSync(fd);}
}
function argumentsFor(argv){
 if(argv.length===0||argv.length===1&&['--help','help'].includes(argv[0]))return{help:true};
 const result={paths:[]},names={'--input':'input','--repository':'repository','--expected-sha256':'expectedPacketSha256'};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i],value=argv[++i];
  if(typeof value!=='string'||!value||value.startsWith('--'))fail('PYTHON_SYNTAX_ARGUMENT','Supply each complete argument value.');
  if(flag==='--path')result.paths.push(value);
  else{
   const name=names[flag];if(!name||Object.prototype.hasOwnProperty.call(result,name))fail('PYTHON_SYNTAX_ARGUMENT','Unknown or repeated argument.');
   result[name]=value;
  }
 }
 if(!result.input)fail('PYTHON_SYNTAX_ARGUMENT','Select the complete original source packet.');
 if(!result.paths.length)delete result.paths;
 return result;
}
function main(argv=process.argv.slice(2)){
 try{
  const input=argumentsFor([...argv]);if(input.help){process.stdout.write(HELP);return 0;}
  const source=readSource(path.join(__dirname,'vendor/skulpt-syntax/skulpt.min.js'),PARSER.source_bytes);
  const identity=sha256Utf8(source);
  if(identity.bytes!==PARSER.source_bytes||identity.sha256!==PARSER.source_sha256)
   fail('PYTHON_PARSER_IDENTITY','The unchanged original parser differs from its declared source.');
  const context=vm.createContext({});
  vm.runInContext(source,context,{filename:'vendor/skulpt-syntax/skulpt.min.js',timeout:10000});
  const parse=(filename,content)=>{
   context.__syntaxPath=filename;context.__syntaxSource=content;
   try{return vm.runInContext('Sk.parse(__syntaxPath,__syntaxSource)',context,{filename:'original-python-parse',timeout:10000});}
   finally{delete context.__syntaxPath;delete context.__syntaxSource;}
  };
  const inspector=createPythonSyntaxInspector({Sk:context.Sk,parserSource:source,parse});
  const result=inspector.inspect({...input,packetSource:readSource(input.input,LIMITS.packet_bytes)});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result.state==='ALL_SELECTED_SOURCE_ACCEPTED'?0:result.state==='SELECTED_SOURCE_NOT_ACCEPTED'?2:1;
 }catch(error){
  process.stderr.write(JSON.stringify({schema:'commons.python-source-syntax/v1',state:'ERROR',
   code:error.code||error.name,message:String(error.message||error),...(error.detail===undefined?{}:{detail:error.detail})},null,2)+'\n');
  return 1;
 }
}
if(require.main===module)process.exitCode=main();
module.exports={main,argumentsFor};
