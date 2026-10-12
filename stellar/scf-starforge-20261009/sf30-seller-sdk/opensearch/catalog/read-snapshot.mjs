// MIT. Read-only exports of the original material and supplier workspace.
import { DatabaseSync } from 'node:sqlite';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OpenSearchCatalogWorkspace } from './workspace.mjs';
import { SupplierWorkspace } from './supplier/workspace.mjs';
import { WorkspaceError, clone, canonical, identifier } from '../workspace/store.mjs';

const fail = (code, message) => { throw new WorkspaceError(code, message, 409); };
function frozen(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * Pin a read transaction on the same original SQLite database. The facade
 * exposes the maintained read/export methods only; it creates no schema, source,
 * merchant, writer lease, operation, or copy of the database. Consume every
 * selected generator before close(), including generators which read source
 * files between SQLite rows. The caller must close this lifetime in finally.
 */
export async function openCatalogReadSnapshot(original) {
  original.open();
  const filename = join(original.store.directory, 'workspace.sqlite3');
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink())
    fail('CATALOG_SNAPSHOT_SOURCE_INVALID', 'Use the original regular workspace database.');
  const db = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
  let closed = false, begun = false;
  function close() {
    if (closed) return;
    let rollbackError;
    if (begun) {
      try { db.exec('ROLLBACK'); begun = false; }
      catch (error) { rollbackError = error; }
    }
    try { db.close(); closed = true; }
    catch (error) {
      throw new WorkspaceError('CATALOG_SNAPSHOT_CLOSE_INCOMPLETE',
        'The original read snapshot remains open; retry closing this same snapshot.', 503);
    }
    if (rollbackError && !closed) throw rollbackError;
  }
  try {
    const after = await lstat(filename);
    if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino)
      fail('CATALOG_SNAPSHOT_SOURCE_CHANGED', 'The original workspace database was replaced while opening its read snapshot.');
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');
    begun = true;
    // The first read fixes the WAL generation for every later SQL statement.
    const saved = Object.fromEntries(db.prepare("SELECT key,value FROM meta WHERE key IN ('workspace_id','source_profile_sha256')").all()
      .map(row => [row.key, row.value]));
    if (saved.workspace_id !== original.store.id || saved.source_profile_sha256 !== original.store.profileHash)
      fail('CATALOG_SNAPSHOT_IDENTITY_CHANGED', 'The read snapshot belongs to a different original workspace.');
    const assertOpen = () => {
      if (closed) fail('CATALOG_SNAPSHOT_CLOSED', 'This original read snapshot has closed.');
    };
    const store = Object.freeze({
      db, directory: original.store.directory, id: original.store.id, profileHash: original.store.profileHash,
      transaction(action) {
        assertOpen();
        const result = action();
        if (result && typeof result.then === 'function')
          fail('CATALOG_SNAPSHOT_ASYNC_TRANSACTION', 'Use the original synchronous snapshot selector before streaming its body.');
        return result;
      },
    });
    const workspace = Object.freeze({
      store,
      config: frozen(clone(original.workspace.config)),
      templatePlan: frozen(clone(original.workspace.templatePlan)),
    });
    const catalog = { db, store, root: original.root, workspace, open: assertOpen };
    for (const name of ['catalog','history','source','sourcePath','retainedSource','edition',
      'material','materials','changes','decisionView','facets','decisions','suggest','quantity','export']) {
      const method = OpenSearchCatalogWorkspace.prototype[name];
      catalog[name] = (...args) => { assertOpen(); return Reflect.apply(method, catalog, args); };
    }
    const supplier = { db, store, catalog };
    for (const name of ['plan','planHistory','correction','review','reviewRow','rows','recipientRows','export']) {
      const method = SupplierWorkspace.prototype[name];
      supplier[name] = (...args) => { assertOpen(); return Reflect.apply(method, supplier, args); };
    }
    catalog.supplier = Object.freeze(supplier);
    return Object.freeze({ catalog: Object.freeze(catalog), close });
  } catch (error) {
    try { close(); } catch (cleanup) { cleanup.cause = error; throw cleanup; }
    throw error;
  }
}


