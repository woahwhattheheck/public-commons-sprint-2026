// Original Installation check selection inside the existing Completion editor.
const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,attrs='',disabled=false)=>'<button type="button" data-completion-action="installation-'+action+'" '+attrs+(disabled?' disabled data-completion-fixed="true"':'')+'>'+esc(label)+'</button>';
const table=(heads,rows)=>'<div class="completion-table"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const key=row=>[row.costId,row.installationId,row.checkId].join('/');
export function completionInstallations({getCase,getDraft,session,api,clearPreview,beforeReplace=async()=>{}}){
  session.installationCompletion??={};
  const state=()=>session.installationCompletion[String(session.tranche)]??=( {catalog:null,costId:'',installationId:'',checkIds:[],requirePaidPurchase:false,preview:null,requestInputs:null,retainedInputs:[]} );
  const selected=()=>getDraft()?.inputs.installationSelections||[];
  function changed(){const draft=getDraft();if(draft)draft.dirty=true;state().preview=null;state().requestInputs=null;clearPreview();}
  function retain(){state().retainedInputs.push(clone(getDraft().inputs));}
  function bindingCurrent(){
    const value=state(),draft=getDraft(),current=getCase();
    return !!value.preview&&value.preview.report.asOfDate===session.asOfDate&&draft?.baseVersion===current.program.version&&value.preview.source.version===current.program.version&&
      JSON.stringify(value.requestInputs)===JSON.stringify(draft.inputs);
  }
  function markup(){
    const draft=getDraft();if(!draft)return '';
    const value=state(),current=getCase(),catalog=value.catalog;
    const packages=current.completion.tranches.find(x=>x.tranche===session.tranche)?.packages||[];
    const source=catalog?.installations.find(x=>x.id===value.installationId);
    const stale=catalog&&catalog.version!==current.program.version;
    const options=(values,chosen)=>[...values,...(chosen&&!values.some(([id])=>id===chosen)?[[chosen,'Retained original selection · '+chosen]]:[])].map(([id,name])=>'<option value="'+esc(id)+'"'+(id===chosen?' selected':'')+'>'+esc(name)+'</option>').join('');
    let content='<section aria-label="Installation results for completion"><h3>Use original Installation acceptance</h3>'+
      '<p>Choose exact saved checks for each funded package. Review their actual customer observations, work and paid results before adding links to your existing assignment draft.</p>'+
      button('Open current Installation checks','catalog')+
      (stale?'<p class="completion-note">The case changed since this catalogue opened. Refresh the original checks before selecting them.</p>':'');
    if(catalog){
      content+='<div class="completion-fields"><label>Original funded package<select data-completion-installation="costId">'+options([['','Choose a package'],...packages.map(x=>[x.costId,x.costId+' — '+x.remainingWork])],value.costId)+'</select></label>'+
        '<label>Saved Installation<select data-completion-installation="installationId">'+options([['','Choose an Installation'],...catalog.installations.filter(x=>!value.costId||x.costIds.includes(value.costId)).map(x=>[x.id,x.name+' / edition '+x.revision])],value.installationId)+'</select></label></div>';
      if(source){
        content+='<p>Original edition '+source.revision+' · '+esc(source.sha256)+'</p>'+
          table(['Select','Original check / criterion','Actual observation','Linked records'],source.checks.map(check=>[
            '<input type="checkbox" aria-label="Select '+esc(check.title)+'" data-completion-installation-check="'+esc(check.id)+'"'+(value.checkIds.includes(check.id)?' checked':'')+'>',
            esc(check.title)+'<p>'+esc(check.criterion)+'</p>',esc(check.state)+'<br>'+esc(check.operator)+' / '+esc(check.observedAt)+'<p>'+esc(check.note)+'</p>',
            'Work: '+esc(check.workIds.join(', '))+'<br>Purchases: '+esc(check.purchaseIds.join(', '))+'<br>Outcomes: '+esc(check.outcomeIds.join(', '))
          ]))+
          '<label><input type="checkbox" data-completion-installation="requirePaidPurchase"'+(value.requirePaidPurchase?' checked':'')+'> Each selected check requires an original useful paid purchase</label>'+
          '<p class="completion-small">This requirement checks a retained positive settlement, exact transaction, complete hashed output and fulfilled or inapplicable order. Testnet and team observations keep their original classification. It does not establish commercial adoption.</p>'+
          button('Add selected checks to package draft','add','data-completion-write="true"',stale||!value.costId||!value.checkIds.length);
      }
    }
    if(selected().length){
      content+='<h4>Checks retained in this assignment draft</h4>'+table(['Package / exact edition','Check','Paid-result requirement',''],selected().map(row=>[
        esc(row.costId)+'<br>'+esc(row.installationId)+' / '+row.revision+'<br>'+esc(row.sha256),esc(row.checkId),row.requirePaidPurchase?'Required':'Not selected',
        button('Remove this selection','remove','data-key="'+esc(key(row))+'" data-completion-write="true"')
      ]))+button('Review selected Installation results','preview','',draft.baseVersion!==current.program.version);
    }
    if(value.preview){
      const report=value.preview.report;
      content+='<h4>Review original results and proposed assignment changes</h4>'+
        (!bindingCurrent()?'<p class="completion-note">The assignment or case changed after this review. Review again before applying its proposal.</p>':'')+
        reportMarkup(report)+
        '<details><summary>Complete current assignment and proposed links</summary><pre>'+esc(JSON.stringify({original:value.preview.originalInputs,proposed:value.preview.proposedInputs},null,2))+'</pre></details>'+
        button('Add matching links to assignment draft','apply','data-completion-write="true"',!bindingCurrent())+
        table(['Original package','Observed completion suggestion','Review exclusions',''],value.preview.suggestions.map(s=>[
          esc(s.costId),esc(s.completedOn)+'<pre>'+esc(s.completionNote)+'</pre>',
          esc(s.excludedLinks.map(x=>x.kind+' '+x.id+': '+x.reason).join('\n')),
          '<p>'+esc(s.meaning)+'</p>'+button('Use observed result as package completion draft','result','data-cost="'+esc(s.costId)+'" data-completion-write="true"',
            !bindingCurrent()||!s.acceptanceRecorded||!s.completedOn||s.completionNote.length>12000||report.issues.some(x=>x.costId===s.costId))
        ]));
    }
    if(value.retainedInputs.length)content+='<details><summary>Assignment drafts preserved before applying Installation selections</summary><p>These complete inputs are also in the Installation working-copy download.</p><pre>'+esc(JSON.stringify(value.retainedInputs,null,2))+'</pre></details>';
    return content+button('Download Installation working copy','download')+button('Restore Installation working copy','restore')+'</section>';
  }
  function input(el){
    if(el.dataset.completionInstallationCheck){const v=state(),id=el.dataset.completionInstallationCheck;v.checkIds=el.checked?[...new Set([...v.checkIds,id])]:v.checkIds.filter(x=>x!==id);return true;}
    const field=el.dataset.completionInstallation;if(!field)return false;
    const value=state();
    if(field==='requirePaidPurchase')value[field]=el.checked;
    else {value[field]=el.value;value.checkIds=[];if(field==='costId')value.installationId='';}
    return true;
  }
  async function action(action,target){
    if(!action.startsWith('installation-'))return false;
    const name=action.slice(13),current=getCase(),draft=getDraft(),value=state(),number=session.tranche;
    if(!draft)throw Error('Open the original tranche assignment draft first.');
    if(name==='download'){
      const data={schema:'stellar-forge.sf47-completion-installation-draft.v1',caseId:current.program.id,tranche:number,assignment:clone(draft),working:clone(value)};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');
      a.href=url;a.download=current.program.id+'-installation-completion-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
    }
    if(name==='restore'){
      const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';
      const file=await new Promise(resolve=>{picker.addEventListener('change',()=>resolve(picker.files?.[0]||null),{once:true});picker.addEventListener('cancel',()=>resolve(null),{once:true});picker.click();});
      if(!file)return true;
      if(file.size>128*1024*1024)throw Error('Retain the complete file; this working-copy reader accepts up to 128 MiB.');
      const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
      const imported=JSON.parse(text.replace(/^\uFEFF/,''));
      validateInstallationWorkingCopy(imported,current.program.id,number);
      if(getCase().program.version!==current.program.version||session.tranche!==number||getDraft()!==draft)throw Error('The selected case or draft changed while the working copy opened.');
      await beforeReplace('Before restoring Installation working copy');
      if(getCase().program.version!==current.program.version||session.tranche!==number||getDraft()!==draft)throw Error('Reopen the intended original draft before receiving this copy.');
      const before=clone(draft),replacement=clone(imported.assignment),working=validateInstallationWorkingState(imported.working,current.program.id,number);
      Object.assign(draft,replacement,{dirty:true,retainedDraft:before});
      for(const field of Object.keys(value))delete value[field];
      Object.assign(value,working);
      value.importedWorkingCopy=clone(imported);value.preview=null;value.requestInputs=null;
      value.retainedInputs.push(clone(before.inputs));clearPreview();return true;
    }
    if(name==='catalog'){
      const catalog=await api('/api/operations/'+current.program.id+'/completion-installations',{expectedVersion:current.program.version,tranche:number});
      if(getCase().program.version!==current.program.version||session.tranche!==number||getDraft()!==draft)throw Error('The selected case or tranche changed while its original checks opened.');
      value.catalog=catalog;value.checkIds=[];return true;
    }
    if(name==='add'){
      if(value.catalog?.version!==current.program.version||draft.baseVersion!==current.program.version)throw Error('Review current Installation checks and the current assignment draft first.');
      const row=value.catalog.installations.find(x=>x.id===value.installationId);
      if(!row||!row.costIds.includes(value.costId)||!value.checkIds.length)throw Error('Choose the original package and its Installation checks.');
      if(selected().some(x=>x.installationId===row.id&&(x.revision!==row.revision||x.sha256!==row.sha256)))throw Error('The draft retains an earlier edition. Preserve it, remove its selections, then choose this current edition explicitly.');
      retain();const next=clone(selected());
      for(const id of value.checkIds){
        if(!row.checks.some(x=>x.id===id))throw Error('The original check is unavailable.');
        const selection={costId:value.costId,installationId:row.id,revision:row.revision,sha256:row.sha256,checkId:id,requirePaidPurchase:value.requirePaidPurchase};
        const i=next.findIndex(x=>key(x)===key(selection));if(i>=0)next[i]=selection;else next.push(selection);
      }
      draft.inputs.installationSelections=next;changed();return true;
    }
    if(name==='remove'){retain();draft.inputs.installationSelections=selected().filter(x=>key(x)!==target.dataset.key);changed();return true;}
    if(name==='preview'){
      const original=clone(draft.inputs),result=await api('/api/operations/'+current.program.id+'/completion-installations-preview',
        {expectedVersion:current.program.version,inputs:original,asOfDate:session.asOfDate});
      if(getCase().program.version!==current.program.version||session.tranche!==number||getDraft()!==draft||JSON.stringify(original)!==JSON.stringify(draft.inputs))throw Error('Your source or edited assignment changed during the read; preserve the draft and review again.');
      value.preview=result;value.requestInputs=original;return true;
    }
    if(name==='apply'||name==='result'){
      if(!bindingCurrent())throw Error('Review this exact draft and the current case before applying original results.');
      const reviewed=clone(value.preview);retain();
      if(name==='apply')draft.inputs=clone(reviewed.proposedInputs);
      else{
        const suggestion=reviewed.suggestions.find(x=>x.costId===target.dataset.cost);
        if(!suggestion||!suggestion.acceptanceRecorded||!suggestion.completedOn||suggestion.completionNote.length>12000||reviewed.report.issues.some(x=>x.costId===suggestion.costId))throw Error('Resolve the original selected-result findings first.');
        const item=draft.inputs.items.find(x=>x.costId===suggestion.costId);
        item.state='COMPLETE';item.completedOn=suggestion.completedOn;item.completionNote=suggestion.completionNote;
      }
      changed();return true;
    }
    return false;
  }
  return {markup,input,action,evidence(candidate){return candidate?.installationEvidence?'<section><h4>Frozen original Installation acceptance</h4>'+reportMarkup(candidate.installationEvidence)+'</section>':'';}};
}
function reportMarkup(report){
  return '<p>'+report.summary.acceptedChecks+' accepted / '+report.summary.selectedChecks+' selected checks; '+report.summary.distinctUsefulPaidPurchases+' distinct original useful paid transactions. '+esc(report.summary.meaning)+'</p>'+
    (report.issues.length?'<ul>'+report.issues.map(x=>'<li>'+esc(x.costId+' / '+x.checkId+': '+x.message)+'</li>').join('')+'</ul>':'<p>Selected original observations are current for this review.</p>')+
    table(['Package / Installation','Original criterion','Observed result','Paid purchase observations'],report.rows.map(row=>[
      esc(row.selection.costId)+'<br>'+esc(row.installationName)+' / '+row.selection.revision,esc(row.check.criterion),
      esc(row.check.state)+'<br>'+esc(row.check.operator)+' / '+esc(row.check.observedAt)+'<p>'+esc(row.check.note)+'</p>',
      row.purchases.map(p=>esc(p.id)+'<br>'+esc(p.network)+' / '+esc(p.deploymentEnvironment)+' / '+esc(p.participantClass)+'<br>'+esc(p.settlementStatus)+' / '+esc(p.outputStatus)+' / '+esc(p.orderStatus)+'<br>'+esc(p.amountStroops)+' '+esc(p.asset)+'<br>'+esc(p.transactionHash)+'<br>'+esc(p.deliveredSha256)).join('<hr>')
    ]))+'<details><summary>Complete frozen source and observed results</summary><pre>'+esc(JSON.stringify(report,null,2))+'</pre></details>';
}

