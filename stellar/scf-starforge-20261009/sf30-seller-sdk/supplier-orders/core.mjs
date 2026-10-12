// MIT. Supplier order document review, current revisions and exact fulfilment.
import { clone, digest as nativeDigest, WorkspaceError } from '../opensearch/workspace/store.mjs';
import { exact, add, subtract, multiply, divide, compare, absolute, maximum, ZERO, sum,
  exactText, exactValue, lineValue, moneyMatches, rounded } from './numbers.mjs';

export const PROFILE_ID='unite-opentrans-1.0';
export const DOCUMENT_SCHEMA='stellar-forge.supplier-order-document.v1';
export const ORDER_SCHEMA='stellar-forge.supplier-order.v1';
export const DRAFT_SCHEMA='stellar-forge.supplier-order-draft.v1';
export const KINDS=Object.freeze(['ORDER','ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE']);
export const RULES=Object.freeze({
  overview:'https://support.unite.eu/en-gb/for-suppliers/edi-interfaces-for-order-processing',
  ORDER:'https://support.unite.eu/en-gb/for-suppliers/order-transmission-interface',
  ORDERRESPONSE:'https://support.unite.eu/en-gb/for-suppliers/order-confirmation-interface',
  DISPATCHNOTIFICATION:'https://support.unite.eu/en-gb/for-suppliers/dispatch-notification-interface',
  INVOICE:'https://support.unite.eu/en-gb/for-suppliers/invoice-interface',
  standard:'https://unite.eu/assets/support/uk/specification_opentrans_v1_0_en-2.pdf'
});
export const fail=(code,message,status=422,details)=>{const e=new WorkspaceError(code,message,status);if(details)e.details=details;throw e;};
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function text(value,label,max=512){
  if(typeof value!=='string'||!value.trim()||value.includes('\0')||[...value].length>max)
    fail('ORDER_TEXT_INVALID',label+' must contain 1–'+max+' characters.');
  return value;
}
export function orderId(value){return text(value,'Unite order number',21);}
export function data(value,depth=0){
  if(depth>512)fail('ORDER_DATA_TOO_DEEP','Document data exceeds 512 JSON levels.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('ORDER_DATA_INVALID','Use finite JSON values.');return value;}
  if(Array.isArray(value)){for(const item of value)data(item,depth+1);return value;}
  if(object(value)){for(const [key,item] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))fail('ORDER_DATA_INVALID','Unsupported document field.');data(item,depth+1);}return value;}
  fail('ORDER_DATA_INVALID','Use complete JSON document data without undefined values.');
}
// XML's original AST may be deeper than the query workspace's 64-level JSON limit.
export function canonical(value,depth=0){
  if(depth>512)fail('ORDER_DATA_TOO_DEEP','Document data exceeds 512 JSON levels.');
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(item=>canonical(item,depth+1)).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',')+'}';
}
export const digest=value=>nativeDigest(typeof value==='string'?value:canonical(value));

