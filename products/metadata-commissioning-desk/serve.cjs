#!/usr/bin/env node
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const allowed=new Map([['/','index.html'],['/index.html','index.html'],['/style.css','style.css'],['/sha256.js','sha256.js'],['/model.js','model.js'],['/app.js','app.js']]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const port=Number(process.argv[2]||8486);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a local port from 1024 through 65535.');
http.createServer((req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
 const file=allowed.get(new URL(req.url,'http://localhost').pathname);
 if(!file){res.writeHead(404);res.end('Not found');return;}
 try{const body=fs.readFileSync(path.join(__dirname,file));res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(500);res.end('Unable to open local source');}
}).listen(port,'127.0.0.1',()=>process.stdout.write('Metadata desk: http://127.0.0.1:'+port+'\n'));
