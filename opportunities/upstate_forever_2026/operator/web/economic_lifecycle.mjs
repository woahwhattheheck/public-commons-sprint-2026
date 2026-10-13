export function checkLifecycleReport(report){
  const l=report?.lifecycle;if(l===undefined||l===null)return;
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  if(!object(l)||l.schema!=='upstate.lifecycle-report/v1'||!object(l.settings)||!Array.isArray(l.scenarios)||!Array.isArray(l.methodology))throw Error('The retained lifecycle report is incomplete or has an unsupported schema.');
  const known=new Set((report.alternatives||[]).map(r=>r.run_id)),seen=new Set();
  for(const s of l.scenarios){
    if(!object(s)||!known.has(s.run_id)||seen.has(s.run_id)||!Array.isArray(s.cashflows)||!Array.isArray(s.benefit_years)||!Array.isArray(s.cases))throw Error('Retain complete distinct lifecycle scenarios from this original report.');
    seen.add(s.run_id);
    if(s.cashflows.some(r=>!object(r)||!object(r.source))||s.benefit_years.some(r=>!object(r)||!object(r.outputs))||s.cases.some(r=>!object(r)||!object(r.metrics)))throw Error('Retain complete cash-flow, annual benefit and sensitivity rows.');
  }
}
/** Explicit dated lifecycle inputs and views. Calculations remain in the native Python engine. */
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds=[['establishment','Establishment'],['maintenance','Maintenance'],['replacement','Replacement'],['other','Other gross cost'],['assistance','Assistance received'],['salvage','Salvage received']];
const field=(label,path,value,type='text',extra='')=>'<label><span>'+esc(label)+'</span><input data-lifecycle-path="'+esc(path)+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
const area=(label,path,value)=>'<label><span>'+esc(label)+'</span><textarea data-lifecycle-path="'+esc(path)+'" rows="2">'+esc(value)+'</textarea></label>';
const button=(action,label,extra='')=>'<button type="button" data-econ="lifecycle-'+action+'" '+extra+'>'+esc(label)+'</button>';
const sourceFields=(path,value={})=>'<div class="elc-fields">'+field('Source title',path+'.title',value.title)+field('Source URL or retained reference',path+'.uri',value.uri)+field('Source as-of date',path+'.as_of',value.as_of,'date')+'</div>';
const id=prefix=>prefix+'-'+crypto.randomUUID();
const bound=value=>JSON.stringify([value?.report_id||'',value?.report_sha256||'',value?.zone_id||'']);
const required=(value,label)=>{const text=String(value??'').trim();if(!text)throw Error('Enter '+label+'.');return text;};
const nonnegative=(value,label)=>{const text=required(value,label),n=Number(text);if(!Number.isFinite(n)||n<0)throw Error(label+' must be finite and nonnegative.');return n;};
const integer=(value,label)=>{const n=nonnegative(value,label);if(!Number.isSafeInteger(n)||n<1)throw Error(label+' must be a positive integer.');return n;};
const date=(value,label)=>{const text=required(value,label);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number(text.slice(0,4))<1)throw Error('Use YYYY-MM-DD for '+label+'.');const d=new Date(text+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==text)throw Error('Use a real calendar date for '+label+'.');return text;};
const horizonYears=value=>{const years=integer(value.horizon_years,'lifecycle horizon'),start=date(value.start_date,'lifecycle start date');if(Number(start.slice(0,4))+years>9999)throw Error('The horizon must end within calendar year 9999.');return years;};
const origin=(value,label)=>({title:required(value?.title,label+' title'),uri:required(value?.uri,label+' reference'),as_of:date(value?.as_of,label+' as-of date')});
const reference={title:'',uri:'',as_of:''};

