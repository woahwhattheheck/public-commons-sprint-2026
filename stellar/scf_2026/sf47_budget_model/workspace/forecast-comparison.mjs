/** Original-case comparison of complete saved Operating forecasts. */
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label=value=>value===null||value===undefined?'Not entered / unavailable':String(value);
const display=value=>'<span>'+esc(label(value))+'</span>';
const original=(value,present=true)=>!present?'<span>Absent</span>':'<details><summary>Complete original value</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(value,null,2))+'</pre></details>';
const fields=[
 ['commercialBalanceUsd','Available cash with selected customers'],['commercialDeltaUsd','Cumulative cash change with selected customers'],
 ['spendingOnlyDeltaUsd','Cumulative existing/grant cash change'],['conditionalGrantDeltaUsd','Cumulative cash change with conditional grants'],
 ['spendingOnlyBalanceUsd','Available cash: existing/grant work'],['conditionalGrantBalanceUsd','Available cash with conditional grants'],
 ['invoiceOutflowUsd','Invoice outflow'],['packageOutflowUsd','Grant-package outflow'],['commercialOutflowUsd','Customer delivery outflow'],
 ['conditionalGrantInflowUsd','Conditional grant inflow'],['forecastCustomerInflowUsd','Forecast customer inflow'],
 ['knownCommercialDeltaUsd','Known valued cumulative customer cash'],['knownCommercialBalanceUsd','Known valued available customer cash'],
 ['remainingWorkHours','Remaining work hours'],['weeklyEquivalentHours','Required seven-day equivalent'],['availableWeeklyHours','Available weekly hours']
];
function table(headers,rows){return '<div style="overflow:auto"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export function mountForecastComparison({container,caseId,forecasts,api,available=()=>true,isBlocked=()=>false}){
 const root=document.createElement('section');root.className='forecast-comparison';container.replaceChildren(root);
 const choices=forecasts.map(row=>({id:row.id,name:row.name,date:row.asOfDate,version:row.source.version}));
 let active=true,busy=false,report=null,error='',tab='impact',search='',offset=0,pageTotal=0,group='packages',dailyField='commercialBalanceUsd',onlyChanged=false;
 let beforeId=choices[1]?.id||choices[0]?.id||'',afterId=choices[0]?.id||'';
 const key='sf47-forecast-comparison:'+caseId;
 const live=()=>active&&available()&&root.isConnected;
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&choices.some(x=>x.id===saved.beforeId)&&choices.some(x=>x.id===saved.afterId)){beforeId=saved.beforeId;afterId=saved.afterId;}}catch{}
 function remember(){try{localStorage.setItem(key,JSON.stringify({beforeId,afterId}));}catch{}}
 const blocked=()=>busy||isBlocked();
 function selection(){return '?'+new URLSearchParams({beforeId,afterId,...(report?{expectedComparisonSha256:report.comparisonSha256}:{})}).toString();}
 function note(text,bad=false){const node=root.querySelector('[data-comparison-status]');if(node){node.textContent=text;node.setAttribute('role',bad?'alert':'status');}}
 function rowsPage(rows,build,headers){
   const filtered=rows.filter(row=>(!onlyChanged||!('state'in row)||row.state!=='unchanged')&&(!search||JSON.stringify(row).toLocaleLowerCase().includes(search.toLocaleLowerCase())));
   pageTotal=filtered.length;offset=Math.min(offset,Math.max(0,Math.floor((filtered.length-1)/50)*50));
   return '<p>'+filtered.length+' matching rows of '+rows.length+' complete rows. '+(filtered.length?'Showing '+(offset+1)+'–'+Math.min(offset+50,filtered.length)+'.':'')+'</p>'+
    table(headers,filtered.slice(offset,offset+50).map(build))+
    '<div class="forecast-actions"><button type="button" data-comparison-action="previous"'+(offset===0?' disabled':'')+'>Previous 50</button><button type="button" data-comparison-action="next"'+(offset+50>=filtered.length?' disabled':'')+'>Next 50</button></div>';
 }
 function results(){
   if(!report)return '';
   const selected=table(['Side','Saved name','As of','Saved','Original case/version','Saved SHA-256'],['before','after'].map(side=>{const v=report[side];return [display(side),display(v.name),display(v.asOfDate),display(v.createdAt),display(v.source.programId+' / '+v.source.version),'<code>'+esc(v.sha256)+'</code>'];}));
   const tabs=[['impact','Funding and capacity'],['groups','Estimate and cash rows'],['source','Original source records'],['changes','All field changes'],['days','Daily cash and capacity'],['work','Remaining work'],['coverage','Valuation and dates']];
   let toolbar='<label>Search full rows <input data-comparison-search value="'+esc(search)+'" placeholder="Find an ID, date, amount or source value"></label>';
   let body='';
   if(tab==='impact'){
     body=table(['Measure','Unit','Before','After','After minus before'],report.metrics.map(row=>['label','unit','before','after','delta'].map(k=>display(row[k]))));
     toolbar='';
   }else if(tab==='groups'||tab==='source'){
     const mapping=tab==='groups'?report.groups:report.sourceGroups;const keys=Object.keys(mapping);if(!keys.includes(group))group=keys[0]||'';
     toolbar+='<label>Original rows <select data-comparison-group>'+keys.map(k=>'<option value="'+esc(k)+'"'+(k===group?' selected':'')+'>'+esc(k)+'</option>').join('')+'</select></label><label><input type="checkbox" data-comparison-changed'+(onlyChanged?' checked':'')+'>Changed rows only</label>';
     body=rowsPage(mapping[group]||[],row=>[display(row.id),display(row.state),original(row.before,row.state!=='added'),original(row.after,row.state!=='removed')],['Original key','Change','Before','After']);
   }else if(tab==='changes'){
     body=rowsPage(report.changes,row=>[display(row.area),'<code>'+esc(row.path)+'</code>',display(row.kind),original(row.before,row.beforePresent),original(row.after,row.afterPresent)],['Area','JSON pointer','Change','Before','After']);
   }else if(tab==='days'){
     toolbar+='<label>Measure <select data-comparison-daily>'+fields.map(([k,title])=>'<option value="'+k+'"'+(dailyField===k?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';
     body='<p>'+esc(report.basis.dailyBasis)+'</p>'+rowsPage(report.days,row=>[display(row.date),display(row.before!==null),display(row.after!==null),display(row.before?.[dailyField]),display(row.after?.[dailyField]),display(row.delta[dailyField])],['Date','Before present','After present','Before','After','After minus before']);
   }else if(tab==='work'){
     body=rowsPage(report.work,row=>[display(row.date),display(row.projectId),display(row.before!==null),display(row.after!==null),display(row.before?.hours),display(row.after?.hours),display(row.deltaHours)],['Date','Original project','Before present','After present','Before hours','After hours','Change']);
   }else{
     toolbar='';body='<p>Coverage and source decisions come from each selected original report. Known valued portions remain separate from complete totals.</p>'+table(['Side','Full valuation, undated work, original decisions and actual records'],['before','after'].map(side=>[display(side),original(report.coverage[side])]));
   }
   const formats=[['zip','Complete receiving ZIP'],['html','Readable HTML / print'],['json','Complete comparison JSON'],['impact-csv','Impact CSV'],['changes-csv','All field changes CSV'],['daily-csv','Daily CSV'],['work-csv','Work CSV']];
   return '<h4>Selected immutable editions</h4>'+selected+'<p>'+esc(report.basis.reportBasis)+'</p><p>'+esc(report.basis.scopeBasis)+'</p>'+
    '<ul>'+report.notices.map(row=>'<li>'+esc(row.message)+'</li>').join('')+'</ul>'+
    '<p>'+report.summary.assumptionChanges+' assumption field changes; '+report.summary.sourceChanges+' source field changes; '+report.summary.overlapDays+' dates present in both reports.</p>'+
    '<div class="forecast-actions">'+tabs.map(([id,title])=>'<button type="button" data-comparison-tab="'+id+'" aria-pressed="'+(tab===id)+'">'+esc(title)+'</button>').join('')+'</div>'+
    '<div data-comparison-view><div class="forecast-grid">'+toolbar+'</div>'+body+'</div>'+
    '<h4>Complete downloads</h4><div class="forecast-actions">'+formats.map(([id,title])=>'<button type="button" data-comparison-download="'+id+'">'+esc(title)+'</button>').join('')+'</div>'+
    '<p>The ZIP includes both complete saved forecasts and the original full case with its source/history. Import that original case ZIP to continue; match the selected forecast hashes in CONTENTS.json.</p>'+
    '<details><summary>Comparison and source identity</summary>'+original({comparisonSha256:report.comparisonSha256,case:report.case,basis:report.basis})+'</details>';
 }
 function render(){
   if(!live())return;
   root.innerHTML='<details data-comparison-panel'+(report||error?' open':'')+'><summary>Compare saved forecasts</summary><p>Select two saved editions from this original case. Your current forecast draft remains in its existing editor.</p>'+
    (!choices.length?'<p>Save a forecast through the original controls to review a retained edition.</p>':'<div class="forecast-grid">'+['before','after'].map(side=>'<label>'+esc(side==='before'?'Before edition':'After edition')+'<select data-comparison-side="'+side+'">'+choices.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===(side==='before'?beforeId:afterId)?' selected':'')+'>'+esc(row.name+' · '+row.date+' · original v'+row.version)+'</option>').join('')+'</select></label>').join('')+'</div><div class="forecast-actions"><button type="button" data-comparison-action="compare">Compare selected editions</button><button type="button" data-comparison-action="swap">Swap before / after</button></div>')+
    '<p data-comparison-status role="status" aria-live="polite">'+esc(error)+'</p>'+results()+'</details>';
   sync();
 }
 function sync(){root.querySelectorAll('button,select,input').forEach(node=>{node.disabled=blocked()||(node.dataset.comparisonAction==='previous'&&offset===0)||(node.dataset.comparisonAction==='next'&&offset+50>=pageTotal);});}
 async function run(fn){
   if(!live()||blocked())return;
   busy=true;sync();
   try{await fn();}catch(e){if(live()){error=e.message||String(e);note(error,true);}}
   finally{busy=false;if(live())sync();}
 }
 root.addEventListener('change',event=>{
   if(blocked())return;const target=event.target;
   if(target.dataset.comparisonSide){if(target.dataset.comparisonSide==='before')beforeId=target.value;else afterId=target.value;report=null;error='';remember();render();root.querySelector('details').open=true;}
   if(target.matches('[data-comparison-group]')){group=target.value;offset=0;render();}
   if(target.matches('[data-comparison-daily]')){dailyField=target.value;offset=0;render();}
   if(target.matches('[data-comparison-changed]')){onlyChanged=target.checked;offset=0;render();}
 });
 root.addEventListener('input',event=>{
   if(!event.target.matches('[data-comparison-search]')||blocked())return;
   const start=event.target.selectionStart,end=event.target.selectionEnd;search=event.target.value;offset=0;render();
   const field=root.querySelector('[data-comparison-search]');field?.focus();field?.setSelectionRange(start,end);
 });
 root.addEventListener('click',event=>{
   const target=event.target.closest('button');if(!target||blocked())return;
   if(target.dataset.comparisonTab){tab=target.dataset.comparisonTab;offset=0;search='';render();return;}
   const action=target.dataset.comparisonAction;
   if(action==='previous'||action==='next'){offset=Math.max(0,offset+(action==='next'?50:-50));render();return;}
   if(action==='swap'){[beforeId,afterId]=[afterId,beforeId];report=null;error='';remember();render();root.querySelector('details').open=true;return;}
   if(action==='compare')run(async()=>{
     const chosen={caseId,beforeId,afterId};const value=await api('/api/operations/'+caseId+'/forecast-comparison?'+new URLSearchParams({beforeId,afterId}));
     if(!live()||chosen.beforeId!==beforeId||chosen.afterId!==afterId)return;
     if(value?.schema!=='stellar-forge.sf47.forecast-comparison.v1'||value.case?.id!==caseId||value.before?.id!==beforeId||value.after?.id!==afterId||!/^[a-f0-9]{64}$/.test(value.comparisonSha256))throw Error('The complete result does not match these selected original forecasts.');
     report=value;error='';offset=0;remember();render();note('Both complete saved editions are ready for review.');
   });
   const format=target.dataset.comparisonDownload;
   if(format)run(async()=>{
     if(!report)throw Error('Compare the original saved editions before downloading.');
     const routes={zip:'export.zip',html:'report.html',json:'comparison.json','impact-csv':'impact.csv','changes-csv':'changes.csv','daily-csv':'daily.csv','work-csv':'work.csv'};
     const selectedHash=report.comparisonSha256;
     const response=await api('/api/operations/'+caseId+'/forecast-comparison/'+routes[format]+selection(),undefined,{download:true});
     const blob=await response.blob();if(!live()||report?.comparisonSha256!==selectedHash)return;
     download(blob,'operating-forecast-comparison-'+selectedHash.slice(0,12)+'-'+routes[format]);note('Downloaded the complete selected '+format+' output.');
   });
 });
 render();
 return {root,dispose(){active=false;},setHostBusy(){sync();}};
}
