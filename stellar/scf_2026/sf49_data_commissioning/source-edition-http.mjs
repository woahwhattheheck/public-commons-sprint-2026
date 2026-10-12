// MIT. Streamed source bundles inside the original authenticated SF74 server.
import {constants} from 'node:fs';
import {open,readFile,realpath,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SOURCE_DELIVERY_HTTP_BASE} from './source-edition-delivery.mjs';

const MAX_JSON=2*1024**2,BASE=SOURCE_DELIVERY_HTTP_BASE;
const ASSETS=new Map([
  ['/commissioning-source/panel.mjs',['source-edition-panel.mjs','text/javascript; charset=utf-8']],
  ['/commissioning-source/panel.css',['source-edition-panel.css','text/css; charset=utf-8']]
]);
const fault=(code,message=code,status=422)=>Object.assign(new Error(message),{code,status});
const assert=(value,code,message,status)=>{if(!value)throw fault(code,message,status);};
function send(res,status,value) {
  if(res.destroyed)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'});res.end(JSON.stringify(value));
}
function keys(value,allowed) {
  assert(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>allowed.includes(key)),'SF49_HTTP_INPUT_INVALID');
}
function query(url,allowed) {
  const result={};
  for(const [key,value]of url.searchParams) {
    assert(allowed.includes(key)&&!Object.hasOwn(result,key),'SF49_HTTP_QUERY_INVALID');result[key]=value;
  }
  return result;
}
async function json(req) {
  assert(req.headers['content-type']?.split(';')[0]?.trim()==='application/json',
    'SF49_HTTP_JSON_REQUIRED','Use a JSON metadata request.',415);
  assert(!req.headers['content-encoding']||req.headers['content-encoding']==='identity',
    'SF49_HTTP_ENCODING_INVALID','Send original bytes without content encoding.',415);
  const declared=req.headers['content-length'];
  if(declared!==undefined)assert(/^(0|[1-9][0-9]*)$/.test(declared)&&Number(declared)<=MAX_JSON,
    'SF49_HTTP_METADATA_LIMIT','Source metadata exceeds 2 MiB.',413);
  let total=0;const chunks=[];
  for await(const chunk of req) {
    total+=chunk.length;assert(total<=MAX_JSON,'SF49_HTTP_METADATA_LIMIT','Source metadata exceeds 2 MiB.',413);
    chunks.push(chunk);
  }
  assert(total>0,'SF49_HTTP_JSON_EMPTY');
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total)));}
  catch {throw fault('SF49_HTTP_JSON_INVALID');}
}
function selectedRange(value,length) {
  if(!value)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  assert(match&&(match[1]||match[2])&&length>0,'SF49_HTTP_RANGE_INVALID','Choose one valid byte range.',416);
  let start,end;
  if(match[1]) {start=Number(match[1]);end=match[2]?Number(match[2]):length-1;}
  else {const suffix=Number(match[2]);assert(Number.isSafeInteger(suffix)&&suffix>0,'SF49_HTTP_RANGE_INVALID',undefined,416);
    start=Math.max(0,length-suffix);end=length-1;}
  assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<length&&end>=start,
    'SF49_HTTP_RANGE_INVALID','The requested range is outside the retained file.',416);
  return {start,end:Math.min(end,length-1)};
}
function sameStat(before,after) {
  return before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
    before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs;
}
async function write(res,bytes) {
  if(res.destroyed)throw fault('SF49_HTTP_DOWNLOAD_ABORTED');
  if(!res.write(bytes))await new Promise((done,reject)=>{
    const clear=()=>{res.removeListener('drain',drained);res.removeListener('close',closed);res.removeListener('error',failed);};
    const drained=()=>{clear();done();},closed=()=>{clear();reject(fault('SF49_HTTP_DOWNLOAD_ABORTED'));},
      failed=error=>{clear();reject(error);};
    res.once('drain',drained);res.once('close',closed);res.once('error',failed);
  });
}
function disposition(name) {
  const safe=String(name).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,180)||'source-edition.bin';
  return 'attachment; filename="'+safe+'"; filename*=UTF-8\'\''+encodeURIComponent(String(name));
}

