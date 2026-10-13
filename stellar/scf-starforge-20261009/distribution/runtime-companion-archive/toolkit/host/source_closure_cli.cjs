#!/usr/bin/env node
'use strict';

/* Native filesystem adapter for the unchanged portable source-closure core. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {TextDecoder}=require('node:util');
const closure=require('./connected_javascript_source_closure.cjs');
const PARSER_PATH=path.join(__dirname,'vendor/acorn-source-closure/acorn.cjs');
const PARSER_SHA='b95392d79457d0357555c5ed3e56302d074b92dff119bcf3b44179500b10e9df';
const parserBytes=readRegular(PARSER_PATH,1024*1024).bytes;
if(hash(parserBytes)!==PARSER_SHA)failure('SOURCE_PARSER_IDENTITY','The retained original parser bytes differ.');
const parserModule={exports:{}};
require('node:vm').runInNewContext(parserBytes.toString('utf8'),{module:parserModule,exports:parserModule.exports},{filename:PARSER_PATH,timeout:10000});
const acorn=parserModule.exports;
const MAX_BUNDLE_BYTES=256*1024*1024;
const MAX_COMPRESSED_BYTES=128*1024*1024;
const UTF8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});

function failure(code,message,detail) {
  const error=new Error(message);error.code=code;if(detail!==undefined)error.detail=detail;throw error;
}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function hash(bytes,algorithm='sha256'){return crypto.createHash(algorithm).update(bytes).digest('hex');}
function bytesOf(row){
  if(row.encoding===undefined||row.encoding==='utf-8'){
    for(const c of row.content){const n=c.codePointAt(0);if(n>=0xd800&&n<=0xdfff)failure('SOURCE_UNICODE','Source contains a lone Unicode surrogate.');}
    return Buffer.from(row.content,'utf8');
  }
  if(row.encoding!=='base64'||typeof row.content!=='string'||row.content.length%4!==0)
    failure('SOURCE_ENCODING','Use complete UTF-8 or canonical Base64.');
  const bytes=Buffer.from(row.content,'base64');
  if(bytes.toString('base64')!==row.content)failure('SOURCE_ENCODING','Base64 source is not canonical.');
  return bytes;
}
function identify(row){
  const bytes=bytesOf(row);
  return {bytes:bytes.length,sha256:hash(bytes),
    git_blob_sha1:crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
}
function localPath(value){
  if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('\\')||
      /[\x00-\x1f\x7f:]/.test(value))failure('SOURCE_PATH','Use a portable relative source path.',{path:value});
  for(const segment of value.split('/')){
    if(!segment||segment==='.'||segment==='..'||/[. ]$/.test(segment)||
       /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))
      failure('SOURCE_PATH','Source path is not portable.',{path:value});
  }
  return value;
}
function noLinkPath(root,relative,allowMissing=false){
  const segments=localPath(relative).split('/');let current=root;
  for(let i=0;i<segments.length;i++){
    current=path.join(current,segments[i]);
    let st;try{st=fs.lstatSync(current);}catch(error){
      if(allowMissing&&error.code==='ENOENT')continue;throw error;
    }
    if(st.isSymbolicLink()||(i<segments.length-1&&!st.isDirectory()))
      failure('SOURCE_SYMLINK','Source paths must use ordinary directories and files.',{path:relative});
  }
  const parent=path.relative(root,current);
  if(parent.startsWith('..'+path.sep)||path.isAbsolute(parent))
    failure('SOURCE_ESCAPE','Source path leaves its selected root.',{path:relative});
  return current;
}
function readRegular(file,maxBytes){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink())failure('SOURCE_FILE','Select an ordinary file.',{file});
  if(st.size>maxBytes)failure('SOURCE_SIZE_LIMIT','File exceeds the selected byte limit.',{file,bytes:st.size,limit:maxBytes});
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.dev!==st.dev||before.ino!==st.ino||before.size>maxBytes)
      failure('SOURCE_CHANGED','Source changed while opening.',{file});
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)break;offset+=n;}
    const extra=Buffer.alloc(1),after=fs.fstatSync(fd);
    if(offset!==before.size||fs.readSync(fd,extra,0,1,before.size)!==0||
       before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
      failure('SOURCE_CHANGED','Source changed while reading.',{file});
    return {bytes,mode:(before.mode&0o111)?'100755':'100644'};
  }finally{fs.closeSync(fd);}
}
function readJSON(file,maxBytes=MAX_BUNDLE_BYTES){
  let bytes=readRegular(path.resolve(file),maxBytes).bytes;
  if(bytes[0]===31&&bytes[1]===139){
    if(bytes.length>MAX_COMPRESSED_BYTES)failure('SOURCE_SIZE_LIMIT','Compressed source exceeds its byte limit.');
    bytes=zlib.gunzipSync(bytes,{maxOutputLength:maxBytes});
  }
  if(bytes.length>maxBytes)failure('SOURCE_SIZE_LIMIT','Complete JSON exceeds its byte limit.');
  let value;try{value=JSON.parse(UTF8.decode(bytes));}catch(error){failure('SOURCE_JSON','Retain complete UTF-8 JSON.',{message:error.message});}
  return {value,bytes,sha256:hash(bytes)};
}
function encode(bytes){
  try{const content=UTF8.decode(bytes);if(Buffer.from(content,'utf8').equals(bytes))return {content,encoding:'utf-8'};}catch(_){}
  return {content:bytes.toString('base64'),encoding:'base64'};
}
function sourceRow(root,relative,maxBytes){
  const name=noLinkPath(root,relative),received=readRegular(name,maxBytes);
  const row={path:relative,...encode(received.bytes),mode:received.mode};
  return {...row,...identify(row)};
}
function publish(file,bytes,temporaryDirectory){
  const absolute=path.resolve(file),parent=path.dirname(absolute);
  if(!fs.statSync(parent).isDirectory())failure('OUTPUT_PARENT','Create the original output parent first.');
  function existing(){
    const previous=readRegular(absolute,Math.max(bytes.length,1)).bytes;
    if(!previous.equals(bytes))failure('OUTPUT_EXISTS','Existing output has different bytes.',{file:absolute});
    return {path:absolute,bytes:bytes.length,sha256:hash(bytes),reused:true};
  }
  try{fs.lstatSync(absolute);return existing();}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path.join(temporaryDirectory||parent,'.source-write-'+crypto.randomUUID()+'.part');
  let fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  try{
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    try{fs.linkSync(temporary,absolute);}catch(error){if(error.code!=='EEXIST')throw error;return existing();}
    return {path:absolute,bytes:bytes.length,sha256:hash(bytes),reused:false};
  }finally{
    if(fd!==null)fs.closeSync(fd);
    try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
function sourceOptions(value){
  if(!plain(value))failure('SOURCE_SPEC','Select a complete source selection object.');
  const allowed=new Set(['schema','label','paths','routes','resources','limits']);
  for(const key of Object.keys(value))if(!allowed.has(key))failure('SOURCE_SPEC','Unknown source selection field.',{key});
  if(value.schema!=='commons.javascript-source-selection/v1'||!Array.isArray(value.paths)||!value.paths.length)
    failure('SOURCE_SPEC','Select the supported schema and at least one complete source path.');
  if(value.paths.some(p=>typeof p!=='string'))failure('SOURCE_SPEC','paths must contain relative path strings.');
  if(value.label!==undefined&&typeof value.label!=='string')failure('SOURCE_SPEC','label must be text.');
  if(value.resources!==undefined&&(!Array.isArray(value.resources)||value.resources.some(p=>typeof p!=='string')))
    failure('SOURCE_SPEC','resources must contain complete relative path strings.');
  for(const p of [...value.paths,...(value.resources||[])])localPath(p);
  return value;
}
function inspectPacket(packet){
  if(!plain(packet)||packet.schema!==closure.SCHEMA||!Array.isArray(packet.files))
    failure('SOURCE_PACKET','Use the complete original source-closure result.');
  for(const file of packet.files){
    localPath(file.path);
    if(file.mode!==undefined&&!['100644','100755'].includes(file.mode))failure('SOURCE_MODE','Use an ordinary source file mode.',{path:file.path});
  }
  return closure.inspectSourceClosure({files:packet.files,routes:packet.routes||[],
    resources:packet.selection?.resources||[],limits:packet.coverage?.limits,
    parse:acorn.parse,identify});
}
function summary(result){
  return {schema:result.schema,coverage:result.coverage,source_reads:result.source_reads,
    resolved_edges:result.resolved.length,routes:result.routes.length,
    computed:result.computed,external:result.external,errors:result.errors,pending:result.pending,
    files:result.files.map(({content,...row})=>row)};
}
function collect(input){
  const root=fs.realpathSync(path.resolve(input.root));
  if(!fs.statSync(root).isDirectory())failure('SOURCE_ROOT','Select the original source directory.');
  const spec=sourceOptions(readJSON(input.spec,1024*1024).value);
  const maxBytes=spec.limits?.max_file_bytes||closure.DEFAULTS.max_file_bytes;
  const result=closure.collectSourceClosureSync({...spec,paths:[...spec.paths,...(spec.resources||[])],
    parse:acorn.parse,identify,readSource:p=>sourceRow(root,p,maxBytes)});
  // Keep one coherent captured edition: re-read only the selected source bodies
  // before publication and reject a changed working-tree input.
  for(const row of result.files){
    const current=sourceRow(root,row.path,maxBytes);
    if(current.sha256!==row.sha256||current.git_blob_sha1!==row.git_blob_sha1||current.mode!==row.mode)
      failure('SOURCE_CHANGED','A selected source changed during collection.',{path:row.path});
  }
  const packet={...result,selection:spec,source:{kind:'local-filesystem',label:spec.label||'Selected local source'},
    parser:{name:'acorn',version:acorn.version,source_sha256:PARSER_SHA}};
  const raw=Buffer.from(JSON.stringify(packet,null,2)+'\n','utf8');
  if(raw.length>MAX_BUNDLE_BYTES)failure('SOURCE_SIZE_LIMIT','Complete source packet exceeds the output byte limit.');
  const encoded=input.gzip?zlib.gzipSync(raw,{level:9}):raw;
  const receipt=publish(input.output,encoded);
  return {status:result.coverage.complete?'COMPLETE':'INCOMPLETE',...summary(result),
    output:receipt,uncompressed:{bytes:raw.length,sha256:hash(raw)}};
}
function inspect(input){
  const original=readJSON(input.input),result=inspectPacket(original.value);
  return {status:result.coverage.complete?'COMPLETE':'INCOMPLETE',...summary(result),
    original:{bytes:original.bytes.length,sha256:original.sha256}};
}
function writeMember(root,relative,bytes,mode,temporaryDirectory){
  const target=noLinkPath(root,relative,true),segments=relative.split('/');
  let parent=root;
  for(const segment of segments.slice(0,-1)){
    parent=path.join(parent,segment);
    try{fs.mkdirSync(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    if(!fs.lstatSync(parent).isDirectory()||fs.lstatSync(parent).isSymbolicLink())
      failure('SOURCE_SYMLINK','Receiving directory changed.',{path:relative});
  }
  const receipt=publish(target,bytes,temporaryDirectory);
  fs.chmodSync(target,mode==='100755'?0o700:0o600);
  return receipt;
}
function receive(input){
  const original=readJSON(input.input),packet=original.value,result=inspectPacket(packet);
  if(!result.coverage.complete)failure('SOURCE_INCOMPLETE','Resolve original pending paths/errors before materializing.',summary(result));
  const directory=path.resolve(input.directory),parent=fs.realpathSync(path.dirname(directory));
  const canonical=path.join(parent,path.basename(directory));
  const operation={schema:'commons.source-materialization/v1',source_sha256:original.sha256,
    source_bytes:original.bytes.length,files:result.files.map(({path,bytes,sha256,git_blob_sha1,mode})=>({path,bytes,sha256,git_blob_sha1,mode:mode||'100644'}))};
  const opBytes=Buffer.from(JSON.stringify(operation,null,2)+'\n');
  try{fs.mkdirSync(canonical,{mode:0o700});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const st=fs.lstatSync(canonical);
    if(!st.isDirectory()||st.isSymbolicLink())failure('RECEIVING_ROOT','Original receiving root is not an ordinary directory.');
    let saved;
    try{saved=readRegular(path.join(canonical,'operation.json'),MAX_BUNDLE_BYTES).bytes;}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      if(fs.readdirSync(canonical).length!==0)failure('RECEIVING_IDENTITY','An unidentified receiving directory is not empty.');
    }
    if(saved&&!saved.equals(opBytes))failure('RECEIVING_IDENTITY','The directory belongs to another source operation.');
  }
  publish(path.join(canonical,'operation.json'),opBytes);
  publish(path.join(canonical,'source-packet.json'),original.bytes);
  const pending=path.join(canonical,'pending');
  try{fs.mkdirSync(pending,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  if(!fs.lstatSync(pending).isDirectory()||fs.lstatSync(pending).isSymbolicLink())
    failure('RECEIVING_ROOT','Original pending directory is not an ordinary directory.');
  const selected=path.join(canonical,'source');
  try{fs.mkdirSync(selected,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  if(!fs.lstatSync(selected).isDirectory()||fs.lstatSync(selected).isSymbolicLink())
    failure('RECEIVING_ROOT','Original source directory is not an ordinary directory.');
  const allowed=new Set(result.files.map(f=>f.path));
  const walk=[{absolute:selected,relative:''}];
  while(walk.length){
    const current=walk.pop();
    for(const item of fs.readdirSync(current.absolute,{withFileTypes:true})){
      const relative=current.relative?current.relative+'/'+item.name:item.name,absolute=path.join(current.absolute,item.name);
      if(item.isSymbolicLink())failure('SOURCE_SYMLINK','Receiving source contains a symbolic link.',{path:relative});
      if(item.isDirectory()){
        if(![...allowed].some(p=>p.startsWith(relative+'/')))failure('RECEIVING_EXTRA','Unselected directory exists in receiving source.',{path:relative});
        walk.push({absolute,relative});
      }else if(!item.isFile()||!allowed.has(relative))failure('RECEIVING_EXTRA','Unselected file exists in receiving source.',{path:relative});
    }
  }
  for(const row of result.files)writeMember(selected,row.path,bytesOf(row),row.mode,pending);
  for(const row of result.files){
    const actual=sourceRow(selected,row.path,result.coverage.limits.max_file_bytes);
    if(actual.sha256!==row.sha256||actual.git_blob_sha1!==row.git_blob_sha1)failure('SOURCE_IDENTITY','Received source bytes differ.',{path:row.path});
  }
  const complete={...operation,status:'COMPLETE',source_directory:'source'};
  publish(path.join(canonical,'complete.json'),Buffer.from(JSON.stringify(complete,null,2)+'\n'));
  return {...complete,directory:canonical,source_directory:selected};
}
const HELP='JavaScript source closure\n\n'+
 '  node host/source_closure_cli.cjs collect --root ROOT --spec SELECTION.json --output SOURCE.json[.gz] [--gzip]\n'+
 '  node host/source_closure_cli.cjs inspect --input SOURCE.json[.gz]\n'+
 '  node host/source_closure_cli.cjs receive --input SOURCE.json[.gz] --directory NEW_ORIGINAL_DIRECTORY\n\n'+
 'Complete source is preserved. No application source is executed, network call made, or dependency installed.\n'+
 'Existing outputs are reused only when byte-identical. Receiving resumes only the same source operation.\n'+
 'Exit 0: complete. Exit 2: source incomplete. Exit 1: operation error.\n';
function argumentsFor(argv){
  if(!argv.length||argv[0]==='--help'||argv[0]==='help')return {command:'help'};
  const command=argv.shift(),allowed={collect:new Set(['root','spec','output','gzip']),inspect:new Set(['input']),receive:new Set(['input','directory'])}[command];
  if(!allowed)failure('ARGUMENT','Choose collect, inspect or receive.');
  const input={command};
  while(argv.length){
    const flag=argv.shift();
    if(!flag.startsWith('--')||!allowed.has(flag.slice(2))||Object.prototype.hasOwnProperty.call(input,flag.slice(2)))
      failure('ARGUMENT','Unknown or repeated argument.',{flag});
    const key=flag.slice(2);
    if(key==='gzip')input[key]=true;
    else {const value=argv.shift();if(!value||value.startsWith('--'))failure('ARGUMENT','Supply the complete argument value.',{flag});input[key]=value;}
  }
  for(const key of allowed)if(key!=='gzip'&&!input[key])failure('ARGUMENT','A required argument is missing.',{key});
  return input;
}
function main(argv=process.argv.slice(2)){
  try{
    const input=argumentsFor([...argv]);
    if(input.command==='help'){process.stdout.write(HELP);return 0;}
    const result={collect,inspect,receive}[input.command](input);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return result.status==='INCOMPLETE'?2:0;
  }catch(error){
    process.stderr.write(JSON.stringify({status:'ERROR',code:error.code||error.name,
      message:String(error.message||error),...(error.detail===undefined?{}:{detail:error.detail})},null,2)+'\n');
    return 1;
  }
}
if(require.main===module)process.exitCode=main();
module.exports={collect,inspect,receive,identify,main};
