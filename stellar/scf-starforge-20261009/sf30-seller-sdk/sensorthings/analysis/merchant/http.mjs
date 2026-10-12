// SPDX-License-Identifier: MIT
// Additive reads and static operator surface mounted behind the original listener.
import {readFile} from 'node:fs/promises';
import {readBrowserAssets} from '../../../../distribution/browser-assets.mjs';
import {json,fault,plain} from '../../contract.mjs';
const HASH='[a-f0-9]{64}',ID='[A-Za-z0-9_-]{8,100}';
function send(res,value){const raw=json(value);if(raw.length>24*1024*1024)throw fault('MERCHANT_RESPONSE','Use the exact record or file read for this complete result.',413);
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':raw.length,'Cache-Control':'no-store'});res.end(raw);}
function selection(url){const values=url.searchParams.getAll('selection');
  if(values.length!==1||values[0].length>8192)throw fault('MERCHANT_SELECTION','Use one bounded original selection.',400);
  let v;try{v=JSON.parse(values[0]);}catch{throw fault('MERCHANT_SELECTION','Use complete original selection JSON.',400);}
  if(!plain(v))throw fault('MERCHANT_SELECTION','Select an original object.',400);return v;}
export function createMerchantHttp({workspace}){
  const merchant=workspace.analysis?.merchant;
  if(!merchant)throw fault('MERCHANT_INSTALL','Install the complete coupled merchant source.',409);
  let staticAssets=null;
  async function staticHandler(req,res,{url}){
    if(!url.pathname.startsWith('/analysis/merchant/'))return false;
    if(req.method!=='GET'&&req.method!=='HEAD')return false;
    if(!staticAssets)staticAssets=(async()=>{
      const map=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url)),items=new Map();
      for(const [path,item]of map)items.set(path,{type:item.type,raw:await readFile(item.url)});
      return items;
    })();
    const item=(await staticAssets).get(url.pathname);if(!item)return false;
    res.writeHead(200,{'Content-Type':item.type,'Content-Length':item.raw.length,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"});
    if(req.method==='HEAD')res.end();else res.end(item.raw);return true;
  }
  async function handleApi(req,res,{url}){
    if(url.pathname!=='/api/analysis/merchant'&&!url.pathname.startsWith('/api/analysis/merchant/'))return false;
    if(req.method!=='GET')throw fault('MERCHANT_METHOD','Use the original POST /api/action for mutations.',405);
    const path=url.pathname;let m,value;
    if(path==='/api/analysis/merchant')value=merchant.overview();
    else if((m=new RegExp('^/api/analysis/merchant/projects/('+ID+')$').exec(path)))value=merchant.overview(m[1]);
    else if((m=new RegExp('^/api/analysis/merchant/(records|offers)/('+HASH+')$').exec(path)))value=await merchant.inspect(m[2]);
    else if((m=new RegExp('^/api/analysis/merchant/services/('+HASH+')$').exec(path)))value=merchant.service(m[1]);
    else if(path==='/api/analysis/merchant/operations')value=merchant.operations();
    else if((m=new RegExp('^/api/analysis/merchant/operations/('+ID+')$').exec(path)))value=await merchant.operation(m[1]);
    else if((m=new RegExp('^/api/analysis/merchant/history/('+HASH+')$').exec(path)))value=merchant.history(m[1]);
    else if(path==='/api/analysis/merchant/preview')value=await merchant.preview(selection(url));
    else if(path==='/api/analysis/merchant/inputs')value=await merchant.input(selection(url));
    else if(path==='/api/analysis/merchant/operations-cases')value=await merchant.cases();
    else if((m=/^\/api\/analysis\/merchant\/operations-cases\/(operation-[a-f0-9]{32})$/.exec(path)))value=await merchant.case(m[1]);
    else throw fault('MERCHANT_ROUTE','Select a declared original delivery read.',404);
    send(res,value);return true;
  }
  return {staticHandler,handleApi};
}
