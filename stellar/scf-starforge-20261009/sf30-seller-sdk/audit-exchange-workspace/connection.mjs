import { AuditExchangeClient, AuditExchangeError } from "./client.mjs";
export function privateAuditUrl(value) {
  const url = new URL(value);
  if (url.protocol!=="http:" || url.hostname!=="127.0.0.1" || url.pathname!=="/" ||
      url.username || url.password || url.search || url.hash || !url.port) throw new Error("Choose the original loopback Audit Exchange address.");
  return url.href;
}
export class PinnedAuditConnection {
  constructor({url,workspaceId,instanceId,timeoutMs=120000}) {
    if (typeof workspaceId!=="string" || !workspaceId || typeof instanceId!=="string" || !instanceId) throw new Error("Bind the original workspace and running instance identities.");
    this.url=privateAuditUrl(url);this.workspaceId=workspaceId;this.instanceId=instanceId;
    this.controllers=new Set();this.closed=false;this.timeoutMs=timeoutMs;
    this.client=new AuditExchangeClient({baseUrl:this.url,workspaceId,fetch:async(url,options={})=>{
      if(this.closed) throw new Error("The borrowed workspace connection is closed.");
      const controller=new AbortController();this.controllers.add(controller);
      const timeout=setTimeout(()=>controller.abort(new Error("The original workspace request timed out.")),this.timeoutMs);
      try{
        const headers=new Headers(options.headers??{});
        const pathname=new URL(url).pathname;
        if(pathname==="/api/action"||pathname.startsWith("/api/download/"))headers.set("X-Audit-Instance-Id",this.instanceId);
        const response=await fetch(url,{...options,headers,signal:controller.signal});
        const body=await response.arrayBuffer();
        return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
      }
      finally{clearTimeout(timeout);this.controllers.delete(controller);}
    }});
  }
  async identity() {
    const value=await this.client.identity();
    if(value.url!==this.url || value.workspaceId!==this.workspaceId) throw new AuditExchangeError("The selected application address belongs to another original workspace.",{code:"AUDIT_WORKSPACE_CHANGED",status:409});
    return value;
  }
  async attached() {
    const value=await this.identity();
    if(value.instanceId!==this.instanceId) throw new AuditExchangeError("The original workspace has restarted. Inspect its current identity and explicitly attach that instance.",{code:"AUDIT_INSTANCE_CHANGED",status:409,details:value});
    return value;
  }
  async reconnect(expectedInstanceId) {
    const value=await this.identity();
    if(value.instanceId!==expectedInstanceId) throw new Error("The selected running instance changed.");
    this.instanceId=expectedInstanceId;return value;
  }
  async action(action,inputs,{requestId,expectedVersion}={}) {
    await this.attached();
    const mutation=requestId!==undefined;
    const body=mutation?{action,inputs,requestId,expectedVersion}:{action,inputs};
    const value=await this.client.http("api/action",{method:"POST",body,mutation});
    if(value.state) this.client.acceptState(value.state);
    return value;
  }
  close() { this.closed=true;for(const controller of this.controllers)controller.abort();this.controllers.clear(); }
}
