import {encodeCsv, parseCsv, decimal, LIMITS} from '../../engine.mjs';
import {sha256Utf8} from '../../sha256.mjs';

/** Offline source preparation only. Native posts, edits and close actions remain
 * with the original supplier application and the existing migration workspace. */
export const CAPTURE_SCHEMA='tjlabs.business-central-work-order-capture.v1';
export const KINDS=Object.freeze({
 resourceLines:{api:'eam/v1.0',tail:'workOrderResourceLines',lineKind:'labor'},
 itemLines:{api:'eam/v1.0',tail:'workOrderItemLines',lineKind:'material'},
 expenseLines:{api:'eam/v1.0',tail:'workOrderExpenseLines',lineKind:'expense'},
 postedLedger:{api:'eamAnalytics/v1.0',tail:'woLedgerEntries',lineKind:null}
});
const need=(ok,message)=>{if(!ok)throw Error(message);};
const text=(value,label,max=4000)=>{need(typeof value==='string'&&value.length>0&&value.length<=max,'Supply '+label+'.');sha256Utf8(value);return value;};
const guid=(value,label)=>{text(value,label,36);need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),'Use the original GUID for '+label+'.');return value;};
const num=Symbol('original JSON numeric token');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!value[num];
const owns=(value,key)=>Object.hasOwn(value,key);
const field=(row,key)=>{const value=row[key];need(value===undefined||value===null||typeof value==='string','Expected original text in '+key+'.');return value??'';};
const file=(path,mimeType,value)=>({path,mimeType,text:value,...sha256Utf8(value)});
const clone=value=>JSON.parse(JSON.stringify(value));

/** Reject duplicate members, preserve all number spellings, and never route
 * money, quantities, sequence numbers or ledger identities through JS Number. */
