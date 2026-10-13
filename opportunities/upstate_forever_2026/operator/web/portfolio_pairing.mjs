import {nativeRunVersion,nativeModelsForOutputs,nativeCommonVersionIssues,nativeModelVersionLabel} from './native_versions.mjs';
/** Original portfolio form controls for observed native baseline pairings. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
export const portfolioNativeVersion=nativeRunVersion;
export function portfolioSharedVersionCompatible(a,b){
  const outputs=['nitrogen_export','phosphorus_export','sediment_export'].filter(name=>a?.artifacts?.[name]&&b?.artifacts?.[name]);
  return nativeCommonVersionIssues([a,b],nativeModelsForOutputs(outputs)).length===0;
}
const versionLabel=run=>nativeModelVersionLabel(run);
export function createPortfolioPairingControls({api,endpoint,getState,portfolioId,assertCurrent,onChange=()=>{}}){
  const workspace=getState()?.workspace_key;
  let node=null,record=null,evaluationId=null,error='',generation=0,loading=false;
  const current=()=>{
    assertCurrent();
    if(getState()?.workspace_key!==workspace)throw Error('Reopen this portfolio in its original workspace.');
  };
  function html(){
    return '<fieldset data-portfolio-pairing><legend>Matching native baseline</legend><div data-portfolio-pairing-body aria-live="polite"><p>Select the completed portfolio evaluation.</p></div></fieldset>';
  }
  function render(){
    if(!node)return;
    if(loading){node.innerHTML='<p role="status">Reading original baseline runs and their executed model versions…</p>';return;}
    if(error){node.innerHTML='<p class="error-text" role="alert">'+esc(error)+'</p>';return;}
    if(!record){node.innerHTML='<p>A planning-only report retains its original screening inventory.</p>';return;}
    const candidates=record.candidates||[],eligible=candidates.filter(row=>row.eligible);
    const options=eligible.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.id.slice(0,12)+' · '+versionLabel(row))+'</option>');
    if(record.can_complete)options.push('<option value="">Complete the original matching baseline</option>');
    const selected=record.selected_baseline_run_id||'';
    node.innerHTML='<p>The comparison uses the evaluation’s parameter profile and selected native models on the original baseline land cover.</p>'+
      '<dl class="pf-facts"><dt>Evaluation run</dt><dd><code>'+esc(record.evaluation.id)+'</code></dd><dt>Native version</dt><dd>'+esc(versionLabel(record.evaluation))+'</dd>'+
      '<dt>Selected models</dt><dd>'+esc(record.evaluation.models.join(' + ').toUpperCase())+'</dd><dt>Original ranking baseline</dt><dd><code>'+esc(record.ranking_baseline.id)+'</code></dd></dl>'+
      '<label class="pf-field"><span>Comparison baseline</span><select name="paired_baseline_run_id"'+(!options.length?' disabled':'')+'>'+
      (options.length?options.join(''):'<option value="">No compatible baseline</option>')+'</select></label>'+
      (record.can_complete?'<label class="pf-check" data-paired-completion><input type="checkbox" name="paired_complete"><span>Complete the matching baseline with the original native runner if needed</span></label>':'')+
      ((record.execution_issues||[]).length?'<p class="pf-note">'+record.execution_issues.map(esc).join(' ')+'</p>':'')+
      '<details><summary>Original candidate runs and compatibility ('+candidates.length+')</summary><div class="table-scroll"><table><thead><tr><th>Run</th><th>State</th><th>Profile / models</th><th>Version</th><th>Compatibility</th></tr></thead><tbody>'+
      candidates.map(row=>'<tr><td><code>'+esc(row.id)+'</code></td><td>'+esc(row.state)+'</td><td><code>'+esc(row.selection.profile_id)+'</code><br>'+esc(row.models.join(' + '))+'</td><td>'+esc(versionLabel(row))+'</td><td>'+esc(row.eligible?'Eligible':row.reasons.join('; '))+'</td></tr>').join('')+
      '</tbody></table></div>'+((record.excluded_records||[]).length?'<p>'+record.excluded_records.map(row=>esc(row.run_id+': '+row.reason)).join('<br>')+'</p>':'')+'</details>';
    const select=node.querySelector('[name="paired_baseline_run_id"]');
    select.value=selected;
    const update=()=>{
      const completion=node.querySelector('[data-paired-completion]');
      if(completion)completion.hidden=!!select.value;
      onChange(record,select.value);
    };
    select.addEventListener('change',update);update();
  }
  function mount(form){
    current();node=form.querySelector('[data-portfolio-pairing-body]');
    if(!node)throw Error('The original portfolio baseline controls are missing.');
  }
  async function load(runId){
    current();evaluationId=runId||null;record=null;error='';
    const request=++generation;
    if(!runId){loading=false;render();onChange(null,null);return;}
    if(!id(runId)||!id(portfolioId))throw Error('Choose an original portfolio and completed evaluation.');
    loading=true;render();
    try{
      const response=await api(endpoint('/api/portfolios/pairing',{workspace,portfolio_id:portfolioId,evaluation_run_id:runId}));
      current();
      if(request!==generation)return;
      if(response?.schema!=='upstate.portfolio-pairing/v1'||response.portfolio_id!==portfolioId||
         response.evaluation?.id!==runId||!Array.isArray(response.candidates)||
         !Array.isArray(response.execution_issues)||!response.ranking_baseline)
        throw Error('The original baseline pairing response is incomplete or identifies another selection.');
      record=response;
    }catch(caught){
      if(request!==generation)return;
      error=caught.message||String(caught);
    }finally{
      if(request===generation){loading=false;render();}
    }
  }
  function selection(runId){
    current();
    if(loading)throw Error('The original baseline runs are still loading.');
    if(error)throw Error(error);
    if(!record||record.evaluation.id!==runId||evaluationId!==runId)throw Error('Choose and load the actual portfolio evaluation.');
    const baseline=node.querySelector('[name="paired_baseline_run_id"]')?.value||'';
    if(baseline){
      if(!record.candidates.some(row=>row.id===baseline&&row.eligible))throw Error('Choose a compatible completed baseline.');
      return {baseline_run_id:baseline,run_missing_baseline:false};
    }
    if(!record.can_complete)throw Error(record.execution_issues.join(' ')||'Complete a compatible baseline first.');
    if(!node.querySelector('[name="paired_complete"]')?.checked)throw Error('Select a completed baseline or enable completion of its original native run.');
    return {run_missing_baseline:true};
  }
  return {html,mount,load,selection,record:()=>record};
}
