// MIT. Readable CKAN case views shared by the original browser and handoff.
// Every original string is escaped before it enters this HTML.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nativeText=value=>value===null||value===undefined?'—':typeof value==='string'?value:JSON.stringify(value);
const table=(heads,rows)=>'<div class="scroll case-table-wrap"><table class="case-table"><thead><tr>'+heads.map(value=>'<th>'+esc(value)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(nativeText(value))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const original=(label,value,text)=>value===null||value===undefined?'':
  '<details><summary>'+esc(label)+'</summary><pre>'+esc(text??JSON.stringify(value,null,2))+'</pre></details>';
const recordState=value=>value?.state??value?.status??null;


export function ckanCaptureHtml(c) {
  const s=c.ckan,p=s.project??{},selected=s.registrationSelection,w=s.workbench??{},op=s.operation;
  const source=s.source,effective=s.effectiveSource,refresh=s.refresh,pub=s.publication;
  const refreshRecord=refresh?.record,pubRecord=pub?.record;
  return '<h3>Original catalog project</h3>'+
    table(['Catalog origin','Project created','Last saved','Observation coverage'],[[p.catalogOrigin,p.createdAt,p.updatedAt,s.coverage]])+
    '<p>Registered workspace: '+esc(selected.directory)+' · Saved-state reads: '+esc(w.stable===true?'Stable':w.stable===false?'Changed during read':'Unavailable')+'</p>'+
    table(['Original state before SHA-256','Original state after SHA-256'],[[w.beforeSha256,w.afterSha256]])+
    '<h3>Selected source and operation</h3>'+
    table(['Source','Effective source','Edition','Exact source SHA-256'],[[source?.id,effective?.id??source?.id,effective?.editionId??source?.editionId,effective?.sha256??source?.sha256]])+
    table(['Saved operation','Kind / state','Started / completed','Recorded age / threshold'],[[
      op?.id,op?nativeText(op.kind)+' / '+nativeText(op.state):null,
      op?nativeText(op.startedAt)+' / '+nativeText(op.completedAt):null,
      op?nativeText(op.ageSeconds)+' / '+selected.operationAfterSeconds+' seconds':null]])+
    original('Original saved operation',op,s.originalDocuments?.operation)+
    original('Registered source selection and workload',selected)+
    original('Complete selected source declaration metadata',source,s.originalDocuments?.source)+
    (effective?.id&&effective.id!==source?.id?original('Complete effective successor source metadata',effective,s.originalDocuments?.effectiveSource):'')+
    '<h3>Original retained editions</h3>'+
    table(['Edition','State','Selected rows / pages','Capture SHA-256','Semantic definition'],s.editions.map(e=>[
      e.id,e.state,nativeText(e.rowCount)+' / '+nativeText(e.pageCount),e.manifestSha256,e.semanticSchemaSha256]))+
    original('Complete edition metadata and selections',s.editions,s.originalDocuments?.editions)+
    '<h3>Reviewed refresh</h3>'+
    (refresh?table(['Refresh','State','Comparison SHA-256','Decision SHA-256'],[[
      refreshRecord.id,recordState(refreshRecord),refreshRecord.comparisonSha256,refresh.decisionSha256]])+
      table(['Decision pending','Review pending / age','Complete row-change stream','Change stream SHA-256'],[[
        refresh.decisionPending,refresh.reviewPending+' / '+nativeText(refresh.reviewAgeSeconds)+' seconds',
        refresh.changes?nativeText(refresh.changes.rows)+' rows · '+refresh.changes.bytes+' bytes':null,refresh.changes?.sha256]])+
      '<p>The comparison retains the original query selection, row identities and interpretation. A different query window changes which rows were selected; inspect that selection before interpreting additions or removals.</p>'+
      original('Complete original comparison and interpretation',refresh.comparison,s.originalDocuments?.comparison)+
      original('Complete original review decision',refresh.decision,s.originalDocuments?.decision)+
      original('Original refresh record',refreshRecord,s.originalDocuments?.refresh):
      '<p>No related refresh is selected in this observation.</p>')+
    '<h3>Publication and merchant output</h3>'+
    (pub?table(['Publication','Saved state','Published output retained','Verified CSV bytes / rows'],[[
      pubRecord.id,recordState(pubRecord),pub.published,
      pub.verifiedOutput?pub.verifiedOutput.bytes+' / '+nativeText(pub.verifiedOutput.rowCount):null]])+
      table(['Original output SHA-256','Original snapshot','Publication review age / threshold'],[[
        pub.verifiedOutput?.sha256,pub.verifiedOutput?.snapshot,
        nativeText(s.pending?.publicationAgeSeconds)+' / '+selected.publicationAfterSeconds+' seconds']])+
      original('Original publication review',pub.review,s.originalDocuments?.publicationReview)+
      original('Original candidate',pub.candidate,s.originalDocuments?.candidate)+
      original('Original publication result',pub.result,s.originalDocuments?.publicationResult)+
      original('Original publication record',pubRecord,s.originalDocuments?.publication):
      '<p>No related publication is selected in this observation.</p>')+
    original('Original merchant exports and retained semantics',s.exports,s.originalDocuments?.exports)+
    '<h3>Complete retained source inventory</h3>'+
    '<p>'+esc(s.files.count)+' original files · '+esc(s.files.bytes)+' bytes. The portable case carries their complete bytes in the original CKAN packet.</p>'+
    table(['Original relative path','Role','Bytes','SHA-256'],s.originalFiles.map(f=>[f.path,f.role,f.bytes,f.sha256]));
}

export function ckanComparisonHtml(comparison) {
  if(!comparison.ckan)return '';
  const {before,after}=comparison.ckan;
  const rows=[
    ['Source',before.source.id,after.source.id],
    ['Effective source',before.source.effectiveId,after.source.effectiveId],
    ['Effective source SHA-256',before.source.sha256,after.source.sha256],
    ['Saved operation',recordState(before.operation),recordState(after.operation)],
    ['Refresh',before.refresh?.id,after.refresh?.id],
    ['Refresh state',before.refresh?.state,after.refresh?.state],
    ['Decision SHA-256',before.refresh?.decisionSha256,after.refresh?.decisionSha256],
    ['Publication',before.publication?.id,after.publication?.id],
    ['Verified output SHA-256',before.publication?.verifiedOutput?.sha256,after.publication?.verifiedOutput?.sha256]
  ];
  return table(['Original record','Before','After'],rows);
}
