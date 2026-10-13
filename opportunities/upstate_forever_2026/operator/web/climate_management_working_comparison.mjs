/** Compare exact retained Management drafts without replacing or validating the editor. */
const copy=x=>structuredClone(x);
const stable=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(stable(x[k]))])):x);
const same=(a,b)=>stable(a)===stable(b);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(name,label,attrs='')=>'<button type="button" data-cm="designcompare-'+name+'" '+attrs+'>'+esc(label)+'</button>';
const opt=(id,label,selected)=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(label)+'</option>';
const display=(value,present=true)=>!present?'(absent)':value===''?'(blank text)':typeof value==='string'?value:JSON.stringify(value,null,2);
export const DESIGN_COMPARE_ACTION='climate-management.working.compare';
export const DESIGN_COMPARE_KIND='climate-management-working-comparisons';
export function createManagementDesignComparison(host){
  let selection={before_revision_id:'',after_revision_id:'',title:'Saved Management design comparison'};
  let revisions=[],reports=[],preview=null,report=null,selectedId='',version=0,activeRead=null;
  function snapshot(){return {selection:copy(selection),selectedId};}
  function clear(){selection={before_revision_id:'',after_revision_id:'',title:'Saved Management design comparison'};revisions=[];reports=[];preview=null;report=null;selectedId='';activeRead=null;version++;}
  function restore(value){
    clear();if(!value)return;
    if(!value.selection||!['before_revision_id','after_revision_id','title'].every(k=>typeof value.selection[k]==='string'))throw Error('The saved-design comparison controls are incomplete.');
    selection=copy(value.selection);selectedId=typeof value.selectedId==='string'?value.selectedId:'';
  }
  function catalogue(value){revisions=value.working_comparison_revisions||[];reports=value.working_comparisons||[];}
  function changed(el){
    if(el.matches('[data-designcompare-field]')){
      selection[el.dataset.designcompareField]=el.value;preview=null;report=null;selectedId='';version++;host.persist();return true;
    }
    if(el.matches('[data-designcompare-saved]')){selectedId=el.value;version++;host.persist();return true;}
    return false;
  }
  function rowsMarkup(result){
    return '<p>'+esc(result.changed_design_fields)+' changed design fields. All original values remain in the complete report.</p>'+
      '<p>Periods aligned by '+esc(result.alignment.periods)+'; reporting areas by '+esc(result.alignment.reporting_areas)+'.</p>'+
      '<div class="cm-table"><table><thead><tr><th>Group / field</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>'+
      result.rows.map(row=>'<tr><th scope="row">'+esc(row.group)+'<br>'+esc(row.field)+'</th><td><pre>'+esc(display(row.before,row.before_present))+'</pre></td><td><pre>'+esc(display(row.after,row.after_present))+'</pre></td><td>'+esc(row.change)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function markup(){
    const options=id=>opt('','Choose an exact saved revision',id)+revisions.map(r=>opt(r.id,r.name+' · revision '+r.revision+' · '+r.author+' · '+r.id.slice(0,12),id)).join('')+
      (id&&!revisions.some(r=>r.id===id)?opt(id,'Original revision '+id,id):'');
    const selected=report?.result||preview;
    return '<section data-design-comparison><h2>Compare saved working designs</h2><p>Review authored choices between two original revisions, including unfinished designs and explicit branches. This does not calculate a scientific effect or replace your current draft.</p>'+
      '<div class="cm-columns"><label>Before revision<select data-designcompare-field="before_revision_id">'+options(selection.before_revision_id)+'</select></label>'+
      '<label>After revision<select data-designcompare-field="after_revision_id">'+options(selection.after_revision_id)+'</select></label></div>'+
      '<label>Design comparison title<input data-designcompare-field="title" value="'+esc(selection.title)+'"></label>'+
      '<div class="cm-actions">'+btn('preview','Preview saved-design changes')+(preview?btn('build','Save readable design handover'):'')+'</div>'+
      '<details><summary>Open a retained design comparison</summary><label>Saved design comparison<select data-designcompare-saved>'+opt('','Choose a retained handover',selectedId)+reports.map(r=>opt(r.id,r.title,selectedId)).join('')+'</select></label>'+btn('open','Open saved design comparison')+'</details>'+
      (selected?'<h3>'+esc(selected.title)+'</h3><p>'+esc(selected.scope)+'</p>'+
      '<div class="cm-columns"><p><strong>Before:</strong> '+esc(selected.before.name)+' · '+esc(selected.before.author)+' · revision '+esc(selected.before.revision)+'<small>'+esc(selected.before.id)+'</small></p>'+
      '<p><strong>After:</strong> '+esc(selected.after.name)+' · '+esc(selected.after.author)+' · revision '+esc(selected.after.revision)+'<small>'+esc(selected.after.id)+'</small></p></div>'+rowsMarkup(selected):'')+
      (report?'<h3>Complete readable handover</h3><ul>'+ (report._downloads||[]).map(d=>'<li><a href="'+esc(d.url)+'" download>'+esc(d.filename||d.name||d.artifact_id||'Original file')+'</a></li>').join('')+'</ul>'+
        btn('study','Export editable comparison Study')+'<p>The ZIP contains both exact JSON histories and all readable files. The selected Study also carries their original source and native dependencies.</p>':'')+'</section>';
  }
  async function open(id,{replaceSelection=true}={}){
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Select an exact retained design comparison.');
    const token=host.token(),v=++version,intent={v};activeRead=intent;
    try{
      const value=await host.read('working-comparison',{id});
      if(!host.current(token))return null;
      if(v!==version)throw Error('Comparison choices changed while the saved handover was opening; open it again.');
      if(value?.id!==id||value.workspace_key!==host.workspace()||value.workspace_id!==host.projectId()||
         value.identity?.selection?.before_revision_id!==value.result?.before?.id||
         value.identity?.selection?.after_revision_id!==value.result?.after?.id)throw Error('The operator returned a different saved-design comparison.');
      report=value;preview=null;selectedId=id;if(replaceSelection)selection=copy(value.identity.selection);
      host.persist();host.render();return value;
    }finally{if(activeRead===intent)activeRead=null;}
  }
  async function refresh(){if(!activeRead&&selectedId)return open(selectedId,{replaceSelection:false});}
  function settle(task){
    if(task.action!==DESIGN_COMPARE_ACTION||task.state!=='complete')return false;
    const value=task.result;
    if(task.workspace!==host.workspace()||value?.workspace_id!==host.projectId()||
       value?.preview_id!==task.payload?.expected_id||!same(value.identity?.selection,task.payload?.selection)||!value.id)
      throw Error('The saved handover differs from its original comparison request.');
    if(activeRead||!same(selection,task.payload.selection))return true;
    version++;selectedId=value.id;report=null;preview=null;return true;
  }
  async function action(name){
    if(!name.startsWith('designcompare-'))return false;
    name=name.slice(14);
    if(name==='preview'){
      const token=host.token(),original=copy(selection);
      if(!original.title.trim()||![original.before_revision_id,original.after_revision_id].every(x=>/^[0-9a-f]{64}$/.test(x)))throw Error('Choose two saved revisions and a comparison title.');
      const v=++version,intent={v};activeRead=intent;selectedId='';report=null;preview=null;host.persist();
      try{
        const value=await host.preview(original);
        if(!host.current(token))return true;
        if(v!==version)throw Error('The saved-design choices changed during preview; preview them again.');
        if(value.workspace_id!==host.projectId()||!same(value.selection,original)||!value.id)throw Error('The preview differs from the selected original revisions.');
        preview=value;report=null;selectedId='';host.persist();host.render();
      }finally{if(activeRead===intent)activeRead=null;}
    }else if(name==='build'){
      if(!preview||!same(preview.selection,selection))throw Error('Preview these exact saved revisions before retaining their handover.');
      await host.submit(DESIGN_COMPARE_ACTION,{selection:copy(preview.selection),expected_id:preview.id});
    }else if(name==='open')await open(selectedId);
    else if(name==='study'){
      if(!report)throw Error('Open a saved design comparison.');
      await host.openStudy({kind:DESIGN_COMPARE_KIND,id:report.id,title:report.result.title,state:'complete'});
    }else throw Error('Choose a saved-design comparison action.');
    return true;
  }
  return {snapshot,restore,clear,catalogue,changed,markup,refresh,settle,action,open};
}
