// Reusable, explicitly reviewed classifications in the original Statement working copy.
import {prepareStatementBatch,applyStatementBatch} from './operations_statement_batch.mjs';
const clone=value=>structuredClone(value);
const need=(value,message)=>{if(!value)throw new Error(message);};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const text=(value,label,max,required=true)=>{need(typeof value==='string'&&value.length<=max&&!value.includes('\0')&&(!required||value.trim()),label+' needs '+(required?'1 to ':'at most ')+max+' characters.');return value.trim();};
const exact=(value,keys,label)=>{need(object(value)&&Object.keys(value).every(key=>keys.includes(key)),label+' contains an unsupported field.');};
const identity=/^statement-rule(?:book)?-[a-zA-Z0-9-]{8,100}$/;
const schema='sf47.statement-rulebooks.v1';
const categories=['OTHER','GRANT','INVOICE','CUSTOMER','CAPITAL','REFUND'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function decimal(value){
  need(typeof value==='string'&&/^(?:0|[1-9]\d{0,29})(?:\.\d{1,12})?$/.test(value),'Use nonnegative amount text, up to 30 integer and 12 fractional digits, with a period and no grouping.');
  const [whole,fraction='']=value.split('.');return {units:BigInt(whole+fraction),scale:fraction.length};
}
function compareAmount(a,b){const x=decimal(a),y=decimal(b),s=Math.max(x.scale,y.scale);const p=x.units*10n**BigInt(s-x.scale),q=y.units*10n**BigInt(s-y.scale);return p<q?-1:p>q?1:0;}
export function statementRuleEditor(){
  return {id:'',expectedRevision:0,name:'',accountId:'',currency:'USD',note:'',rules:[],
    rule:{id:'',name:'',direction:'IN',reference:'',referenceMode:'EXACT',description:'',descriptionMode:'CONTAINS',caseSensitive:true,minimum:'',maximum:'',mode:'CLASSIFY',category:'OTHER',tranche:'KEEP',reason:''}};
}
export function validateStatementRule(value){
  exact(value,['id','name','direction','reference','referenceMode','description','descriptionMode','caseSensitive','minimum','maximum','mode','category','tranche','reason'],'Classification rule');
  need(identity.test(value.id||'')&&value.id.startsWith('statement-rule-'),'Use the original rule identity.');
  const rule={id:value.id,name:text(value.name,'Rule name',120),direction:value.direction};
  need(['IN','OUT'].includes(rule.direction),'Choose the original inflow or outflow direction.');
  for(const field of ['reference','description']){
    text(value[field],field+' condition',300,false);rule[field]=value[field];
    rule[field+'Mode']=value[field+'Mode'];need(['EXACT','PREFIX','CONTAINS'].includes(rule[field+'Mode']),'Choose exact, starts with or contains for each text condition.');
  }
  need(typeof value.caseSensitive==='boolean','Choose whether text matching is case sensitive.');rule.caseSensitive=value.caseSensitive;
  for(const field of ['minimum','maximum']){rule[field]=text(value[field],field+' amount',43,false);if(rule[field])decimal(rule[field]);}
  need(rule.reference||rule.description||rule.minimum||rule.maximum,'Add a reference, description or amount condition.');
  if(rule.minimum&&rule.maximum)need(compareAmount(rule.minimum,rule.maximum)<=0,'The minimum amount cannot exceed the maximum.');
  rule.mode=value.mode;need(['CLASSIFY','EXCLUDE'].includes(rule.mode),'Choose classification or explicit exclusion.');
  rule.category=value.category;need(categories.includes(rule.category),'Choose an existing cash category.');
  rule.tranche=String(value.tranche);need(['KEEP','CLEAR','0','1','2','3'].includes(rule.tranche),'Keep, clear or choose original tranche 0 through 3.');
  if(rule.mode==='CLASSIFY'&&!['KEEP','CLEAR'].includes(rule.tranche))need(rule.category==='GRANT'&&rule.direction==='IN','A grant tranche requires a grant inflow.');
  rule.reason=text(value.reason,'Rule review reason',800);
  return rule;
}
function editionValue(value,caseId){
  exact(value,['id','revision','caseId','name','accountId','currency','actor','savedAt','note','rules','basis'],'Rulebook edition');
  need(value.caseId===caseId&&identity.test(value.id||'')&&value.id.startsWith('statement-rulebook-')&&Number.isSafeInteger(value.revision)&&value.revision>0,'Keep the original case, rulebook identity and edition.');
  text(value.name,'Rulebook name',160);text(value.accountId,'Account identity',300);
  need(/^[A-Z]{3}$/.test(value.currency),'Choose the exact three-letter statement currency.');
  text(value.actor,'Recording operator',300);text(value.note,'Edition reason',2000);
  need(typeof value.savedAt==='string'&&Number.isFinite(Date.parse(value.savedAt)),'Retain the original save time.');
  need(Array.isArray(value.rules)&&value.rules.length<=100,'A rulebook supports up to 100 complete rules.');
  const ids=new Set();for(const rule of value.rules){need(!ids.has(rule.id)&&same(validateStatementRule(rule),rule),'Keep each complete normalized rule once.');ids.add(rule.id);}
  exact(value.basis,['filename','sourceSha256','previewSha256','caseVersion'],'Original rulebook source');
  text(value.basis.filename,'Original statement filename',240);
  for(const key of ['sourceSha256','previewSha256'])need(typeof value.basis[key]==='string'&&/^[a-f0-9]{64}$/.test(value.basis[key]),'Retain the original native source and preview digest.');
  need(Number.isSafeInteger(value.basis.caseVersion)&&value.basis.caseVersion>=1,'Retain the original native case version.');
  return clone(value);
}
export function statementRuleLibrary(value,caseId){
  const input=value??{schema,caseId,revision:0,editions:[]};
  exact(input,['schema','caseId','revision','editions'],'Classification rule library');
  need(input.schema===schema&&input.caseId===caseId&&Number.isSafeInteger(input.revision)&&input.revision>=0&&Array.isArray(input.editions)&&input.editions.length<=1000,'Use the complete rule library for this original case, up to 1,000 editions.');
  const last=new Map(),editions=[];
  for(const raw of input.editions){
    const item=editionValue(raw,caseId),prior=last.get(item.id)||0;
    need(item.revision===prior+1,'Keep every ordered original rulebook edition.');last.set(item.id,item.revision);editions.push(item);
  }
  return {...input,editions};
}
export function mergeStatementRuleLibraries(current,received,caseId){
  const next=statementRuleLibrary(current,caseId),incoming=statementRuleLibrary(received,caseId);
  const values=new Map(next.editions.map(value=>[value.id+':'+value.revision,value]));
  for(const item of incoming.editions){
    const key=item.id+':'+item.revision,prior=values.get(key);
    need(!prior||same(prior,item),'The same rulebook edition has different content. Keep both original archives and resolve their source before reusing rules.');
    if(!prior){next.editions.push(clone(item));values.set(key,item);}
  }
  if(next.editions.length!==current.editions.length)next.revision++;
  return statementRuleLibrary(next,caseId);
}
function ready(draft,caseVersion){
  need(draft&&draft.inputs?.source?.contentBase64&&!draft.dirty&&!draft.pending&&!draft.accepted&&!draft.setupPending,'Preview this original statement and finish its retained request first.');
  need(draft.preview?.schema==='stellar-forge.sf47-statements.v1'&&draft.preview.caseId===draft.caseId&&draft.preview.expectedVersion===caseVersion&&Array.isArray(draft.preview.rows),'Preview this exact current case version.');
}
export function saveStatementRulebook(library,draft,editor,{id,actor,savedAt,caseVersion}){
  ready(draft,caseVersion);const next=statementRuleLibrary(library,draft.caseId);
  const bookId=editor.id||id,prior=next.editions.filter(value=>value.id===bookId).at(-1);
  need((prior?.revision||0)===editor.expectedRevision&&(!editor.id||prior),'The saved rulebook advanced. Open its latest edition before saving the next.');
  need(editor.accountId===draft.inputs.accountId&&editor.currency===draft.inputs.currency,'Use this preview’s exact account and currency; change the source mapping and preview before creating rules for another account.');
  const basis={filename:draft.inputs.source.filename,sourceSha256:draft.preview.source.sha256,previewSha256:draft.preview.previewSha256,caseVersion};
  const edition=editionValue({id:bookId,revision:(prior?.revision||0)+1,caseId:draft.caseId,
    name:text(editor.name,'Rulebook name',160),accountId:text(editor.accountId,'Account identity',300),currency:editor.currency,
    actor:text(actor,'Recording operator',300),savedAt,note:text(editor.note,'Edition reason',2000),rules:editor.rules.map(validateStatementRule),basis},draft.caseId);
  next.editions.push(edition);next.revision++;return {library:statementRuleLibrary(next,draft.caseId),edition};
}
export function editStatementRulebook(edition){
  const result=statementRuleEditor();return {...result,id:edition.id,expectedRevision:edition.revision,name:edition.name,accountId:edition.accountId,currency:edition.currency,rules:clone(edition.rules)};
}
function matches(rule,row){
  if(rule.direction!==row.direction)return false;
  for(const field of ['reference','description'])if(rule[field]){
    let actual=String(row[field]??''),expected=rule[field];
    if(!rule.caseSensitive){actual=actual.toLowerCase();expected=expected.toLowerCase();}
    const mode=rule[field+'Mode'];
    if(!(mode==='EXACT'?actual===expected:mode==='PREFIX'?actual.startsWith(expected):actual.includes(expected)))return false;
  }
  try{
    decimal(row.amount);
    if(rule.minimum&&compareAmount(row.amount,rule.minimum)<0||rule.maximum&&compareAmount(row.amount,rule.maximum)>0)return false;
  }catch{return false;}
  return true;
}
export function statementRuleReason(edition,rule){
  const condition={accountId:edition.accountId,currency:edition.currency,direction:rule.direction,
    reference:rule.reference,referenceMode:rule.referenceMode,description:rule.description,descriptionMode:rule.descriptionMode,
    caseSensitive:rule.caseSensitive,minimum:rule.minimum,maximum:rule.maximum};
  return 'Rulebook '+edition.name+' ['+edition.id+'] edition '+edition.revision+' · '+rule.name+' ['+rule.id+']\nConditions: '+JSON.stringify(condition)+'\n'+rule.reason;
}
export function statementRuleBasis(draft,caseVersion){
  return {caseId:draft.caseId,caseVersion,inputs:clone(draft.inputs),preview:clone(draft.preview),dirty:draft.dirty,
    pending:clone(draft.pending||null),accepted:clone(draft.accepted||null),setupPending:clone(draft.setupPending||null),allocationWorks:clone(draft.allocationWorks||{})};
}
export function prepareStatementRuleReview(draft,edition,caseVersion){
  ready(draft,caseVersion);editionValue(edition,draft.caseId);
  need(edition.accountId===draft.inputs.accountId&&edition.currency===draft.inputs.currency,'This rulebook belongs to a different account or currency. Select a matching edition.');
  const seen=new Set(),rows=[];
  for(const row of draft.preview.rows){
    need(Number.isSafeInteger(row.rowNumber)&&!seen.has(row.rowNumber),'Keep distinct original preview row numbers.');seen.add(row.rowNumber);
    const explicit=(draft.inputs.decisions||[]).some(value=>value.rowNumber===row.rowNumber);
    const allocated=!!draft.allocationWorks?.[String(row.rowNumber)]||(row.allocations||[]).length>0;
    const protectedReason=row.status!=='NEW'?'Only new source rows are eligible.':explicit?'An explicit current row decision is retained.':allocated?'Existing invoice allocation work is retained.':row.currency!==edition.currency?'This row has a different currency.':'';
    const candidates=protectedReason?[]:edition.rules.filter(rule=>matches(rule,row)).map(rule=>{
      const proposal=prepareStatementBatch(draft.preview,draft.inputs,[row.rowNumber],{mode:rule.mode,category:rule.category,tranche:rule.tranche,reason:statementRuleReason(edition,rule)});
      return {ruleId:rule.id,name:rule.name,options:proposal.options,problems:proposal.problems,canApply:proposal.canApply,change:proposal.changes[0]||null};
    });
    rows.push({rowNumber:row.rowNumber,reference:row.reference,description:row.description,date:row.date,
      currency:row.currency,direction:row.direction,amount:row.amount,protectedReason,candidates});
  }
  return {schema:'sf47.statement-rule-review.v1',edition:clone(edition),basis:statementRuleBasis(draft,caseVersion),rows,choices:{}};
}
export function statementRuleReviewCurrent(review,draft,caseVersion){
  return !!review&&same(review.basis,statementRuleBasis(draft,caseVersion));
}
export function chooseStatementRule(review,rowNumber,choice){
  need(review?.schema==='sf47.statement-rule-review.v1','Review this statement against a saved rulebook first.');
  const row=review.rows.find(value=>value.rowNumber===rowNumber);need(row&&!row.protectedReason,'Choose an eligible original row.');
  need(choice===''||choice==='SKIP'||row.candidates.some(value=>value.ruleId===choice&&value.canApply),'Choose one applicable matching rule or keep the row unchanged.');
  const result=clone(review);if(choice)result.choices[String(rowNumber)]=choice;else delete result.choices[String(rowNumber)];return result;
}
export function chooseUnambiguousStatementRules(review){
  const result=clone(review);
  for(const row of result.rows)if(!Object.hasOwn(result.choices,String(row.rowNumber))&&row.candidates.length===1&&row.candidates[0].canApply)
    result.choices[String(row.rowNumber)]=row.candidates[0].ruleId;
  return result;
}
export function applyStatementRuleReview(draft,edition,review,caseVersion){
  need(statementRuleReviewCurrent(review,draft,caseVersion)&&same(edition,review.edition),'The source, rule edition, case or decisions changed. Prepare a new rule review.');
  const recomputed=prepareStatementRuleReview(draft,edition,caseVersion);
  need(same(recomputed.rows,review.rows),'The matched rule results changed. Prepare this review again.');
  const decisions=clone(draft.inputs.decisions||[]),applied=[];
  for(const [number,choice] of Object.entries(review.choices||{})){
    const row=recomputed.rows.find(value=>String(value.rowNumber)===number);
    need(row&&!row.protectedReason,'A selected rule row is no longer eligible.');if(choice==='SKIP')continue;
    const candidate=row.candidates.find(value=>value.ruleId===choice);need(candidate?.canApply,'Choose one applicable current rule per selected row.');
    const proposal=prepareStatementBatch(draft.preview,draft.inputs,[row.rowNumber],candidate.options);
    const changed=applyStatementBatch(draft.preview,draft.inputs,proposal).decisions.find(value=>value.rowNumber===row.rowNumber);
    need(changed&&!decisions.some(value=>value.rowNumber===row.rowNumber),'Keep the original explicit row decision.');
    decisions.push(changed);applied.push({rowNumber:row.rowNumber,ruleId:choice,before:clone(proposal.changes[0].before),after:clone(changed)});
  }
  need(applied.length,'Select at least one matching rule to apply. Unselected and skipped rows remain unchanged.');
  return {decisions,application:{edition:clone(edition),source:clone(draft.preview.source),previewSha256:draft.preview.previewSha256,caseVersion,applied}};
}
const disabled=value=>value?' disabled data-statement-fixed="true"':'';
const button=(label,action,off=false,attrs='',recovery=false)=>'<button type="button" data-statement-action="rules-'+action+'"'+disabled(off)+' '+attrs+(recovery?' data-statement-recovery="true"':' data-statement-write="true"')+'>'+esc(label)+'</button>';
const input=(label,name,value,extra='')=>'<label>'+esc(label)+'<input name="rule.'+name+'" value="'+esc(value)+'" '+extra+'></label>';
const select=(label,name,value,items,extra='')=>'<label>'+esc(label)+'<select name="rule.'+name+'" '+extra+'>'+items.map(([id,title])=>'<option value="'+esc(id)+'"'+(String(value)===String(id)?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';
const describe=rule=>[rule.direction,...['reference','description'].filter(key=>rule[key]).map(key=>key+' '+rule[key+'Mode'].toLowerCase()+' “'+rule[key]+'”'),rule.minimum?'minimum '+rule.minimum:'',rule.maximum?'maximum '+rule.maximum:'',rule.caseSensitive?'case sensitive':'case insensitive'].filter(Boolean).join(' · ');
export function statementRulesPanel({library,editor,selected,review,draft,caseVersion,query='',appliedQuery='',filter='ALL',page=0,rulePage=0,open=true}){
  const edition=library.editions.find(value=>value.id+':'+value.revision===selected),live=statementRuleReviewCurrent(review,draft,caseVersion);
  const selectedReview=!!edition&&!!review&&same(edition,review.edition);
  const canEdit=open&&!draft.pending&&!draft.accepted&&!draft.setupPending,canReview=canEdit&&!draft.dirty&&!!draft.preview;
  const e=editor,r=e.rule,options=library.editions.slice().reverse().map(value=>[''+value.id+':'+value.revision,value.name+' · '+value.accountId+' · '+value.currency+' · edition '+value.revision]);
  let html='<section class="statement-panel statement-rules" aria-label="Recurring statement rules"><h4>Recurring statement classifications</h4><p>Keep exact account rules for later periods. Review every matched recommendation before it changes this draft; native preview remains the final receiving step.</p>'+
    '<div class="statement-fields">'+select('Saved rulebook edition','selected',selected,[['','Choose a saved edition'],...options],'data-statement-recovery="true"')+'</div>';
  if(edition)html+='<p><strong>'+esc(edition.name)+'</strong> · '+esc(edition.accountId)+' · '+esc(edition.currency)+' · edition '+edition.revision+' · '+esc(edition.actor)+' · '+esc(edition.savedAt)+'</p>'+
    '<p>'+esc(edition.note)+'</p><div class="statement-actions">'+button('Review this statement with these rules','review',!canReview)+button('Edit following rulebook edition','edit',!canEdit)+button('Copy rules into a new rulebook','fork',!canEdit)+button('Download complete rule library','export',false,'',true)+'</div>';
  html+='<div class="statement-actions">'+button('Start a new rulebook','new',!canEdit)+button('Open complete rule library','import',!canEdit)+button('Receive rules from selected saved working copy','from-copy',!canEdit)+button('Save current rule work','persist',!canEdit)+'</div>'+
    '<p class="statement-rule-help">Receiving from the selected named working-copy edition merges its complete rule history and keeps this statement file, mapping and row decisions. Full working-copy archives carry rules, unfinished editors and reviewed applications.</p>';
  html+='<details data-rule-editor><summary>Prepare a rulebook edition</summary><div class="statement-fields">'+input('Rulebook name','bookName',e.name,'maxlength="160"')+input('Exact account identity','accountId',e.accountId,'maxlength="300"')+input('Currency','currency',e.currency,'maxlength="3"')+
    '<label class="statement-wide">Reason for this edition<textarea name="rule.bookNote" maxlength="2000">'+esc(e.note)+'</textarea></label></div>'+
    '<p>'+e.rules.length+' rules in the unfinished edition. '+(e.id?'Following edition '+(e.expectedRevision+1)+'.':'New rulebook.')+'</p>';
  const list=e.rules.slice(Math.max(0,rulePage)*20,Math.max(0,rulePage)*20+20);
  html+='<div class="statement-table"><table><thead><tr><th>Rule</th><th>Conditions</th><th>Proposed decision</th><th>Edit</th></tr></thead><tbody>'+list.map(rule=>'<tr><td>'+esc(rule.name)+'</td><td>'+esc(describe(rule))+'</td><td>'+esc(rule.mode==='EXCLUDE'?'Exclude':rule.category+' · tranche '+rule.tranche)+'</td><td>'+button('Edit','edit-rule',!canEdit,'data-rule-id="'+esc(rule.id)+'"')+button('Remove from next edition','remove-rule',!canEdit,'data-rule-id="'+esc(rule.id)+'"')+'</td></tr>').join('')+'</tbody></table></div><div class="statement-actions">'+button('Previous rules','previous-editor',rulePage<=0)+button('Next rules','next-editor',(rulePage+1)*20>=e.rules.length)+'</div>'+
    '<fieldset><legend>'+(r.id?'Edit selected rule':'Add a rule')+'</legend><div class="statement-fields">'+input('Rule name','name',r.name,'maxlength="120"')+
    select('Direction','direction',r.direction,[['IN','Inflow'],['OUT','Outflow']])+
    input('Reference condition','reference',r.reference,'maxlength="300"')+select('Reference match','referenceMode',r.referenceMode,[['EXACT','Exact'],['PREFIX','Starts with'],['CONTAINS','Contains']])+
    input('Description condition','description',r.description,'maxlength="300"')+select('Description match','descriptionMode',r.descriptionMode,[['EXACT','Exact'],['PREFIX','Starts with'],['CONTAINS','Contains']])+
    select('Text case','caseSensitive',String(r.caseSensitive),[['true','Case sensitive'],['false','Case insensitive']])+
    input('Minimum absolute amount, inclusive','minimum',r.minimum,'inputmode="decimal" maxlength="43"')+input('Maximum absolute amount, inclusive','maximum',r.maximum,'inputmode="decimal" maxlength="43"')+
    select('Decision','mode',r.mode,[['CLASSIFY','Classify'],['EXCLUDE','Exclude from this import']])+
    select('Cash category','category',r.category,categories.map(value=>[value,value]))+
    select('Grant tranche','tranche',r.tranche,[['KEEP','Keep current'],['CLEAR','Clear'],['0','0'],['1','1'],['2','2'],['3','3']])+
    '<label class="statement-wide">Reason retained with the row decision<textarea name="rule.reason" maxlength="800">'+esc(r.reason)+'</textarea></label></div><p>All entered conditions must match. Text comparison uses the original characters; amount bounds use exact decimal arithmetic. Blank bounds are unrestricted. Rules never assign invoice IDs.</p><div class="statement-actions">'+button(r.id?'Update rule in unfinished edition':'Add rule to unfinished edition','put-rule',!canEdit)+button('Clear rule form','clear-rule',!canEdit)+'</div></fieldset>'+
    '<div class="statement-actions">'+button('Save immutable rulebook edition','save',!canReview)+'</div></details>';
  if(review){
    const needle=appliedQuery.trim().toLowerCase(),all=review.rows.filter(row=>(!needle||[row.reference,row.description,String(row.rowNumber)].join(' ').toLowerCase().includes(needle))&&(filter==='ALL'||filter==='MATCHED'&&row.candidates.length>0||filter==='OVERLAP'&&row.candidates.length>1||filter==='PROTECTED'&&row.protectedReason||filter==='UNMATCHED'&&!row.protectedReason&&!row.candidates.length));
    const totalPages=Math.max(1,Math.ceil(all.length/25)),p=Math.min(Math.max(0,page),totalPages-1),rows=all.slice(p*25,p*25+25);
    html+='<h5>Review '+esc(review.edition.name)+' · edition '+review.edition.revision+'</h5>'+
      (!live?'<p role="status">The draft or native preview changed. Earlier matching results and choices remain visible; review again before applying.</p>':'')+
      '<p>Original review: '+esc(review.basis.inputs.source.filename)+' · case version '+review.basis.caseVersion+'. '+Object.values(review.choices).filter(value=>value!=='SKIP').length+' rule decisions selected.</p>'+
      '<p>'+review.rows.length+' source rows · '+review.rows.filter(row=>row.candidates.length).length+' matched · '+review.rows.filter(row=>row.candidates.length>1).length+' overlapping · '+review.rows.filter(row=>row.protectedReason).length+' protected. Unselected rows remain unchanged.</p>'+
      '<div class="statement-fields">'+input('Find source rows','query',query,'maxlength="1000" data-statement-recovery="true"')+select('Rows','filter',filter,[['ALL','All'],['MATCHED','Matched'],['OVERLAP','Overlapping rules'],['PROTECTED','Protected'],['UNMATCHED','No match']],'data-statement-recovery="true"')+'</div>'+
      '<div class="statement-actions">'+button('Find rows','filter',false,'',true)+button('Select unambiguous recommendations','unambiguous',!live||!selectedReview||!canReview)+button('Clear all rule selections','clear-choices',!live||!selectedReview||!canReview)+button('Download complete rule review','download-review',false,'',true)+'</div>'+
      '<div class="statement-table"><table><thead><tr><th>Original row</th><th>Matching rules and proposed result</th><th>Your choice</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+row.rowNumber+' · '+esc(row.reference)+'<small>'+esc(row.description)+'</small><small>'+esc(row.date)+' · '+esc(row.amount)+' '+esc(row.currency)+' '+esc(row.direction)+'</small></td><td>'+(row.protectedReason?esc(row.protectedReason):!row.candidates.length?'No rule matches.':row.candidates.map(candidate=>'<details><summary>'+esc(candidate.name)+' · '+esc(candidate.options.mode==='EXCLUDE'?'Exclude':candidate.options.category+' / tranche '+candidate.options.tranche)+'</summary><p>'+esc(describe(review.edition.rules.find(rule=>rule.id===candidate.ruleId)))+'</p><p>'+esc(candidate.options.reason)+'</p>'+(candidate.change?'<pre>'+esc(JSON.stringify({before:candidate.change.before,after:candidate.change.result},null,2))+'</pre>':'')+(candidate.problems.length?'<p>'+esc(candidate.problems.map(item=>item.message).join(' '))+'</p>':'')+'</details>').join(''))+'</td><td>'+(row.candidates.length?'<select data-statement-rule-choice="'+row.rowNumber+'"'+disabled(!live||!selectedReview||!canReview)+'><option value="">Leave unselected</option>'+[['SKIP','Keep current / skip'],...row.candidates.filter(value=>value.canApply).map(value=>[value.ruleId,value.name])].map(([id,name])=>'<option value="'+esc(id)+'"'+(review.choices[String(row.rowNumber)]===id?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>':'—')+'</td></tr>').join('')+'</tbody></table></div><p>'+all.length+' matching rows · page '+(p+1)+' of '+totalPages+'</p><div class="statement-actions">'+button('Previous rows','previous',p===0,'',true)+button('Next rows','next',p+1>=totalPages,'',true)+button('Apply selected rule decisions','apply',!live||!selectedReview||!canReview||!Object.values(review.choices).some(value=>value!=='SKIP'))+'</div>';
  }
  return html+'</section>';
}

export function statementRuleWork(value,caseId){
  if(value===undefined||value===null)return {library:statementRuleLibrary(null,caseId),editor:statementRuleEditor(),selected:'',review:null,applications:[],query:'',appliedQuery:'',filter:'ALL',page:0,rulePage:0,applicationPage:0};
  exact(value,['library','editor','selected','review','applications','query','appliedQuery','filter','page','rulePage','applicationPage'],'Saved classification work');
  const library=statementRuleLibrary(value.library,caseId),editor=clone(value.editor),blank=statementRuleEditor();
  exact(editor,Object.keys(blank),'Unfinished rulebook');
  need(Number.isSafeInteger(editor.expectedRevision)&&editor.expectedRevision>=0&&Array.isArray(editor.rules)&&editor.rules.length<=100,'Retain the complete unfinished rulebook.');
  for(const key of ['id','name','accountId','currency','note'])text(editor[key],key, key==='note'?2000:300,false);
  for(const rule of editor.rules)validateStatementRule(rule);
  exact(editor.rule,Object.keys(blank.rule),'Unfinished classification rule');
  for(const key of Object.keys(blank.rule)){if(key==='caseSensitive')need(typeof editor.rule[key]==='boolean','Keep the unfinished matching case choice.');else text(editor.rule[key],key,key==='reason'?800:300,false);}
  need(new Set(editor.rules.map(rule=>rule.id)).size===editor.rules.length,'Keep each unfinished rule once.');
  text(value.selected,'Selected rulebook',250,false);
  need(!value.selected||library.editions.some(item=>item.id+':'+item.revision===value.selected),'The selected rulebook edition is missing.');
  if(value.review){
    const review=value.review;exact(review,['schema','edition','basis','rows','choices'],'Saved rule review');
    need(review.schema==='sf47.statement-rule-review.v1'&&object(review.basis)&&review.basis.caseId===caseId&&Array.isArray(review.rows)&&review.rows.length<=5000&&object(review.choices),'Keep the complete original rule review.');
    editionValue(review.edition,caseId);
    need(library.editions.some(item=>same(item,review.edition)),'Keep the rule review’s original saved edition.');
    for(const row of review.rows){
      need(object(row)&&Number.isSafeInteger(row.rowNumber)&&typeof row.protectedReason==='string'&&Array.isArray(row.candidates)&&row.candidates.length<=100,'Keep complete matching rule rows.');
      for(const candidate of row.candidates)need(object(candidate)&&review.edition.rules.some(rule=>rule.id===candidate.ruleId)&&object(candidate.options)&&Array.isArray(candidate.problems)&&typeof candidate.canApply==='boolean'&&candidate.problems.every(problem=>object(problem)&&typeof problem.message==='string'),'Keep complete matching rule recommendations.');
    }
    for(const [key,choice] of Object.entries(review.choices))need(review.rows.some(row=>String(row.rowNumber)===key&&(choice==='SKIP'||row.candidates.some(candidate=>candidate.ruleId===choice))),'Keep the original reviewed rule choices.');
  }
  need(Array.isArray(value.applications)&&value.applications.length<=1000,'Keep at most 1,000 complete reviewed applications per working copy.');
  for(const item of value.applications){
    need(object(item)&&typeof item.appliedAt==='string'&&Number.isFinite(Date.parse(item.appliedAt))&&typeof item.actor==='string'&&object(item.source)&&Array.isArray(item.applied)&&item.applied.length<=5000,'Keep the complete classification application.');
    editionValue(item.edition,caseId);
    need(library.editions.some(edition=>same(edition,item.edition)),'Keep every applied rulebook edition.');
  }
  for(const key of ['query','appliedQuery'])text(value[key],key,1000,false);
  need(['ALL','MATCHED','OVERLAP','PROTECTED','UNMATCHED'].includes(value.filter),'Choose an existing review filter.');
  for(const key of ['page','rulePage','applicationPage'])need(Number.isSafeInteger(value[key])&&value[key]>=0,'Use a complete rule page position.');
  return {...clone(value),library,editor};
}