/** The original host invokes handle before its JSON body reader, after its own
 * authentication. The host supplies its actual bound origin, never request input.
 * close drains only these downloads and the one supplied delivery service.
 */
export function createSourceEditionDeliveryRoutes({service}) {
  assert(service&&typeof service.dispatch==='function','SF49_HTTP_SERVICE_REQUIRED');
  const downloads=new Set();let closing=false,closingPromise;
  async function download(req,res,file) {
    assert(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&/^[a-f0-9]{64}$/.test(file.sha256),
      'SF49_HTTP_ARTIFACT_INVALID');
    assert(await realpath(file.path)===file.path,'SF49_HTTP_ARTIFACT_ALIAS');
    const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let stream,done;const completion=new Promise(resolve=>{done=resolve;});
    const owned={promise:completion,stop:()=>{stream?.destroy(fault('SF49_HTTP_DOWNLOAD_ABORTED'));res.destroy();}};
    downloads.add(owned);
    const closed=()=>{stream?.destroy(fault('SF49_HTTP_DOWNLOAD_ABORTED'));};
    res.once('close',closed);
    try {
      const before=await handle.stat({bigint:true}),visible=await lstat(file.path,{bigint:true});
      assert(before.isFile()&&!visible.isSymbolicLink()&&(before.mode&0o077n)===0n&&
        before.size===BigInt(file.bytes)&&before.ino===visible.ino&&before.dev===visible.dev,
        'SF49_HTTP_ARTIFACT_CHANGED');
      const etag='"'+file.sha256+'"';
      let range;
      try {range=selectedRange(!req.headers['if-range']||req.headers['if-range']===etag?req.headers.range:null,file.bytes);}
      catch(error){res.setHeader('content-range','bytes */'+file.bytes);throw error;}
      const headers={'content-type':file.type||'application/octet-stream','content-length':String(range?range.end-range.start+1:file.bytes),
        'content-disposition':disposition(file.filename),'etag':etag,'accept-ranges':'bytes','cache-control':'no-store',
        'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",
        'x-source-sha256':file.sha256,'x-source-verification':req.method==='HEAD'?'retained-manifest':range?'retained-manifest-range':'stream-sha256'};
      if(range)headers['content-range']='bytes '+range.start+'-'+range.end+'/'+file.bytes;
      if(!file.bytes)assert(createHash('sha256').digest('hex')===file.sha256,'SF49_HTTP_ARTIFACT_DIGEST_CHANGED');
      res.writeHead(range?206:200,headers);
      if(req.method==='HEAD') {res.end();return;}
      if(closing)throw fault('SF49_HTTP_CLOSING',undefined,503);
      if(file.bytes===0) {
        assert(createHash('sha256').digest('hex')===file.sha256,'SF49_HTTP_ARTIFACT_DIGEST_CHANGED');
        res.end();return;
      }
      stream=handle.createReadStream({autoClose:false,highWaterMark:64*1024,
        start:range?.start??0,end:range?.end??file.bytes-1});
      const hash=range?null:createHash('sha256');let count=0,tail=null;
      for await(const chunk of stream) {
        hash?.update(chunk);count+=chunk.length;
        // Keep the final chunk until the opened file and complete digest agree.
        if(tail)await write(res,tail);tail=chunk;
      }
      const after=await handle.stat({bigint:true}),named=await lstat(file.path,{bigint:true});
      assert(sameStat(before,after)&&named.dev===before.dev&&named.ino===before.ino&&
        !named.isSymbolicLink()&&count===(range?range.end-range.start+1:file.bytes),'SF49_HTTP_ARTIFACT_CHANGED');
      if(hash)assert(hash.digest('hex')===file.sha256,'SF49_HTTP_ARTIFACT_DIGEST_CHANGED');
      if(tail)await write(res,tail);res.end();
    }finally {
      res.removeListener('close',closed);stream?.destroy();
      try {await handle.close();}finally {downloads.delete(owned);done();}
    }
  }
  return {
    async handle(req,res,{origin}) {
      const route=new URL(req.url,origin);
      if(!ASSETS.has(route.pathname)&&route.pathname!==BASE&&!route.pathname.startsWith(BASE+'/'))return false;
      try {
        assert(!closing,'SF49_HTTP_CLOSING','The original workspace is closing.',503);
        const trusted=new URL(origin);
        assert(trusted.origin===origin&&route.origin===origin&&req.headers.host===trusted.host,'SF49_HTTP_HOST_MISMATCH',undefined,403);
        assert((!req.headers.origin||req.headers.origin===origin)&&
          (!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']))&&
          (['GET','HEAD'].includes(req.method)||req.headers.origin===origin),
          'SF49_HTTP_ORIGIN_MISMATCH',undefined,403);
        if(ASSETS.has(route.pathname)) {
          assert(['GET','HEAD'].includes(req.method)&&!route.search,'SF49_HTTP_METHOD_INVALID',undefined,405);
          const [name,type]=ASSETS.get(route.pathname),bytes=await readFile(new URL('./'+name,import.meta.url));
          assert(bytes.length<=256*1024,'SF49_HTTP_ASSET_LIMIT');
          res.writeHead(200,{'content-type':type,'content-length':bytes.length,'cache-control':'no-store',
            'x-content-type-options':'nosniff'});
          res.end(req.method==='HEAD'?undefined:bytes);return true;
        }
        const action=route.pathname.slice(BASE.length);
        if(req.method==='GET'&&action==='/state') {
          const input=query(route,['caseId','offset','limit']);
          for(const field of ['offset','limit'])if(field in input) {
            assert(/^(0|[1-9][0-9]*)$/.test(input[field]),'SF49_HTTP_PAGE_INVALID');input[field]=Number(input[field]);
          }
          send(res,200,await service.state(input));return true;
        }
        if(req.method==='GET'&&action==='/transfer') {send(res,200,await service.get(query(route,['id'])));return true;}
        if(req.method==='GET'&&action==='/command') {send(res,200,await service.command(query(route,['id','requestId'])));return true;}
        if(req.method==='POST'&&action==='/command') {
          assert(!route.search,'SF49_HTTP_QUERY_INVALID');
          const input=await json(req);keys(input,['id','requestId','action','input','continue']);
          send(res,202,await service.dispatch(input));return true;
        }
        if(req.method==='PUT'&&action==='/upload') {
          const {id,file}=query(route,['id','file']),transfer=await service.get({id});
          const selected=transfer.files.find(value=>value.id===file);
          assert(selected,'SF49_HTTP_FILE_NOT_DECLARED');
          assert(!req.headers['content-encoding']||req.headers['content-encoding']==='identity',
            'SF49_HTTP_ENCODING_INVALID','Send original file bytes.',415);
          assert(req.headers['content-type']?.split(';')[0]?.trim()==='application/octet-stream',
            'SF49_HTTP_BINARY_REQUIRED','Upload the original file as application/octet-stream.',415);
          const length=req.headers['content-length'];
          assert(length===undefined||length===selected.bytes,'SF49_HTTP_UPLOAD_LENGTH_MISMATCH',undefined,413);
          // Browser File is streamed directly. The original writer enforces the
          // declared byte ceiling even when this request uses chunked transport.
          const controller=new AbortController(),stop=()=>controller.abort();
          req.once('aborted',stop);
          try {send(res,200,await service.upload({id,fileId:file,stream:req,signal:controller.signal}));}
          finally {req.removeListener('aborted',stop);}
          return true;
        }
        if(['GET','HEAD'].includes(req.method)&&action==='/download') {
          await download(req,res,await service.artifact(query(route,['id','kind','name'])));return true;
        }
        send(res,404,{error:'SF49_HTTP_NOT_FOUND'});return true;
      }catch(error) {
        if(res.headersSent)res.destroy();
        else send(res,Number(error?.status)||422,{error:typeof error?.code==='string'?error.code:'SF49_HTTP_FAILED',
          detail:typeof error?.code==='string'?String(error.message).slice(0,400):'The retained source operation could not complete.'});
        return true;
      }
    },
    close() {
      if(closingPromise)return closingPromise;closing=true;
      closingPromise=(async()=>{
        for(const transfer of downloads)transfer.stop();
        const results=await Promise.allSettled([service.close(),...[...downloads].map(value=>value.promise)]);
        const failed=results.find(value=>value.status==='rejected');if(failed)throw failed.reason;
      })();return closingPromise;
    }
  };
}
