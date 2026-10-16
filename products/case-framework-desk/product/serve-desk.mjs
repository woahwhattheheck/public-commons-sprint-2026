#!/usr/bin/env node
// MIT. Loopback static serving only; packages and working state stay in the browser.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const entries=new Map([
 ['/',['desk.html','text/html; charset=utf-8']],
 ['/desk.html',['desk.html','text/html; charset=utf-8']],
 ...['desk.mjs','case-source.mjs','source-json.mjs','case-report.mjs','programme.mjs','programme-host.mjs','programme-app.mjs','programme-boot.mjs','programme-build.mjs'].map(n=>['/'+n,[n,'text/javascript; charset=utf-8']]),
 ['/desk.css',['desk.css','text/css; charset=utf-8']],
 ...['framework-v1.json','framework-v2.json'].map(n=>['/examples/'+n,['../examples/'+n,'application/json; charset=utf-8']])
]);
const bodies=new Map();
for(const[url,[file,type]]of entries){
 const p=path.resolve(here,file),stat=await fs.lstat(p);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Select complete regular source file '+file);
 const body=await fs.readFile(p);bodies.set(url,{body,type,sha256:createHash('sha256').update(body).digest('hex')});
}
export async function serveCaseDesk({port=0}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Choose a valid loopback port.');
 const server=http.createServer((req,res)=>{
  const host=req.headers.host??'';
  if(!/^127\.0\.0\.1:\d+$/.test(host)){res.writeHead(403);res.end('Use the printed loopback address.');return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  let url;try{url=new URL(req.url,'http://'+host);}catch{res.writeHead(400);res.end();return;}
  const file=bodies.get(url.pathname);
  if(!file){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('No such selected source resource.');return;}
  res.writeHead(200,{'Content-Type':file.type,'Content-Length':file.body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
  res.end(req.method==='HEAD'?undefined:file.body);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 return {url:'http://127.0.0.1:'+server.address().port,resources:[...bodies].map(([url,v])=>({url,bytes:v.body.length,sha256:v.sha256})),close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>4||process.argv[2]&&process.argv[2]!=='--port')throw Error('Use node product/serve-desk.mjs [--port 8765].');
 const desk=await serveCaseDesk({port:process.argv[3]?Number(process.argv[3]):8765});
 process.stdout.write(JSON.stringify({schema:'commons.case-source-desk-server.v1',...desk,close:undefined})+'\n');
 let closing=false;const stop=async()=>{if(closing)return;closing=true;try{await desk.close();}catch(e){process.stderr.write(e.stack+'\n');process.exitCode=1;}};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
