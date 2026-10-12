// MIT. Analysis reads behind the original SensorThings listener authentication.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {json,identity,fault} from '../contract.mjs';
import {exactJSON} from './sta.mjs';
const HASH='[a-f0-9]{64}',ID='[A-Za-z0-9_-]{8,100}',MAX_RESPONSE=24*1024*1024;
function send(res,value,{exact=false}={}){
  const bytes=exact?Buffer.from(exactJSON(value)):json(value);
  if(bytes.length>MAX_RESPONSE)throw fault('ANALYSIS_PAGE','Use the original row page or file download for this complete result.',413);
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);
}
function integer(url,key,fallback,maximum){
  const values=url.searchParams.getAll(key);if(values.length>1)throw fault('ANALYSIS_PARAMETER','Use one '+key+'.');
  const s=values[0];if(s===undefined)return fallback;
  if(!/^(?:0|[1-9]\d*)$/.test(s)||!Number.isSafeInteger(Number(s))||Number(s)>maximum)throw fault('ANALYSIS_PARAMETER','Use a bounded nonnegative '+key+'.');return Number(s);
}
export function createAnalysisHttp({workspace}){
  const analysis=workspace.analysis;if(!analysis)throw fault('ANALYSIS_INSTALL','Install the coupled original analysis/core/server modules.',409);
  const uiRoot=fileURLToPath(new URL('./ui/',import.meta.url));
  async function staticHandler(req,res,{url}){
    const assets={'/analysis/':'index.html','/analysis/index.html':'index.html','/analysis/app.mjs':'app.mjs','/analysis/style.css':'style.css'};
    const file=assets[url.pathname];if(!file)return false;
    const bytes=await readFile(join(uiRoot,file)),type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/css; charset=utf-8';
    res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"});
    if(req.method==='HEAD')res.end();else res.end(bytes);return true;
  }
  async function handleApi(req,res,{url}){
    if(!url.pathname.startsWith('/api/analysis'))return false;
    // Mutations remain POST /api/action and the existing stable operation IDs.
    if(req.method!=='GET')throw fault('ANALYSIS_METHOD','Use the original action endpoint for analysis changes.',405);
    let m,value;
    if(url.pathname==='/api/analysis')value=analysis.overview();
    else if(url.pathname==='/api/analysis/inbox')value=await analysis.inbox();
    else if((m=new RegExp('^/api/analysis/python-sources/('+ID+')$').exec(url.pathname)))value=await analysis.pythonSource(m[1]);
    else if((m=new RegExp('^/api/analysis/projects/('+ID+')$').exec(url.pathname)))value=await analysis.project(m[1]);
    else if((m=new RegExp('^/api/analysis/editions/('+HASH+')/streams$').exec(url.pathname)))value=await analysis.streams(m[1]);
    else if((m=new RegExp('^/api/analysis/versions/('+HASH+')(?:/(summary|rows))?$').exec(url.pathname))){
      value=m[2]==='rows'?await analysis.rows(m[1],{offset:integer(url,'offset',0,Number.MAX_SAFE_INTEGER),limit:integer(url,'limit',100,500)}):
        m[2]==='summary'?await analysis.summary(m[1]):await analysis.version(m[1]);
    }else if((m=new RegExp('^/api/analysis/comparisons/('+HASH+')$').exec(url.pathname)))value=await analysis.comparison(m[1]);
    else if((m=new RegExp('^/api/analysis/publications/('+ID+')$').exec(url.pathname)))value=await analysis.publication(m[1]);
    else if((m=new RegExp('^/api/analysis/sta/('+HASH+')/(map|numeric)(?:/(.*))?$').exec(url.pathname))){
      const root=url.origin+'/api/analysis/sta/'+m[1]+'/'+m[2]+'/',path=m[3]??'';
      value=await analysis.sta(m[1],m[2],{root,path,searchParams:url.searchParams});
      send(res,value,{exact:true});return true;
    }else if(url.pathname.startsWith('/api/analysis/viewers/'))return false; // deployment owner
    else throw fault('ANALYSIS_ROUTE','Choose a declared retained analysis read.',404);
    send(res,value);return true;
  }
  return {staticHandler,handleApi,close:async()=>{}};
}
