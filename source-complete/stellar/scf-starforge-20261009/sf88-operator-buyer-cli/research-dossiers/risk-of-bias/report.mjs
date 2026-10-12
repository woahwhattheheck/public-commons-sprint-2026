// MIT. Complete, source-bound appraisal reports from the original dossier.
import {need} from '../../node/store.mjs';
import {clone,riskOfBiasDigest,RISK_OF_BIAS_REPORT_SCHEMA,safeUrl} from './contracts.mjs';
import {selectRiskOfBias,riskOfBiasOverview} from './model.mjs';

const rows=value=>Array.isArray(value)?value:[];
const actor=value=>value?.name?value.name+' ('+value.id+')':value?.id??'';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const md=value=>String(value??'').replace(/[\\\x60*_{}\[\]<>#+!|]/g,'\\$&').replace(/\r?\n/g,' ');
const pretty=value=>JSON.stringify(value,null,2);
function fence(value){
  const body=typeof value==='string'?value:pretty(value);
  let length=3;for(const value of body.matchAll(/\x60+/g))length=Math.max(length,value[0].length+1);
  const ticks=String.fromCharCode(96).repeat(length);
  return [ticks+'json',body,ticks,''];
}
function mdTable(headers,values){
  return ['| '+headers.map(md).join(' | ')+' |','| '+headers.map(()=> '---').join(' | ')+' |',
    ...values.map(value=>'| '+value.map(md).join(' | ')+' |'),''];
}
function htmlTable(headers,values){
  return '<div class="risk-table"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+
    '</tr></thead><tbody>'+values.map(value=>'<tr>'+value.map(cell=>'<td>'+esc(cell)+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div>';
}
const detail=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
const paragraph=value=>'<p>'+esc(value)+'</p>';
function link(value){
  try{safeUrl(value);}catch{return esc(value);}
  return '<a href="'+esc(value)+'" rel="noreferrer noopener">'+esc(value)+'</a>';
}
const protocolFor=(report,assessment)=>report.protocols.find(value=>value.id===assessment.protocolId);
const labelFor=(protocol,id)=>protocol?.definition.form.judgments.find(value=>value.id===id)?.label??id;
const fieldFor=(protocol,id)=>protocol?.definition.form.domains.flatMap(value=>value.fields).find(value=>value.id===id);
const domainFor=(protocol,id)=>protocol?.definition.form.domains.find(value=>value.id===id);
const ownAssessment=(report,value)=>report.assessments.find(assessment=>assessment.editionId===value.assessmentEditionId);
const operationsFor=(report,reviewId)=>report.operations.filter(value=>value.reviewId===reviewId);
function sourceText(value){
  return [value.title,value.occurrenceId,'Edition '+value.editionId,'SHA-256 '+value.sourceSha256,
    'Content '+value.contentDigest].filter(Boolean).join(' · ');
}
function passageText(value){
  return [value.locator,value.fileName?'File '+value.fileName:'',value.jsonPointer?'Pointer '+value.jsonPointer:'',
    value.match?.mode??'locator-only',value.note].filter(Boolean).join(' · ');
}
function passagesMd(values){
  const output=[];
  for(const value of rows(values)){
    output.push('- '+md(sourceText(value.source??{occurrenceId:value.occurrenceId})), '  '+md(passageText(value)));
    if(value.quote)output.push('',...String(value.quote).split(/\r?\n/).map(line=>'> '+md(line)),'');
    if(value.source?.url)output.push('  Source URL: '+md(value.source.url));
    output.push('',...fence(value));
  }
  return output;
}
function passagesHtml(values){
  return rows(values).map(value=>'<section class="risk-passage">'+paragraph(sourceText(value.source??{occurrenceId:value.occurrenceId}))+
    paragraph(passageText(value))+(value.quote?'<blockquote>'+esc(value.quote)+'</blockquote>':'')+
    (value.source?.url?'<p>'+link(value.source.url)+'</p>':'')+detail('Exact retained passage binding',value)+'</section>').join('');
}
function contentMd(value,protocol){
  const output=[];
  for(const answer of rows(value.answers)){
    output.push('###### '+md(fieldFor(protocol,answer.fieldId)?.label??answer.fieldId),'',
      'Field '+md(answer.fieldId)+' · '+md(answer.status),'');
    if(answer.status==='answered')output.push(...fence(answer.value));
    if(answer.rationale)output.push(md(answer.rationale),'');
    output.push(...passagesMd(answer.basis));
  }
  for(const judgment of rows(value.judgments)){
    output.push('###### '+md(domainFor(protocol,judgment.domainId)?.title??judgment.domainId),'',
      'Judgment: '+md(labelFor(protocol,judgment.judgmentId))+' · Basis: '+md(judgment.basisStatus),'',
      md(judgment.rationale),'',...passagesMd(judgment.basis));
  }
  if(value.overall)output.push('###### Overall judgment','',
    md(labelFor(protocol,value.overall.judgmentId))+' · Basis: '+md(value.overall.basisStatus),'',
    md(value.overall.rationale),'',...passagesMd(value.overall.basis));
  else output.push('Overall judgment: no authored selection in this retained record.','');
  return output;
}
function contentHtml(value,protocol){
  let output='';
  for(const answer of rows(value.answers))output+='<section><h6>'+esc(fieldFor(protocol,answer.fieldId)?.label??answer.fieldId)+'</h6>'+
    paragraph('Field '+answer.fieldId+' · '+answer.status)+(answer.status==='answered'?'<pre>'+esc(pretty(answer.value))+'</pre>':'')+
    (answer.rationale?paragraph(answer.rationale):'')+passagesHtml(answer.basis)+'</section>';
  for(const judgment of rows(value.judgments))output+='<section><h6>'+esc(domainFor(protocol,judgment.domainId)?.title??judgment.domainId)+'</h6>'+
    paragraph('Judgment: '+labelFor(protocol,judgment.judgmentId)+' · Basis: '+judgment.basisStatus)+paragraph(judgment.rationale)+
    passagesHtml(judgment.basis)+'</section>';
  if(value.overall)output+='<section><h6>Overall judgment</h6>'+
    paragraph(labelFor(protocol,value.overall.judgmentId)+' · Basis: '+value.overall.basisStatus)+paragraph(value.overall.rationale)+
    passagesHtml(value.overall.basis)+'</section>';
  else output+=paragraph('Overall judgment: no authored selection in this retained record.');
  return output;
}
function contentHeader(value){
  return actor(value.actor)+' · '+value.createdAt+' · Original revision '+value.originalRevision+
    ' → '+value.revision+' · '+(value.current===false?'Retained earlier record':'Current record')+
    (value.supersedes?' · Corrects '+value.supersedes:'');
}
function overviewRows(report){
  const value=report.overview;
  return [
    ['Reviews',value.reviewCount],['Protocol editions',value.protocolEditionCount],
    ['Assessment families',value.assessmentCount],['Retained assessment editions',value.assessmentEditionCount],
    ['Current assessment editions',value.currentAssessmentCount],['Saved draft versions',value.draftCount],
    ['Submitted versions, including corrections',value.submissionCount],
    ['Current editions meeting their minimum reviewer count',value.completeAssessmentCount],
    ['Current editions awaiting reviewers',value.pendingAssessmentCount],
    ['Current editions with unresolved value disagreement',value.disagreementCount],
    ['Current adjudicated editions',value.adjudicatedAssessmentCount],
    ['Unresolved source, protocol or result impacts',value.unresolvedImpactCount],
    ['Distinct retained report occurrences',value.reportOccurrenceCount],['Original studies',value.studyCount],
    ['Original results',value.resultCount],
  ];
}
export function riskOfBiasReport(state,model,options={}){
  need(options.revision===undefined||options.revision===state.revision,'RISK_OF_BIAS_REPORT_REVISION_CHANGED');
  const selected=selectRiskOfBias(state,model,options),reviewIds=new Set(selected.reviews.map(value=>value.id));
  const assessmentIds=new Set(selected.assessments.map(value=>value.id));
  const impactReviews=model.impactReviews.filter(value=>reviewIds.has(value.reviewId)&&
    (!selected.assessmentId||!value.assessmentId||assessmentIds.has(value.assessmentId))&&
    (!options.assessmentEditionId||!value.assessmentEditionId||value.assessmentEditionId===options.assessmentEditionId));
  const report={schema:RISK_OF_BIAS_REPORT_SCHEMA,dossierId:state.id,title:state.title,revision:state.revision,
    createdAt:state.createdAt,updatedAt:state.updatedAt,
    selection:{reviewId:selected.reviewId,assessmentId:selected.assessmentId,
      assessmentEditionId:options.assessmentEditionId??null,actorId:selected.actorId},
    overview:riskOfBiasOverview(model,selected),
    reviews:selected.reviews,protocols:selected.protocols,assessments:selected.assessments,
    drafts:selected.drafts,submissions:selected.submissions,comparisons:selected.comparisons,
    adjudications:selected.adjudications,impact:selected.impact,impactReviews:clone(impactReviews),
    studies:selected.studies,results:selected.results,sources:selected.sources,operations:selected.operations,
    method:{
      identity:'Original dossier, question, study and result records; immutable report occurrence and source-edition bindings',
      reviewerIdentity:'Explicit named actors in the original authenticated Research workspace',
      judgment:'Researcher-authored judgments using the selected instrument and form editions; no calculated official instrument score',
      evidence:'Literal quotes or typed pointers bind to original retained report bytes; locator-only and unavailable information remain explicit',
      history:'Independent draft versions, immutable submissions, whole-set adjudication, corrections and impact dispositions remain in original dossier history',
      portability:'The original complete dossier export carries all revisions and source blobs; its receiving path validates each appended native appraisal operation',
      counts:'Each count retains its stated unit; report occurrences, studies, result records and appraisal editions have separate identities',
    }};
  return {...report,sha256:riskOfBiasDigest(report)};
}
export function riskOfBiasMarkdown(report){
  if(!report?.reviews?.length)return [];
  const output=['## Risk-of-bias appraisal','',
    'Dossier '+md(report.dossierId)+' · Revision '+report.revision+' · '+md(report.updatedAt),'',
    md(report.method.judgment),'',md(report.method.evidence),'',
    ...mdTable(['Unit','Count'],overviewRows(report))];
  for(const review of report.reviews){
    output.push('### '+md(review.name),'','Question: '+md(review.questionText??review.questionId),'',
      md(review.description),'','Review '+md(review.id)+' · Eligibility review '+md(review.eligibilityReviewId),'');
    for(const protocol of report.protocols.filter(value=>value.reviewId===review.id)){
      const definition=protocol.definition,instrument=definition.instrument,form=definition.form;
      output.push('#### Protocol edition '+protocol.edition+': '+md(definition.name),'',
        'Protocol '+md(protocol.id)+(protocol.current?' · Current':' · Retained earlier edition'),'',
        'Question at this edition: '+md(protocol.question.text),'',
        md(definition.description),'',
        'Instrument: '+md(instrument.title)+' · Version '+md(instrument.version)+' · '+md(instrument.origin),'',
        'Declared scope: '+md(instrument.scope)+' · Designs: '+instrument.applicableDesigns.map(md).join(', '),'',
        'Instrument rights: '+md(instrument.rights.basis)+' · '+md(instrument.rights.statement),'',
        ...instrument.sourceUrls.map(value=>'Source: '+md(value)),
        ...(instrument.rights.url?['Rights URL: '+md(instrument.rights.url)]:[]),'',
        'Form: '+md(form.title)+' · Version '+md(form.version)+' · '+md(form.origin),'',
        'Form rights: '+md(form.rights.basis)+' · '+md(form.rights.statement),'',
        ...form.sourceUrls.map(value=>'Source: '+md(value)),
        ...(form.rights.url?['Rights URL: '+md(form.rights.url)]:[]),'',
        ...mdTable(['Reviewer ID','Name','May adjudicate'],definition.reviewers.map(value=>
          [value.id,value.name,definition.resolverIds.includes(value.id)?'Yes':'No'])),
        'Minimum independent reviewers: '+definition.minimumReviewers+'. '+md(definition.disagreementProcedure),'',
        ...mdTable(['Judgment ID','Label','Meaning'],form.judgments.map(value=>[value.id,value.label,value.description])));
      for(const domain of form.domains)output.push('##### '+md(domain.title),'',md(domain.description),'',
        'Domain evidence required when supported: '+(domain.requiresEvidence?'Yes':'No')+'.','',
        ...mdTable(['Field','Type','Required','Evidence required','Instructions'],domain.fields.map(field=>
          [field.label+' ('+field.id+')',field.type,field.required?'Yes':'No',field.requiresEvidence?'Yes':'No',field.help])),
        ...fence(domain));
      output.push('Protocol definition and retained change history:','',...fence(protocol));
    }
    for(const assessment of report.assessments.filter(value=>value.reviewId===review.id)){
      const target=assessment.target,protocol=protocolFor(report,assessment);
      output.push('#### '+md(assessment.name)+' — assessment edition '+assessment.version,'',
        md(assessment.id)+' / '+md(assessment.editionId)+' · '+md(assessment.status)+
          (assessment.current?' · Current':' · Retained earlier edition'),'',
        'Selected protocol: '+md(assessment.protocolId)+' · SHA-256 '+md(assessment.protocolSha256),'',
        'Design: '+md(target.design)+' · Scope: '+md(target.scope),'',md(target.designRationale),'',
        ...mdTable(['Binding','ID','Version','SHA-256'],[
          ['Study',target.studyId,target.studyVersion,target.studySha256],
          ...(target.scope==='result'?[['Result',target.resultId,target.resultVersion,target.resultSha256]]:[])]),
        ...passagesMd(target.designBasis),
        'Original linked sources:','',...mdTable(['Report','Occurrence','Edition','Raw SHA-256'],
          target.sources.map(value=>[value.title,value.occurrenceId,value.editionId,value.sourceSha256])),
        'Complete immutable target and source records:','',...fence(target));
      for(const [kind,records] of [['Draft',report.drafts],['Submission',report.submissions],['Adjudication',report.adjudications]])
        for(const record of records.filter(value=>value.assessmentEditionId===assessment.editionId)){
          output.push('##### '+kind+' '+md(record.id),'',md(contentHeader(record)),'',md(record.reason??''),'',
            ...contentMd(record,protocol),'Complete retained '+kind.toLowerCase()+' record:','',...fence(record));
        }
      const comparison=report.comparisons.find(value=>value.assessmentEditionId===assessment.editionId);
      if(comparison){
        output.push('##### Reviewer comparison','',
          'Status: '+md(comparison.status)+' · SHA-256 '+md(comparison.sha256),'',
          'Value disagreement: '+(comparison.valueDisagreement?'Yes':'No')+
          ' · Rationale or source variation: '+(comparison.rationaleVariation?'Yes':'No')+
          ' · Current adjudication: '+(comparison.adjudicationCurrent?'Yes':'No'), '',
          ...mdTable(['Field or domain','Value disagreement','Rationale variation','Submitted reviewer values'],
            comparison.rows.map(row=>[row.label,row.valueDisagreement?'Yes':'No',row.rationaleVariation?'Yes':'No',
              row.values.map(value=>actor(value.actor)+': '+JSON.stringify(value.answer??value.judgment)).join('\n')])),
          ...fence(comparison));
      }
    }
    output.push('#### Source, result and protocol changes','');
    for(const impact of report.impact.filter(value=>value.reviewId===review.id))
      output.push('##### '+md(impact.title),'',md(impact.kind)+' · '+md(impact.status),'',
        'Impact '+md(impact.id)+' · Fingerprint '+md(impact.fingerprint),'',...fence(impact));
    for(const record of report.impactReviews.filter(value=>value.reviewId===review.id))
      output.push('##### Impact disposition '+md(record.id),'',md(record.disposition)+' · '+md(actor(record.actor)),'',
        md(record.reason),'',...fence(record));
    output.push('#### Original appraisal request history','',...fence(operationsFor(report,review.id)));
  }
  output.push('### Original study and result registry','',...fence({studies:report.studies,results:report.results}),
    '### Retained source register','',...fence(report.sources),
    'Report SHA-256: '+md(report.sha256),'');
  return output;
}
export function riskOfBiasHtml(report){
  if(!report?.reviews?.length)return '';
  let output='<section class="risk-of-bias-report"><h2>Risk-of-bias appraisal</h2>'+
    paragraph('Dossier '+report.dossierId+' · Revision '+report.revision+' · '+report.updatedAt)+
    paragraph(report.method.judgment)+paragraph(report.method.evidence)+htmlTable(['Unit','Count'],overviewRows(report));
  for(const review of report.reviews){
    output+='<section><h3>'+esc(review.name)+'</h3>'+paragraph('Question: '+(review.questionText??review.questionId))+
      paragraph(review.description)+paragraph('Review '+review.id+' · Eligibility review '+review.eligibilityReviewId);
    for(const protocol of report.protocols.filter(value=>value.reviewId===review.id)){
      const definition=protocol.definition,instrument=definition.instrument,form=definition.form;
      output+='<section><h4>Protocol edition '+protocol.edition+': '+esc(definition.name)+'</h4>'+
        paragraph(protocol.id+' · '+(protocol.current?'Current':'Retained earlier edition'))+
        paragraph('Question at this edition: '+protocol.question.text)+paragraph(definition.description)+
        paragraph('Instrument: '+instrument.title+' · Version '+instrument.version+' · '+instrument.origin)+
        paragraph('Declared scope: '+instrument.scope+' · Designs: '+instrument.applicableDesigns.join(', '))+
        paragraph('Instrument rights: '+instrument.rights.basis+' · '+instrument.rights.statement)+
        instrument.sourceUrls.map(value=>'<p>'+link(value)+'</p>').join('')+
        (instrument.rights.url?'<p>'+link(instrument.rights.url)+'</p>':'')+
        paragraph('Form: '+form.title+' · Version '+form.version+' · '+form.origin)+
        paragraph('Form rights: '+form.rights.basis+' · '+form.rights.statement)+
        form.sourceUrls.map(value=>'<p>'+link(value)+'</p>').join('')+
        (form.rights.url?'<p>'+link(form.rights.url)+'</p>':'')+
        htmlTable(['Reviewer ID','Name','May adjudicate'],definition.reviewers.map(value=>
          [value.id,value.name,definition.resolverIds.includes(value.id)?'Yes':'No']))+
        paragraph('Minimum independent reviewers: '+definition.minimumReviewers+'. '+definition.disagreementProcedure)+
        htmlTable(['Judgment ID','Label','Meaning'],form.judgments.map(value=>[value.id,value.label,value.description]));
      for(const domain of form.domains)output+='<section><h5>'+esc(domain.title)+'</h5>'+paragraph(domain.description)+
        paragraph('Domain evidence required when supported: '+(domain.requiresEvidence?'Yes':'No'))+
        htmlTable(['Field','Type','Required','Evidence required','Instructions'],domain.fields.map(field=>
          [field.label+' ('+field.id+')',field.type,field.required?'Yes':'No',field.requiresEvidence?'Yes':'No',field.help]))+
        detail('Exact domain and choice definitions',domain)+'</section>';
      output+=detail('Complete protocol and retained change record',protocol)+'</section>';
    }
    for(const assessment of report.assessments.filter(value=>value.reviewId===review.id)){
      const target=assessment.target,protocol=protocolFor(report,assessment);
      output+='<section><h4>'+esc(assessment.name)+' — assessment edition '+assessment.version+'</h4>'+
        paragraph(assessment.id+' / '+assessment.editionId+' · '+assessment.status+' · '+
          (assessment.current?'Current':'Retained earlier edition'))+
        paragraph('Selected protocol: '+assessment.protocolId+' · SHA-256 '+assessment.protocolSha256)+
        paragraph('Design: '+target.design+' · Scope: '+target.scope)+paragraph(target.designRationale)+
        htmlTable(['Binding','ID','Version','SHA-256'],[
          ['Study',target.studyId,target.studyVersion,target.studySha256],
          ...(target.scope==='result'?[['Result',target.resultId,target.resultVersion,target.resultSha256]]:[])])+
        passagesHtml(target.designBasis)+htmlTable(['Report','Occurrence','Edition','Raw SHA-256'],
          target.sources.map(value=>[value.title,value.occurrenceId,value.editionId,value.sourceSha256]))+
        detail('Complete immutable target and source records',target);
      for(const [kind,records] of [['Draft',report.drafts],['Submission',report.submissions],['Adjudication',report.adjudications]])
        for(const record of records.filter(value=>value.assessmentEditionId===assessment.editionId))
          output+='<section><h5>'+kind+' '+esc(record.id)+'</h5>'+paragraph(contentHeader(record))+
            paragraph(record.reason??'')+contentHtml(record,protocol)+detail('Complete retained '+kind.toLowerCase()+' record',record)+'</section>';
      const comparison=report.comparisons.find(value=>value.assessmentEditionId===assessment.editionId);
      if(comparison)output+='<section><h5>Reviewer comparison</h5>'+
        paragraph('Status: '+comparison.status+' · SHA-256 '+comparison.sha256)+
        paragraph('Value disagreement: '+(comparison.valueDisagreement?'Yes':'No')+
          ' · Rationale or source variation: '+(comparison.rationaleVariation?'Yes':'No')+
          ' · Current adjudication: '+(comparison.adjudicationCurrent?'Yes':'No'))+
        htmlTable(['Field or domain','Value disagreement','Rationale variation','Submitted reviewer values'],
          comparison.rows.map(row=>[row.label,row.valueDisagreement?'Yes':'No',row.rationaleVariation?'Yes':'No',
            row.values.map(value=>actor(value.actor)+': '+JSON.stringify(value.answer??value.judgment)).join('\n')]))+
        detail('Exact comparison and complete submission set',comparison)+'</section>';
      output+='</section>';
    }
    output+='<section><h4>Source, result and protocol changes</h4>';
    for(const impact of report.impact.filter(value=>value.reviewId===review.id))
      output+='<section><h5>'+esc(impact.title)+'</h5>'+paragraph(impact.kind+' · '+impact.status)+
        paragraph('Impact '+impact.id+' · Fingerprint '+impact.fingerprint)+detail('Exact previous and current basis',impact)+'</section>';
    for(const record of report.impactReviews.filter(value=>value.reviewId===review.id))
      output+='<section><h5>Impact disposition '+esc(record.id)+'</h5>'+
        paragraph(record.disposition+' · '+actor(record.actor))+paragraph(record.reason)+detail('Retained impact disposition',record)+'</section>';
    output+='</section>'+detail('Original appraisal request history',operationsFor(report,review.id))+'</section>';
  }
  return output+detail('Original study and result registry',{studies:report.studies,results:report.results})+
    detail('Retained source register',report.sources)+paragraph('Report SHA-256: '+report.sha256)+'</section>';
}
const csvCell=value=>{
  let output=value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);
  if(/^[\s]*[=+\-@]/u.test(output)||/^[\t\r\n]/u.test(output))output="'"+output;
  return '"'+output.replace(/"/g,'""')+'"';
};
export function riskOfBiasCsv(report){
  const headers=['record_kind','review_id','assessment_id','assessment_edition_id','protocol_id','record_id',
    'actor_id','actor_name','original_revision','revision','field_id','domain_id','status','judgment_id',
    'value_json','rationale','basis_json','supersedes','source_edition_ids','source_sha256','record_json'];
  const output=[];
  function add(kind,value,extra={}){
    const assessment=kind==='assessment'?value:ownAssessment(report,value),target=assessment?.target;
    const sources=target?.sources??value.sources??(value.source?[value.source]:value.sourceSha256?[value]:[]);
    output.push({record_kind:kind,review_id:value.reviewId??(kind==='review'?value.id:''),
      assessment_id:value.assessmentId??(kind==='assessment'?value.id:''),
      assessment_edition_id:value.assessmentEditionId??(kind==='assessment'?value.editionId:''),
      protocol_id:value.protocolId??assessment?.protocolId??(kind==='protocol'?value.id:''),
      record_id:value.id??value.resultId??value.studyId??value.occurrenceId??'',
      actor_id:value.actor?.id??'',actor_name:value.actor?.name??'',original_revision:value.originalRevision??'',
      revision:value.revision??report.revision,field_id:value.fieldId??'',domain_id:value.domainId??'',
      status:value.status??value.disposition??'',judgment_id:value.judgmentId??'',value_json:value.value??'',
      rationale:value.rationale??value.reason??'',basis_json:value.basis??'',supersedes:value.supersedes??'',
      source_edition_ids:sources.map(source=>source.editionId),source_sha256:sources.map(source=>source.sourceSha256),
      record_json:value,...extra});
  }
  for(const [kind,values] of [['review',report.reviews],['protocol',report.protocols],['assessment',report.assessments],
    ['study',report.studies],['result',report.results],['source',report.sources],['impact',report.impact],
    ['impact-review',report.impactReviews],['operation',report.operations]])for(const value of values)add(kind,value);
  for(const [kind,values] of [['draft',report.drafts],['submission',report.submissions],['adjudication',report.adjudications]])
    for(const value of values){
      add(kind,value);
      for(const answer of value.answers)add(kind+'-answer',value,{field_id:answer.fieldId,status:answer.status,
        value_json:answer.value,rationale:answer.rationale,basis_json:answer.basis,record_json:answer});
      for(const judgment of value.judgments)add(kind+'-domain',value,{domain_id:judgment.domainId,status:judgment.basisStatus,
        judgment_id:judgment.judgmentId,rationale:judgment.rationale,basis_json:judgment.basis,record_json:judgment});
      if(value.overall)add(kind+'-overall',value,{status:value.overall.basisStatus,judgment_id:value.overall.judgmentId,
        rationale:value.overall.rationale,basis_json:value.overall.basis,record_json:value.overall});
    }
  for(const value of report.comparisons){
    add('comparison',value,{record_id:value.sha256});
    for(const row of value.rows)add('comparison-row',value,{record_id:row.key,field_id:row.fieldId??'',domain_id:row.domainId??'',
      value_json:row.values,status:row.valueDisagreement?'value_disagreement':row.rationaleVariation?'rationale_variation':'same',
      record_json:row});
  }
  if(!output.length)add('overview',{id:report.dossierId},{revision:report.revision,record_json:report.overview});
  return [headers.map(csvCell).join(','),...output.map(value=>headers.map(header=>csvCell(value[header])).join(','))].join('\r\n')+'\r\n';
}
export function riskOfBiasExport(state,model,options={}){
  const format=options.format??'json';
  need(['json','csv','md','html'].includes(format),'RISK_OF_BIAS_EXPORT_FORMAT_INVALID');
  const report=riskOfBiasReport(state,model,options),suffix=riskOfBiasDigest(report.selection).slice(0,16);
  const base=String(state.id).slice(0,100)+'-r'+state.revision+'-risk-of-bias-'+suffix;
  if(format==='json')return {filename:base+'.json',revision:state.revision,contentType:'application/json; charset=utf-8',
    body:pretty(report)+'\n'};
  if(format==='csv')return {filename:base+'.csv',revision:state.revision,contentType:'text/csv; charset=utf-8',
    body:riskOfBiasCsv(report)};
  const empty=report.reviews.length===0;
  if(format==='md')return {filename:base+'.md',revision:state.revision,contentType:'text/markdown; charset=utf-8',
    body:(empty?['# Risk-of-bias appraisal','','Dossier '+md(state.id)+' · Revision '+state.revision,'',
      'This selected revision contains no appraisal review.','']:riskOfBiasMarkdown(report)).join('\n')+'\n'};
  const css='body{font:15px system-ui,sans-serif;color:#171717;background:#fff;max-width:1200px;margin:32px auto;padding:0 20px;line-height:1.5}'+
    'section{margin:24px 0}h2,h3,h4,h5,h6{line-height:1.25}h5,h6{font-size:1em}table{border-collapse:collapse;width:100%;font-size:13px}'+
    'th,td{border:1px solid #c8c8c8;padding:8px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}'+
    'th{background:#f2f2f2}.risk-table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px}'+
    'blockquote{white-space:pre-wrap;margin:16px 0;padding:8px 16px;border-left:3px solid #888}details{margin:16px 0}summary{cursor:pointer}'+
    'a{color:inherit}p{overflow-wrap:anywhere}@media print{body{max-width:none;margin:0}details{break-inside:avoid}summary{font-weight:600}}';
  const body='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">'+
    '<title>'+esc(state.title)+' — Risk-of-bias appraisal</title><style>'+css+'</style></head><body>'+
    (empty?'<h1>Risk-of-bias appraisal</h1>'+paragraph('Dossier '+state.id+' · Revision '+state.revision)+
      paragraph('This selected revision contains no appraisal review.'):riskOfBiasHtml(report))+'</body></html>\n';
  return {filename:base+'.html',revision:state.revision,contentType:'text/html; charset=utf-8',body};
}
