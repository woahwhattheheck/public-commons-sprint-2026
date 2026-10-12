#!/usr/bin/env node
// MIT. Maintained MCP stdio transport over the original running QuestDB browser.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startMcpStdio } from '../../../../../stellar-forge/mcp-paid-agent/stdio.mjs';
import { MCP_VERSION } from '../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs';
import { createQuestDbWorkbenchClient } from './client.mjs';
import { QUESTDB_TOOLS,callQuestDbTool } from './tools.mjs';
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const docs='QuestDB tools operate the same running browser workspace. Save a source revision, discover native tables, compile a report with typed probe values, then preview or capture it with a stable captureId. Read original capture status after a lost response. Capture files are available in complete SHA-pinned ranges and through receive_capture. Dataset publication uses the original source/plan/extract/review/publish and schedule actions. Customer requests keep the exact snapshot, payment choice and intent ID.';
export async function startQuestDbMcp({url,connectionFile,environment=process.env,input=process.stdin,output=process.stdout}={}){
  const client=await createQuestDbWorkbenchClient({url,connectionFile,environment});
  await client.state();
  return startMcpStdio({environment,input,output,maxConcurrent:16,cancelRequest:async()=>{},
    diagnostic:code=>process.stderr.write('QuestDB MCP: '+code+'\n'),
    startWorkspace:async({environment:transport})=>{
      const expected=Buffer.from('Bearer '+transport.MCP_ACCESS_TOKEN),pending=new Set();let origin,closing=false;
      const server=createServer((req,res)=>{
        const send=(status,value)=>{const body=value===null?Buffer.alloc(0):Buffer.from(JSON.stringify(value));res.writeHead(status,{'content-type':'application/json','content-length':body.length,'cache-control':'no-store'});res.end(body);};
        let responseId=null;
        const work=(async()=>{
          if(closing){send(503,{error:'Closing'});return;}
          const supplied=Buffer.from(req.headers.authorization??'');
          if(req.method!=='POST'||req.url!=='/mcp'||req.headers.host!==new URL(origin).host||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){send(403,{error:'Original private transport required'});return;}
          let size=0;const chunks=[];
          for await(const chunk of req){size+=chunk.length;if(size>1048576){send(413,{error:'Request exceeds 1 MiB'});return;}chunks.push(chunk);}
          let rpc;try{rpc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
          if(!plain(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'){send(400,{jsonrpc:'2.0',id:rpc?.id??null,error:{code:-32600,message:'Invalid JSON-RPC request'}});return;}
          responseId=rpc.id??null;
          if(!Object.hasOwn(rpc,'id')){send(202,null);return;}
          let result;
          if(rpc.method==='initialize')result={protocolVersion:MCP_VERSION,serverInfo:{name:'questdb-report-workbench',version:'1.0.0'},capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false}},instructions:docs};
          else if(rpc.method==='ping')result={};
          else if(rpc.method==='tools/list')result={tools:QUESTDB_TOOLS};
          else if(rpc.method==='tools/call'){
            try{const value=await callQuestDbTool(client,rpc.params?.name,rpc.params?.arguments??{});result={content:[{type:'text',text:JSON.stringify(value)}],structuredContent:plain(value)?value:{result:value}};}
            catch(error){result={isError:true,content:[{type:'text',text:JSON.stringify({code:error.code??'QUESTDB_OPERATION_FAILED',message:error.message})}]};}
          }else if(rpc.method==='resources/list')result={resources:[{uri:'questdb://workspace/status',name:'Current QuestDB workbench',mimeType:'application/json'},{uri:'questdb://workspace/guide',name:'QuestDB workflow',mimeType:'text/plain'}]};
          else if(rpc.method==='resources/templates/list')result={resourceTemplates:[
            {uriTemplate:'questdb://captures/{captureId}',name:'Original native capture',mimeType:'application/json'},
            {uriTemplate:'questdb://publications/{publicationId}',name:'Original dataset publication',mimeType:'application/json'},
            {uriTemplate:'questdb://revisions/{revision}',name:'Original source revision',mimeType:'application/json'}]};
          else if(rpc.method==='resources/read'){
            const uri=rpc.params?.uri;let value,type='application/json';
            if(uri==='questdb://workspace/status')value=await client.state();
            else if(uri==='questdb://workspace/guide'){value=docs;type='text/plain';}
            else if(/^questdb:\/\/captures\/[a-z][a-z0-9-]{0,100}$/.test(uri??''))value=await client.captureRecord(uri.split('/').at(-1));
            else if(/^questdb:\/\/publications\/[a-z][a-z0-9-]{0,100}$/.test(uri??''))value=await client.publication(uri.split('/').at(-1));
            else if(/^questdb:\/\/revisions\/[1-9][0-9]*$/.test(uri??''))value=await client.revision(Number(uri.split('/').at(-1)));
            else{send(200,{jsonrpc:'2.0',id:rpc.id,error:{code:-32602,message:'Unknown original QuestDB resource'}});return;}
            result={contents:[{uri,mimeType:type,text:type==='text/plain'?value:JSON.stringify(value)}]};
          }else{send(200,{jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Method not found'}});return;}
          send(200,{jsonrpc:'2.0',id:rpc.id,result});
        })().catch(error=>{if(!res.headersSent)send(500,{jsonrpc:'2.0',id:responseId,error:{code:-32603,message:error.code??'QUESTDB_MCP_REQUEST_FAILED'}});else res.destroy();});
        pending.add(work);work.finally(()=>pending.delete(work)).catch(()=>{});
      });
      server.requestTimeout=330000;server.headersTimeout=10000;
      await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
      origin='http://127.0.0.1:'+server.address().port;let stop;
      return{address:origin+'/mcp',maxRequestBytes:1048576,durable:true,close:()=>stop??=(async()=>{
        closing=true;const stopped=new Promise((done,fail)=>server.close(error=>error?fail(error):done()));server.closeIdleConnections();
        await Promise.allSettled([...pending]);await stopped;
      })()};
    }});
}
export async function main(args=process.argv.slice(2)){
  if(args.includes('--help')){process.stderr.write('questdb-mcp [--connection PRIVATE_LAUNCH.json]\nUse QUESTDB_WORKSPACE_URL or the original private launch file. stdout carries MCP messages.\n');return;}
  if(args.length&&(args.length!==2||args[0]!=='--connection'||!args[1]))throw new TypeError('Use --connection PRIVATE_LAUNCH.json or QUESTDB_WORKSPACE_URL.');
  const session=await startQuestDbMcp({connectionFile:args[1]});
  const close=()=>{void session.close('HOST_SIGNAL');};process.once('SIGINT',close);process.once('SIGTERM',close);
  try{return await session.closed;}finally{process.off('SIGINT',close);process.off('SIGTERM',close);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write('QuestDB MCP startup: '+(error.code??error.message)+'\n');process.exitCode=1;});