/**
 * Hash the actual records selected by the original exporters in this one read
 * transaction. This is a streamed SQL inventory, not another document export.
 * Binary sources are pinned by their original manifests; the original bundle
 * exporter verifies their complete bytes before and after copying each source.
 */
export function fingerprintCatalogExportSnapshot(catalog,{kind,request,selection}) {
  catalog.open();
  const schema='stellar-forge.catalog-export-source.v1',hash=createHash('sha256');
  const sections=[];let rows=0,bytes=0;
  const section=(name,iterable,visit)=>{
    const result={name,rows:0,bytes:0};hash.update(name+'\0');
    for(const row of iterable) {
      const raw=Buffer.from(canonical(row));
      hash.update(String(raw.length)+':');hash.update(raw);hash.update('\n');
      result.rows++;result.bytes+=raw.length;
      if(visit)visit(row);
    }
    hash.update('END\n');rows+=result.rows;bytes+=result.bytes;sections.push(result);
  };
  const scan=(name,sql,args=[],visit)=>section(name,catalog.db.prepare(sql).iterate(...args),visit);
  section('selection',[{schema,workspaceId:catalog.store.id,sourceProfileSha256:catalog.store.profileHash,
    kind,request,selection}]);
  if(kind==='supplier') {
    identifier(request.reviewId,'supplier review ID');
    scan('supplier-review','SELECT id,plan_id,created_at,record_json FROM catalog_supplier_reviews WHERE id=?',[request.reviewId]);
    scan('supplier-products','SELECT review_id,material_key,supplier_id,errors,warnings,record_json FROM catalog_supplier_products WHERE review_id=? ORDER BY material_key',[request.reviewId]);
    if(catalog.db.prepare('SELECT 1 FROM catalog_supplier_recipient WHERE review_id=? LIMIT 1').get(request.reviewId))
      scan('supplier-recipient','SELECT review_id,kind,record_key,supplier_key,identifier,action,record_json FROM catalog_supplier_recipient WHERE review_id=? ORDER BY kind,record_key',[request.reviewId]);
  } else if(kind==='material') {
    const catalogId=identifier(request.catalogId,'catalog ID');
    const bundle=request.formats.includes('catalog-bundle.jsonl'),sourceIds=new Set();
    const lookupIds=value=>{
      if(!value||typeof value!=='object')return;
      if(value.lookup?.sourceId)sourceIds.add(value.lookup.sourceId);
      for(const child of Object.values(value))if(child&&typeof child==='object')lookupIds(child);
    };
    scan('catalog','SELECT id,revision,record_json FROM catalog_catalogs WHERE id=?',[catalogId]);
    if(bundle) {
      scan('catalog-history','SELECT catalog_id,revision,record_json FROM catalog_history WHERE catalog_id=? ORDER BY revision',
        [catalogId],row=>lookupIds(JSON.parse(row.record_json).mapping));
      scan('editions','SELECT id,catalog_id,created_at,record_json FROM catalog_editions WHERE catalog_id=? ORDER BY created_at,id',
        [catalogId],row=>{
          const edition=JSON.parse(row.record_json);sourceIds.add(edition.source.id);
          for(const source of edition.dependencies)sourceIds.add(source.id);
        });
      scan('materials','SELECT m.edition_id,m.material_key,m.material_id,m.sha256,m.record_json FROM catalog_materials m JOIN catalog_editions e ON e.id=m.edition_id WHERE e.catalog_id=? ORDER BY m.edition_id,m.material_key',[catalogId]);
      scan('decisions','SELECT id,catalog_id,context_key,revision,record_json FROM catalog_decisions WHERE catalog_id=? ORDER BY id',[catalogId]);
      scan('decision-history','SELECT h.decision_id,h.revision,h.record_json FROM catalog_decision_history h JOIN catalog_decisions d ON d.id=h.decision_id WHERE d.catalog_id=? AND h.revision<=d.revision ORDER BY h.decision_id,h.revision',[catalogId]);
      scan('supplier-plans','SELECT id,catalog_id,revision,record_json FROM catalog_supplier_plans WHERE catalog_id=? ORDER BY id',[catalogId]);
      scan('supplier-plan-history','SELECT h.plan_id,h.revision,h.record_json FROM catalog_supplier_plan_history h JOIN catalog_supplier_plans p ON p.id=h.plan_id WHERE p.catalog_id=? AND h.revision<=p.revision ORDER BY h.plan_id,h.revision',[catalogId]);
      scan('supplier-corrections','SELECT c.id,c.plan_id,c.material_key,c.revision,c.record_json FROM catalog_supplier_corrections c JOIN catalog_supplier_plans p ON p.id=c.plan_id WHERE p.catalog_id=? ORDER BY c.id',[catalogId]);
      scan('supplier-correction-history','SELECT h.correction_id,h.revision,h.record_json FROM catalog_supplier_correction_history h JOIN catalog_supplier_corrections c ON c.id=h.correction_id JOIN catalog_supplier_plans p ON p.id=c.plan_id WHERE p.catalog_id=? AND h.revision<=c.revision ORDER BY h.correction_id,h.revision',[catalogId]);
      scan('supplier-reviews','SELECT r.id,r.plan_id,r.created_at,r.record_json FROM catalog_supplier_reviews r JOIN catalog_supplier_plans p ON p.id=r.plan_id WHERE p.catalog_id=? ORDER BY r.created_at,r.id',[catalogId]);
      scan('supplier-products','SELECT r.review_id,r.material_key,r.supplier_id,r.errors,r.warnings,r.record_json FROM catalog_supplier_products r JOIN catalog_supplier_reviews v ON v.id=r.review_id JOIN catalog_supplier_plans p ON p.id=v.plan_id WHERE p.catalog_id=? ORDER BY r.review_id,r.material_key',[catalogId]);
      if(catalog.db.prepare('SELECT 1 FROM catalog_supplier_recipient r JOIN catalog_supplier_reviews v ON v.id=r.review_id JOIN catalog_supplier_plans p ON p.id=v.plan_id WHERE p.catalog_id=? LIMIT 1').get(catalogId))
        scan('supplier-recipient','SELECT r.review_id,r.kind,r.record_key,r.supplier_key,r.identifier,r.action,r.record_json FROM catalog_supplier_recipient r JOIN catalog_supplier_reviews v ON v.id=r.review_id JOIN catalog_supplier_plans p ON p.id=v.plan_id WHERE p.catalog_id=? ORDER BY r.review_id,r.kind,r.record_key',[catalogId]);
      section('sources',(function*(){for(const id of [...sourceIds].sort())yield catalog.source(id);})());
    } else {
      const editionIds=new Set(selection.editionId?[selection.editionId]:[]);
      if(request.formats.includes('delta.ndjson')&&selection.editionId) {
        const base=catalog.edition(selection.editionId).baseEditionId;if(base)editionIds.add(base);
      }
      if(request.formats.includes('approved-matches.csv')) {
        if(selection.activeEditionId)editionIds.add(selection.activeEditionId);
        scan('decisions','SELECT id,catalog_id,context_key,revision,record_json FROM catalog_decisions WHERE catalog_id=? ORDER BY id',[catalogId]);
      }
      for(const id of [...editionIds].sort()) {
        scan('edition:'+id,'SELECT id,catalog_id,created_at,record_json FROM catalog_editions WHERE id=?',[id]);
        scan('materials:'+id,'SELECT edition_id,material_key,material_id,sha256,record_json FROM catalog_materials WHERE edition_id=? ORDER BY material_key',[id]);
      }
    }
    if(request.formats.includes('source.json')) {
      const {queries:_queries,...connection}=catalog.workspace.config;
      section('source-connection',[connection]);
    }
  } else fail('CATALOG_EXPORT_SNAPSHOT_KIND_INVALID','Choose an original material or supplier export.');
  return Object.freeze({schema,sha256:hash.digest('hex'),rows,bytes,
    sections:Object.freeze(sections.map(item=>Object.freeze(item)))});
}
