// MIT. Authored local HTTP protocol exercise over the unchanged upstream Zotero fixture.
// The original fixture and its AGPL notice are retained separately under reference/zotero.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SCHEMA,need,json,parse,sha256} from '../contracts.mjs';
export const LIBRARY={type:'users',id:'999999999999'};
export const ROOT_COLLECTION='REVIEW01',CHILD_COLLECTION='REVIEW02',OTHER_COLLECTION='OTHER001';
const collection=(key,name,parentCollection=false)=>({key,version:0,library:{type:'user',id:Number(LIBRARY.id)},
  data:{key,version:0,name,parentCollection,relations:{}}});
export async function loadProtocolSources(){
  const path=fileURLToPath(new URL('../reference/zotero/itemJSON.js',import.meta.url)),bytes=await readFile(path);
  const git=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  need(git==='c0d701db17d6c9dac21f7a6d08f4d75401351f9b','ZOTERO_UPSTREAM_FIXTURE_CHANGED');
  const original=parse(bytes),items=Object.values(original).map((data,i)=>{
    const selected=structuredClone(data);selected.collections=[i%2?CHILD_COLLECTION:ROOT_COLLECTION];
    selected.tags=[{tag:'original-software-fixture',type:0}];
    return {key:selected.key,version:selected.version,library:{type:'user',id:Number(LIBRARY.id)},data:selected};
  });
  const journal=original.journalArticle.key;
  items.push({key:'NOTE0001',version:0,library:{type:'user',id:Number(LIBRARY.id)},data:{key:'NOTE0001',version:0,itemType:'note',
    parentItem:journal,note:'<p>Authored local protocol note. No provider or research claim.</p>',tags:[],relations:{}}});
  items.push({key:'ATTACH01',version:0,library:{type:'user',id:Number(LIBRARY.id)},data:{key:'ATTACH01',version:0,itemType:'attachment',
    parentItem:journal,linkMode:'linked_url',title:'Authored metadata-only attachment',url:'https://example.invalid/retained-document',
    contentType:'application/pdf',tags:[],relations:{}}});
  const collections=[collection(ROOT_COLLECTION,'Authored review collection'),collection(CHILD_COLLECTION,'Authored child collection',ROOT_COLLECTION),
    collection(OTHER_COLLECTION,'Authored comparison collection')];
  const changedItems=structuredClone(items),changed=changedItems.find(r=>r.key===journal);
  changed.version=1;changed.data.version=1;changed.data.title='Authored revised journal fixture — α and retained fields';
  changed.data.collections=[OTHER_COLLECTION];changed.data.tags.push({tag:'reviewed-revision',type:0});
  changed.data.creators.push({creatorType:'author',name:'Authored protocol group'});
  changed.data.extra+='\\nReviewed source variation: preserve literal metadata.';
  const removed=original.book.key;
  const revised=changedItems.filter(r=>r.key!==removed);
  revised.push({key:'NEWITEM1',version:1,library:{type:'user',id:Number(LIBRARY.id)},data:{key:'NEWITEM1',version:1,itemType:'document',
    title:'Authored additional protocol item',creators:[{creatorType:'author',name:'Example receiving operator'}],
    abstractNote:'Source changes remain linked to exact original files.',collections:[ROOT_COLLECTION],tags:[],relations:{},rights:'Authored protocol exercise'}});
  return {schema:'commons.zotero-protocol-sources.v1',original:{path,bytes:bytes.length,sha256:sha256(bytes),gitBlobSha:git,itemTypes:Object.keys(original)},
    library:LIBRARY,collections,items,revised,journal,removed,reference:'Zotero itemJSON.js original blob '+git+' plus explicitly authored protocol envelopes/collections/changes',
    documents:{collections:json(collections),items:json(items),revised:json(revised)}};
}
export async function startProtocolSource({sources,port=0,runId}){
  let version=20,changeOnItems=false,backoffOnce=false,holdItems=false,closing=false;
  const secret=randomBytes(32).toString('hex'),held=new Set(),waiters=new Set(),sockets=new Set(),history=[];
  const server=createServer((req,res)=>{
    if(closing){res.writeHead(503);res.end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    const supplied=req.headers['zotero-api-key']??'';
    const authenticated=typeof supplied==='string'&&supplied.length===secret.length&&
      timingSafeEqual(Buffer.from(supplied),Buffer.from(secret));
    if(!authenticated||req.headers['zotero-api-version']!=='3'){
      res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"LOCAL_PROTOCOL_AUTH_REQUIRED"}');return;
    }
    need(req.method==='GET'&&url.pathname.startsWith('/users/'+LIBRARY.id+'/'),'ZOTERO_PROTOCOL_SCOPE_CHANGED');
    const isCollection=url.pathname.endsWith('/collections'),isProbe=url.searchParams.get('format')==='versions';
    const start=Number(url.searchParams.get('start')??0),kind=isProbe?'probe':isCollection?'collections':'items';
    history.push({method:req.method,path:url.pathname,query:url.search,kind,authenticated:true,at:new Date().toISOString()});
    const send=()=>{
      if(res.destroyed||res.writableEnded)return;
      if(backoffOnce){backoffOnce=false;res.writeHead(429,{'Content-Type':'application/json','Retry-After':'1'});res.end('{"error":"LOCAL_PROTOCOL_BACKOFF"}');return;}
      if(changeOnItems&&kind==='items'){version++;changeOnItems=false;}
      const all=isCollection?sources.collections:sources.items,limit=isCollection?2:7,next=start+limit;
      const bytes=isProbe?json({}):json(all.slice(start,next));
      const headers={'Content-Type':'application/json','Content-Length':bytes.length,'Zotero-API-Version':'3',
        'Last-Modified-Version':String(version),'Total-Results':String(isProbe?0:all.length)};
      if(!isProbe&&next<all.length){
        const link=new URL('https://api.zotero.org'+url.pathname+url.search);link.searchParams.set('start',String(next));
        headers.Link='<'+link.href+'>; rel="next"';
      }
      res.writeHead(200,headers);res.end(bytes);
    };
    if(holdItems&&kind==='items'){
      const item={res,send};held.add(item);
      res.once('close',()=>held.delete(item));
      for(const resolve of waiters)resolve();waiters.clear();
    }else send();
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});
  const endpoint='http://127.0.0.1:'+server.address().port;
  return {endpoint,transport:{mode:'local-protocol-exercise',id:'zotero-native:'+runId,endpoint,sourceReference:sources.reference},
    environment:{ZOTERO_NATIVE_EXERCISE_KEY:secret},
    fetchImpl:(url,options)=>{const selected=new URL(url);need(selected.origin==='https://api.zotero.org','ZOTERO_PROTOCOL_INPUT_ORIGIN_CHANGED');
      return fetch(endpoint+selected.pathname+selected.search,options);},
    setVersion(value){need(Number.isSafeInteger(value)&&value>=20,'ZOTERO_PROTOCOL_VERSION_INVALID');version=value;},
    mode({change=false,backoff=false,hold=false}={}){changeOnItems=change;backoffOnce=backoff;holdItems=hold;},
    release(){holdItems=false;for(const item of held)item.send();held.clear();},
    async heldRequest(){if(held.size)return;await new Promise((yes,no)=>{const resolve=()=>{clearTimeout(timer);yes();};
      const timer=setTimeout(()=>{waiters.delete(resolve);no(Object.assign(new Error('ZOTERO_PROTOCOL_HELD_REQUEST_TIMEOUT'),{code:'ZOTERO_PROTOCOL_HELD_REQUEST_TIMEOUT'}));},10000);
      waiters.add(resolve);});},
    summary(){return {schema:'commons.zotero-protocol-http-result.v1',endpoint,version,requests:history.length,
      authenticatedRequests:history.filter(h=>h.authenticated).length,liveZoteroRequests:0,customerCalls:0,remoteWrites:0,history:[...history]};},
    async close(){if(closing)return;closing=true;holdItems=false;
      for(const item of held){item.res.destroy();}held.clear();for(const resolve of waiters)resolve();waiters.clear();
      const done=new Promise((yes,no)=>server.close(error=>error?no(error):yes()));server.closeIdleConnections?.();
      const timer=setTimeout(()=>{for(const socket of sockets)socket.destroy();},1000);timer.unref();
      try{await done;}finally{clearTimeout(timer);}
    }
  };
}
