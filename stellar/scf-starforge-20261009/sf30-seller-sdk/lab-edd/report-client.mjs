// MIT. Offline industrial review editor carried with the complete native EDD result.
export function labReviewEditor() {
  const data=JSON.parse(document.getElementById('review-data').textContent);
  const byId=new Map(),allRows=[];
  for(const table of data.tables)for(const row of table.rows){const item={table,row};byId.set(row.recordId,item);allRows.push(item);}
  const choices=new Map(data.document.decisions.map(choice=>[JSON.stringify([choice.recordId,choice.field]),choice]));
  let page=0,issuePage=0,selected=null,active='records',changed=false;
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const key=(id,field)=>JSON.stringify([id,field]);
  const currentDocument=()=>({schema:data.document.schema,sourceSha256:data.source.sourceSha256,profile:data.source.profile,
    decisions:[...choices.values()].sort((a,b)=>a.recordId.localeCompare(b.recordId)||a.field.localeCompare(b.field))});
  function status(message){$('status').textContent=message;}
  function download(filename,text,type='application/json'){
    const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');
    link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  function matches(){
    const query=$('search').value.toLowerCase(),section=$('section').value;
    return allRows.filter(({table,row})=>(!section||table.id===section)&&(!query||
      table.filename.toLowerCase().includes(query)||row.fields.some(value=>value.toLowerCase().includes(query))));
  }
  function renderRows(){
    const rows=matches(),limit=75,choiceCounts=new Map();
    for(const choice of choices.values())choiceCounts.set(choice.recordId,(choiceCounts.get(choice.recordId)??0)+1);page=Math.min(page,Math.max(0,Math.ceil(rows.length/limit)-1));
    $('row-count').textContent=rows.length+' matching original records';
    $('page-info').textContent=rows.length?'Rows '+(page*limit+1)+'–'+Math.min(rows.length,(page+1)*limit)+' of '+rows.length:'No matching records';
    $('previous').disabled=page===0;$('next').disabled=(page+1)*limit>=rows.length;
    $('records-body').innerHTML=rows.slice(page*limit,(page+1)*limit).map(({table,row})=>{
      const identity=row.values.sys_sample_code??row.values.sampleid??row.values.sample_id??row.fields[0]??'';
      const analyte=row.values.chemical_name??row.values.paramname??row.values.parameter??row.values.cas_rn??'';
      const result=row.values.result_value??row.values.result??'';
      const unit=row.values.result_unit??row.values.resultunits??row.values.units??'';
      const count=choiceCounts.get(row.recordId)??0;
      return '<tr><td><button class="row-open" data-row="'+esc(row.recordId)+'">'+esc(identity||'Row '+row.rowNumber)+'</button></td><td>'+esc(table.id)+'</td><td>'+esc(analyte)+'</td><td>'+esc(result)+'</td><td>'+esc(unit)+'</td><td>'+row.rowNumber+'</td><td>'+count+'</td></tr>';
    }).join('');
    for(const button of document.querySelectorAll('.row-open'))button.onclick=()=>openRow(button.dataset.row);
  }
  function renderChanges(){
    const items=[...choices.values()];
    $('decision-count').textContent=items.length+' explicit field decisions'+(changed?' · draft differs from the computed result':'');
    $('changes-body').innerHTML=items.map(choice=>{
      const item=byId.get(choice.recordId);
      return '<tr><td>'+esc(item.table.filename)+' : '+item.row.rowNumber+'</td><td>'+esc(choice.field)+'</td><td>'+esc(choice.before)+'</td><td>'+esc(choice.action)+'</td><td>'+esc(choice.action==='set'?choice.value:choice.action==='clear'?'':choice.before)+'</td><td>'+esc(choice.reason)+'</td><td><button class="remove-choice" data-id="'+esc(choice.recordId)+'" data-field="'+esc(choice.field)+'">Remove decision</button></td></tr>';
    }).join('');
    for(const button of document.querySelectorAll('.remove-choice'))button.onclick=()=>{
      choices.delete(key(button.dataset.id,button.dataset.field));changed=true;renderChanges();renderRows();if(selected)openRow(selected);
    };
  }
  function openRow(id){
    selected=id;const {table,row}=byId.get(id);
    $('detail').hidden=false;$('detail-title').textContent=table.filename+' · '+table.id+' · original row '+row.rowNumber;
    $('detail-identity').textContent=row.recordId+' / '+row.rowSha256;
    $('fields-body').innerHTML=table.keys.map((field,index)=>{
      const choice=choices.get(key(id,field)),value=choice?.action==='set'?choice.value:choice?.action==='clear'?'':row.fields[index];
      const cells=row.cells?.[index];
      return '<tr><td>'+esc(table.headers[index])+'<small>'+esc(field)+'</small></td><td class="original-cell">'+esc(row.fields[index])+
        (cells?'<details><summary>Original cell representation</summary><pre>'+esc(JSON.stringify(cells,null,2))+'</pre></details>':'')+
        '</td><td><select class="action" data-field="'+esc(field)+'"><option value="keep"'+(!choice||choice.action==='keep'?' selected':'')+'>Keep</option><option value="set"'+(choice?.action==='set'?' selected':'')+'>Set exact value</option><option value="clear"'+(choice?.action==='clear'?' selected':'')+'>Clear</option></select></td>'+
        '<td><textarea class="replacement" data-field="'+esc(field)+'" rows="2"'+(choice?.action!=='set'?' disabled':'')+'>'+esc(value)+'</textarea></td>'+
        '<td><textarea class="reason" data-field="'+esc(field)+'" rows="2" placeholder="Reason for this decision">'+esc(choice?.reason??'')+'</textarea></td>'+
        '<td><button class="apply-choice" data-field="'+esc(field)+'">Apply to draft</button></td></tr>';
    }).join('');
    const fieldControl=(className,field)=>[...document.querySelectorAll('.'+className)].find(element=>element.dataset.field===field);
    for(const select of document.querySelectorAll('.action'))select.onchange=()=>{
      const replacement=fieldControl('replacement',select.dataset.field);replacement.disabled=select.value!=='set';
      if(select.value==='clear')replacement.value='';
      if(select.value==='keep')replacement.value=row.values[select.dataset.field];
    };
    for(const button of document.querySelectorAll('.apply-choice'))button.onclick=()=>{
      const field=button.dataset.field,action=fieldControl('action',field).value,value=fieldControl('replacement',field).value,reason=fieldControl('reason',field).value;
      if(action!=='keep'&&!reason.trim()){status('Add a reason before changing this original field.');return;}
      const choice={recordId:id,rowSha256:row.rowSha256,field,before:row.values[field],action,...(action==='set'?{value}:{}),reason};
      if(action==='keep'&&!reason)choices.delete(key(id,field));else choices.set(key(id,field),choice);
      changed=true;renderChanges();renderRows();status('Draft updated. Download its complete decision file and run the original receiver to compute the next native result.');
    };
    $('detail').scrollIntoView({block:'start',behavior:'smooth'});
  }
  function renderIssues(){
    const severity=$('severity').value,issues=data.report.issues.filter(issue=>!severity||issue.severity===severity);
    const limit=75;issuePage=Math.min(issuePage,Math.max(0,Math.ceil(issues.length/limit)-1));
    $('issue-count').textContent=issues.length+' profile observations';
    $('issue-page-info').textContent=issues.length?'Observations '+(issuePage*limit+1)+'–'+Math.min(issues.length,(issuePage+1)*limit)+' of '+issues.length:'No matching observations';
    $('issue-previous').disabled=issuePage===0;$('issue-next').disabled=(issuePage+1)*limit>=issues.length;
    $('issues-body').innerHTML=issues.slice(issuePage*limit,(issuePage+1)*limit).map(issue=>'<tr><td>'+esc(issue.severity)+'</td><td>'+esc(issue.code)+'</td><td>'+esc(issue.message)+
      (issue.details?'<details><summary>Reported details</summary><pre>'+esc(JSON.stringify(issue.details,null,2))+'</pre></details>':'')+'</td><td>'+
      issue.targets.map(target=>{const item=byId.get(target.recordId);return '<button class="issue-row" data-row="'+esc(target.recordId)+'">'+esc(item.table.filename+' : '+item.row.rowNumber+(target.field?' / '+target.field:''))+'</button>';}).join(' ')+
      '</td><td>'+(issue.reference?'<a href="'+esc(issue.reference)+'" target="_blank" rel="noopener">Format source</a>':'')+'</td></tr>').join('');
    for(const button of document.querySelectorAll('.issue-row'))button.onclick=()=>{show('records');openRow(button.dataset.row);};
  }
  function show(name){active=name;$('detail').hidden=name!=='records'||!selected;for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==name;
    for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===name));}
  for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>show(button.dataset.tab);
  $('section').innerHTML='<option value="">Every source section</option>'+[...new Set(data.tables.map(table=>table.id))].map(id=>'<option>'+esc(id)+'</option>').join('');
  $('search').oninput=$('section').onchange=()=>{page=0;renderRows();};
  $('previous').onclick=()=>{page--;renderRows();};$('next').onclick=()=>{page++;renderRows();};
  $('severity').onchange=()=>{issuePage=0;renderIssues();};
  $('issue-previous').onclick=()=>{issuePage--;renderIssues();};$('issue-next').onclick=()=>{issuePage++;renderIssues();};
  $('close-detail').onclick=()=>{$('detail').hidden=true;selected=null;};
  $('download-json').onclick=()=>download('lab-edd-decisions.json',JSON.stringify(currentDocument(),null,2)+'\n');
  $('download-csv').onclick=()=>{
    const columns=['kind','source_sha256','profile_id','profile_version','record_id','row_sha256','filename','section','row','field','before','action','value','reason'];
    const rows=[columns,['source',data.source.sourceSha256,data.source.profile.id,data.source.profile.version,'','','','','','','','','','']];
    for(const choice of currentDocument().decisions){const {table,row}=byId.get(choice.recordId);rows.push(['cell','','','',choice.recordId,choice.rowSha256,table.filename,table.id,String(row.rowNumber),choice.field,choice.before,choice.action,choice.action==='set'?choice.value:'',choice.reason]);}
    const quote=value=>/[",\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
    download('lab-edd-decisions.csv',rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n','text/csv');
  };
  $('load-json').onchange=async event=>{
    try{
      const file=event.target.files[0];if(!file)return;if(file.size>4194304)throw Error('The decision file exceeds 4 MiB.');
      const doc=JSON.parse(await file.text());
      if(doc.schema!==data.document.schema||doc.sourceSha256!==data.source.sourceSha256||
        doc.profile?.id!==data.source.profile.id||doc.profile?.version!==data.source.profile.version||
        !Array.isArray(doc.decisions)||Object.keys(doc).some(key=>!['schema','sourceSha256','profile','decisions'].includes(key)))
        throw Error('This decision file belongs to a different source edition or profile.');
      const next=new Map();
      for(const choice of doc.decisions){
        const item=byId.get(choice.recordId),choiceKey=key(choice.recordId,choice.field);
        if(!item||choice.rowSha256!==item.row.rowSha256||!item.table.keys.includes(choice.field)||choice.before!==item.row.values[choice.field]||
          !['keep','set','clear'].includes(choice.action)||typeof choice.reason!=='string'||choice.action!=='keep'&&!choice.reason.trim()||
          (choice.action==='set'?typeof choice.value!=='string':Object.hasOwn(choice,'value'))||next.has(choiceKey)||
          Object.keys(choice).some(key=>!['recordId','rowSha256','field','before','action','value','reason'].includes(key)))
          throw Error('A decision does not match its exact original row and value.');
        next.set(choiceKey,choice);
      }
      choices.clear();for(const [id,choice]of next)choices.set(id,choice);changed=true;
      renderChanges();renderRows();if(selected)openRow(selected);status('The complete saved decision file is open against its original source rows.');
    }catch(error){status(error.message);}finally{event.target.value='';}
  };
  $('lineage').textContent=JSON.stringify(data.report.lineage,null,2);
  $('comparison').textContent=data.comparison?JSON.stringify(data.comparison,null,2):'No earlier delivery was selected for this result.';
  renderRows();renderIssues();renderChanges();show(active);
}
