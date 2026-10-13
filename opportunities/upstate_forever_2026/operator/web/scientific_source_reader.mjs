/** Inspect original scientific source bytes inside the existing report composer. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const choice=value=>({source_collection_id:value.source_collection_id,source_id:value.source_id});
const key=value=>JSON.stringify([value.source_collection_id,value.source_id,value.body_sha256||'']);
const cell=value=>typeof value==='string'?value:JSON.stringify(value)??String(value);
const download=(file,label)=>'<a href="'+esc(file.url)+(file.url.includes('?')?'&':'?')+'download=1" download>'+esc(label)+'</a>';
const PAGE=50;

export function attachScientificSourceReader(host){
  let panel=null,workspace=null,active=false,generation=0,requestId=0,opened=null,error='',busy=false;
  let query='',pages=new Map(),documentPath=null;
  const frames=new Map();
  const valid=(ws,turn)=>active&&workspace===ws&&host.getWorkspace()===ws&&generation===turn;
  function ensure(container){
    if(!panel){
      panel=document.createElement('section');panel.className='scientific-source-reader';panel.hidden=true;
      panel.setAttribute('aria-label','Read original scientific study');
      panel.innerHTML='<div data-source-reader-heading></div><div data-source-reader-status role="status"></div><div data-source-reader-controls></div><div data-source-reader-document></div><div data-source-reader-content></div><div data-source-reader-files></div>';
      panel.addEventListener('click',event=>{
        const button=event.target.closest('[data-source-reader-action]');
        if(!button||!panel.contains(button))return;
        event.preventDefault();event.stopPropagation();
        const ws=workspace,turn=generation;
        dispatch(button).catch(reason=>{if(valid(ws,turn)){error=reason.message||String(reason);status();}});
      });
      panel.addEventListener('input',event=>{
        if(event.target.matches('[data-source-reader-query]')){
          query=event.target.value;pages.clear();renderSections();
        }
      });
      panel.addEventListener('change',event=>{
        if(event.target.matches('[data-source-reader-document-choice]')){
          documentPath=event.target.value||null;renderDocument();
        }
      });
    }
    if(panel.parentNode!==container)container.append(panel);
  }
  function status(){if(panel)panel.querySelector('[data-source-reader-status]').textContent=error||(busy?'Reading complete original source…':'');}
  async function open(source,{isCurrent}={}){
    if(!active||!panel)throw Error('Open Sources before reading its original scientific study.');
    if(!source||typeof source.source_collection_id!=='string'||typeof source.source_id!=='string')
      throw Error('Choose an exact retained scientific source.');
    const ws=workspace,turn=generation,ticket=++requestId;
    const current=()=>valid(ws,turn)&&ticket===requestId&&(typeof isCurrent!=='function'||isCurrent());
    busy=true;error='';panel.hidden=false;status();
    let result;
    try{result=await host.api(host.endpoint('/api/source-reports/scientific-source',{
      ...choice(source),...(source.body_sha256?{body_sha256:source.body_sha256}:{})}));}
    catch(reason){if(!current())return null;busy=false;error=reason.message||String(reason);status();throw reason;}
    if(!current())return null;
    if(result.schema!=='upstate.scientific-source-reader/v1'||result.workspace_key!==ws||
       result.source?.source_collection_id!==source.source_collection_id||result.source?.source_id!==source.source_id||
       (source.body_sha256&&result.source.body_sha256!==source.body_sha256)||
       !Array.isArray(result.files)||!Array.isArray(result.recipe?.sections)){
      busy=false;throw Error('The original source reader returned another retained edition.');
    }
    const same=opened&&key(opened.source)===key(result.source);
    opened=result;busy=false;error='';
    if(!same){query='';pages.clear();documentPath=null;}
    render();panel.scrollIntoView({block:'start'});panel.querySelector('[data-source-reader-action="close"]').focus?.();
    return result;
  }
  function render(){
    if(!panel||!opened)return;
    const source=opened.source,cohort=source.metadata?.source_kind==='upstate.observation-comparability/v1';
    panel.hidden=false;status();
    panel.querySelector('[data-source-reader-heading]').innerHTML='<div class="source-reports-heading"><div><h3>'+esc(source.title)+'</h3><p>'+
      esc(source.vintage)+' · '+esc(source.collection_title)+'</p></div><button type="button" data-source-reader-action="close">Return to report selection</button></div>'+
      '<p>These are the original study’s retained sections and files. Reading them keeps the report’s current title, contact and ordered selection.</p>'+
      '<details><summary>Exact original source identity</summary><dl><dt>Collection</dt><dd><code>'+esc(source.source_collection_id)+'</code></dd><dt>Document</dt><dd><code>'+
      esc(source.source_id)+'</code></dd><dt>Source SHA256</dt><dd><code>'+esc(source.body_sha256)+'</code></dd><dt>Publisher / source</dt><dd>'+
      esc(source.uri)+'</dd></dl></details>';
    const documents=opened.files.filter(file=>file.kind==='html'||file.kind==='svg');
    panel.querySelector('[data-source-reader-controls]').innerHTML='<div class="inline-actions">'+
      '<button type="button" data-source-reader-action="append">Add this study to current report</button>'+
      '<button type="button" data-source-reader-action="replace">Prepare report from this study only</button>'+
      (cohort&&typeof host.openExtension==='function'?'<button type="button" data-source-reader-action="cohort">Explore original cohort and periods</button>':'')+
      download(opened.original_manifest,'Download original manifest')+'</div>'+
      (documents.length?'<label>Original document or figure<select data-source-reader-document-choice><option value="">Read retained source tables below</option>'+
      documents.map(file=>'<option value="'+esc(file.path)+'"'+(documentPath===file.path?' selected':'')+'>'+esc(file.path)+'</option>').join('')+'</select></label>':'')+
      '<label>Find text in original source tables<input data-source-reader-query value="'+esc(query)+'" placeholder="Activity, result, station, method or original value"></label>'+
      '<p class="note">Table search changes only this view. Every original row and companion file remains in the downloads below.</p>';
    renderDocument();renderSections();
    panel.querySelector('[data-source-reader-files]').innerHTML='<details><summary>All '+opened.files.length+' original files and downloads</summary>'+
      '<div class="table-scroll" tabindex="0" role="region" aria-label="Complete original scientific source files"><table><thead><tr><th>Original path</th><th>Bytes / SHA256</th><th>File</th></tr></thead><tbody>'+
      opened.files.map(file=>'<tr><td><code>'+esc(file.path)+'</code></td><td>'+esc(file.bytes)+'<small class="mono">'+esc(file.sha256)+'</small></td><td>'+download(file,'Download original')+'</td></tr>').join('')+
      '</tbody></table></div></details>';
  }
  function renderDocument(){
    const target=panel.querySelector('[data-source-reader-document]');
    const file=opened?.files.find(row=>row.path===documentPath&&(row.kind==='html'||row.kind==='svg'));
    for(const frame of target.children)frame.hidden=true;
    if(!file)return;
    const frameKey=key(opened.source)+':'+file.path+':'+file.sha256;
    let frame=frames.get(frameKey);
    if(!frame){
      frame=document.createElement('iframe');frame.title=opened.source.title+' — '+file.path;
      frame.setAttribute('sandbox','allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox');
      frame.referrerPolicy='no-referrer';frame.src=file.url;frames.set(frameKey,frame);
    }
    if(frame.parentNode!==target)target.append(frame);
    frame.hidden=false;
  }
  function renderSections(){
    if(!opened||!panel)return;
    const members=new Map(opened.files.map(file=>[file.path,file])),words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    panel.querySelector('[data-source-reader-content]').innerHTML=opened.recipe.sections.map(([heading,blocks],section)=>
      '<section><h4>'+esc(heading)+'</h4>'+blocks.map((block,index)=>{
        if(typeof block==='string')return '<p class="source-original-cell">'+esc(block)+'</p>';
        if(block.kind==='links')return '<ul>'+(block.items||[]).map(item=>{
          const file=members.get(item.path);return '<li>'+(file?download(file,item.title||item.path):esc(item.title||item.path)+' — original member is unavailable')+'</li>';
        }).join('')+'</ul>';
        if(block.kind!=='table')return '';
        const tableKey=section+':'+index,all=block.rows||[],filtered=all.filter(row=>words.every(word=>row.some(value=>cell(value).toLocaleLowerCase().includes(word))));
        const last=Math.max(0,Math.ceil(filtered.length/PAGE)-1),page=Math.min(pages.get(tableKey)||0,last);pages.set(tableKey,page);
        const rows=filtered.slice(page*PAGE,(page+1)*PAGE);
        return '<section class="scientific-source-table">'+(block.caption?'<p>'+esc(block.caption)+'</p>':'')+
          '<p>'+filtered.length+' of '+all.length+' original rows'+(filtered.length?' · showing '+(page*PAGE+1)+'–'+(page*PAGE+rows.length):'')+'</p>'+
          '<div class="table-scroll" tabindex="0" role="region" aria-label="'+esc(heading+' original table '+(index+1))+'"><table><thead><tr>'+
          block.columns.map(name=>'<th>'+esc(cell(name))+'</th>').join('')+'</tr></thead><tbody>'+
          rows.map(row=>'<tr>'+row.map(value=>'<td class="source-original-cell">'+esc(cell(value))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
          (last?'<div class="inline-actions"><button type="button" data-source-reader-action="page" data-table="'+tableKey+'" data-page="'+(page-1)+'"'+(!page?' disabled':'')+'>Previous rows</button>'+
          '<span>Page '+(page+1)+' of '+(last+1)+'</span><button type="button" data-source-reader-action="page" data-table="'+tableKey+'" data-page="'+(page+1)+'"'+(page===last?' disabled':'')+'>Next rows</button></div>':'')+'</section>';
      }).join('')+'</section>').join('');
  }
  async function dispatch(button){
    const action=button.dataset.sourceReaderAction;
    if(action==='close'){requestId++;busy=false;panel.hidden=true;host.returnToSelection?.();return;}
    if(!opened||busy)throw Error('Finish reading the selected original source first.');
    if(action==='page'){pages.set(button.dataset.table,Math.max(0,Number(button.dataset.page)||0));renderSections();return;}
    const original=opened,ws=workspace,turn=generation,ticket=requestId;
    const isCurrent=()=>valid(ws,turn)&&opened===original&&ticket===requestId&&!panel.hidden;
    if(action==='append'||action==='replace'){
      await host.compose({workspace_key:ws,sources:[choice(original.source)],selection_mode:action,
        title:original.source.title,isCurrent});
      return;
    }
    if(action==='cohort'){
      if(!isCurrent())return;
      return host.openExtension('observation-comparability','openSource',{workspace_key:ws,
        source:{kind:'retained',...choice(original.source),source_sha256:original.source.body_sha256}});
    }
  }
  function mount(container){
    const ws=host.getWorkspace();
    if(workspace!==ws){reset();workspace=ws;}
    active=true;ensure(container);
  }
  function detach(){active=false;requestId++;busy=false;if(panel)panel.hidden=true;}
  function reset(){detach();generation++;frames.clear();panel?.remove();panel=null;workspace=null;opened=null;error='';query='';pages.clear();documentPath=null;}
  return {mount,open,detach,reset};
}