export function lifecycleFromSelection(value,binding){
  const editor={enabled:!!value,binding:clone(binding||{}),addRun:'',value:value?clone(value):{schema:'upstate.lifecycle-selection/v1',currency:'',price_basis:'',price_date:'',start_date:'',horizon_years:'',discount_rate:'',note:'',scenarios:[],sensitivity_cases:[]}};
  if(value&&editor.value.sensitivity_cases===undefined)editor.value.sensitivity_cases=[];
  if(value)for(const scenario of editor.value.scenarios)scenario._explicitNoCash=Array.isArray(scenario.cashflows)&&scenario.cashflows.length===0;
  return editor;
}

export function readLifecycleEditor(container,editor){
  if(!container||!editor)return editor;
  const enabled=container.querySelector('[data-lifecycle-enabled]');if(enabled)editor.enabled=enabled.checked;
  const chosen=container.querySelector('[data-lifecycle-add-run]');if(chosen)editor.addRun=chosen.value;
  for(const input of container.querySelectorAll('[data-lifecycle-path]')){
    const parts=input.dataset.lifecyclePath.split('.');let object=editor.value;
    for(const part of parts.slice(0,-1)){if(!object||typeof object!=='object')throw Error('Reopen the lifecycle editor before changing this field.');object=object[part];}
    if(!object||typeof object!=='object')throw Error('Reopen the retained lifecycle row.');
    object[parts.at(-1)]=input.type==='checkbox'?input.checked:input.value;
  }
  return editor;
}

export function lifecycleSelection(editor,binding,source){
  if(!editor?.enabled)return null;
  if(bound(editor.binding)!==bound(binding))throw Error('Review and bind the retained lifecycle schedule to this native report and reporting zone.');
  const v=editor.value,currency=required(v.currency,'lifecycle currency').toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw Error('Use a three-letter lifecycle currency.');
  if(!['constant','nominal'].includes(v.price_basis))throw Error('Choose constant-price or nominal cash amounts.');
  const horizon=horizonYears(v);
  const known=new Set((source?.alternatives||[]).map(x=>x.run_id)),seen=new Set();
  if(!Array.isArray(v.scenarios)||!v.scenarios.length)throw Error('Add at least one original scenario to the lifecycle schedule.');
  const scenarios=v.scenarios.map((s,index)=>{
    if(!known.has(s.run_id)||seen.has(s.run_id))throw Error('Each lifecycle scenario must name one distinct alternative in this native report.');
    seen.add(s.run_id);const label=(source.alternatives.find(x=>x.run_id===s.run_id)?.label||'Scenario '+(index+1));
    const years=new Set();const benefit_factors=(s.benefit_factors||[]).map(row=>{
      const year=integer(row.year,label+' benefit year');if(year>horizon||years.has(year))throw Error(label+' needs each year 1–'+horizon+' exactly once.');
      years.add(year);return {year,factor:nonnegative(row.factor,label+' year '+year+' benefit factor'),note:String(row.note||'')};
    }).sort((a,b)=>a.year-b.year);
    if(years.size!==horizon)throw Error(label+' needs an explicit benefit factor for every year 1–'+horizon+'.');
    const cashIds=new Set();const cashflows=(s.cashflows||[]).map(row=>{
      const key=required(row.id,'cash-flow ID');if(cashIds.has(key))throw Error('Cash-flow IDs must be distinct within '+label+'.');cashIds.add(key);
      if(!kinds.some(x=>x[0]===row.kind))throw Error('Choose the type of each dated cash flow.');
      return {id:key,label:required(row.label,'cash-flow label'),date:date(row.date,'cash-flow date'),kind:row.kind,amount:nonnegative(row.amount,'cash-flow amount'),source:origin(row.source,'cash-flow source'),note:String(row.note||'')};
    });
    if(!cashflows.length&&s._explicitNoCash!==true)throw Error('Enter dated cash flows or explicitly confirm no cash flows for '+label+'.');
    return {run_id:s.run_id,note:String(s.note||''),trajectory_source:origin(s.trajectory_source,label+' trajectory source'),benefit_factors,cashflows};
  });
  const caseIds=new Set(['base']);const sensitivity_cases=(v.sensitivity_cases||[]).map(row=>{
    const key=required(row.id,'sensitivity ID');if(caseIds.has(key))throw Error('Sensitivity IDs must be distinct; base is reserved for the authored schedule.');caseIds.add(key);
    return {id:key,label:required(row.label,'sensitivity label'),discount_rate:nonnegative(row.discount_rate,'sensitivity discount rate'),cost_multiplier:nonnegative(row.cost_multiplier,'gross-cost multiplier'),benefit_multiplier:nonnegative(row.benefit_multiplier,'benefit multiplier')};
  });
  return {schema:'upstate.lifecycle-selection/v1',currency,price_basis:v.price_basis,price_date:date(v.price_date,'price date'),start_date:date(v.start_date,'start date'),horizon_years:horizon,discount_rate:nonnegative(v.discount_rate,'discount rate'),note:String(v.note||''),scenarios,sensitivity_cases};
}

