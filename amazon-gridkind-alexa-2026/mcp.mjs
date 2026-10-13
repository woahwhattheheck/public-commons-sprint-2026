import {randomUUID,createHash} from 'node:crypto';
export const PROTOCOL='2025-11-25';
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'};
const text={type:'string'},obj={type:'object'},integer={type:'integer'};
const context={type:'object',properties:{householdId:uuid,generation:uuid,revision:{type:'integer',minimum:0}},required:['householdId','generation','revision'],additionalProperties:false};
const scenario={type:'object',description:'Original GridKind daily scenario: prices is exactly24 hypothetical USD/kWh numbers; maxKw is the shared circuit cap; tasks contains1–5 original {id,label,kw,hours,earliest,deadline,quiet} loads.'};
const week={type:'object',description:'Original weekly input {name,startDate:YYYY-MM-DD,days:[{enabled:boolean,scenario} x7]}. All prices are hypothetical.'};
function spec(name,description,properties,required,write=false){
  return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
    annotations:{readOnlyHint:!write,destructiveHint:false,idempotentHint:true,openWorldHint:false}};
}
const mutation={requestId:uuid,context};
export const TOOLS=[
  spec('gridkind_state','Read the connected household, current exact proposal and browser approval, saved history summary and current mutation context.',{},[]),
  spec('gridkind_history','Page the original connected household history, including all preserved weekly review records.',{offset:{...integer,minimum:0},limit:{...integer,minimum:1,maximum:100}},[]),
  spec('gridkind_record','Read one original immutable household record including its complete inputs/results.',{recordId:uuid},['recordId']),
  spec('gridkind_request_status','Read the exact committed original operation by UUID. not_found is only an observation; safely retry the SAME request UUID/body. Imported outcomes remain historical.',{requestId:uuid},['requestId']),
  spec('gridkind_propose','Save an original daily proposal. This clears prior approval. A human must review and approve the exact new plan in the original browser.',{...mutation,input:scenario,label:text},['requestId','context','input'],true),
  spec('gridkind_cancel','Clear the current active daily proposal and approval through the original writer.',mutation,['requestId','context'],true),
  spec('gridkind_simulate','Run only the exact plan already approved by a human in the original browser. This is a simulation, with zero live device/service calls. Never represents actual consumption or savings.',{...mutation,planId:text},['requestId','context','planId'],true),
  spec('gridkind_save_scenario','Save hypothetical household inputs through the original writer. Changed inputs clear active approval.',{...mutation,input:scenario,name:text},['requestId','context','input','name'],true),
  spec('gridkind_compare_tariffs','Retain a comparison for the exact current proposal using the original tariff-analysis engine.',{...mutation,proposalId:text,alternatives:{type:'array'},label:text},['requestId','context','proposalId','alternatives'],true),
  spec('gridkind_plan_week','Save a complete original seven-day plan. No day is automatically approved or dispatched.',{...mutation,input:week},['requestId','context','input'],true),
  spec('gridkind_adopt_day','Open a successfully planned day from an exact saved week in the original daily workspace. Requires a fresh daily proposal and human approval.',{...mutation,recordId:uuid,dayIndex:{...integer,minimum:0,maximum:6}},['requestId','context','recordId','dayIndex'],true),
  spec('gridkind_review_request','Create an original offline weekly review request from one saved week. Use gridkind_export to obtain the complete reviewer HTML or request JSON.',{...mutation,baseRecordId:uuid,recipient:text,message:text},['requestId','context','baseRecordId','recipient','message'],true),
  spec('gridkind_review_preview','Compare a returned response against its exact original request and selected current week. Read the whole-day conflicts before applying deliberate choices.',{context,requestRecordId:uuid,targetRecordId:uuid,response:obj},['context','requestRecordId','targetRecordId','response']),
  spec('gridkind_review_apply','Apply explicit original whole-day review choices and save the returned review plus new ordinary week in one original transaction.',{...mutation,requestRecordId:uuid,targetRecordId:uuid,response:obj,choices:obj},['requestId','context','requestRecordId','targetRecordId','response','choices'],true),
  spec('gridkind_export','Return a complete original downloadable artifact with text, MIME type, filename and exact SHA256/byte length. Household backup includes full history and assistant operation receipts but no access tokens or active grants.',{format:{type:'string',enum:['household','week_csv','week_calendar','review_request','offline_review']},recordId:uuid},['format']),
];
function invalid(message,code=-32602){throw Object.assign(new Error(message),{rpcCode:code});}
function checkSchema(value,schema,path='arguments'){
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))invalid(path+' must be an object.');
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))invalid(path+'.'+key+' is required.');
    if(schema.additionalProperties===false)for(const key of Object.keys(value))if(!Object.hasOwn(schema.properties||{},key))invalid('Unknown '+path+'.'+key+'.');
    for(const [key,child]of Object.entries(schema.properties||{}))if(Object.hasOwn(value,key))checkSchema(value[key],child,path+'.'+key);
  }else if(schema.type==='array'){if(!Array.isArray(value))invalid(path+' must be an array.');}
  else if(schema.type==='string'){
    if(typeof value!=='string'||value.length>100000)invalid(path+' must be bounded text.');
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))invalid(path+' has an invalid identity.');
  }else if(schema.type==='integer'){
    if(!Number.isSafeInteger(value))invalid(path+' must be a safe integer.');
    if(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)invalid(path+' is out of range.');
  }
  if(schema.enum&&!schema.enum.includes(value))invalid(path+' has an unsupported value.');
}
const clone=value=>structuredClone(value);
function contextFrom(state){return {householdId:state.workspace.selectedId,generation:state.workspace.generation,revision:state.workspace.revision};}
function toolResult(value,isError=false){
  return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,...(isError?{isError:true}:{})};
}
/** MCP transport only: all domain operations call the original household writer. */
export function createHouseholdMCP({access,state,history,record,dispatch,exportArtifact,checkpoint}){
  const sessions=new Map();
  function selected(grant){
    const view=state(grant.owner);
    if(view.workspace.selectedId!==grant.householdId)throw Object.assign(new Error('Open the linked household in the original browser before using this assistant. No other household was selected or changed.'),{status:409});
    return view;
  }
  function call(grant,name,args){
    const definition=TOOLS.find(tool=>tool.name===name);
    if(!definition)invalid('Unknown GridKind tool.');
    checkSchema(args,definition.inputSchema);
    if(name==='gridkind_history')return {history:history(grant,args)};
    if(name==='gridkind_record')return {record:record(grant,args.recordId)};
    if(name==='gridkind_request_status')return access.read(grant.owner,grant.householdId,args.requestId);
    if(name==='gridkind_export')return exportArtifact(grant,args);
    if(name==='gridkind_state'){const current=selected(grant);return {state:current,context:contextFrom(current),connection:{id:grant.id,name:grant.name,householdId:grant.householdId},simulationOnly:true};}
    if(name==='gridkind_review_preview'){selected(grant);return dispatch(grant,name,args);}
    const request={name,arguments:clone(args)};
    const restore=checkpoint(grant.owner);let transactionCompleted=false;
    try{
      const accepted=access.run(grant,args.requestId,request,()=>{
        const current=selected(grant);
        if(args.context.householdId!==grant.householdId)throw Object.assign(new Error('The request context must identify the connection’s linked household.'),{status:409});
        return dispatch(grant,name,args);
      });
      transactionCompleted=true;
      const current=state(grant.owner),linked=current.workspace.selectedId===grant.householdId;
      return {...accepted,context:linked?contextFrom(current):null,currentState:linked?current:null,selectionRequired:!linked,simulationOnly:true};
    }catch(error){
      // Receipt admission can fail after a candidate was committed only within the
      // enclosing SQLite transaction. Discard that rolled-back in-memory candidate.
      if(!transactionCompleted)restore();throw error;
    }
  }
  function send(res,status,value,headers={}){
    res.writeHead(status,{'cache-control':'no-store','x-content-type-options':'nosniff',...(value===undefined?{}:{'content-type':'application/json; charset=utf-8'}),...headers});
    res.end(value===undefined?'':JSON.stringify(value));
  }
  async function handle(req,res,{readBody,origin}){
    let rpcId=null;
    try{
      if(req.headers.origin!==undefined&&req.headers.origin!==origin)return send(res,403,{error:'Origin does not match this local GridKind server.'});
      const authorization=req.headers.authorization;
      const match=typeof authorization==='string'?authorization.match(/^Bearer ([a-f0-9]{64})$/):null;
      const grant=access.authenticate(match?.[1]);
      const now=Date.now();for(const [id,saved]of sessions)if(now-saved.lastUsedAt>60*60*1000)sessions.delete(id);
      const supplied=req.headers['mcp-session-id'];
      if(supplied!==undefined&&(typeof supplied!=='string'||!sessions.has(supplied)))return send(res,404,{error:'MCP session expired; initialize again with the same connection token.'});
      const session=supplied?sessions.get(supplied):null;
      if(session)session.lastUsedAt=now;
      if(session&&session.grantId!==grant.id)return send(res,403,{error:'MCP session belongs to another connection.'});
      if(session&&req.headers['mcp-protocol-version']!==undefined&&req.headers['mcp-protocol-version']!==PROTOCOL)return send(res,400,{error:'Use the negotiated MCP-Protocol-Version '+PROTOCOL+'.'});
      if(req.method==='DELETE'){
        if(!session)return send(res,400,{error:'Choose the original MCP session.'});
        sessions.delete(supplied);return send(res,200);
      }
      if(req.method==='GET')return send(res,405,{error:'This MCP endpoint returns JSON responses and does not open SSE streams.'},{allow:'POST, DELETE'});
      if(req.method!=='POST')return send(res,405,{error:'Use the MCP POST endpoint.'},{allow:'POST, DELETE'});
      const accepts=String(req.headers.accept||'').toLowerCase();
      if(!accepts.includes('application/json')||!accepts.includes('text/event-stream'))return send(res,406,{error:'Accept application/json and text/event-stream.'});
      if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))return send(res,415,{error:'Use application/json.'});
      let message;try{message=await readBody(req,8*1024*1024);}catch(error){return send(res,error.status===413?413:400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid or oversized UTF-8 JSON message.'}});}
      if(!message||typeof message!=='object'||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')invalid('Use one JSON-RPC2.0 request or notification.',-32600);
      const hasId=Object.hasOwn(message,'id');
      if(hasId&&!(typeof message.id==='string'||Number.isSafeInteger(message.id)))invalid('Request id must be a string or safe integer.',-32600);
      rpcId=hasId?message.id:null;
      if(message.method==='initialize'){
        if(!hasId||session)invalid('Initialize a new session with a request id and no existing session header.',-32600);
        if(!message.params||typeof message.params.protocolVersion!=='string'||!message.params.clientInfo||typeof message.params.clientInfo.name!=='string'||typeof message.params.capabilities!=='object')invalid('Initialization needs protocolVersion, capabilities and clientInfo.');
        if(sessions.size>=100)return send(res,503,{error:'Close an unused MCP session before initializing another.'});
        const id=randomUUID();sessions.set(id,{grantId:grant.id,initialized:false,createdAt:now,lastUsedAt:now});
        return send(res,200,{jsonrpc:'2.0',id:rpcId,result:{protocolVersion:PROTOCOL,capabilities:{tools:{listChanged:false}},serverInfo:{name:'gridkind-household',version:'1.0.0'},instructions:'Use saved household inputs and the original planner. Prices are hypothetical. Human approval is available only in the original browser. There are no live device calls. Keep each mutation requestId and exact arguments for status/replay.'}},{'Mcp-Session-Id':id});
      }
      if(!session)return send(res,400,{error:'Initialize first and retain Mcp-Session-Id.'});
      if(req.headers['mcp-protocol-version']!==PROTOCOL)return send(res,400,{error:'Use the negotiated MCP-Protocol-Version '+PROTOCOL+'.'});
      if(!hasId){
        if(message.method==='notifications/initialized')session.initialized=true;
        // No independent job is spawned; admitted writes commit synchronously.
        // Cancellation cannot retract a committed operation or replace its UUID.
        return send(res,202);
      }
      if(message.method==='ping')return send(res,200,{jsonrpc:'2.0',id:rpcId,result:{}});
      if(!session.initialized)invalid('Send notifications/initialized before tool use.',-32000);
      let result;
      if(message.method==='tools/list'){
        if(message.params?.cursor!==undefined)invalid('This catalog is complete; no cursor is available.');
        result={tools:TOOLS};
      }else if(message.method==='tools/call'){
        if(!message.params||typeof message.params.name!=='string')invalid('Choose a tool name.');
        try{result=toolResult(call(grant,message.params.name,message.params.arguments??{}));}
        catch(error){
          if(error.rpcCode)throw error;
          result=toolResult({error:error.message,status:error.status||400,recovery:'Retain the exact request UUID and arguments; use gridkind_request_status or replay that same request. A transport failure is not proof of rejection.'},true);
        }
      }else invalid('Method not found.',-32601);
      return send(res,200,{jsonrpc:'2.0',id:rpcId,result});
    }catch(error){
      if(error.status===401)return send(res,401,{error:error.message},{'www-authenticate':'Bearer realm="GridKind local household"'});
      return send(res,200,{jsonrpc:'2.0',id:rpcId,error:{code:error.rpcCode||-32603,message:error.message||'Original operation failed.'}});
    }
  }
  return {handle,call,close:()=>sessions.clear(),tools:TOOLS};
}
