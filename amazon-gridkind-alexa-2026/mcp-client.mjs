import {openSync,readFileSync,closeSync,fstatSync,fsyncSync,writeFileSync,linkSync,unlinkSync,mkdirSync,constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const VERSION='2025-11-25',MAX=32*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function requireValue(ok,message){if(!ok)throw Error(message);}
function bytes(path,limit=MAX){
  const fd=openSync(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const st=fstatSync(fd);requireValue(st.isFile()&&st.size<=limit,'Choose a bounded regular input file.');const value=readFileSync(fd);requireValue(value.length===st.size,'Input changed while it was read.');return value;}
  finally{closeSync(fd);}
}
function json(path,limit){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(path,limit)));}
function syncDirectory(path){const fd=openSync(path,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}}
function save(path,value){
  const output=resolve(path),parent=dirname(output),data=Buffer.isBuffer(value)?value:Buffer.from(value);
  mkdirSync(parent,{recursive:true,mode:0o700});
  try{
    const present=bytes(output);
    requireValue(present.equals(data),'The output path already contains different complete bytes. Preserve it and choose another explicit output path.');
    const fd=openSync(output,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(parent);
  }catch(error){
    if(error.code!=='ENOENT')throw error;
    const temp=join(parent,'.gridkind-'+randomUUID()+'.tmp'),fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{writeFileSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}
    try{linkSync(temp,output);syncDirectory(parent);}finally{unlinkSync(temp);syncDirectory(parent);}
  }
  const retained=bytes(output);requireValue(retained.equals(data),'Output readback did not match the returned bytes.');
  return {path:output,bytes:data.length,sha256:sha(data)};
}
/** One ordinary client invocation of the existing MCP endpoint. Never retries a write. */
export async function runClient(options){
  const config=json(options.connection,64*1024),settings=config?.mcpServers?.gridkind;
  requireValue(settings?.type==='http'&&typeof settings.url==='string','Use the original GridKind_Assistant connection JSON.');
  const url=new URL(settings.url);
  requireValue(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/mcp'&&!url.search&&!url.hash&&!url.username&&!url.password,'Use the original local /mcp endpoint with no query or user information.');
  const authorization=settings.headers?.Authorization;
  requireValue(typeof authorization==='string'&&/^Bearer [a-f0-9]{64}$/.test(authorization),'The connection file is missing its private token.');
  let request;
  if(options.catalog)request={method:'tools/list',params:{}};
  else if(options.recover)request={method:'tools/call',params:{name:'gridkind_request_status',arguments:{requestId:options.recover}}};
  else{
    const call=json(options.request,8*1024*1024);
    requireValue(call&&typeof call.name==='string'&&call.arguments&&typeof call.arguments==='object'&&!Array.isArray(call.arguments)&&Object.keys(call).every(key=>['name','arguments'].includes(key)),'Request JSON must contain the exact tool name and arguments.');
    request={method:'tools/call',params:call};
  }
  const requestSha256=sha(Buffer.from(JSON.stringify(request))),rpcId=requestSha256.slice(0,32);
  let session=null;
  async function send(message,{initial=false,notification=false}={}){
    const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
      headers:{Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session,'MCP-Protocol-Version':VERSION}:{})},
      body:JSON.stringify(message)});
    const chunks=[];let length=0;
    if(response.body)for await(const chunk of response.body){length+=chunk.length;requireValue(length<=MAX,'The complete response exceeds the client output limit.');chunks.push(chunk);}
    requireValue(response.ok,'The MCP server returned HTTP '+response.status+'. Keep the original UUID and request file; do not replace an uncertain write.');
    if(notification){requireValue(response.status===202&&length===0,'The initialization notification was not accepted.');return null;}
    requireValue(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''),'This server did not return its supported JSON response.');
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length)));
    requireValue(result.jsonrpc==='2.0'&&result.id===message.id,'The MCP response has another request identity.');
    requireValue(!result.error,'The MCP server rejected the original request: '+String(result.error?.message||''));
    if(initial){
      requireValue(result.result?.protocolVersion===VERSION&&result.result?.capabilities?.tools,'The server did not negotiate the expected MCP tool contract.');
      session=response.headers.get('mcp-session-id');requireValue(typeof session==='string'&&/^[a-f0-9-]{36}$/.test(session),'The original server did not return a session.');
    }
    return result.result;
  }
  try{
    await send({jsonrpc:'2.0',id:'initialize',method:'initialize',params:{protocolVersion:VERSION,capabilities:{},clientInfo:{name:'gridkind-file-client',version:'1.0.0'}}},{initial:true});
    await send({jsonrpc:'2.0',method:'notifications/initialized'},{notification:true});
    const result=await send({jsonrpc:'2.0',id:rpcId,...request});
    const output={schema:'gridkind-mcp-result/v1',endpoint:url.href,requestSha256,request,result};
    const retained=save(options.out,JSON.stringify(output,null,2)+'\n');
    let artifact=null;
    if(options.artifactOut){
      requireValue(!result.isError&&request.params?.name==='gridkind_export','An artifact output requires a successful original gridkind_export call.');
      const data=result.structuredContent;
      requireValue(data&&typeof data.text==='string'&&Number.isSafeInteger(data.bytes),'The export did not contain a complete original artifact.');
      const original=Buffer.from(data.text,'utf8');requireValue(original.length===data.bytes&&sha(original)===data.sha256,'The artifact length or SHA differs from its original export.');
      artifact={...save(options.artifactOut,original),filename:data.filename,mimeType:data.mimeType};
    }
    return {output:retained,...(artifact?{artifact}:{}),isError:result.isError===true};
  }finally{
    if(session)try{await fetch(url,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:authorization,'Mcp-Session-Id':session,'MCP-Protocol-Version':VERSION}});}catch{}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={};
    for(let index=0;index<args.length;index++){
      const flag=args[index];
      if(flag==='--catalog'){options.catalog=true;continue;}
      const key={'--connection':'connection','--request':'request','--recover':'recover','--out':'out','--artifact-out':'artifactOut'}[flag];
      requireValue(key&&args[index+1]&&!args[index+1].startsWith('--')&&!options[key],'Usage: node mcp-client.mjs --connection PRIVATE.json (--catalog | --request EXACT.json | --recover UUID) --out RESULT.json [--artifact-out FILE]');
      options[key]=args[++index];
    }
    requireValue(options.connection&&options.out&&[options.catalog,options.request,options.recover].filter(Boolean).length===1,'Choose one catalog, exact request or original UUID recovery, plus connection and output paths.');
    const result=await runClient(options);process.stdout.write(JSON.stringify(result)+'\n');if(result.isError)process.exitCode=2;
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
