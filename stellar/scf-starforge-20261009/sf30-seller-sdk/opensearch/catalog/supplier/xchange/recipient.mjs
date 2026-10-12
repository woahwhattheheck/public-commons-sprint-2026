// MIT. Immutable xChange recipient state and FULL/CHANGE impact on the original supplier review.
import { createHash } from 'node:crypto';
import { clone, canonical, digest } from '../../../workspace/store.mjs';
import { seal, verifySealed, fail, rowCounts } from '../model.mjs';
import { XCHANGE_SCHEMA,XCHANGE_SUPPLIER_SCHEMA,validateXChange,sliceNumberTokens,object } from './schema.mjs';
import { normalizeXChangeProfile,effectiveXChange,xChangeProductIdentity,xChangeTradeIdentity,
  xChangeFinding,checkXChangeCoverage } from './profile.mjs';
import { twoBaProcessingEffects, applyTwoBaRetainedFields, TWO_BA_PROCESSING_SOURCE } from './processing.mjs';
export const RECIPIENT_SCHEMA='stellar-forge.xchange-recipient-record.v1';
export const RECIPIENT_REVIEW_SCHEMA='stellar-forge.xchange-recipient-review.v1';
const parse=row=>row?JSON.parse(row.record_json):null;
const own=(v,k)=>Object.hasOwn(v,k);
function* selectedRows(db,reviewId){for(const row of db.prepare('SELECT record_json FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(reviewId))yield parse(row);}
function withoutTrade(product){const value=clone(product);delete value.TradeItem;return value;}
function nonTradeTokens(tokens){return Object.fromEntries(Object.entries(tokens??{}).filter(([path])=>path!=='/TradeItem'&&!path.startsWith('/TradeItem/')));}
function beforeRecord(db,reviewId,kind,key){if(!reviewId)return null;const row=parse(db.prepare('SELECT record_json FROM catalog_supplier_recipient WHERE review_id=? AND kind=? AND record_key=?').get(reviewId,kind,key));return row?.after??null;}
function afterIdentity(value){if(value===null)return null;const {provenance,...content}=value;return digest(content);}
export function xChangeRecipientRoot(db,reviewId){const hash=createHash('sha256');for(const row of db.prepare('SELECT kind,record_key,record_json FROM catalog_supplier_recipient WHERE review_id=? ORDER BY kind,record_key').iterate(reviewId))hash.update(row.kind+':'+row.record_key+':'+parse(row).sha256+'\n');return hash.digest('hex');}
function projection(item,product,profile){
  const descriptions=(Array.isArray(product.ProductDetails?.ProductDescriptions)?product.ProductDetails.ProductDescriptions:[]).filter(object);
  const logistics=(Array.isArray(item.ItemLogisticDetails)?item.ItemLogisticDetails:[]).filter(object);
  const packaging=Array.isArray(item.PackagingUnit)?item.PackagingUnit:[];
  return {marketing:descriptions.filter(d=>typeof d.ProductMarketingText==='string').map(d=>({language:d.DescriptionLanguage??null,value:d.ProductMarketingText})),
    deepLinks:descriptions.filter(d=>typeof d.ProductPageUrl==='string').map(d=>({language:d.DescriptionLanguage??null,value:d.ProductPageUrl})),
    metricLogistics:logistics.filter(row=>!Object.entries(row).some(([k,v])=>/Unit$/.test(k)&&['INH','FOT','YRD','LBR','ONZ','FTQ','INQ'].includes(v))),
    packaging:packaging.flatMap((v,index)=>object(v)?[{index,sourceCode:v.PackagingIdentification?.PackagingTypeCode??null,recipientCode:v.PackagingIdentification?.PackagingTypeCode==='C62'?'NE':null}]:[]),
    minimumDeliveryCalendarDays:item.Ordering?.StandardOrderLeadTime??null,keepMimeUrlCodes:profile.attachmentPolicy.keepMimeUrlCodes};
}
export function deriveXChangeRecipient(db,reviewId,plan,{write=true}={}){
  const profile=normalizeXChangeProfile(plan.profile),findings=[];
  const add=(severity,code,path,message,section)=>{
    const finding=xChangeFinding(severity,code,path,message,section);
    if(path.startsWith('/profile/processing'))finding.rule.url=TWO_BA_PROCESSING_SOURCE.url;
    findings.push(finding);
  };
  let previous=null;if(plan.previousReviewId){previous=parse(db.prepare('SELECT record_json FROM catalog_supplier_reviews WHERE id=?').get(plan.previousReviewId));if(!previous||previous.catalogId!==plan.catalogId||previous.tenantId!==plan.tenantId||!previous.recipient||previous.recipient.target!==profile.target){add('error','XCHANGE_PREVIOUS_TARGET','/profile','Select an earlier native review of this same catalog, tenant and recipient target.','Type dataset');previous=null;}else if(previous.counts.errors)add('error','XCHANGE_PREVIOUS_REVIEW_ERRORS','/previousReviewId','The selected previous target contains unresolved review errors.','Type dataset');}
  const previousId=previous?.id??null;
  const prefix='xchange_compare_'+reviewId.replace(/[^A-Za-z0-9]/g,'');
  const table=write?'catalog_supplier_recipient':'temp.'+prefix;
  if(!write)db.exec('CREATE TEMP TABLE '+prefix+' (review_id TEXT NOT NULL,kind TEXT NOT NULL,record_key TEXT NOT NULL,supplier_key TEXT NOT NULL,identifier TEXT NOT NULL,action TEXT NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(review_id,kind,record_key))');
  else if(db.prepare('SELECT 1 FROM catalog_supplier_recipient WHERE review_id=? LIMIT 1').get(reviewId))fail('XCHANGE_RECIPIENT_EXISTS','This immutable recipient review already has rows.',409);
  const insert=db.prepare('INSERT INTO '+table+' VALUES(?,?,?,?,?,?,?)');
  const put=(kind,key,supplierKey,identifier,productKey,materialKey,before,after,action,processing=null)=>{
    const record=seal({schema:RECIPIENT_SCHEMA,reviewId,planId:plan.id,catalogId:plan.catalogId,tenantId:plan.tenantId,kind,key,supplierKey,identifier,productKey,materialKey:materialKey??null,action,beforeSha256:before===null?null:digest(before),afterSha256:after===null?null:digest(after),before:clone(before),after:clone(after),...(processing?{processing:clone(processing)}:{})});
    insert.run(reviewId,kind,key,supplierKey??'',identifier??'',action,JSON.stringify(record));return record;
  };
  const resultCounts={productsAdded:0,productsChanged:0,productsUnchanged:0,productsExpired:0,tradeItemsAdded:0,tradeItemsChanged:0,tradeItemsUnchanged:0,tradeItemsDeleted:0,productsTotal:0,tradeItemsTotal:0};
  const hasProcessing=own(profile,'processing');
  if(hasProcessing){resultCounts.productsSkipped=0;resultCounts.tradeItemsSkipped=0;}
  let header=null,headerNumberTokens={},catalogueType=null,processing=null,selectedCount=0,firstHeaderDigest=null,headerConflict=false,supplierCount=0,headerAttachments=false;
  try{
    for(const row of selectedRows(db,reviewId)){
      selectedCount++;let x;try{x=effectiveXChange(row.product,profile);}catch(error){add('error',error.code??'XCHANGE_CONTEXT','/materials/'+row.materialKey,error.message,'Source context');continue;}
      const ch=digest({header:x.catalogue.header,numberTokens:x.catalogue.numberTokens??{}});if(firstHeaderDigest===null)firstHeaderDigest=ch;else if(ch!==firstHeaderDigest)headerConflict=true;
      if(header===null){header=clone(x.catalogue.header);headerNumberTokens=clone(x.catalogue.numberTokens??{});processing=twoBaProcessingEffects(profile,header.CatalogueType??null);catalogueType=processing?.effectiveCatalogueType??header.CatalogueType??null;}
      const identity=xChangeProductIdentity(x),supplierKey=identity.supplierKey;
      const supplierHeader={header:clone(x.supplier.header),numberTokens:clone(x.supplier.numberTokens??{}),fieldOrder:clone(x.supplier.fieldOrder??[])};
      if(supplierKey){const saved=parse(db.prepare('SELECT record_json FROM '+table+' WHERE review_id=? AND kind=? AND supplier_key=? LIMIT 1').get(reviewId,'product',supplierKey)),prior=saved?.processing?.sourceSupplier??saved?.after?.supplier;if(prior&&canonical({header:prior.header,numberTokens:prior.numberTokens})!==canonical({header:supplierHeader.header,numberTokens:supplierHeader.numberTokens}))add('error','XCHANGE_SUPPLIER_HEADER_CONFLICT','/profile/supplierHeaders','One recipient supplier has inconsistent native headers across products.','Root tree');if(!prior){supplierCount++;headerAttachments||=Boolean(supplierHeader.header.SupplierAttachments?.length);findings.push(...validateXChange(supplierHeader.header,{schema:XCHANGE_SUPPLIER_SCHEMA,numberTokens:supplierHeader.numberTokens,omit:['Product'],path:'/profile/supplierHeaders/'+supplierKey,schemaPath:'/properties/Supplier/items'}));}}
      if(!identity.key)continue;
      if(db.prepare('SELECT 1 FROM '+table+' WHERE review_id=? AND kind=? AND record_key=?').get(reviewId,'product',identity.key)){add('error','XCHANGE_NATIVE_PRODUCT_REPEATED','/materials/'+row.materialKey,'The supplier/manufacturer/product identity is repeated across retained materials.','Root tree / product identity');continue;}
      const provenance={reviewId,materialKey:row.materialKey,source:clone(x.source),originalMaterialId:row.materialId};
      let productAfter={schema:'stellar-forge.xchange-recipient-product.v1',key:identity.key,supplierKey,manufacturer:identity.manufacturer,identifier:identity.identifier,supplier:clone(supplierHeader),product:withoutTrade(x.product),numberTokens:nonTradeTokens(x.numberTokens),status:{native:x.product.ProductDetails?.ProductStatus??null,recipientCode:profile.statusMapping?.product?.[x.product.ProductDetails?.ProductStatus]??null,expired:profile.target==='2ba-xchange-2.0'?profile.statusMapping?.product?.[x.product.ProductDetails?.ProductStatus]==='130':x.product.ProductDetails?.ProductStatus==='OBSOLETE'},provenance};
      const old=beforeRecord(db,previousId,'product',identity.key);
      let productProcessing=null,action;
      if(processing?.skipProducts){
        productAfter=clone(old);action='skipped';
        productProcessing={applied:false,parameter:'SkipLoadProducts',sourceSupplier:clone(supplierHeader)};
      }else{
        const retained=applyTwoBaRetainedFields({kind:'product',current:productAfter,previous:old,effects:processing});
        productAfter=retained.current;
        if(retained.unresolvedAttachments)add('error','TWO_BA_ATTACHMENT_CHOICE_REQUIRED','/profile/processing/parameters/InteractiveChecks','Choose how omitted previous product attachments are handled before packaging this delivery.','InteractiveChecks');
        if(processing)productProcessing={applied:true,retainedFields:retained.details};
        action=old===null?'added':productAfter.status.expired&&!old.status?.expired?'expired':afterIdentity(old)===afterIdentity(productAfter)?'unchanged':'changed';
      }
      put('product',identity.key,supplierKey,identity.identifier,identity.key,row.materialKey,old,productAfter,action,productProcessing);
      resultCounts['products'+action[0].toUpperCase()+action.slice(1)]++;if(productAfter)resultCounts.productsTotal++;
      for(let index=0;index<(Array.isArray(x.product.TradeItem)?x.product.TradeItem.length:0);index++){
        const item=x.product.TradeItem[index],trade=xChangeTradeIdentity(item,supplierKey);if(!trade.key)continue;
        if(db.prepare('SELECT 1 FROM '+table+' WHERE review_id=? AND kind=? AND record_key=?').get(reviewId,'tradeItem',trade.key)){add('error','XCHANGE_NATIVE_TRADE_REPEATED','/materials/'+row.materialKey+'/TradeItem/'+index,'The supplier trade item number is attached to more than one product in this delivery.','Root tree / trade item identity');continue;}
        const oldItem=beforeRecord(db,previousId,'tradeItem',trade.key),nativeStatus=item.ItemDetails?.ItemStatus??null,mappedStatus=profile.statusMapping?.tradeItem?.[nativeStatus]??null;
        const deleteItem=profile.target==='2ba-xchange-2.0'&&catalogueType==='CHANGE'&&mappedStatus==='130';
        let after=deleteItem?null:{schema:'stellar-forge.xchange-recipient-trade-item.v1',key:trade.key,supplierKey,productKey:identity.key,identifier:trade.identifier,item:clone(item),numberTokens:sliceNumberTokens(x.numberTokens,'/TradeItem/'+index),status:{native:nativeStatus,recipientCode:mappedStatus},recipientProjection:profile.target==='2ba-xchange-2.0'?projection(item,x.product,profile):null,provenance};
        let change,tradeProcessing=null;
        if(processing?.skipTradeItems){
          after=clone(oldItem);change='skipped';tradeProcessing={applied:false,parameter:'SkipLoadArticlesAndPrices'};
        }else{
          if(after){
            const retained=applyTwoBaRetainedFields({kind:'tradeItem',current:after,previous:oldItem,effects:processing});
            after=retained.current;
            if(retained.unresolvedAttachments)add('error','TWO_BA_ATTACHMENT_CHOICE_REQUIRED','/profile/processing/parameters/InteractiveChecks','Choose how omitted previous trade-item attachments are handled before packaging this delivery.','InteractiveChecks');
            if(processing)tradeProcessing={applied:true,retainedFields:retained.details};
          }else if(processing)tradeProcessing={applied:true,parameter:'PackageMutationCode',action:'delete'};
          change=deleteItem?'deleted':oldItem===null?'added':afterIdentity(oldItem)===afterIdentity(after)?'unchanged':'changed';
          if(deleteItem&&oldItem===null)add('warning','XCHANGE_DELETE_ABSENT','/materials/'+row.materialKey+'/TradeItem/'+index,'The selected deletion refers to no active trade item in the previous target state.','Statuscode');
          if(after&&processing?.skipProducts&&!productAfter)add('warning','TWO_BA_SKIPPED_PRODUCT_LINK','/materials/'+row.materialKey+'/TradeItem/'+index,'This supplied trade item requires its product to exist at the recipient; the selected previous review has no product and SkipLoadProducts omits this one.','SkipLoadProducts');
        }
        put('tradeItem',trade.key,supplierKey,trade.identifier,identity.key,row.materialKey,oldItem,after,change,tradeProcessing);
        resultCounts['tradeItems'+change[0].toUpperCase()+change.slice(1)]++;if(after)resultCounts.tradeItemsTotal++;
      }
    }
    if(headerConflict)add('error','XCHANGE_CATALOGUE_HEADER_CONFLICT','/profile/header','The selected products carry different catalogue headers; choose one explicit versioned header for the delivery.','Root tree');
    if(header===null)header={};
    findings.push(...validateXChange(header,{schema:XCHANGE_SCHEMA,numberTokens:headerNumberTokens,omit:['Supplier'],path:'/profile/header/value'}));
    if(!['FULL','CHANGE'].includes(catalogueType))add('error','XCHANGE_CATALOGUE_TYPE','/profile/header/value/CatalogueType','Choose the original FULL or CHANGE catalogue type.','Type dataset');
    if(header.CatalogueType==='CHANGE'&&(typeof header.ChangeReferenceCatalogueVersion!=='string'||!header.ChangeReferenceCatalogueVersion.length))findings.push({severity:'error',code:'XCHANGE_CHANGE_REFERENCE_REQUIRED',path:'/profile/header/value/ChangeReferenceCatalogueVersion',message:'A CHANGE message must reference its original previous catalogue version.',rule:{url:'https://etim.org.pl/wp-content/uploads/2026/05/ETIM-xChange_Guideline_V2.0-2025-11-27.pdf',section:'§3.2; §5.1 p147'}});
    if(catalogueType==='CHANGE'&&!previous)add('error','XCHANGE_CHANGE_BASE_REQUIRED','/previousReviewId','Select the original previous recipient review before applying a CHANGE message.','Type dataset');
    if(previous){
      if(previous.recipient.header?.CatalogueId!==header.CatalogueId)add('error','XCHANGE_CATALOGUE_SCOPE_CHANGED','/profile/header/value/CatalogueId','The selected previous recipient belongs to another original catalogue ID.','Type dataset');
      if(header.ChangeReferenceCatalogueVersion!==undefined&&header.ChangeReferenceCatalogueVersion!==previous.recipient.header?.CatalogueVersion)add('error','XCHANGE_CHANGE_REFERENCE','/profile/header/value/ChangeReferenceCatalogueVersion','The original change reference does not match the selected previous catalogue version.','Catalogue version');
      for(const saved of db.prepare('SELECT record_json FROM catalog_supplier_recipient WHERE review_id=? ORDER BY kind,record_key').iterate(previousId)){
        const prior=parse(saved);if(prior.after===null)continue;if(db.prepare('SELECT 1 FROM '+table+' WHERE review_id=? AND kind=? AND record_key=?').get(reviewId,prior.kind,prior.key))continue;
        let after=clone(prior.after),action='unchanged';
        const skipped=prior.kind==='tradeItem'?processing?.skipTradeItems:processing?.skipProducts;
        if(skipped)action='skipped';
        else if(catalogueType==='FULL'){
          if(prior.kind==='tradeItem'){after=null;action='deleted';}
          else if(!after.status?.expired){after.status={...after.status,expired:true,recipientCode:profile.target==='2ba-xchange-2.0'?'130':after.status?.recipientCode??null};action='expired';}
        }
        put(prior.kind,prior.key,prior.supplierKey,prior.identifier,prior.productKey,prior.materialKey,prior.after,after,action,processing?{applied:!skipped,parameter:skipped?(prior.kind==='tradeItem'?'SkipLoadArticlesAndPrices':'SkipLoadProducts'):'PackageMutationCode',supplied:false}:null);
        const prefix=prior.kind==='product'?'products':'tradeItems';resultCounts[prefix+action[0].toUpperCase()+action.slice(1)]++;if(after)resultCounts[prefix+'Total']++;
      }
    }
    if(profile.target==='2ba-xchange-2.0'){
      if(!header.NameDataCreator)add('warning','TWO_BA_CREATOR_REPORT','/profile/header/value/NameDataCreator','The original creator name is used in recipient processing reports.','Root tree, point1');
      if(header.CatalogueValidityStart)add('info','TWO_BA_VALIDITY_START_NOT_IMPORTED','/profile/header/value/CatalogueValidityStart','This source value is retained in the native file;2BA does not import catalogue validity start.','Root tree, point4');
      if(headerAttachments)add('info','TWO_BA_HEADER_ATTACHMENTS_NOT_IMPORTED','/profile/supplierHeaders','Header attachments are retained in the native file;2BA does not import header-level attachments.','Root tree, point3');
      if(profile.attachmentPolicy.keepMimeUrlCodes.length)add('info','TWO_BA_KEEP_URL_PARAMETER','/profile/attachmentPolicy/keepMimeUrlCodes',processing?'The selected original MDX codes are included in parameters.xml KeepMimeURL.':'The selected MDX URL-retention policy travels as recipient metadata and must be applied through the original external parameter.xml setting.','Attachments, point1');
      if(processing?.parameters.OverrulePackageMutationCode===true)add('info','TWO_BA_CATALOGUE_PROCESSING_OVERRIDE','/profile/processing/parameters/PackageMutationCode','The native '+header.CatalogueType+' message will be processed as '+catalogueType+' under the selected parameter; recipient omission effects use '+catalogueType+'.','OverrulePackageMutationCode');
      if(processing?.masterGln==='recipient-account-mapping')add('warning','TWO_BA_MASTER_GLN_PROCESSING','/profile/processing/parameters/AutoConvertToMasterGLN','The recipient applies its account-held master GLN mapping. This review preserves the original supplier identities for matching and displays that requested conversion.','AutoConvertToMasterGLN');
    }
    const hash=createHash('sha256');for(const row of db.prepare('SELECT kind,record_key,record_json FROM '+table+' WHERE review_id=? ORDER BY kind,record_key').iterate(reviewId))hash.update(row.kind+':'+row.record_key+':'+parse(row).sha256+'\n');
    const recipient={schema:RECIPIENT_REVIEW_SCHEMA,target:profile.target,catalogueType,previousReviewId:previousId,previousReviewSha256:previous?.sha256??null,header,headerNumberTokens,headerSha256:digest({header,numberTokens:headerNumberTokens}),supplierCount,sourceProductCount:selectedCount,counts:resultCounts,rowsRootSha256:hash.digest('hex'),materialization:{productChange:'complete supplied product body excluding independently retained trade items',tradeItemChange:'complete supplied trade item body',unlistedChangeRecords:'retained',fullMissingProducts:profile.target==='2ba-xchange-2.0'?'expired130':'expired',fullMissingTradeItems:'deleted',...(processing?{
      productChange:processing.skipProducts?'skipped; previous product retained':'supplied product with selected attachment policy',
      tradeItemChange:processing.skipTradeItems?'skipped; previous trade item retained':'supplied trade item with selected price and attachment policy',
      fullMissingProducts:processing.skipProducts?'retained':profile.target==='2ba-xchange-2.0'?'expired130':'expired',
      fullMissingTradeItems:processing.skipTradeItems?'retained':'deleted',
      prices:processing.skipPrices?'retained from selected previous trade item':'supplied',
      attachments:processing.attachments.mode,
      supplierIdentity:processing.masterGln==='recipient-account-mapping'?'original source identities; recipient applies its selected master-GLN mapping':'original supplier'
    }: {})},...(processing?{processing}:{} )};
    if(!write){for(const row of db.prepare('SELECT kind,record_key,record_json FROM '+table+' WHERE review_id=? ORDER BY kind,record_key').iterate(reviewId)){const actual=db.prepare('SELECT record_json FROM catalog_supplier_recipient WHERE review_id=? AND kind=? AND record_key=?').get(reviewId,row.kind,row.record_key);if(!actual||actual.record_json!==row.record_json)fail('XCHANGE_RECIPIENT_DERIVATION_CHANGED','The retained recipient state differs from its original source/review derivation.',409);}const n=db.prepare('SELECT COUNT(*) n FROM '+table+' WHERE review_id=?').get(reviewId).n,m=db.prepare('SELECT COUNT(*) n FROM catalog_supplier_recipient WHERE review_id=?').get(reviewId).n;if(n!==m)fail('XCHANGE_RECIPIENT_DERIVATION_CHANGED','The retained recipient state has extra rows.',409);}
    return {recipient,findings};
  }finally{if(!write)db.exec('DROP TABLE temp.'+prefix);}
}
