'use strict';
/* Source syntax only. The unchanged CPython collector remains a separate operation. */
const {sha256Utf8}=require('./connected_sha256.cjs');
const SCHEMA='commons.python-source-syntax/v1';
const PARSER=Object.freeze({name:'skulpt',build:'6c99c2196851bb29f0e503afccb01804f089cb60',
 source_sha256:'52e007d8d557b97470131e04c8645dbe940b1ab208049905f1aeb058b218d92a',
 source_bytes:559460,git_blob:'86e34f3d2d1e6a8a356f36d0c17aa3a71520e600',
 distribution_commit:'1473759236009587a04bd9875c7afd812d9f02d2',
 grammar:'Skulpt Python 3 configuration, build dated 2021-02-23'});
const LIMITS=Object.freeze({packet_bytes:64*1024*1024,source_bytes:32*1024*1024,
 file_bytes:8*1024*1024,files:8192});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(code,message,detail){
 const error=new Error(message);error.code=code;if(detail!==undefined)error.detail=detail;throw error;
}
function need(ok,code,message,detail){if(!ok)fail(code,message,detail);}
function sourcePath(value){
 need(typeof value==='string'&&value.length>0&&!value.startsWith('/')&&
  !/[\x00-\x1f\x7f\\:]/.test(value)&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'),
  'PYTHON_SOURCE_PATH','Keep one complete repository-relative source path.',{path:value});
 sha256Utf8(value);return value;
}
function originalRows(packet,repository){
 let selected=packet;
 if(plain(packet?.repositories)){
  need(typeof repository==='string'&&own(packet.repositories,repository),'PYTHON_SOURCE_REPOSITORY',
   'Select the exact retained repository edition explicitly.');
  selected=packet.repositories[repository];
 }else need(repository===undefined,'PYTHON_SOURCE_REPOSITORY',
  'Do not attach a repository identity absent from the original packet.');
 const files=selected?.files;
 need(Array.isArray(files)||plain(files),'PYTHON_SOURCE_PACKET','Retain the complete original files array or map.');
 return Array.isArray(files)?files:Object.entries(files).map(([path,row])=>{
  need(typeof row==='string'||plain(row),'PYTHON_SOURCE_MEMBER','Keep the full source member body.',{path});
  if(typeof row==='string')return{path,content:row};
  need(row.path===undefined||row.path===path,'PYTHON_SOURCE_MEMBER','The source map key and member path differ.',{path});
  return{...row,path};
 });
}
function selectRows(packet,repository,paths){
 const rows=originalRows(packet,repository),byPath=new Map();
 need(rows.length<=LIMITS.files,'PYTHON_SOURCE_LIMIT','The complete source inventory exceeds its declared count.');
 for(const row of rows){
  need(plain(row),'PYTHON_SOURCE_MEMBER','Retain complete ordinary source members.');
  const name=sourcePath(row.path);
  need(!byPath.has(name),'PYTHON_SOURCE_DUPLICATE','An original source path occurs twice.',{path:name});
  byPath.set(name,row);
 }
 const names=paths===undefined?[...byPath.keys()].filter(x=>/\.pyi?$/.test(x)):paths;
 need(Array.isArray(names)&&names.length>0&&names.length<=LIMITS.files&&new Set(names).size===names.length,
  'PYTHON_SOURCE_SELECTION','Select at least one distinct full Python source path.');
 let total=0;
 const selected=names.map(name=>{
  sourcePath(name);need(/\.pyi?$/.test(name)&&byPath.has(name),'PYTHON_SOURCE_SELECTION',
   'Select an existing complete Python member.',{path:name});
  const row=byPath.get(name);
  need(typeof row.content==='string'&&(row.encoding===undefined||row.encoding==='utf-8'),
   'PYTHON_SOURCE_ENCODING','Decode transport through the original receiver; retain exact UTF-8 source text.',{path:name});
  const identity=sha256Utf8(row.content);
  need(identity.bytes<=LIMITS.file_bytes,'PYTHON_SOURCE_LIMIT','An original source member exceeds its bound.',{path:name});
  for(const key of ['bytes','sha256'])if(own(row,key))
   need(row[key]===identity[key],'PYTHON_SOURCE_IDENTITY','The complete source differs from its retained identity.',{path:name,field:key});
  total+=identity.bytes;
  need(total<=LIMITS.source_bytes,'PYTHON_SOURCE_LIMIT','The selected complete source exceeds its aggregate bound.');
  return{path:name,content:row.content,...identity};
 });
 return{selected,inventory:rows.length,total};
}
function diagnostic(error){
 const trace=Array.isArray(error?.traceback)?error.traceback:[],last=trace.at(-1);
 return{kind:typeof error?.tp$name==='string'?error.tp$name:String(error?.name||'ParserError'),
  message:String(error).slice(0,12000),
  ...(Number.isSafeInteger(last?.lineno)?{line:last.lineno}:{}),
  ...(typeof last?.filename==='string'?{filename:last.filename}:{}),
  newer_python_grammar_may_be_unsupported:true};
}
/**
 * Bind the retained original Skulpt build. No selected Python source is run.
 * parse may be the host's timeout-bounded call into that SAME original parser.
 */
