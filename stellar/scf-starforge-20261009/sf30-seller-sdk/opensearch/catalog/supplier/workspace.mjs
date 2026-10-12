// MIT. Supplier submission, correction queue and delivery on retained catalog editions.
import { createHash, randomUUID } from 'node:crypto';
import { clone, canonical, digest, identifier, now } from '../../workspace/store.mjs';
import { normalizeSupplierProfile, supplierProductTemplate, checkSupplierProduct,
  exportSupplierProducts, checkSupplierProductCoverage, PROFILE_ID, PROFILE_SOURCE } from './profile.mjs';
import { PLAN_SCHEMA, CORRECTION_SCHEMA, REVIEW_SCHEMA, ROW_SCHEMA, SUPPLIER_TABLES,
  fail, text, revision, seal, verifySealed, normalizeBindings, normalizePatches,
  projectSupplier, applyCorrections, correctionFor, supplierId, rowCounts, setupSupplierTables } from './model.mjs';

const parse = row => row ? JSON.parse(row.record_json) : null;
const json = value => JSON.stringify(value);
const like = value => '%' + value.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_') + '%';
const count = (db, sql, ...values) => Number(db.prepare(sql).get(...values).n);
const issue = (code,path,message) => ({ severity:'error',code,path,message,
  rule:{section:'Supplier submission workspace',url:'https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier'} });