export function validateInstallationWorkingState(working,caseId,tranche){
  const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x),str=x=>typeof x==='string',strings=x=>Array.isArray(x)&&x.length<=10000&&x.every(str);
  if(!obj(working))throw Error('Retain the complete original Installation working state.');
  for(const key of ['costId','installationId'])if(working[key]!==undefined&&!str(working[key]))throw Error('Retain the original Installation selector.');
  if(working.checkIds!==undefined&&!strings(working.checkIds)||working.requirePaidPurchase!==undefined&&typeof working.requirePaidPurchase!=='boolean'||working.retainedInputs!==undefined&&!Array.isArray(working.retainedInputs))throw Error('Retain the complete Installation choices and earlier inputs.');
  if(working.catalog!=null){
    const c=working.catalog;
    if(!obj(c)||c.caseId!==caseId||c.tranche!==tranche||!Number.isSafeInteger(c.version)||!Array.isArray(c.installations))throw Error('Retain the original Installation catalogue identity.');
    for(const row of c.installations){
      if(!obj(row)||!['id','name','sha256'].every(k=>str(row[k]))||!Number.isSafeInteger(row.revision)||!strings(row.costIds)||!Array.isArray(row.checks))throw Error('Retain each complete saved Installation.');
      for(const check of row.checks)if(!obj(check)||!['id','title','criterion','state','note'].every(k=>str(check[k]))||!['workIds','purchaseIds','outcomeIds'].every(k=>strings(check[k]))||![null,'string'].includes(check.observedAt===null?null:typeof check.observedAt)||![null,'string'].includes(check.operator===null?null:typeof check.operator))throw Error('Retain the complete original check observations.');
    }
  }
  return {catalog:null,costId:'',installationId:'',checkIds:[],requirePaidPurchase:false,
    preview:null,requestInputs:null,retainedInputs:[],...clone(working)};
}

