// MIT. Original openTRANS 1.0 tree projection and emission; no binary-number coercion.
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v??{},k);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>structuredClone(v);
export const OPEN_TRANS_KINDS=Object.freeze(['ORDER','ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE']);
const DOC=Object.freeze({
  ORDER:{id:'ORDER_ID',date:'ORDER_DATE'},
  ORDERRESPONSE:{id:'ORDER_ID',date:'ORDERRESPONSE_DATE'},
  DISPATCHNOTIFICATION:{id:'DISPATCHNOTIFICATION_ID',date:'DISPATCHNOTIFICATION_DATE'},
  INVOICE:{id:'INVOICE_ID',date:'INVOICE_DATE'}
});
const ROLES=Object.freeze({buyer:'BUYER_PARTY',supplier:'SUPPLIER_PARTY',invoice:'INVOICE_PARTY',delivery:'DELIVERY_PARTY',finalDelivery:'FINAL_DELIVERY_PARTY',transport:'TRANSPORT_PARTY'});
const ROLE_NAMES=new Set(Object.values(ROLES));
const PARTY_CONTAINERS=new Set(['ORDER_PARTIES','SHIPMENT_PARTIES']);
const PRICE_FIELDS=Object.freeze({amount:'PRICE_AMOUNT',quantity:'PRICE_QUANTITY',lineAmount:'PRICE_LINE_AMOUNT',tax:'TAX',taxAmount:'TAX_AMOUNT',currency:'PRICE_CURRENCY'});
const ITEM_MAPPED=new Set(['LINE_ITEM_ID','ARTICLE_ID','QUANTITY','ORDER_UNIT','ARTICLE_PRICE','DELIVERY_DATE','ORDER_REFERENCE','DELIVERY_REFERENCE','PACKAGE_INFO','REMARK','SHIPMENT_PARTIES',...ROLE_NAMES]);
const ARTICLE_MAPPED=new Set(['SUPPLIER_AID','BUYER_AID','DESCRIPTION_SHORT','DESCRIPTION_LONG']);
const PRICE_MAPPED=new Set([...Object.values(PRICE_FIELDS),'PRICE_FLAG']);
const HEADER_MAPPED=new Set(['ORDER_ID','ORDER_DATE','ORDERRESPONSE_DATE','ORDER_RESPONSE_DATE','DISPATCHNOTIFICATION_ID','DISPATCHNOTIFICATION_DATE','INVOICE_ID','INVOICE_DATE','SUPPLIER_ORDER_ID','PRICE_CURRENCY','DELIVERY_DATE','ORDER_PARTIES','SHIPMENT_PARTIES','PACKAGE_INFO','REMARK',...ROLE_NAMES]);
const NUMBER=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER=/^[+-]?\d+$/;
const COUNT=/^\+?\d+$/;
const NUMBERS=new Set(['QUANTITY','PRICE_AMOUNT','PRICE_FACTOR','PRICE_QUANTITY','PRICE_LINE_AMOUNT','TAX','TAX_AMOUNT','TOTAL_AMOUNT','TOTAL_TAX_AMOUNT']);
const INTEGERS=new Set(['MIME_ORDER']);
const BOOLEANS=new Set(['PRICE_FLAG','DELIVERY_COMPLETED','PARTIAL_SHIPMENT','PARTIAL_SHIPMENT_ALLOWED']);
const COUNTS=new Set(['TOTAL_ITEM_NUM','ORDERCHANGE_SEQUENCE_ID']);
const SERIAL=/^NUMBER:\[Number\]\[Type\]SERIAL\[\/Type\]\[Value\]([\s\S]*)\[\/Value\]\[\/Number\]$/;
const SPEC='https://unite.eu/assets/support/uk/specification_opentrans_v1_0_en-2.pdf';
const VENDOR='https://support.unite.eu/en-gb/for-suppliers/';
export class OpenTransError extends Error {
  constructor(code,message,status=422,details){super(message);this.code=code;this.status=status;if(details!==undefined)this.details=details;}
}
function need(value,code,message,details){if(!value)throw new OpenTransError(code,message,422,details);}
export function xmlElement(name,content=[],attributes=[]){return{name,attributes,content};}
export function xmlChildren(node,name){return (node?.content??[]).filter(v=>object(v)&&typeof v.name==='string'&&(!name||v.name===name));}
export function xmlChild(node,name){return xmlChildren(node,name)[0]??null;}
export function xmlText(node){return node==null?null:(node.content??[]).filter(v=>typeof v==='string').join('');}
export function xmlAttribute(node,name){return (node?.attributes??[]).find(v=>Array.isArray(v)&&v[0]===name)?.[1]??null;}
function scalar(node,name){return xmlText(xmlChild(node,name));}
function direct(node,path){for(const name of path.split('/')){node=xmlChild(node,name);if(!node)return null;}return node;}
function walk(node,visit){if(!node)return;visit(node);for(const child of xmlChildren(node))walk(child,visit);}
function details(node){return node?.sourcePath??'/';}
function collect(node,names,containers=PARTY_CONTAINERS){
  const result=[];
  for(const child of xmlChildren(node)){if(names.has(child.name))result.push(child);else if(containers.has(child.name))result.push(...collect(child,names,containers));}
  return result;
}
export function semanticXmlTree(node){
  if(node==null)return null;
  need(object(node)&&typeof node.name==='string','OPENTRANS_TREE','An original XML subtree is required.');
  const elements=xmlChildren(node).length>0;
  return{name:node.name,attributes:clone(node.attributes??[]),content:(node.content??[]).flatMap(value=>{
    if(typeof value==='string')return elements&&/^[ \t\r\n]*$/.test(value)?[]:[value];
    if(object(value)&&typeof value.name==='string')return[semanticXmlTree(value)];
    return[]; // Non-business annotations and byte locations remain in the complete raw tree.
  })};
}
function extensions(node,known){return xmlChildren(node).filter(v=>!known.has(v.name)).map(semanticXmlTree);}
function rawParties(node){const found=collect(node,ROLE_NAMES);return Object.fromEntries(Object.entries(ROLES).map(([role,name])=>[role,role==='transport'?found.filter(v=>v.name===name):found.find(v=>v.name===name)??null]));}
function partyProjection(node){const original=rawParties(node);return Object.fromEntries(Object.entries(original).map(([role,value])=>[role,Array.isArray(value)?value.map(semanticXmlTree):semanticXmlTree(value)]));}
function identity(node,findings,path){
  if(!node)return{supplierId:null,supplierIdentity:null};
  const candidates=[];
  walk(node,current=>{if(current.name==='PARTY_ID'){const value=xmlText(current);if(value!=null&&value!=='')candidates.push({type:xmlAttribute(current,'type'),value,sourcePath:current.sourcePath??path});}});
  const selected=candidates.some(v=>v.type==='buyer_specific')?candidates.filter(v=>v.type==='buyer_specific'):candidates;
  const values=[...new Set(selected.map(v=>v.value))];
  if(values.length===1){const choice=selected.find(v=>v.value===values[0]);return{supplierId:choice.value,supplierIdentity:choice};}
  if(values.length>1)findings.push(issue('OPENTRANS_SUPPLIER_ID_AMBIGUOUS',path,'The original supplier party contains more than one possible account identity. Select the explicit recipient account in the source party.',{identities:selected}));
  return{supplierId:null,supplierIdentity:null};
}
function period(node){return node?{type:xmlAttribute(node,'type'),start:scalar(node,'DELIVERY_START_DATE'),end:scalar(node,'DELIVERY_END_DATE'),extensions:extensions(node,new Set(['DELIVERY_START_DATE','DELIVERY_END_DATE']))}:null;}
function remarks(node){return xmlChildren(node,'REMARK').map(v=>({type:xmlAttribute(v,'type'),text:xmlText(v),sourcePath:v.sourcePath??null}));}
export function openTransSerials(remarksValue){
  return (remarksValue??[]).flatMap(v=>{const match=typeof v?.text==='string'?SERIAL.exec(v.text):null;return match?[match[1]]:[];});
}
function packages(node){
  return collect(node,new Set(['PACKAGE_INFO']),new Set(['TRANSPORT','SHIPMENT_PARTIES'])).map(v=>({
    id:scalar(v,'PACKAGE_ID'),type:xmlAttribute(v,'type')??scalar(v,'PACKAGE_TYPE'),typeField:xmlAttribute(v,'type')!==null?'attribute':xmlChild(v,'PACKAGE_TYPE')?'element':null,
    attributes:clone(v.attributes??[]),extensions:extensions(v,new Set(['PACKAGE_ID','PACKAGE_TYPE'])),sourcePath:v.sourcePath??null
  }));
}
function price(node){
  if(!node)return null;
  return{type:xmlAttribute(node,'type'),...Object.fromEntries(Object.entries(PRICE_FIELDS).map(([key,name])=>[key,scalar(node,name)])),
    flags:xmlChildren(node,'PRICE_FLAG').map(v=>({type:xmlAttribute(v,'type'),value:xmlText(v)})),extensions:extensions(node,PRICE_MAPPED)};
}
function article(node){
  return{supplierId:scalar(node,'SUPPLIER_AID'),buyerIds:xmlChildren(node,'BUYER_AID').map(v=>({type:xmlAttribute(v,'type'),value:xmlText(v)})),
    descriptionShort:scalar(node,'DESCRIPTION_SHORT'),descriptionLong:scalar(node,'DESCRIPTION_LONG'),extensions:extensions(node,ARTICLE_MAPPED)};
}
function issue(code,path,message,extra){
  return{severity:'error',code,path,message,rule:{url:SPEC,section:'Original 1.0 source and scalar fields'},...(extra?{details:extra}:{})};
}
function nativeFindings(raw,layout){
  const findings=[];
  walk(raw.root,node=>{
    const name=node.name,value=xmlText(node),path=details(node),elements=xmlChildren(node);
    // #PCDATA permits empty optional source strings (including the publisher's STATE fields).
    // Required business identifiers are checked by the original document review; numeric
    // and Boolean fields retain their specific lexical checks below.
    if(elements.length)return;
    if(NUMBERS.has(name)&&value!==null&&!NUMBER.test(value))findings.push(issue('OPENTRANS_NUMBER',path,'Preserve a valid original NUMBER string, with a dot decimal separator and optional exponent.'));
    if(COUNTS.has(name)&&value!==null&&!COUNT.test(value))findings.push(issue('OPENTRANS_COUNT',path,'The original COUNT field requires a nonnegative integral value.'));
    if(INTEGERS.has(name)&&value!==null&&!INTEGER.test(value))findings.push(issue('OPENTRANS_INTEGER',path,'The original INTEGER field requires its complete signed or unsigned integral string.'));
    if(BOOLEANS.has(name)&&value!==null&&!/^(?:true|false)$/i.test(value))findings.push(issue('OPENTRANS_BOOLEAN',path,'The original Boolean is true or false; numeric substitutes are not part of this profile.'));
    if(name==='ORDER_ID'&&value!==null&&[...value].length>21)findings.push({...issue('UNITE_ORDER_ID_LENGTH',path,'The complete original Unite order reference can contain at most 21 characters.'),rule:{url:VENDOR+'edi-interfaces-for-order-processing',section:'Order number'}});
    if(name==='REMARK'&&value?.startsWith('NUMBER:')&&!SERIAL.test(value))findings.push({...issue('UNITE_SERIAL_REMARK',path,'Use one complete original NUMBER:[Number] serial record in each REMARK.'),rule:{url:VENDOR+'submit-serial-numbers',section:'openTRANS 1.0'}});
    if(name==='REMARK'&&SERIAL.test(value??'')&&SERIAL.exec(value)[1]==='')findings.push(issue('UNITE_SERIAL_EMPTY',path,'The original serial value is empty.'));
  });
  return findings;
}
export function projectOpenTransTree(native,{name,provenance}={}){
  const raw=native.raw,root=raw?.root,kind=root?.name;
  need(OPEN_TRANS_KINDS.includes(kind),'OPENTRANS_DOCUMENT_KIND','Choose an original supported openTRANS 1.0 document.');
  const metadata=DOC[kind],headerNode=xmlChild(root,kind+'_HEADER'),info=xmlChild(headerNode,kind+'_INFO');
  const sourceFindings=[...(native.findings??[]),...nativeFindings(raw,native.layout)];
  if(!info)sourceFindings.push(issue('OPENTRANS_HEADER_REQUIRED','/'+kind,'The original document header/info is missing.'));
  const ids=identity(rawParties(info).supplier,sourceFindings,'/header/supplierId');
  const rows=xmlChildren(xmlChild(root,kind+'_ITEM_LIST'),kind+'_ITEM');
  const items=rows.map((node,index)=>{
    const ref=xmlChild(node,'ORDER_REFERENCE'),parties=partyProjection(node),supplier=identity(rawParties(node).supplier,sourceFindings,'/items/'+index+'/supplierId'),remarkRows=remarks(node);
    return{lineId:scalar(node,'LINE_ITEM_ID'),article:article(xmlChild(node,'ARTICLE_ID')),quantity:scalar(node,'QUANTITY'),unit:scalar(node,'ORDER_UNIT'),
      price:price(xmlChild(node,'ARTICLE_PRICE')),deliveryDate:period(xmlChild(node,'DELIVERY_DATE')),
      orderReference:ref?{orderId:scalar(ref,'ORDER_ID'),lineId:scalar(ref,'LINE_ITEM_ID'),date:scalar(ref,'ORDER_DATE'),extensions:extensions(ref,new Set(['ORDER_ID','LINE_ITEM_ID','ORDER_DATE']))}:null,
      deliveryReferences:xmlChildren(node,'DELIVERY_REFERENCE').map(v=>({documentId:scalar(v,'DELIVERY_NOTE_ID'),lineId:scalar(v,'LINE_ITEM_ID'),date:period(xmlChild(v,'DELIVERY_DATE')),extensions:extensions(v,new Set(['DELIVERY_NOTE_ID','LINE_ITEM_ID','DELIVERY_DATE']))})),
      parties,...supplier,packages:packages(node),remarks:remarkRows,serials:openTransSerials(remarkRows),extensions:extensions(node,ITEM_MAPPED),sourcePath:node.sourcePath??null};
  });
  const summaryNode=xmlChild(root,kind+'_SUMMARY'),version=xmlAttribute(root,'version')??native.validation?.attributeDefaults?.[kind]?.version??null;
  if(version!=='1.0')sourceFindings.push(issue('OPENTRANS_VERSION','/version','This recipient profile uses the original openTRANS 1.0 version.',{actual:version}));
  return{schema:'stellar-forge.supplier-order-document.v1',profileId:'unite-opentrans-1.0',kind,version,documentId:scalar(info,metadata.id),orderId:kind==='ORDER'||kind==='ORDERRESPONSE'?scalar(info,'ORDER_ID'):null,
    header:{date:scalar(info,metadata.date),orderDate:scalar(info,'ORDER_DATE'),currency:scalar(info,'PRICE_CURRENCY'),supplierOrderId:scalar(info,'SUPPLIER_ORDER_ID'),deliveryDate:period(xmlChild(info,'DELIVERY_DATE')),
      parties:partyProjection(info),...ids,packages:packages(info),remarks:remarks(info),extensions:extensions(info,HEADER_MAPPED)},
    items,summary:{totalItems:scalar(summaryNode,'TOTAL_ITEM_NUM'),totalAmount:scalar(summaryNode,'TOTAL_AMOUNT'),totalTaxAmount:scalar(summaryNode,'TOTAL_TAX_AMOUNT'),
      extensions:extensions(summaryNode,new Set(['TOTAL_ITEM_NUM','TOTAL_AMOUNT','TOTAL_TAX_AMOUNT']))},
    raw,source:{name:name??'source.xml',...native.source,provenance:provenance??null},validation:native.validation,findings:sourceFindings};
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function layoutAllows(layout,parent,name){return (layout?.elements?.[parent]?.children??[]).includes(name);}
function insert(node,child,layout){
  const order=layout?.elements?.[node.name]?.children??[],rank=order.indexOf(child.name);
  let at=node.content.length;
  if(rank>=0){const found=node.content.findIndex(v=>object(v)&&typeof v.name==='string'&&order.indexOf(v.name)>rank);if(found>=0)at=found;}
  node.content.splice(at,0,child);
  return child;
}
function ensure(node,name,layout){
  const existing=xmlChildren(node,name);need(existing.length<=1,'OPENTRANS_EDIT_AMBIGUOUS','Resolve the repeated original singleton before editing it.',{parent:node.name,element:name});
  return existing[0]??insert(node,xmlElement(name),layout);
}
function remove(node,name){node.content=node.content.filter(v=>!object(v)||v.name!==name);}
function setAttribute(node,name,value){
  need(value==null||typeof value==='string','OPENTRANS_ATTRIBUTE','Original XML attribute values must be strings.',{element:node.name,attribute:name});
  const index=node.attributes.findIndex(v=>v[0]===name);
  if(value==null){if(index>=0)node.attributes.splice(index,1);}
  else if(index>=0)node.attributes[index][1]=value;
  else node.attributes.push([name,value]);
}
function setText(node,value){
  need(typeof value==='string','OPENTRANS_SCALAR','Original XML scalar values must be strings.',{element:node.name});
  need(!xmlChildren(node).length,'OPENTRANS_EDIT_SCALAR','A scalar editor cannot remove original nested element content.',{element:node.name});
  const first=node.content.findIndex(v=>typeof v==='string'),annotations=node.content.filter(v=>typeof v!=='string');
  annotations.splice(first<0?0:Math.min(first,annotations.length),0,value);
  node.content=annotations;
}
function setScalar(node,name,value,layout){
  if(value==null){remove(node,name);return;}
  const child=ensure(node,name,layout);setText(child,value);
}
function group(node,name,values,layout,build){
  need(Array.isArray(values),'OPENTRANS_ARRAY','An original repeated field requires an array.',{element:name});
  const existing=xmlChildren(node,name),byPath=new Map(existing.filter(v=>v.sourcePath).map(v=>[v.sourcePath,v])),seen=new Set();
  const replacements=values.map((value,index)=>{
    const path=value?.sourcePath;
    if(path){need(!seen.has(path),'OPENTRANS_EDIT_SOURCE_REPEATED','A source element was selected twice.',{sourcePath:path});seen.add(path);}
    const original=path&&byPath.has(path)?byPath.get(path):!path?existing[index]:null;
    return build(original?clone(original):xmlElement(name),value,index);
  });
  let next=0;
  node.content=node.content.flatMap(value=>{
    if(object(value)&&value.name===name){if(next<replacements.length)return[replacements[next++]];return[];}
    return[value];
  });
  while(next<replacements.length)insert(node,replacements[next++],layout);
}
function sourceExtras(node,values,known,layout,findings,path,fresh){
  if(values===undefined)return;
  need(Array.isArray(values),'OPENTRANS_EXTENSIONS','Original extension fields must be an array of complete XML subtrees.');
  if(!fresh&&same(extensions(node,known),values))return;
  node.content=node.content.filter(v=>!object(v)||typeof v.name!=='string'||known.has(v.name));
  for(const input of values){
    const value=semanticXmlTree(input);
    need(!known.has(value.name),'OPENTRANS_EXTENSION_MAPPED','Edit the declared normalized field instead of duplicating it as an extension.',{element:value.name});
    if(layoutAllows(layout,node.name,value.name))insert(node,value,layout);
    else findings.push({severity:'warning',code:'OPENTRANS_TARGET_EXTENSION',path,message:'This original field has no slot in the selected target document; its source remains in the retained original order.',rule:{url:SPEC,section:node.name},details:{element:value.name}});
  }
}
function applyPeriod(parent,name,value,layout,findings,path,fresh){
  if(value==null){remove(parent,name);return;}
  need(object(value),'OPENTRANS_DELIVERY_DATE','A delivery date requires its original type and start/end values.');
  const node=ensure(parent,name,layout);setAttribute(node,'type',value.type??null);setScalar(node,'DELIVERY_START_DATE',value.start??null,layout);setScalar(node,'DELIVERY_END_DATE',value.end??null,layout);
  sourceExtras(node,value.extensions,new Set(['DELIVERY_START_DATE','DELIVERY_END_DATE']),layout,findings,path,fresh);
}
function findRolePath(layout,start,name,seen=new Set()){
  if(seen.has(start))return null;seen.add(start);
  const children=layout?.elements?.[start]?.children??[];
  if(children.includes(name))return[name];
  for(const container of ['ORDER_PARTIES','SHIPMENT_PARTIES']){
    if(!children.includes(container))continue;
    const route=findRolePath(layout,container,name,new Set(seen));if(route)return[container,...route];
  }
  return null;
}
function atRoute(root,route,layout,create){
  let current=root;
  for(const part of route){current=create?ensure(current,part,layout):xmlChild(current,part);if(!current)return null;}
  return current;
}
function applyParties(parent,parties,layout,findings,path,fresh){
  if(parties===undefined)return;
  need(object(parties),'OPENTRANS_PARTIES','Original parties must retain their named role.');
  for(const[role,name]of Object.entries(ROLES)){
    if(!own(parties,role))continue;
    const value=parties[role],route=findRolePath(layout,parent.name,name);
    if(role==='transport'){
      const values=value==null?[]:Array.isArray(value)?value:[value];
      if(!route){if(values.length)findings.push({severity:'warning',code:'OPENTRANS_TARGET_PARTY',path:path+'/'+role,message:'The selected target has no transport-party field at this level; all original parties remain retained.',rule:{url:SPEC,section:parent.name}});continue;}
      const container=atRoute(parent,route.slice(0,-1),layout,values.length>0);if(!container)continue;
      const prior=xmlChildren(container,name);
      if(same(prior.map(semanticXmlTree),values))continue;
      group(container,name,values,layout,(_node,item)=>{need(item?.name===name,'OPENTRANS_PARTY_ROLE','Each original transport party must retain its role.');return semanticXmlTree(item);});
      continue;
    }
    if(!route){
      if(value!=null)findings.push({severity:'warning',code:'OPENTRANS_TARGET_PARTY',path:path+'/'+role,message:'The selected target has no field for this source party role; its complete source remains retained.',rule:{url:SPEC,section:parent.name},details:{role}});
      continue;
    }
    const container=atRoute(parent,route.slice(0,-1),layout,value!=null);if(!container)continue;
    if(value==null){remove(container,name);continue;}
    need(value.name===name,'OPENTRANS_PARTY_ROLE','The original party tree must match its declared role.',{role,element:value.name});
    const prior=xmlChild(container,name);
    if(prior&&same(semanticXmlTree(prior),value))continue;
    const selected=semanticXmlTree(value),indices=container.content.map((v,i)=>object(v)&&v.name===name?i:-1).filter(v=>v>=0);
    need(indices.length<=1,'OPENTRANS_EDIT_AMBIGUOUS','Resolve a repeated original party before editing it.',{role});
    if(indices.length)container.content[indices[0]]=selected;else insert(container,selected,layout);
  }
}
function applyRemarks(parent,values,layout){
  if(values===undefined)return;
  group(parent,'REMARK',values,layout,(node,value)=>{need(object(value),'OPENTRANS_REMARK','A remark requires original type/text fields.');setAttribute(node,'type',value.type??null);setText(node,value.text);return node;});
}
function applyPackages(parent,values,layout,findings,path,fresh){
  if(values===undefined)return;
  const route=layoutAllows(layout,parent.name,'PACKAGE_INFO')?[]:layoutAllows(layout,parent.name,'TRANSPORT')&&layoutAllows(layout,'TRANSPORT','PACKAGE_INFO')?['TRANSPORT']:null;
  if(route===null){
    if(values.length)findings.push({severity:'warning',code:'OPENTRANS_TARGET_PACKAGES',path,message:'The original target DTD has no package field at this level.',rule:{url:SPEC,section:parent.name}});
    return;
  }
  const container=route.length?atRoute(parent,route,layout,values.length>0):parent;
  if(!container)return;
  group(container,'PACKAGE_INFO',values,layout,(node,value,index)=>{
    if(value.attributes!==undefined)node.attributes=clone(value.attributes);
    setScalar(node,'PACKAGE_ID',value.id??null,layout);
    if(value.typeField==='attribute'||(layout?.elements?.PACKAGE_INFO?.attributes??{}).type)setAttribute(node,'type',value.type??null);
    else if(layoutAllows(layout,'PACKAGE_INFO','PACKAGE_TYPE'))setScalar(node,'PACKAGE_TYPE',value.type??null,layout);
    else if(value.type!=null)findings.push(issue('OPENTRANS_PACKAGE_TYPE',path+'/'+index+'/type','The selected original DTD does not define this package type field.'));
    sourceExtras(node,value.extensions,new Set(['PACKAGE_ID','PACKAGE_TYPE']),layout,findings,path+'/'+index,fresh);
    return node;
  });
}
function applyArticle(parent,value,layout,findings,path,fresh){
  if(value==null){remove(parent,'ARTICLE_ID');return;}
  const node=ensure(parent,'ARTICLE_ID',layout);setScalar(node,'SUPPLIER_AID',value.supplierId??null,layout);
  group(node,'BUYER_AID',value.buyerIds??[],layout,(child,item)=>{setAttribute(child,'type',item.type??null);setText(child,item.value);return child;});
  setScalar(node,'DESCRIPTION_SHORT',value.descriptionShort??null,layout);setScalar(node,'DESCRIPTION_LONG',value.descriptionLong??null,layout);
  sourceExtras(node,value.extensions,ARTICLE_MAPPED,layout,findings,path,fresh);
}
function applyPrice(parent,value,layout,findings,path,fresh){
  if(value==null){remove(parent,'ARTICLE_PRICE');return;}
  const node=ensure(parent,'ARTICLE_PRICE',layout);setAttribute(node,'type',value.type??null);
  for(const[key,name]of Object.entries(PRICE_FIELDS))setScalar(node,name,value[key]??null,layout);
  group(node,'PRICE_FLAG',value.flags??[],layout,(child,item)=>{setAttribute(child,'type',item.type??null);setText(child,item.value);return child;});
  sourceExtras(node,value.extensions,PRICE_MAPPED,layout,findings,path,fresh);
}
function applyReference(parent,name,value,layout,findings,path,fresh){
  if(value==null){remove(parent,name);return;}
  const node=ensure(parent,name,layout);setScalar(node,'ORDER_ID',value.orderId??null,layout);setScalar(node,'LINE_ITEM_ID',value.lineId??null,layout);setScalar(node,'ORDER_DATE',value.date??null,layout);
  sourceExtras(node,value.extensions,new Set(['ORDER_ID','LINE_ITEM_ID','ORDER_DATE']),layout,findings,path,fresh);
}
export function editOpenTransTree(document,layout){
  need(object(document)&&document.schema==='stellar-forge.supplier-order-document.v1','OPENTRANS_DOCUMENT','A complete normalized original document is required.');
  need(OPEN_TRANS_KINDS.includes(document.kind),'OPENTRANS_DOCUMENT_KIND','The selected original document kind is unsupported.');
  need(object(layout)&&layout.schema==='stellar-forge.opentrans-dtd-layout.v1'&&layout.kind===document.kind,'OPENTRANS_DTD_LAYOUT','The retained original DTD layout is required.');
  const kind=document.kind,metadata=DOC[kind],fresh=document.raw==null,findings=[];
  const raw=fresh?{schema:'stellar-forge.opentrans-raw.v1',xml:{version:'1.0',encoding:'UTF-8',standalone:null},doctype:{name:kind,systemId:layout.dtdPath.split('/').pop(),publicId:null},prolog:[],root:xmlElement(kind,[],[['version','1.0']]),epilog:[]}:clone(document.raw);
  need(raw.schema==='stellar-forge.opentrans-raw.v1'&&raw.root?.name===kind,'OPENTRANS_DRAFT_RAW_KIND','A new target kind needs raw:null; same-kind edits keep their original raw tree.');
  const root=raw.root;setAttribute(root,'version',document.version??'1.0');
  const header=ensure(root,kind+'_HEADER',layout),info=ensure(header,kind+'_INFO',layout),value=document.header??{};
  if(fresh&&layoutAllows(layout,header.name,'CONTROL_INFO')){
    const control=ensure(header,'CONTROL_INFO',layout);
    if(layoutAllows(layout,'CONTROL_INFO','GENERATOR_INFO'))setScalar(control,'GENERATOR_INFO','TJLabs Supplier Orders',layout);
    if(value.date!=null&&layoutAllows(layout,'CONTROL_INFO','GENERATION_DATE'))setScalar(control,'GENERATION_DATE',value.date,layout);
  }
  setScalar(info,metadata.id,document.documentId??null,layout);
  if(kind==='ORDER'||kind==='ORDERRESPONSE'){
    need(document.orderId==null||document.documentId===document.orderId,'OPENTRANS_ORDER_ID','The original order/response business ID and order reference must agree.');
    setScalar(info,'ORDER_ID',document.orderId??document.documentId??null,layout);
  }
  setScalar(info,metadata.date,value.date??null,layout);
  if(metadata.date!=='ORDER_DATE'&&(layoutAllows(layout,info.name,'ORDER_DATE')||xmlChild(info,'ORDER_DATE')))setScalar(info,'ORDER_DATE',value.orderDate??null,layout);
  for(const[key,name]of [['currency','PRICE_CURRENCY'],['supplierOrderId','SUPPLIER_ORDER_ID']]){
    if(layoutAllows(layout,info.name,name)||xmlChild(info,name))setScalar(info,name,value[key]??null,layout);
    else if(value[key]!=null)findings.push({severity:'warning',code:'OPENTRANS_TARGET_HEADER_FIELD',path:'/header/'+key,message:'The selected original target has no field for this source header value.',rule:{url:SPEC,section:info.name}});
  }
  if(layoutAllows(layout,info.name,'DELIVERY_DATE')||xmlChild(info,'DELIVERY_DATE'))applyPeriod(info,'DELIVERY_DATE',value.deliveryDate??null,layout,findings,'/header/deliveryDate',fresh);
  else if(value.deliveryDate!=null)findings.push(issue('OPENTRANS_TARGET_DELIVERY_DATE','/header/deliveryDate','This original target has no delivery-period field at header level.'));
  applyParties(info,value.parties??{},layout,findings,'/header/parties',fresh);
  applyPackages(info,value.packages??[],layout,findings,'/header/packages',fresh);applyRemarks(info,value.remarks??[],layout);
  sourceExtras(info,value.extensions,HEADER_MAPPED,layout,findings,'/header/extensions',fresh);
  const list=ensure(root,kind+'_ITEM_LIST',layout);
  group(list,kind+'_ITEM',document.items??[],layout,(node,item,index)=>{
    const path='/items/'+index;setScalar(node,'LINE_ITEM_ID',item.lineId??null,layout);applyArticle(node,item.article,layout,findings,path+'/article',fresh);
    setScalar(node,'QUANTITY',item.quantity??null,layout);setScalar(node,'ORDER_UNIT',item.unit??null,layout);
    if(layoutAllows(layout,node.name,'ARTICLE_PRICE')||xmlChild(node,'ARTICLE_PRICE'))applyPrice(node,item.price??null,layout,findings,path+'/price',fresh);
    else if(item.price!=null)findings.push({severity:'warning',code:'OPENTRANS_TARGET_PRICE',path:path+'/price',message:'The selected dispatch target carries quantity rather than commercial price fields; the original order price remains retained.',rule:{url:SPEC,section:node.name}});
    if(layoutAllows(layout,node.name,'DELIVERY_DATE')||xmlChild(node,'DELIVERY_DATE'))applyPeriod(node,'DELIVERY_DATE',item.deliveryDate??null,layout,findings,path+'/deliveryDate',fresh);
    else if(item.deliveryDate!=null)findings.push(issue('OPENTRANS_TARGET_DELIVERY_DATE',path+'/deliveryDate','This original target has no delivery-period field at item level.'));
    if(layoutAllows(layout,node.name,'ORDER_REFERENCE')||xmlChild(node,'ORDER_REFERENCE'))applyReference(node,'ORDER_REFERENCE',item.orderReference??null,layout,findings,path+'/orderReference',fresh);
    else if(item.orderReference!=null)findings.push(issue('OPENTRANS_TARGET_ORDER_REFERENCE',path+'/orderReference','This original target uses its header order reference instead of an item ORDER_REFERENCE.'));
    if(layoutAllows(layout,node.name,'DELIVERY_REFERENCE')||xmlChild(node,'DELIVERY_REFERENCE'))group(node,'DELIVERY_REFERENCE',item.deliveryReferences??[],layout,(ref,value,j)=>{
      setScalar(ref,'DELIVERY_NOTE_ID',value.documentId??null,layout);setScalar(ref,'LINE_ITEM_ID',value.lineId??null,layout);
      applyPeriod(ref,'DELIVERY_DATE',value.date??null,layout,findings,path+'/deliveryReferences/'+j+'/date',fresh);
      sourceExtras(ref,value.extensions,new Set(['DELIVERY_NOTE_ID','LINE_ITEM_ID','DELIVERY_DATE']),layout,findings,path+'/deliveryReferences/'+j,fresh);return ref;
    });
    else if(item.deliveryReferences?.length)findings.push(issue('OPENTRANS_TARGET_DELIVERY_REFERENCE',path+'/deliveryReferences','The selected original target has no delivery-reference element.'));
    applyParties(node,item.parties??{},layout,findings,path+'/parties',fresh);applyPackages(node,item.packages??[],layout,findings,path+'/packages',fresh);applyRemarks(node,item.remarks??[],layout);
    sourceExtras(node,item.extensions,ITEM_MAPPED,layout,findings,path+'/extensions',fresh);
    return node;
  });
  const summary=ensure(root,kind+'_SUMMARY',layout),summaries=document.summary??{};
  for(const[key,name]of [['totalItems','TOTAL_ITEM_NUM'],['totalAmount','TOTAL_AMOUNT'],['totalTaxAmount','TOTAL_TAX_AMOUNT']]){
    if(layoutAllows(layout,summary.name,name)||xmlChild(summary,name))setScalar(summary,name,summaries[key]??null,layout);
    else if(summaries[key]!=null)findings.push({severity:'warning',code:'OPENTRANS_TARGET_SUMMARY',path:'/summary/'+key,message:'The original target summary has no field for this source value.',rule:{url:SPEC,section:summary.name}});
  }
  sourceExtras(summary,summaries.extensions,new Set(['TOTAL_ITEM_NUM','TOTAL_AMOUNT','TOTAL_TAX_AMOUNT']),layout,findings,'/summary/extensions',fresh);
  // Serial arrays and supplier identity are projections. The complete edited
  // REMARK/party trees are authoritative and are re-derived after native parse.
  return{raw,findings};
}
function legalCharacter(c){
  const n=c.codePointAt(0);return n===9||n===10||n===13||n>=0x20&&n<=0xD7FF||n>=0xE000&&n<=0xFFFD||n>=0x10000&&n<=0x10FFFF;
}
function xmlString(value){
  need(typeof value==='string','OPENTRANS_XML_TEXT','Original XML values must remain strings.');
  for(const c of value)need(legalCharacter(c),'OPENTRANS_XML_CHARACTER','The edited value contains a character XML 1.0 cannot represent.');
  return value;
}
function xmlName(value){
  need(typeof value==='string'&&/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}][:A-Z_a-z0-9.\-\u00B7\u0300-\u036F\u203F-\u2040\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*$/u.test(value),'OPENTRANS_XML_NAME','The edited source contains an invalid XML name.');
  return value;
}
function escape(value,attribute=false){
  let text=xmlString(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  if(attribute)text=text.replaceAll('"','&quot;').replaceAll('\t','&#9;').replaceAll('\n','&#10;').replaceAll('\r','&#13;');
  else text=text.replaceAll('\r','&#13;');
  return text;
}
function quoted(value){
  xmlString(value);
  if(!value.includes('"'))return'"'+value+'"';
  need(!value.includes("'"),'OPENTRANS_XML_LITERAL','An XML external identifier cannot contain both quote characters.');
  return"'"+value+"'";
}
export function serializeOpenTransTree(raw){
  need(raw?.schema==='stellar-forge.opentrans-raw.v1'&&object(raw.root),'OPENTRANS_TREE','A complete original XML tree is required.');
  const output=['<?xml version="1.0" encoding="UTF-8"?>\n'];
  let count=0;
  function write(value,depth=0){
    if(typeof value==='string'){output.push(escape(value));return;}
    need(depth<128&&++count<=500000,'OPENTRANS_XML_COMPLEXITY','The edited XML exceeds the supported tree depth or size.');
    need(object(value),'OPENTRANS_TREE','Original XML content must be text or an XML node.');
    if(own(value,'comment')){const text=xmlString(value.comment);need(!text.includes('--')&&!text.endsWith('-'),'OPENTRANS_XML_COMMENT','An XML comment cannot contain a double hyphen or end with a hyphen.');output.push('<!--'+text+'-->');return;}
    if(own(value,'instruction')){const target=xmlName(value.instruction),text=xmlString(value.text??'');need(!/^xml$/i.test(target)&&!text.includes('?>'),'OPENTRANS_XML_INSTRUCTION','The original processing instruction is invalid.');output.push('<?'+target+(text?' '+text:'')+'?>');return;}
    const name=xmlName(value.name),seen=new Set();need(Array.isArray(value.attributes)&&Array.isArray(value.content),'OPENTRANS_TREE','An XML element needs ordered attributes and content.');
    output.push('<'+name);
    for(const pair of value.attributes){need(Array.isArray(pair)&&pair.length===2,'OPENTRANS_ATTRIBUTE','An original attribute is a name/value pair.');const attr=xmlName(pair[0]);need(!seen.has(attr),'OPENTRANS_ATTRIBUTE_REPEATED','An XML attribute is repeated.');seen.add(attr);output.push(' '+attr+'="'+escape(pair[1],true)+'"');}
    if(!value.content.length){output.push('/>');return;}
    output.push('>');for(const child of value.content)write(child,depth+1);output.push('</'+name+'>');
  }
  for(const v of raw.prolog??[])write(v);
  if(raw.doctype){
    const d=raw.doctype,name=xmlName(d.name);need(name===raw.root.name,'OPENTRANS_XML_DOCTYPE','The retained document type differs from its root.');
    output.push('<!DOCTYPE '+name);
    if(d.publicId!=null){need(d.systemId!=null,'OPENTRANS_XML_DOCTYPE','A public declaration needs its captured system identifier.');output.push(' PUBLIC '+quoted(d.publicId)+' '+quoted(d.systemId));}
    else if(d.systemId!=null)output.push(' SYSTEM '+quoted(d.systemId));
    output.push('>\n');
  }
  write(raw.root);for(const v of raw.epilog??[])write(v);output.push('\n');return output.join('');
}
