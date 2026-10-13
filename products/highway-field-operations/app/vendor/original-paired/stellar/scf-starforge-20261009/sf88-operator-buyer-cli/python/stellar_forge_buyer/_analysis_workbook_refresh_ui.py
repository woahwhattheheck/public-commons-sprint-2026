"""Recurring workbook source review within the original workbook editor."""

HTML = r'''
<section id="workbook-edition-panel" class="panel" hidden>
  <div class="section-head"><div><h2>Review a new workbook edition</h2><p id="workbook-edition-context"></p></div><button id="workbook-edition-discard">Return to saved definition</button></div>
  <p>Choose a newer complete result for each worksheet you want to update. Review its recorded SQL, parameters and sources, then reconcile the columns in the worksheet editor above. Other worksheets keep their saved results.</p>
  <div class="form-row"><label>Worksheet<select id="workbook-edition-sheet"></select></label><button id="workbook-edition-find">Find newer complete results</button><button id="workbook-edition-keep">Keep original source and columns</button></div>
  <p id="workbook-edition-page" class="muted"></p>
  <div class="toolbar"><button id="workbook-edition-prev">Newer results</button><button id="workbook-edition-next">Older results</button></div>
  <div id="workbook-edition-candidates"></div>
  <label>Edition note<textarea id="workbook-edition-reason" maxlength="8000" rows="3" placeholder="Reporting period, selected results and column changes"></textarea></label>
  <div class="toolbar"><button id="workbook-edition-review">Review selected sources and cells</button></div>
  <p id="workbook-edition-review-status" role="status"></p>
  <div id="workbook-edition-review-output"></div>
  <p class="hint">The cell review shows up to 20 rows per worksheet. Building the complete workbook applies the reviewed column types to every row. Each edition retains its source changes and earlier definition in the handoff.</p>
</section>
'''

