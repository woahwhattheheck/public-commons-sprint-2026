import { canonical,copy,objectDigest,requireValue,verifyDocumentDigest } from '../vendor/sling/migration/common.mjs';
import { identifier,relation } from './plan.mjs';
// Retains original source/queries and explicit literal-edit intent. The original
// merchant adapter remains the authoritative parser, compiler and native runtime.
export function prepareMerchantSource(original,binding,edits){
  requireValue(original?.schema==='stellar-forge.clickhouse-source.v1','merchant_source','Select the complete original merchant source.');
  requireValue(binding?.schema==='altinity.consumer-binding.v1','consumer_binding','Select the retained accepted table declaration.');
  requireValue(Array.isArray(edits)&&edits.length>0,'merchant_edits','Select exact reviewed source/query replacements.');
  const derived=copy(original),changes=[];
  for(const edit of edits){
    requireValue(edit&&typeof edit.queryId==='string'&&typeof edit.find==='string'&&edit.find.length&&typeof edit.replace==='string'&&Number.isSafeInteger(edit.expectedOccurrences)&&edit.expectedOccurrences>0&&typeof edit.reason==='string'&&edit.reason.length,'merchant_edit','Every edit needs a query ID, literal pre/post text, exact count and reason.');
    const row=derived.queries?.[edit.queryId];
    requireValue(row&&typeof row.sql==='string','merchant_query','The selected original query is unavailable.');
    const count=row.sql.split(edit.find).length-1;requireValue(count===edit.expectedOccurrences,'merchant_occurrences','The retained literal source changed.',{queryId:edit.queryId,actual:count});
    const before=row.sql;row.sql=before.split(edit.find).join(edit.replace);changes.push({...copy(edit),before,after:row.sql});
  }
  // Named credentials remain host references. Neither source nor binding contains their values.
  derived.endpointEnv=binding.connection.endpointEnv;derived.userEnv=binding.connection.userEnv;derived.passwordEnv=binding.connection.passwordEnv;derived.allowLocal=binding.connection.allowLocal;
  const databases=[...new Set(binding.tables.map(t=>t.relation[0]))];requireValue(databases.length===1,'merchant_database','One original merchant source selects one native database.');derived.database=databases[0];
  const body={schema:'altinity.merchant-source-change.v1',originalSource:copy(original),originalSourceSha256:objectDigest(original),binding:copy(binding),bindingSha256:objectDigest(binding),derivedSource:derived,derivedSourceSha256:objectDigest(derived),changes,nativeReviewRequired:true,scope:'Import derivedSource into the retained original ClickHouse operator; save, native review, prepare and stage through its existing APIs.'};
  return{...body,changeId:objectDigest(body)};
}
