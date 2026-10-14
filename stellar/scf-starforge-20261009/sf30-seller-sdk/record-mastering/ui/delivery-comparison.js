// MIT. Existing Deliveries desk: exact saved-pair review and complete downloads.
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const label=v=>String(v).replaceAll('_',' ');
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
function table(heads,rows){const wrap=el('div',undefined,'table-wrap'),t=el('table'),thead=el('thead'),head=el('tr');for(const h of heads)head.append(el('th',h));thead.append(head);t.append(thead);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const value of row){const td=el('td');td.append(value instanceof Node?value:document.createTextNode(String(value??'—')));tr.append(td);}body.append(tr);}t.append(body);wrap.append(t);return wrap;}
function field(labelText,element){const wrap=el('label',labelText);wrap.append(element);return wrap;}
function save(text,type,name){const href=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),10000);}
export function attachDeliveryComparison(root,{editions,workspaceId,api,download,isCurrent}){
    let epoch=0,result=null,page=0,loading=false;
    const alive=()=>root.isConnected&&isCurrent();
    const header=el('h2','Compare saved deliveries'),intro=el('p','Review the exact customer values, resolution status and provenance that changed between two retained editions.');
    const form=el('div',undefined,'form-grid'),before=el('select'),after=el('select');
    for(const d of editions){const text=d.title+' · '+d.created+' · revision '+d.source_revision;for(const select of[before,after]){const o=el('option',text);o.value=d.id;select.append(o);}}
    if(editions.length>1)before.value=editions[1].id;
    form.append(field('Before edition',before),field('After edition',after));
    const actions=el('div',undefined,'toolbar'),run=el('button','Compare editions'),open=el('input'),openLabel=field('Open saved comparison JSON',open);
    open.type='file';open.accept='.json,application/json';run.type='button';
    actions.append(run,openLabel);
    const status=el('p');status.setAttribute('role','status');
    const output=el('div');
    root.append(header,intro,form,actions,status,output);
    const selection=()=>({beforeId:before.value,afterId:after.value,workspaceId});
    const current=t=>alive()&&t===epoch;
    function controls(){run.disabled=loading||editions.length<2||before.value===after.value;open.disabled=loading;}
    function invalidate(){epoch++;result=null;output.replaceChildren();status.textContent='';page=0;loading=false;controls();}
    before.onchange=invalidate;after.onchange=invalidate;
    function button(text,fn){const b=el('button',text,'secondary');b.type='button';b.onclick=()=>{if(alive()&&result)Promise.resolve().then(fn).catch(error=>{if(alive())status.textContent=error.message;});};return b;}
    function paint(){
        output.replaceChildren();if(!result)return;const c=result.comparison;
        const summary=el('div',undefined,'checklist');
        for(const [key,text]of[['addedRecords','Added records'],['removedRecords','Removed records'],['changedRecords','Changed records'],['unchangedRecords','Unchanged records'],['valueChanges','Text changes'],['statusChanges','Resolution changes'],['provenanceChanges','Provenance changes']])summary.append(el('span',c.summary[key]+' '+text.toLowerCase(),'pill'));
        output.append(summary,table(['Edition scope','Before','After'],[['Title',c.before.document.title,c.after.document.title],['Record selection',c.before.document.mode,c.after.document.mode],['Delivered records',c.before.document.rowCount,c.after.document.rowCount],['Records omitted by selection',c.before.document.omittedRecords,c.after.document.omittedRecords],['Unresolved delivered fields',c.before.document.conflictCount,c.after.document.conflictCount],['Selected fields',c.before.document.columns.join(', '),c.after.document.columns.join(', ')]]));
        output.append(el('p',c.interpretation.membership),el('p','A blank value is retained text. An absent row or field is shown separately. Provenance changes include changed source editions and saved field decisions.'));
        const downloads=el('div',undefined,'toolbar'),stem='delivery-comparison-'+c.sha256.slice(0,12);
        downloads.append(button('Save complete comparison JSON',()=>save(JSON.stringify(c,null,2)+'\n','application/json',stem+'.json')),button('Download readable report',()=>save(result.reportHtml,'text/html',stem+'.html')),button('Download all field changes CSV',()=>save(result.changesCSV,'text/csv',stem+'.csv')),button('Original before delivery',()=>download('/api/delivery/'+c.before.id,'before-delivery.gz')),button('Original after delivery',()=>download('/api/delivery/'+c.after.id,'after-delivery.gz')));
        output.append(downloads);
        const choices=el('div',undefined,'form-grid'),filter=el('select'),search=el('input');
        for(const [value,text]of[['changed','All differences'],['all','All records'],['added','Added records'],['removed','Removed records'],['modified','Changed retained records'],['unchanged','Unchanged records']]){const o=el('option',text);o.value=value;filter.append(o);}
        search.type='search';search.placeholder='Master identifier or exact field text';
        choices.append(field('Show',filter),field('Find',search));output.append(choices);
        const rowsRoot=el('div'),pager=el('div',undefined,'pagination');output.append(rowsRoot,pager);
        function rows(){
            const query=search.value.toLocaleLowerCase(),found=c.rows.filter(row=>(filter.value==='all'||filter.value==='changed'&&row.change!=='unchanged'||filter.value==='modified'&&row.change==='changed'||row.change===filter.value)&&(!query||row.masterId.toLocaleLowerCase().includes(query)||row.cells.some(cell=>[cell.field,cell.before?.value,cell.after?.value].some(v=>v?.toLocaleLowerCase().includes(query)))));
            page=Math.min(page,Math.max(0,Math.ceil(found.length/25)-1));rowsRoot.replaceChildren();pager.replaceChildren();
            for(const row of found.slice(page*25,page*25+25)){
                const section=el('section',undefined,'edition-card');section.append(el('h3',label(row.change)+' · '+row.masterId));
                function cell(value){const d=el('div');if(value===null)d.append(el('em','Absent from edition'));else{d.append(el('div',value.value===''?'Empty text':value.value,'comparison-value'),el('small',label(value.status)));}return d;}
                section.append(table(['Field','Before value / status','After value / status','Changes'],row.cells.map(c=>[label(c.field),cell(c.before),cell(c.after),[c.change==='not_delivered'?'Absent from both':c.change==='added'?'Only after':c.change==='removed'?'Only before':'',c.valueChanged?'Text':null,c.statusChanged?'Resolution':null,c.provenanceChanged?'Provenance':null].filter(Boolean).join(', ')||'Unchanged'])));
                const details=el('details');details.append(el('summary','Complete original field provenance'),el('pre',JSON.stringify(row.cells,null,2),'comparison-source'));section.append(details);rowsRoot.append(section);
            }
            if(!found.length)rowsRoot.append(el('p','No records match this view.'));
            const previous=button('Previous',()=>{page--;rows();}),next=button('Next',()=>{page++;rows();});previous.disabled=page===0;next.disabled=(page+1)*25>=found.length;
            pager.append(el('span',found.length?(page*25+1)+'–'+Math.min(found.length,(page+1)*25)+' of '+found.length:'No records'),previous,next);
        }
        filter.onchange=search.oninput=()=>{page=0;rows();};rows();
    }
    async function read(saved){
        const ticket=++epoch,pair=saved?{workspaceId:saved.workspace?.id,beforeId:saved.before?.id,afterId:saved.after?.id,expectedSha256:saved.sha256}:selection();
        result=null;output.replaceChildren();loading=true;controls();status.textContent='Reading both complete original editions…';
        try{
            if(saved&&(saved.schema!=='stellar-forge.record-mastering.v1.delivery-comparison'||saved.workspace?.id!==workspaceId))throw Error('Choose a comparison from this original or independently received workspace.');
            const received=await api('delivery.compare',pair);if(!current(ticket))return;
            if(saved&&canonical(saved)!==canonical(received.comparison))throw Error('The saved comparison differs from its complete original editions.');
            if(!editions.some(d=>d.id===pair.beforeId)||!editions.some(d=>d.id===pair.afterId))throw Error('The selected immutable editions are absent. Reopen the received full workspace.');
            before.value=pair.beforeId;after.value=pair.afterId;result=received;page=0;paint();status.textContent='Both original editions are retained in this comparison.';
        }catch(error){if(current(ticket))status.textContent=error.message;}
        finally{if(current(ticket)){loading=false;controls();}}
    }
    run.onclick=()=>read(null);
    open.onchange=async()=>{const file=open.files[0];if(!file)return;const ticket=++epoch;result=null;output.replaceChildren();loading=true;controls();status.textContent='Opening complete comparison JSON…';try{const value=JSON.parse(await file.text());if(current(ticket))await read(value);}catch(error){if(current(ticket)){loading=false;controls();status.textContent=error.message;}}finally{open.value='';}};
    controls();if(editions.length<2)status.textContent='Save two delivery editions to compare their original customer records. A complete saved comparison can reopen after receiving its original workspace.';
}
