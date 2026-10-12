// MIT. Paired cutover HTTP uses the original local workspace authority and token.
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {startRedisWorkspaceHttpServer} from './server.mjs';

const assets=new Map([
  ['/', ['cutover.html','text/html; charset=utf-8']],
  ['/cutover.mjs',['cutover.mjs','text/javascript; charset=utf-8']],
  ['/cutover.css',['cutover.css','text/css; charset=utf-8']],
  ['/local-draft-store.mjs',['../../../python/workspace/local-draft-store.mjs','text/javascript; charset=utf-8']],
]);
const issue=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
function query(url,names){
  const seen=new Set();
  for(const key of url.searchParams.keys()){
    if(!names.includes(key)||seen.has(key))throw issue('REDIS_CUTOVER_QUERY_INVALID','Use the supported cutover query parameters.');
    seen.add(key);
  }
}
function numeric(value,fallback){return value===null?fallback:Number(value);}
function range(value,size){
  if(value===undefined)return {start:0,end:size,status:200};
  const matched=typeof value==='string'&&value.match(/^bytes=(\d+)-(\d*)$/);
  if(!matched)throw issue('REDIS_CUTOVER_RANGE_INVALID','Choose one exact byte range of the original file.',416);
  const start=Number(matched[1]),end=matched[2]?Number(matched[2])+1:size;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<=start||end>size)
    throw issue('REDIS_CUTOVER_RANGE_INVALID','Choose an available range of the original complete file.',416);
  return {start,end,status:206};
}
async function handle({workspace,req,res,url,origin,json,body}){
  const edition=url.searchParams.get('edition')??'original';
  if(req.method==='GET'&&url.pathname==='/api/state'){
    query(url,['edition']);return json(res,200,await workspace.state({edition}));
  }
  if(req.method==='GET'&&url.pathname==='/api/progress'){
    query(url,['edition']);return json(res,200,await workspace.progress({edition}));
  }
  if(req.method==='GET'&&url.pathname==='/api/history'){
    query(url,['after','limit']);return json(res,200,await workspace.history({
      after:url.searchParams.get('after')??'',limit:numeric(url.searchParams.get('limit'),25)}));
  }
  if(req.method==='GET'&&url.pathname==='/api/difference'){
    query(url,['edition','checkId','kind','offset','limit']);
    return json(res,200,await workspace.difference({edition,checkId:url.searchParams.get('checkId'),
      kind:url.searchParams.get('kind')??'changed',offset:numeric(url.searchParams.get('offset'),0),limit:numeric(url.searchParams.get('limit'),25)}));
  }
  if(req.method==='GET'&&url.pathname==='/api/file'){
    query(url,['edition','kind','checkId']);const kind=url.searchParams.get('kind');
    const original=await workspace.file({edition,kind,...(url.searchParams.has('checkId')?{checkId:url.searchParams.get('checkId')}:{})});
    try{
      const selected=range(req.headers.range,original.bytes),headers={
        'content-type':original.type,'content-length':selected.end-selected.start,
        'content-disposition':'attachment; filename="'+original.name+'"','cache-control':'no-store',
        'x-content-type-options':'nosniff','referrer-policy':'no-referrer','accept-ranges':'bytes',
        'x-cutover-file-sha256':original.sha256,'x-cutover-file-bytes':String(original.bytes),
        'repr-digest':'sha-256=:'+Buffer.from(original.sha256,'hex').toString('base64')+':'};
      if(selected.status===206)headers['content-range']='bytes '+selected.start+'-'+(selected.end-1)+'/'+original.bytes;
      res.writeHead(selected.status,headers);
      return await pipeline(Readable.from(original.stream({start:selected.start,end:selected.end})),res);
    }finally{await original.close();}
  }
  if(req.method==='POST'&&url.pathname.startsWith('/api/')&&!url.search){
    if(req.headers.origin!==origin)throw issue('WORKSPACE_ORIGIN_REQUIRED','Send this operation from its original workspace origin.',403);
    const input=await body(req,9437184),name=url.pathname.slice(5);
    const actions={review:'review',save:'save',start:'start',continue:'continue',pause:'pause',
      'new-edition':'newEdition','open-side':'openSide','close-editors':'closeWindows'};
    if(Object.hasOwn(actions,name))return json(res,200,await workspace[actions[name]](input));
  }
  return json(res,404,{error:'REDIS_CUTOVER_ROUTE_NOT_FOUND',message:'That cutover operator action does not exist.'});
}
export async function startRedisCutoverServer({workspace,port=8440}={}){
  return startRedisWorkspaceHttpServer({workspace,port,assets,route:handle});
}
