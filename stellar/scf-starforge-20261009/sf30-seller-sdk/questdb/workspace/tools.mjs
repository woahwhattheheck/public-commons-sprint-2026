// MIT. One tool catalogue over the original browser-owned QuestDB workbench.
const object={type:'object'},id={type:'string',pattern:'^[a-z][a-z0-9-]{0,100}$'},revision={type:'integer',minimum:0};
const text={type:'string'},page={limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}};
const tool=(name,description,properties,required,readOnly=false)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
  annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:readOnly,openWorldHint:!readOnly}});
export const QUESTDB_TOOLS=Object.freeze([
  tool('questdb_status','Read source revisions, environment references, products and original running services.',{},[],true),
  tool('questdb_revision','Read the complete original source and merchant revision.',{revision},['revision'],true),
  tool('questdb_save_source','Save a complete source and merchant revision using the displayed expectedRevision.',{expectedRevision:revision,source:object,merchant:{type:['object','null']}},['expectedRevision','source','merchant']),
  tool('questdb_compile_report','Compile a typed time window, SAMPLE BY or keyed ASOF report. Include probe values for every required parameter.',{report:object},['report'],true),
  tool('questdb_discover','Discover native tables, designated timestamps, types and partition metadata.',{expectedRevision:revision,tables:{type:'array',items:text}},['expectedRevision']),
  tool('questdb_preview','Preview one saved report using exact typed parameter values.',{expectedRevision:revision,query:text,input:object},['expectedRevision','query','input']),
  tool('questdb_capture','Start one complete canonical capture. Repeat the same captureId to inspect the original request.',{expectedRevision:revision,query:text,input:object,captureId:id,extraction:object,includeNativeCsv:{type:'boolean'}},['expectedRevision','query','input','captureId']),
  tool('questdb_captures','Page all complete, active and interrupted original capture records.',page,[],true),
  tool('questdb_capture_status','Read one original capture, its full metadata and file identities.',{captureId:id},['captureId'],true),
  tool('questdb_capture_cancel','Cancel the named original in-flight source read and retain its state and partial files.',{captureId:id},['captureId']),
  tool('questdb_capture_recover','Reattach a completed native capture after a lost workbench response using only retained files.',{captureId:id},['captureId']),
  tool('questdb_capture_file','Read exact original file bytes in base64 ranges. Continue nextOffset to null; every range retains the complete file SHA-256.',{captureId:id,file:{enum:['json','ndjson','csv','manifest','nativeCsv']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}},['captureId','file'],true),
  tool('questdb_compare_captures','Compare every retained row in two complete editions using unique identity fields or ordered row positions.',{before:id,after:id,keys:{type:'array',items:text},sampleLimit:{type:'integer',minimum:1,maximum:1000}},['before','after']),
  tool('questdb_receive_capture','Receive every complete original capture file into the selected private directory and reopen the native capture. Reuses the same partial transfer.',{captureId:id,directory:text},['captureId','directory']),
  tool('questdb_publication_create','Bind one saved report and its exact merchant choices to a versioned dataset product.',{expectedRevision:revision,query:text,path:text},['expectedRevision','query','path']),
  tool('questdb_publication_status','Read the original product, candidate runs, target, schedule and customer requests.',{publicationId:id},['publicationId'],true),
  tool('questdb_publication_action','Operate the original publisher and recurring scheduler. Native plan/run/review IDs and expected target snapshot/revision remain required by each action.',{publicationId:id,action:{enum:['source','plan','plan/save','extract','extract/start','cancel','review','publish','recover','schedule/status','schedule/save','schedule/enable','schedule/pause','schedule/run','schedule/continue']},input:object},['publicationId','action']),
  tool('questdb_seller_start','Start the native dataset seller using the product’s saved terms and retained published versions.',{publicationId:id},['publicationId']),
  tool('questdb_seller_stop','Pause recurring refresh and close the original dataset seller.',{publicationId:id},['publicationId']),
  tool('questdb_run','Inspect an original candidate and its preview using the original publisher run ID.',{publicationId:id,runId:text},['publicationId','runId'],true),
  tool('questdb_buyer_offer','Read the exact snapshot-pinned offer and all native payment choices.',{publicationId:id,runId:text,query:text},['publicationId','runId'],true),
  tool('questdb_buyer_prepare','Retain a customer request with its original intent, selected payment choice and observed offer SHA-256.',{publicationId:id,input:object},['publicationId','input']),
]);
export async function callQuestDbTool(client,name,input={}){
  const spec=QUESTDB_TOOLS.find(value=>value.name===name);
  if(!spec)throw Object.assign(new Error('Unknown QuestDB tool'),{code:'QUESTDB_TOOL_NOT_FOUND'});
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(spec.inputSchema.properties,key))||
    spec.inputSchema.required.some(key=>!Object.hasOwn(input,key)))throw Object.assign(new Error('Use the declared QuestDB tool fields'),{code:'QUESTDB_TOOL_INPUT_INVALID'});
  const actions={
    questdb_status:()=>client.state(),questdb_revision:()=>client.revision(input.revision),
    questdb_save_source:()=>client.save(input),questdb_compile_report:()=>client.compileReport(input.report),
    questdb_discover:()=>client.discover(input),questdb_preview:()=>client.preview(input),questdb_capture:()=>client.capture(input),
    questdb_captures:()=>client.captures(input),questdb_capture_status:()=>client.captureRecord(input.captureId),
    questdb_capture_cancel:()=>client.cancelCapture(input.captureId),questdb_capture_recover:()=>client.recoverCapture(input.captureId),
    questdb_capture_file:()=>client.captureChunk(input.captureId,input.file,{offset:input.offset,limit:input.limit}),
    questdb_compare_captures:()=>client.compareCaptures(input),questdb_receive_capture:()=>client.receiveCapture(input),
    questdb_publication_create:()=>client.createPublication(input),questdb_publication_status:()=>client.publication(input.publicationId),
    questdb_publication_action:()=>client.publicationCommand(input.publicationId,input.action,input.input??{}),
    questdb_seller_start:()=>client.seller(input.publicationId,true),questdb_seller_stop:()=>client.seller(input.publicationId,false),
    questdb_run:()=>client.run(input.publicationId,input.runId),
    questdb_buyer_offer:()=>client.buyerOffer(input.publicationId,input.runId,input.query??''),
    questdb_buyer_prepare:()=>client.prepareBuyer(input.publicationId,input.input),
  };
  return actions[name]();
}
