// MIT. Retained customer declarations for the original openTRANS 1.0 adapter.
import { digest as nativeDigest, WorkspaceError } from '../opensearch/workspace/store.mjs';

export const SUPPLIER_ORDER_PROFILE_SCHEMA='stellar-forge.supplier-order-profile.v1';
export const SUPPLIER_ORDER_PROFILE_SELECTION_SCHEMA='stellar-forge.supplier-order-profile-selection.v1';
export const DEFAULT_SUPPLIER_ORDER_PROFILE_ID='unite-opentrans-1.0';
export const MAX_SUPPLIER_ORDER_PROFILE_BYTES=32768;
const KINDS=['ORDER','ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(message,details){const e=new WorkspaceError('ORDER_PROFILE_INVALID',message,422);if(details)e.details=details;throw e;}
function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';}
function copy(value){return JSON.parse(JSON.stringify(value));}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function text(value,label,max,{empty=false}={}){if(typeof value!=='string'||(!empty&&!value.trim())||value.includes('\0')||[...value].length>max)fail(label+' must be an explicit string of '+(empty?'0':'1')+'–'+max+' characters.');return value;}
function keys(value,names,label){if(!object(value))fail(label+' must be an object.');for(const key of Object.keys(value))if(!names.includes(key))fail('Unknown '+label+' field: '+key);return value;}
function bool(value,label){if(typeof value!=='boolean')fail(label+' must be true or false.');return value;}
function option(value,values,label){if(!values.includes(value))fail('Choose '+label+' from '+values.join(', ')+'.');return value;}
function strings(value,label,{max=32,width=128,allowed,pattern}={}){if(!Array.isArray(value)||value.length>max)fail(label+' must be an array with at most '+max+' entries.');const seen=new Set();return value.map(item=>{text(item,label,width);if(seen.has(item)||allowed&&!allowed.includes(item)||pattern&&!pattern.test(item))fail('Invalid or repeated '+label+' value: '+item);seen.add(item);return item;});}
function url(value){if(value===null)return null;text(value,'Declaration URL',2048);let parsed;try{parsed=new URL(value);}catch{fail('The declaration URL must be an absolute HTTP or HTTPS URL.');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)fail('Use a declaration URL without credentials.');return value;}
function pointer(value){text(value,'Required field pointer',512);if(!value.startsWith('/')||/(?:~(?![01]))/.test(value))fail('Use an absolute JSON pointer, with * only for array members.');const parts=value.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));if(parts.length>16||parts.some(x=>!x||['__proto__','constructor','prototype'].includes(x)))fail('The required field pointer is invalid or too deep.');if(!['header','items','summary','documentId','orderId','kind','version'].includes(parts[0]))fail('Required fields must address original document values, not raw XML, source metadata or a profile.');return value;}

