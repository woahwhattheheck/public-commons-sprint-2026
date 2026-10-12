// MIT. Full cross-profile result composition on the original sealed-file archive and native writers.
import { decodeText, labError } from './table.mjs';
import { canonicalJson, sha256, normalizeDecisions, previewDelivery, renderPreparedFiles } from './model.mjs';
import { reviewTable, issueTable } from './decisions.mjs';
import { writeLabZip } from './zip.mjs';
import { renderLabReport } from './report.mjs';
import { reconcileDeliveries, normalizeReconciliation, previewReconciliation } from './reconciliation.mjs';
import { reconciliationTable, parseReconciliationTable, reconciliationFieldTable } from './reconciliation-table.mjs';
import { renderReconciliationReport } from './reconciliation-report.mjs';
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export function readReconciliationDecisions(comparison,bytes,metadata,{format}={}){
  const selected=format??(/\.tsv$/i.test(metadata.filename)?'tsv':/\.csv$/i.test(metadata.filename)?'csv':'json');
  if(!['json','csv','tsv'].includes(selected))labError('CROSS_DECISION_FORMAT','Select JSON, CSV or TSV for correspondence decisions.');
  const text=decodeText(bytes).replace(/^\uFEFF/,'');
  if(selected!=='json')return parseReconciliationTable(comparison,text,{format:selected});
  let document;try{document=JSON.parse(text);}catch{labError('CROSS_DECISION_JSON','Supply the complete saved correspondence JSON.');}
  return normalizeReconciliation(comparison,document);
}
export async function appendReconciliationResult({
  archive,current,baseline,currentReview,baselineDocument,comparison,document,context,input,originalNames
}){
  const signal=context.signal,baselineReview=previewDelivery(baseline,baselineDocument??normalizeDecisions(baseline));
  const correspondence=previewReconciliation(comparison,document);
  const after=reconcileDeliveries(current,baseline,{currentReview,baselineReview});
  let prepared=[],nativeZip=null,nativePreparation;
  try{
    prepared=await renderPreparedFiles(baseline,baselineReview,{signal,processes:context.processes});
    nativeZip=writeLabZip(prepared,{signal});nativePreparation={status:'PREPARED',files:prepared.length};
  }catch(error){
    signal.throwIfAborted();nativePreparation={status:'REVIEW_REQUIRED',error:{code:String(error.code??'NATIVE_PREPARATION'),
      message:String(error.message??error),...((error.details??error.detail)===undefined?{}:{detail:error.details??error.detail})}};
  }
  if(nativeZip)await archive.add('prepared/baseline-receiving-files.zip',nativeZip,{contentType:'application/zip'});
  await archive.add('baseline/native-preparation.json',json(nativePreparation),{contentType:'application/json'});
  await archive.add('baseline/source/manifest.json',json({...baseline.source,unassigned:baseline.unassigned}),{contentType:'application/json'});
  await archive.add('baseline/source/rows.json',json(baseline.tables),{contentType:'application/json'});
  await archive.add('baseline/decisions.json',json(baselineReview.document),{contentType:'application/json'});
  await archive.add('baseline/review.json',json(baselineReview),{contentType:'application/json'});
  await archive.add('baseline/issues.csv',Buffer.from(issueTable({...baseline,report:baselineReview.report})),{contentType:'text/csv'});
  await archive.add('baseline/lineage.json',json(baselineReview.report.lineage),{contentType:'application/json'});
  const baselineTables={},correspondenceTables={};
  for(const format of ['csv','tsv']){
    signal.throwIfAborted();
    const fields=reviewTable(baseline,baselineReview.document,{format,scope:input.tableScope??'issues'});
    await archive.add('baseline/decisions.'+format,Buffer.from(fields.text),{contentType:fields.mime});
    baselineTables[format]={rows:fields.rows,bytes:Buffer.byteLength(fields.text),sha256:sha256(fields.text)};
    const table=reconciliationTable(comparison,correspondence.document,{format});
    await archive.add('reconciliation/decisions.'+format,Buffer.from(table.text),{contentType:table.mime});
    correspondenceTables[format]={rows:table.rows,groups:table.groups,links:table.links,bytes:Buffer.byteLength(table.text),sha256:sha256(table.text)};
  }
  const fieldTable=reconciliationFieldTable(comparison);
  await archive.add('reconciliation/fields.csv',Buffer.from(fieldTable.text),{contentType:fieldTable.mime});
  await archive.add('reconciliation/decisions.json',json(correspondence.document),{contentType:'application/json'});
  await archive.add('reconciliation/review.json',json(correspondence),{contentType:'application/json'});
  await archive.add('reconciliation/output-comparison.json',json(after),{contentType:'application/json'});
  const baselineLinks={
    'Current source editor':'../report.html','Cross-profile correspondence':'../reconciliation.html',
    'Original baseline file':'../'+originalNames.baseline,'Native preparation state':'native-preparation.json',
    'Complete original baseline rows':'source/rows.json','Baseline computed review':'review.json',
    'Baseline decisions JSON':'decisions.json','Baseline editable CSV':'decisions.csv','Baseline editable TSV':'decisions.tsv',
    'Full baseline lineage':'lineage.json'
  };
  if(nativeZip)baselineLinks['Native baseline receiving files']='../prepared/baseline-receiving-files.zip';
  if(originalNames.baseline_decisions)baselineLinks['Original supplied baseline decisions']='../'+originalNames.baseline_decisions;
  await archive.add('baseline/report.html',Buffer.from(renderLabReport(baseline,baselineReview,{
    links:baselineLinks,nativePreparation,comparison:{schema:comparison.schema,comparisonSha256:comparison.comparisonSha256,
      counts:comparison.counts,byKind:comparison.byKind,completeReview:'../reconciliation.html'}
  })),{contentType:'text/html; charset=utf-8'});
  const links={
    currentReport:'report.html',baselineReport:'baseline/report.html',
    completeOriginalComparison:'comparison.json',computedCorrespondenceReview:'reconciliation/review.json',
    preparedOutputComparison:'reconciliation/output-comparison.json',fullFieldDifferences:'reconciliation/fields.csv',
    savedCorrespondenceJSON:'reconciliation/decisions.json',completeEditableCSV:'reconciliation/decisions.csv',
    completeEditableTSV:'reconciliation/decisions.tsv'
  };
  if(nativeZip)links.baselineNativeFiles='prepared/baseline-receiving-files.zip';
  await archive.add('reconciliation.html',Buffer.from(renderReconciliationReport(comparison,correspondence,{links})),{contentType:'text/html; charset=utf-8'});
  return {schema:'starforge.lab-edd-cross-profile-result.v1',comparisonSha256:comparison.comparisonSha256,
    mapping:{id:comparison.mapping.id,version:comparison.mapping.version},
    documentSha256:correspondence.documentSha256,reviewSha256:correspondence.reviewSha256,
    counts:correspondence.counts,sourceCounts:comparison.counts,byKind:comparison.byKind,
    outputComparisonSha256:after.comparisonSha256,outputCounts:after.counts,
    baseline:{sourceSha256:baseline.source.sourceSha256,profile:baseline.source.profile,
      documentSha256:baselineReview.documentSha256,reviewSha256:baselineReview.reviewSha256,
      report:{summary:baselineReview.report.summary,counts:baselineReview.report.counts,disposition:baselineReview.report.disposition},
      changes:baselineReview.changes,nativePreparation,editableTables:baselineTables,
      prepared:nativeZip?{archive:'prepared/baseline-receiving-files.zip',bytes:nativeZip.byteLength,sha256:sha256(nativeZip),
        files:prepared.map(file=>({filename:file.filename,bytes:file.size,sha256:file.sha256,mediaType:file.mediaType??null}))}:null},
    editableTables:correspondenceTables,fieldTable:{rows:fieldTable.rows,bytes:Buffer.byteLength(fieldTable.text),sha256:sha256(fieldTable.text)}};
}
