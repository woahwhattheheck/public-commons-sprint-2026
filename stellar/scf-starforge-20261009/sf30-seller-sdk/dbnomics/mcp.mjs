// MIT. Standard MCP stdio over the same local DBnomics project.
import {createHash} from 'node:crypto';
import {createDbnomicsClient} from './client.mjs';
const str={type:'string'},integer={type:'integer'},obj={type:'object'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const id=schema({id:hash},['id']);
async function file(value){
 const body=await value,bytes=Buffer.from(body.bytes);
 return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
   mediaType:body.mediaType,contentDisposition:body.contentDisposition,contentBase64:bytes.toString('base64')};
}
const defs=[
 ['dbnomics_status','Read the original project, captures, notes, reports and publication state.',schema(),true,c=>c.status()],
 ['dbnomics_source','Read retained source declarations and reviewed query selections.',schema(),true,c=>c.source()],
 ['dbnomics_operation','Reconcile an original operation ID before repeating its exact input.',schema({id:str},['id']),true,(c,a)=>c.operation(a.id)],
 ['dbnomics_discover','Read the current official provider catalog, datasets or series with explicit provider pagination.',schema({request:obj},['request']),true,(c,a)=>c.discover(a.request)],
 ['dbnomics_capture','Read a retained capture with complete provider metadata, terms and original retrieval receipts.',id,true,(c,a)=>c.capture(a.id)],
 ['dbnomics_observations','Read a page of exact retained observations, original periods, numeric tokens and attributes.',schema({id:hash,options:obj},['id']),true,(c,a)=>c.observations(a.id,a.options)],
 ['dbnomics_facets','Count all observations in this exact retained edition by a supported source field.',schema({id:hash,options:obj},['id']),true,(c,a)=>c.facets(a.id,a.options)],
 ['dbnomics_compare','Compare whole retained source editions; follow the returned next change offset.',schema({before:hash,after:hash,options:obj},['before','after']),true,(c,a)=>c.compare(a.before,a.after,a.options)],
 ['dbnomics_analysis_source','Prepare a complete exact economic Analysis document from the selected capture, saved reports and notes revision.',schema({request:obj},['request']),false,(c,a)=>c.analysisSource(a.request)],
 ['dbnomics_analysis_source_file','Receive the complete economic Analysis source handover with original source files and mapped records.',schema({id:str},['id']),true,(c,a)=>file(c.analysisSourceFile(a.id))],
 ['dbnomics_notes','Read current or exact saved notes revision for one retained capture.',schema({id:hash,revision:integer},['id']),true,(c,a)=>c.notes(a.id,a.revision)],
 ['dbnomics_save_notes','Save full edition/observation notes with original operation ID and expected note revision.',schema({edit:obj},['edit']),false,(c,a)=>c.saveNotes(a.edit)],
 ['dbnomics_save_report','Freeze full economic analysis, exact source and an explicit saved notes revision.',schema({report:obj},['report']),false,(c,a)=>c.saveReport(a.report)],
 ['dbnomics_report','Read the saved analysis and a page of its original bound rows.',schema({id:str,options:obj},['id']),true,(c,a)=>c.report(a.id,a.options)],
 ['dbnomics_report_file','Receive a complete saved JSON, CSV or HTML report with original notes and source bindings.',schema({id:str,format:str},['id']),true,(c,a)=>file(c.reportFile(a.id,a.format))],
 ['dbnomics_capture_file','Receive the whole sealed capture, including every original provider response.',id,true,(c,a)=>file(c.captureFile(a.id))],
 ['dbnomics_original_response','Receive one full original provider response as exact bytes with its hash.',schema({id:hash,index:integer},['id']),true,(c,a)=>file(c.originalResponse(a.id,a.index))],
 ['dbnomics_acquire','Acquire the selected exact provider series under one original operation ID.',schema({request:obj},['request']),false,(c,a)=>c.acquire(a.request)],
 ['dbnomics_refresh','Create a new actual source edition and compare it with the retained prior capture.',schema({request:obj},['request']),false,(c,a)=>c.refresh(a.request)],
 ['dbnomics_import_example','Adopt the included real INSEE annual and monthly source responses without a provider call.',schema({id:str},['id']),false,(c,a)=>c.importExample(a.id)],
 ['dbnomics_import','Adopt a complete sealed capture or exact response-import manifest and file bodies.',schema({request:obj},['request']),false,(c,a)=>c.importCapture(a.request)],
 ['dbnomics_save_query','Save a reviewed source selection and optional calculation against the current source hash.',schema({selection:obj},['selection']),false,(c,a)=>c.saveQuery(a.selection)],
 ['dbnomics_plan_template','Prepare all original lossless source columns and native extraction limits for the saved query.',schema({name:str},['name']),true,(c,a)=>c.planTemplate(a.name)],
 ['dbnomics_save_plan','Save the native reviewed plan under an original stable operation ID.',schema({request:obj},['request']),false,(c,a)=>c.savePublicationPlan(a.request)],
 ['dbnomics_extract','Start or reconcile the same original extraction UUID and saved plan integer.',schema({request:obj},['request']),false,(c,a)=>c.extract(a.request)],
 ['dbnomics_inspect','Inspect the original candidate and actual native dataset query.',schema({id:str,query:str},['id']),true,(c,a)=>c.inspect(a.id,a.query)],
 ['dbnomics_cancel','Cancel the selected original active extraction.',schema({id:str},['id']),false,(c,a)=>c.cancel(a.id)],
 ['dbnomics_review','Record review against the exact candidate and current target snapshot/revision.',schema({id:str,review:obj},['id','review']),false,(c,a)=>c.review(a.id,a.review)],
 ['dbnomics_publish','Publish the exact candidate with its original review ID through the version store.',schema({id:str,reviewId:str},['id','reviewId']),false,(c,a)=>c.publish(a.id,a.reviewId)],
 ['dbnomics_recover','Reconcile an uncertain original publication using actual target state.',schema({id:str},['id']),false,(c,a)=>c.recover(a.id)],
 ['dbnomics_buyer_offer','Read the actual running native merchant offer for this retained snapshot.',schema({id:str,query:str},['id']),true,(c,a)=>c.buyerOffer(a.id,a.query)],
 ['dbnomics_prepare_buyer','Prepare the original SF88 buyer configuration with reviewed offer and existing payer terms.',schema({id:str,buyer:obj},['id','buyer']),false,(c,a)=>c.prepareBuyer(a.id,a.buyer)],
 ['dbnomics_export_sources','Receive all captured original bytes, reviewed queries, notes history and frozen reports.',schema(),true,c=>c.exportSources()],
 ['dbnomics_import_sources','Adopt a complete source handover using one original receiving operation ID.',schema({request:obj},['request']),false,(c,a)=>c.importSources(a.request)],
 ['dbnomics_prepare_release','Prepare the original SF82 dataset package with full source files and receiving guide.',schema({release:obj},['release']),false,(c,a)=>c.prepareRelease(a.release)],
 ['dbnomics_stage_release','Stage one exact source package and existing native facilitator configuration.',schema({release:obj},['release']),false,(c,a)=>c.stageRelease(a.release)],
 ['dbnomics_activate_release','Activate the same original SF82 release through its generation controls.',schema({release:obj},['release']),false,(c,a)=>c.activateRelease(a.release)]
];
export const dbnomicsMcpTools=Object.freeze(defs.map(([name,description,inputSchema,readOnlyHint])=>({name,description,inputSchema,
  annotations:{readOnlyHint,destructiveHint:false,idempotentHint:readOnlyHint,openWorldHint:['dbnomics_acquire','dbnomics_refresh','dbnomics_discover'].includes(name)}})));
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
export async function runDbnomicsMcp({origin,input=process.stdin,output=process.stdout}={}){
  createDbnomicsClient({origin});
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
        serverInfo:{name:'stellar-forge-dbnomics',version:'1.0.0'},
        instructions:'Use the same open local DBnomics project. Retained source and native publication IDs remain authoritative across calls.'}});
    }
    if(message.method==='ping')return send({jsonrpc:'2.0',id,result:{}});
    if(!ready)return error(id,-32002,'Initialize this connection first.');
    if(message.method==='tools/list')return send({jsonrpc:'2.0',id,result:{tools:dbnomicsMcpTools}});
    if(message.method!=='tools/call')return error(id,-32601,'Method not found.');
    const tool=handlers.get(message.params?.name);if(!tool)return error(id,-32602,'Unknown DBnomics tool.');
    const args=message.params?.arguments??{};
    try{validate(args,tool[2]);}catch(e){return error(id,-32602,e.message);}
    const controller=new AbortController(),entry={controller,promise:null};pending.set(id,entry);
    entry.promise=(async()=>{
      try{
        const value=await tool[4](createDbnomicsClient({origin,signal:controller.signal}),args);
        const structuredContent=value&&typeof value==='object'&&!Array.isArray(value)?value:{result:value};
        await send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent}});
      }catch(e){await send({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:JSON.stringify({error:e.code??'DBNOMICS_REQUEST_FAILED',message:e.message})}]}});}
      finally{pending.delete(id);}
    })();
    return entry.promise;
  }
  let remainder='';const decoder=new TextDecoder('utf-8',{fatal:true});
  const dispatch=line=>{let message;try{message=JSON.parse(line);}catch{void error(null,-32700,'Invalid JSON.');return;}
    void receive(message).catch(e=>error(Object.hasOwn(message??{},'id')?message.id:null,-32603,e.message));};
  for await(const chunk of input){
    remainder+=decoder.decode(chunk,{stream:true});
    if(remainder.length>256*1024*1024)throw Error('MCP message exceeds 256 MiB.');
    let at;while((at=remainder.indexOf('\n'))>=0){const line=remainder.slice(0,at);remainder=remainder.slice(at+1);if(line.trim())dispatch(line);}
  }
  remainder+=decoder.decode();if(remainder.trim())dispatch(remainder);
  await Promise.allSettled([...pending.values()].map(v=>v.promise));await writeTail;
}
