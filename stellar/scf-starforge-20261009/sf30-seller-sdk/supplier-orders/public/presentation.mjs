// MIT. Shared presentation for the supplier-order workspace. Source values stay intact.
const STATUS = Object.freeze({
  ORDER:'Order', ORDERRESPONSE:'Confirmation', DISPATCHNOTIFICATION:'Dispatch', INVOICE:'Invoice',
  AWAITING_CONFIRMATION:'Awaiting confirmation', IN_PROGRESS:'In progress', REVIEW:'Review required',
  COMPLETE:'Complete', DOCUMENTS_COMPLETE:'Documents complete', CANCELLED:'Cancelled',
  READY:'Ready to send', SENDING:'Sending', ACKNOWLEDGED:'HTTPS acknowledged',
  UNKNOWN:'Delivery outcome unknown', REJECTED:'Rejected', NOT_ACCEPTED:'Confirmed not accepted',
  RECEIVING:'Receiving', RECEIVED:'Received', FAILED:'Failed', INTERRUPTED:'Interrupted',
  NOT_REPORTED:'Awaiting recipient report', RETAINED:'Retained in workspace',
  incoming:'Incoming', outgoing:'Outgoing', test:'Test', live:'Live',
  source:'Receive document', 'draft-save':'Save draft', 'draft-prepare':'Prepare XML',
  'document-select':'Select document revision', 'profile-select':'Select customer profile',
  'package-inspect':'Inspect customer package', 'package-import':'Receive customer package',
  'package-export':'Export customer package', 'transport-prepare':'Prepare delivery',
  'transport-send':'Send document', 'transport-retry':'Prepare another delivery attempt',
  'transport-resolve':'Record provider result', 'transport-cancel':'Cancel delivery'
});
const FIELD = Object.freeze({
  supplierId:'Supplier account', supplierIdentity:'Supplier identity', documentId:'Document',
  orderId:'Order', lineId:'Line', finalDelivery:'Final delivery', invoice:'Invoice recipient',
  amount:'Price amount', quantity:'Quantity', lineAmount:'Line amount', tax:'Tax fraction',
  taxAmount:'Tax amount', priceQuantity:'Price quantity', supplierOrderId:'Supplier order reference',
  PARTY_ID:'Party ID', SUPPLIER_AID:'Supplier article ID', BUYER_AID:'Buyer article ID',
  NAME:'Name', NAME2:'Additional name', NAME3:'Additional name', STREET:'Street',
  ZIP:'Postcode', CITY:'City', COUNTRY:'Country', CONTACT:'Contact', EMAIL:'Email',
  VAT_ID:'VAT ID', PHONE:'Phone', FAX:'Fax', ADDRESS:'Address', URL:'URL',
  sourcePath:'Source location', attributes:'Attributes', extensions:'Extension fields',
  deliveryReferences:'Delivery references', deliveryDate:'Delivery period', buyerIds:'Buyer article IDs'
});
const dateOnly=/^\d{4}-\d{2}-\d{2}$/;
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
export function label(value){
  if(value===null||value===undefined||value==='')return 'Not supplied';
  const text=String(value);
  if(Object.hasOwn(STATUS,text))return STATUS[text];
  if(Object.hasOwn(FIELD,text))return FIELD[text];
  const words=text.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').toLowerCase();
  return words.charAt(0).toUpperCase()+words.slice(1).replace(/\b(id|ids|url|xml|edi|api|vat|https)\b/g,v=>v.toUpperCase());
}
export function dateText(value){
  if(value===null||value===undefined||value==='')return '';
  const text=String(value),onlyDate=dateOnly.test(text);
  if(!onlyDate&&!timestamp.test(text))return text;
  const parsed=new Date(onlyDate?text+'T00:00:00Z':text);
  if(!Number.isFinite(parsed.getTime())||onlyDate&&parsed.toISOString().slice(0,10)!==text)return text;
  const day=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(parsed);
  if(onlyDate)return day;
  return day+', '+new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(parsed)+' UTC';
}
export function element(tag,text,className){
  const node=document.createElement(tag);
  if(text!==undefined&&text!==null)node.textContent=String(text);
  if(className)node.className=className;
  return node;
}
export function hasValue(value){
  if(value===null||value===undefined||value==='')return false;
  if(Array.isArray(value))return value.some(hasValue);
  if(typeof value==='object')return Object.values(value).some(hasValue);
  return true;
}
export function technicalDetails(title,value){
  const details=element('details',null,'technical-detail');
  details.append(element('summary',title),element('pre',JSON.stringify(value,null,2)));
  return details;
}
function xmlRows(node,prefix=[]){
  const rows=[],path=[...prefix,label(node.name)];
  const attrs=(node.attributes??[]).map(pair=>Array.isArray(pair)?pair[0]+': '+pair[1]:'').filter(Boolean);
  const own=(node.content??[]).filter(value=>typeof value==='string').join('');
  if(own||attrs.length)rows.push([path.join(' / ')+(attrs.length?' ('+attrs.join(', ')+')':''),/DATE$/.test(node.name)?dateText(own):own||'—']);
  for(const child of node.content??[])if(child&&typeof child==='object'&&typeof child.name==='string')rows.push(...xmlRows(child,path));
  return rows;
}
export function valueView(value){
  if(!hasValue(value))return element('span','Not supplied','muted');
  if(typeof value==='boolean')return element('span',value?'Yes':'No');
  if(typeof value!=='object')return element('span',value);
  if(typeof value.name==='string'&&Array.isArray(value.content)){
    const list=element('dl',null,'metadata structured-values');
    // The role is already the containing heading. Preserve each original leaf and attribute.
    const children=value.content.filter(v=>v&&typeof v==='object'&&typeof v.name==='string');
    const rows=children.length&&!value.attributes?.length&&!value.content.some(v=>typeof v==='string'&&v.trim())?
      children.flatMap(child=>xmlRows(child)):xmlRows(value);
    for(const [key,text]of rows)list.append(element('dt',key),element('dd',text));
    return list;
  }
  if(Array.isArray(value)){
    const list=element('ul',null,'value-list');
    for(const entry of value){const item=element('li');item.append(valueView(entry));list.append(item);}
    return list;
  }
  const list=element('dl',null,'metadata structured-values'),technical={};
  for(const [key,item]of Object.entries(value)){
    if(!hasValue(item))continue;
    if(['sourcePath','raw','schema','sha256','sourceSha256','profileSha256','workspaceId','fileId'].includes(key)){technical[key]=item;continue;}
    const dd=element('dd');dd.append(valueView(typeof item==='string'&&/date|^start$|^end$|^createdAt$|^updatedAt$/i.test(key)?dateText(item):item));list.append(element('dt',label(key)),dd);
  }
  if(Object.keys(technical).length){const holder=element('div',null,'structured-value');holder.append(list,technicalDetails('Source details',technical));return holder;}
  return list;
}
export function properties(target,rows){
  target.replaceChildren();
  const list=target.tagName==='DL'?target:element('dl',null,'metadata');
  list.classList.add('metadata');
  for(const [name,value]of rows){
    if(!hasValue(value))continue;
    const dd=element('dd');dd.append(valueView(value));list.append(element('dt',name),dd);
  }
  if(list!==target)target.append(list);
  return list;
}
export function historyCard({title,at,reason,rows=[],record}){
  const article=element('article',null,'history-event');
  article.append(element('h4',title));
  if(at){const time=element('time',dateText(at),'muted');time.dateTime=at;time.title=at;article.append(time);}
  if(reason)article.append(element('p',reason,'history-reason'));
  if(rows.some(([,value])=>hasValue(value))){const list=element('dl',null,'metadata');properties(list,rows);article.append(list);}
  article.append(technicalDetails('Complete saved record',record));
  return article;
}
export function labelTable(table){
  table.classList.add('responsive-table');
  const headers=[...table.tHead.rows[0].cells];
  for(const head of headers)head.scope='col';
  for(const row of table.tBodies[0].rows)for(let i=0;i<row.cells.length;i++){
    const cell=row.cells[i];
    if(cell.colSpan>1)cell.classList.add('table-empty');
    else cell.dataset.label=headers[i]?.textContent.trim()??'';
  }
  const wrapper=table.closest('.table-wrap');
  if(wrapper){wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label',table.getAttribute('aria-label')??'Table: '+headers.map(h=>h.textContent.trim()).join(', '));}
}
export function wireTabs(controls,select,valueOf){
  const tabs=[...controls];
  for(const tab of tabs){
    tab.setAttribute('role','tab');
    tab.tabIndex=tab.getAttribute('aria-selected')==='true'?0:-1;
    tab.parentElement.setAttribute('role','tablist');
    tab.addEventListener('keydown',event=>{
      let next=tabs.indexOf(tab);
      if(event.key==='ArrowRight')next=(next+1)%tabs.length;
      else if(event.key==='ArrowLeft')next=(next+tabs.length-1)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();select(valueOf(tabs[next]));tabs[next].focus();
    });
  }
}