export function lifecycleAction(action,target,editor,source,binding){
  const v=editor.value;
  const index=Number(target.dataset.scenario),s=Number.isInteger(index)?v.scenarios[index]:null;
  if(action==='rebind'){editor.binding=clone(binding);return 'The retained schedule is now explicitly bound to the current native report and reporting zone. Review its quantities and trajectory assumptions before calculating.';}
  if(action==='add-scenario'){
    const run=editor.addRun;if(!(source?.alternatives||[]).some(row=>row.run_id===run))throw Error('Choose an original scenario to add.');
    if(v.scenarios.some(row=>row.run_id===run))throw Error('That scenario is already in the lifecycle schedule.');
    v.scenarios.push({run_id:run,note:'',trajectory_source:{...reference},benefit_factors:[],cashflows:[],_fillFactor:'',_fillNote:'',_explicitNoCash:false});editor.addRun='';return 'Original scenario added. Enter its sourced dated cash flows and explicit annual benefit factors.';
  }
  if(action==='add-case'){v.sensitivity_cases.push({id:id('case'),label:'',discount_rate:'',cost_multiplier:'',benefit_multiplier:''});return 'Sensitivity case added with blank assumptions.';}
  if(action==='remove-case'){const n=Number(target.dataset.row);if(!Number.isInteger(n)||!v.sensitivity_cases[n])throw Error('Choose an existing sensitivity case.');v.sensitivity_cases.splice(n,1);return 'Selected sensitivity case removed from this working schedule.';}
  if(!s)throw Error('Choose a current lifecycle scenario.');
  if(action==='remove-scenario'){v.scenarios.splice(index,1);return 'Selected scenario removed from this working lifecycle schedule; its native result is unchanged.';}
  if(action==='add-cash'){s.cashflows.push({id:id('cash'),label:'',date:'',kind:'',amount:'',source:{...reference},note:''});return 'Dated cash-flow row added. Enter its actual amount, type, date and source.';}
  if(action==='remove-cash'){const n=Number(target.dataset.row);if(!Number.isInteger(n)||!s.cashflows[n])throw Error('Choose an existing cash-flow row.');s.cashflows.splice(n,1);if(!s.cashflows.length)s._explicitNoCash=false;return 'Selected cash-flow row removed from the working schedule.';}
  if(action==='add-year'){
    const horizon=horizonYears(v),present=new Set(s.benefit_factors.map(x=>Number(x.year)));
    let year=1;while(present.has(year)&&year<=horizon)year++;if(year>horizon)throw Error('All horizon years already have rows. Edit the existing explicit factors.');
    s.benefit_factors.push({year,factor:'',note:''});s.benefit_factors.sort((a,b)=>Number(a.year)-Number(b.year));return 'Missing year row added with its factor left blank.';
  }
  if(action==='fill-years'){
    const horizon=horizonYears(v),factor=nonnegative(s._fillFactor,'explicit fill factor'),note=required(s._fillNote,'reason for the filled factors');
    const present=new Set(s.benefit_factors.map(x=>Number(x.year)));let count=0;
    for(let year=1;year<=horizon;year++)if(!present.has(year)){s.benefit_factors.push({year,factor,note});count++;}
    s.benefit_factors.sort((a,b)=>Number(a.year)-Number(b.year));return count+' missing annual factors added using your entered factor and reason. Existing years were preserved.';
  }
  if(action==='remove-year'){const n=Number(target.dataset.row);if(!Number.isInteger(n)||!s.benefit_factors[n])throw Error('Choose an existing year row.');s.benefit_factors.splice(n,1);return 'Year row removed. A complete calculation still requires every horizon year explicitly.';}
  throw Error('Unknown lifecycle editor action.');
}

