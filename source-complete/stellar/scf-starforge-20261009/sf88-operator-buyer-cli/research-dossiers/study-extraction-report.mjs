// MIT. Readable complete extraction editions in the original Research reports.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const md=value=>String(value??'').replace(/[\\`*_{}\[\]<>#+!|]/g,'\\$&').replace(/\r?\n/g,' ');
const json=value=>JSON.stringify(value,null,2);
const list=value=>Array.isArray(value)?value:[];
const link=source=>{
  let target;try{const url=new URL(source.url);if(['https:','http:'].includes(url.protocol))target=url.href;}catch{}
  return target?'<a href="'+esc(target)+'" rel="noreferrer">'+esc(source.title||source.occurrenceId)+'</a>':
    esc(source.title||source.occurrenceId);
};
export function extractionValueText(value){
  if(!Array.isArray(value)||value.length!==2)return '';
  const [kind,body]=value;
  if(kind==='NoneType')return 'null';
  if(kind==='bool')return body?'true':'false';
  if(kind==='number'||kind==='str')return body;
  if(kind==='array')return '['+body.map(extractionValueText).join(', ')+']';
  if(kind==='object')return '{'+body.map(([key,item])=>key+': '+extractionValueText(item)).join(', ')+'}';
  return json(value);
}
const sourceLocation=value=>value.kind==='json-pointer'?(value.file?.name?value.file.name+': ':'')+(value.pointer===''?'(whole document)':value.pointer):
  value.locator??value.editionLabel??value.occurrenceId;