function* productIds(db,reviewId) {
  for(const row of db.prepare('SELECT supplier_id FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(reviewId))yield row.supplier_id;
}
function page(offset=0,limit=50) {
  offset=Number(offset);limit=Number(limit);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)
    fail('SUPPLIER_PAGE_INVALID','Choose a nonnegative offset and a page size from 1 to 200.');
  return {offset,limit};
}
function expectedHash(actual, supplied, label) {
  if (typeof supplied!=='string'||supplied!==actual)
    fail('SUPPLIER_SELECTION_CHANGED',label+' changed. Reopen the selected product or review before continuing.',409);
}
function put(db,table,value,columns) {
  const names=SUPPLIER_TABLES[table], fields=columns??names.map(name=>name==='record_json'?json(value):value[name]);
  db.prepare('INSERT INTO '+table+'('+names.join(',')+') VALUES('+names.map(()=>'?').join(',')+')').run(...fields);
}
export function supplierRowsRoot(db,reviewId) {
  const hash=createHash('sha256');
  for(const row of db.prepare('SELECT material_key,record_json FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(reviewId))
    hash.update(row.material_key+':'+parse(row).sha256+'\n');
  return hash.digest('hex');
}
export class SupplierWorkspace {
  constructor(catalog) { this.catalog=catalog;this.store=catalog.store;this.db=catalog.db;setupSupplierTables(this.db); }
  templates() {
    return {schema:'stellar-forge.supplier-templates.v1',profileId:PROFILE_ID,source:PROFILE_SOURCE,
      profile:normalizeSupplierProfile({}),product:supplierProductTemplate(),
      bindings:{'/supplierProductId':'/materialId','/manufacturerProductId':'/partNumber',
        '/manufacturerName':'/manufacturer','/brand':'/attributes/brand',
        '/descriptions/eng/short':'/title','/descriptions/eng/long':'/description'}};
  }
  plan(id, expectedRevision) {
    const result=parse(this.db.prepare('SELECT record_json FROM catalog_supplier_plans WHERE id=?').get(identifier(id,'submission ID')));
    if(!result)fail('SUPPLIER_PLAN_NOT_FOUND','Supplier submission not found.',404);
    verifySealed(result,PLAN_SCHEMA);
    if(expectedRevision!==undefined&&result.revision!==expectedRevision)
      fail('SUPPLIER_PLAN_CHANGED','The supplier submission changed. Reopen it before applying this action.',409);
    return result;
  }
  planHistory(id) {
    this.plan(id);
    return this.db.prepare('SELECT record_json FROM catalog_supplier_plan_history WHERE plan_id=? ORDER BY revision').all(id).map(parse);
  }
  state({catalogId}={}) {
    this.catalog.catalog(catalogId);
    const plans=this.db.prepare('SELECT record_json FROM catalog_supplier_plans WHERE catalog_id=? ORDER BY id').all(catalogId).map(parse);
    const reviews=this.db.prepare('SELECT r.record_json FROM catalog_supplier_reviews r JOIN catalog_supplier_plans p ON p.id=r.plan_id WHERE p.catalog_id=? ORDER BY r.created_at DESC,r.id DESC').all(catalogId).map(parse);
    return {schema:'stellar-forge.supplier-workspace.v1',catalogId,plans,reviews:reviews.map(item=>({
      id:item.id,planId:item.planId,planRevision:item.planRevision,editionId:item.editionId,createdAt:item.createdAt,
      counts:item.counts,sha256:item.sha256,rowsRootSha256:item.rowsRootSha256}))};
  }
  save(request) {
    return this.catalog.sync('catalog-supplier-save',request,()=>{
      const prior=request.planId?this.plan(request.planId,revision(request.expectedRevision)):null;
      const selected=this.catalog.catalog(request.catalogId);
      if(prior&&prior.catalogId!==selected.id)fail('SUPPLIER_CATALOG_IMMUTABLE','Create another submission for a different catalog.');
      const edition=this.catalog.edition(request.editionId);
      if(edition.catalogId!==selected.id)fail('SUPPLIER_EDITION_FOREIGN','Choose an edition in this catalog.');
      const previousReviewId=request.previousReviewId||null;
      if(previousReviewId) {
        const previous=this.review(previousReviewId);
        if(!prior||previous.planId!==prior.id)
          fail('SUPPLIER_PREVIOUS_REVIEW_FOREIGN','Choose an earlier review of this supplier submission.');
      }
      const profile=normalizeSupplierProfile(request.profile),bindings=normalizeBindings(request.bindings),at=now();
      const plan=seal({schema:PLAN_SCHEMA,id:prior?.id??randomUUID(),revision:(prior?.revision??0)+1,
        catalogId:selected.id,tenantId:selected.tenantId,title:text(request.title,'Submission title',120),
        editionId:edition.id,editionReviewSha256:edition.reviewSha256,profile,bindings,
        bindingSha256:digest(bindings),previousReviewId,createdAt:prior?.createdAt??at,updatedAt:at});
      this.db.prepare('INSERT INTO catalog_supplier_plans VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json')
        .run(plan.id,plan.catalogId,plan.revision,json(plan));
      put(this.db,'catalog_supplier_plan_history',plan,[plan.id,plan.revision,json(plan)]);
      return {supplierPlan:plan};
    });
  }
  correction(id) {
    return parse(this.db.prepare('SELECT record_json FROM catalog_supplier_corrections WHERE id=?').get(identifier(id,'correction ID')));
  }
  currentProduct({planId,materialKey}) {
    const plan=this.plan(planId),material=this.catalog.material(plan.editionId,identifier(materialKey,'material key'));
    if(!material)fail('SUPPLIER_MATERIAL_NOT_FOUND','Material not found in this submission edition.',404);
    const base=projectSupplier(material,plan.bindings),baseProductSha256=digest(base);
    const correction=this.correction(correctionFor(plan.id,material.key));
    const applicable=Boolean(correction&&correction.materialSha256===material.sha256&&correction.baseProductSha256===baseProductSha256);
    return {plan,material,base,baseProductSha256,correction,correctionApplicable:applicable,
      product:applicable?applyCorrections(base,correction.patches):base};
  }
  saveCorrection(request) {
    return this.catalog.sync('catalog-supplier-correction',request,()=>{
      const plan=this.plan(request.planId,revision(request.expectedPlanRevision));
      const current=this.currentProduct({planId:plan.id,materialKey:request.materialKey});
      expectedHash(current.material.sha256,request.expectedMaterialSha256,'The original material');
      expectedHash(current.baseProductSha256,request.expectedBaseProductSha256,'The mapped supplier product');
      const prior=current.correction;
      if((prior?.revision??0)!==revision(request.expectedRevision,true))
        fail('SUPPLIER_CORRECTION_CHANGED','Another correction was saved. Reopen it before saving.',409);
      const patches=normalizePatches(request.patches);
      applyCorrections(current.base,patches);
      const correction=seal({schema:CORRECTION_SCHEMA,id:correctionFor(plan.id,current.material.key),
        revision:(prior?.revision??0)+1,planId:plan.id,planRevision:plan.revision,catalogId:plan.catalogId,tenantId:plan.tenantId,
        editionId:plan.editionId,materialKey:current.material.key,materialId:current.material.materialId,
        materialSha256:current.material.sha256,baseProductSha256:current.baseProductSha256,
        patches,createdAt:prior?.createdAt??now(),updatedAt:now()});
      this.db.prepare('INSERT INTO catalog_supplier_corrections VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json')
        .run(correction.id,plan.id,correction.materialKey,correction.revision,json(correction));
      put(this.db,'catalog_supplier_correction_history',correction,[correction.id,correction.revision,json(correction)]);
      return {supplierCorrection:correction};
    });
  }
  review(id) {
    const value=parse(this.db.prepare('SELECT record_json FROM catalog_supplier_reviews WHERE id=?').get(identifier(id,'supplier review ID')));
    if(!value)fail('SUPPLIER_REVIEW_NOT_FOUND','Supplier review not found.',404);
    return verifySealed(value,REVIEW_SCHEMA);
  }
  reviewRow({reviewId,materialKey}) {
    this.review(reviewId);
    const value=parse(this.db.prepare('SELECT record_json FROM catalog_supplier_products WHERE review_id=? AND material_key=?')
      .get(reviewId,identifier(materialKey,'material key')));
    if(!value)fail('SUPPLIER_ROW_NOT_FOUND','Product not found in this supplier review.',404);
    return verifySealed(value,ROW_SCHEMA);
  }
  runReview(request) {
    // Reserving the request, both streaming SQL passes and the complete review
    // commit together. A process interruption rolls them all back for same-ID replay.
    return this.catalog.sync('catalog-supplier-review',request,()=>{
      const plan=this.plan(request.planId,revision(request.expectedRevision));
      const edition=this.catalog.edition(plan.editionId);
      expectedHash(edition.reviewSha256,plan.editionReviewSha256,'The retained catalog edition');
      const id=digest(['supplier-review',request.requestId]).slice(0,32),at=now();
      const correctionsHash=createHash('sha256');
      for(const row of this.db.prepare('SELECT id,revision,record_json FROM catalog_supplier_corrections WHERE plan_id=? ORDER BY id').iterate(plan.id))
        correctionsHash.update(row.id+':'+row.revision+':'+parse(row).sha256+'\n');
      const correctionsRootSha256=correctionsHash.digest('hex');
      this.db.exec('CREATE TEMP TABLE IF NOT EXISTS supplier_gtin_stage(material_key TEXT NOT NULL,gtin TEXT NOT NULL,path TEXT NOT NULL);DELETE FROM supplier_gtin_stage;CREATE INDEX IF NOT EXISTS temp.supplier_gtin_lookup ON supplier_gtin_stage(gtin,material_key);');
      const addGtin=this.db.prepare('INSERT INTO supplier_gtin_stage VALUES(?,?,?)');
      let total=0,errors=0,warnings=0,errorProducts=0;
      const codes=new Map();
      for(const source of this.db.prepare('SELECT record_json FROM catalog_materials WHERE edition_id=? ORDER BY material_key').iterate(edition.id)) {
        const material=parse(source),base=projectSupplier(material,plan.bindings),baseProductSha256=digest(base);
        const correction=this.correction(correctionFor(plan.id,material.key)),findings=[];
        const correctionApplied=Boolean(correction&&correction.materialSha256===material.sha256&&correction.baseProductSha256===baseProductSha256);
        if(correction&&!correctionApplied&&correction.patches.length)
          findings.push(issue('SUPPLIER_CORRECTION_STALE','/','The material or field mapping changed. Reopen the correction and confirm its values against this edition.'));
        const product=correctionApplied?applyCorrections(base,correction.patches):base;
        const row={schema:ROW_SCHEMA,reviewId:id,planId:plan.id,planRevision:plan.revision,catalogId:plan.catalogId,tenantId:plan.tenantId,
          editionId:edition.id,materialKey:material.key,materialId:material.materialId,materialSha256:material.sha256,
          baseProductSha256,correctionId:correction?.id??null,correctionRevision:correction?.revision??null,correctionApplied,product,findings};
        put(this.db,'catalog_supplier_products',row,[id,material.key,supplierId(product),0,0,json(row)]);
        if(typeof product.productGtin==='string'&&product.productGtin.length)addGtin.run(material.key,product.productGtin,'/productGtin');
        if(Array.isArray(product.packaging))for(let n=0;n<product.packaging.length;n++){
          const gtin=product.packaging[n]?.gtin;
          if(typeof gtin==='string'&&gtin.length)addGtin.run(material.key,gtin,'/packaging/'+n+'/gtin');
        }
        total++;
      }
      const globalFindings=checkSupplierProductCoverage(productIds(this.db,id),plan.profile).findings;
      const globalCounts=rowCounts(globalFindings);errors+=globalCounts.errors;warnings+=globalCounts.warnings;
      for(const finding of globalFindings){const key=finding.severity+':'+finding.code,prior=codes.get(key)??{severity:finding.severity,code:finding.code,count:0};prior.count++;codes.set(key,prior);}
      const findProductIn=(reviewId,pid)=>{
        if(typeof pid!=='string'||!pid.length)return null;
        const matches=this.db.prepare('SELECT record_json FROM catalog_supplier_products WHERE review_id=? AND supplier_id=? LIMIT 2').all(reviewId,pid);
        return matches.length===1?parse(matches[0]).product:null;
      };
      const context={findProduct:pid=>findProductIn(id,pid),
        findPreviousProduct:pid=>plan.previousReviewId?findProductIn(plan.previousReviewId,pid):null};
      for(const saved of this.db.prepare('SELECT material_key,supplier_id,record_json FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(id)) {
        const row=parse(saved),checked=checkSupplierProduct(row.product,plan.profile,context);
        const findings=[...row.findings,...checked.findings];
        if(saved.supplier_id&&count(this.db,'SELECT COUNT(*) n FROM catalog_supplier_products WHERE review_id=? AND supplier_id=?',id,saved.supplier_id)>1)
          findings.push(issue('SUPPLIER_ID_REPEATED','/supplierProductId','This supplier product identifier is used by more than one material in the delivery.'));
        for(const gtin of this.db.prepare('SELECT DISTINCT gtin,path FROM supplier_gtin_stage WHERE material_key=?').iterate(saved.material_key))
          if(count(this.db,'SELECT COUNT(DISTINCT material_key) n FROM supplier_gtin_stage WHERE gtin=?',gtin.gtin)>1)
            findings.push(issue('SUPPLIER_GTIN_REPEATED',gtin.path,'This GTIN is used by more than one material in the delivery.'));
        const counts=rowCounts(findings);
        const completed=seal({...row,product:checked.product,findings});
        this.db.prepare('UPDATE catalog_supplier_products SET errors=?,warnings=?,record_json=? WHERE review_id=? AND material_key=?')
          .run(counts.errors,counts.warnings,json(completed),id,row.materialKey);
        errors+=counts.errors;warnings+=counts.warnings;if(counts.errors)errorProducts++;
        for(const finding of findings) {
          const key=finding.severity+':'+finding.code;
          const prior=codes.get(key)??{severity:finding.severity,code:finding.code,count:0};
          prior.count++;codes.set(key,prior);
        }
      }
      this.db.exec('DELETE FROM supplier_gtin_stage');
      const review=seal({schema:REVIEW_SCHEMA,id,planId:plan.id,planRevision:plan.revision,catalogId:plan.catalogId,tenantId:plan.tenantId,
        editionId:edition.id,editionReviewSha256:edition.reviewSha256,source:clone(edition.source),plan:clone(plan),
        correctionsRootSha256,rowsRootSha256:supplierRowsRoot(this.db,id),createdAt:at,globalFindings:clone(globalFindings),
        counts:{total,readyProducts:total-errorProducts,errorProducts,errors,warnings},
        findings:[...codes.values()].sort((a,b)=>(a.severity+':'+a.code).localeCompare(b.severity+':'+b.code,'en'))});
      put(this.db,'catalog_supplier_reviews',review,[id,plan.id,at,json(review)]);
      return {supplierReview:review};
    });
  }
  rows({reviewId,offset=0,limit=50,status='all',search=''}) {
    const review=this.review(reviewId),paging=page(offset,limit);
    if(!['all','errors','warnings','ready'].includes(status))fail('SUPPLIER_FILTER_INVALID','Choose all, errors, warnings or ready products.');
    if(typeof search!=='string'||search.length>1024)fail('SUPPLIER_SEARCH_INVALID','Use a material or supplier identifier up to 1024 characters.');
    const clauses=['review_id=?'],args=[review.id];
    if(status==='errors')clauses.push('errors>0');
    if(status==='warnings')clauses.push('warnings>0');
    if(status==='ready')clauses.push('errors=0');
    if(search.length){clauses.push("(supplier_id LIKE ? ESCAPE '\\' OR json_extract(record_json,'$.materialId') LIKE ? ESCAPE '\\')");args.push(like(search),like(search));}
    const where=clauses.join(' AND '),total=count(this.db,'SELECT COUNT(*) n FROM catalog_supplier_products WHERE '+where,...args);
    const rows=this.db.prepare('SELECT record_json FROM catalog_supplier_products WHERE '+where+' ORDER BY material_key LIMIT ? OFFSET ?')
      .all(...args,paging.limit,paging.offset).map(parse);
    return {reviewId:review.id,...paging,total,nextOffset:paging.offset+rows.length<total?paging.offset+rows.length:null,rows};
  }
  export({reviewId,format,expectedReviewSha256}) {
    const review=this.review(reviewId);
    expectedHash(review.sha256,expectedReviewSha256,'The selected supplier review');
    const workspace=this;
    function* rows() {
      for(const saved of workspace.db.prepare('SELECT record_json FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key').iterate(review.id))
        yield verifySealed(parse(saved),ROW_SCHEMA);
    }
    const filename='supplier-'+review.planId+'-'+review.id+'-';
    if(format==='review.json')return{type:'application/json; charset=utf-8',filename:filename+format,body:JSON.stringify(review,null,2)+'\n'};
    if(format==='issues.csv'){
      const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
      function* issues(){
        yield ['scope','materialId','supplierProductId','severity','code','path','message','ruleSection','ruleUrl'].map(csv).join(',')+'\r\n';
        for(const finding of review.globalFindings??[])yield ['delivery','','',finding.severity,finding.code,finding.path,finding.message,finding.rule?.section,finding.rule?.url].map(csv).join(',')+'\r\n';
        for(const row of rows())for(const finding of row.findings)
          yield ['product',row.materialId,supplierId(row.product),finding.severity,finding.code,finding.path,finding.message,
            finding.rule?.section, finding.rule?.url].map(csv).join(',')+'\r\n';
      }
      return{type:'text/csv; charset=utf-8',filename:filename+format,body:issues()};
    }
    if(format==='products.jsonl'){
      function* products(){for(const row of rows())yield JSON.stringify(row)+'\n';}
      return{type:'application/x-ndjson; charset=utf-8',filename:filename+format,body:products()};
    }
    if(format!=='bmecat.xml')fail('SUPPLIER_EXPORT_FORMAT_INVALID','Choose review.json, issues.csv, products.jsonl or bmecat.xml.');
    if(review.counts.errors||!review.counts.total)
      fail('SUPPLIER_CORRECTIONS_REQUIRED','Resolve the '+review.counts.errors+' delivery errors and review a nonempty product edition before creating BMEcat.');
    const exported=exportSupplierProducts(rows(),{profile:review.plan.profile,submission:review,format,productIds:productIds(this.db,review.id)});
    return{type:exported.type??exported.contentType,filename:exported.filename??filename+format,body:exported.body};
  }
}
