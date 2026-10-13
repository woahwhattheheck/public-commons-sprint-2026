/* Original editor transport through the current authenticated operator. */
"use strict";
(() => {
  const prefix="/api/file/conservation-design/";
  const segments=location.pathname.slice(prefix.length).split("/");
  if(!location.pathname.startsWith(prefix)||segments[1]!=="editor")throw Error("Open this editor through its original Workspace.");
  const workspace=decodeURIComponent(segments[0]);
  const initialProject=new URL(location.href).searchParams.get("project");
  if(!initialProject||!/^[A-Za-z0-9_-]+$/.test(initialProject))throw Error("Choose the original prepared editor project.");
  const pending=new Map();
  const request=(kind,value={})=>new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    pending.set(id,{resolve,reject});
    const message={channel:"upstate-original-design-editor/v1",kind,id,workspace,...value};
    const transfer=value.raw instanceof ArrayBuffer?[value.raw]:[];
    parent.postMessage(message,location.origin,transfer);
  });
  addEventListener("message",event=>{
    if(event.source!==parent||event.origin!==location.origin)return;
    const message=event.data;
    if(message?.channel!=="upstate-original-design-editor/v1"||message.workspace!==workspace)return;
    if(message.kind==="flush"){
      Promise.resolve(window.ecoDesignIntegration?.flush()).then(
        ()=>parent.postMessage({...message,kind:"flushed"},location.origin),
        error=>parent.postMessage({...message,kind:"flushed",error:error.message},location.origin));
      return;
    }
    const item=pending.get(message.id);if(!item)return;pending.delete(message.id);
    if(message.error){const error=new Error(message.error.message||"Original editor request failed.");error.status=message.error.status||400;item.reject(error);}
    else item.resolve(message);
  });
  window.fetch=async(path,options={})=>{
    const url=new URL(path,location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith("/api/"))throw Error("Use the original editor endpoints.");
    let raw=null,data=null;
    if(options.body!==undefined){
      if(typeof options.body==="string")data=JSON.parse(options.body);
      else if(options.body instanceof ArrayBuffer)raw=options.body;
      else if(ArrayBuffer.isView(options.body))raw=options.body.buffer.slice(options.body.byteOffset,options.body.byteOffset+options.body.byteLength);
      else if(options.body instanceof Blob)raw=await options.body.arrayBuffer();
      else throw Error("Supply the complete original editor request.");
    }
    const snapshot=window.ecoDesignIntegration?.snapshot();
    const result=await request("request",{path:url.pathname+url.search,
      method:options.method||"GET",data,raw,expected_revision:snapshot?.revision??null});
    const body=result.raw instanceof ArrayBuffer?result.raw:JSON.stringify(result.value);
    return new Response(body,{status:result.status||200,headers:{"Content-Type":result.mime_type||"application/json"}});
  };
  window.ecoDesignTransport={workspace,recoveryKey:(project=initialProject)=>"eco-design-recovery/"+workspace+"/"+project,ready:async()=>{
    const result=await request("ready");
    if(result.value?.project&&!window.ecoDesignIntegration.snapshot().project_id)
      await window.ecoDesignIntegration.openProject(result.value);
  }};
})();
