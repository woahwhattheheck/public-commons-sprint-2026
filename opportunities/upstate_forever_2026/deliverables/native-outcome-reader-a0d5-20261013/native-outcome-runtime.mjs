function outcomeRuntime(){
 'use strict';
 const $=id=>document.getElementById(id);
 const view=JSON.parse($('view-data').textContent),packed=JSON.parse($('packet-data').textContent);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=x=>x==null?'Undefined':typeof x==='number'?x.toLocaleString('en-US',x!==0&&Math.abs(x)<0.01?{maximumSignificantDigits:4}:{maximumFractionDigits:2}):String(x);
 const num=x=>'<td class="num" title="'+esc(x==null?'Undefined':String(x))+'">'+esc(number(x))+'</td>';
 const txt=x=>'<td>'+esc(x)+'</td>',short=x=>x?x.slice(0,12)+'…':'Not retained';
 const kinds={selections:'Each completed native run retains its own annual raster total and valid-cell count. These are individual results, not paired changes.',landcover:'Alternative minus baseline, with the same parameter profile and exact shared valid cells. Negative means lower predicted export.',parameter:'Varied profile minus the original reference profile, with land cover held fixed. This is separate from land-cover change.',joint:'Original decision quantities on the common valid cells across baseline and every alternative. Export change is alternative minus baseline; avoided export is baseline minus alternative. These are distinct from pairwise masks.',ranges:'Original descriptive ranges across retained parameter cases, grouped by scenario, quantity, units and exact shared-cell mask. No confidence interval is inferred.',timings:'Original first completion is separate from later reuse or continuation timing. No new elapsed total is calculated.'};
 const rows={selections:view.selections.flatMap(s=>s.totals.map(t=>({source:{...s,totals:[t]},...s,...t}))),landcover:view.landcover.map(x=>({source:x.original,...x.original})),parameter:view.parameter.map(x=>({source:x.original,...x.original})),joint:(view.joint?.rows||[]).map(x=>({...x,source:{...x.original,report_ids:x.report_ids}})),ranges:view.support_groups.map(x=>({source:x.original,...x})),timings:view.stages.map(x=>({source:x,...x}))};
 let current=[],selectedRecord=null,lastRecordButton=null;
 const comparisonLabel=r=>'<td class="comparison-label"><strong>'+esc(r.scenario_label||r.scenario_id)+'</strong><span>'+esc(r.pollutant.replace('_export',''))+' · '+esc(r.member_label||r.member_id)+'</span></td>';
 function restoreComparison(){const table=$('body').closest('.scroll');if(table)table.scrollLeft=0;if(lastRecordButton?.isConnected)lastRecordButton.focus({preventScroll:true});}
 function options(id,list,key,label){const seen=new Map();for(const r of list)if(r[key])seen.set(r[key],r[label]||r[key]);$(id).innerHTML='<option value="">All</option>'+[...seen].map(([k,v])=>'<option value="'+esc(k)+'">'+esc(v)+'</option>').join('');}
 options('member',view.selections,'member_id','member_label');options('scenario',view.selections,'scenario_id','scenario_label');
 $('summary').innerHTML='<div><strong>'+view.selections.length+'</strong><span>completed native selections</span></div><div><strong>'+new Set(view.selections.map(x=>x.member_id)).size+'</strong><span>retained parameter members</span></div><div><strong>'+view.landcover.length+'</strong><span>land-cover quantity contrasts</span></div><div><strong>'+view.parameter.length+'</strong><span>parameter quantity contrasts</span></div>';
 $('links').innerHTML=view.links.filter(x=>/^https:\/\//.test(x.url)).map(x=>'<a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'+esc(x.title)+'</a>').join('');
 $('profiles').textContent=JSON.stringify(view.original_plan.members.map(m=>({id:m.id,label:m.label,profile_id:m.profile_id,parameters:m.parameters,assignments:m.assignments,scientific_status:m.scientific_status,references:m.references})),null,2);
 $('identity').textContent=JSON.stringify({identity:view.identity,classification:view.classification,input_summary:view.input_summary,source_paths:view.source_paths},null,2);
 $('packetIdentity').textContent='Original packet: '+packed.bytes.toLocaleString('en-US')+' bytes · SHA256 '+packed.sha256;
 function draw(){
  const kind=$('kind').value,m=$('member').value,s=$('scenario').value,q=$('quantity').value;
  $('member').disabled=kind==='ranges'||kind==='timings';$('scenario').disabled=kind==='timings';$('quantity').disabled=kind==='timings';
  current=rows[kind].filter(r=>(!m||kind==='ranges'||kind==='timings'||r.member_id===m)&&(!s||kind==='timings'||r.scenario_id===s)&&(!q||kind==='timings'||r.pollutant===q));
  $('meaning').textContent=kind==='joint'&&view.joint?.state!=='retained'?'The joint decision reports were not retained in this reading. Pairwise rows cannot substitute for their all-alternative support. Use the complete original course and support-group reports when available.':kinds[kind];$('count').textContent=current.length+' original row'+(current.length===1?'':'s')+' displayed';
  const headers=kind==='selections'?['Member / scenario','Quantity','Original total','Units','Valid cells','Original run','Details']:kind==='landcover'||kind==='parameter'?['Scenario / quantity',kind==='parameter'?'Reference':'Baseline',kind==='parameter'?'Varied':'Alternative','Annual change','Change %','Units','Details']:kind==='joint'?['Member / scenario','Quantity','Baseline shared mass','Alternative shared mass','Export change','Avoided export','Avoided export %','Units','Shared cells','Exact joint mask','Details']:kind==='ranges'?['Scenario','Quantity','Members','Minimum change','Maximum change','Units','Direction','Shared cells','Pair masks identical','Exact support mask','Details']:['Operation stage','State','First completion','First elapsed seconds','Last elapsed seconds','Completed visits','Details'];
  $('head').innerHTML='<tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr>';$('caption').textContent=$('kind').selectedOptions[0].textContent;
  $('body').innerHTML=current.map((r,i)=>{
   let cells='';
   if(kind==='selections')cells=txt(r.member_label+' / '+r.scenario_label)+txt(r.quantity)+num(r.value)+txt(r.units)+num(r.valid_cells)+txt(short(r.run_id));
   else if(kind==='landcover'||kind==='parameter')cells=comparisonLabel(r)+num(r.baseline_common)+num(r.alternative_common)+num(r.delta_common)+num(r.percent_change)+txt(r.total_units);
   else if(kind==='joint')cells=txt((r.member_label||r.member_id)+' / '+r.scenario_label)+txt(r.quantity)+num(r.baseline)+num(r.alternative)+num(r.delta)+num(r.reduction)+num(r.reduction_percent)+txt(r.units)+num(r.common_cells)+txt(short(r.support_id));
   else if(kind==='ranges')cells=txt(r.scenario_label||r.scenario_id)+txt(r.pollutant.replace('_export',''))+num(r.members)+num(r.minimum_delta)+num(r.maximum_delta)+txt(r.total_units)+txt(r.direction)+num(r.common_cells)+txt(r.coverage_complete===null?'Not retained':r.coverage_complete?'Yes':'No')+txt(short(r.common_support_sha256));
   else cells=txt(r.name)+txt(r.state)+txt(r.first_completed_at||'Not retained')+num(r.first_elapsed_seconds)+num(r.last_elapsed_seconds)+num(r.completed_visits);
   return '<tr>'+cells+'<td><button data-record="'+i+'">Inspect original</button></td></tr>';
  }).join('')||'<tr><td colspan="'+headers.length+'">No original rows match these selections.</td></tr>';
  $('record').hidden=true;selectedRecord=null;lastRecordButton=null;
 }
 function download(name,body,type='application/json'){const blob=body instanceof Blob?body:new Blob([body],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function jsonDownload(name,body){download(name,JSON.stringify(body,null,2)+'\n');}
 for(const id of ['kind','member','scenario','quantity'])$(id).addEventListener('change',draw);
 $('body').addEventListener('click',e=>{const b=e.target.closest('[data-record]');if(!b)return;lastRecordButton=b;selectedRecord=current[Number(b.dataset.record)].source;$('recordText').textContent=JSON.stringify(selectedRecord,null,2);$('record').hidden=false;const table=b.closest('.scroll');if(table)table.scrollLeft=0;$('record').scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});});
 $('closeRecord').onclick=()=>{$('record').hidden=true;selectedRecord=null;restoreComparison();};
 $('exportRecord').onclick=()=>{if(selectedRecord)jsonDownload('original-native-record.json',{packet:view.packet,record:selectedRecord});};
 $('exportRows').onclick=()=>jsonDownload('original-native-'+$('kind').value+'.json',{schema:'upstate.native-outcome-selection/v1',packet:view.packet,identity:view.identity,view:$('kind').value,filters:{member:$('member').disabled?null:$('member').value||null,scenario:$('scenario').disabled?null:$('scenario').value||null,quantity:$('quantity').disabled?null:$('quantity').value||null},rows:current.map(r=>r.source)});
 $('downloadView').onclick=()=>jsonDownload('native-outcome-reading.json',view);
 $('reset').onclick=()=>{for(const id of ['member','scenario','quantity'])$(id).value='';$('kind').value='selections';draw();};
 $('print').onclick=()=>window.print();
 $('downloadPacket').onclick=async()=>{
  const button=$('downloadPacket');button.disabled=true;$('status').textContent='Checking the complete original packet…';
  try{
   if(typeof DecompressionStream!=='function')throw Error('This browser does not support the original gzip download. Use a current Chromium, Firefox or Safari browser.');
   const compressed=Uint8Array.from(atob(packed.data),c=>c.charCodeAt(0));
   const bytes=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
   if(bytes.length!==packed.bytes)throw Error('Original packet byte count differs.');
   const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(actual!==packed.sha256)throw Error('Original packet digest differs.');
   download('completed-native-consumer-packet.json',new Blob([bytes],{type:'application/json'}));$('status').textContent='Complete original packet verified and downloaded.';
  }catch(error){$('status').textContent=error.message;}finally{button.disabled=false;}
 };
 draw();
}
export {outcomeRuntime};
