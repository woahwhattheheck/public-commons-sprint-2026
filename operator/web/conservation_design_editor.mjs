/** Authenticated transport for the unchanged original geometry editor UI. */
const channel="upstate-original-design-editor/v1";
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fingerprint(value){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export class OriginalDesignEditor {
  constructor(host,preparation,close){
    this.host=host;this.workspace=host.getState().workspace_key;
    this.preparation=preparation;this.close=close;this.gone=false;
    this.controller=new AbortController();this.frame=null;this.original=null;this.flushes=new Map();this.deliveries=new Map();
    window.addEventListener("message",event=>void this.message(event),{signal:this.controller.signal});
  }
  current(){
    if(this.gone||this.host.getState()?.workspace_key!==this.workspace)
      throw Object.assign(Error("Reopen this original editor in its selected Workspace."),{status:409});
  }
  async queue(action,payload){
    this.current();
    const key="upstate.design-editor-operation/"+await fingerprint({workspace:this.workspace,action,payload});
    this.current();
    let retained;
    try{retained=JSON.parse(sessionStorage.getItem(key)||"null");}catch{}
    if(!retained){retained={operation_id:"design-editor-"+crypto.randomUUID(),id:null};sessionStorage.setItem(key,JSON.stringify(retained));}
    if(!retained.id){
      let result;
      try{result=await this.host.api("/api/actions",{method:"POST",body:{
        workspace:this.workspace,action,payload,operation_id:retained.operation_id}});}
      catch(error){if([400,401,403,404,405,413,415,422].includes(Number(error.status)))sessionStorage.removeItem(key);throw error;}
      const task=result.task||result;retained.id=task.id;sessionStorage.setItem(key,JSON.stringify(retained));
    }
    let pause=200,resumed=false;
    while(true){
      this.current();
      const task=await this.host.api(this.host.endpoint("/api/task",{id:retained.id,workspace:this.workspace}));
      this.current();
      if(task.state==="complete"){
        this.deliveries.set(task.id,key);return task;
      }
      if(task.state==="interrupted"&&!resumed){
        await this.host.api("/api/task/resume",{method:"POST",body:{id:task.id}});
        resumed=true;continue;
      }
      if(["failed","cancelled","interrupted"].includes(task.state)){
        const error=new Error(task.error?.message||("The original editor operation is "+task.state+". Open task "+task.id+" to resume or inspect it."));
        error.status=task.error?.code==="CONSERVATION_DESIGN_CONFLICT"?409:400;
        error.task_id=task.id;
        if(task.state!=="interrupted")sessionStorage.removeItem(key);
        throw error;
      }
      await wait(pause);pause=Math.min(1500,pause+150);
    }
  }
  acknowledge(task){
    const key=this.deliveries.get(task.id);
    if(key){sessionStorage.removeItem(key);this.deliveries.delete(task.id);}
  }
  async start(){
    const task=await this.queue("conservation.design.editor.open",{preparation_id:this.preparation.id});
    this.current();this.original=task.result.response;
    if(this.original.project.id!==this.preparation.project_id)throw Error("The original editor returned another prepared project.");
    this.original=await this.host.api("/api/conservation-design/editor",{method:"POST",body:{
      workspace:this.workspace,path:"/api/projects/"+this.preparation.project_id}});
    this.current();
    if(this.original.project.id!==this.preparation.project_id)throw Error("The current editor record belongs to another project.");
    this.acknowledge(task);this.render(this.root);
  }
  render(root){
    if(this.gone)return;
    this.root=root;
    if(this.frame?.isConnected)return;
    if(!this.original){
      root.innerHTML='<section class="cd-root"><h1>Geometry editor</h1><p role="status">Opening the original saved project…</p></section>';return;
    }
    root.innerHTML='<section class="cd-root cd-editor"><header><div><h1>Geometry editor</h1><p>'+esc(this.preparation.title)+
      '</p></div><button type="button" data-editor-return>Save and return to Scenario design</button></header>'+
      '<p data-editor-status role="status">The original editor keeps this project and its independent alternatives in this Workspace.</p>'+
      '<iframe data-design-editor title="Original scenario geometry editor"></iframe></section>';
    this.frame=root.querySelector("iframe[data-design-editor]");
    root.querySelector("[data-editor-return]").addEventListener("click",()=>void this.finish().catch(error=>this.fail(error)),
      {signal:this.controller.signal});
    this.frame.src=this.host.endpoint("/api/file/conservation-design/"+encodeURIComponent(this.workspace)+"/editor/index.html",{workspace:this.workspace,project:this.preparation.project_id});
  }
  fail(error){if(this.gone||this.host.getState()?.workspace_key!==this.workspace)return;const element=this.root?.querySelector("[data-editor-status]");if(element){element.textContent=error.message||String(error);element.setAttribute("role","alert");}}
  reply(source,id,result){
    if(this.gone||this.host.getState()?.workspace_key!==this.workspace||source!==this.frame?.contentWindow)return false;
    const data={channel,id,workspace:this.workspace,...result};
    source.postMessage(data,location.origin,data.raw instanceof ArrayBuffer?[data.raw]:[]);
    return true;
  }
  async message(event){
    if(this.gone||event.origin!==location.origin||event.source!==this.frame?.contentWindow)return;
    const request=event.data;
    if(request?.channel!==channel||request.workspace!==this.workspace||typeof request.id!=="string")return;
    if(request.kind==="flushed"){
      const item=this.flushes.get(request.id);if(item){this.flushes.delete(request.id);request.error?item.reject(Error(request.error)):item.resolve();}
      return;
    }
    try{
      this.current();
      if(request.kind==="ready"){
        this.reply(event.source,request.id,{value:this.original});return;
      }
      if(request.kind!=="request")throw Error("Choose an original editor operation.");
      const url=new URL(request.path,location.origin);
      if(url.origin!==location.origin||!url.pathname.startsWith("/api/"))throw Error("Choose an original editor endpoint.");
      const pure=request.method==="GET"&&!/\/(export|geojson)$/.test(url.pathname)||
        ["/api/geometry","/api/validate"].includes(url.pathname);
      let result;
      if(pure){
        const body={workspace:this.workspace,path:request.path,
          ...(request.data!==null?{data:request.data}:{})};
        if(new TextEncoder().encode(JSON.stringify(body)).length<=3*1024*1024){
          result=await this.host.api("/api/conservation-design/editor",{method:"POST",body});
          this.current();this.reply(event.source,request.id,{value:result});return;
        }
      }
      const payload={path:request.path};
      if(request.expected_revision!==null)payload.expected_revision=request.expected_revision;
      if(request.raw instanceof ArrayBuffer||request.data!==null){
        const raw=request.raw instanceof ArrayBuffer?request.raw:JSON.stringify(request.data);
        const file=new File([raw],request.raw instanceof ArrayBuffer?"original-project.zip":"original-editor-request.json",
          {type:request.raw instanceof ArrayBuffer?"application/zip":"application/json"});
        const limit=Math.min(100*1024*1024,Number(this.host.getState()?.limits?.upload_bytes)||100*1024*1024);
        if(file.size>limit)throw Error("The complete original editor request exceeds this operator's upload limit.");
        const uploaded=await this.host.api("/api/upload",{method:"POST",raw:file,filename:file.name,signal:this.controller.signal});
        this.current();
        if(!/^[a-f0-9]{64}$/.test(uploaded?.id||"")||uploaded.bytes!==file.size)throw Error("The original editor upload identity is incomplete.");
        payload.upload_id=uploaded.id;
      }
      const task=await this.queue("conservation.design.editor.write",payload);
      result=task.result.response;
      if(result?.file){
        const download=(task._downloads||[]).find(row=>
          row.sha256===result.file.sha256&&row.bytes===result.file.bytes);
        if(!download?.url)throw Error("The original export has no retained download ticket.");
        const target=new URL(download.url,location.origin);
        if(target.origin!==location.origin||!target.pathname.startsWith("/api/file/"))throw Error("Use the original file ticket.");
        const response=await fetch(target,{credentials:"same-origin",signal:this.controller.signal});
        if(!response.ok)throw Object.assign(Error("Could not download the complete retained editor export."),{status:response.status});
        const raw=await response.arrayBuffer();
        if(raw.byteLength!==result.file.bytes)throw Error("The retained editor export length differs from its original descriptor.");
        const actual=[...new Uint8Array(await crypto.subtle.digest("SHA-256",raw))].map(x=>x.toString(16).padStart(2,"0")).join("");
        if(actual!==result.file.sha256)throw Error("The retained editor export differs from its original hash.");
        this.current();if(this.reply(event.source,request.id,{raw,mime_type:result.mime_type}))this.acknowledge(task);return;
      }
      this.current();if(this.reply(event.source,request.id,{value:result}))this.acknowledge(task);
    }catch(error){this.reply(event.source,request.id,{error:{message:error.message||String(error),status:error.status||400}});}
  }
  async finish(){
    this.current();
    if(this.frame?.contentWindow){
      const id=crypto.randomUUID();
      const ready=new Promise((resolve,reject)=>this.flushes.set(id,{resolve,reject}));
      this.frame.contentWindow.postMessage({channel,kind:"flush",workspace:this.workspace,id},location.origin);
      await ready;
    }
    this.current();this.detach();await this.close();
  }
  detach(){
    this.gone=true;this.controller.abort();
    for(const item of this.flushes.values())item.reject(Error("The original editor view was detached."));
    this.flushes.clear();this.deliveries.clear();this.frame=null;
  }
}