export function renderLifecycleEditor(editor,source,binding){
  const v=editor.value,changed=bound(editor.binding)!==bound(binding),chosen=new Set(v.scenarios.map(x=>x.run_id));
  let body='<section data-lifecycle class="economic-lifecycle"><h3>4. Dated lifecycle scenarios</h3><p class="elc-note">Retain establishment, maintenance, replacement and funding on their actual scenario dates. This optional schedule supplements the original upfront-plus-annual comparison. The native annual established-cover result remains unchanged.</p><label class="elc-check"><input type="checkbox" data-lifecycle-enabled '+(editor.enabled?'checked':'')+'> Include an explicitly authored lifecycle schedule</label>';
  if(!editor.enabled)return body+'<p class="elc-note">'+(v.scenarios.length?(changed?'Your previous report/zone schedule is retained and excluded. Re-enable it, review the changed physical source and explicitly rebind before calculating.':'Your working schedule is retained here while excluded from the next calculation. Re-enable it to continue editing.'):'No lifecycle assumptions are applied.')+'</p></section>';
  if(changed)body+='<div class="elc-warning" role="status"><p>The selected native report or reporting zone differs from this working schedule’s original binding. Its values are preserved. Review the new physical support before explicitly using these assumptions.</p>'+button('rebind','Bind reviewed schedule to this report and zone')+'</div>';
  body+='<div class="elc-fields">'+field('Lifecycle currency','currency',v.currency,'text','maxlength="3" placeholder="ISO currency"')+
    '<label><span>Cash amount and discount basis</span><select data-lifecycle-path="price_basis"><option value="">Choose the basis</option><option value="constant" '+(v.price_basis==='constant'?'selected':'')+'>Constant prices with a real discount rate</option><option value="nominal" '+(v.price_basis==='nominal'?'selected':'')+'>Nominal dated amounts with a nominal discount rate</option></select></label>'+
    field('Price reference date','price_date',v.price_date,'date')+field('Lifecycle start date','start_date',v.start_date,'date')+
    field('Horizon in whole years','horizon_years',v.horizon_years,'number','min="1" step="1"')+field('Discount rate as a decimal','discount_rate',v.discount_rate,'number','min="0" step="any" placeholder="Enter rate; 0.03 means 3%"')+'</div>'+
    '<p class="elc-note">Cash dates run from the start date through the final horizon anniversary, inclusive. Enter all amounts in the chosen price basis; no escalation or inflation conversion is inferred. Gross cost, assistance and salvage remain separate. This panel does not alter the original annual budget criteria.</p>'+
    area('Price basis, footprint and lifecycle assumptions','note',v.note)+
    '<div class="elc-actions"><label><span>Add an original alternative</span><select data-lifecycle-add-run><option value="">Choose a scenario</option>'+
    (source?.alternatives||[]).filter(row=>!chosen.has(row.run_id)).map(row=>'<option value="'+esc(row.run_id)+'" '+(editor.addRun===row.run_id?'selected':'')+'>'+esc(row.label)+'</option>').join('')+'</select></label>'+button('add-scenario','Add selected scenario')+'</div>';
  for(const [i,s]of v.scenarios.entries()){
    const name=(source?.alternatives||[]).find(row=>row.run_id===s.run_id)?.label||s.run_id,p='scenarios.'+i,tag='data-scenario="'+i+'"';
    body+='<details open><summary>'+esc(name)+'</summary><p class="elc-note">Original run <code>'+esc(s.run_id)+'</code></p>'+area('Scenario cost footprint and schedule notes',p+'.note',s.note)+
      '<h4>Benefit trajectory assumption</h4><p class="elc-note">Enter a factor for each year. A factor of 1 means the full native annual modeled reduction; it is not a measured establishment rate. Zero and factors above 1 remain explicit authored assumptions. The same factor applies to each separately reported pollutant. Signed adverse changes remain signed.</p>'+sourceFields(p+'.trajectory_source',s.trajectory_source)+
      '<div class="elc-fields">'+field('Explicit factor for missing years',p+'._fillFactor',s._fillFactor,'number','min="0" step="any"')+field('Reason for those factors',p+'._fillNote',s._fillNote)+'</div><div class="elc-actions">'+button('fill-years','Fill missing years with entered factor',tag)+button('add-year','Add one blank year',tag)+'</div>'+
      '<div class="elc-table"><table><thead><tr><th>Year</th><th>Factor</th><th>Authored reasoning</th><th>Row</th></tr></thead><tbody>'+
      s.benefit_factors.map((row,j)=>'<tr><td>'+field('Year',p+'.benefit_factors.'+j+'.year',row.year,'number','min="1" step="1"')+'</td><td>'+field('Year '+row.year+' factor',p+'.benefit_factors.'+j+'.factor',row.factor,'number','min="0" step="any"')+'</td><td>'+area('Year '+row.year+' reason',p+'.benefit_factors.'+j+'.note',row.note)+'</td><td>'+button('remove-year','Remove year',tag+' data-row="'+j+'"')+'</td></tr>').join('')+'</tbody></table></div>'+
      (!s.benefit_factors.length?'<p class="elc-note">No annual factors entered yet.</p>':'')+'<h4>Dated cash flows</h4><p class="elc-note">Enter nonnegative amounts and choose their meaning. Assistance and salvage are funding receipts, not negative gross costs. Each amount retains its original reference and as-of date. An empty cash-flow list explicitly represents no entered costs or receipts.</p>';
    if(!s.cashflows.length)body+='<label class="elc-check"><input type="checkbox" data-lifecycle-path="'+p+'._explicitNoCash" '+(s._explicitNoCash===true?'checked':'')+'> I explicitly intend no cash flows in this scenario; gross costs and receipts are zero.</label>';
    for(const [j,row]of s.cashflows.entries()){
      const q=p+'.cashflows.'+j;
      body+='<details open><summary>'+esc(row.label||'New cash flow')+'</summary><p class="elc-note">Retained row <code>'+esc(row.id)+'</code></p><div class="elc-fields">'+field('Cash-flow label',q+'.label',row.label)+field('Date',q+'.date',row.date,'date')+
        '<label><span>Cash-flow type</span><select data-lifecycle-path="'+q+'.kind"><option value="">Choose a type</option>'+kinds.map(([key,label])=>'<option value="'+key+'" '+(row.kind===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+field('Amount in '+(v.currency||'selected currency'),q+'.amount',row.amount,'number','min="0" step="any"')+'</div>'+sourceFields(q+'.source',row.source)+area('Quantity, eligibility, timing and source notes',q+'.note',row.note)+'<div class="elc-actions">'+button('remove-cash','Remove cash flow',tag+' data-row="'+j+'"')+'</div></details>';
    }
    body+='<div class="elc-actions">'+button('add-cash','Add dated cash flow',tag)+button('remove-scenario','Remove this lifecycle scenario',tag)+'</div></details>';
  }
  body+='<h4>Financial and trajectory sensitivity</h4><p class="elc-note">The authored base case is retained automatically. Additional cases require explicit values. The cost multiplier changes gross cost only; assistance and salvage stay unchanged. The benefit multiplier applies to the authored trajectory, not the native model. These cases do not change scientific parameters or the original Pareto/budget decisions.</p>';
  for(const[i,row]of v.sensitivity_cases.entries()){
    const p='sensitivity_cases.'+i;
    body+='<details open><summary>'+esc(row.label||'New sensitivity case')+'</summary><p class="elc-note"><code>'+esc(row.id)+'</code></p><div class="elc-fields">'+field('Case label',p+'.label',row.label)+field('Discount rate as a decimal',p+'.discount_rate',row.discount_rate,'number','min="0" step="any"')+field('Gross-cost multiplier',p+'.cost_multiplier',row.cost_multiplier,'number','min="0" step="any"')+field('Benefit multiplier',p+'.benefit_multiplier',row.benefit_multiplier,'number','min="0" step="any"')+'</div>'+button('remove-case','Remove sensitivity case','data-row="'+i+'"')+'</details>';
  }
  return body+'<div class="elc-actions">'+button('add-case','Add explicit sensitivity case')+'</div><p class="elc-note">Use Calculate decision preview below to run the original Python calculator. Save inputs or build an edition to retain this complete schedule and its source references. Reuse inputs on a saved edition restores these fields.</p></section>';
}

/** Pure presentation of the retained Python result; safe to inline in the standalone desk. */
export function lifecycleReportMarkup(report,selectedRunId=null,includeInlineStyles=true){
  const lifecycle=report?.lifecycle;if(!lifecycle)return '';checkLifecycleReport(report);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat(undefined,{maximumSignificantDigits:12}).format(value):'Unavailable';
  const labels={nitrogen_export:'Nitrogen',phosphorus_export:'Phosphorus',sediment_export:'Sediment'};
  const kindNames={establishment:'Establishment',maintenance:'Maintenance',replacement:'Replacement',other:'Other gross cost',assistance:'Assistance received',salvage:'Salvage received'};
  const link=value=>{
    if(!value)return 'Reference not retained';
    let href='';try{const parsed=new URL(value.uri||'');if(['http:','https:'].includes(parsed.protocol))href=parsed.href;}catch{}
    return (href?'<a target="_blank" rel="noopener noreferrer" href="'+escape(href)+'">'+escape(value.title||value.uri)+'</a>':escape(value.title||value.uri))+
      (value.uri?'<div class="elr-ref">'+escape(value.uri)+'</div>':'')+(value.as_of?' · as of '+escape(value.as_of):'');
  };
  const cell=value=>'<td>'+escape(value)+'</td>';
  const table=(head,rows,caption)=>'<div class="elr-table"><table><caption>'+escape(caption)+'</caption><thead><tr>'+head.map(x=>'<th scope="col">'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  const settings=lifecycle.settings||{},currency=settings.currency||'',basis=settings.price_basis==='constant'?'Constant prices; real discount rate':settings.price_basis==='nominal'?'Nominal dated amounts; nominal discount rate':settings.price_basis||'Unspecified price basis';
  const style=includeInlineStyles?'<style>.economic-lifecycle-report{margin-top:22px;border-top:1px solid #bfc4c7;padding-top:18px;color:#25292c;font:14px/1.5 Arial,Helvetica,sans-serif}.economic-lifecycle-report *{box-sizing:border-box}.economic-lifecycle-report h3{font-size:18px;margin:0 0 10px}.economic-lifecycle-report h4{font-size:15px;margin:20px 0 8px}.economic-lifecycle-report p{margin:8px 0}.economic-lifecycle-report details{border:1px solid #c9cdd0;padding:12px;margin:14px 0;background:#fff}.economic-lifecycle-report summary{font-weight:650;cursor:pointer;overflow-wrap:anywhere}.economic-lifecycle-report .elr-note{color:#50575b;font-size:13px}.economic-lifecycle-report .elr-ref{font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.economic-lifecycle-report .elr-table{overflow-x:auto;margin:12px 0}.economic-lifecycle-report table{width:100%;border-collapse:collapse;font-size:12px}.economic-lifecycle-report caption{text-align:left;padding:6px 0;font-weight:600;color:#3f464b}.economic-lifecycle-report th,.economic-lifecycle-report td{padding:8px;border-bottom:1px solid #d3d7da;text-align:left;vertical-align:top;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.economic-lifecycle-report thead{background:#f0f2f3}.economic-lifecycle-report .elr-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:10px;margin:12px 0}.economic-lifecycle-report .elr-fact{padding:10px;border:1px solid #cbd0d3;background:#f5f6f7;overflow-wrap:anywhere}.economic-lifecycle-report .elr-fact span{display:block;font-size:12px;color:#53595e}.economic-lifecycle-report .elr-fact strong{display:block;font-size:15px;margin-top:3px}.economic-lifecycle-report .elr-warning{border:1px solid #7b8288;padding:10px}.economic-lifecycle-report a{color:#253038;text-underline-offset:2px}.economic-lifecycle-report pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f6;padding:10px;font-size:12px}@media print{.economic-lifecycle-report{font-size:10pt}.economic-lifecycle-report .elr-table{overflow:visible}.economic-lifecycle-report details{break-inside:auto}.economic-lifecycle-report th,.economic-lifecycle-report td{padding:4px;font-size:9pt}.economic-lifecycle-report thead{display:table-header-group}}@media(max-width:600px){.economic-lifecycle-report details{padding:8px}.economic-lifecycle-report th,.economic-lifecycle-report td{padding:6px}}</style>':'';
  let html=style+'<section class="economic-lifecycle-report" aria-label="Dated lifecycle results"><h3>Dated lifecycle results</h3><p>'+escape(basis)+' · '+escape(currency)+'. Price reference '+escape(settings.price_date)+'; start '+escape(settings.start_date)+'; horizon '+escape(settings.horizon_years)+' years. Discount rate '+number(settings.discount_rate)+' (decimal).</p>'+
    '<p class="elr-note">These calculations use the separately authored schedule. The original upfront-plus-annual budget and Pareto decisions remain unchanged. Each pollutant keeps its own mass unit. Discounted mass is a time-weighted decision quantity, not an additional physical model output or measured benefit.</p>'+
    (settings.note?'<p>'+escape(settings.note)+'</p>':'');
  const scenarios=(lifecycle.scenarios||[]).filter(row=>selectedRunId===null||row.run_id===selectedRunId);
  if(!scenarios.length)return html+'<p class="elr-note">This original scenario has no authored lifecycle schedule in the retained edition.</p></section>';
  for(const s of scenarios){
    const original=(report.selection?.lifecycle?.scenarios||[]).find(row=>row.run_id===s.run_id)||{},base=(s.cases||[]).find(row=>row.id==='base');
    html+='<details open><summary>'+escape(s.label||s.run_id)+'</summary><p class="elr-ref">Original native run '+escape(s.run_id)+'</p>'+
      (s.note?'<p>'+escape(s.note)+'</p>':'')+'<p class="elr-note">Trajectory source: '+link(s.trajectory_source||original.trajectory_source)+'</p>';
    if(!s.support_ready)html+='<p class="elr-warning">The complete scenario lacks the required shared physical support. Dated cost calculations remain visible; lifecycle load totals and unit-value ratios are unavailable.</p>';
    if(base)html+='<div class="elr-facts">'+[
      ['Gross present cost',base.gross_present_value],['Assistance present value',base.assistance_present_value],['Salvage present value',base.salvage_present_value],['Net present cost',base.net_present_value],['Gross annual equivalent',base.gross_annual_equivalent],['Net annual equivalent',base.net_annual_equivalent]
    ].map(([label,value])=>'<div class="elr-fact"><span>'+label+'</span><strong>'+number(value)+' '+escape(currency)+(label.includes('annual')?'/year':'')+'</strong></div>').join('')+'</div>';
    html+='<h4>Authored and sensitivity cases</h4>'+table(['Case','Discount rate','Gross-cost factor','Benefit factor','Gross present cost','Assistance PV','Salvage PV','Net present cost','Gross annual equivalent','Net annual equivalent'],(s.cases||[]).map(row=>'<tr>'+
      [row.label||row.id,number(row.discount_rate),number(row.cost_multiplier),number(row.benefit_multiplier),number(row.gross_present_value),number(row.assistance_present_value),number(row.salvage_present_value),number(row.net_present_value),number(row.gross_annual_equivalent),number(row.net_annual_equivalent)].map(cell).join('')+'</tr>'),'All amounts in '+currency+'; annual equivalents in '+currency+'/year')+
      '<p class="elr-note">Cost multipliers affect gross cost kinds only; assistance and salvage remain fixed. A negative net cost is shown explicitly. No assistance eligibility, escalation, tree growth or monetary environmental value is inferred.</p>';
    const metricRows=[];for(const row of s.cases||[])for(const[metric,m]of Object.entries(row.metrics||{}))metricRows.push('<tr>'+
      [row.label||row.id,labels[metric]||metric,number(m.annual_native_reduction)+' '+(m.units||'')+'/year',number(m.total_avoided_load)+' '+(m.units||''),number(m.discounted_avoided_load)+' '+(m.units||''),number(m.gross_cost_per_total_unit),number(m.net_cost_per_total_unit),number(m.gross_break_even_unit_value),number(m.net_break_even_unit_value),m.unit_value_units||''].map(cell).join('')+'</tr>');
    html+='<h4>Separate pollutant totals and threshold values</h4>'+table(['Case','Pollutant','Native annual reduction','Undiscounted avoided mass','Discounted avoided mass','Gross cost / undiscounted mass','Net cost / undiscounted mass','Gross break-even unit value','Net break-even unit value','Unit-value units'],metricRows,'Retained modeled support and explicit annual trajectory')+
      '<p class="elr-note">Break-even unit value divides present cost by discounted avoided mass. It is a threshold to compare with a separately justified valuation, not a claim that benefits have been monetized. Ratios require positive mass and complete shared support. Signed zero or adverse load changes remain visible in the underlying rows.</p>';
    html+='<h4>Dated cash flows</h4>'+table(['Date','Label / type','Amount','Elapsed years','Discount factor','Present value','Source and notes'],(s.cashflows||[]).map(row=>'<tr>'+cell(row.date)+cell((row.label||row.id)+' · '+(kindNames[row.kind]||row.kind))+cell(number(row.amount)+' '+currency)+cell(number(row.time_years))+cell(number(row.discount_factor))+cell(number(row.present_value)+' '+currency)+'<td>'+link(row.source)+(row.note?'<p>'+escape(row.note)+'</p>':'')+'</td></tr>'),'Original authored amounts and base-case discounting');
    if(!(s.cashflows||[]).length)html+='<p class="elr-note">No cash flows were entered for this scenario.</p>';
    const years=[];for(const row of s.benefit_years||[])for(const[metric,value]of Object.entries(row.outputs||{}))years.push('<tr>'+
      [row.year,row.date,number(row.factor),labels[metric]||metric,number(value.annual_native_reduction)+' '+(value.units||'')+'/year',number(value.avoided_load)+' '+(value.units||''),number(row.discount_factor),number(value.present_value_load)+' '+(value.units||''),row.note||''].map(cell).join('')+'</tr>');
    html+='<h4>Every authored benefit year</h4>'+table(['Year','Anniversary','Trajectory factor','Pollutant','Native annual reduction','Avoided mass','Discount factor','Discounted mass','Reason'],years,'Base-case annual assumed trajectory; no biological growth simulation')+
      '<details><summary>Exact lifecycle scenario input</summary><pre>'+escape(JSON.stringify(original,null,2))+'</pre></details></details>';
  }
  if((lifecycle.methodology||[]).length)html+='<h4>Calculation method</h4><ol>'+lifecycle.methodology.map(row=>'<li>'+escape(row)+'</li>').join('')+'</ol>';
  return html+'</section>';
}
