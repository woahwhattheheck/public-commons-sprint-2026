// MIT. Standard newline-delimited MCP stdio over the installed local client.
import { createHash } from 'node:crypto';
import { createEurostatClient } from './client.mjs';
const str={type:'string'},integer={type:'integer'},obj={type:'object'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const id=schema({id:hash},['id']);
const defs=[
 ['eurostat_status','Read the same original project, sources, acquisitions and publisher state.',schema(),true,c=>c.status()],
 ['eurostat_briefing','Read the complete economic briefing and exact monthly comparisons for a retained source query.',schema({id:hash,query:str},['id']),true,(c,a)=>c.briefing(a.id,a.query)],
 ['eurostat_source','Inspect all retained captures and reviewed source queries.',schema(),true,c=>c.source()],
 ['eurostat_capture','Read one original capture and its full publisher dimension metadata.',id,true,(c,a)=>c.capture(a.id)],
 ['eurostat_cells','Read a paged source selection with original value and status states.',schema({id:hash,options:obj},['id']),true,(c,a)=>c.cells(a.id,a.options)],
 ['eurostat_compare','Compare full coordinates between original editions; follow next offsets.',schema({before:hash,after:hash,options:obj},['before','after']),true,(c,a)=>c.compare(a.before,a.after,a.options)],
 ['eurostat_original_response','Read complete original UTF-8 response bytes with SHA256 and base64.',id,true,async(c,a)=>{
   const b=Buffer.from(await c.originalResponse(a.id));return {bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),base64:b.toString('base64')};}],
 ['eurostat_acquire','Perform one official GET under the supplied original operation ID; explicit continuation follows asynchronous responses.',schema({request:obj},['request']),false,(c,a)=>c.acquire(a.request)],
 ['eurostat_acquisition','Read all retained attempts for one original acquisition.',schema({id:str},['id']),true,(c,a)=>c.acquisition(a.id)],
 ['eurostat_import','Retain a complete original JSON response and actual retrieval metadata.',schema({capture:obj},['capture']),false,(c,a)=>c.importCapture(a.capture)],
 ['eurostat_save_query','Save exact selected dimensions and reuse review against the displayed source hash.',schema({selection:obj},['selection']),false,(c,a)=>c.saveQuery(a.selection)],
 ['eurostat_plan_template','Prepare a full lossless native dataset plan for a reviewed query.',schema({query:str,title:str,name:str},['query']),true,(c,a)=>c.planTemplate(a)],
 ['eurostat_save_plan','Save the reviewed plan in the original publisher.',schema({plan:obj},['plan']),false,(c,a)=>c.savePlan(a.plan)],
 ['eurostat_extract','Start the original saved plan extraction; read its returned run UUID.',schema({plan:integer},['plan']),false,(c,a)=>c.extract(a.plan)],
 ['eurostat_inspect','Inspect the original retained extraction and preview its native query.',schema({id:str,query:str},['id']),true,(c,a)=>c.inspect(a.id,a.query)],
 ['eurostat_cancel','Cancel the original active extraction.',schema({id:str},['id']),false,(c,a)=>c.cancel(a.id)],
 ['eurostat_review','Record publication review of the exact candidate and current original target.',schema({id:str,review:obj},['id','review']),false,(c,a)=>c.review(a.id,a.review)],
 ['eurostat_publish','Publish using the original candidate review ID and version store.',schema({id:str,reviewId:str},['id','reviewId']),false,(c,a)=>c.publish(a.id,a.reviewId)],
 ['eurostat_recover','Reconcile the existing publication from original version-store state.',schema({id:str},['id']),false,(c,a)=>c.recover(a.id)],
 ['eurostat_buyer_offer','Read the running merchant actual offer for a retained snapshot.',schema({id:str,query:str},['id']),true,(c,a)=>c.buyerOffer(a.id,a.query)],
 ['eurostat_prepare_buyer','Prepare the original SF88 buyer configuration using actual reviewed terms.',schema({id:str,buyer:obj},['id','buyer']),false,(c,a)=>c.prepareBuyer(a.id,a.buyer)],
 ['eurostat_export_sources','Export complete original source bytes and saved query reviews.',schema(),true,c=>c.exportSources()],
 ['eurostat_import_sources','Receive the complete source handover and keep identical existing selections.',schema({handover:obj},['handover']),false,(c,a)=>c.importSources(a.handover)],
 ['eurostat_prepare_release','Retain the published candidate, complete source and seller binding in an original SF82 package.',schema({release:obj},['release']),false,(c,a)=>c.prepareRelease(a.release)],
 ['eurostat_stage_release','Stage the exact original source package and configured native merchant runtime.',schema({release:obj},['release']),false,(c,a)=>c.stageRelease(a.release)],
 ['eurostat_activate_release','Activate the selected original release through its maintained generation controls.',schema({release:obj},['release']),false,(c,a)=>c.activateRelease(a.release)]
];
export const eurostatMcpTools=Object.freeze(defs.map(([name,description,inputSchema,readOnlyHint])=>({name,description,inputSchema,
  annotations:{readOnlyHint,destructiveHint:false,idempotentHint:readOnlyHint,openWorldHint:name==='eurostat_acquire'}})));
