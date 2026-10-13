import {createInterface} from "node:readline";
import {tools,nativeEnvelope} from "./catalog.mjs";
export {tools} from "./catalog.mjs";
export async function handleRpc(connection,request){
  const fail=(code,message)=>({jsonrpc:"2.0",id:request?.id??null,error:{code,message}});
  if(!request||Array.isArray(request)||request.jsonrpc!=="2.0"||typeof request.method!=="string")return fail(-32600,"Invalid JSON-RPC request");
  if(request.id===undefined)return null;
  const reply=result=>({jsonrpc:"2.0",id:request.id,result});
  if(request.method==="initialize")return reply({protocolVersion:"2025-03-26",capabilities:{tools:{listChanged:false}},serverInfo:{name:"audit-exchange-workspace",version:"0.1.0"}});
  if(request.method==="ping")return reply({});
  if(request.method==="tools/list")return reply({tools:tools.map(({action,mutation,...tool})=>tool)});
  if(request.method!=="tools/call")return fail(-32601,"Method not found");
  const tool=tools.find(x=>x.name===request.params?.name);if(!tool)return fail(-32602,"Unknown Audit Exchange tool");
  try{
    const envelope=nativeEnvelope(tool,request.params?.arguments??{});
    const value=await connection.action(envelope.action,envelope.inputs,envelope);
    return reply({content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value,isError:false});
  }catch(error){
    const value={error:{code:error.code??"AUDIT_NATIVE",message:error.message,details:error.details},
      stateVersion:error.stateVersion,outcomeUnknown:Boolean(error.outcomeUnknown)};
    return reply({content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value,isError:true});
  }
}
export async function serveStdio(connection,{input=process.stdin,output=process.stdout}={}){
  const lines=createInterface({input,crlfDelay:Infinity});
  try{
    for await(const line of lines){
      if(!line.trim())continue;
      let result;try{result=await handleRpc(connection,JSON.parse(line));}
      catch{result={jsonrpc:"2.0",id:null,error:{code:-32700,message:"Invalid JSON"}};}
      if(result)await new Promise((done,reject)=>output.write(JSON.stringify(result)+"\n",error=>error?reject(error):done()));
    }
  }finally{connection.close();}
}
