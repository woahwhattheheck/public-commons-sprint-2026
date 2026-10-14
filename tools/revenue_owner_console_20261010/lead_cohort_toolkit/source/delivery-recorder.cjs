'use strict';
const INDEX='internal/delivery-receipts/index.json';
const RECORD='internal/working-record.json';
const {receiveMessage}=require('./message-receipt.cjs');
function deliveryChannel(value){const channel=value??'gmail';if(!['gmail','email'].includes(channel))throw Error('Use the original email or gmail delivery channel');return channel;}
const json=value=>JSON.stringify(value,null,2)+'\n';
function required(value,label){if(typeof value!=='string'||!value.trim())throw Error(label+' must be non-empty text');return value;}
function utc(value,label){required(value,label);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error(label+' must be a UTC ISO timestamp');return value;}
function address(value,label){
 value=required(value,label).trim();
 const angle=/^[^<>]*<([^<>]+)>$/.exec(value);
 const email=(angle?angle[1]:value).trim();
 if(!/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(email))throw Error(label+' must contain one complete mailbox');
 return email.toLowerCase();
}
function header(message,name){
 const values=(message.payload?.headers||[]).filter(h=>String(h.name).toLowerCase()===name.toLowerCase()).map(h=>h.value);
 if(values.length!==1)throw Error('Actual message needs one '+name+' header');
 return values[0];
}
function identity(message,body,expected,hash,context={}){
 if(!message||!Array.isArray(message.label_ids)||!message.label_ids.includes('SENT')||message.label_ids.includes('DRAFT'))throw Error('Use the actual full Gmail SENT readback');
 if(!/^[a-f0-9]{1,64}$/i.test(message.id||'')||!message.thread_id)throw Error('Actual Gmail message/thread identity is missing');
 const multipart=expected.original_payload!==undefined;
 if(!multipart&&(message.payload?.mime_type!=='text/plain'||typeof message.payload?.body?.content!=='string'))throw Error('Supply the complete original payload and RAW response for this MIME message');
 required(body,'original primary body');
 if(!multipart&&message.payload.body.content!==body)throw Error('Actual SENT body differs from the original inline body');
 const from=address(header(message,'From'),'From'),to=address(header(message,'To'),'To');
 if(from!==address(expected.account_email,'account_email')||to!==address(expected.destination,'destination'))throw Error('Actual sender or recipient differs');
 if((message.payload.headers||[]).some(h=>/^(cc|bcc)$/i.test(h.name)&&String(h.value||'').trim()))throw Error('This command expects one original recipient without Cc or Bcc');
 const subject=header(message,'Subject');if(subject!==required(expected.subject,'subject'))throw Error('Actual subject differs');
 if(!/^\d+$/.test(String(message.internal_date))||!Number.isSafeInteger(Number(message.internal_date)))throw Error('Actual Gmail timestamp is missing');
 const delivered_at=new Date(Number(message.internal_date)).toISOString();
 const message_content=multipart?receiveMessage({message,raw:expected.raw_message,originalPayload:expected.original_payload,attachments:expected.attachments,files:context.files||{},binaries:context.binaries||{},account_email:from,body}):undefined;
 return {provider_id:message.id,thread_id:message.thread_id,account_email:from,destination:to,subject,delivered_at,body_sha256:hash(body).sha256,...(message_content?{message_content}:{})};
}
function parse(files,path){if(typeof files[path]!=='string')throw Error('Missing complete source: '+path);return JSON.parse(files[path]);}
function historyPath(files,requested){
 if(requested){if(!['native/operation-history.json','internal/operation-history.json'].includes(requested))throw Error('Use an original operation-history path');return requested;}
 const paths=['native/operation-history.json','internal/operation-history.json'].filter(p=>typeof files[p]==='string');
 if(paths.length!==1)throw Error('Select the original history_path when both histories are present');
 return paths[0];
}
function replay(files,core,requested,options={}){
 const record=parse(files,RECORD),history_path=historyPath(files,requested),operations=parse(files,history_path);
 if(!Array.isArray(operations))throw Error('Original history must be an array');
 let ledger={};for(const op of operations)ledger=core.applyLeadFulfillment(ledger,op.body,op.at,options).ledger;
 if(JSON.stringify(core.leadFulfillmentExport(ledger,{packId:record.pack.id,format:'working-record'}).value)!==JSON.stringify(record))throw Error('Original complete history differs from its saved record');
 return {record,operations,ledger,history_path};
}
function exportedFiles(files,record,deps,targetEdition){
 const {core,renderer,markdown}=deps,assembly=core.createLeadFulfillmentAssembly({});
 assembly.receive(record,{operationId:record.pack.id+'-delivery-independent-receive',asOf:record.editions[0]?.prepared_at||new Date().toISOString()});
 if(JSON.stringify(assembly.export({packId:record.pack.id,format:'working-record'}).value)!==JSON.stringify(record))throw Error('Independent complete record differs');
 const editions=record.editions.map(e=>({id:e.id,value:assembly.export({packId:record.pack.id,editionId:e.id,format:'json'}).value}));
 let groups=0,targetPresent=false;
 for(const [path,body]of Object.entries(files)){
  if(!/^customer\/.+\.json$/.test(path))continue;
  let supplied;try{supplied=JSON.parse(body);}catch{continue;}
  if(!editions.some(e=>e.value.version===supplied?.version))continue;
  const matching=editions.filter(e=>JSON.stringify({...e.value,...(supplied.prepared_by===undefined?{}:{prepared_by:supplied.prepared_by})},null,2)+'\n'===body);
  if(!matching.length)throw Error('Retained customer JSON differs: '+path);
  if(matching.some(e=>e.id===targetEdition))targetPresent=true;
  const stem=path.slice(0,-5),expected={html:renderer.renderLeadPackHTML(supplied),csv:renderer.leadPackCSV(supplied),md:markdown.render(supplied)};
  for(const [ext,value]of Object.entries(expected))if(files[stem+'.'+ext]!==value)throw Error('Complete retained customer export differs: '+stem+'.'+ext);
  groups++;
 }
 if(!groups||(targetEdition&&!targetPresent))throw Error('Complete target edition customer files are absent');
 return groups*4;
}
function verifyBuyer(record,destination){
 const originalCustomer=record.pack.document?.customer;
 if(!originalCustomer||typeof originalCustomer!=='object')throw Error('Original pack customer document is missing');
 if(/^mailto:/i.test(String(originalCustomer.contact_url||''))&&address(originalCustomer.contact_url.slice(7),'Original buyer contact')!==destination)throw Error('Actual recipient differs from the original pack buyer');
}
function verifyReceipts(files,deps){
 if(files[INDEX]===undefined)return {receipts:0};
 const index=parse(files,INDEX),record=parse(files,RECORD);
 if(index.schema!=='lead-cohort.gmail-delivery-receipts.v1'||!Array.isArray(index.entries))throw Error('Invalid original delivery receipt index');
 const seen=new Set(),checkedHistories=new Map();
 for(const row of index.entries){
  if(seen.has(row.provider_id))throw Error('Duplicate provider receipt');seen.add(row.provider_id);
  const messageBody=files[row.message_path],body=files[row.body_path];
  if(typeof messageBody!=='string'||typeof body!=='string'||deps.hash(messageBody).sha256!==row.message_sha256||deps.hash(body).sha256!==row.body_sha256)throw Error('Original actual delivery source differs');
  const expected={...row};
  if(row.message_content){
   if(row.message_content.schema!=='lead-cohort.complete-message.v1')throw Error('Unsupported complete-message receipt');
   const payloadBody=files[row.original_payload_path],rawBody=files[row.raw_path];
   if(typeof payloadBody!=='string'||typeof rawBody!=='string'||deps.hash(payloadBody).sha256!==row.original_payload_file_sha256||deps.hash(rawBody).sha256!==row.raw_file_sha256)throw Error('Original multipart source differs');
   expected.original_payload=JSON.parse(payloadBody);expected.raw_message=JSON.parse(rawBody);expected.attachments=row.message_content.attachments;
  }
  const actual=identity(JSON.parse(messageBody),body,expected,deps.hash,{files,binaries:deps.binaries});
  if(JSON.stringify(actual.message_content)!==JSON.stringify(row.message_content))throw Error('Complete original MIME receipt differs');
  for(const key of ['provider_id','thread_id','account_email','destination','subject','delivered_at','body_sha256'])if(actual[key]!==row[key])throw Error('Recorded message identity differs: '+key);
  const channel=deliveryChannel(row.channel),matches=record.deliveries.filter(d=>['gmail','email'].includes(d.channel)&&d.provider_id===row.provider_id);
  if(matches.length!==1)throw Error('Original provider event missing or duplicated');
  const d=matches[0];if(d.channel!==channel||d.id!==row.delivery_id||d.edition_id!==row.edition_id||d.destination.toLowerCase()!==row.destination||Date.parse(d.delivered_at)!==Date.parse(row.delivered_at))throw Error('Native receipt differs from original delivery event');
  const selectedHistory=historyPath(files,row.history_path);
  if(!checkedHistories.has(selectedHistory)){
   const history=replay(files,deps.core,selectedHistory,deps.coreOptions),buyers=new Map();
   let ledger={};
   for(const operation of history.operations){
    // A receipt belongs to the buyer route that was current when its original
    // delivery operation was recorded. Later published route corrections must
    // not rewrite or invalidate the recipient of an earlier actual send.
    if(operation.body.kind==='delivery-record'){
     const state=deps.core.leadFulfillmentState(ledger,{packId:record.pack.id,asOf:operation.at});
     buyers.set(operation.body.operation_id,{pack:state.selected?.pack});
    }
    ledger=deps.core.applyLeadFulfillment(ledger,operation.body,operation.at,deps.coreOptions).ledger;
   }
   checkedHistories.set(selectedHistory,{operations:history.operations,buyers});
  }
  const history=checkedHistories.get(selectedHistory),operations=history.operations,matchingOperations=operations.filter(o=>o.body.operation_id===row.operation_id),op=matchingOperations[0];
  verifyBuyer(history.buyers.get(row.operation_id)||{},actual.destination);
  if(matchingOperations.length!==1||!op||op.body.kind!=='delivery-record'||op.body.input.id!==row.delivery_id||op.body.input.provider_id!==row.provider_id||op.body.input.edition_id!==row.edition_id||op.body.input.channel!==channel||address(op.body.input.destination,'Original operation destination')!==row.destination||Date.parse(op.body.input.delivered_at)!==Date.parse(row.delivered_at))throw Error('Original delivery operation differs from retained receipt');
 }
 return {receipts:index.entries.length};
}
function recordDelivery(original,input,body,deps){
 const files={...original},{core,hash}=deps;
 const identityValue=identity(input.sent_message,body,input,hash,{files,binaries:deps.binaries});
 const channel=deliveryChannel(input.channel);
 for(const key of ['operation_id','edition_id','delivery_id'])required(input[key],key);
 const recordedAt=utc(input.recorded_at,'recorded_at');
 if(Date.parse(recordedAt)<Date.parse(identityValue.delivered_at))throw Error('Recording cannot precede the actual send');
 verifyReceipts(files,deps);
 const before=replay(files,core,input.history_path,deps.coreOptions);
 verifyBuyer(before.record,identityValue.destination);
 if(!before.record.editions.some(e=>e.id===input.edition_id))throw Error('Original target edition does not exist');
 const customerFiles=exportedFiles(files,before.record,deps,input.edition_id);
 const matches=before.record.deliveries.filter(d=>['gmail','email'].includes(d.channel)&&d.provider_id===identityValue.provider_id);
 if(matches.length>1)throw Error('Provider already has multiple original delivery events');
 let ledger=before.ledger,operations=before.operations,added=false;
 if(matches.length){
  const d=matches[0],op=operations.find(o=>o.body.operation_id===input.operation_id);
  if(d.channel!==channel||d.id!==input.delivery_id||d.edition_id!==input.edition_id||d.destination.toLowerCase()!==identityValue.destination||Date.parse(d.delivered_at)!==Date.parse(identityValue.delivered_at)||!op||op.body.kind!=='delivery-record'||op.body.input.id!==d.id||op.body.input.provider_id!==d.provider_id)throw Error('Existing provider delivery conflicts with this original request');
 }else{
  const operation={operation_id:input.operation_id,kind:'delivery-record',expected_root_sha256:core.leadFulfillmentState(ledger).root_sha256,input:{id:input.delivery_id,edition_id:input.edition_id,delivered_at:identityValue.delivered_at,channel,destination:identityValue.destination,provider_id:identityValue.provider_id,receipt_url:'https://mail.google.com/mail/u/?authuser='+encodeURIComponent(identityValue.account_email)+'#all/'+identityValue.provider_id,note:input.note||'Complete original inline email and actual native Gmail SENT object retained with the original case.'}};
  ledger=core.applyLeadFulfillment(ledger,operation,recordedAt).ledger;operations=[...operations,{body:operation,at:recordedAt}];added=true;
 }
 const record=core.leadFulfillmentExport(ledger,{packId:before.record.pack.id,format:'working-record'}).value;
 files[RECORD]=json(record);files[before.history_path]=json(operations);
 const index=files[INDEX]===undefined?{schema:'lead-cohort.gmail-delivery-receipts.v1',entries:[]}:parse(files,INDEX);
 const previous=index.entries.find(e=>e.provider_id===identityValue.provider_id);
 if(previous){
  for(const key of ['operation_id','edition_id','delivery_id'])if(previous[key]!==input[key])throw Error('Retained provider receipt conflicts: '+key);
  for(const key of ['provider_id','thread_id','account_email','destination','subject','delivered_at','body_sha256'])if(previous[key]!==identityValue[key])throw Error('Repeated actual message differs: '+key);
  if(deliveryChannel(previous.channel)!==channel||JSON.stringify(previous.message_content)!==JSON.stringify(identityValue.message_content))throw Error('Repeated complete original message differs');
 }else{
  const base='internal/delivery-receipts/'+identityValue.provider_id,body_path=base+'/first-email.txt',message_path=base+'/sent-message.json',messageBody=json(input.sent_message);
  for(const [path,value]of [[body_path,body],[message_path,messageBody]]){if(files[path]!==undefined&&files[path]!==value)throw Error('Original receipt path has different content');files[path]=value;}
  let contentFiles={};
  if(identityValue.message_content){
   const original_payload_path=base+'/original-payload.json',raw_path=base+'/sent-raw.json',payloadBody=json(input.original_payload),rawBody=json(input.raw_message);
   for(const [path,value]of [[original_payload_path,payloadBody],[raw_path,rawBody]]){if(files[path]!==undefined&&files[path]!==value)throw Error('Original MIME receipt path has different content');files[path]=value;}
   contentFiles={original_payload_path,raw_path,original_payload_file_sha256:hash(payloadBody).sha256,raw_file_sha256:hash(rawBody).sha256};
  }
  index.entries.push({...identityValue,...contentFiles,channel,operation_id:input.operation_id,edition_id:input.edition_id,delivery_id:input.delivery_id,history_path:before.history_path,body_path,message_path,message_sha256:hash(messageBody).sha256});
  files[INDEX]=json(index);
 }
 exportedFiles(files,record,deps,input.edition_id);verifyReceipts(files,deps);
 return {files,record,operations,history_path:before.history_path,delivery_added:added,receipt_added:!previous,customer_files:customerFiles,provider_id:identityValue.provider_id};
}
module.exports={recordDelivery,verifyReceipts,replay,exportedFiles,identity};
