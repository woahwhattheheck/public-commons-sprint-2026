'use strict';

/*
 * Parse complete retained JavaScript source without importing the application.
 * All provider reads, identities and parser code remain explicit caller bindings.
 */
const SCHEMA = 'commons.javascript-source-closure/v1';
const DEFAULTS = Object.freeze({
  max_files: 8192, max_bytes: 64 * 1024 * 1024,
  max_file_bytes: 8 * 1024 * 1024, max_edges: 100000
});
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const clone = o => JSON.parse(JSON.stringify(o));
class SourceClosureError extends Error {
  constructor(code, message, detail) {
    super(message); this.name='SourceClosureError'; this.code=code;
    if(detail !== undefined) this.detail=detail;
  }
}
function fail(code,message,detail) { throw new SourceClosureError(code,message,detail); }
function scalar(s) {
  for(const c of s) { const n=c.codePointAt(0); if(n>=0xd800&&n<=0xdfff) return false; }
  return true;
}
function sourcePath(value) {
  if(typeof value!=='string'||!value||!scalar(value)||/[\x00-\x1f\x7f\\]/.test(value)||
      value.startsWith('/')||/^[A-Za-z]:/.test(value)||
      value.split('/').some(p=>!p||p==='.'||p==='..'))
    fail('SOURCE_PATH','Select a complete repository-relative source path.',{path:value});
  return value;
}
function limitsFrom(input={}) {
  if(!object(input)) fail('SOURCE_LIMIT','Source limits must be an object.');
  const result={...DEFAULTS};
  for(const [key,value] of Object.entries(input)) {
    if(!own(DEFAULTS,key)||!Number.isSafeInteger(value)||value<1)
      fail('SOURCE_LIMIT','Select a positive safe source limit.',{key});
    result[key]=value;
  }
  return result;
}
function pathFrom(source,specifier,absolute=false,clampURLRoot=false) {
  if(typeof specifier!=='string'||!scalar(specifier)||/[\x00-\x1f\x7f\\]/.test(specifier))
    fail('SOURCE_SPECIFIER','Retain an ordinary complete module specifier.',{source,specifier});
  const suffix=specifier.search(/[?#]/), plain=suffix<0?specifier:specifier.slice(0,suffix);
  if(/%2f|%5c/i.test(plain)) fail('SOURCE_SPECIFIER','Encoded path separators are not source aliases.',{source,specifier});
  const parts=absolute?[]:source.split('/').slice(0,-1);
  for(const encoded of plain.split('/')) {
    let part; try { part=decodeURIComponent(encoded); } catch (_) {
      fail('SOURCE_SPECIFIER','A source URL has invalid percent encoding.',{source,specifier});
    }
    if(!part||part==='.') continue;
    if(part==='..') { if(!parts.length) {if(clampURLRoot) continue; fail('SOURCE_ESCAPE','A source request leaves its selected root.',{source,specifier});} parts.pop(); }
    else {
      if(/[\x00-\x1f\x7f\\/:]/.test(part)) fail('SOURCE_SPECIFIER','A source URL contains an invalid path segment.',{source,specifier});
      parts.push(part);
    }
  }
  return parts.join('/');
}
function literal(node) {
  if(node?.type==='Literal'&&typeof node.value==='string') return node.value;
  if(node?.type==='TemplateLiteral'&&node.expressions.length===0) return node.quasis[0].value.cooked;
  return null;
}
function metaURL(node) {
  return node?.type==='MemberExpression'&&!node.computed&&node.property?.name==='url'&&
    node.object?.type==='MetaProperty'&&node.object.meta?.name==='import'&&node.object.property?.name==='meta';
}
function jsRequests(file,parse,limit) {
  let ast;
  try { ast=parse(file.content,{ecmaVersion:'latest',sourceType:file.path.endsWith('.cjs')?'script':'module',
      locations:true,allowHashBang:true}); }
  catch(error) { return {requests:[],computed:[],error:{
    path:file.path,code:'SOURCE_PARSE',message:String(error.message||error),
    line:error.loc?.line??null,column:error.loc?.column??null}}; }
  const stack=[ast],requests=[],computed=[];
  function add(node,kind,arg) {
    if(requests.length+computed.length>=limit) fail('SOURCE_EDGE_LIMIT','Source references exceed max_edges.',{path:file.path});
    const row={source:file.path,line:node.loc?.start.line??null,kind,range:[node.start,node.end]};
    const specifier=literal(arg);
    if(specifier!==null) requests.push({...row,specifier});
    else computed.push({...row,expression:file.content.slice(node.start,node.end),resolution:'explicit_runtime_selection'});
  }
  while(stack.length) {
    const node=stack.pop(); if(!node||typeof node!=='object') continue;
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)&&node.source)
      add(node,node.type,node.source);
    else if(node.type==='NewExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='URL'&&
        node.arguments.length===2&&metaURL(node.arguments[1])) add(node,'url-resource',node.arguments[0]);
    else if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='require'&&node.arguments.length===1)
      add(node,'require-source',node.arguments[0]);
    for(const [key,value] of Object.entries(node)) if(key!=='loc') {
      if(Array.isArray(value)) { for(let i=value.length-1;i>=0;i--) if(value[i]&&typeof value[i]==='object') stack.push(value[i]); }
      else if(value&&typeof value==='object') stack.push(value);
    }
  }
  return {requests,computed,error:null};
}
function unescapeAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#(?:x[0-9a-f]+|\d+));/gi,token=>{
    const key=token.slice(1,-1).toLowerCase();
    if(key[0]==='#') { const n=key[1]==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
      if(!Number.isInteger(n)||n<0||n>0x10ffff||n>=0xd800&&n<=0xdfff) fail('HTML_ATTRIBUTE','Invalid HTML character reference.');
      return String.fromCodePoint(n); }
    return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[key];
  });
}
function htmlRequests(file,limit) {
  const requests=[],source=file.content.replace(/<!--[\s\S]*?-->/g,m=>' '.repeat(m.length));
  const tags=/<(script|link)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let match;
  while((match=tags.exec(source))) {
    const attrs=new Map(),body=match[2];
    for(const a of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const key=a[1].toLowerCase(); if(!attrs.has(key)) attrs.set(key,unescapeAttribute(a[2]??a[3]??a[4]??''));
    }
    const script=match[1].toLowerCase()==='script';
    if(script) { const closing=/<\/script\s*>/gi;closing.lastIndex=tags.lastIndex;const end=closing.exec(source);tags.lastIndex=end?closing.lastIndex:source.length; }
    if(!script&&!/\b(?:stylesheet|modulepreload|preload)\b/i.test(attrs.get('rel')||'')) continue;
    const specifier=attrs.get(script?'src':'href'); if(!specifier) continue;
    if(requests.length>=limit) fail('SOURCE_EDGE_LIMIT','HTML resources exceed max_edges.',{path:file.path});
    requests.push({source:file.path,line:source.slice(0,match.index).split('\n').length,
      kind:script?'html-script':'html-link',specifier,range:[match.index,match.index+match[0].length]});
  }
  return requests;
}
function validatedFiles(input,identify,limits) {
  if(!Array.isArray(input)) fail('SOURCE_FILES','Select complete source file rows.');
  const files=new Map();let total=0;
  for(const inputRow of input) {
    if(!object(inputRow)||typeof inputRow.content!=='string') fail('SOURCE_CONTENT','Every selected file needs complete content.');
    const row=clone(inputRow),path=sourcePath(row.path),encoding=row.encoding??'utf-8';
    if(encoding!=='utf-8'&&encoding!=='base64') fail('SOURCE_ENCODING','Use complete UTF-8 or canonical Base64.',{path});
    if(encoding==='utf-8'&&!scalar(row.content)) fail('SOURCE_UNICODE','Source has a lone Unicode surrogate.',{path});
    if(files.has(path)) fail('SOURCE_DUPLICATE','Select a source path once.',{path});
    const identity=identify({content:row.content,encoding});
    if(!object(identity)||!Number.isSafeInteger(identity.bytes)||identity.bytes<0||
       !/^[a-f0-9]{64}$/.test(identity.sha256??'')||!/^[a-f0-9]{40}$/.test(identity.git_blob_sha1??''))
      fail('SOURCE_IDENTITY_BINDING','identify must return exact bytes, SHA256 and Git blob SHA1.',{path});
    for(const key of ['bytes','sha256','git_blob_sha1']) {
      const actual=identity[key];
      const aliases=key==='git_blob_sha1'?['git_blob_sha1','git_blob','gitBlob','blob_sha']:key==='sha256'?['sha256']:['bytes'];
      for(const alias of aliases) if(own(row,alias)&&row[alias]!==actual) fail('SOURCE_IDENTITY','A retained source identity differs.',{path,field:alias});
    }
    total+=identity.bytes;
    if(identity.bytes>limits.max_file_bytes||total>limits.max_bytes||files.size>=limits.max_files)
      fail('SOURCE_SIZE_LIMIT','The complete source selection exceeds its explicit limit.',{path,bytes:identity.bytes,total});
    files.set(path,{...row,encoding,...identity});
  }
  for(const path of files.keys()) {
    const parts=path.split('/');for(let i=1;i<parts.length;i++) if(files.has(parts.slice(0,i).join('/')))
      fail('SOURCE_PATH_COLLISION','A selected file is also a parent directory.',{path});
  }
  return {files,total};
}
function routeRows(files,input=[]) {
  if(!Array.isArray(input)) fail('SOURCE_ROUTES','Routes must be an array.');
  const rows=[];
  function add(row) {
    if(!object(row)||typeof row.url!=='string'||!row.url.startsWith('/')||row.url.startsWith('//')||/[?#]/.test(row.url))
      fail('SOURCE_ROUTE','Use an exact served local URL and original source path.');
    const normalized='/'+pathFrom('',row.url,true)+(row.url.endsWith('/')&&row.url!=='/'?'/':'');
    if(normalized!==row.url) fail('SOURCE_ROUTE','Use a normalized served local URL.',{url:row.url});
    rows.push({...clone(row),path:sourcePath(row.path),url:normalized});
  }
  for(const row of input) add(row);
  for(const file of files.values()) if(file.path.endsWith('/browser-assets.json')&&file.encoding==='utf-8') {
    let value;try {value=JSON.parse(file.content);}catch(error){fail('SOURCE_ROUTE_MANIFEST','A browser route manifest is invalid JSON.',{path:file.path});}
    if(value.schema!=='stellar-forge.browser-assets.v1') continue;
    if(typeof value.root!=='string'||!Array.isArray(value.routes)) fail('SOURCE_ROUTE_MANIFEST','Keep the complete browser manifest.',{path:file.path});
    for(const item of value.routes) {
      if(!Array.isArray(item)||item.length!==2||!Array.isArray(item[1])||item[1].length!==2||
         typeof item[1][0]!=='string') fail('SOURCE_ROUTE_MANIFEST','Keep an exact browser route pair.',{path:file.path});
      add({url:item[0],path:pathFrom(file.path,value.root+item[1][0]),source:file.path,content_type:item[1][1],selection:'original_browser_manifest'});
    }
  }
  const unique=new Map();
  for(const row of rows) {
    const prior=unique.get(row.url);
    if(prior&&prior.path!==row.path) fail('SOURCE_ROUTE_COLLISION','One served URL names different original files.',{url:row.url,paths:[prior.path,row.path]});
    if(!prior) unique.set(row.url,row);
  }
  return [...unique.values()];
}
function inspectSourceClosure(options) {
  if(!object(options)||typeof options.parse!=='function'||typeof options.identify!=='function')
    fail('SOURCE_BINDINGS','Use the existing parser and exact byte identity bindings.');
  const limits=limitsFrom(options.limits),checked=validatedFiles(options.files,options.identify,limits),files=checked.files;
  const routes=routeRows(files,options.routes),byURL=new Map(routes.map(r=>[r.url,r])),byPath=new Map();
  for(const row of routes) {if(!byPath.has(row.path))byPath.set(row.path,[]);byPath.get(row.path).push(row);}
  const requests=[],computed=[],errors=[],resolved=[],external=[],pending=new Map();let parsed=0;
  function needPath(path,reason) {
    sourcePath(path);if(!files.has(path)) {if(!pending.has(path)) pending.set(path,[]);pending.get(path).push(reason);}
  }
  for(const route of routes) needPath(route.path,{kind:'served-resource',source:route.source??null,url:route.url});
  for(const resource of options.resources??[]) needPath(typeof resource==='string'?resource:resource.path,{kind:'explicit-resource'});
  for(const file of files.values()) {
    if(/\.(?:mjs|cjs|js)$/.test(file.path)) {
      if(file.encoding!=='utf-8') {errors.push({path:file.path,code:'SOURCE_MODULE_ENCODING',message:'JavaScript source needs complete UTF-8 content.'});continue;}
      const output=jsRequests(file,options.parse,limits.max_edges-requests.length-computed.length);
      requests.push(...output.requests);computed.push(...output.computed);
      if(output.error) errors.push(output.error);else parsed++;
    } else if(/\.html?$/.test(file.path)&&file.encoding==='utf-8')
      requests.push(...htmlRequests(file,limits.max_edges-requests.length-computed.length));
    if(requests.length+computed.length>limits.max_edges) fail('SOURCE_EDGE_LIMIT','Source references exceed max_edges.');
  }
  for(const row of requests) {
    const spec=row.specifier;
    if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec)||spec.startsWith('//')) {
      external.push({...row,resolution:spec.startsWith('node:')?'node_builtin':spec.startsWith('file:')?'selected_filesystem':'external_url'});continue;
    }
    const resource=row.kind==='url-resource'||row.kind.startsWith('html-');
    if(!resource&&!/^(?:\.{1,2}\/|\/)/.test(spec)) {external.push({...row,resolution:'installed_package'});continue;}
    try {
      let target,resolution='relative_file';
      if(spec.startsWith('/')) {
        const url='/'+pathFrom('',spec,true),route=byURL.get(url);
        if(!route) {errors.push({...row,code:'SOURCE_ROUTE_UNMAPPED',message:'Declare the exact original source serving this absolute URL.'});continue;}
        target=route.path;resolution='served_url';
      } else {
        // Each explicit served URL is its own browser resolution context.
        // Parent traversal clamps at the URL root, as the browser does; the
        // repository fallback below still rejects escapes from its source root.
        const aliases=new Map();
        if(!(row.kind==='url-resource'&&/^(?:\.{1,2}|.*\/)(?:[?#].*)?$/.test(spec))) {
          for(const route of byPath.get(row.source)??[]) {
            const url='/'+pathFrom(route.url.slice(1),spec,false,true);
            if(byURL.has(url)) {
              const mapped=byURL.get(url).path;
              if(!aliases.has(mapped)) aliases.set(mapped,[]);
              aliases.get(mapped).push({source_url:route.url,target_url:url});
            }
          }
        }
        if(aliases.size) {
          // Retain every distinct declared serving context. A repository file
          // with the same relative name cannot shadow the actual served target.
          for(const [mapped,contexts] of aliases) {
            const edge={...row,target:mapped,resolution:'served_module_alias',contexts};
            if(files.has(mapped)) resolved.push(edge);else needPath(mapped,edge);
          }
          continue;
        }
        target=pathFrom(row.source,spec);
      }
      if(row.kind==='url-resource'&&/^(?:\.{1,2}|.*\/)(?:[?#].*)?$/.test(spec)) {
        resolved.push({...row,target,resolution:'directory_reference',retained_members:[...files.keys()].filter(p=>p.startsWith(target?target+'/':''))});
        continue;
      }
      sourcePath(target);
      if(files.has(target)) resolved.push({...row,target,resolution});
      else needPath(target,row);
    } catch(error) {
      if(!(error instanceof SourceClosureError)) throw error;
      errors.push({...row,code:error.code,message:error.message,detail:error.detail});
    }
  }
  return {
    schema:SCHEMA,files:[...files.values()],routes,resolved,external,computed,errors,
    pending:[...pending].map(([path,references])=>({path,references})),
    coverage:{selected_files:files.size,source_bytes:checked.total,parsed_modules:parsed,requests:requests.length,
      complete:errors.length===0&&pending.size===0,module_execution:false,
      scope:'literal source requests, explicit routes/resources and complete retained input files',
      computed_runtime_selections:computed.length,external_requests:external.length,limits}
  };
}
function collectSourceClosureSync(options) {
  if(typeof options?.readSource!=='function') fail('SOURCE_READER','Keep the original synchronous source reader.');
  let files=[...(options.files??[])],reads=0;
  const selected=[...new Set(options.paths??[])],seen=new Set(files.map(f=>f.path));
  const maximum=limitsFrom(options.limits).max_files;
  if(selected.length>maximum||files.length>maximum) fail('SOURCE_SIZE_LIMIT','Selected source paths exceed max_files.');
  for(const path of selected) if(!seen.has(sourcePath(path))) {
    if(files.length>=maximum) fail('SOURCE_SIZE_LIMIT','Source receiving exceeds max_files.');
    const row=options.readSource(path);
    if(row&&typeof row.then==='function') fail('SOURCE_ASYNC_READER','Use collectSourceClosure for asynchronous reads.');
    if(row?.path!==path) fail('SOURCE_READ_PATH','The original source reader returned another path.',{path});
    files.push(row);seen.add(path);reads++;
  }
  while(true) {
    const result=inspectSourceClosure({...options,files});
    if(result.errors.length||!result.pending.length) return {...result,source_reads:reads};
    for(const item of result.pending) {
      if(files.length>=maximum) fail('SOURCE_SIZE_LIMIT','Source receiving exceeds max_files.');
      const row=options.readSource(item.path);
      if(row&&typeof row.then==='function') fail('SOURCE_ASYNC_READER','Use collectSourceClosure for asynchronous reads.');
      if(row?.path!==item.path) fail('SOURCE_READ_PATH','The original source reader returned another path.',{path:item.path});
      files.push(row);reads++;
    }
  }
}
async function collectSourceClosure(options) {
  if(typeof options?.readSource!=='function') fail('SOURCE_READER','Keep the original asynchronous source reader.');
  let files=[...(options.files??[])],reads=0;
  const selected=[...new Set(options.paths??[])],seen=new Set(files.map(f=>f.path));
  const maximum=limitsFrom(options.limits).max_files;
  if(selected.length>maximum||files.length>maximum) fail('SOURCE_SIZE_LIMIT','Selected source paths exceed max_files.');
  for(const path of selected) if(!seen.has(sourcePath(path))) {
    if(files.length>=maximum) fail('SOURCE_SIZE_LIMIT','Source receiving exceeds max_files.');
    const row=await options.readSource(path);
    if(row?.path!==path) fail('SOURCE_READ_PATH','The original source reader returned another path.',{path});
    files.push(row);seen.add(path);reads++;
  }
  while(true) {
    const result=inspectSourceClosure({...options,files});
    if(result.errors.length||!result.pending.length) return {...result,source_reads:reads};
    for(const item of result.pending) {
      if(files.length>=maximum) fail('SOURCE_SIZE_LIMIT','Source receiving exceeds max_files.');
      const row=await options.readSource(item.path);
      if(row?.path!==item.path) fail('SOURCE_READ_PATH','The original source reader returned another path.',{path:item.path});
      files.push(row);reads++;
    }
  }
}
module.exports={SCHEMA,DEFAULTS,SourceClosureError,inspectSourceClosure,collectSourceClosureSync,collectSourceClosure};
