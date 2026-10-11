// MIT. Finite live process telemetry over real SSE and NDJSON HTTP responses.
// Development backend for the original seller; no payment implementation.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const integer=(value,fallback,min,max,name)=>{
  const n=value===undefined || value===null ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n<min || n>max) throw new TypeError('Invalid '+name);
  return n;
};

export async function startStreamingBackend({port=8425}={}) {
  integer(port,8425,0,65535,'port');
  const totals={requests:0,active:0,samples:0,completed:0,cancelled:0};
  const server=createServer(async(req,res)=>{
    const controller=new AbortController();
    const abort=()=>controller.abort();
    req.once('aborted',abort);res.once('close',abort);
    let active=false,complete=false;
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if (req.method==='GET' && url.pathname==='/health') {
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(totals));return;
      }
      const sse=req.method==='GET' && url.pathname==='/v1/metrics/events';
      const ndjson=req.method==='POST' && url.pathname==='/v1/metrics/records';
      if (!sse && !ndjson) {res.writeHead(404);res.end();return;}
      let options=Object.fromEntries(url.searchParams);
      if (ndjson) {
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>4096)throw new TypeError('Request too large');chunks.push(chunk);}
        options=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      if (!options || typeof options!=='object' || Array.isArray(options) ||
          Object.keys(options).some(key=>!['count','intervalMs'].includes(key))) throw new TypeError('Invalid telemetry selection');
      const count=integer(options.count,8,1,1000,'count');
      const intervalMs=integer(options.intervalMs,250,1,5000,'intervalMs');
      if (count*intervalMs>55000)throw new TypeError('Select at most 55 seconds of telemetry');
      totals.requests++;totals.active++;active=true;
      res.writeHead(200,{'content-type':sse?'text/event-stream; charset=utf-8':'application/x-ndjson; charset=utf-8',
        'cache-control':'no-store','x-content-type-options':'nosniff'});
      res.flushHeaders();
      const write=async chunk=>{
        controller.signal.throwIfAborted();
        if (!res.write(chunk))await once(res,'drain',{signal:controller.signal});
      };
      for (let sequence=1;sequence<=count;sequence++) {
        if(sequence>1)await delay(intervalMs,undefined,{signal:controller.signal});
        const memory=process.memoryUsage();
        const sample={type:'sample',sequence,observedAt:new Date().toISOString(),
          uptimeSeconds:Math.round(process.uptime()*1000)/1000,
          residentBytes:memory.rss,heapUsedBytes:memory.heapUsed};
        await write(sse?`id: ${sequence}\nevent: telemetry\ndata: ${JSON.stringify(sample)}\n\n`:JSON.stringify(sample)+'\n');
        totals.samples++;
      }
      const summary={type:'complete',samples:count};
      await write(sse?`event: complete\ndata: ${JSON.stringify(summary)}\n\n`:JSON.stringify(summary)+'\n');
      complete=true;totals.completed++;res.end();
    } catch(error) {
      if (!res.headersSent) {res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'INVALID_TELEMETRY_REQUEST'}));}
      else res.destroy();
    } finally {
      if(active){totals.active--;if(!complete)totals.cancelled++;}
      req.removeListener('aborted',abort);res.removeListener('close',abort);
    }
  });
  server.listen(port,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  let closing;
  const close=()=>closing??=(async()=>{server.closeIdleConnections();await new Promise((ok,bad)=>server.close(e=>e?bad(e):ok()));})();
  return {server,url,snapshot:()=>({...totals}),close};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length && !(args.length===2 && args[0]==='--port'))throw new TypeError('Usage: node streaming-backend.mjs [--port 8425]');
  const backend=await startStreamingBackend({port:args.length?integer(args[1],8425,0,65535,'port'):8425});
  process.stdout.write(JSON.stringify({backend:backend.url,events:backend.url+'/v1/metrics/events',
    records:backend.url+'/v1/metrics/records',health:backend.url+'/health'})+'\n');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>backend.close().catch(()=>{process.exitCode=1;}));
}
