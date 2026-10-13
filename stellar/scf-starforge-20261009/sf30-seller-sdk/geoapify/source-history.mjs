// MIT. Compare complete source editions without inventing business-row identities.
import {hash,canonical,object,own,fail,inspectIntake} from './source.mjs';
export const COMPARISON_SCHEMA='stellar-forge.geoapify-source-comparison.v1';
const same=(a,b)=>canonical(a)===canonical(b);
const identity=row=>typeof row.identity==='string'&&row.identity.trim()?row.identity:null;
const group=rows=>{const out=new Map();for(const row of rows){const key=identity(row);if(key!==null){const list=out.get(key)??[];list.push(row);out.set(key,list);}}return out;};
function changedFields(a,b){
  return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().filter(k=>own(a,k)!==own(b,k)||!same(a[k],b[k]));
}
export function compareSources({before,after,beforeSha256,afterSha256,edition}){
  inspectIntake(before);inspectIntake(after);
  const old=group(before.rows),next=group(after.rows),rows=[],visited=new Set(),counts={};
  const add=(status,a,b,extra={})=>{
    const value={status,identity:identity(b??a),beforeOrdinal:a?.ordinal??null,afterOrdinal:b?.ordinal??null,
      beforeQueryId:a?.queryId??null,afterQueryId:b?.queryId??null,
      changedFields:a&&b?changedFields(a.source,b.source):[],...extra};
    value.id='change-'+hash(canonical(value));rows.push(value);counts[status]=(counts[status]??0)+1;
  };
  for(const row of before.rows){
    const id=identity(row),olds=id===null?[]:old.get(id),news=id===null?[]:next.get(id)??[];
    if(id===null){add('UNMATCHED_BEFORE',row,null);continue;}
    if(olds.length!==1||news.length>1){
      add('AMBIGUOUS_BEFORE',row,null,{beforeCount:olds.length,afterCount:news.length});continue;
    }
    if(!news.length){add('REMOVED',row,null);continue;}
    const b=news[0];visited.add(b.ordinal);
    add(same(row.source,b.source)&&row.queryId===b.queryId?'UNCHANGED':'CHANGED',row,b);
  }
  for(const row of after.rows){
    if(visited.has(row.ordinal))continue;
    const id=identity(row),olds=id===null?[]:old.get(id)??[],news=id===null?[]:next.get(id);
    if(id===null)add('UNMATCHED_AFTER',null,row);
    else if(news.length!==1||olds.length>1)add('AMBIGUOUS_AFTER',null,row,{beforeCount:olds.length,afterCount:news.length});
    else add('ADDED',null,row);
  }
  const beforeQueries=new Set(Object.keys(before.queries)),afterQueries=Object.keys(after.queries);
  const comparison={schema:COMPARISON_SCHEMA,
    before:{intakeSha256:beforeSha256,editionId:edition.id,snapshot:edition.snapshot,source:before.source},
    after:{intakeSha256:afterSha256,source:after.source},
    identityRule:'Only a nonempty business identity occurring exactly once in each source pairs records. Duplicate and missing identities remain explicit unpaired records. Address-query reuse is separate from business-row matching.',
    summary:{beforeRows:before.rows.length,afterRows:after.rows.length,counts,
      unchangedQueries:afterQueries.filter(id=>beforeQueries.has(id)).length,
      newQueries:afterQueries.filter(id=>!beforeQueries.has(id)).length,
      removedQueries:[...beforeQueries].filter(id=>!own(after.queries,id)).length,
      mappingChanged:!same(before.mapping,after.mapping)},rows};
  comparison.id='comparison-'+hash(canonical(comparison));return comparison;
}
export function inheritedMatches({intake,baselineReview}){
  const matches={};
  for(const row of baselineReview?.rows??[]){
    if(!own(intake.queries,row.id)||!same(intake.queries[row.id],row.params))continue;
    matches[row.id]={status:row.providerStatus,responseSha256:row.responseSha256,
      candidates:row.candidates.map(c=>({id:c.id,index:c.index,raw:structuredClone(c.raw)})),
      error:structuredClone(row.error??null)};
  }
  return matches;
}
export function reusableDecisions({intake,baselineReview}){
  const out=[],ordinals=new Map();
  for(const row of intake.rows){const list=ordinals.get(row.queryId)??[];list.push(row.ordinal);ordinals.set(row.queryId,list);}
  for(const row of baselineReview?.rows??[]){
    if(!row.decisionCurrent||!row.decision||!own(intake.queries,row.id)||!same(intake.queries[row.id],row.params))continue;
    out.push({queryId:row.id,params:row.params,
      sourceOrdinals:ordinals.get(row.id)??[],
      baselineDecision:structuredClone(row.decision),baselineResponseSha256:row.responseSha256,
      candidateId:row.decision.candidateId,coordinateChoice:row.decision.coordinateChoice});
  }
  return out;
}
export function validateComparison(comparison,{before,after,beforeSha256,afterSha256,edition}){
  if(!object(comparison)||canonical(compareSources({before,after,beforeSha256,afterSha256,edition}))!==canonical(comparison))
    throw fail('COMPARISON_CHANGED','The complete source comparison differs from its original intake and frozen edition.',409);
  return comparison;
}
