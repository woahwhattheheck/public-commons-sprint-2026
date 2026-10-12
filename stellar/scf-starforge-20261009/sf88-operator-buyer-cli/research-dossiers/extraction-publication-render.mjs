// MIT. Complete neutral reports over the original publication model; no calculations or network reads.
const json=value=>JSON.stringify(value,null,2);
const line=value=>String(value??'');
const html=value=>line(value).replace(/[&<>"']/g,char=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const md=value=>line(value).replace(/[\\\x60*_{}\[\]<>#+!|]/g,'\\$&').replace(/\r\n|\r|\n/g,' ');
const status=(report,id)=>report.statuses.find(value=>value.publicationId===id)?.status??'published';
const position=(report,id)=>report.statuses.find(value=>value.publicationId===id)??null;
const pubReviews=(report,id)=>report.reviews.filter(value=>value.publicationId===id);
const pubImpacts=(report,id)=>report.impacts.filter(value=>value.publicationId===id);
const pubWithdrawals=(report,id)=>report.withdrawals.filter(value=>value.publicationId===id);

/** Values are printed from their original JSON representation. Numeric strings are never parsed. */
export function extractionPublicationCellText(cell,column){
  if(!cell?.present)return '(missing pointer)';
  const value=cell.value;
  if(column.format==='json')return JSON.stringify(value);
  if(column.format==='typed'&&Array.isArray(value)&&value.length===2&&typeof value[0]==='string')
    return '['+value[0]+'] '+JSON.stringify(value[1]);
  if(typeof value==='string')return value;
  return JSON.stringify(value);
}
function csvCell(value){
  let text=value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);
  // Preserve literal string tokens in common spreadsheet readers; JSON columns retain exact originals.
  if(typeof value==='string'&&(/^[\s]*[=+\-@]/u.test(text)||/^[\t\r\n]/u.test(text)||
    /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(text)))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
function metadata(publication){
  const {rows,...rest}=publication;return {...rest,rowCount:rows.length};
}
/** RFC 4180 rows plus complete JSON for every record, source, review and history item. */
export function extractionPublicationCsv(report){
  const columnIds=[...new Set(report.tableEditions.flatMap(value=>value.definition.columns.map(column=>column.id)))];
  if(report.comparison)for(const publication of [report.comparison.from,report.comparison.to])
    for(const column of publication.definition.columns)if(!columnIds.includes(column.id))columnIds.push(column.id);
  const headers=['record_type','table_id','publication_id','publication_edition','publication_status',
    'result_id','result_edition_id','result_status','question_id','study_id','fingerprint',
    ...columnIds.map(id=>'authored:'+id),'record_json','source_json','review_json'];
  const rows=[];
  function add(recordType,value,context={}){
    const row={record_type:recordType,...context,record_json:value};
    rows.push(headers.map(name=>csvCell(row[name])).join(','));
  }
  const {tables,tableEditions,publications,results,rows:publishedRows,impacts,reviews,withdrawals,
    operations,statuses,comparison,...reportMetadata}=report;
  add('report',{...reportMetadata,statuses,csvMethod:{
    authoredColumns:'Original selected JSON pointers. Missing pointers print explicitly.',
    exactValues:'record_json and source_json contain original numeric string tokens and typed values.',
    stringSafety:'A leading apostrophe protects numeric strings and formula-like text in authored spreadsheet cells.'}});
  for(const table of tables)add('table',table,{table_id:table.id});
  for(const edition of tableEditions)add('table_edition',edition,{table_id:edition.tableId});
  for(const result of results)add('result_edition',result,{result_id:result.resultId,
    result_edition_id:result.editionId,result_status:result.status,question_id:result.questionId,
    study_id:result.studyId,fingerprint:result.fingerprint,source_json:result.sourceBindings});
  for(const publication of publications){
    const context={table_id:publication.tableId,publication_id:publication.id,
      publication_edition:publication.edition,publication_status:status(report,publication.id)};
    add('publication',metadata(publication),{...context,review_json:{original:publication.review,
      history:pubReviews(report,publication.id),currentImpacts:pubImpacts(report,publication.id),
      withdrawals:pubWithdrawals(report,publication.id)}});
    for(const row of publication.rows){
      const cells=Object.fromEntries(publication.definition.columns.map(column=>['authored:'+column.id,
        extractionPublicationCellText(row.cells.find(value=>value.columnId===column.id),column)]));
      add('publication_row',row,{...context,...cells,result_id:row.result.resultId,
        result_edition_id:row.result.editionId,result_status:row.result.status,question_id:row.result.questionId,
        study_id:row.result.studyId,fingerprint:row.fingerprint,source_json:row.result.sourceBindings,
        review_json:publication.review});
    }
  }
  for(const impact of impacts)add('impact',impact,{table_id:impact.tableId,publication_id:impact.publicationId,
    fingerprint:impact.fingerprint,review_json:impact.review});
  for(const review of reviews)add('impact_review',review,{table_id:review.tableId,publication_id:review.publicationId,
    fingerprint:review.fingerprint,review_json:review});
  for(const withdrawal of withdrawals)add('withdrawal',withdrawal,{table_id:withdrawal.tableId,
    publication_id:withdrawal.publicationId,publication_status:'withdrawn'});
  for(const operation of operations)add('operation',operation,{table_id:operation.tableId});
  if(comparison){
    const {from,to,rows:changes,...summary}=comparison;
    add('comparison',summary,{table_id:comparison.tableId});
    for(const publication of [from,to])add('comparison_publication',metadata(publication),
      {table_id:publication.tableId,publication_id:publication.id,publication_edition:publication.edition});
    for(const row of changes)add('comparison_row',row,{table_id:comparison.tableId,result_id:row.resultId,
      result_edition_id:row.after?.result.editionId??row.before?.result.editionId,
      result_status:row.after?.result.status??row.before?.result.status,
      fingerprint:row.after?.fingerprint??row.before?.fingerprint,
      source_json:{before:row.before?.result.sourceBindings??null,after:row.after?.result.sourceBindings??null}});
  }
  return [headers.map(csvCell).join(','),...rows].join('\r\n')+'\r\n';
}
function mdTable(headers,rows){
  return ['| '+headers.map(md).join(' | ')+' |','| '+headers.map(()=> '---').join(' | ')+' |',
    ...rows.map(row=>'| '+row.map(md).join(' | ')+' |')];
}
function mdJson(value){
  const text=json(value);
  let longest=0;for(const run of text.matchAll(/\x60+/g))longest=Math.max(longest,run[0].length);
  const fence=String.fromCharCode(96).repeat(Math.max(3,longest+1));
  return [fence+'json',text,fence];
}
function mdDefinition(edition){
  return ['### Table edition '+edition.edition+' · '+md(edition.definition.name),'',
    'ID: '+md(edition.id),'','Reason: '+md(edition.reason),'',
    ...mdTable(['Column','Label','Original record pointer','Format'],edition.definition.columns.map(column=>
      [column.id,column.label,column.pointer===''?'(complete record)':column.pointer,column.format])),
    '',...mdJson(edition),''];
}
export function extractionPublicationMarkdownLines(report){
  const lines=['## Extraction evidence tables and publications','',
    md(report.dossier.title||report.dossier.id),'',
    'Dossier '+md(report.dossier.id)+' · revision '+report.dossier.revision+
      (report.asOf?' · '+md(report.asOf):''),'',
    ...mdTable(['Tables','Table editions','Publications','Published rows','Current result editions','Current impacts'],
      [[report.overview.tables,report.overview.tableEditions,report.overview.publications,
        report.overview.publishedRows,report.overview.currentResults,report.overview.impacts]]),'',
    'Each publication preserves its complete selected extraction records. Original statuses, source bases, typed values, '+
      'unresolved fields and operator notes remain visible. Later corrections and withdrawals append to this history.',''];
  if(!report.tables.length)lines.push('No evidence table has been authored.','');
  for(const table of report.tables){
    lines.push('### '+md(table.definition.name),'',md(table.definition.description),'',
      'Table '+md(table.id)+' · current definition '+md(table.editionId),'',
      md(table.definition.notes),'');
  }
  for(const publication of report.publications){
    const state=status(report,publication.id),selected=position(report,publication.id);
    lines.push('### Publication '+publication.edition+' · '+md(publication.title),'',
      '**'+md(state.toUpperCase())+'** · '+md(publication.id),'',
      'Published by '+md(publication.actor.name)+' ('+md(publication.actor.id)+') at '+md(publication.createdAt)+'.','',
      'Publication SHA-256: '+md(publication.sha256),'',
      'Table edition: '+md(publication.tableEditionId)+
        (publication.previousPublicationId?' · preceding publication: '+md(publication.previousPublicationId):''),'');
    if(selected?.supersededBy)lines.push('Following publication: '+md(selected.supersededBy),'');
    lines.push(md(publication.summary),'','Correction / publication reason: '+md(publication.reason),'',
      'Limitations: '+md(publication.limitations),'','Operator review: '+md(publication.review.note),'',
      ...mdTable(['Result','Status',...publication.definition.columns.map(column=>column.label)],
        publication.rows.map(row=>[row.result.label,row.result.status,...publication.definition.columns.map(column=>
          extractionPublicationCellText(row.cells.find(cell=>cell.columnId===column.id),column))])),'');
    for(const withdrawal of pubWithdrawals(report,publication.id))
      lines.push('**Withdrawal · '+md(withdrawal.createdAt)+'**','',
        md(withdrawal.reason)+' — '+md(withdrawal.actor.name),'');
    const impacts=pubImpacts(report,publication.id);
    if(impacts.length)lines.push('#### Current source, form and result changes','',
      ...mdTable(['Kind','Impact','Current review','Reason'],impacts.map(impact=>[
        impact.kind,impact.id,impact.review?.disposition??'unreviewed',impact.review?.reason??''])),'');
    lines.push('#### Complete frozen records and review','',
      'The following original JSON is part of this report. It preserves every selected result, source binding, '+
        'submission, resolution, derivation and authored cell.','',...mdJson(publication),'');
    lines.push('#### Current impacts and complete impact-review history','',
      ...mdJson({impacts,reviews:pubReviews(report,publication.id),withdrawals:pubWithdrawals(report,publication.id)}),'');
  }
  if(report.comparison){
    const comparison=report.comparison;
    lines.push('### Publication edition comparison','',
      md(comparison.fromPublicationId)+' → '+md(comparison.toPublicationId),'',
      ...mdTable(['Added','Removed','Changed','Unchanged','Moved'],[[comparison.counts.added,
        comparison.counts.removed,comparison.counts.changed,comparison.counts.unchanged,comparison.counts.moved]]),'',
      ...mdTable(['Result','Change','Before edition','After edition','Record changes','Cell changes'],
        comparison.rows.map(row=>[row.resultId,row.kind,row.before?.result.editionId??'',
          row.after?.result.editionId??'',row.changes.length,row.cellChanges.length])),'',
      'Complete comparison, including both publication editions and every changed original value:','',
      ...mdJson(comparison),'');
  }
  lines.push('### Complete authored table-definition history','');
  for(const edition of report.tableEditions)lines.push(...mdDefinition(edition));
  lines.push('### Available original extraction editions and current review context','',
    ...mdJson({results:report.results,reviewContext:report.reviewContext}),'',
    '### Publication operation history','',...mdJson(report.operations),'',
    '### Operating method','',...mdJson(report.operatingMethod),'');
  return lines;
}
function hTable(headers,rows){
  return '<div class="ep-table"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+html(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+html(value)+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div>';
}
function hJson(label,value,open=false){
  return '<details'+(open?' open':'')+'><summary>'+html(label)+'</summary><pre>'+html(json(value))+'</pre></details>';
}
function hParagraph(value){return '<p>'+html(value).replace(/\r\n|\r|\n/g,'<br>')+'</p>';}
export function extractionPublicationHtmlFragment(report){
  const parts=['<section class="extraction-publication-report" aria-label="Extraction evidence publications">',
    '<h2>Extraction evidence tables and publications</h2>',hParagraph(report.dossier.title||report.dossier.id),
    hParagraph('Dossier '+report.dossier.id+' · revision '+report.dossier.revision+
      (report.asOf?' · '+report.asOf:'')),
    hTable(['Tables','Table editions','Publications','Published rows','Current results','Current impacts'],
      [[report.overview.tables,report.overview.tableEditions,report.overview.publications,report.overview.publishedRows,
        report.overview.currentResults,report.overview.impacts]]),
    hParagraph('Every publication retains its complete selected extraction records. Original statuses, source bases, '+
      'typed values, unresolved fields and operator notes remain visible. Corrections and withdrawals preserve earlier editions.')];
  if(!report.tables.length)parts.push(hParagraph('No evidence table has been authored.'));
  for(const table of report.tables){
    parts.push('<section><h3>'+html(table.definition.name)+'</h3>',hParagraph(table.definition.description),
      hParagraph('Table '+table.id+' · current definition '+table.editionId),hParagraph(table.definition.notes),'</section>');
  }
  for(const publication of report.publications){
    const current=status(report,publication.id),selected=position(report,publication.id);
    parts.push('<section id="'+html(publication.id)+'"><h3>Publication '+publication.edition+' · '+
      html(publication.title)+'</h3>','<p><strong>'+html(current.toUpperCase())+'</strong> · '+html(publication.id)+'</p>',
      hParagraph('Published by '+publication.actor.name+' ('+publication.actor.id+') at '+publication.createdAt+'.'),
      hParagraph('SHA-256: '+publication.sha256),hParagraph('Table edition: '+publication.tableEditionId),
      publication.previousPublicationId?hParagraph('Preceding publication: '+publication.previousPublicationId):'',
      selected?.supersededBy?hParagraph('Following publication: '+selected.supersededBy):'',
      hParagraph(publication.summary),'<h4>Publication / correction reason</h4>',hParagraph(publication.reason),
      '<h4>Limitations</h4>',hParagraph(publication.limitations),'<h4>Operator review</h4>',hParagraph(publication.review.note),
      hTable(['Result','Status',...publication.definition.columns.map(column=>column.label)],
        publication.rows.map(row=>[row.result.label,row.result.status,...publication.definition.columns.map(column=>
          extractionPublicationCellText(row.cells.find(cell=>cell.columnId===column.id),column))])));
    for(const withdrawal of pubWithdrawals(report,publication.id))parts.push('<h4>Withdrawal · '+html(withdrawal.createdAt)+
      '</h4>',hParagraph(withdrawal.reason),hParagraph(withdrawal.actor.name+' ('+withdrawal.actor.id+')'));
    const impacts=pubImpacts(report,publication.id);
    if(impacts.length)parts.push('<h4>Current source, form and result changes</h4>',
      hTable(['Kind','Impact','Current review','Reason'],impacts.map(impact=>[impact.kind,impact.id,
        impact.review?.disposition??'unreviewed',impact.review?.reason??''])));
    parts.push(hJson('Complete frozen publication, engine records and original review',publication),
      hJson('Current changes and complete impact-review / withdrawal history',{
        impacts,reviews:pubReviews(report,publication.id),withdrawals:pubWithdrawals(report,publication.id)}),'</section>');
  }
  if(report.comparison){
    const comparison=report.comparison;
    parts.push('<section><h3>Publication edition comparison</h3>',
      hParagraph(comparison.fromPublicationId+' → '+comparison.toPublicationId),
      hTable(['Added','Removed','Changed','Unchanged','Moved'],[[comparison.counts.added,comparison.counts.removed,
        comparison.counts.changed,comparison.counts.unchanged,comparison.counts.moved]]),
      hTable(['Result','Change','Before edition','After edition','Record changes','Cell changes'],
        comparison.rows.map(row=>[row.resultId,row.kind,row.before?.result.editionId??'',
          row.after?.result.editionId??'',row.changes.length,row.cellChanges.length])),
      hJson('Complete comparison and both original publication editions',comparison),'</section>');
  }
  parts.push('<section><h3>Complete authored table-definition history</h3>');
  for(const edition of report.tableEditions)parts.push('<h4>Edition '+edition.edition+' · '+
    html(edition.definition.name)+'</h4>',hParagraph(edition.reason),
    hTable(['Column','Label','Original record pointer','Format'],edition.definition.columns.map(column=>[
      column.id,column.label,column.pointer===''?'(complete record)':column.pointer,column.format])),
    hJson('Complete table definition '+edition.id,edition));
  parts.push('</section>',hJson('Available original extraction editions and current review context',{
    results:report.results,reviewContext:report.reviewContext}),
    hJson('Complete publication operation history',report.operations),
    hJson('Operating method',report.operatingMethod),'</section>');
  return parts.join('\n');
}
export function extractionPublicationHtml(report){
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>'+html(report.dossier.title||report.dossier.id)+' · Evidence publications</title>'+
    '<style>body{margin:0;background:#fff;color:#171717;font:15px/1.55 system-ui,sans-serif}main{max-width:88rem;margin:auto;padding:2rem}'+
    'h1,h2,h3,h4{line-height:1.25}h2,h3{margin-top:2rem}section{margin-bottom:2rem}p{max-width:90ch}'+
    '.ep-table{overflow:auto;margin:1rem 0}table{border-collapse:collapse;width:100%;font-size:14px}'+
    'th,td{text-align:left;vertical-align:top;border:1px solid #b8b8b8;padding:.55rem;overflow-wrap:anywhere}'+
    'th{background:#f2f2f2}details{border:1px solid #b8b8b8;padding:.7rem;margin:1rem 0}summary{cursor:pointer;font-weight:600}'+
    'pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:.8rem 0 0}'+
    'a{color:inherit}strong{font-weight:700}@media print{main{padding:0}details{break-inside:auto}summary{font-weight:700}'+
    '.ep-table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}}</style></head><body><main>'+
    extractionPublicationHtmlFragment(report)+'</main></body></html>\n';
}