const valueRows=result=>{
  const fields=result.record.form.definition.fields;
  return fields.map(field=>{
    const answer=result.record.values?.[field.id];
    return {field,answer};
  });
};
function mdTable(headers,rows){
  return ['| '+headers.map(md).join(' | ')+' |','| '+headers.map(()=> '---').join(' | ')+' |',
    ...rows.map(row=>'| '+row.map(md).join(' | ')+' |'),''];
}
function htmlTable(headers,rows){
  return '<div class="extraction-table"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function fenced(value){
  const content=json(value),runs=content.match(/`+/g)??[];
  const marker='`'.repeat(Math.max(3,...runs.map(value=>value.length+1)));
  return [marker+'json',content,marker,''];
}
export function extractionMarkdown(report){
  if(!report?.forms?.length)return [];
  const lines=['## Study extraction','',
    'Result editions retain the form, explicit study/report link, independent submissions and recorded resolution used at that revision.','',
    ...mdTable(['Unit','Count'],[
      ['Forms',report.overview.formCount],['Result sets',report.overview.resultSetCount],
      ['Current result rows',report.overview.resultCount],['Historical result editions',report.overview.resultEditionCount],
      ['Explicit study groups',report.overview.studyCount],['Retained report occurrences',report.overview.retainedOccurrenceCount],
      ['Submitted extractions',report.overview.submissionCount],['Recorded resolutions',report.overview.resolutionCount]])];
  for(const form of report.formEditions){
    lines.push('### Form '+md(form.name)+' — edition '+form.version,'',
      'Question: '+md(form.question.text),'',md(form.description),'',
      'Recorded by '+md(form.actor.name)+' on '+md(form.createdAt)+'. '+md(form.reason),'',
      ...mdTable(['Field','Type','Required','Unit','Instructions'],form.definition.fields.map(value=>[
        value.label,value.valueType,value.required?'Yes':'No',value.unit,value.instructions])),
      'Extractors: '+form.definition.extractorIds.map(md).join(', ')+'. Required distinct submissions: '+form.definition.minimumExtractions+'.','',
      'Resolvers: '+form.definition.resolverIds.map(md).join(', ')+'. '+md(form.definition.disagreementProcedure),'');
  }
  const current=report.results.filter(value=>value.current);
  lines.push('### Current result rows','',...mdTable(['Study','Result','State','Result edition'],current.map(value=>[
    value.record.study.name,value.label,value.status,value.editionId])));
  for(const result of report.results){
    lines.push('### '+md(result.label)+' — '+(result.current?'current':'historical')+' edition','',
      'Study: '+md(result.record.study.name)+'; linked study version '+result.record.study.version+'.','',
      'Result: '+md(result.resultId)+'. Edition: '+md(result.editionId)+'. Status: '+md(result.status)+'.','',
      ...mdTable(['Field','Value state','Value','Unit','Context'],valueRows(result).map(({field,answer})=>[
        field.label,answer?.status??'Unresolved',answer?extractionValueText(answer.value):'',
        field.unit??'',answer?json(answer.context):''])));
    if(result.record.resolution){
      const value=result.record.resolution;
      lines.push('Resolution: '+md(value.mode)+' by '+md(value.actor.name)+' on '+md(value.createdAt)+'. '+md(value.reason),'');
    }
    lines.push('#### Independent submissions','',
      ...mdTable(['Reviewer','Field','Value state','Entered value','Source differences'],
        result.record.submissions.flatMap(submission=>Object.values(submission.values).map(answer=>[
          submission.actor.name,answer.fieldId,answer.status,extractionValueText(answer.value),json(answer.sourceDifferences)]))));
    lines.push('#### Retained source locations','',
      ...mdTable(['Source','Occurrence','Location','Source hash'],result.sourceBindings.map(value=>[
        value.title,value.occurrenceId,sourceLocation(value),value.sourceSha256])));
    lines.push('#### Complete result, context and review history','',...fenced(result.record));
  }
  if(report.impact?.length)lines.push('### Source, form and study changes','',
    ...mdTable(['Result set','Change','Review','Reason'],report.impact.map(value=>[
      value.resultSetId,value.kind,value.review?.disposition??'Awaiting review',value.review?.reason??''])),
    ...fenced(report.impact));
  lines.push('### Drafts and original operation history','',
    'Draft versions, correction reasons and immutable original requests accompany this report.','',
    ...fenced({extractions:report.extractions,submissions:report.submissions,resolutions:report.resolutions,operations:report.operations}));
  return lines;
}
export function extractionHtml(report){
  if(!report?.forms?.length)return '';
  let html='<section class="study-extraction"><h2>Study extraction</h2><p>Result editions retain the form, explicit study/report link, independent submissions and recorded resolution used at that revision.</p>'+
    htmlTable(['Unit','Count'],[['Forms',report.overview.formCount],['Result sets',report.overview.resultSetCount],
      ['Current results',report.overview.resultCount],['Historical editions',report.overview.resultEditionCount],
      ['Study groups',report.overview.studyCount],['Report occurrences',report.overview.retainedOccurrenceCount],
      ['Submissions',report.overview.submissionCount],['Resolutions',report.overview.resolutionCount]]);
  for(const form of report.formEditions)html+='<section><h3>Form '+esc(form.name)+' — edition '+form.version+'</h3>'+
    '<p>Question: '+esc(form.question.text)+'</p><p>'+esc(form.description)+'</p><p>'+esc(form.reason)+'</p>'+
    htmlTable(['Field','Type','Required','Unit','Instructions'],form.definition.fields.map(value=>[
      value.label,value.valueType,value.required?'Yes':'No',value.unit,value.instructions]))+
    '<p>Required distinct submissions: '+form.definition.minimumExtractions+'. '+esc(form.definition.disagreementProcedure)+'</p>'+
    '<details><summary>Saved form and reviewer configuration</summary><pre>'+esc(json(form))+'</pre></details></section>';
  html+='<h3>Current result rows</h3>'+htmlTable(['Study','Result','State','Result edition'],
    report.results.filter(value=>value.current).map(value=>[value.record.study.name,value.label,value.status,value.editionId]));
  for(const result of report.results){
    html+='<section id="'+esc(result.editionId)+'"><h3>'+esc(result.label)+' — '+(result.current?'current':'historical')+
      ' edition</h3><p>'+esc(result.record.study.name)+' · study version '+result.record.study.version+' · '+esc(result.status)+'</p>'+
      '<p>Result '+esc(result.resultId)+' · edition '+esc(result.editionId)+'</p>'+
      htmlTable(['Field','Value state','Value','Unit','Context'],valueRows(result).map(({field,answer})=>[
        field.label,answer?.status??'Unresolved',answer?extractionValueText(answer.value):'',field.unit??'',answer?json(answer.context):'']));
    if(result.record.resolution){const value=result.record.resolution;html+='<p>Resolution: '+esc(value.mode)+' by '+esc(value.actor.name)+
      ' on '+esc(value.createdAt)+'. '+esc(value.reason)+'</p>';}
    html+='<h4>Independent submissions</h4>'+htmlTable(['Reviewer','Field','Value state','Entered value','Source differences'],
      result.record.submissions.flatMap(submission=>Object.values(submission.values).map(answer=>[
        submission.actor.name,answer.fieldId,answer.status,extractionValueText(answer.value),json(answer.sourceDifferences)])))+
      '<h4>Retained source locations</h4><ul>'+result.sourceBindings.map(value=>'<li>'+link(value)+' — '+esc(sourceLocation(value))+
        '<br>Occurrence '+esc(value.occurrenceId)+'; source '+esc(value.sourceSha256)+'</li>').join('')+'</ul>'+
      '<details><summary>Complete result, context and review history</summary><pre>'+esc(json(result.record))+'</pre></details></section>';
  }
  if(report.impact?.length)html+='<h3>Source, form and study changes</h3>'+htmlTable(['Result set','Change','Review','Reason'],
    report.impact.map(value=>[value.resultSetId,value.kind,value.review?.disposition??'Awaiting review',value.review?.reason??'']))+
    '<details><summary>Complete change observations</summary><pre>'+esc(json(report.impact))+'</pre></details>';
  return html+'<details><summary>All draft versions and original operations</summary><pre>'+
    esc(json({extractions:report.extractions,submissions:report.submissions,resolutions:report.resolutions,operations:report.operations}))+
    '</pre></details></section>';
}
