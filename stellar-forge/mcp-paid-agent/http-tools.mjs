/** MIT. Original SF32 authenticated single-response MCP HTTP transport. */
import { timingSafeEqual } from 'node:crypto';
import { explainFailure } from '../../stellar/scf-starforge-20261009/sf33-failure-contract/contract.mjs';
export const MCP_VERSION='2025-11-25';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

const jsonErr=(code,message,id=null)=>({jsonrpc:'2.0',id,error:{code,message}});
const rpcReply=(id,result)=>({jsonrpc:'2.0',id,result});
const safeCompare=(a,b)=>{
  const A=Buffer.from(String(a??'')),B=Buffer.from(String(b??''));
  return A.length===B.length&&timingSafeEqual(A,B);
};
/**
 * The transport is meant for an operator-controlled 127.0.0.1 listener.
 * It offers JSON-only responses, no SSE stream, tasks, roots or server push.
 */
export function createMcpToolHandler(provider,{bearerToken,authorization,allowedClientOrigins=[],maximumRequestBytes=128*1024,
  serverName='stellar-bazaar-paid-bridge',serverVersion='0.1.0',
  instructions='Search, describe and preview are read-only. Describe a search handle to inspect declared inputs before preview. Calls need out-of-band operator approval and an external x402 signer.'}={}){
  if(!provider || typeof provider.call!=='function' || !Array.isArray(provider.tools) || !provider.tools.length)
    throw new TypeError('A fixed tool catalog and call function are required');
  if(!Number.isSafeInteger(maximumRequestBytes)||maximumRequestBytes<1024||maximumRequestBytes>8*1024*1024)
    throw new TypeError('Choose a bounded MCP request body limit from 1 KiB to 8 MiB');
  const tools=structuredClone(provider.tools),names=new Set();
  for(const tool of tools){
    if(!plain(tool)||!/^[-A-Za-z0-9_.]{1,128}$/.test(tool.name)||names.has(tool.name)||!plain(tool.inputSchema))
      throw new TypeError('Tool names must be unique with an object input schema');
    names.add(tool.name);
  }
  if(typeof serverName!=='string'||!serverName||typeof serverVersion!=='string'||!serverVersion||typeof instructions!=='string')
    throw new TypeError('Server identity and instructions must be strings');
  const oauth=authorization!==undefined;
  if(oauth){
    if(bearerToken!==undefined || !authorization ||
        ['authenticate','authorizeTool','respondError'].some(name=>typeof authorization[name]!=='function'))
      throw new TypeError('Select one OAuth resource authorizer or fixed operator bearer token');
  }else if(typeof bearerToken!=='string'||bearerToken.length<24)throw new TypeError('Strong operator access token required');
  const allowedOrigins=new Set(allowedClientOrigins);
  return async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    const origin=req.headers.origin;
    if(origin&&!allowedOrigins.has(origin))return send(403,jsonErr(-32000,'Origin not allowed'));
    let context;
    if(oauth){
      try{context=await authorization.authenticate(req);}
      catch(error){return authorization.respondError(error,res);}
    }else if(!safeCompare(req.headers.authorization,`Bearer ${bearerToken}`))return send(401,jsonErr(-32001,'Unauthorized'));
    if(req.method==='GET')return send(405,jsonErr(-32601,'SSE stream not supported'));
    if(req.method!=='POST')return send(405,jsonErr(-32601,'POST required'));
    if(!String(req.headers['content-type']??'').toLowerCase().startsWith('application/json'))return send(415,jsonErr(-32600,'Content type must be application/json'));
    const accept=String(req.headers.accept??'');
    if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return send(406,jsonErr(-32600,'Accept must include application/json and text/event-stream'));
    // HTTP stream chunks are byte boundaries, not UTF-8 character boundaries.
    // The host may select a larger bounded envelope for its declared native document intake.
    const chunks=[];let byteCount=0;
    try {
      for await(const c of req){
        byteCount+=c.byteLength;
        if(byteCount>maximumRequestBytes)throw new Error('Too large');
        chunks.push(c);
      }
    }catch{return send(413,jsonErr(-32700,'Invalid or oversized body'));}
    let raw;
    try{raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,byteCount));}
    catch{return send(400,jsonErr(-32700,'Invalid UTF-8 body'));}
    let rpc;try{rpc=JSON.parse(raw);}catch{return send(400,jsonErr(-32700,'Parse error'));}
    const id=rpc?.id??null;
    if(!plain(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||Array.isArray(rpc))return send(400,jsonErr(-32600,'Invalid JSON-RPC request',id));
    // Determine the complete current scope set once, before the original dispatch.
    // Only the verified immutable context reaches an embedding provider; never its token.
    if(oauth){
      const tool=rpc.method==='tools/call'&&names.has(rpc.params?.name)?rpc.params.name:null;
      const args=rpc.method==='tools/call'&&plain(rpc.params?.arguments??{})?(rpc.params?.arguments??{}):{};
      try{await authorization.authorizeTool(context,tool,args);}
      catch(error){return authorization.respondError(error,res,{id});}
    }
    if(rpc.method==='notifications/initialized'){
      res.writeHead(202);res.end();return;
    }
    if(rpc.method!=='initialize'&&req.headers['mcp-protocol-version']!==MCP_VERSION)return send(400,jsonErr(-32602,'Unsupported or missing MCP-Protocol-Version',id));
    if(id===null && rpc.method!=='notifications/initialized')return send(400,jsonErr(-32600,'Request ID required'));
    if(rpc.method==='initialize')return send(200,rpcReply(id,{protocolVersion:MCP_VERSION,
      capabilities:{tools:{listChanged:false}},serverInfo:{name:serverName,version:serverVersion},instructions}));
    if(rpc.method==='ping')return send(200,rpcReply(id,{}));
    if(rpc.method==='tools/list')return send(200,rpcReply(id,{tools}));
    if(rpc.method!=='tools/call')return send(200,jsonErr(-32601,'Method not found',id));
    const name=rpc.params?.name,args=rpc.params?.arguments??{};
    if(typeof name!=='string'||!plain(args))return send(200,jsonErr(-32602,'Invalid tool arguments',id));
    try{
      if(!names.has(name))throw Object.assign(new Error('Unknown tool '+name),{code:'TOOL_NOT_FOUND'});
      const data=await provider.call(name,args,oauth?{authorization:context}:undefined);
      return send(200,rpcReply(id,{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false}));
    }catch(e){
      // SF-33 hints are additive; preserve existing MCP wire fields and never
      // treat an agent-visible hint as authority to sign or retry a payment.
      const recoveryCode=e.code==='RESOURCE_STALE'||e.code==='CHALLENGE_MISMATCH'
        ? 'discovery_stale_terms' : e.code==='TOOL_NOT_FOUND'
          ? 'mcp_tool_missing' : 'unknown_upstream_error';
      const recovery=explainFailure({stage:name==='bazaar_search'?'discovery':'mcp',reason:recoveryCode});
      const err={code:e.code??'TOOL_ERROR',reason:e.message??'Error',recovery};
      return send(200,rpcReply(id,{content:[{type:'text',text:JSON.stringify(err)}],structuredContent:err,isError:true}));
    }
  };
}