export function normalizedDocument(value){
  data(value);
  if(!object(value)||value.schema!==DOCUMENT_SCHEMA||value.profileId!==PROFILE_ID||value.version!=='1.0'||!KINDS.includes(value.kind))
    fail('ORDER_DOCUMENT_PROFILE_INVALID','Use an original openTRANS 1.0 document with the Unite supplier profile.');
  text(value.documentId,'Document number',250);
  if(!object(value.header)||!Array.isArray(value.items)||!value.items.length||value.items.length>100000)
    fail('ORDER_DOCUMENT_ITEMS_REQUIRED','Supply the complete header and between one and 100,000 item lines.');
  if(!object(value.summary))fail('ORDER_DOCUMENT_SUMMARY_REQUIRED','Retain the original document summary.');
  if(['ORDER','ORDERRESPONSE'].includes(value.kind))orderId(value.orderId);
  return clone(value);
}
export function referencedOrders(document){
  if(['ORDER','ORDERRESPONSE'].includes(document.kind))return [orderId(document.orderId)];
  return [...new Set(document.items.map(item=>item.orderReference?.orderId).filter(value=>typeof value==='string'&&value))].sort();
}
export function businessKey(document){return canonical([document.kind,document.documentId]);}
export function sourceDocumentId(document,sourceSha256){return digest([PROFILE_ID,businessKey(document),sourceSha256]);}
export function lineReference(document,item){
  return ['ORDER','ORDERRESPONSE'].includes(document.kind)
    ?{orderId:document.orderId,lineId:item.orderReference?.lineId??item.lineId}
    :item.orderReference??{orderId:null,lineId:null};
}
export function issue(code,path,message,kind,severity='error',details){
  return{code,path,message,severity,rule:{url:RULES[kind]??RULES.overview},...(details?{details}: {})};
}
function numeric(findings,value,path,label,kind,{positive=false,nonnegative=false}={}){
  try{const q=exact(value,label);if(positive&&compare(q,ZERO)<=0||nonnegative&&compare(q,ZERO)<0)throw new Error(label+(positive?' must be greater than zero.':' must not be negative.'));return q;}
  catch(e){findings.push(issue('NUMBER_INVALID',path,e.message,kind));return null;}
}
function required(findings,value,path,label,kind,max=512){
  try{text(value,label,max);return true;}catch(e){findings.push(issue('FIELD_REQUIRED',path,e.message,kind));return false;}
}
function effectiveCurrency(document,item){return item?.price?.currency??document.header?.currency??null;}
function taxAmount(value,tax,policy){const result=multiply(value,tax);return policy&&(policy.taxBasis??'line')==='line'?rounded(result,policy):result;}
function samePrice(left,right){
  if(!left||!right)return left===right;
  try{return compare(divide(left.amount,left.quantity??'1'),divide(right.amount,right.quantity??'1'))===0;}
  catch{return false;}
}
export function reviewDocument(document,{orders=[],roundingPolicy=null,forOutput=false}={}){
  const findings=[],kind=document.kind, seen=new Set(), refs=new Map(orders.map(order=>[order.orderId,order]));
  required(findings,document.documentId,'/documentId','Document number',kind,250);
  if(['ORDER','ORDERRESPONSE'].includes(kind))required(findings,document.orderId,'/orderId','Unite order number',kind,21);
  if(!document.items?.length)findings.push(issue('ITEMS_REQUIRED','/items','Include at least one complete item line.',kind));
  let calculatedNet=ZERO,calculatedTax=ZERO,netKnown=true,taxKnown=true;
  for(let index=0;index<(document.items??[]).length;index++){
    const item=document.items[index],path='/items/'+index;
    required(findings,item.lineId,path+'/lineId','Line item number',kind,250);
    if(seen.has(item.lineId))findings.push(issue('DUPLICATE_LINE',path+'/lineId','This document repeats the same line item number.',kind));
    seen.add(item.lineId);
    required(findings,item.article?.supplierId,path+'/article/supplierId','Supplier article number',kind,250);
    required(findings,item.unit,path+'/unit','Order unit',kind,32);
    if(item.supplierId&&document.header.supplierId&&item.supplierId!==document.header.supplierId)findings.push(issue('ITEM_SUPPLIER_DIFFERS',path+'/supplierId','The item supplier differs from the document supplier.',kind));
    const quantity=numeric(findings,item.quantity,path+'/quantity','Quantity',kind,{nonnegative:kind!=='ORDERRESPONSE'});
    let value=null;
    if(item.price){
      if(!effectiveCurrency(document,item))findings.push(issue('PRICE_CURRENCY_REQUIRED',path+'/price/currency','Give the effective currency for this price in the item or header.',kind));
      if(item.price.currency&&document.header.currency&&item.price.currency!==document.header.currency)findings.push(issue('DOCUMENT_CURRENCY_DIFFERS',path+'/price/currency','The item currency differs from the document header currency.',kind));
      const amount=numeric(findings,item.price.amount,path+'/price/amount','Net price',kind);
      const priceQuantity=numeric(findings,item.price.quantity??'1',path+'/price/quantity','Price quantity',kind,{positive:true});
      const declaredLine=item.price.lineAmount==null?null:numeric(findings,item.price.lineAmount,path+'/price/lineAmount','Net line amount',kind);
      if(amount&&priceQuantity&&quantity){
        value=divide(multiply(amount,quantity),priceQuantity);
        if(item.price.lineAmount!=null){
          const declared=declaredLine;
          if(declared&&!moneyMatches(value,declared,roundingPolicy))findings.push(issue('LINE_AMOUNT_DIFFERS',path+'/price/lineAmount','The declared net line amount differs from price × quantity ÷ price quantity.',kind,'error',{calculated:exactValue(value),declared:item.price.lineAmount,roundingPolicy}));
        }else if(kind==='INVOICE')findings.push(issue('LINE_AMOUNT_REQUIRED',path+'/price/lineAmount','The invoice needs its explicit net line amount.',kind));
        if(item.price.lineAmount==null||declaredLine)calculatedNet=add(calculatedNet,declaredLine??value);else netKnown=false;
      }else netKnown=false;
      if(item.price.tax!=null){
        const tax=numeric(findings,item.price.tax,path+'/price/tax','Tax fraction',kind,{nonnegative:true});
        if(tax&&value&&(item.price.lineAmount==null||declaredLine))calculatedTax=add(calculatedTax,taxAmount(declaredLine??value,tax,roundingPolicy));
        else taxKnown=false;
      }else {taxKnown=false;if(kind==='INVOICE')findings.push(issue('TAX_REQUIRED',path+'/price/tax','The invoice needs the applicable fractional tax rate.',kind));}
    }else{netKnown=false;taxKnown=false;if(kind==='INVOICE')findings.push(issue('PRICE_REQUIRED',path+'/price','The invoice needs its original or explicitly revised price.',kind));}
    if(['DISPATCHNOTIFICATION','INVOICE'].includes(kind)){
      required(findings,item.orderReference?.orderId,path+'/orderReference/orderId','Original Unite order number',kind,21);
      required(findings,item.orderReference?.lineId,path+'/orderReference/lineId','Original order line number',kind,250);
    }
    const reference=lineReference(document,item),selected=refs.get(reference.orderId);
    if(selected){
      const originals=selected.document?.document?.items??selected.document?.items??selected.original?.items??selected.items;
      const original=originals?.find(line=>line.lineId===reference.lineId);
      if(!original)findings.push(issue('ORDER_LINE_NOT_FOUND',path+'/orderReference','The referenced line is absent from the selected original order.',kind,'error',{orderId:reference.orderId,lineId:reference.lineId}));
      else{
        if(original.article?.supplierId!==item.article?.supplierId)findings.push(issue('ARTICLE_REFERENCE_DIFFERS',path+'/article/supplierId','Use the supplier article number from the referenced original order line.',kind));
        if(original.unit!==item.unit)findings.push(issue('ORDER_UNIT_DIFFERS',path+'/unit','The order unit differs from the original line. Record an agreed conversion explicitly before creating this document.',kind));
        const originalQuantity=numericOrNull(original.quantity);
        if(kind==='ORDERRESPONSE'&&quantity&&!originalQuantity)findings.push(issue('ORIGINAL_QUANTITY_INVALID',path+'/quantity','Review the invalid quantity in the referenced original order before comparing this confirmation.',kind));
        if(kind==='ORDERRESPONSE'&&quantity&&originalQuantity&&compare(absolute(quantity),originalQuantity)>0)findings.push(issue('CONFIRMATION_EXCEEDS_ORDER',path+'/quantity','The confirmed or cancelled quantity exceeds the original ordered quantity.',kind));
        const originalDocument=selected.document?.document??selected.document??selected.original??{};
        if(item.supplierId&&originalDocument.header?.supplierId&&item.supplierId!==originalDocument.header.supplierId)findings.push(issue('SOURCE_SUPPLIER_DIFFERS',path+'/supplierId','The item supplier differs from the referenced original order supplier.',kind));
        const originalCurrency=effectiveCurrency(originalDocument,original),currentCurrency=effectiveCurrency(document,item);
        if(currentCurrency&&originalCurrency&&currentCurrency!==originalCurrency)findings.push(issue('SOURCE_CURRENCY_DIFFERS',path+'/price/currency','The effective currency differs from the referenced original order line.',kind,'error',{originalCurrency,currentCurrency}));
        const confirmedLine=selected.items?.find(line=>line.lineId===reference.lineId);
        const confirmedCurrency=confirmedLine?.confirmedPrice?.currency??originalCurrency;
        if(kind==='INVOICE'&&currentCurrency&&confirmedCurrency&&currentCurrency!==confirmedCurrency)findings.push(issue('CONFIRMATION_CURRENCY_DIFFERS',path+'/price/currency','The effective invoice currency differs from the selected confirmation.',kind));
        if(kind==='INVOICE'&&item.price&&original.price&&!samePrice(item.price,original.price))
          findings.push(issue('PRICE_CHANGED',path+'/price','The invoice price differs from the original order. Review the selected confirmation and commercial agreement.',kind,'warning'));
      }
    }else if(kind!=='ORDER'&&refs.size)findings.push(issue('ORDER_NOT_FOUND',path+'/orderReference','The original referenced order is not in this workspace selection.',kind));
    if(kind==='ORDERRESPONSE'&&quantity&&compare(quantity,ZERO)>=0&&!item.deliveryDate&&!document.header.deliveryDate&&forOutput)
      findings.push(issue('DELIVERABILITY_DATE_REQUIRED',path+'/deliveryDate','Give the expected delivery period when it is known for this confirmation.',kind,'warning'));
    if(kind==='DISPATCHNOTIFICATION'&&!(item.packages?.length||document.header.packages?.length))
      findings.push(issue('PACKAGE_REFERENCE_REQUIRED',path+'/packages','Include the parcel or Track & Trace number when it is available for this dispatched line.',kind,'warning'));
  }
  if(document.summary?.totalItems!=null){
    const count=numeric(findings,document.summary.totalItems,'/summary/totalItems','Total item count',kind,{nonnegative:true});
    if(count&&compare(count,String(document.items.length))!==0)findings.push(issue('ITEM_COUNT_DIFFERS','/summary/totalItems','The summary count differs from the complete document line count.',kind));
  }else if(forOutput)findings.push(issue('ITEM_COUNT_REQUIRED','/summary/totalItems','The complete document requires its total line count.',kind));
  if(document.summary?.totalAmount!=null&&netKnown){
    const declared=numeric(findings,document.summary.totalAmount,'/summary/totalAmount','Total net amount',kind);
    if(declared&&!moneyMatches(calculatedNet,declared,roundingPolicy))findings.push(issue('NET_TOTAL_DIFFERS','/summary/totalAmount','The summary net amount differs from the sum of the complete line amounts.',kind,'error',{calculated:exactValue(calculatedNet),declared:document.summary.totalAmount,roundingPolicy}));
  }
  if(document.summary?.totalTaxAmount!=null&&taxKnown){
    const declared=numeric(findings,document.summary.totalTaxAmount,'/summary/totalTaxAmount','Total tax amount',kind);
    if(declared&&!moneyMatches(calculatedTax,declared,roundingPolicy))findings.push(issue('TAX_TOTAL_DIFFERS','/summary/totalTaxAmount','The stated total tax differs from the complete line tax calculation.',kind,'warning',{calculated:exactValue(calculatedTax),declared:document.summary.totalTaxAmount,roundingPolicy}));
  }
  if(kind==='INVOICE'&&forOutput){
    required(findings,document.header.currency,'/header/currency','Invoice currency',kind,3);
    required(findings,document.header.date,'/header/date','Invoice date',kind,64);
    if(!document.header.deliveryDate&&!document.items.every(item=>item.deliveryDate||item.deliveryReferences?.length))
      findings.push(issue('DELIVERY_DATE_REQUIRED','/header/deliveryDate','Give the service or delivery date in the invoice header or each item.',kind));
    for(const name of ['buyer','supplier','invoice'])if(!document.header.parties?.[name])
      findings.push(issue('PARTY_REQUIRED','/header/parties/'+name,'Retain the original '+name+' party and its required company details.',kind));
    if(document.summary?.totalAmount==null)findings.push(issue('NET_TOTAL_REQUIRED','/summary/totalAmount','The invoice requires its total net amount.',kind));
    if(document.summary?.totalTaxAmount==null)findings.push(issue('TAX_TOTAL_REQUIRED','/summary/totalTaxAmount','The invoice requires its total tax amount.',kind));
  }
  return{schema:'stellar-forge.supplier-order-review.v1',profileId:PROFILE_ID,findings,
    errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length,
    net:netKnown?exactValue(calculatedNet):null,tax:taxKnown?exactValue(calculatedTax):null};
}
const numericOrNull=value=>{try{return exact(value);}catch{return null;}};
function documentRecord(record){return record.document??record;}
function docRef(record,item){return{id:record.id,kind:documentRecord(record).kind,documentId:documentRecord(record).documentId,revision:record.revision,lineId:item.lineId,sourcePath:item.sourcePath??null};}
// Recompute business review against today's original and confirmation selections.
// Native findings stay attached to their original XML path; replaced item lines
// do not keep an obsolete confirmation error active in another line.
function currentDocumentFindings(record,activeIndexes,order){
  const doc=documentRecord(record),active=new Set(activeIndexes);
  const findings=[...(Array.isArray(doc.findings)?doc.findings:[]),...reviewDocument(doc,{orders:[order]}).findings];
  const kept=[],seen=new Set();
  for(const finding of findings){
    const path=typeof finding.path==='string'?finding.path:'/';
    const jsonItem=/^\/items\/(\d+)(?:\/|$)/.exec(path);
    let index=jsonItem?Number(jsonItem[1]):null;
    if(index===null){
      const originalIndex=doc.items.findIndex(item=>item.sourcePath&&(path===item.sourcePath||path.startsWith(item.sourcePath+'/')));
      if(originalIndex>=0)index=originalIndex;
    }
    if(index!==null&&!active.has(index))continue;
    const item=index===null?null:doc.items[index],reference=item?lineReference(doc,item):null;
    const key=canonical([finding.code,path,finding.severity]);if(seen.has(key))continue;seen.add(key);
    kept.push({...clone(finding),path:'/documents/'+record.id+path,
      document:{id:record.id,kind:doc.kind,documentId:doc.documentId,revision:record.revision},
      sourcePath:path.startsWith('/'+doc.kind)?path:item?.sourcePath??null,
      orderLineId:reference?.lineId??null,documentLineId:item?.lineId??null});
  }
  return kept;
}
export function projectOrder(originalRecord,selectionRecords=[],{revision=1,history=[]}={}){
  const original=documentRecord(originalRecord), id=orderId(original.orderId);
  const confirmations=new Map(),currentDocuments=new Map(),sourceFindings=[];
  for(const record of selectionRecords){
    const doc=documentRecord(record);if(doc.kind==='ORDER')continue;
    if(doc.kind==='ORDERRESPONSE'){
      if(doc.orderId!==id)continue;
      for(const item of doc.items){const ref=lineReference(doc,item);confirmations.set(ref.lineId,{record,item});}
    }else currentDocuments.set(businessKey(doc),record);
  }
  const lines=original.items.map(item=>{
    const q=numericOrNull(item.quantity),confirmation=confirmations.get(item.lineId);
    const compatibleConfirmation=confirmation&&confirmation.item.unit===item.unit&&confirmation.item.article?.supplierId===item.article?.supplierId;
    const cq=compatibleConfirmation?numericOrNull(confirmation.item.quantity):null;
    const cancelled=cq&&compare(cq,ZERO)<0?absolute(cq):ZERO;
    const confirmed=cq&&compare(cq,ZERO)>=0?cq:null;
    const dispatches=[],invoices=[];let dispatched=ZERO,invoiced=ZERO;
    const packages=[],serials=[],referenceFindings=[];
    for(const record of currentDocuments.values()){
      const doc=documentRecord(record);
      for(const line of doc.items){
        const ref=lineReference(doc,line);if(ref.orderId!==id||ref.lineId!==item.lineId)continue;
        const compatible=line.unit===item.unit&&line.article?.supplierId===item.article?.supplierId;
        const quantity=compatible?numericOrNull(line.quantity):null,entry={...docRef(record,line),quantity:line.quantity,unit:line.unit,
          deliveryDate:clone(line.deliveryDate??doc.header.deliveryDate??null),deliveryReferences:clone(line.deliveryReferences??[]),date:doc.header.date??null};
        if(!compatible)referenceFindings.push(issue('ORDER_LINE_REFERENCE_DIFFERS','/documents/'+record.id+'/items/'+line.lineId,'The selected document article or unit differs from the original order line; its quantity is excluded from this unit total.',doc.kind));
        if(doc.kind==='DISPATCHNOTIFICATION'){dispatches.push(entry);if(quantity)dispatched=add(dispatched,quantity);}
        if(doc.kind==='INVOICE'){invoices.push(entry);if(quantity)invoiced=add(invoiced,quantity);}
        for(const parcel of line.packages?.length?line.packages:doc.header.packages??[])packages.push({...clone(parcel),documentId:record.id,lineId:line.lineId});
        for(const serial of line.serials??[])serials.push({value:serial,documentId:record.id,lineId:line.lineId});
      }
    }
    const findings=[...referenceFindings];
    if(confirmation&&(confirmation.item.unit!==item.unit||confirmation.item.article?.supplierId!==item.article?.supplierId))findings.push(issue('CONFIRMATION_REFERENCE_DIFFERS','/items/'+item.lineId,'The selected confirmation article or unit differs from the original order line.','ORDERRESPONSE'));
    if(!q)findings.push(issue('ORDER_QUANTITY_INVALID','/items/'+item.lineId+'/quantity','The original ordered quantity needs review.','ORDER'));
    const available=q?subtract(q,cancelled):ZERO;
    if(compare(cancelled,q??ZERO)>0)findings.push(issue('CANCELLATION_EXCEEDS_ORDER','/items/'+item.lineId,'The current cancellation exceeds the ordered quantity.','ORDERRESPONSE'));
    if(confirmed&&compare(confirmed,available)>0)findings.push(issue('CONFIRMATION_EXCEEDS_ORDER','/items/'+item.lineId,'The current confirmation exceeds the uncancelled order quantity.','ORDERRESPONSE'));
    if(compare(dispatched,available)>0)findings.push(issue('DISPATCH_EXCEEDS_ORDER','/items/'+item.lineId,'The current dispatch documents exceed the uncancelled order quantity.','DISPATCHNOTIFICATION'));
    if(compare(invoiced,available)>0)findings.push(issue('INVOICE_EXCEEDS_ORDER','/items/'+item.lineId,'The current invoices exceed the uncancelled order quantity.','INVOICE'));
    if(compare(invoiced,dispatched)>0)findings.push(issue('INVOICE_BEFORE_DISPATCH','/items/'+item.lineId,'Invoiced quantity exceeds the quantity recorded in dispatch documents.','INVOICE','warning'));
    let status='AWAITING_CONFIRMATION';
    if(q&&compare(cancelled,q)===0)status='CANCELLED';
    else if(q&&compare(invoiced,available)===0&&compare(dispatched,available)===0&&compare(available,ZERO)>0)status='DOCUMENTS_COMPLETE';
    else if(compare(dispatched,ZERO)>0)status='PARTIALLY_DISPATCHED';
    else if(confirmed&&compare(confirmed,ZERO)>0)status='CONFIRMED';
    else if(compare(cancelled,ZERO)>0)status='PARTIALLY_CANCELLED';
    if(findings.some(f=>f.severity==='error'))status='REVIEW';
    return{lineId:item.lineId,article:clone(item.article),unit:item.unit,ordered:item.quantity,
      reportedConfirmation:confirmation?.item.quantity??null,confirmed:confirmed?exactText(confirmed):null,
      cancelled:exactText(cancelled),dispatched:exactText(dispatched),invoiced:exactText(invoiced),
      remainingToConfirm:exactText(maximum(ZERO,subtract(available,confirmed??ZERO))),
      remainingToDispatch:exactText(maximum(ZERO,subtract(available,dispatched))),
      remainingToInvoice:exactText(maximum(ZERO,subtract(available,invoiced))),
      price:clone(item.price??null),confirmedPrice:clone((compatibleConfirmation?confirmation.item.price:null)??item.price??null),
      deliveryDate:clone((compatibleConfirmation?(confirmation.item.deliveryDate??confirmation.record.document?.header.deliveryDate):null)??item.deliveryDate??original.header.deliveryDate??null),
      documents:{confirmation:confirmation?docRef(confirmation.record,confirmation.item):null,dispatches,invoices},
      packages,serials,status,findings};
  });
  for(const record of currentDocuments.values()){
    const doc=documentRecord(record);
    for(const item of doc.items){const ref=lineReference(doc,item);if(ref.orderId===id&&!original.items.some(line=>line.lineId===ref.lineId))
      sourceFindings.push(issue('ORDER_LINE_NOT_FOUND','/documents/'+record.id+'/items/'+item.lineId,'A selected document refers to a line absent from the current original order.',doc.kind));}
  }
  const effectiveRecords=[...new Map([...confirmations.values()].map(value=>value.record).concat([...currentDocuments.values()]).map(record=>[record.id,record])).values()];
  for(const record of effectiveRecords){
    const doc=documentRecord(record),activeIndexes=[];
    for(let index=0;index<doc.items.length;index++){
      const item=doc.items[index],ref=lineReference(doc,item);
      if(ref.orderId!==id)continue;
      if(doc.kind!=='ORDERRESPONSE'||confirmations.get(ref.lineId)?.record.id===record.id)activeIndexes.push(index);
    }
    if(!activeIndexes.length)continue;
    const selectedFindings=currentDocumentFindings(record,activeIndexes,{orderId:id,document:originalRecord,items:lines});
    for(const finding of selectedFindings){
      sourceFindings.push(finding);
      const line=finding.orderLineId?lines.find(item=>item.lineId===finding.orderLineId):null;
      if(line){line.findings.push(finding);if(finding.severity==='error')line.status='REVIEW';}
    }
  }
  const review=reviewDocument(original),unique=new Map();
  for(const finding of [...(Array.isArray(original.findings)?original.findings:[]),...review.findings,...sourceFindings,...lines.flatMap(line=>line.findings)])
    unique.set(canonical([finding.code,finding.path,finding.severity]),finding);
  const findings=[...unique.values()];
  const status=findings.some(f=>f.severity==='error')?'REVIEW':lines.every(line=>['DOCUMENTS_COMPLETE','CANCELLED'].includes(line.status))?'COMPLETE':lines.every(line=>line.status==='AWAITING_CONFIRMATION')?'AWAITING_CONFIRMATION':'IN_PROGRESS';
  return{schema:ORDER_SCHEMA,orderId:id,revision,document:clone(originalRecord),header:clone(original.header),items:lines,status,findings,
    totals:{currency:original.header.currency??null,net:review.net},history:clone(history),
    selectedDocuments:effectiveRecords.map(record=>({
      id:record.id,kind:documentRecord(record).kind,documentId:documentRecord(record).documentId,revision:record.revision,source:record.source??documentRecord(record).source??null}))};
}
// A complete dispatch reference may be invoiced over several separate invoices.
// Unallocated older invoices keep the remaining line unassigned for operator selection.
function invoicePortions(state){
  const remaining=numericOrNull(state.remainingToInvoice)??ZERO;
  const prior=state.documents?.invoices??[],dispatches=state.documents?.dispatches??[];
  if(!dispatches.length||prior.some(line=>line.deliveryReferences?.length!==1))
    return[{quantity:exactText(remaining),reference:null}];
  const billed=new Map();
  for(const line of prior){
    const ref=line.deliveryReferences[0],key=canonical([ref.documentId,ref.lineId]),quantity=numericOrNull(line.quantity);
    if(!quantity)return[{quantity:exactText(remaining),reference:null}];
    billed.set(key,add(billed.get(key)??ZERO,quantity));
  }
  let balance=remaining;const output=[];
  for(const line of dispatches){
    const quantity=numericOrNull(line.quantity);if(!quantity)continue;
    const key=canonical([line.documentId,line.lineId]),unbilled=maximum(ZERO,subtract(quantity,billed.get(key)??ZERO));
    const take=compare(unbilled,balance)<0?unbilled:balance;if(compare(take,ZERO)<=0)continue;
    output.push({quantity:exactText(take),reference:{documentId:line.documentId,lineId:line.lineId,date:clone(line.deliveryDate??null)}});
    balance=subtract(balance,take);
  }
  if(compare(balance,ZERO)>0)output.push({quantity:exactText(balance),reference:null});
  return output.length?output:[{quantity:exactText(remaining),reference:null}];
}

