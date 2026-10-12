// MIT. Streaming local HTTP adapter for the original case package operations.
import {CASE_PACKAGE_HTTP_BASE,casePackageProblem,casePackageMediaType} from './case-package-operations.mjs';
import {MAX_CASE_SOURCE_MANIFEST_BYTES} from './case-source-package.mjs';

const ID=/^[a-z0-9][a-z0-9_-]{0,63}$/,SHA=/^[a-f0-9]{64}$/;
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status,casePackageLocal:true});
function json(res,status,value) {
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));
}
function query(url,allowed) {
  const values={};
  for(const key of url.searchParams.keys()) {
    if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)throw fail('CASE_PACKAGE_QUERY','Unexpected package query.');
    values[key]=url.searchParams.get(key);
  }
  return values;
}
function pagination(values) {
  for(const name of ['offset','limit'])if(values[name]!==undefined) {
    if(!/^\d+$/.test(values[name]))throw fail('CASE_PACKAGE_PAGE','Use a nonnegative page offset and limit.');
    values[name]=Number(values[name]);
  }
  return values;
}
async function textBody(req,maximum,contentType='application/json') {
  if(req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()!==contentType)
    throw fail('CASE_PACKAGE_CONTENT_TYPE','Use '+contentType+' for this original operation.',415);
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(declared)||BigInt(declared)>BigInt(maximum)))
    throw fail('CASE_PACKAGE_BODY_LIMIT','This original operation body exceeds its source limit.',413);
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>maximum)throw fail('CASE_PACKAGE_BODY_LIMIT','This original operation body exceeds its source limit.',413);
    chunks.push(chunk);
  }
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));}
  catch{throw fail('CASE_PACKAGE_JSON','Use original UTF-8 text.');}
}
async function body(req,maximum=65536) {
  const text=await textBody(req,maximum);
  try {const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch{throw fail('CASE_PACKAGE_JSON','Use one JSON operation object.');}
}
function only(value,names) {
  if(Object.keys(value).some(key=>!names.includes(key)))throw fail('CASE_PACKAGE_OPERATION_INPUT','Unexpected operation field.');
}
function selection(values) {return {kind:values.kind,id:values.id};}
async function streamFile(controller,req,res,values,{original=false}={}) {
  const source=selection(values),identity=original?
    await controller.originalFile({source,expectedManifestSha256:values.manifestSha,
      bundleId:values.bundleId,manifestSha256:values.bundleSha,path:values.name}):
    await controller.artifact({source,name:values.name,expectedManifestSha256:values.manifestSha});
  const file=identity.file;let first=0,last=file.bytes-1,partial=false,readId=null;
  const range=req.headers.range;
  if(range!==undefined) {
    const match=/^bytes=(\d+)-(\d*)$/.exec(range);
    if(!match||file.bytes===0)throw fail('CASE_PACKAGE_RANGE','Use one byte range within this original file.',416);
    first=Number(match[1]);last=match[2]?Number(match[2]):last;partial=true;
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||first>last||last>=file.bytes)
      throw fail('CASE_PACKAGE_RANGE','Use one byte range within this original file.',416);
  }
  let offset=first,headers=false;
  const base={source,expectedManifestSha256:values.manifestSha,expectedSha256:file.sha256,
    ...(original?{bundleId:values.bundleId,manifestSha256:values.bundleSha,path:values.name}:{name:values.name})};
  try {
    do {
      const count=file.bytes===0?1:Math.min(196608,last-offset+1);
      const chunk=await (original?controller.readOriginal:controller.readFile)({...base,readId,offset,limit:count});
      readId=chunk.nextOffset===null?null:chunk.readId;
      if(res.destroyed)return;
      if(!headers) {
        const basename=file.name.split('/').at(-1),safe=basename.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,160)||'original-file';
        const reply={'content-type':casePackageMediaType(file.name),'content-length':String(file.bytes===0?0:last-first+1),
          'content-disposition':'attachment; filename="'+safe+'"; filename*=UTF-8\'\''+encodeURIComponent(basename),
          'cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'bytes',
          'x-content-sha256':file.sha256,'etag':'"'+file.sha256+'"'};
        if(partial)reply['content-range']='bytes '+first+'-'+last+'/'+file.bytes;
        res.writeHead(partial?206:200,reply);headers=true;
      }
      const bytes=Buffer.from(chunk.data,'base64');
      if(bytes.length!==chunk.bytesRead||chunk.offset!==offset)throw fail('CASE_PACKAGE_FILE_CHANGED','The original file read returned an unexpected byte range.',409);
      if(bytes.length&&!res.write(bytes))await new Promise((resolve,reject)=>{
        const cleanup=()=>{res.removeListener('drain',drained);res.removeListener('close',closed);res.removeListener('error',failed);};
        const drained=()=>{cleanup();resolve();},closed=()=>{cleanup();reject(fail('CASE_PACKAGE_STREAM_CLOSED','The original download connection closed.',499));},
          failed=problem=>{cleanup();reject(problem);};
        res.once('drain',drained);res.once('close',closed);res.once('error',failed);
      });
      offset+=bytes.length;
      if(file.bytes===0||offset>last||chunk.nextOffset===null)break;
    } while(!res.destroyed);
    if(!res.destroyed)res.end();
  } finally {if(readId)await controller.release({source,readId});}
}