function createPythonSyntaxInspector({Sk,parserSource,parse}={}){
 need(typeof parserSource==='string','PYTHON_PARSER_SOURCE','Retain the complete original parser body.');
 const identity=sha256Utf8(parserSource);
 need(identity.bytes===PARSER.source_bytes&&identity.sha256===PARSER.source_sha256,
  'PYTHON_PARSER_IDENTITY','The original parser bytes differ from the retained build.');
 need(Sk?.build?.githash===PARSER.build&&typeof Sk.parse==='function'&&
  typeof Sk.configure==='function'&&plain(Sk.python3),'PYTHON_PARSER_BINDING',
  'Bind the same original Skulpt Python 3 parser.');
 need(parse===undefined||typeof parse==='function','PYTHON_PARSER_BINDING','Use the original parser invocation.');
 return Object.freeze({inspect({packetSource,repository,paths,expectedPacketSha256}={}){
  need(typeof packetSource==='string','PYTHON_SOURCE_PACKET','Retain the exact complete decoded packet text.');
  const packetIdentity=sha256Utf8(packetSource);
  need(packetIdentity.bytes<=LIMITS.packet_bytes,'PYTHON_SOURCE_LIMIT','The decoded complete packet exceeds its bound.');
  if(expectedPacketSha256!==undefined)need(expectedPacketSha256===packetIdentity.sha256,
   'PYTHON_SOURCE_IDENTITY','The complete source packet differs from its expected identity.');
  let packet;try{packet=JSON.parse(packetSource);}catch(error){
   fail('PYTHON_SOURCE_JSON','Retain one complete original JSON source packet.',{message:String(error.message)});
  }
  const {selected,inventory,total}=selectRows(packet,repository,paths);
  Sk.configure({__future__:Sk.python3});
  const results=selected.map(row=>{
   const {content,...identity}=row;
   let value;
   try{value=parse?parse(row.path,content):Sk.parse(row.path,content);}
   catch(error){
    const syntax=['SyntaxError','IndentationError','TabError','TokenError'].includes(error?.tp$name);
    return{...identity,state:syntax?'NOT_ACCEPTED_BY_THIS_PARSER':'PARSER_DID_NOT_COMPLETE',diagnostic:diagnostic(error)};
   }
   need(value&&plain(value.cst)&&Number.isSafeInteger(value.cst.type),
    'PYTHON_PARSER_RESPONSE','The original parser returned no concrete syntax tree.',{path:row.path});
   return{...identity,state:'ACCEPTED_BY_THIS_PARSER',cst_root_type:value.cst.type,flags:value.flags??null};
  });
  return{schema:SCHEMA,state:results.some(x=>x.state==='PARSER_DID_NOT_COMPLETE')?'INSPECTION_INCOMPLETE':
   results.every(x=>x.state==='ACCEPTED_BY_THIS_PARSER')?'ALL_SELECTED_SOURCE_ACCEPTED':'SELECTED_SOURCE_NOT_ACCEPTED',parser:{...PARSER},
   original_packet:packetIdentity,...(repository===undefined?{}:{repository}),
   coverage:{inventory_members:inventory,selected_python_members:results.length,selected_source_bytes:total,
    selection:results.map(x=>x.path)},files:results,
   semantics:{operation:'parse-to-concrete-syntax-tree',selected_python_executed:false,
    cpython_executed:false,dependency_closure_collected:false,semantic_compilation:false,
    limitation:'Acceptance uses this retained Skulpt grammar. Rejection can mean unsupported newer Python syntax. Native CPython AST, imports and runtime behavior remain separate.'}};
 }});
}
module.exports={SCHEMA,PARSER,LIMITS,createPythonSyntaxInspector};
