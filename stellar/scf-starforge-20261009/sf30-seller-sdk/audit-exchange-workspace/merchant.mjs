import {tools as nativeTools,validateValue,nativeEnvelope} from "./catalog.mjs";
import {auditWorkspaceTools,AUDIT_MERCHANT_REQUEST_BYTES} from "./merchant-tools.mjs";
import {readAuditHostInput,auditHostError} from "./merchant-client.mjs";
import {PinnedAuditConnection} from "./connection.mjs";
export {auditWorkspaceTools} from "./merchant-tools.mjs";
export {readAuditWorkspaceConfiguration} from "./merchant-client.mjs";
const definitions=new Map(auditWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(x=>[x.name,x]));
const operations=new Map(nativeTools.map(x=>["merchant_"+x.name,x]));
export class MerchantAuditWorkspaces{
  constructor(config){this.config=config.auditWorkspaces??null;this.clients=new Map();this.tasks=new Set();this.closed=false;}
  get summary(){return {configured:Boolean(this.config),workspaces:Object.keys(this.config?.workspaces??{}),activeCalls:this.tasks.size,closed:this.closed};}
  entry(name){if(this.closed)throw auditHostError("This borrowed audit provider is closed.",409,"AUDIT_PROVIDER_CLOSED");const entry=this.config?.workspaces?.[name];if(!entry)throw auditHostError("Choose a configured original audit workspace.",404,"AUDIT_WORKSPACE_UNKNOWN");return entry;}
  client(name){const entry=this.entry(name);if(!this.clients.has(name))this.clients.set(name,new PinnedAuditConnection(entry));return this.clients.get(name);}
  async execute(name,args){
    if(name==="merchant_audit_workspaces")return {...this.summary,workspaces:Object.entries(this.config?.workspaces??{}).map(([workspace,entry])=>({workspace,label:entry.label,workspaceId:entry.workspaceId,inputs:Object.entries(entry.inputs).map(([alias,value])=>({alias,name:value.name,sha256:value.sha256,bytes:value.bytes,mime:value.mime,sourceReference:value.sourceReference}))}))};
    const entry=this.entry(args.workspace),client=this.client(args.workspace);
    if(name==="merchant_audit_connection")return client.identity();
    if(name==="merchant_audit_reconnect")return client.reconnect(args.expectedInstanceId);
    if(name==="merchant_audit_input"){
      const found=await readAuditHostInput(entry,args.input,args.expectedSha256);
      const {path,lexicalPath,...metadata}=found.input;return {workspace:args.workspace,input:args.input,...metadata};
    }
    if(name==="merchant_audit_import_file"){
      const {input,bytes}=await readAuditHostInput(entry,args.input,args.expectedSha256);
      const inputs={name:input.name,contentBase64:bytes.toString("base64"),actor:args.actor,note:args.note};
      if(args.kind==="source"){inputs.selectedSchema=args.selectedSchema??"2.7.0";inputs.profileIds=args.profileIds??[];inputs.originUri=input.sourceReference;}
      return client.action(args.kind==="source"?"source.import":"workspace.receive",inputs,args);
    }
    if(name==="merchant_audit_analyse_file"){
      const {input,bytes}=await readAuditHostInput(entry,args.weatherInput,args.expectedWeatherSha256);
      const {workspace,weatherInput,expectedWeatherSha256,requestId,expectedVersion,weatherCsvBase64,weatherName,weatherSource,...inputs}=args;
      return client.action("analysis.run",{...inputs,weatherCsvBase64:bytes.toString("base64"),weatherName:input.name,weatherSource:input.sourceReference},{requestId,expectedVersion});
    }
    const tool=operations.get(name);if(!tool)throw auditHostError("Choose an original native audit action.");
    const {workspace,...inputs}=args,envelope=nativeEnvelope(tool,inputs);
    return client.action(envelope.action,envelope.inputs,envelope);
  }
  call(name,args={}){
    const definition=definitions.get(name);if(!definition)throw auditHostError("Choose a declared audit tool.");
    if(this.closed)throw auditHostError("The borrowed audit provider is closed.",409);
    validateValue(args,{type:"object",properties:definition.properties,required:definition.required,additionalProperties:false});
    if(Buffer.byteLength(JSON.stringify(args))>AUDIT_MERCHANT_REQUEST_BYTES)throw auditHostError("Use a host-pinned original input alias for this complete file.",413);
    const task=Promise.resolve().then(()=>this.execute(name,structuredClone(args)));this.tasks.add(task);
    task.finally(()=>this.tasks.delete(task)).catch(()=>{});return task;
  }
  async close(){this.closed=true;for(const client of this.clients.values())client.close();await Promise.allSettled([...this.tasks]);this.clients.clear();}
}