export function createDocumentDraft(kind,orders,{date=new Date().toISOString(),documentId=null,roundingPolicy=null}={}){
  if(!['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE'].includes(kind))fail('ORDER_DRAFT_KIND_INVALID','Choose a confirmation, dispatch notification or invoice.');
  if(!Array.isArray(orders)||!orders.length)fail('ORDER_DRAFT_ORDERS_REQUIRED','Select at least one complete original order.');
  if(kind==='ORDERRESPONSE'&&orders.length!==1)fail('ORDER_CONFIRMATION_ONE_ORDER','One confirmation refers to one original order.');
  const source=orders[0].document.document??orders[0].document, header=clone(source.header),items=[];
  const sharedRoles=kind==='INVOICE'?['buyer','supplier','invoice']:['buyer','supplier','delivery','finalDelivery','transport'];
  const sameParties=header=>Object.fromEntries(sharedRoles.map(role=>[role,header.parties?.[role]??null]));
  if(orders.some(order=>canonical(sameParties((order.document.document??order.document).header))!==canonical(sameParties(source.header))))
    fail('ORDER_DRAFT_PARTIES_DIFFER','The selected orders have different parties required by this document kind. Create separate documents for these commercial or delivery parties.');
  if(orders.some(order=>(order.document.document??order.document).header.currency!==source.header.currency))
    fail('ORDER_DRAFT_CURRENCIES_DIFFER','Create separate documents for different source currencies.');
  header.date=date;header.packages=[];header.remarks=[];
  if(kind==='DISPATCHNOTIFICATION')header.deliveryDate=null;
  if(kind==='INVOICE'){header.deliveryDate=null;header.parties=Object.fromEntries(['buyer','supplier','invoice'].map(role=>[role,clone(source.header.parties?.[role]??null)]));}
  for(const order of orders){
    const original=order.document.document??order.document;
    for(const item of original.items){
      const state=order.items.find(line=>line.lineId===item.lineId);
      const quantity=kind==='ORDERRESPONSE'?item.quantity:kind==='DISPATCHNOTIFICATION'?state.remainingToDispatch:state.remainingToInvoice;
      if(kind!=='ORDERRESPONSE'&&compare(quantity,ZERO)<=0)continue;
      const line=clone(item);line.lineId=kind==='ORDERRESPONSE'?item.lineId:String(items.length+1);line.quantity=quantity;
      line.orderReference=kind==='ORDERRESPONSE'?null:{orderId:order.orderId,lineId:item.lineId,date:original.header.date??null};
      line.packages=[];line.serials=[];line.remarks=[];line.deliveryReferences=[];
      if(kind==='DISPATCHNOTIFICATION')line.deliveryDate=clone(item.deliveryDate??original.header.deliveryDate??null);
      if(kind==='INVOICE'){line.parties={};line.supplierId=null;line.deliveryDate=null;}
      if(kind==='ORDERRESPONSE')line.price=null;
      else if(kind==='DISPATCHNOTIFICATION')line.price=null;
      else{
        line.price=clone(state.confirmedPrice??item.price??null);
        if(line.price)line.price.taxAmount=null;
        if(line.price){try{const value=lineValue(line);line.price.lineAmount=value?exactText(roundingPolicy?rounded(value,roundingPolicy):value):null;
          if(line.price.lineAmount?.includes('/'))line.price.lineAmount=null;}catch{line.price.lineAmount=null;}}
      }
      line.sourcePath=null;line.sourceOrderDocumentId=order.document.id;
      if(kind==='INVOICE'){
        const portions=invoicePortions(state);
        for(const portion of portions){
          const selected=clone(line);selected.lineId=String(items.length+1);selected.quantity=portion.quantity;selected.deliveryReferences=portion.reference?[portion.reference]:[];
          if(selected.price){try{const value=lineValue(selected);selected.price.lineAmount=value?exactText(roundingPolicy?rounded(value,roundingPolicy):value):null;
            if(selected.price.lineAmount?.includes('/'))selected.price.lineAmount=null;}catch{selected.price.lineAmount=null;}}
          items.push(selected);
        }
      }else items.push(line);
    }
  }
  const document={schema:DOCUMENT_SCHEMA,profileId:PROFILE_ID,kind,version:'1.0',
    documentId:kind==='ORDERRESPONSE'?source.orderId:documentId??'',
    orderId:kind==='ORDERRESPONSE'?source.orderId:null,header,items,summary:{totalItems:String(items.length)},
    raw:null,source:{kind:'supplier-draft',orders:orders.map(order=>({orderId:order.orderId,revision:order.revision,documentId:order.document.id,sha256:order.document.sha256}))}};
  if(kind==='INVOICE'&&items.every(item=>item.price?.lineAmount!=null)){
    document.summary.totalAmount=exactText(sum(items.map(item=>item.price.lineAmount)));
    if(items.every(item=>item.price?.tax!=null)){
      const taxes=items.map(item=>taxAmount(item.price.lineAmount,item.price.tax,roundingPolicy));
      const total=sum(taxes);document.summary.totalTaxAmount=exactText(roundingPolicy&&(roundingPolicy.taxBasis??'line')==='document'?rounded(total,roundingPolicy):total);
    }
  }
  return{schema:DRAFT_SCHEMA,kind,orderIds:orders.map(order=>order.orderId),sourceOrderDocuments:orders.map(order=>({orderId:order.orderId,id:order.document.id,sha256:order.document.sha256})),orderRevisions:Object.fromEntries(orders.map(order=>[order.orderId,order.revision])),orderStateSha256:Object.fromEntries(orders.map(order=>[order.orderId,order.stateSha256??null])),document,
    roundingPolicy,review:reviewDocument(document,{orders,roundingPolicy,forOutput:true})};
}
