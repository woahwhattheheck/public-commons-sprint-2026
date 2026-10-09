import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeCart,staticReview,InputError} from './core.mjs';
import {reviewWithModel} from './ai.mjs';
import {PayPalSandbox} from './paypal.mjs';
import {checkout} from './checkout.mjs';

const port=Number(process.env.PORT || 3159);
if (!Number.isInteger(port)||port < 1024||port > 65535) throw new Error('PORT invalid');
const base=`http://127.0.0.1:${port}`;
const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'index.html'));
const reviews=new Map();
const paypal=new PayPalSandbox();
const TTL=30*60*1000;
function getReview(id){
  const r=reviews.get(id);
  if (!r || Date.now()-r.created>TTL) throw new InputError('review missing or expired');
  return r;
}
function send(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
async function body(req){
  const chunks=[];let len=0;
  for await (const chunk of req){len+=chunk.length; if(len>8192)throw new InputError('request too large'); chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('expected JSON body');}
}
function assertPost(req){
  const content=req.headers['content-type']||'';
  if (!content.startsWith('application/json')) throw new InputError('JSON content type required');
  const origin=req.headers.origin;
  if (origin && origin!==base)throw new InputError('cross-origin request rejected');
  const site=req.headers['sec-fetch-site'];
  if(site && !['same-origin','none'].includes(site))throw new InputError('cross-site request rejected');
}
function prune(){for(const [k,v] of reviews)if(Date.now()-v.created>TTL)reviews.delete(k);}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,base);
    if(req.method==='GET' && url.pathname==='/'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",'X-Frame-Options':'DENY'});
      res.end(html);return;
    }
    if(req.method==='GET' && url.pathname==='/api/health'){send(res,200,{ready:true,paypal_sandbox_configured:!!(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET),ai_provider_configured:process.env.AI_PROVIDER==='anthropic'?!!(process.env.ANTHROPIC_API_KEY&&process.env.ANTHROPIC_MODEL):!!(process.env.AI_CHAT_COMPLETIONS_URL&&process.env.AI_API_KEY&&process.env.AI_MODEL)});return;}
    if(req.method!=='POST' || !['/api/review','/api/create','/api/capture','/api/status'].includes(url.pathname)){send(res,404,{error:'route not found'});return;}
    assertPost(req);const request=await body(req);prune();
    if(url.pathname==='/api/review'){
      const cart=normalizeCart(request);const findings=staticReview(cart);
      let ai;try{ai=await reviewWithModel(cart);}catch(e){ai={model_used:false,summary:`AI advisory unavailable (${e instanceof InputError?'invalid response':'provider error'}). No purchase was initiated.`,questions:[]};}
      const review_id=randomUUID(),review={cart,findings,ai,created:Date.now(),state:'REVIEWED',order:null,createRequestId:randomUUID(),captureRequestId:randomUUID()};
      reviews.set(review_id,review);
      send(res,200,{review_id,cart,findings,ai,state:'REVIEWED',payment_authority:false});return;
    }
    if (!request||typeof request.review_id!=='string')throw new InputError('review_id required');
    const review=getReview(request.review_id);
    const result=await checkout(review,url.pathname.slice('/api/'.length),request,paypal,base);
    send(res,['CAPTURE_PENDING','CAPTURE_UNKNOWN'].includes(result.state)?202:200,result);
  }catch(e){
    const client=e instanceof InputError;
    send(res,client?400:503,{error:client?e.message:'Sandbox provider outcome could not be verified. If a capture was attempted, payment may have completed. Use Check sandbox status on this review or inspect the original PayPal sandbox order before starting another checkout. Status checks never request capture.'});
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`ClaimProof Commerce: ${base} (loopback only; sandbox only)`));