/** The original server still verifies loopback peer/Host. This adapter enforces
 * the same exact-origin and fetch-site policy before every package operation. */
export function createCasePackageHttp(controller) {
  return async function handle(req,res,{origin}={}) {
    const path=(req.url??'').split('?')[0];
    if(path!==CASE_PACKAGE_HTTP_BASE&&!path.startsWith(CASE_PACKAGE_HTTP_BASE+'/'))return false;
    if(!controller){json(res,503,{error:'CASE_PACKAGES_DISABLED',detail:'Start the original Support desk with its case directory.'});return true;}
    if(typeof origin!=='string')throw Error('Supply the original listener origin.');
    if((req.headers.origin&&req.headers.origin!==origin)||
      (req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))||
      (req.method!=='GET'&&req.headers.origin!==origin)) {
      json(res,403,{error:'ORIGIN_MISMATCH'});return true;
    }
    try {
      const url=new URL(req.url,origin),route=path.slice(CASE_PACKAGE_HTTP_BASE.length);
      if(req.method==='GET'&&(route===''||route==='/catalog')) {
        query(url,[]);json(res,200,controller.catalog());return true;
      }
      if(req.method==='GET'&&route==='/operations') {
        json(res,200,await controller.list(pagination(query(url,['offset','limit','q']))));return true;
      }
      if(req.method==='GET'&&route==='/inputs') {
        json(res,200,await controller.listInputs(pagination(query(url,['offset','limit','q']))));return true;
      }
      if(req.method==='POST'&&route==='/operations') {
        query(url,[]);const value=await body(req),prepared=await controller.prepare(value);
        json(res,202,await controller.run(prepared.id));return true;
      }
      if(req.method==='POST'&&route==='/remote/inspect') {
        query(url,[]);const value=await body(req);only(value,['profile','exportId']);
        json(res,200,await controller.inspectRemote(value));return true;
      }
      if(req.method==='GET'&&route==='/inventory') {
        const values=pagination(query(url,['kind','id','manifestSha','section','bundleId','bundleSha','offset','limit','q']));
        json(res,200,await controller.inventory({source:selection(values),expectedManifestSha256:values.manifestSha,
          section:values.section??'files',bundleId:values.bundleId,manifestSha256:values.bundleSha,offset:values.offset,limit:values.limit,q:values.q}));return true;
      }
      if(req.method==='GET'&&route==='/manifest') {
        const values=query(url,['kind','id','manifestSha']);
        json(res,200,await controller.manifest(selection(values),values.manifestSha));return true;
      }
      if(req.method==='GET'&&(route==='/files'||route==='/original-files')) {
        const values=query(url,['kind','id','manifestSha','name',...(route==='/original-files'?['bundleId','bundleSha']:[])]);
        await streamFile(controller,req,res,values,{original:route==='/original-files'});return true;
      }
      const match=/^\/(inputs|operations)\/([a-z0-9][a-z0-9_-]{0,63})(?:\/(manifest|files|run|stop|open))?$/.exec(route);
      if(!match){json(res,404,{error:'CASE_PACKAGE_ROUTE_NOT_FOUND'});return true;}
      const [,kind,id,action]=match;
      if(kind==='inputs') {
        if(req.method==='GET'&&!action) {
          const values=pagination(query(url,['members','offset','limit','q']));
          if(values.members!==undefined&&!['true','false'].includes(values.members))throw fail('CASE_PACKAGE_QUERY','members must be true or false.');
          json(res,200,await controller.getInput(id,{...values,members:values.members==='true'}));return true;
        }
        if(req.method==='PUT'&&action==='manifest') {
          const values=query(url,['actor','manifestSha']),manifestText=await textBody(req,MAX_CASE_SOURCE_MANIFEST_BYTES);
          json(res,201,await controller.prepareInput({id,actor:values.actor,manifestText,expectedManifestSha256:values.manifestSha}));return true;
        }
        if(req.method==='PUT'&&action==='files') {
          const values=query(url,['name']);
          if(req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()!=='application/octet-stream')
            throw fail('CASE_PACKAGE_CONTENT_TYPE','Upload the original file byte stream.',415);
          const signal=new AbortController();req.once('aborted',()=>signal.abort());
          json(res,200,await controller.upload({id,name:values.name,stream:req,signal:signal.signal}));return true;
        }
      } else {
        if(req.method==='GET'&&!action){query(url,[]);json(res,200,await controller.status(id));return true;}
        if(req.method==='POST'&&['run','stop','open'].includes(action)) {
          query(url,[]);const value=await body(req);only(value,[]);
          const result=await (action==='run'?controller.run:action==='stop'?controller.stop:controller.receivedCase)(id);
          json(res,action==='run'?202:200,result);return true;
        }
      }
      json(res,405,{error:'METHOD_NOT_ALLOWED'});return true;
    } catch(problem) {
      if(res.headersSent)res.destroy(problem);
      else {const detail=casePackageProblem(problem);json(res,detail.status,detail);}
      return true;
    }
  };
}