JS = r'''
  const edition={catalog:null,sheet:0,before:null,pages:[],review:null,reviewKey:null};
  function editionRequest(){
    if(!w.edition)throw Error('Open a saved workbook before reviewing a new edition.');
    return {base_revision:w.edition.base_revision,definition_sha256:w.edition.definition_sha256,
      expected_revision:w.edition.expected_revision,reason:w.edition.reason,definition:value()};
  }
  function editionReady(){
    return !!(w.edition&&edition.review?.ready&&edition.reviewKey===JSON.stringify(editionRequest()));
  }
  function editionRender(){
    const enabled=!!w.edition;
    $('workbook-edition-panel').hidden=!enabled;
    if(!enabled)return;
    $('workbook-edition-context').textContent='Based on '+w.loaded.definition.name+' revision '+w.edition.base_revision+
      '; save compares with current revision '+w.edition.expected_revision+'. Earlier definitions and deliveries remain available.';
    const select=$('workbook-edition-sheet');
    select.replaceChildren();
    w.editor.sheets.forEach((sheet,index)=>{
      const prior=w.loaded.definition.sheets[index].source;
      const changedSource=JSON.stringify(prior)!==JSON.stringify(sheet.source);
      const option=node('option',sheet.name+(changedSource?' · replacement selected':' · original result'));
      option.value=index;select.append(option);
    });
    select.value=String(edition.sheet);
    $('workbook-edition-reason').value=w.edition.reason;
    $('workbook-edition-review-status').textContent=editionReady()?
      'Source and cell review is ready. Save workbook definition to create the new edition.':
      edition.review?'The selection or column mapping changed. Review the current edition before saving.':
      'Select at least one newer result, resolve its columns and enter an edition note.';
  }
  function editionControls(){
    const unavailable=s.busy||!s.data;
    $('workbook-edition-open').disabled=unavailable||!w.loaded||changed();
    for(const name of ['workbook-edition-discard','workbook-edition-sheet','workbook-edition-find',
      'workbook-edition-keep','workbook-edition-reason','workbook-edition-review'])$(name).disabled=unavailable;
    $('workbook-edition-prev').disabled=unavailable||!edition.pages.length;
    $('workbook-edition-next').disabled=unavailable||!edition.catalog?.next_before;
    if(w.edition){
      $('workbook-save').disabled||=!editionReady();
      $('workbook-add').disabled=true;
      $('workbook-name').disabled=true;
      for(const element of document.querySelectorAll('#workbook-sheets .section-head button'))element.disabled=true;
      for(const element of document.querySelectorAll('#workbook-edition-candidates button'))element.disabled=unavailable;
    }
    editionRender();
  }
  async function editionOpen(){
    if(!w.loaded||changed())throw Error('Open a saved definition with no unsaved changes.');
    w.edition={base_revision:w.loaded.definition.revision,definition_sha256:w.loaded.definition_sha256,
      expected_revision:w.loaded.head_revision,reason:''};
    w.savePending=null;edition.sheet=0;edition.review=null;edition.reviewKey=null;
    $('workbook-edition-review-output').replaceChildren();
    remember();await editionFind();
    $('workbook-edition-panel').scrollIntoView({block:'start'});
  }
  async function editionFind(before=null,pages=[]){
    if(!w.edition)return;
    const index=Number($('workbook-edition-sheet').value||edition.sheet||0);
    edition.sheet=index;
    edition.catalog=await api('/api/workbooks/'+encodeURIComponent(w.loaded.definition.name)+'/refresh?revision='+
      w.edition.base_revision+'&sheet='+index+(before?'&before='+before:''));
    edition.before=before;edition.pages=pages;
    const parent=$('workbook-edition-candidates');parent.replaceChildren();
    for(const candidate of edition.catalog.items){
      const comparison=candidate.comparison,box=node('section',undefined,'workbook-sheet');
      const heading=node('div',undefined,'section-head');
      heading.append(node('h3',candidate.source.label),button('Use this complete result',()=>{
        const sheet=w.editor.sheets[index];
        sheet.source=clone(candidate.source);sheet.columns=clone(candidate.suggested_columns);
        edition.review=null;edition.reviewKey=null;renderSheets();remember();controls();
        message(candidate.unresolved_columns.length?
          'Replacement selected. Choose source columns for '+candidate.unresolved_columns.length+' unresolved Excel columns above.':
          'Replacement selected. Review the source changes and column types before saving.');
        $('workbook-sheets').scrollIntoView({block:'start'});
      }));
      box.append(heading,node('p',candidate.match_basis+' · '+comparison.rows_before+' → '+comparison.rows_after+' rows'));
      box.append(node('p','Columns: '+comparison.columns_before.join(', ')+' → '+comparison.columns_after.join(', ')));
      const changes=[];
      if(comparison.sql_changed)changes.push('SQL changed');
      if(comparison.parameters_changed)changes.push('parameters changed');
      if(comparison.views_changed)changes.push('view bindings changed');
      if(comparison.source_versions_changed)changes.push('source editions changed');
      if(comparison.section_moved)changes.push('report section moved');
      box.append(node('p',changes.length?changes.join(' · '):'The recorded SQL, parameters and source bindings are unchanged.'));
      if(candidate.unresolved_columns.length)box.append(node('p',candidate.unresolved_columns.map(item=>item.header+': '+item.reason).join(' '),'hint'));
      const detail=node('details');detail.append(node('summary','Compare recorded query and source bindings'),
        node('pre',JSON.stringify({before:edition.catalog.current_lineage,after:candidate.lineage,source:candidate.source},null,2)));
      box.append(detail);parent.append(box);
    }
    if(!edition.catalog.items.length)parent.append(node('p',
      edition.catalog.next_before?'No matching successor on this page. Continue with Older results.':'No newer complete result matches this worksheet on this page.','muted'));
    if(edition.catalog.unavailable.length){
      const detail=node('details');detail.append(node('summary','Retained results requiring source repair'),
        node('pre',JSON.stringify(edition.catalog.unavailable,null,2)));parent.append(detail);
    }
    $('workbook-edition-page').textContent=edition.catalog.items.length+' matching sources from '+edition.catalog.scanned_results+
      ' completed results on this page.'+(edition.catalog.next_before?' More results are available.':' End of this source history.');
    controls();
  }
  function editionKeep(){
    if(!w.edition)return;
    const index=edition.sheet,original=w.loaded.definition.sheets[index];
    w.editor.sheets[index].source=clone(original.source);
    w.editor.sheets[index].columns=clone(original.columns);
    edition.review=null;edition.reviewKey=null;
    renderSheets();remember();controls();
  }
  async function editionReview(){
    const request=editionRequest(),fingerprint=JSON.stringify(request);
    const result=await api('/api/workbooks/'+encodeURIComponent(w.loaded.definition.name)+'/refresh-review',request);
    edition.review=result;edition.reviewKey=fingerprint;
    const parent=$('workbook-edition-review-output');parent.replaceChildren();
    for(const sheet of result.sheets){
      const preview=result.previews.find(item=>item.sheet===sheet.sheet),box=node('section',undefined,'workbook-sheet');
      box.append(node('h3',sheet.name_after+' · '+(sheet.action==='keep'?'keep original result':'new complete result')),
        node('p',sheet.match_basis+' · '+sheet.before.row_count+' → '+sheet.after.row_count+' rows'));
      const source=node('details');source.append(node('summary','Reviewed source and column changes'),
        node('pre',JSON.stringify(sheet,null,2)));box.append(source);
      if(preview){
        const typeText=preview.observed_types.map(item=>item.header+': '+(item.types.join('/')||'no values')).join(' · ');
        box.append(node('p','Types in the displayed rows: '+typeText,'muted'));
        const scroll=node('div',undefined,'table-scroll'),table=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');
        for(const column of sheet.columns_after)header.append(node('th',column.header));
        head.append(header);
        for(const values of preview.rows){
          const row=node('tr');
          for(const item of values){
            const td=cell(row,item.error?item.error:item.value===null?'[empty cell]':String(item.value));
            if(!item.error)td.append(node('small',item.excel_type+(item.conversion?' · '+item.conversion:'')));
          }
          body.append(row);
        }
        table.append(head,body);scroll.append(table);box.append(scroll);
        if(preview.errors.length)box.append(node('p','Correct the marked column types before saving this edition.','hint'));
      }
      parent.append(box);
    }
    remember();controls();
    message(result.ready?'The current source and cell review is ready to save.':'The cell review found a projection that needs correction.');
  }
  async function saveEdition(){
    if(!editionReady())throw Error('Review the current sources and cells before saving this edition.');
    const request={...editionRequest(),review_sha256:edition.review.review_sha256};
    const fingerprint=JSON.stringify(request);
    if(w.savePending?.key!==fingerprint)w.savePending={key:fingerprint,request:{id:id(),...request},route:'refresh'};
    remember();
    const saved=await api('/api/workbooks/'+encodeURIComponent(w.loaded.definition.name)+'/refresh',w.savePending.request);
    const result=await api('/api/workbooks/'+encodeURIComponent(saved.name)+'?revision='+saved.revision);
    w.savePending=null;w.edition=null;edition.review=null;edition.reviewKey=null;
    setEditor(result.definition,result);await refresh();
    message('Saved workbook '+saved.name+' edition '+saved.revision+'. Its earlier delivery is available in history.');
  }
  $('workbook-edition-open').addEventListener('click',()=>act(editionOpen));
  $('workbook-edition-find').addEventListener('click',()=>act(()=>editionFind()));
  $('workbook-edition-sheet').addEventListener('change',()=>{
    edition.sheet=Number($('workbook-edition-sheet').value);
    act(()=>editionFind());
  });
  $('workbook-edition-next').addEventListener('click',()=>act(()=>editionFind(edition.catalog.next_before,[...edition.pages,edition.before])));
  $('workbook-edition-prev').addEventListener('click',()=>act(()=>editionFind(edition.pages.at(-1),edition.pages.slice(0,-1))));
  $('workbook-edition-keep').addEventListener('click',()=>act(editionKeep));
  $('workbook-edition-reason').addEventListener('input',()=>{
    if(w.edition){w.edition.reason=$('workbook-edition-reason').value;remember();controls();}
  });
  $('workbook-edition-review').addEventListener('click',()=>act(editionReview));
  $('workbook-edition-discard').addEventListener('click',()=>act(()=>{
    if(!w.edition)return;
    if(changed()&&!confirm('Return to the saved definition and discard these edition changes?'))return;
    const result=w.loaded;w.edition=null;w.savePending=null;edition.review=null;edition.reviewKey=null;
    setEditor(result.definition,result);controls();
  }));
'''
