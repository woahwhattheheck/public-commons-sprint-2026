// MIT. Private loopback analysis workspace over original retained files.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { listCaptures, listReviews, receiveBytes, openCapture, saveReview, captureId, decodeJson } from './library.mjs';
import { atPointer, compareSimulations, TABLE_COLUMNS, tableCsv, MAX_RESPONSE_BYTES, requireValue } from './analyze.mjs';
import { renderReview } from './report.mjs';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = {'index.html':'text/html; charset=utf-8','app.mjs':'text/javascript; charset=utf-8','style.css':'text/css; charset=utf-8'};
const MAX_UPLOAD = MAX_RESPONSE_BYTES + 8 * 1024 * 1024 + 65536;
const jsonBytes = value => Buffer.from(JSON.stringify(value) + '\n');
function integer(value, fallback, max) {
  if (value === null) return fallback;
  requireValue(/^[0-9]{1,9}$/.test(value), 'PAGE_RANGE_INVALID');
  const number = Number(value); requireValue(number <= max, 'PAGE_RANGE_INVALID'); return number;
}
function page(rows, query) {
  const offset = integer(query.get('offset'),0,100000), limit = integer(query.get('limit'),50,200);
  requireValue(limit > 0, 'PAGE_RANGE_INVALID');
  const search = query.get('q') ?? '';
  requireValue(search.length <= 200, 'SEARCH_TOO_LONG');
  const filtered = search ? rows.filter(row=>JSON.stringify(row).toLowerCase().includes(search.toLowerCase())) : rows;
  return {offset,limit,total:filtered.length,rows:filtered.slice(offset,offset+limit),hasMore:offset+limit<filtered.length};
}
async function body(req,limit) {
  const chunks=[]; let length=0;
  for await (const chunk of req) {
    length+=chunk.length; requireValue(length <= limit,'UPLOAD_SIZE_LIMIT'); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function summary(capture) {
  const {tables,...analysis}=capture.analysis; return {record:capture.record,analysis};
}
export async function startAnalysisWorkspace({workspace,port=0}={}) {
  requireValue(typeof workspace==='string' && Number.isInteger(port) && port>=0 && port<=65535,'WORKSPACE_OPTIONS_INVALID');
  await listCaptures(workspace);
  const token=randomBytes(32).toString('hex'), cache=new Map(); let origin;
  async function load(id) {
    captureId(id);
    const signatures=[];
    for(const name of ['capture.json','analysis.json','response.json','request.json','buyer-result.json']) {
      try {const value=await stat(join(workspace,'captures',id,name));
        signatures.push([name,value.ino,value.size,value.mtimeMs,value.ctimeMs]);}
      catch(error){if(error.code!=='ENOENT')throw error;signatures.push([name,null]);}
    }
    const signature=JSON.stringify(signatures), saved=cache.get(id);
    if(saved?.signature===signature)return saved.capture;
    const capture=await openCapture(workspace,id);
    cache.delete(id);cache.set(id,{signature,capture});
    if(cache.size>2)cache.delete(cache.keys().next().value);
    return capture;
  }
  const server=createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
    const send=(code,data,type='application/json; charset=utf-8',filename=null)=>{
      const content=Buffer.isBuffer(data)?data:jsonBytes(data);
      res.writeHead(code,{...headers,'Content-Type':type,'Content-Length':content.length,
        ...(filename?{'Content-Disposition':'attachment; filename="'+filename+'"'}:{})});res.end(content);
    };
    try {
      requireValue(req.headers.host===new URL(origin).host,'HOST_REFUSED');
      requireValue(!req.headers.origin||req.headers.origin===origin,'ORIGIN_REFUSED');
      const url=new URL(req.url,origin), path=url.pathname;
      if(req.method==='GET' && (path==='/'||Object.hasOwn(TYPES,path.slice(1)))){
        const name=path==='/'?'index.html':path.slice(1);
        send(200,await readFile(join(PUBLIC,name)),TYPES[name]);return;
      }
      const auth=Buffer.from(req.headers.authorization??''), expected=Buffer.from('Bearer '+token);
      requireValue(auth.length===expected.length&&timingSafeEqual(auth,expected),'AUTH_REQUIRED');
      if(req.method==='GET'&&path==='/api/state'){
        send(200,{captures:await listCaptures(workspace),reviews:await listReviews(workspace)});return;
      }
      if(req.method==='POST'&&path==='/api/receive'){
        requireValue((req.headers['content-type']??'').startsWith('multipart/form-data;'),'UPLOAD_FORM_REQUIRED');
        const form=await new Response(await body(req,MAX_UPLOAD),{headers:{'Content-Type':req.headers['content-type']}}).formData();
        const file=async(name,required=false)=>{
          const value=form.get(name);
          requireValue(!required||value&&typeof value.arrayBuffer==='function','RESPONSE_FILE_REQUIRED');
          if(value===null||value.size===0)return null;
          requireValue(typeof value.arrayBuffer==='function','UPLOAD_FILE_INVALID');
          return Buffer.from(await value.arrayBuffer());
        };
        const received=await receiveBytes(await file('response',true),{workspace,label:form.get('label')??'',
          payloadPointer:form.get('payloadPointer')??'',requestBytes:await file('request'),nativeBytes:await file('buyerResult')});
        send(201,summary(received));return;
      }
      let match=path.match(/^\/api\/captures\/([a-f0-9]{64})$/);
      if(req.method==='GET'&&match){send(200,summary(await load(match[1])));return;}
      match=path.match(/^\/api\/captures\/([a-f0-9]{64})\/tables\/(calls|state|assets|logs)$/);
      if(req.method==='GET'&&match){const capture=await load(match[1]);
        send(200,{columns:TABLE_COLUMNS[match[2]],...page(capture.analysis.tables[match[2]],url.searchParams)});return;}
      if(req.method==='GET'&&path==='/api/compare'){
        const before=await load(url.searchParams.get('before')),after=await load(url.searchParams.get('after'));
        const comparison=compareSimulations(before.analysis,after.analysis),table=url.searchParams.get('table');
        if(table){requireValue(Object.hasOwn(comparison.changes,table),'TABLE_NAME_INVALID');
          send(200,page(comparison.changes[table],url.searchParams));}
        else {const {changes,...data}=comparison;send(200,{before:before.record,after:after.record,...data});}return;
      }
      if(req.method==='GET'&&path==='/api/source'){
        const capture=await load(url.searchParams.get('id'));
        send(200,{pointer:url.searchParams.get('pointer')??'',value:atPointer(capture.source,url.searchParams.get('pointer')??'')});return;
      }
      if(req.method==='POST'&&path==='/api/reviews'){
        requireValue((req.headers['content-type']??'').startsWith('application/json'),'JSON_BODY_REQUIRED');
        const result=await saveReview(workspace,decodeJson(await body(req,65536)));
        send(201,{id:result.id,title:result.review.title});return;
      }
      match=path.match(/^\/api\/reviews\/([a-f0-9]{64})\/(review\.html|review\.json)$/);
      if(req.method==='GET'&&match){captureId(match[1]);
        const content=await readFile(join(workspace,'reviews',match[1],match[2]));
        send(200,content,match[2].endsWith('.html')?'text/html; charset=utf-8':'application/json; charset=utf-8',match[2]);return;}
      match=path.match(/^\/api\/download\/([a-f0-9]{64})\/(response\.json|request\.json|buyer-result\.json|analysis\.json|review\.html|calls\.csv|state\.csv|assets\.csv|logs\.csv)$/);
      if(req.method==='GET'&&match){
        const capture=await load(match[1]),file=match[2];let content,type='application/json; charset=utf-8';
        if(file==='response.json')content=capture.responseBytes;
        else if(file==='analysis.json')content=jsonBytes(capture.analysis);
        else if(file==='review.html'){content=Buffer.from(renderReview({title:capture.record.label,before:capture.record,
          analysis:capture.analysis,notes:'',comparison:null}));type='text/html; charset=utf-8';}
        else if(file.endsWith('.csv')){content=Buffer.from(tableCsv(file.slice(0,-4),capture.analysis.tables[file.slice(0,-4)]));type='text/csv; charset=utf-8';}
        else content=capture.inputs[file];
        requireValue(content,'SOURCE_FILE_UNAVAILABLE');send(200,content,type,file);return;
      }
      send(404,{error:'ROUTE_NOT_FOUND'});
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      const known=typeof error.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code);
      const code=known?error.code:'ANALYSIS_OPERATION_FAILED';
      const status=code==='AUTH_REQUIRED'?401:code==='HOST_REFUSED'||code==='ORIGIN_REFUSED'?403:code==='ENOENT'?404:400;
      send(status,{error:code,message:known&&error.name==='AnalysisError'?error.message:code});
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});
  origin='http://127.0.0.1:'+server.address().port;
  return {server,origin,url:origin+'/#token='+token,token,
    close:()=>new Promise((accept,reject)=>{server.close(error=>error?reject(error):accept());server.closeIdleConnections();})};
}
