// MIT. Feed routes use the original local server's host/origin/bearer boundary.
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {check} from './contract.mjs';
const id='([A-Za-z0-9][A-Za-z0-9_-]{0,79})';
const revision=url=>url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined;
export async function handleFeedRequest({req,res,url,send,jsonBody,tablePage,zipArchive,headers,feed}){
  const path=url.pathname;if(!path.startsWith('/api/feeds'))return false;
  const params=()=>({contractId:url.searchParams.get('contract'),contractRevision:revision(url),editionId:url.searchParams.get('edition')});
  if(req.method==='GET'&&path==='/api/feeds'){send(200,{contracts:await feed.contracts(),defaultContract:feed.defaultContract()});return true;}
  if(req.method==='POST'&&path==='/api/feeds/contracts'){send(201,await feed.saveContract(await jsonBody(req,1048576)));return true;}
  if(req.method==='GET'&&path==='/api/feeds/preview'){
    const p=await feed.preview(params()),view=url.searchParams.get('view')??'records';check(['records','exceptions','omissions'].includes(view),'FEED_VIEW_INVALID');
    const {rows,exceptions,omitted,...context}=p;let selected=view==='records'?rows:view==='exceptions'?exceptions:omitted;
    const status=url.searchParams.get('status');if(status&&view==='exceptions')selected=selected.filter(x=>x.status===status);
    send(200,{...context,view,page:tablePage(selected,url.searchParams)});return true;
  }
  if(req.method==='POST'&&path==='/api/feeds/resolve'){send(200,await feed.resolveException(await jsonBody(req,2097152)));return true;}
  if(req.method==='GET'&&path==='/api/feeds/compare'){
    const result=await feed.compare({...params(),beforeId:url.searchParams.get('before')}),view=url.searchParams.get('view')??'changed';check(['added','removed','changed','unchanged'].includes(view),'FEED_COMPARISON_VIEW_INVALID');
    const {added,removed,changed,unchanged,...context}=result;send(200,{...context,view,page:tablePage(result[view].map(x=>typeof x==='string'?{workId:x}:x),url.searchParams)});return true;
  }
  if(req.method==='GET'&&path==='/api/feeds/releases'){send(200,{releases:await feed.releases({contractId:url.searchParams.get('contract'),editionId:url.searchParams.get('edition')})});return true;}
  if(req.method==='POST'&&path==='/api/feeds/freeze'){send(201,await feed.freeze(await jsonBody(req)));return true;}
  let match=path.match(new RegExp('^/api/feeds/releases/'+id+'/download/([A-Za-z0-9][A-Za-z0-9_.-]{0,120})$'));
  if(req.method==='GET'&&match){const name=match[2],type=name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.json')?'application/json; charset=utf-8':'text/plain; charset=utf-8';send(200,await feed.releaseFile(match[1],name),type,name);return true;}
  match=path.match(new RegExp('^/api/feeds/releases/'+id+'/bundle.zip$'));
  if(req.method==='GET'&&match){
    const entries=feed.releaseEntries(match[1]),first=await entries.next();
    async function* all(){try{if(!first.done)yield first.value;yield* entries;}finally{await entries.return?.();}}
    res.writeHead(200,{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+match[1]+'.zip"'});
    await pipeline(Readable.from(zipArchive(all()),{objectMode:false,highWaterMark:65536}),res);return true;
  }
  send(404,{error:'FEED_ROUTE_NOT_FOUND',message:'This feed route was not found.'});return true;
}
