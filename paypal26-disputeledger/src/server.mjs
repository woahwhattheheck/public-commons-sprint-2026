import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {PayPalDisputes} from './paypal.mjs';
import {SAMPLE,normalizeCase,preparePacket,validId} from './core.mjs';
import {advise} from './ai.mjs';

const port=Number(process.env.PORT||3168);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be 1024-65535');
const base='http://127.0.0.1:'+port;
const html=await readFile(new URL('./index.html',import.meta.url));
const paypal=new PayPalDisputes();
const cases=new Map(), TTL=15*60*1000;
function prune(){
  for(const [id,item]of cases)if(Date.now()-item.at>TTL)cases.delete(id);
  while(cases.size>80)cases.delete(cases.keys().next().value);
}
function save(raw,demo=false){
  const data=normalizeCase(raw,demo);
  cases.set(data.dispute_id,{data,at:Date.now()});prune();
  return data;
}
function json(res,status,value) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(value));
}
function checkPost(req){
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw Error('JSON request required');
  if(req.headers.origin&&req.headers.origin!==base)throw Error('Cross-origin operation refused');
  if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw Error('Cross-site operation refused');
}
async function body(req){
  const chunks=[];let bytes=0;
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>2048)throw Error('Request exceeds 2 KiB');
    chunks.push(chunk);
  }
  const result=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid JSON object');
  return result;
}
const server=http.createServer(async(req,res)=>{
  // Keep the local app pinned to its advertised loopback origin even for GETs.
  // A loopback bind alone does not validate the HTTP Host authority.
  if(req.headers.host!==`127.0.0.1:${port}`){
    json(res,403,{error:'Unexpected Host header'});return;
  }
  try{
    const url=new URL(req.url,base);
    if(req.method==='GET'&&url.pathname==='/'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
        'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});
      res.end(html);return;
    }
    if(req.method==='GET'&&url.pathname==='/api/health'){
      json(res,200,{ready:true,paypal_sandbox_configured:paypal.configured,
        ai_configured:!!(process.env.AI_CHAT_COMPLETIONS_URL&&process.env.AI_API_KEY&&process.env.AI_MODEL),
        mutations_supported:false,live_payments_supported:false});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/demo'){
      json(res,200,{case:save(SAMPLE,true),synthetic:true});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/disputes'){
      const fetched=await paypal.list();
      json(res,200,{cases:fetched.items.map(v=>save(v)),
        pages_read:fetched.pages_read,incomplete:fetched.incomplete,synthetic:false});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/detail'){
      const id=url.searchParams.get('id');
      if(!validId(id)||id.startsWith('DEMO-'))throw Error('Valid sandbox dispute ID required');
      json(res,200,{case:save(await paypal.detail(id)),synthetic:false});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/packet'){
      checkPost(req);
      const request=await body(req);
      if(!validId(request.id))throw Error('Select a sandbox or synthetic dispute first');
      prune();
      const known=cases.get(request.id);
      if(!known)throw Error('Review expired. Fetch the dispute again.');
      const packet=preparePacket(known.data,request.evidence||{});
      let advisory;
      try {advisory=await advise(packet);}
      catch {advisory={model_used:false,summary:'AI advisory unavailable. Deterministic checklist preserved; no filing occurred.',questions:[]};}
      json(res,200,{packet,advisory});return;
    }
    json(res,404,{error:'Route not found'});
  }catch(err){
    const safe=String(err?.message||'').slice(0,220);
    const provider=/PayPal|AI advisory|fetch failed|abort|network|OAuth/i.test(safe);
    json(res,provider?503:400,{error:provider?'Sandbox provider or optional advisory unavailable. Verify API access and retry manually; no dispute or payment was changed.':safe||'Invalid request'});
  }
});
server.listen(port,'127.0.0.1',()=>console.log('DisputeLedger read-only sandbox demo at '+base));