export function validateInstallationWorkingCopy(value,caseId,tranche){
  const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x),str=x=>typeof x==='string',strings=x=>Array.isArray(x)&&x.length<=10000&&x.every(str);
  if(!obj(value)||value.schema!=='stellar-forge.sf47-completion-installation-draft.v1'||value.caseId!==caseId||value.tranche!==tranche||!obj(value.assignment)||!obj(value.working))throw Error('Choose a complete working copy for this original case and tranche.');
  const draft=value.assignment,input=draft.inputs;
  validateInstallationWorkingState(value.working,caseId,tranche);
  if(!Number.isSafeInteger(draft.baseVersion)||draft.baseVersion<1||!obj(input)||input.tranche!==tranche||!str(input.note)||!Array.isArray(input.items)||input.items.length>200)throw Error('The original assignment structure is incomplete.');
  const ids=new Set();
  for(const row of input.items){
    if(!obj(row)||!str(row.costId)||ids.has(row.costId)||!['PLANNED','IN_PROGRESS','COMPLETE'].includes(row.state)||!str(row.note)||!str(row.completionNote)||
      !['ownerIds','workIds','deploymentIds','sourceIds'].every(k=>strings(row[k]))||!['startDate','endDate','completedOn'].every(k=>row[k]===null||str(row[k])))throw Error('Retain each complete editable assignment row.');
    ids.add(row.costId);
  }
  if(input.installationSelections!==undefined){
    if(!Array.isArray(input.installationSelections)||input.installationSelections.length>200)throw Error('Retain the complete Installation selection.');
    for(const row of input.installationSelections)if(!obj(row)||!['costId','installationId','checkId','sha256'].every(k=>str(row[k]))||!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.requirePaidPurchase!=='boolean')throw Error('A retained Installation selection is incomplete.');
  }
}
