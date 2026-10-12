// MIT. Complete supplier histories and immutable reviewed products in catalog v2 bundles.
import { canonical, digest, identifier } from '../../workspace/store.mjs';
import { normalizeSupplierProfile, checkSupplierProductCoverage } from './profile.mjs';
import { PLAN_SCHEMA,CORRECTION_SCHEMA,REVIEW_SCHEMA,ROW_SCHEMA,SUPPLIER_TABLES,
  SUPPLIER_KEYS,fail,verifySealed,normalizeBindings,normalizePatches,projectSupplier,applyCorrections,
  correctionFor,supplierId,rowCounts } from './model.mjs';
import { supplierRowsRoot } from './workspace.mjs';

const parse=row=>row?JSON.parse(row.record_json):null;
const count=(db,sql,...args)=>Number(db.prepare(sql).get(...args).n);
export function captureSupplier(catalog,catalogId) {
  return {
    plans:catalog.db.prepare('SELECT record_json FROM catalog_supplier_plans WHERE catalog_id=? ORDER BY id').all(catalogId).map(parse),
    corrections:catalog.db.prepare('SELECT c.record_json FROM catalog_supplier_corrections c JOIN catalog_supplier_plans p ON p.id=c.plan_id WHERE p.catalog_id=? ORDER BY c.id').all(catalogId).map(parse),
    reviews:catalog.db.prepare('SELECT r.record_json FROM catalog_supplier_reviews r JOIN catalog_supplier_plans p ON p.id=r.plan_id WHERE p.catalog_id=? ORDER BY r.created_at,r.id').all(catalogId).map(parse)
  };
}
export function* supplierRecords(catalog,saved) {
  const record=(table,values)=>({type:'record',table,values});
  for(const plan of saved.plans) {
    yield record('catalog_supplier_plans',[plan.id,plan.catalogId,plan.revision,JSON.stringify(plan)]);
    for(const row of catalog.db.prepare('SELECT plan_id,revision,record_json FROM catalog_supplier_plan_history WHERE plan_id=? AND revision<=? ORDER BY revision').iterate(plan.id,plan.revision))
      yield record('catalog_supplier_plan_history',SUPPLIER_TABLES.catalog_supplier_plan_history.map(key=>row[key]));
  }
  for(const correction of saved.corrections) {
    yield record('catalog_supplier_corrections',[correction.id,correction.planId,correction.materialKey,correction.revision,JSON.stringify(correction)]);
    for(const row of catalog.db.prepare('SELECT correction_id,revision,record_json FROM catalog_supplier_correction_history WHERE correction_id=? AND revision<=? ORDER BY revision').iterate(correction.id,correction.revision))
      yield record('catalog_supplier_correction_history',SUPPLIER_TABLES.catalog_supplier_correction_history.map(key=>row[key]));
  }
  for(const review of saved.reviews) {
    if(supplierRowsRoot(catalog.db,review.id)!==review.rowsRootSha256)
      fail('SUPPLIER_BUNDLE_REVIEW_CHANGED','A reviewed product set changed before export.',409);
    yield record('catalog_supplier_reviews',[review.id,review.planId,review.createdAt,JSON.stringify(review)]);
    for(const row of catalog.db.prepare('SELECT * FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(review.id))
      yield record('catalog_supplier_products',SUPPLIER_TABLES.catalog_supplier_products.map(key=>row[key]));
  }
}
export function validateSupplierRow(table,values,header) {
  const columns=SUPPLIER_TABLES[table];
  if(!columns||!Array.isArray(values)||values.length!==columns.length)
    fail('SUPPLIER_BUNDLE_ROW_INVALID','A supplier handover row has an unknown table or shape.');
  const row=Object.fromEntries(columns.map((key,index)=>[key,values[index]]));
  for(const [key,value] of Object.entries(row)) {
    if(['revision','errors','warnings'].includes(key)){
      if(!Number.isSafeInteger(value)||value<(key==='revision'?1:0))
        fail('SUPPLIER_BUNDLE_ROW_INVALID','A supplier count or revision is invalid.');
    }else if(typeof value!=='string'||value.includes('\0')||(key!=='supplier_id'&&!value.length))
      fail('SUPPLIER_BUNDLE_ROW_INVALID','A supplier database field has an invalid type.');
  }
  let record;
  try{record=JSON.parse(row.record_json);}catch{fail('SUPPLIER_BUNDLE_JSON_INVALID','A supplier handover record is invalid JSON.');}
  const schema=table.includes('plan')?PLAN_SCHEMA:table.includes('correction')?CORRECTION_SCHEMA:
    table==='catalog_supplier_reviews'?REVIEW_SCHEMA:ROW_SCHEMA;
  verifySealed(record,schema);
  if(record.catalogId!==header.catalogId||record.tenantId!==header.tenantId)
    fail('SUPPLIER_BUNDLE_SCOPE_INVALID','A supplier record belongs to another catalog or tenant.');
  for(const key of SUPPLIER_KEYS[table]){
    const field={plan_id:'id',correction_id:'id',review_id:'reviewId',material_key:'materialKey'}[key]??key;
    if(row[key]!==record[field])fail('SUPPLIER_BUNDLE_IDENTITY_INVALID','A supplier record differs from its retained identity.');
  }
  if(row.revision!==undefined&&row.revision!==record.revision)
    fail('SUPPLIER_BUNDLE_REVISION_INVALID','The supplier revision differs from its original record.');
  if(table==='catalog_supplier_plans'&&row.catalog_id!==record.catalogId)
    fail('SUPPLIER_BUNDLE_SCOPE_INVALID','The supplier plan belongs to a different catalog.');
  if(table==='catalog_supplier_corrections'&&(row.plan_id!==record.planId||row.material_key!==record.materialKey))
    fail('SUPPLIER_BUNDLE_CORRECTION_INVALID','The correction has a different plan or material.');
  if(table==='catalog_supplier_reviews'&&(row.plan_id!==record.planId||row.created_at!==record.createdAt))
    fail('SUPPLIER_BUNDLE_REVIEW_INVALID','The supplier review differs from its saved plan or date.');
  if(table==='catalog_supplier_products'){
    const counts=rowCounts(record.findings);
    if(row.supplier_id!==supplierId(record.product)||row.errors!==counts.errors||row.warnings!==counts.warnings)
      fail('SUPPLIER_BUNDLE_PRODUCT_INVALID','A supplier product differs from its reviewed identity or findings.');
  }
  return record;
}
function originalPlan(db,planId,revision) {
  const value=parse(db.prepare('SELECT record_json FROM catalog_supplier_plan_history WHERE plan_id=? AND revision=?').get(planId,revision));
  if(!value)fail('SUPPLIER_BUNDLE_PLAN_MISSING','The original supplier plan revision is missing.');
  return value;
}
function history(db,current,table,idColumn) {
  const rows=db.prepare('SELECT revision,record_json FROM '+table+' WHERE '+idColumn+'=? ORDER BY revision').all(current.id);
  if(rows.length!==current.revision||rows.some((row,index)=>row.revision!==index+1)||
      canonical(parse(rows.at(-1)))!==canonical(current))
    fail('SUPPLIER_BUNDLE_HISTORY_INCOMPLETE','A supplier plan or correction is missing its complete revision history.');
}
function originalMaterial(db,editionId,materialKey) {
  const value=parse(db.prepare('SELECT record_json FROM catalog_materials WHERE edition_id=? AND material_key=?').get(editionId,materialKey));
  if(!value)fail('SUPPLIER_BUNDLE_MATERIAL_MISSING','A supplier correction or review is missing its original material.');
  return value;
}
function originalCorrection(db,id,revision) {
  const value=parse(db.prepare('SELECT record_json FROM catalog_supplier_correction_history WHERE correction_id=? AND revision=?').get(id,revision));
  if(!value)fail('SUPPLIER_BUNDLE_CORRECTION_MISSING','A supplier review is missing its original correction revision.');
  return value;
}
export function validateSupplierClosure(db,header) {
  const plans=db.prepare('SELECT record_json FROM catalog_supplier_plans').all().map(parse);
  for(const plan of plans)history(db,plan,'catalog_supplier_plan_history','plan_id');
  for(const saved of db.prepare('SELECT record_json FROM catalog_supplier_plan_history').iterate()){
    const plan=parse(saved),edition=parse(db.prepare('SELECT record_json FROM catalog_editions WHERE id=?').get(plan.editionId));
    if(!db.prepare('SELECT 1 FROM catalog_supplier_plans WHERE id=?').get(plan.id)||!edition||
      edition.catalogId!==header.catalogId||edition.reviewSha256!==plan.editionReviewSha256||
      plan.bindingSha256!==digest(normalizeBindings(plan.bindings))||
      canonical(normalizeSupplierProfile(plan.profile))!==canonical(plan.profile))
      fail('SUPPLIER_BUNDLE_PLAN_INVALID','A supplier plan is missing its original edition, mapping or selected profile.');
    if(plan.previousReviewId){
      const previous=parse(db.prepare('SELECT record_json FROM catalog_supplier_reviews WHERE id=?').get(plan.previousReviewId));
      if(!previous||previous.planId!==plan.id||previous.planRevision>=plan.revision)
        fail('SUPPLIER_BUNDLE_PREVIOUS_REVIEW_INVALID','The selected previous supplier review is missing or is not from an earlier plan revision.');
    }
  }
  for(const saved of db.prepare('SELECT record_json FROM catalog_supplier_corrections').iterate()){
    const correction=parse(saved);
    if(!db.prepare('SELECT 1 FROM catalog_supplier_plans WHERE id=?').get(correction.planId))
      fail('SUPPLIER_BUNDLE_ORPHAN_CORRECTION','A supplier correction is missing its plan.');
    history(db,correction,'catalog_supplier_correction_history','correction_id');
  }
  for(const saved of db.prepare('SELECT record_json FROM catalog_supplier_correction_history').iterate()){
    const correction=parse(saved),plan=originalPlan(db,correction.planId,correction.planRevision);
    const material=originalMaterial(db,correction.editionId,correction.materialKey);
    if(!db.prepare('SELECT 1 FROM catalog_supplier_corrections WHERE id=?').get(correction.id)||
      correction.id!==correctionFor(plan.id,material.key)||plan.editionId!==correction.editionId||
      correction.materialSha256!==material.sha256||correction.materialId!==material.materialId||
      correction.baseProductSha256!==digest(projectSupplier(material,plan.bindings))||
      canonical(normalizePatches(correction.patches))!==canonical(correction.patches))
      fail('SUPPLIER_BUNDLE_CORRECTION_CHANGED','A correction differs from its original plan, material, field values or reasons.');
  }
  const reviews=db.prepare('SELECT record_json FROM catalog_supplier_reviews').all().map(parse);
  for(const review of reviews){
    const plan=originalPlan(db,review.planId,review.planRevision);
    const edition=parse(db.prepare('SELECT record_json FROM catalog_editions WHERE id=?').get(review.editionId));
    if(canonical(plan)!==canonical(review.plan)||plan.editionId!==review.editionId||
      !edition||edition.reviewSha256!==review.editionReviewSha256)
      fail('SUPPLIER_BUNDLE_REVIEW_PLAN_CHANGED','A supplier review differs from its original submission and edition.');
    function* originalIds(){for(const row of db.prepare('SELECT supplier_id FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(review.id))yield row.supplier_id;}
    const globalFindings=checkSupplierProductCoverage(originalIds(),plan.profile).findings;
    if(canonical(globalFindings)!==canonical(review.globalFindings??[]))
      fail('SUPPLIER_BUNDLE_DELIVERY_FINDINGS_CHANGED','The delivery findings differ from its original product identifiers and selected profile.');
    const globals=rowCounts(globalFindings);
    let errors=globals.errors,warnings=globals.warnings,errorProducts=0,total=0;
    const codes=new Map();
    for(const finding of globalFindings){const key=finding.severity+':'+finding.code,prior=codes.get(key)??{severity:finding.severity,code:finding.code,count:0};prior.count++;codes.set(key,prior);}
    for(const saved of db.prepare('SELECT * FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(review.id)){
      const row=parse(saved),material=originalMaterial(db,review.editionId,row.materialKey);
      const base=projectSupplier(material,plan.bindings),baseHash=digest(base);
      if(row.planId!==plan.id||row.planRevision!==plan.revision||row.editionId!==review.editionId||
        row.materialSha256!==material.sha256||row.materialId!==material.materialId||row.baseProductSha256!==baseHash)
        fail('SUPPLIER_BUNDLE_PRODUCT_SOURCE_CHANGED','A reviewed product differs from its original source material and mapping.');
      let product=base;
      if(row.correctionId){
        const correction=originalCorrection(db,row.correctionId,row.correctionRevision);
        if(correction.planId!==plan.id||correction.materialKey!==material.key)
          fail('SUPPLIER_BUNDLE_PRODUCT_CORRECTION_CHANGED','The product has a correction from another material.');
        const applicable=correction.materialSha256===material.sha256&&correction.baseProductSha256===baseHash;
        if(row.correctionApplied!==applicable)
          fail('SUPPLIER_BUNDLE_PRODUCT_CORRECTION_CHANGED','The saved correction applicability changed.');
        if(applicable)product=applyCorrections(base,correction.patches);
      }else if(row.correctionRevision!==null||row.correctionApplied)
        fail('SUPPLIER_BUNDLE_PRODUCT_CORRECTION_CHANGED','The product names a correction without its original identity.');
      if(canonical(product)!==canonical(row.product))
        fail('SUPPLIER_BUNDLE_PROJECTED_PRODUCT_CHANGED','The reviewed product differs from its explicit mapping and corrections.');
      errors+=saved.errors;warnings+=saved.warnings;if(saved.errors)errorProducts++;total++;
      for(const finding of row.findings){
        const key=finding.severity+':'+finding.code,prior=codes.get(key)??{severity:finding.severity,code:finding.code,count:0};
        prior.count++;codes.set(key,prior);
      }
    }
    const findings=[...codes.values()].sort((a,b)=>(a.severity+':'+a.code).localeCompare(b.severity+':'+b.code,'en'));
    if(total!==edition.counts.total||canonical(review.counts)!==canonical({total,readyProducts:total-errorProducts,errorProducts,errors,warnings})||
      canonical(findings)!==canonical(review.findings)||supplierRowsRoot(db,review.id)!==review.rowsRootSha256)
      fail('SUPPLIER_BUNDLE_REVIEW_SET_CHANGED','The supplier review is missing products or differs from its complete finding counts.');
  }
  if(count(db,'SELECT COUNT(*) n FROM catalog_supplier_products p LEFT JOIN catalog_supplier_reviews r ON r.id=p.review_id WHERE r.id IS NULL'))
    fail('SUPPLIER_BUNDLE_ORPHAN_PRODUCT','The handover has a supplier product without its original review.');
  return {plans:plans.length,reviews:reviews.length};
}
