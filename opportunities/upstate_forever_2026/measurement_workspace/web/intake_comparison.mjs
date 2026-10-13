/** Complete source-bound preparation comparison inside the original guided intake. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=x=>JSON.stringify(x,null,2);
function download(name,value,type='application/json;charset=utf-8'){
 const link=document.createElement('a'),url=URL.createObjectURL(new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type}));link.href=url;link.download=name.replace(/[\\/:*?"<>|]/g,'_');link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function sideText(v){
 if(v.status!=='accepted')return v.status+': '+(v.reason||'');
 const r=v.row;
 if(!Object.hasOwn(r,'parameter'))return [r.id,r.name,r.latitude,r.longitude,r.datum].filter(x=>x!==undefined&&x!==null).join(' · ');
 return [r.stationId,r.parameter,r.sampledDate,r.timePrecision,r.sourceTime,r.timeZone,r.censor==='none'?r.value:r.censor+' ['+r.lower+', '+r.upper+']',r.unit,r.basis,r.fraction].map(x=>x??'').join(' · ');
}
function selectedRows(report,view){
 const term=String(view.search||'').toLocaleLowerCase();
 return report.rows.filter(r=>(view.filter!=='changed'||r.changes.length>0)&&(view.filter!=='rejected'||r.before.status!=='accepted'||r.after.status!=='accepted')&&(!term||JSON.stringify(r).toLocaleLowerCase().includes(term)));
}
function comparisonMarkup(report,view){
 const rows=selectedRows(report,view),size=50,max=Math.max(0,Math.ceil(rows.length/size)-1);view.page=Math.min(Math.max(0,view.page||0),max);
 const selected=rows.slice(view.page*size,(view.page+1)*size);
 const mapping=report.preparation_changes.map(x=>'<tr><th>'+esc(x.field)+'</th><td><pre>'+esc(x.before.present?pretty(x.before.value):'Not supplied')+'</pre></td><td><pre>'+esc(x.after.present?pretty(x.after.value):'Not supplied')+'</pre></td></tr>').join('');
 const side=(s,title)=>'<section><h4>'+title+' · revision '+s.revision+'</h4><p>'+esc(s.label)+' · '+esc(s.reviewer)+'</p><p>'+s.accepted+' parsed; '+s.rejected+' rejected.</p>'+(s.error?'<p role="alert">'+esc(s.error)+'</p>':'')+'<code>'+esc(s.digest)+'</code></section>';
 return '<div class="ic-grid">'+side(report.before,'Before')+side(report.after,'After')+'</div><p>'+esc(report.meaning)+'</p><p><strong>'+report.summary.original_occurrences+'</strong> original occurrences; '+report.summary.changed+' changed outcomes; '+report.summary.became_accepted+' became parsed; '+report.summary.became_rejected+' became rejected; '+report.summary.unavailable+' cannot be compared because a preparation is invalid.</p><p>Original source <code>'+esc(report.before.sourceSha)+'</code>. Saved comparison <code>'+esc(report.sha256)+'</code>.</p><details><summary>Every changed preparation field</summary><div class="ic-scroll"><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>'+mapping+'</tbody></table></div></details>'+
 '<div class="ic-actions"><label>Rows <select data-ic-filter><option value="all"'+(view.filter==='all'?' selected':'')+'>Every original occurrence</option><option value="changed"'+(view.filter==='changed'?' selected':'')+'>Changed outcomes</option><option value="rejected"'+(view.filter==='rejected'?' selected':'')+'>Rejected or unavailable in either revision</option></select></label><label>Find original or interpreted values<input data-ic-search value="'+esc(view.search||'')+'"></label><button type="button" data-ic-page="-1"'+(view.page===0?' disabled':'')+'>Previous rows</button><button type="button" data-ic-page="1"'+(view.page===max?' disabled':'')+'>Next rows</button><span>'+rows.length+' matching; page '+(view.page+1)+' of '+(max+1)+'</span></div>'+
 '<div class="ic-scroll"><table><thead><tr><th>Original position</th><th>Before</th><th>After</th><th>Full retained values</th></tr></thead><tbody>'+selected.map(r=>'<tr><th>'+r.line+'<br>'+esc(r.disposition.replaceAll('_',' '))+'</th><td>'+esc(sideText(r.before))+'</td><td>'+esc(sideText(r.after))+'</td><td><details><summary>Original row, both outcomes and every changed field</summary><pre>'+esc(pretty(r))+'</pre></details></td></tr>').join('')+'</tbody></table></div>';
}
const comparisonStyle='.intake-comparison{padding:1rem;border:1px solid #adb5bd;margin-top:1rem;color:#222;background:#fff}.intake-comparison *{box-sizing:border-box}.ic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.ic-actions{display:flex;gap:.7rem;align-items:end;flex-wrap:wrap;margin:1rem 0}.ic-actions label{display:grid;gap:.3rem;max-width:100%}.ic-scroll{overflow:auto;max-width:100%}.intake-comparison table{border-collapse:collapse;width:100%;text-align:left}.intake-comparison th,.intake-comparison td{padding:.55rem;border-bottom:1px solid #cbd1d6;vertical-align:top;overflow-wrap:anywhere}.intake-comparison code,.intake-comparison pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-size:.85rem}.intake-comparison pre{max-height:26rem;overflow:auto}.intake-comparison input,.intake-comparison select,.intake-comparison button{font:inherit;max-width:100%;padding:.45rem}.intake-comparison input[type=file]{width:100%}.intake-comparison [role=alert]{color:#444}@media(max-width:640px){.ic-grid{grid-template-columns:1fr}.ic-actions{align-items:stretch}.ic-actions label{width:100%}.intake-comparison{padding:.6rem}.intake-comparison td{min-width:8rem}}';
function reportDownloads(report){
 const base='interpretation-'+report.sha256.slice(0,12);
 return {base,original:report.project.sources.find(s=>s.sha===report.before.sourceSha)};
}
function offlineMain(){
 const report=JSON.parse(document.getElementById('comparison-source').textContent),view={filter:'all',page:0,search:''},root=document.getElementById('comparison-body');
 function render(){root.innerHTML=comparisonMarkup(report,view);}
 root.addEventListener('change',e=>{if(e.target.matches('[data-ic-filter]')){view.filter=e.target.value;view.page=0;render();}if(e.target.matches('[data-ic-search]')){view.search=e.target.value;view.page=0;render();}});
 root.addEventListener('click',e=>{const b=e.target.closest('[data-ic-page]');if(b){view.page+=Number(b.dataset.icPage);render();}});
 document.addEventListener('click',e=>{const action=e.target.closest('[data-export]')?.dataset.export;if(!action)return;const d=reportDownloads(report);if(action==='comparison')download(d.base+'.json',report);if(action==='preparation')download(d.base+'-complete-preparation.json',report.project);if(action==='original')download(report.before.sourceName,d.original.text,'text/plain;charset=utf-8');});
 render();
}
export function intakeComparisonHTML(report){
 const raw=pretty(report).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const script=[esc,pretty,download,sideText,selectedRows,comparisonMarkup,reportDownloads].map(f=>'const '+f.name+'='+f.toString()+';').join('\n')+'('+offlineMain.toString()+')();';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved measurement interpretation comparison</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:auto;max-width:1100px;padding:1rem}'+comparisonStyle+'</style><main class="intake-comparison"><h1>Saved measurement interpretation comparison</h1><p>This complete historical comparison imports no observations and contains every original preparation/source row. It is independent of any currently open project.</p><div class="ic-actions"><button data-export="comparison">Download complete comparison JSON</button><button data-export="preparation">Download complete preparation history</button><button data-export="original">Download unchanged original</button></div><div id="comparison-body"></div></main><script id="comparison-source" type="application/json">'+raw+'</script><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></html>';
}

export function mountIntakeComparison({api,context,protect,run,reviewCurrent,state={}}){
 const element=document.createElement('section');element.className='intake-comparison';
 state.view??={filter:'all',page:0,search:''};let dead=false,epoch=0;
 const signature=()=>JSON.stringify(context()),valid=(s,g)=>!dead&&signature()===s&&epoch===g;
 const notice=(text,error=false)=>{const p=element.querySelector('[data-ic-status]');if(p){p.textContent=text;p.setAttribute('role',error?'alert':'status');}};
 function render(){
  if(dead)return;const c=context(),project=state.history?.project,editions=project?.editions||[];
  const options=selection=>editions.map(e=>'<option value="'+e.revision+'"'+(String(e.revision)===String(selection)?' selected':'')+'>Revision '+e.revision+' · '+esc(e.value.label)+' · '+esc(e.value.reviewer)+'</option>').join('');
  element.innerHTML='<style>'+comparisonStyle+'</style><h3>Compare saved interpretations of this original file</h3><p>Select two immutable preparation revisions. No import or source-review decision is made here; unfinished controls stay in the original preparation.</p><div class="ic-actions"><button type="button" data-ic-action="history">Read saved preparation history</button><label>Open a complete saved comparison<input type="file" accept=".json" data-ic-open></label></div>'+
   (project?'<p>Preparation <code>'+esc(project.editions[0]?.id)+'</code> from <code>'+esc(project.workspaceId)+'</code></p><div class="ic-actions"><label>Before<select data-ic-before>'+options(state.before)+'</select></label><label>After<select data-ic-after>'+options(state.after)+'</select></label><button type="button" data-ic-action="compare">Compare complete original rows</button></div>':'')+
   '<p data-ic-status role="status"></p>'+
   (state.report?'<div class="ic-actions"><button type="button" data-ic-action="json">Download complete comparison</button><button type="button" data-ic-action="html">Download readable offline comparison</button><button type="button" data-ic-action="original">Download unchanged original</button><button type="button" data-ic-action="preparation">Download complete preparation history</button><button type="button" data-ic-action="review">Review this after revision in the original preparation</button></div><div data-ic-result>'+comparisonMarkup(state.report,state.view)+'</div>':'');
  if(state.report&&state.report.workspaceId!==c.workspaceId)notice('This is a retained comparison from a different original workspace. Downloads remain available; it will not replace the current preparation.');
 }
 element.addEventListener('change',e=>{
  if(e.target.matches('[data-ic-before]'))state.before=Number(e.target.value);
  if(e.target.matches('[data-ic-after]'))state.after=Number(e.target.value);
  if(e.target.matches('[data-ic-filter]')){state.view.filter=e.target.value;state.view.page=0;render();}
  if(e.target.matches('[data-ic-search]')){state.view.search=e.target.value;state.view.page=0;render();}
  if(e.target.matches('[data-ic-open]')){
   const file=e.target.files[0];if(!file)return;
   run(async()=>{await protect();const s=signature(),g=++epoch;
    if(file.size>128*1024*1024)throw Error('Keep the complete original file; this comparison exceeds the existing 128 MiB route.');
    const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    if(!valid(s,g))return;
    const candidate=JSON.parse(raw),report=await api('/intake/comparison-reopen','POST',candidate);
    if(!valid(s,g))return;state.report=report;state.view={filter:'all',page:0,search:''};render();notice('Complete original history, both interpretations and every outcome reopened through the unchanged native parser. No preparation or import was replaced.');
   });
  }
 });
 element.addEventListener('click',e=>{
  const page=e.target.closest('[data-ic-page]');if(page){e.preventDefault();state.view.page+=Number(page.dataset.icPage);render();return;}
  const button=e.target.closest('[data-ic-action]');if(!button)return;e.preventDefault();e.stopPropagation();const action=button.dataset.icAction;
  run(async()=>{
   if(['json','html','original','preparation'].includes(action)){
    if(!state.report)throw Error('Open or build the complete comparison first.');const d=reportDownloads(state.report);
    if(action==='json')download(d.base+'.json',state.report);
    if(action==='html')download(d.base+'.html',intakeComparisonHTML(state.report),'text/html;charset=utf-8');
    if(action==='original')download(state.report.before.sourceName,d.original.text,'text/plain;charset=utf-8');
    if(action==='preparation')download(d.base+'-preparation.json',state.report.project);return;
   }
   await protect();const s=signature(),g=++epoch,c=context();
   if(action==='history'){
    if(!c.id||!c.revision)throw Error('Save the original preparation before comparing saved revisions.');
    const h=await api('/intake/'+encodeURIComponent(c.id)+'/comparison-history');if(!valid(s,g))return;
    state.history=h;state.before=h.project.editions.at(-2)?.revision||h.project.editions[0]?.revision;state.after=h.project.editions.at(-1)?.revision;render();notice('Complete saved history loaded. Unfinished controls were retained separately.');
   }
   if(action==='compare'){
    const h=state.history;if(!h)throw Error('Read the saved preparation history first.');
    if(h.project.workspaceId!==c.workspaceId||h.project.editions[0]?.id!==c.id)throw Error('The selected preparation changed. Read its saved history explicitly.');
    const request={beforeRevision:state.before,afterRevision:state.after,expectedHistorySha:h.historySha};
    const report=await api('/intake/'+encodeURIComponent(c.id)+'/compare','POST',request);
    if(!valid(s,g))return;state.report=report;state.view={filter:'all',page:0,search:''};render();notice('Every original row compared. Review scientific meaning before using the original import controls.');
   }
   if(action==='review'){if(!state.report)throw Error('Build or reopen the complete comparison first.');await reviewCurrent(state.report);}
  });
 });
 render();return {element,state,destroy(){dead=true;epoch++;}};
}