const DEFAULT=freeze({
  schema:SUPPLIER_ORDER_PROFILE_SCHEMA,id:DEFAULT_SUPPLIER_ORDER_PROFILE_ID,revision:1,
  title:'Unite supplier openTRANS 1.0',format:'openTRANS',version:'1.0',
  declaration:{reference:'Unite supplier EDI interfaces and retained original openTRANS 1.0 source',url:'https://support.unite.eu/en-gb/for-suppliers/edi-interfaces-for-order-processing',sourceSha256:null,notes:''},
  orderIdMaximum:21,
  supplierIdentity:{partyIdTypes:['buyer_specific'],allowUniqueFallback:true,inheritOrderResponse:true},
  confirmation:{negativeQuantity:'cancel',omittedLines:'retain'},
  serials:{remarks:'unite-number'},
  validation:{currencies:[],units:[],invoiceTaxRate:true,invoiceDeliveryReference:true,invoiceParties:['buyer','supplier','invoice'],confirmationDeliveryWarning:true,dispatchTrackingWarning:true,requiredFields:[]}
});
export function defaultSupplierOrderProfile(){return DEFAULT;}
export function supplierOrderProfileTemplate({base='standard'}={}){
  option(base,['standard','unite'],'profile template');
  const profile=copy(DEFAULT);profile.id='customer-opentrans-1.0';profile.title='Customer openTRANS 1.0';
  profile.declaration={reference:'',url:null,sourceSha256:null,notes:'Record the selected customer interface revision and original source corpus before selecting this profile.'};
  if(base==='standard'){
    profile.orderIdMaximum=250;profile.supplierIdentity.partyIdTypes=[];
    profile.serials.remarks='opaque';profile.validation.invoiceTaxRate=false;
    profile.validation.invoiceDeliveryReference=false;profile.validation.invoiceParties=['buyer','supplier'];
    profile.validation.confirmationDeliveryWarning=false;profile.validation.dispatchTrackingWarning=false;
  }
  return profile;
}
export function normalizeSupplierOrderProfile(value){
  if(value===undefined||value===null)return DEFAULT;
  keys(value,['schema','id','revision','title','format','version','declaration','orderIdMaximum','supplierIdentity','confirmation','serials','validation'],'profile');
  if(value.schema!==SUPPLIER_ORDER_PROFILE_SCHEMA||value.format!=='openTRANS'||value.version!=='1.0')fail('This adapter requires an explicitly declared openTRANS 1.0 profile. Other source formats need their selected source adapter.');
  if(typeof value.id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(value.id))fail('Use a lowercase ASCII profile ID of at most 96 characters.');
  if(!Number.isSafeInteger(value.revision)||value.revision<1)fail('Declare the positive integer interface revision.');
  text(value.title,'Profile title',240);
  const d=keys(value.declaration,['reference','url','sourceSha256','notes'],'declaration');
  text(d.reference,'Selected interface reference',2000);url(d.url);text(d.notes,'Declaration notes',8000,{empty:true});
  if(d.sourceSha256!==null&&(typeof d.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(d.sourceSha256)))fail('Declare the original source SHA-256 or explicit null.');
  if(!Number.isSafeInteger(value.orderIdMaximum)||value.orderIdMaximum<1||value.orderIdMaximum>250)fail('Choose an order-number limit between 1 and 250 characters.');
  const identity=keys(value.supplierIdentity,['partyIdTypes','allowUniqueFallback','inheritOrderResponse'],'supplier identity');
  strings(identity.partyIdTypes,'PARTY_ID type priority',{max:16,width:128});bool(identity.allowUniqueFallback,'Unique supplier identity fallback');bool(identity.inheritOrderResponse,'Confirmation supplier inheritance');
  const confirmation=keys(value.confirmation,['negativeQuantity','omittedLines'],'confirmation');
  option(confirmation.negativeQuantity,['cancel','reject'],'negative confirmation quantity');option(confirmation.omittedLines,['retain','require-complete'],'omitted confirmation lines');
  const serials=keys(value.serials,['remarks'],'serials');option(serials.remarks,['unite-number','opaque'],'serial REMARK interpretation');
  const v=keys(value.validation,['currencies','units','invoiceTaxRate','invoiceDeliveryReference','invoiceParties','confirmationDeliveryWarning','dispatchTrackingWarning','requiredFields'],'validation');
  strings(v.currencies,'currency',{max:64,width:3,pattern:/^[A-Z]{3}$/});strings(v.units,'order unit',{max:64,width:32});
  for(const name of ['invoiceTaxRate','invoiceDeliveryReference','confirmationDeliveryWarning','dispatchTrackingWarning'])bool(v[name],name);
  strings(v.invoiceParties,'invoice party',{max:3,width:32,allowed:['buyer','supplier','invoice']});
  if(!Array.isArray(v.requiredFields)||v.requiredFields.length>32)fail('Declare at most 32 sourced required-field rules.');
  const seen=new Set();
  for(const rule of v.requiredFields){
    keys(rule,['kinds','path','when','severity','message','reference'],'required-field rule');
    strings(rule.kinds,'document kind',{max:4,width:32,allowed:KINDS});if(!rule.kinds.length)fail('Select at least one document kind for every rule.');
    pointer(rule.path);option(rule.when,['always','output'],'required-field scope');option(rule.severity,['error','warning'],'finding severity');
    text(rule.message,'Required-field explanation',1000);text(rule.reference,'Required-field source reference',2000);
    const id=stable([rule.kinds,rule.path,rule.when]);if(seen.has(id))fail('Do not repeat the same required-field rule.');seen.add(id);
  }
  const result=copy(value);
  if(Buffer.byteLength(stable(result),'utf8')>MAX_SUPPLIER_ORDER_PROFILE_BYTES)fail('The complete declared profile exceeds 32 KiB.');
  if(result.id===DEFAULT_SUPPLIER_ORDER_PROFILE_ID&&stable(result)!==stable(DEFAULT))fail('The existing Unite profile is immutable. Use a distinct customer profile ID for different rules.');
  return freeze(result);
}
export function supplierOrderProfileSha256(value){return nativeDigest(stable(normalizeSupplierOrderProfile(value)));}
export function supplierOrderProfileFields(value){
  const profile=normalizeSupplierOrderProfile(value);
  return profile.id===DEFAULT_SUPPLIER_ORDER_PROFILE_ID?{profileId:profile.id}:{profileId:profile.id,profileSha256:supplierOrderProfileSha256(profile),profile:copy(profile)};
}
export function supplierOrderDocumentProfile(document){
  if(document?.profileId===DEFAULT_SUPPLIER_ORDER_PROFILE_ID){
    if(document.profile!==undefined&&stable(normalizeSupplierOrderProfile(document.profile))!==stable(DEFAULT))fail('The original Unite document has a different declared profile.');
    if(document.profileSha256!==undefined&&document.profileSha256!==supplierOrderProfileSha256(DEFAULT))fail('The original Unite document profile SHA differs.');
    return DEFAULT;
  }
  const profile=normalizeSupplierOrderProfile(document?.profile);
  if(!document||profile.id===DEFAULT_SUPPLIER_ORDER_PROFILE_ID||profile.id!==document.profileId||supplierOrderProfileSha256(profile)!==document.profileSha256)fail('Retain the complete selected customer profile and its exact SHA-256 with this document.');
  return profile;
}
export function supplierOrderProfilesEqual(left,right){return supplierOrderProfileSha256(left)===supplierOrderProfileSha256(right);}
export function supplierOrderProfileFindings(document,{forOutput=false}={}){
  const profile=supplierOrderDocumentProfile(document),findings=[];
  if(profile.id===DEFAULT_SUPPLIER_ORDER_PROFILE_ID)return findings;
  const source={url:profile.declaration.url,reference:profile.declaration.reference,profileId:profile.id,profileRevision:profile.revision,profileSha256:supplierOrderProfileSha256(profile)};
  const add=(code,path,message,severity='error',reference=null)=>findings.push({code,path,message,severity,rule:{...source,...(reference?{reference}: {})}});
  const v=profile.validation;
  for(let index=0;index<(document.items??[]).length;index++){
    const item=document.items[index],currency=item.price?.currency??document.header?.currency??null;
    if(v.currencies.length&&currency&&!v.currencies.includes(currency))add('PROFILE_CURRENCY_NOT_DECLARED','/items/'+index+'/price/currency','This effective currency is outside the selected interface declaration.');
    if(v.units.length&&item.unit&&!v.units.includes(item.unit))add('PROFILE_UNIT_NOT_DECLARED','/items/'+index+'/unit','This order unit is outside the selected interface declaration; no implicit unit conversion is performed.');
  }
  if(v.currencies.length&&document.header?.currency&&!v.currencies.includes(document.header.currency))add('PROFILE_CURRENCY_NOT_DECLARED','/header/currency','This header currency is outside the selected interface declaration.');
  for(const rule of v.requiredFields){
    if(!rule.kinds.includes(document.kind)||rule.when==='output'&&!forOutput)continue;
    const parts=rule.path.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));
    const visit=(value,index,path)=>{
      if(index===parts.length){if(value===undefined||value===null||typeof value==='string'&&!value.trim()||Array.isArray(value)&&!value.length)add('PROFILE_FIELD_REQUIRED',path||'/',rule.message,rule.severity,rule.reference);return;}
      const part=parts[index];if(part==='*'){
        if(!Array.isArray(value)||!value.length){add('PROFILE_FIELD_REQUIRED',path+'/*',rule.message,rule.severity,rule.reference);return;}
        for(let n=0;n<value.length;n++)visit(value[n],index+1,path+'/'+n);
      }else visit(value&&typeof value==='object'&&Object.hasOwn(value,part)?value[part]:undefined,index+1,path+'/'+part.replaceAll('~','~0').replaceAll('/','~1'));
    };visit(document,0,'');
  }
  return findings;
}