const handlers=new Map(defs.map(v=>[v[0],v]));
function validate(value,s){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Tool arguments must be an object.');
  for(const name of s.required??[])if(!Object.hasOwn(value,name))throw Error('Missing '+name+'.');
  for(const [name,v]of Object.entries(value)){
    const p=s.properties[name];if(!p)throw Error('Unknown argument '+name+'.');
    if(p.type==='string'&&(typeof v!=='string'||p.pattern&&!new RegExp(p.pattern).test(v))||
      p.type==='integer'&&!Number.isSafeInteger(v)||p.type==='object'&&(!v||typeof v!=='object'||Array.isArray(v)))throw Error('Invalid '+name+'.');
  }
}
export async function runEurostatMcp({origin,input=process.stdin,output=process.stdout}={}){
  createEurostatClient({origin});
  const pending=new Map();let initialized=false,ready=false,writeTail=Promise.resolve();
  const send=value=>{writeTail=writeTail.then(async()=>{if(!output.write(JSON.stringify(value)+'\n'))await new Promise(resolve=>output.once('drain',resolve));});return writeTail;};
  const error=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
  async function receive(message){
    if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string'||Array.isArray(message))return error(null,-32600,'Invalid JSON-RPC request.');
    const isRequest=Object.hasOwn(message,'id'),id=message.id;
    if(isRequest&&!(typeof id==='string'||Number.isSafeInteger(id)))return error(null,-32600,'Request ID must be a string or integer.');
    if(!isRequest){
      if(message.method==='notifications/initialized'&&initialized)ready=true;
      if(message.method==='notifications/cancelled')pending.get(message.params?.requestId)?.controller.abort();
      return;
    }
    if(pending.has(id))return error(id,-32600,'Request ID is already active.');
    if(message.method==='initialize'){
      if(initialized)return error(id,-32600,'This connection is already initialized.');
      initialized=true;
      return send({jsonrpc:'2.0',id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},
        serverInfo:{name:'stellar-forge-eurostat',version:'1.0.0'},
        instructions:'Use the same open local Eurostat project. Retained source and native publication IDs remain authoritative across calls.'}});
    }
    if(message.method==='ping')return send({jsonrpc:'2.0',id,result:{}});
    if(!ready)return error(id,-32002,'Initialize this connection first.');
    if(message.method==='tools/list')return send({jsonrpc:'2.0',id,result:{tools:eurostatMcpTools}});
    if(message.method!=='tools/call')return error(id,-32601,'Method not found.');
    const tool=handlers.get(message.params?.name);if(!tool)return error(id,-32602,'Unknown Eurostat tool.');
    const args=message.params?.arguments??{};
    try{validate(args,tool[2]);}catch(e){return error(id,-32602,e.message);}
    const controller=new AbortController(),entry={controller,promise:null};pending.set(id,entry);
    entry.promise=(async()=>{
      try{
        const value=await tool[4](createEurostatClient({origin,signal:controller.signal}),args);
        const structuredContent=value&&typeof value==='object'&&!Array.isArray(value)?value:{result:value};
        await send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent}});
      }catch(e){await send({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:JSON.stringify({error:e.code??'EUROSTAT_REQUEST_FAILED',message:e.message})}]}});}
      finally{pending.delete(id);}
    })();
    return entry.promise;
  }
  let remainder='';const decoder=new TextDecoder('utf-8',{fatal:true});
  const dispatch=line=>{let message;try{message=JSON.parse(line);}catch{void error(null,-32700,'Invalid JSON.');return;}
    void receive(message).catch(e=>error(Object.hasOwn(message??{},'id')?message.id:null,-32603,e.message));};
  for await(const chunk of input){
    remainder+=decoder.decode(chunk,{stream:true});
    if(remainder.length>48*1024*1024)throw Error('MCP message exceeds 48 MiB.');
    let at;while((at=remainder.indexOf('\n'))>=0){const line=remainder.slice(0,at);remainder=remainder.slice(at+1);if(line.trim())dispatch(line);}
  }
  remainder+=decoder.decode();if(remainder.trim())dispatch(remainder);
  await Promise.allSettled([...pending.values()].map(v=>v.promise));await writeTail;
}