function parseOriginalJSON(raw){
 let p=0;
 const skip=()=>{while(/[ \n\r\t]/.test(raw[p]??'\0'))p++;};
 const string=()=>{const start=p++;for(;;){need(p<raw.length,'Unclosed original JSON string.');const c=raw[p++];if(c==='"')break;if(c==='\\')p++;}let result;try{result=JSON.parse(raw.slice(start,p));}catch{throw Error('Invalid original JSON string.');}sha256Utf8(result);return result;};
 function read(depth=0){
  need(depth<=64,'Original JSON nesting exceeds 64 levels.');skip();const c=raw[p];
  if(c==='"')return string();
  if(c==='{'){p++;skip();const result=Object.create(null);if(raw[p]==='}'){p++;return result;}
   for(;;){skip();need(raw[p]==='"','Expected an original JSON member name.');const key=string();need(!owns(result,key),'Duplicate original JSON member: '+key);skip();need(raw[p++]===':','Expected original JSON member separator.');result[key]=read(depth+1);skip();const end=raw[p++];if(end==='}')return result;need(end===',','Expected original JSON object separator.');}
  }
  if(c==='['){p++;skip();const result=[];if(raw[p]===']'){p++;return result;}
   for(;;){result.push(read(depth+1));skip();const end=raw[p++];if(end===']')return result;need(end===',','Expected original JSON array separator.');}
  }
  for(const [token,value] of [['true',true],['false',false],['null',null]])if(raw.startsWith(token,p)){p+=token.length;return value;}
  const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(p));
  need(match,'Invalid original JSON value.');p+=match[0].length;return {[num]:match[0]};
 }
 const value=read();skip();need(p===raw.length,'Unexpected data after original JSON value.');return value;
}
function originalJSON(value){
 if(value&&typeof value==='object'&&value[num])return value[num];
 if(Array.isArray(value))return '['+value.map(originalJSON).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).map(key=>JSON.stringify(key)+':'+originalJSON(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
function nativeType(value){if(value===undefined)return 'absent';if(value===null)return 'null';if(value&&value[num])return 'number';if(Array.isArray(value))return 'array';return typeof value;}
function nativeCell(value){if(value===undefined||value===null)return '';if(typeof value==='string')return value;return originalJSON(value);}
function exactDecimal(value,label){
 const token=typeof value==='string'?value:value&&value[num];
 need(typeof token==='string'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token),'Retain a decimal token for '+label+'.');
 const match=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
 const exponent=match[4]?Number(match[4]):0;
 need(Number.isSafeInteger(exponent)&&Math.abs(exponent)<=1000,'Decimal exponent exceeds the supported exact source range.');
 const digits=match[2]+(match[3]||''),position=match[2].length+exponent;
 const expanded=position<=0?'0.'+'0'.repeat(-position)+digits:position>=digits.length?digits+'0'.repeat(position-digits.length):digits.slice(0,position)+'.'+digits.slice(position);
 return decimal(match[1]+expanded);
}
function queryNames(url){const query=url.includes('?')?url.slice(url.indexOf('?')+1):'';return query.split('&').filter(Boolean).map(part=>{try{return decodeURIComponent(part.split('=')[0].replace(/\+/g,' ')).toLowerCase();}catch{throw Error('Invalid original URL query escaping.');}});}
function pageURL(value,collection,recordMode=false){
 text(value,'original page URL',16000);const base=value.split('?')[0];const selected=recordMode?base.startsWith(collection+'(')&&/^\([0-9a-f-]{36}\)$/i.test(base.slice(collection.length)):base===collection;need(selected&&!/[\s#\\]/.test(value),'Retain the exact selected company/document collection or original line URI.');
 need(!queryNames(value).some(key=>['access_token','client_secret','password','authorization','token','api_key','apikey','sig','signature'].includes(key)),'Keep authentication query values out of retained source URLs.');return value;
}
function observation(value){
 text(value,'actual observation timestamp',64);
 need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10),'Use an actual valid ISO observation timestamp.');
}
const COST_COLUMNS=['company_id','work_order_id','line_id','line_kind','asset_id','fixed_asset_id','project_id','project_task_id','dimension_set_id','dimension_1','dimension_2','currency','quantity','unit_code','cost_amount','cost_basis','posting_date','native_record_id','native_document_id','source_reference'];
const QUANTITY_FIELDS=['quantity','qtyToConsume','qtyConsumed'];

/** Produce complete source staging for the existing Work orders and costs desk.
 * Missing native header links or amounts remain blank and listed in findings.
 * It does not infer cost from quantities, prices, descriptions or planNo. */
export function prepareWorkOrderCapture(capture){
 need(plain(capture)&&capture.schema===CAPTURE_SCHEMA,'Use the complete work-order capture schema.');
 need(owns(KINDS,capture.kind),'Choose a documented native line collection or postedLedger.');
 const spec=KINDS[capture.kind],ledger=capture.kind==='postedLedger';
 const company=guid(capture.companyId,'company ID'),canonical=text(capture.canonicalCompanyId,'original canonical company',200);
 need(!/[\u0000-\u001f]/.test(canonical),'Use the original printable company key.');
 text(capture.tenantId,'actual tenant identity',200);text(capture.environment,'actual environment',200);observation(capture.observedAt);
 const order=ledger?null:guid(capture.workOrderId,'selected work-order ID');
 const collection=text(capture.collectionUrl,'complete selected collection URL',4000);
 need(/^https:\/\/[^/?#@]+\//i.test(collection)&&!/[?#\\\s]/.test(collection),'Use the selected HTTPS collection without credentials, query or fragment.');
 const suffix='/api/dynaway/'+spec.api+'/companies('+company+')/'+(ledger?spec.tail:'workOrders('+order+')/'+spec.tail);
 need(collection.endsWith(suffix),'The native URL does not match the declared kind, company and original order.');
 need(plain(capture.population)&&typeof capture.population.complete==='boolean','Declare original population completeness.');text(capture.population.description,'source population/snapshot basis');
 if(!ledger)need(capture.population.complete===false,'Individual line responses do not establish the complete work-order population.');
 const selection=capture.selection;
 need(plain(selection)&&QUANTITY_FIELDS.includes(selection.quantityField),'Explicitly select quantity, qtyToConsume or qtyConsumed from the original source.');
 if(ledger)need(selection.quantityField==='quantity','Posted ledger quantity comes only from the original quantity field.');
 if(owns(selection,'expenseLineCostField')&&selection.expenseLineCostField!==null){
  need(ledger&&['expenseActualLineCostLCY','expenseExpectedLineCostLCY'].includes(selection.expenseLineCostField),'Only documented posted expense LINE costs may fill cost_amount. Unit costs stay source-only.');
  need(/^[A-Z]{3}$/.test(selection.lcyCode),'Supply the actual company LCY code for the selected LCY amount.');
  text(selection.lcySourceReference,'retained source for the actual company LCY');
 }
 text(selection.actor,'mapping reviewer',200);text(selection.reason,'quantity/cost basis review');
 let companyContext=null,contextFile=null;
 if(selection.expenseLineCostField){
  const context=capture.companyContext;
  need(plain(context)&&context.status===200,'Retain the actual company generalLedgerSetup response for selected LCY costs.');
  const raw=text(context.bodyText,'complete original company setup JSON',LIMITS.supportingBytes),identity=sha256Utf8(raw);
  need(identity.bytes<=LIMITS.supportingBytes,'Original company setup exceeds supporting-file limit.');
  if(context.sha256!==undefined)need(context.sha256===identity.sha256,'Original company setup hash changed.');
  const record=parseOriginalJSON(raw);need(plain(record),'Retain the original single generalLedgerSetup record.');
  const id=guid(record.id,'original general-ledger setup record ID');
  const prefix=collection.slice(0,collection.lastIndexOf('/api/dynaway/'));
  const expected=prefix+'/api/v2.0/companies('+company+')/generalLedgerSetup('+id+')';
  need(context.url===expected,'Company setup URL must retain the same tenant/environment/company and actual setup record ID.');
  need(field(record,'localCurrencyCode')===selection.lcyCode,'Selected LCY differs from the original company generalLedgerSetup.');
  const path='originals/general-ledger-setup.json';contextFile=file(path,'application/json',raw);
  companyContext={url:context.url,status:200,id,localCurrencyCode:selection.lcyCode,sourceReference:path+'#/localCurrencyCode',...identity};
 }
 need(Array.isArray(capture.pages)&&capture.pages.length>0&&capture.pages.length<=LIMITS.supportingFiles-6,'Supply all ordered native pages within original supporting-file limits.');
 const files=contextFile?[contextFile]:[],pages=[],rows=[],findings=[],nativeKeys=new Set(),ids=new Set(),urls=new Set();
 let expected=null,totalBytes=contextFile?.bytes||0;
 for(let pi=0;pi<capture.pages.length;pi++){
  const page=capture.pages[pi];need(plain(page)&&page.status===200,'Retain each complete successful original response.');
  const url=pageURL(page.url,collection,!ledger);need(!urls.has(url),'A captured page URL repeats.');urls.add(url);
  if(pi&&ledger)need(url===expected,'The next page must match the original continuation URL exactly.');
  if(!pi&&capture.population.complete)need(!queryNames(url).some(key=>['$filter','$top','$skip','$skiptoken','$search','$apply'].includes(key)),'A limited/filtered initial request cannot attest the full collection.');
  const raw=text(page.bodyText,'complete original response text',LIMITS.supportingBytes),identity=sha256Utf8(raw);
  totalBytes+=identity.bytes;need(identity.bytes<=LIMITS.supportingBytes&&totalBytes<=LIMITS.workspaceBytes,'Original source bytes exceed workspace limits.');
  if(page.sha256!==undefined)need(page.sha256===identity.sha256,'An original page hash changed.');
  const data=parseOriginalJSON(raw);need(plain(data)&&(ledger?Array.isArray(data.value):typeof data.id==='string'),'Retain the original ledger value array or individual work-order line response.');
  const records=ledger?data.value:[data];
  const next=ledger?(data['@odata.nextLink']??null):null;need(next===null||typeof next==='string'&&next.length>0,'Malformed native nextLink.');if(next!==null)pageURL(next,collection);expected=next;
  const path='originals/page-'+String(pi+1).padStart(4,'0')+'.json';files.push(file(path,'application/json',raw));
  pages.push({path,url,status:200,...identity,rows:records.length,nextLink:next,requestId:page.requestId==null?null:text(page.requestId,'original request ID'),etag:page.etag==null?null:text(page.etag,'original response ETag')});
  for(let ri=0;ri<records.length;ri++){
   const row=records[ri];need(plain(row),'Retain a complete original native record.');
   const id=guid(row.id,'native line or ledger record ID');need(!ids.has(id.toLowerCase()),'Duplicate native record ID in captured population.');ids.add(id.toLowerCase());
   if(!ledger)need(url.split('?')[0].slice(collection.length+1,-1).toLowerCase()===id.toLowerCase(),'The response identity differs from the selected native line URI.');
   const source=path+(ledger?'#/value/'+ri:'#')+';sha256='+identity.sha256;
   let documentId='';
   if(!ledger){documentId=guid(row.documentId,'native document ID');need(documentId.toLowerCase()===order.toLowerCase(),'A returned line belongs to another original work order.');}
   const type=ledger?field(row,'type'):null;
   const kind=ledger?({Resource:'labor',Item:'material',Expense:'expense'}[type]||''):spec.lineKind;
   const out=Object.fromEntries(COST_COLUMNS.map(key=>[key,'']));
   Object.assign(out,{company_id:canonical,work_order_id:documentId,line_id:id,line_kind:kind,native_record_id:id,native_document_id:documentId,source_reference:source,unit_code:field(row,'unitOfMeasureCode')});
   if(ledger){out.fixed_asset_id=field(row,'fixedAssetNo');out.posting_date=field(row,'postingDate');}
   const quantity=row[selection.quantityField];
   if(quantity===undefined||quantity===null)findings.push({native_record_id:id,field:'quantity',status:'MISSING',source_reference:source,reason:'The explicitly selected quantity field is missing.'});
   else out.quantity=exactDecimal(quantity,selection.quantityField);
   if(ledger&&kind==='expense'&&selection.expenseLineCostField){
    const cost=row[selection.expenseLineCostField];
    if(cost!==undefined&&cost!==null){out.cost_amount=exactDecimal(cost,selection.expenseLineCostField);out.currency=selection.lcyCode;out.cost_basis=selection.expenseLineCostField==='expenseActualLineCostLCY'?'actual':'expected';}
   }
   if(!out.work_order_id)findings.push({native_record_id:id,field:'work_order_id',status:'MISSING',source_reference:source,reason:'This documented ledger projection does not establish an original work-order header ID. planNo is a separate identity.'});
   if(!out.cost_amount)findings.push({native_record_id:id,field:'cost_amount',status:'MISSING',source_reference:source,reason:'No selected documented line-cost amount is available. No unit-price multiplication or zero substitution.'});
   if(!kind)findings.push({native_record_id:id,field:'line_kind',status:'UNMAPPED',source_reference:source,reason:'The original ledger type is not one of Resource, Item or Expense.'});
   for(const key of Object.keys(row))nativeKeys.add(key);
   rows.push({out,original:row});need(rows.length<=LIMITS.rows,'Original population exceeds workspace row limit.');
  }
  if(ledger&&pi<capture.pages.length-1)need(next!==null,'Extra captured pages follow a terminal native page.');
 }
 need(expected===null,'A native continuation page has not been received.');
 const keys=[...nativeKeys].sort(),headers=[...COST_COLUMNS,...keys.flatMap(key=>['native:'+key,'native-type:'+key])];
 need(headers.length<=LIMITS.columns,'Complete source fields exceed the existing CSV column limit.');
 const csv=encodeCsv([headers,...rows.map(({out,original})=>[...COST_COLUMNS.map(key=>out[key]),...keys.flatMap(key=>[nativeCell(original[key]),nativeType(original[key])])])]);
 parseCsv(csv); // Apply the original row, field and complete CSV limits before publishing.
 const staging=file('work-order-source.csv','text/csv',csv);need(staging.bytes<=LIMITS.csvBytes,'Complete native staging exceeds the original CSV limit.');files.push(staging);
 files.push(file('source-findings.csv','text/csv',encodeCsv([['native_record_id','field','status','source_reference','reason'],...findings.map(row=>[row.native_record_id,row.field,row.status,row.source_reference,row.reason])])));
 const scope={schema:'tjlabs.business-central-work-order-preparation.v1',kind:capture.kind,tenantId:capture.tenantId,environment:capture.environment,companyId:company,canonicalCompanyId:canonical,workOrderId:order,collectionUrl:collection,observedAt:capture.observedAt,population:clone(capture.population),selection:clone(selection),companyContext,pageChainComplete:ledger?true:null,allSelectedResponsesRetained:true,snapshotConsistency:'Not established by paging; retain the original export/snapshot basis.',rowCount:rows.length,findings,
  canonicalColumns:COST_COLUMNS,nativeColumns:keys.map(key=>({column:'native:'+key,typeColumn:'native-type:'+key,originalField:key,encoding:'Scalar string/boolean or exact original numeric token; complex values remain complete JSON. Type column distinguishes absent, null, string, number, boolean, object and array.'})),
  mappingColumns:Object.fromEntries(COST_COLUMNS.map((key,i)=>[key,i])),sourcePages:pages,
  status:findings.length?'NEEDS_SOURCE_OR_REVIEW':'PREPARED_SOURCE_REQUIRES_EXISTING_WORKSPACE_RECONCILIATION',
  cautions:['Native source ids are not invented target ids.','No historical posting/import capability is inferred from GET or current line APIs.','Expected, actual and unit costs remain different quantities.','Original source, native-field columns, source locations and review survive every exported member.','This source preparation does not establish tenant completeness or financial acceptance.']};
 files.push(file('capture.json','application/json',JSON.stringify(capture,null,2)+'\n'));
 files.push(file('capture-scope.json','application/json',JSON.stringify(scope,null,2)+'\n'));
 const manifest={schema:'tjlabs.business-central-work-order-preparation-manifest.v1',scope,files:files.map(({text,...entry})=>entry)};
 files.push(file('manifest.json','application/json',JSON.stringify(manifest,null,2)+'\n'));
 let retainedBytes=0,minimumBase64Bytes=0;
 for(const member of files){need(member.bytes<=LIMITS.supportingBytes,'Prepared member exceeds the original complete file limit: '+member.path);retainedBytes+=member.bytes;minimumBase64Bytes+=4*Math.ceil(member.bytes/3);}
 need(retainedBytes<=LIMITS.workspaceBytes&&minimumBase64Bytes<=LIMITS.workspaceBytes,'Prepared complete source exceeds the original portable workspace budget; select a smaller complete scope.');
 return {scope,files};
}
