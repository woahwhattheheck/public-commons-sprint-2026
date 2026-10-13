// Saved statement interpretations; the original Statements desk owns writes and source bytes.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
export const sameSetupValue=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
export function statementSetupLink(row){
  return Object.fromEntries(['id','name','revision','sourceId','sourceSha256','editionSha256'].map(key=>[key,row[key]]));
}
export function statementSetupSettings(input){
  const sourceFormat=input.sourceFormat||'CSV';
  const result={sourceFormat,accountId:String(input.accountId||'').trim(),accountLabel:String(input.accountLabel||'').trim(),currency:String(input.currency||'').trim().toUpperCase(),defaultCategory:input.defaultCategory||'OTHER'};
  if(sourceFormat==='CSV'){result.format=clone(input.format);result.columns=Object.fromEntries(['date','reference','description','amount','debit','credit','currency','usdValue'].map(key=>[key,input.columns?.[key]||'']));for(const key of (input.format?.amountMode==='SIGNED'?['debit','credit']:['amount']))result.columns[key]='';}
  else if(sourceFormat==='MT940')result.statementOptions=clone(input.statementOptions);
  return result;
}
export function statementSetupComparison(row,input,readHeaders){
  const settings=row.settings;
  let headers=[],headerError='';
  if(settings.sourceFormat==='CSV'&&input.source){
    try{headers=readHeaders(input.source,settings.format.delimiter);}catch(error){headerError=error.message;}
  }
  const baseline=row.basis.headers,selected=Object.values(settings.columns||{}).filter(Boolean);
  const matches=baseline.filter(h=>headers.includes(h));
  const missing=baseline.filter(h=>!headers.includes(h)),added=headers.filter(h=>!baseline.includes(h));
  const missingMapped=[...new Set(selected.filter(h=>!headers.includes(h)))];
  const reordered=!missing.length&&!added.length&&!sameSetupValue(headers,baseline);
  const current=statementSetupSettings(input),changes=[];
  for(const key of ['sourceFormat','accountId','accountLabel','currency','defaultCategory','format','columns','statementOptions']){
    if(!sameSetupValue(current[key],settings[key]))changes.push({field:key,current:current[key]??null,saved:settings[key]??null});
  }
  return {headers,matches,missing,added,missingMapped,reordered,headerError,changes,
    canApply:!!input.source&&row.status==='ACTIVE'&&!headerError&&(settings.sourceFormat!=='CSV'||!missingMapped.length)};
}
const button=(label,action,disabled=false,recovery=false)=>'<button type="button" data-statement-action="'+action+'"'+(disabled?' disabled data-statement-fixed="true"':'')+(recovery?' data-statement-recovery="true"':' data-statement-write="true"')+'>'+esc(label)+'</button>';
const list=value=>value.length?value.map(h=>'<code>'+esc(h)+'</code>').join(', '):'None';
const value=entry=>typeof entry==='object'&&entry!==null?JSON.stringify(entry):String(entry??'—');
export function statementSetupPanel({rows,input,choice,name,note,pending,readHeaders,open=true}){
  const selected=rows.find(row=>row.sourceId===choice),current=input.statementSetup;
  const heads=new Map();for(const row of rows)if(!heads.has(row.id)||heads.get(row.id).revision<row.revision)heads.set(row.id,row);
  let html='<section class="statement-panel statement-setups" aria-label="Saved statement setups"><h4>Use a saved statement setup</h4>'+
    '<p>Choose the next statement file, then compare a saved account and interpretation. Saving a setup keeps its exact column names and format choices for the next period.</p>';
  if(current)html+='<p class="statement-setup-current"><strong>'+esc(current.name)+'</strong> · edition '+esc(current.revision)+' is selected for this statement.</p>'+button('Clear setup selection','setup-clear',false);
  html+='<div class="statement-fields"><label>Saved bank / account setup<select name="setupChoice"><option value="">Choose a saved setup</option>'+
    [...rows].sort((a,b)=>a.name.localeCompare(b.name)||b.revision-a.revision).map(row=>'<option value="'+esc(row.sourceId)+'"'+(row.sourceId===choice?' selected':'')+'>'+esc(row.name)+' · '+esc(row.settings.accountLabel||row.settings.accountId)+' · '+esc(row.settings.currency)+' · '+esc(row.settings.sourceFormat)+' · edition '+row.revision+(row.status==='ARCHIVED'?' · archived':heads.get(row.id).status==='ARCHIVED'?' · archived series':heads.get(row.id).revision!==row.revision?' · earlier edition':'')+'</option>').join('')+'</select></label></div>';
  if(selected){
    const comparison=statementSetupComparison(selected,input,readHeaders),bank=selected.basis.bank;
    html+='<p><strong>'+esc(selected.name)+'</strong> · edition '+selected.revision+' · '+esc(selected.settings.accountLabel||selected.settings.accountId)+' ('+esc(selected.settings.accountId)+') · '+esc(selected.settings.currency)+' · '+esc(selected.settings.sourceFormat)+'</p>';
    if(bank)html+='<p>Original bank account: '+esc(bank.accountReference)+' · bank '+esc(bank.bankId||'unspecified')+' · '+esc(bank.kind)+' · date basis '+esc(bank.dateBasis)+'. Inspect and select this account in the new original file after applying.</p>';
    html+='<p>Mapping saved from '+esc(selected.basis.filename)+' by '+esc(selected.actor)+' on '+esc(selected.savedAt)+'.</p>';
    if(selected.settings.sourceFormat==='CSV'){
      html+='<dl><dt>Exact header matches</dt><dd>'+list(comparison.matches)+'</dd><dt>Missing mapped headers</dt><dd>'+list(comparison.missingMapped)+'</dd><dt>Other missing headers</dt><dd>'+list(comparison.missing.filter(h=>!comparison.missingMapped.includes(h)))+'</dd><dt>New headers</dt><dd>'+list(comparison.added)+'</dd><dt>Column order</dt><dd>'+(comparison.reordered?'Changed; mapping uses exact names.':'Compared by exact original heading.')+'</dd></dl>';
      if(comparison.headerError)html+='<p role="alert">'+esc(comparison.headerError)+'</p>';
      if(comparison.missingMapped.length)html+='<p>Map the changed headings in the current statement and save a new edition. No replacement heading is inferred.</p>';
    }
    html+='<details open><summary>Account and interpretation changes before applying</summary>'+
      (comparison.changes.length?'<div class="statement-table"><table><thead><tr><th>Choice</th><th>Current mapping</th><th>Saved setup</th></tr></thead><tbody>'+comparison.changes.map(row=>'<tr><th>'+esc(row.field)+'</th><td>'+esc(value(row.current))+'</td><td>'+esc(value(row.saved))+'</td></tr>').join('')+'</tbody></table></div>':'<p>The current account and interpretation match this edition.</p>')+'</details>'+
      '<p>Applying clears this draft’s balances, row decisions and bank section selection. The selected original file stays attached.</p>'+
      '<div class="statement-actions">'+button('Apply this setup','setup-apply',!comparison.canApply||!open)+button('Save new edition from current mapping','setup-revise',!input.source||!open)+button('Archive setup','setup-archive',heads.get(selected.id).status==='ARCHIVED'||!open)+'</div>';
  }
  html+='<div class="statement-fields"><label>Setup name<input name="setupName" maxlength="160" value="'+esc(name||'')+'" placeholder="Operating account — monthly CSV"></label><label class="statement-wide">Reason for this edition<textarea name="setupNote" rows="2" maxlength="12000">'+esc(note||'')+'</textarea></label></div>'+
    '<div class="statement-actions">'+button('Save current mapping as a new setup','setup-new',!input.source||!open)+'</div>';
  if(pending)html+='<p role="status">The original setup save request is retained. Resume that same request before editing this statement.</p><div class="statement-actions">'+button('Resume saved setup request','setup-retry',false,true)+button('Download recovery copy','draft-export',false,true)+'</div>';
  if(!rows.length)html+='<p>No statement setups have been saved in this case yet. Map the original statement and save the account and interpretation here.</p>';
  return html+'</section>';
}
