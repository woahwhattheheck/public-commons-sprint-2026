// MIT. Native ETIM xChange profile and explicitly selected 2BA recipient rules.
import { clone, canonical, digest } from '../../../workspace/store.mjs';
import { fail, text } from '../model.mjs';
import { object, pointerPart, pointerGet, reconcileNumberTokens, validateXChange,
  XCHANGE_SCHEMA, XCHANGE_SUPPLIER_SCHEMA, XCHANGE_PRODUCT_SCHEMA, XCHANGE_SCHEMA_SOURCE,
  sliceNumberTokens } from './schema.mjs';
export const XCHANGE_PROFILE_SCHEMA='stellar-forge.supplier-xchange-profile.v1';
export const XCHANGE_PRODUCT_RECORD='stellar-forge.xchange-product.v1';
export const TWO_BA_SOURCE=Object.freeze({url:'https://www.2ba.nl/en/documentation/file-exchange/etim-xchange-v2-0/',revision:'Observed 2026-10-12'});
const STATUS=['PRE-LAUNCH','ACTIVE','ON HOLD','PLANNED WITHDRAWAL','OBSOLETE'];
const own=(v,k)=>Object.hasOwn(v,k);
function keys(value,allowed,label){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('XCHANGE_PROFILE_FIELD',label+' contains an unsupported field.');}
function source(value,label){keys(value,['url','sha256','revision'],label);let url;try{url=new URL(value.url);}catch{fail('XCHANGE_PROFILE_SOURCE',label+' needs its original HTTP(S) URL.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||! /^[a-f0-9]{64}$/.test(value.sha256??''))fail('XCHANGE_PROFILE_SOURCE',label+' needs an original URL and SHA-256.');return {url:value.url,sha256:value.sha256,revision:text(value.revision,label+' revision',256)};}
function override(value,label,withKey=false){keys(value,withKey?['supplierKey','value','numberTokens','reason']:['value','numberTokens','reason'],label);if(!object(value.value))fail('XCHANGE_PROFILE_HEADER',label+' must retain an original JSON object.');const out={value:clone(value.value),numberTokens:reconcileNumberTokens(value.value,value.numberTokens??{}),reason:text(value.reason,label+' reason',2000)};if(withKey)out.supplierKey=text(value.supplierKey,'Original supplier key',1024);if(own(out.value,withKey?'Product':'Supplier'))fail('XCHANGE_PROFILE_HEADER',label+' contains a streamed product/supplier array.');return out;}
export function isXChangeProfile(value){return value?.schema===XCHANGE_PROFILE_SCHEMA;}
export function normalizeXChangeProfile(value={}){
  keys(value,['schema','id','target','header','supplierHeaders','statusMapping','releasedModellingClasses','attachmentPolicy','source'],'xChange profile');
  if(value.schema!==XCHANGE_PROFILE_SCHEMA)fail('XCHANGE_PROFILE_SCHEMA','Select the native xChange supplier profile.');
  const p={schema:XCHANGE_PROFILE_SCHEMA,id:text(value.id??'etim-xchange-2.0','Profile ID',128),target:value.target??'xchange-2.0',header:null,supplierHeaders:[],statusMapping:null,releasedModellingClasses:[],attachmentPolicy:{keepMimeUrlCodes:[]},source:{schema:clone(XCHANGE_SCHEMA_SOURCE),recipient:clone(TWO_BA_SOURCE)}};
  if(!['xchange-2.0','2ba-xchange-2.0'].includes(p.target))fail('XCHANGE_PROFILE_TARGET','Choose native ETIM xChange2.0 or2BA xChange2.0.');
  if(value.header!==undefined&&value.header!==null)p.header=override(value.header,'Catalogue header');
  if(!Array.isArray(value.supplierHeaders??[]))fail('XCHANGE_PROFILE_SUPPLIER_HEADERS','Supplier overrides must be an array.');
  const supplierKeys=new Set();for(const item of value.supplierHeaders??[]){const v=override(item,'Supplier header',true);if(supplierKeys.has(v.supplierKey))fail('XCHANGE_PROFILE_SUPPLIER_HEADERS','A supplier has two header overrides.');supplierKeys.add(v.supplierKey);p.supplierHeaders.push(v);}p.supplierHeaders.sort((a,b)=>a.supplierKey.localeCompare(b.supplierKey,'en'));
  if(value.statusMapping!==undefined&&value.statusMapping!==null){
    keys(value.statusMapping,['source','product','tradeItem'],'Status mapping');
    const m={source:source(value.statusMapping.source,'Recipient status mapping'),product:{},tradeItem:{}};
    for(const kind of ['product','tradeItem']){if(!object(value.statusMapping[kind]??{}))fail('XCHANGE_STATUS_MAPPING','Map original status tokens to explicit recipient codes.');for(const[k,v]of Object.entries(value.statusMapping[kind]??{})){if(!STATUS.includes(k)||!['125','126','94E','130'].includes(v))fail('XCHANGE_STATUS_MAPPING','Use original xChange status tokens and recipient codes125/126/94E/130.');m[kind][k]=v;}}
    p.statusMapping=m;
  }
  if(!Array.isArray(value.releasedModellingClasses??[]))fail('XCHANGE_MODELLING_RELEASES','Released modelling classes must be source-bound rows.');
  const classes=new Set();for(const c of value.releasedModellingClasses??[]){keys(c,['code','version','source'],'Modelling release');if(!/^MC[0-9]{6}$/.test(c.code??'')||! /^[1-9][0-9]*$/.test(c.version??''))fail('XCHANGE_MODELLING_RELEASES','Retain the original MC class code and version string.');const k=c.code+':'+c.version;if(classes.has(k))fail('XCHANGE_MODELLING_RELEASES','A modelling class version is repeated.');classes.add(k);p.releasedModellingClasses.push({code:c.code,version:c.version,source:source(c.source,'Modelling release')});}
  if(value.attachmentPolicy!==undefined){keys(value.attachmentPolicy,['keepMimeUrlCodes'],'Attachment policy');if(!Array.isArray(value.attachmentPolicy.keepMimeUrlCodes??[])||(value.attachmentPolicy.keepMimeUrlCodes??[]).some(x=>typeof x!=='string'||!/^MDX[0-9]{3}$/.test(x)))fail('XCHANGE_ATTACHMENT_POLICY','KeepMimeURL selections must name original MDX codes.');p.attachmentPolicy.keepMimeUrlCodes=[...new Set(value.attachmentPolicy.keepMimeUrlCodes??[])].sort();}
  if(Buffer.byteLength(JSON.stringify(p))>1024*1024)fail('XCHANGE_PROFILE_SIZE','The complete source-bound profile exceeds1MiB.');
  return p;
}
export function xChangeTemplates(target='xchange-2.0'){
  const profile=normalizeXChangeProfile({schema:XCHANGE_PROFILE_SCHEMA,target});
  return {schema:'stellar-forge.supplier-templates.v1',profileId:profile.id,source:profile.source,profile,
    bindings:{'/supplierProductId':'/materialId','/xChange':'/attributes/xChange'},
    catalogMapping:{schema:'stellar-forge.material-catalog-mapping.v1',fields:{materialId:'materialId',title:'title',partNumber:'/xChange/product/ProductIdentification/ManufacturerProductNumber',manufacturer:'/xChange/product/ProductIdentification/ManufacturerName'},references:[{kind:'manufacturer-product',value:'/xChange/product/ProductIdentification/ManufacturerProductNumber'},{kind:'gtin',value:'/xChange/product/ProductIdentification/ProductGtin'}],attributes:{xChange:'/xChange'},identifierPolicy:'exact',unitAliases:{},delta:null},
    product:{supplierProductId:'',xChange:{schema:XCHANGE_PRODUCT_RECORD,catalogue:{header:{},numberTokens:{}},supplier:{key:'',header:{},numberTokens:{}},product:{ProductIdentification:{ManufacturerName:'',ManufacturerProductNumber:''}},numberTokens:{},source:{}}}};
}
export function effectiveXChange(product,profile){
  const selected=isXChangeProfile(profile)?normalizeXChangeProfile(profile):profile;
  if(!object(product)||!object(product.xChange)||product.xChange.schema!==XCHANGE_PRODUCT_RECORD)fail('XCHANGE_PRODUCT_NATIVE_REQUIRED','Map the complete native xChange product and its original header/token context.');
  const x=clone(product.xChange);
  if(!object(x.catalogue)||!object(x.supplier)||!object(x.product)||!object(x.catalogue.header)||!object(x.supplier.header)||!object(x.source))fail('XCHANGE_PRODUCT_CONTEXT_REQUIRED','The native product requires complete retained catalogue and supplier headers and its original source object.');
  if(selected.header){x.catalogue.header=clone(selected.header.value);x.catalogue.numberTokens=clone(selected.header.numberTokens);}
  const supplier=selected.supplierHeaders.find(v=>v.supplierKey===x.supplier.key);
  if(supplier){x.supplier.header=clone(supplier.value);x.supplier.numberTokens=clone(supplier.numberTokens);}
  reconcileNumberTokens(x.product,x.numberTokens??{});reconcileNumberTokens(x.catalogue.header,x.catalogue.numberTokens??{});reconcileNumberTokens(x.supplier.header,x.supplier.numberTokens??{});
  return x;
}
export function xChangeSupplierKey(header){for(const field of ['SupplierIdGln','SupplierIdDuns','SupplierVatNo','SupplierName'])if(typeof header?.[field]==='string'&&header[field].length)return digest(['xchange-recipient-supplier',field,header[field]]);return null;}
export function xChangeProductIdentity(x){
  const supplierKey=xChangeSupplierKey(x.supplier.header),id=x.product.ProductIdentification;
  let manufacturer=null;for(const field of ['ManufacturerIdGln','ManufacturerIdDuns','ManufacturerName'])if(typeof id?.[field]==='string'&&id[field].length){manufacturer=[field,id[field]];break;}
  const identifier=typeof id?.ManufacturerProductNumber==='string'?id.ManufacturerProductNumber:'';
  return {supplierKey,manufacturer,identifier,key:supplierKey&&manufacturer&&identifier?digest(['xchange-recipient-product',supplierKey,manufacturer,identifier]):null};
}
export function xChangeTradeIdentity(item,supplierKey){const identifier=typeof item?.ItemIdentification?.SupplierItemNumber==='string'?item.ItemIdentification.SupplierItemNumber:'';return {identifier,key:supplierKey&&identifier?digest(['xchange-recipient-trade-item',supplierKey,identifier]):null};}
export function xChangeFinding(severity,code,path,message,section='Recipient rules'){return{severity,code,path,message,rule:{url:TWO_BA_SOURCE.url,section}};}
export function checkXChangeProduct(product,profile,context={}){
  const selected=normalizeXChangeProfile(profile),findings=[];let x;
  try{x=effectiveXChange(product,selected);}catch(error){return{product:clone(product),findings:[xChangeFinding('error',error.code??'XCHANGE_NATIVE_CONTEXT','/xChange',error.message,'Original source context')]};}
  findings.push(...validateXChange(x.product,{schema:XCHANGE_PRODUCT_SCHEMA,numberTokens:x.numberTokens??{},path:'/xChange/product',schemaPath:'/properties/Supplier/items/properties/Product/items'}));
  const add=(severity,code,path,message,section)=>findings.push(xChangeFinding(severity,code,path,message,section));
  const source=x.source,document=source?.document;
  if(!object(source)||!object(document)||!Number.isSafeInteger(document.bytes)||document.bytes<1||! /^[a-f0-9]{64}$/.test(document.sha256??'')||!Number.isSafeInteger(source.byteStart)||!Number.isSafeInteger(source.byteEnd)||source.byteStart<0||source.byteEnd<=source.byteStart||source.byteEnd>document.bytes||source.bytes!==source.byteEnd-source.byteStart||! /^[a-f0-9]{64}$/.test(source.sha256??'')||typeof source.path!=='string'||!source.path.startsWith('/Supplier/'))add('error','XCHANGE_SOURCE_CONTEXT','/xChange/source','Retain the original complete document and product byte-range identities from native intake.','Source context');
  if(typeof x.supplier.key!=='string'||! /^[a-f0-9]{64}$/.test(x.supplier.key)||!Number.isSafeInteger(x.supplier.index)||x.supplier.index<0)add('error','XCHANGE_SUPPLIER_CONTEXT','/xChange/supplier','Retain the original supplier group key and source index.','Source context');
  const id=xChangeProductIdentity(x),p=x.product;
  if(!id.key)add('error','XCHANGE_PRODUCT_IDENTITY','/xChange/product/ProductIdentification','Retain the exact supplier, manufacturer and manufacturer product identifiers.','Root tree / product identity');
  if(!Array.isArray(p.TradeItem)&&p.TradeItem!==undefined)add('error','XCHANGE_TRADE_ARRAY','/xChange/product/TradeItem','TradeItem must remain its original array.','Schema');
  const tradeIds=new Set();for(let i=0;i<(Array.isArray(p.TradeItem)?p.TradeItem.length:0);i++){const item=p.TradeItem[i],identity=xChangeTradeIdentity(item,id.supplierKey),path='/xChange/product/TradeItem/'+i;if(!identity.key)add('error','XCHANGE_TRADE_IDENTITY',path+'/ItemIdentification/SupplierItemNumber','Retain the original supplier trade item number.','Root tree / trade item identity');else if(tradeIds.has(identity.key))add('error','XCHANGE_TRADE_REPEATED',path+'/ItemIdentification/SupplierItemNumber','This product repeats one supplier trade item number.','Root tree / trade item identity');tradeIds.add(identity.key);}
  if(selected.target==='2ba-xchange-2.0'){
    if(!/^[0-9]{13}$/.test(x.supplier.header.SupplierIdGln??''))add('error','TWO_BA_SUPPLIER_GLN','/xChange/supplier/header/SupplierIdGln','The2BA recipient requires the supplying party GLN.','Root tree, point2');
    const pi=object(p.ProductIdentification)?p.ProductIdentification:{},brands=Array.isArray(pi.BrandDetails)?pi.BrandDetails:[];
    if(typeof pi.BrandName!=='string'||!pi.BrandName.length)add('error','TWO_BA_BRAND','/xChange/product/ProductIdentification/BrandName','Supply the original brand.','Descriptions, brand, serie and type');
    for(const[field,label]of [['BrandSeries','series'],['BrandSeriesVariation','type']])if(!brands.some(b=>object(b)&&Array.isArray(b[field])&&b[field].some(v=>object(v)&&typeof v[field]==='string'&&v[field].length)))add('error','TWO_BA_'+label.toUpperCase(),'/xChange/product/ProductIdentification/BrandDetails','Supply the original '+label+'; use RNV_NA only when the supplier has explicitly declared it inapplicable.','Descriptions, brand, serie and type');
    for(let i=0;i<(Array.isArray(p.TradeItem)?p.TradeItem.length:0);i++){
      const item=p.TradeItem[i],base='/xChange/product/TradeItem/'+i;if(!object(item))continue;
      for(const field of ['UseUnit','UseUnitConversionFactor'])if(!object(item.Ordering)||!own(item.Ordering,field))add('error','TWO_BA_ORDER_'+field.toUpperCase(),base+'/Ordering/'+field,'The2BA recipient requires '+field+'.','Order price details, point3');
      for(let j=0;j<(Array.isArray(item.Pricing)?item.Pricing.length:0);j++)for(const field of ['PriceUnitFactor','PriceOnRequest','PriceValidityDate'])if(object(item.Pricing[j])&&!own(item.Pricing[j],field))add('error','TWO_BA_PRICE_'+field.toUpperCase(),base+'/Pricing/'+j+'/'+field,'The2BA recipient requires '+field+'.','Order price details, point3');
      if(x.catalogue.header.CatalogueType==='CHANGE'){
        const status=item.ItemDetails?.ItemStatus,code=selected.statusMapping?.tradeItem?.[status];
        if(!code)add('error','TWO_BA_TRADE_STATUS_MAPPING',base+'/ItemDetails/ItemStatus','Select the original2BA mapping for this native status before materializing a CHANGE trade-item action.','Statuscode; Mapping trade item status code');
      }
      if(item.ItemRelations?.length)add('warning','TWO_BA_ITEM_RELATIONS_UNMAPPED',base+'/ItemRelations','The complete native relationships are retained;2BA maps relationships only at product level.','Reference items');
      for(let j=0;j<(Array.isArray(item.ItemLogisticDetails)?item.ItemLogisticDetails.length:0);j++){const row=item.ItemLogisticDetails[j];if(object(row)&&Object.entries(row).some(([k,v])=>/Unit$/.test(k)&&['INH','FOT','YRD','LBR','ONZ','FTQ','INQ'].includes(v)))add('warning','TWO_BA_IMPERIAL_LOGISTICS',base+'/ItemLogisticDetails/'+j,'The native imperial measurements remain in the message; the2BA projection selects only metric logistic records.','Logistics information, point1');}
    }
    for(let i=0;i<(Array.isArray(p.EtimClassification)?p.EtimClassification.length:0);i++){
      const c=p.EtimClassification[i],base='/xChange/product/EtimClassification/'+i;if(!object(c))continue;
      if(c.EtimModellingClassCode&&!selected.releasedModellingClasses.some(v=>v.code===c.EtimModellingClassCode&&v.version===String(c.EtimModellingClassVersion)))add('error','TWO_BA_MODELLING_RELEASE',base+'/EtimModellingClassVersion','Select the original released ETIM modelling class version and its source.','ETIM Modelclass (MC)');
      for(let j=0;j<(Array.isArray(c.EtimFeatures)?c.EtimFeatures.length:0);j++)if(object(c.EtimFeatures[j])&&Object.entries(c.EtimFeatures[j]).some(([k,v])=>k.startsWith('EtimValue')&&v==='-'))add('warning','TWO_BA_MINUS_NOT_IMPORTED',base+'/EtimFeatures/'+j,'A minus value is not imported; retain an explicitly selected NA/MV/UN reason when the supplier provides one.','Reason no value');
    }
    if(Array.isArray(p.LcaEnvironmental?.LcaDeclaration)&&p.LcaEnvironmental.LcaDeclaration.length&&!(Array.isArray(p.ProductAttachments)&&p.ProductAttachments.some(a=>object(a)&&a.AttachmentType==='ATX004'&&a.AttachmentTypeSpecification==='MDX054')))add('warning','TWO_BA_EPD_ATTACHMENT','/xChange/product/ProductAttachments','The recipient environmental workflow also uses its EPD attachment (ATX004/MDX054).','Environmental data');
  }
  if(context.findNativeProduct)for(let i=0;i<(Array.isArray(p.ProductRelations)?p.ProductRelations.length:0);i++)for(let j=0;j<(Array.isArray(p.ProductRelations[i]?.RelatedProducts)?p.ProductRelations[i].RelatedProducts.length:0);j++){const r=p.ProductRelations[i].RelatedProducts[j];if(object(r)&&r.RelatedManufacturerProductNumber&&!context.findNativeProduct(id.supplierKey,id.manufacturer,r.RelatedManufacturerProductNumber))add('warning','XCHANGE_RELATION_EXTERNAL','/xChange/product/ProductRelations/'+i+'/RelatedProducts/'+j,'This original related product is outside the selected current or previous recipient state.','Reference items');}
  return {product:clone(product),findings};
}
export function checkXChangeCoverage(productIds,profile){normalizeXChangeProfile(profile);const seen=new Set(),findings=[];let count=0;for(const id of productIds){count++;if(!id)findings.push(xChangeFinding('error','XCHANGE_MATERIAL_ID_REQUIRED','/supplierProductIds/'+(count-1),'A complete review needs its retained material identity.','Source intake'));else if(seen.has(id))findings.push(xChangeFinding('error','XCHANGE_MATERIAL_ID_REPEATED','/supplierProductIds/'+(count-1),'This retained material is repeated.','Source intake'));seen.add(id);}if(!count)findings.push(xChangeFinding('error','XCHANGE_EMPTY_MESSAGE','/supplierProductIds','A native xChange delivery must contain a supplier product.','Schema Supplier/Product minItems'));return{productCount:count,distinctProductCount:seen.size,expectedProductCount:null,findings};}
