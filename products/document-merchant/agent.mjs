// MIT. Borrow the existing Document controller; never open another customer or store.
import {createMcpToolHandler} from '../../stellar-forge/mcp-paid-agent/http-tools.mjs';
import {documentError} from './contracts.mjs';
import {DOCUMENT_AGENT_PATH,DOCUMENT_AGENT_SCHEMA,DOCUMENT_AGENT_REQUEST_BYTES,DOCUMENT_AGENT_TOOLS,
  DOCUMENT_AGENT_INSTRUCTIONS} from './agent-schema.mjs';
export {DOCUMENT_AGENT_PATH,DOCUMENT_AGENT_SCHEMA,DOCUMENT_AGENT_REQUEST_BYTES,DOCUMENT_AGENT_TOOLS,
  DOCUMENT_AGENT_INSTRUCTIONS} from './agent-schema.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(value,message){if(!value)throw documentError('DOCUMENT_AGENT_ARGUMENT_INVALID',message);}
function validate(value,schema,path='arguments'){
  if(schema.type==='object'){
    need(plain(value),path+' must be an object.');
    for(const key of schema.required??[])need(Object.hasOwn(value,key),path+'.'+key+' is required.');
    for(const [key,item]of Object.entries(value)){
      const next=schema.properties?.[key];
      if(next)validate(item,next,path+'.'+key);
      else if(schema.additionalProperties===false)need(false,path+'.'+key+' is not supported.');
      else if(plain(schema.additionalProperties))validate(item,schema.additionalProperties,path+'.'+key);
    }
  }else if(schema.type==='array'){
    need(Array.isArray(value),path+' must be an array.');
    need(schema.minItems===undefined||value.length>=schema.minItems,path+' needs selected items.');
    for(const item of value)validate(item,schema.items,path+'[]');
  }else if(schema.type==='string'){
    need(typeof value==='string'&&(schema.minLength===undefined||value.length>=schema.minLength)&&
      (schema.maxLength===undefined||value.length<=schema.maxLength),path+' requires a complete string.');
    need(!schema.pattern||new RegExp(schema.pattern).test(value),path+' has an invalid format.');
  }else if(schema.type==='integer'){
    need(Number.isSafeInteger(value)&&(schema.minimum===undefined||value>=schema.minimum)&&
      (schema.maximum===undefined||value<=schema.maximum),path+' requires a valid whole number.');
  }
  need(!schema.enum||schema.enum.includes(value),path+' is not a supported choice.');
}
function inputs(name,args){
  const selected=DOCUMENT_AGENT_TOOLS.find(tool=>tool.name===name);
  need(selected,'Choose a tool in the fixed Document catalog.');validate(args,selected.inputSchema);
  if(name.endsWith('_restore'))need(Boolean(args.source)!==Boolean(args.sourceFile),
    'Supply one complete source upload or an original allowed source file.');
  if(name.endsWith('_execute')){
    const {approvedPlanSha256,...rest}=args;return {...rest,planSha256:approvedPlanSha256};
  }
  return args;
}
const actions={
  documents_stage:'stage',documents_restore:'restore',documents_correct:'correct',
  documents_quote:'prepare',documents_execute:'run',documents_receive:'receive',documents_export:'export',
  document_assembly_stage:'assembly-stage',document_assembly_quote:'assembly-prepare',
  document_assembly_execute:'assembly-run',document_assembly_receive:'assembly-receive',document_assembly_export:'assembly-export'
};
const bundleActions={
  pdf_bundle_stage:'stage',pdf_bundle_restore:'restore',pdf_bundle_materialize:'materialize',
  pdf_bundle_quote:'prepare',pdf_bundle_execute:'run',pdf_bundle_receive:'receive',pdf_bundle_export:'export'
};
function accepted(operation){return {schema:DOCUMENT_AGENT_SCHEMA,accepted:true,operation,
  continuation:'Poll this original operation. After reconnect, read the saved source and receive its existing jobs.'};}
