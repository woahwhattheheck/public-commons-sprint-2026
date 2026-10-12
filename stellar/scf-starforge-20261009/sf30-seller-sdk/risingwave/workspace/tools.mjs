// MIT. One tool catalogue over the original browser-owned RisingWave workbench.
const object={type:'object'},id={type:'string',pattern:'^[a-z][a-z0-9-]{0,100}$'},revision={type:'integer',minimum:0};
const text={type:'string'},page={limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}};
const extraction={type:'object',additionalProperties:false,properties:{maxRows:{type:'integer',minimum:1},maxBytes:{type:'integer',minimum:1024},maxRowBytes:{type:'integer',minimum:1024,maximum:33554432},batchSize:{type:'integer',minimum:1},timeoutSeconds:{type:'integer',minimum:1},maxDurationMs:{type:'integer',minimum:1000}}};
const tool=(name,description,properties,required,readOnly=false)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
  annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:readOnly,openWorldHint:!readOnly}});
export const RISINGWAVE_TOOLS=Object.freeze([
  tool('risingwave_status','Read source revisions, environment references, products and original running services.',{},[],true),
  tool('risingwave_revision','Read the complete original source and merchant revision.',{revision},['revision'],true),
  tool('risingwave_save_source','Save a complete source and merchant revision using the displayed expectedRevision.',{expectedRevision:revision,source:object,merchant:{type:['object','null']}},['expectedRevision','source','merchant']),
  tool('risingwave_compile_report','Compile a keyed native relation/subscription report with typed output columns and membership filters. Include probe values for every required parameter.',{report:object},['report'],true),
  tool('risingwave_discover','Discover native relations, visible typed columns, keys and existing subscriptions.',{expectedRevision:revision,schemas:{type:'array',items:text},relations:{type:'array',items:text},subscriptions:{type:'array',items:text}},['expectedRevision'],true),
  tool('risingwave_subscription_inspect','Inspect the selected report’s native relation and existing subscription.',{expectedRevision:revision,query:text},['expectedRevision','query'],true),
  tool('risingwave_subscription_prepare','Prepare and retain the exact native subscription statement, relation, retention and source binding. Reuses its original requestId.',{expectedRevision:revision,query:text,requestId:id,retention:text},['expectedRevision','query','requestId']),
  tool('risingwave_subscription_create','Create or reconcile the exact reviewed subscription. A repeated request uses the original retained operation.',{expectedRevision:revision,requestId:id,reviewHash:{type:'string',pattern:'^[a-f0-9]{64}$'}},['expectedRevision','requestId','reviewHash']),
  tool('risingwave_subscriptions','Read all retained subscription reviews and original operation results.',{},[],true),
  tool('risingwave_subscription_status','Read one original saved subscription review and result.',{requestId:id},['requestId'],true),
  tool('risingwave_preview','Preview one saved report using exact typed parameter values.',{expectedRevision:revision,query:text,input:object},['expectedRevision','query','input']),
  tool('risingwave_capture','Start a complete native snapshot or incremental edition from the retained original checkpoint. Explicit onGap controls rebuilding after retention expiry; the previous edition is preserved. Repeat captureId to inspect the original request.',{expectedRevision:revision,query:text,input:object,captureId:id,mode:{enum:['full','changes','auto']},baseCaptureId:id,onGap:{enum:['error','rebuild']},extraction},['expectedRevision','query','input','captureId']),
  tool('risingwave_captures','Page all complete, active and interrupted original capture records.',page,[],true),
  tool('risingwave_capture_status','Read one original capture, its full metadata and file identities.',{captureId:id},['captureId'],true),
  tool('risingwave_capture_cancel','Cancel the named original in-flight source read and retain its state and partial files.',{captureId:id},['captureId']),
  tool('risingwave_capture_resume','Resume the original interrupted native capture from its retained complete epoch. An unfinished initial snapshot restarts inside the same capture directory and retains its earlier attempt.',{captureId:id},['captureId']),
  tool('risingwave_capture_recover','Reattach a completed native capture after a lost workbench response using only retained files.',{captureId:id},['captureId']),
  tool('risingwave_capture_file','Read exact original file bytes in base64 ranges. Continue nextOffset to null; every range retains the complete file SHA-256.',{captureId:id,file:{enum:['json','ndjson','csv','events','checkpoint','state','manifest']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}},['captureId','file'],true),
  tool('risingwave_compare_captures','Compare every retained row using unique identity fields and retain complete added, removed and changed NDJSON files. Samples are bounded only for display.',{before:id,after:id,comparisonId:id,keys:{type:'array',items:text},sampleLimit:{type:'integer',minimum:1,maximum:1000}},['before','after']),
  tool('risingwave_comparisons','Page retained complete comparison identities and every-row counts.',page,[],true),
  tool('risingwave_comparison_status','Reopen a complete comparison, all counts, samples and full file identities.',{comparisonId:id},['comparisonId'],true),
  tool('risingwave_comparison_file','Read full difference file bytes in base64 ranges with the original SHA-256. Continue nextOffset to null.',{comparisonId:id,file:{enum:['added','removed','changed','manifest']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}},['comparisonId','file'],true),
  tool('risingwave_receive_comparison','Receive all three complete difference streams and their manifest, resuming the original partial transfer and verifying every file.',{comparisonId:id,directory:text},['comparisonId','directory']),
  tool('risingwave_receive_capture','Receive every complete original capture file into the selected private directory and reopen the native capture. Reuses the same partial transfer.',{captureId:id,directory:text},['captureId','directory']),
  tool('risingwave_publication_create','Bind one saved report and its exact merchant choices to a versioned dataset product.',{expectedRevision:revision,query:text,path:text,publicationId:id},['expectedRevision','query','path']),
  tool('risingwave_publication_status','Read the original product, candidate runs, target, schedule and customer requests.',{publicationId:id},['publicationId'],true),
  tool('risingwave_publication_action','Operate the original publisher and recurring scheduler. Native plan/run/review IDs and expected target snapshot/revision remain required by each action.',{publicationId:id,action:{enum:['source','plan','plan/save','extract','extract/start','cancel','review','publish','recover','schedule/status','schedule/save','schedule/enable','schedule/pause','schedule/run','schedule/continue']},input:object},['publicationId','action']),
  tool('risingwave_seller_start','Start the native dataset seller using the product’s saved terms and retained published versions.',{publicationId:id},['publicationId']),
  tool('risingwave_seller_stop','Pause recurring refresh and close the original dataset seller.',{publicationId:id},['publicationId']),
  tool('risingwave_run','Inspect an original candidate and its preview using the original publisher run ID.',{publicationId:id,runId:text},['publicationId','runId'],true),
  tool('risingwave_buyer_offer','Read the exact snapshot-pinned offer and all native payment choices.',{publicationId:id,runId:text,query:text},['publicationId','runId'],true),
  tool('risingwave_buyer_prepare','Retain a customer request with its original intent, selected payment choice and observed offer SHA-256.',{publicationId:id,input:object},['publicationId','input']),
]);
export async function callRisingWaveTool(client,name,input={}){
  const spec=RISINGWAVE_TOOLS.find(value=>value.name===name);
  if(!spec)throw Object.assign(new Error('Unknown RisingWave tool'),{code:'RISINGWAVE_TOOL_NOT_FOUND'});
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(spec.inputSchema.properties,key))||
    spec.inputSchema.required.some(key=>!Object.hasOwn(input,key)))throw Object.assign(new Error('Use the declared RisingWave tool fields'),{code:'RISINGWAVE_TOOL_INPUT_INVALID'});
  const actions={
    risingwave_status:()=>client.state(),risingwave_revision:()=>client.revision(input.revision),
    risingwave_save_source:()=>client.save(input),risingwave_compile_report:()=>client.compileReport(input.report),
    risingwave_subscription_inspect:()=>client.subscriptionInspect(input),risingwave_subscription_prepare:()=>client.subscriptionPrepare(input),
    risingwave_subscription_create:()=>client.subscriptionCreate(input),risingwave_subscriptions:()=>client.subscriptions(),
    risingwave_subscription_status:()=>client.subscriptionRecord(input.requestId),
    risingwave_discover:()=>client.discover(input),risingwave_preview:()=>client.preview(input),risingwave_capture:()=>client.capture(input),
    risingwave_captures:()=>client.captures(input),risingwave_capture_status:()=>client.captureRecord(input.captureId),
    risingwave_capture_cancel:()=>client.cancelCapture(input.captureId),risingwave_capture_resume:()=>client.resumeCapture(input.captureId),risingwave_capture_recover:()=>client.recoverCapture(input.captureId),
    risingwave_capture_file:()=>client.captureChunk(input.captureId,input.file,{offset:input.offset,limit:input.limit}),
    risingwave_comparisons:()=>client.comparisons(input),risingwave_comparison_status:()=>client.comparisonRecord(input.comparisonId),
    risingwave_comparison_file:()=>client.comparisonChunk(input.comparisonId,input.file,{offset:input.offset,limit:input.limit}),
    risingwave_receive_comparison:()=>client.receiveComparison(input),
    risingwave_compare_captures:()=>client.compareCaptures(input),risingwave_receive_capture:()=>client.receiveCapture(input),
    risingwave_publication_create:()=>client.createPublication(input),risingwave_publication_status:()=>client.publication(input.publicationId),
    risingwave_publication_action:()=>client.publicationCommand(input.publicationId,input.action,input.input??{}),
    risingwave_seller_start:()=>client.seller(input.publicationId,true),risingwave_seller_stop:()=>client.seller(input.publicationId,false),
    risingwave_run:()=>client.run(input.publicationId,input.runId),
    risingwave_buyer_offer:()=>client.buyerOffer(input.publicationId,input.runId,input.query??''),
    risingwave_buyer_prepare:()=>client.prepareBuyer(input.publicationId,input.input),
  };
  return actions[name]();
}
