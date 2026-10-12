// MIT. Whole native JSON and recipient impact exports from immutable supplier reviews.
import { createHash } from 'node:crypto';
import { canonical,digest,clone } from '../../../workspace/store.mjs';
import { fail,verifySealed,ROW_SCHEMA } from '../model.mjs';
import { effectiveXChange,normalizeXChangeProfile } from './profile.mjs';
import { exactJSON,XCHANGE_SCHEMA,XCHANGE_SUPPLIER_SCHEMA,XCHANGE_PRODUCT_SCHEMA } from './schema.mjs';
import { RECIPIENT_SCHEMA,xChangeRecipientRoot } from './recipient.mjs';
import { twoBaParametersDescriptor } from './processing.mjs';
import { twoBaArchiveDescriptor } from './package.mjs';
const parse=row=>JSON.parse(row.record_json);
const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
function assertRecipient(db,review){if(!review.recipient||xChangeRecipientRoot(db,review.id)!==review.recipient.rowsRootSha256)fail('XCHANGE_RECIPIENT_CHANGED','The immutable recipient review changed.',409);}
function* recipientRows(db,review){for(const row of db.prepare('SELECT record_json FROM catalog_supplier_recipient WHERE review_id=? ORDER BY kind,record_key').iterate(review.id))yield verifySealed(parse(row),RECIPIENT_SCHEMA);}
function* nativeRows(db,review){for(const row of db.prepare("SELECT record_json FROM catalog_supplier_products WHERE review_id=? ORDER BY json_extract(record_json,'$.product.xChange.source.document.sha256'),json_extract(record_json,'$.product.xChange.supplier.key'),json_extract(record_json,'$.product.xChange.supplier.index'),json_extract(record_json,'$.product.xChange.source.byteStart'),material_key").iterate(review.id))yield verifySealed(parse(row),ROW_SCHEMA);}
function* objectWithArray(header,tokens,schema,arrayKey,body){
  yield '{';let first=true;const keys=[...new Set([...Object.keys(schema.properties??{}),...Object.keys(header),arrayKey])];
  for(const key of keys){if(key!==arrayKey&&!Object.hasOwn(header,key))continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';if(key===arrayKey){yield '[';yield*body;yield ']';}else{const selected={};for(const[p,v]of Object.entries(tokens??{}))if(p==='/'+key||p.startsWith('/'+key+'/'))selected[p.slice(key.length+1)]=v;yield*exactJSON(header[key],{numberTokens:selected,schema:schema.properties?.[key]});}}
  yield '}';
}
export function exportXChangeReview(db,review,format){
  assertRecipient(db,review);const profile=normalizeXChangeProfile(review.plan.profile);
  const name='ETIM_XCHANGE_'+review.id+'_';
  const uploadPackage=format==='2ba.zip';
  let parameters=null;
  if(uploadPackage||format==='parameters.xml'){
    parameters=twoBaParametersDescriptor(profile);
    if(format==='parameters.xml')return parameters;
    format='xchange.json';
  }
  if(format==='recipient.jsonl'){
    const body=(function*(){yield JSON.stringify({kind:'recipient-review',reviewId:review.id,reviewSha256:review.sha256,recipient:review.recipient,profile})+'\n';for(const row of recipientRows(db,review))yield JSON.stringify(row)+'\n';})();
    return{type:'application/x-ndjson; charset=utf-8',filename:name+'recipient.jsonl',body};
  }
  if(format==='impact.csv'){
    const body=(function*(){yield ['kind','supplierKey','identifier','productKey','materialKey','action','beforeSha256','afterSha256','recipientCode'].map(csv).join(',')+'\r\n';for(const row of recipientRows(db,review))yield [row.kind,row.supplierKey,row.identifier,row.productKey,row.materialKey,row.action,row.beforeSha256,row.afterSha256,row.after?.status?.recipientCode??''].map(csv).join(',')+'\r\n';})();
    return{type:'text/csv; charset=utf-8',filename:name+'impact.csv',body};
  }
  if(format!=='xchange.json')fail('XCHANGE_EXPORT_FORMAT','Select xchange.json, recipient.jsonl, impact.csv, parameters.xml or 2ba.zip.');
  if(review.counts.errors||!review.counts.total)fail('XCHANGE_CORRECTIONS_REQUIRED','Resolve the immutable review findings before exporting the complete native message.');
  const body=(function*(){
    const iterator=nativeRows(db,review)[Symbol.iterator]();let current=iterator.next(),productCount=0,supplierCount=0;
    try{
      function* suppliers(){
        let firstSupplier=true;
        while(!current.done){
          const initial=effectiveXChange(current.value.product,profile),group=canonical([initial.source?.document?.sha256,initial.supplier.key,initial.supplier.index]),supplierHeader=initial.supplier.header,supplierTokens=initial.supplier.numberTokens??{};
          if(!firstSupplier)yield ',';firstSupplier=false;supplierCount++;
          function* products(){let first=true;while(!current.done){const x=effectiveXChange(current.value.product,profile);if(canonical([x.source?.document?.sha256,x.supplier.key,x.supplier.index])!==group)break;if(canonical({header:x.supplier.header,numberTokens:x.supplier.numberTokens??{}})!==canonical({header:supplierHeader,numberTokens:supplierTokens}))fail('XCHANGE_EXPORT_HEADER_CHANGED','The original supplier group has conflicting reviewed headers.',409);if(!first)yield ',';first=false;yield*exactJSON(x.product,{numberTokens:x.numberTokens??{},schema:XCHANGE_PRODUCT_SCHEMA});productCount++;current=iterator.next();}}
          yield*objectWithArray(supplierHeader,supplierTokens,XCHANGE_SUPPLIER_SCHEMA,'Product',products());
        }
      }
      yield*objectWithArray(review.recipient.header,review.recipient.headerNumberTokens??{},XCHANGE_SCHEMA,'Supplier',suppliers());yield '\n';
      if(productCount!==review.counts.total)fail('XCHANGE_EXPORT_COUNT_CHANGED','The original reviewed native product coverage changed.',409);
      if(!supplierCount)fail('XCHANGE_EXPORT_EMPTY','The original message contains no supplier.');
    }finally{iterator.return?.();}
  })();
  const dataset={type:'application/json; charset=utf-8',filename:name+String(review.recipient.processing?.nativeCatalogueType??review.recipient.catalogueType??'catalogue')+'.json',body};
  return uploadPackage?twoBaArchiveDescriptor({review,dataset,parameters}):dataset;
}