/** The host supplies its already authenticated request signal and original download registrar. */
export function createDocumentAgent(controller,{example}={}){
  need(controller&&typeof controller.start==='function'&&typeof controller.download==='function'&&
    typeof controller.bundles?.start==='function','Use the original Document customer controller.');
  return {tools:DOCUMENT_AGENT_TOOLS,
    async call(name,args={},context={}){
      const input=inputs(name,args),signal=context.signal;signal?.throwIfAborted();
      if(Object.hasOwn(actions,name))return accepted(controller.start(actions[name],input));
      if(Object.hasOwn(bundleActions,name))return accepted(controller.bundles.start(bundleActions[name],input));
      if(name==='documents_status')return {...controller.status(),agent:{schema:DOCUMENT_AGENT_SCHEMA,path:DOCUMENT_AGENT_PATH},
        compositions:await controller.list(input)};
      if(name==='pdf_bundles_status')return {...controller.bundles.status(),assemblies:await controller.bundles.list(input)};
      if(name==='documents_example'){
        need(typeof example==='function','The original installed example reader is required.');
        const defaults=controller.status().defaults;
        return example(input.kind??'orders',input.provider??defaults.provider,{merchantOrigin:defaults.merchantOrigin});
      }
      if(name==='documents_get')return controller.get({...input,signal});
      if(name==='document_assembly_get')return controller.assembly({...input,signal});
      if(name==='pdf_bundle_get')return controller.bundles.get({...input,signal});
      if(name==='documents_correction_draft')return controller.correctionDraft({...input,signal});
      if(name==='documents_operation')return controller.operation(input);
      if(name==='pdf_bundle_operation')return controller.bundles.operation(input);
      if(name==='documents_cancel')return controller.cancel(input);
      if(name==='pdf_bundle_cancel')return controller.bundles.cancel(input);
      if(name==='documents_download'||name==='pdf_bundle_download'){
        need(typeof context.registerDownload==='function','Use the original authenticated file receiving route.');
        const owner=name==='documents_download'?controller:controller.bundles;
        const ticket=await context.registerDownload(downloadSignal=>owner.download(input,{signal:downloadSignal}));
        return {schema:DOCUMENT_AGENT_SCHEMA,...ticket,method:'GET',singleUse:true,expiresInMs:60000,
          receiving:'Fetch the complete file immediately; verify bytes and SHA256. Request another ticket for this same selection if transfer fails.'};
      }
      need(false,'Unknown Document tool.');
    }
  };
}
/**
 * Install only behind startJobCustomerWorkspace's original bearer/Host/Origin admission.
 * It consumes the original HTTP request and writes one JSON response. Background
 * operations remain owned by the controller, not the individual HTTP lifetime.
 */
export function documentAgentAuthenticatedRoute(controller,{example}={}){
  const agent=createDocumentAgent(controller,{example});
  return async context=>{
    if(context.url.pathname!==DOCUMENT_AGENT_PATH)return false;
    const handler=createMcpToolHandler({
      tools:agent.tools,call:(name,args)=>agent.call(name,args,context)
    },{
      // The outer customer host already authenticated this same request.
      authorization:{authenticate:async()=>({}),authorizeTool:async()=>{},
        respondError:(error,response)=>{response.writeHead(401,{'content-type':'application/json'});
          response.end(JSON.stringify({error:{code:error.code??'DOCUMENT_AGENT_UNAUTHORIZED'}}));}},
      allowedClientOrigins:[context.url.origin],serverName:'stellar-forge-document-customer',
      serverVersion:'1.0.0',maxRequestBytes:DOCUMENT_AGENT_REQUEST_BYTES,
      instructions:DOCUMENT_AGENT_INSTRUCTIONS,
      toolErrorView:error=>({message:error.message??'Document operation failed.',
        ...(Number.isInteger(error.status)?{status:error.status}:{})})
    });
    await handler(context.request,context.response);return true;
  };
}
