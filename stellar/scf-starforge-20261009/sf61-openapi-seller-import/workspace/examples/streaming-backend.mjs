#!/usr/bin/env node
// MIT. Local finite backend matching streaming-openapi.json.
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function startExampleBackend({port=9041}={}) {
  const server=createServer(async(req,res)=>{
    const controller=new AbortController();
    res.once('close',()=>controller.abort());
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/records') {
        const topic=url.searchParams.get('topic');
        if(!topic) {res.writeHead(400);res.end('topic is required');return;}
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        for(let sequence=1;sequence<=5;sequence++) {
          res.write(JSON.stringify({sequence,topic})+'\n');
          await delay(150,undefined,{signal:controller.signal});
        }
        res.end();return;
      }
      if(req.method==='POST'&&url.pathname==='/answer') {
        let size=0;const parts=[];
        for await(const part of req) {
          size+=part.length;if(size>16384) {res.writeHead(413);res.end();return;}parts.push(part);
        }
        const body=JSON.parse(Buffer.concat(parts));
        if(typeof body.question!=='string'||!body.question.trim()||body.question.length>4000||
          Object.keys(body).some(key=>key!=='question')) {res.writeHead(400);res.end('question is required');return;}
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store'});
        const words=('Demonstration response for: '+body.question).split(' ');
        for(const [index,word] of words.entries()) {
          res.write('id: '+(index+1)+'\nevent: answer\ndata: '+JSON.stringify({text:word+(index<words.length-1?' ':'')})+'\n\n');
          await delay(150,undefined,{signal:controller.signal});
        }
        res.end();return;
      }
      res.writeHead(404);res.end();
    } catch(error) {
      if(!res.headersSent) {res.writeHead(400);res.end('Invalid request');}
      else if(!res.destroyed) res.destroy(error);
    }
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  return {url:'http://127.0.0.1:'+server.address().port,
    close:()=>new Promise((yes,no)=>{server.close(error=>error?no(error):yes());server.closeAllConnections?.();})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const service=await startExampleBackend();
  process.stdout.write('Example backend: '+service.url+'\n');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void service.close());
}
