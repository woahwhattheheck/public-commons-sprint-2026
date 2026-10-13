// MIT. Product-source authoring in the existing SCF submission workspace.
import {
  beginProductSourceAuthoring,receiveProductRegistration,addProductRegistration,removeProductRegistration,
  parseImmutableProductSource,productChapterSources,indexedProductRegistrations,sourceSpecification,
  selectProductSource,previewProductSources,productDeclarationFiles,registrationForComposer,
} from './grant-product-authoring-core.mjs';
import {readProductAuthoringContext,readProductRegistrationFile,exportProductDeclarations} from './grant-product-authoring-source.mjs';

let renderSequence=0;
const contexts=new Map(),previews=new Map();
const clone=value=>JSON.parse(JSON.stringify(value));
const need=(value,message)=>{if(!value)throw new Error(message);};
const fingerprint=draft=>JSON.stringify({bundleId:draft.productSourceAuthoring?.selection.bundleId||null,
  documents:(draft.productSourceAuthoring?.selection.registrations||[]).map(registrationForComposer)});
const compact=value=>Number(value||0).toLocaleString();
const headingLabel=value=>String(value||'').replace(/^## /,'');
const eligible=(candidate,productId)=>candidate.indexedSources.filter(source=>
  !source.source_registration||source.source_registration===productId);
const setOptional=(object,key,value)=>{if(value==='')delete object[key];else object[key]=value;};

function toolkit(root,ctx){
  const {node,button,input,select}=ctx;
  function edited(message){
    const draft=ctx.getDraft(),prior=previews.get(draft.id);
    if(!prior||prior.fingerprint!==fingerprint(draft)){
      previews.delete(draft.id);
      const preview=root.querySelector('[data-product-source-preview]');
      if(preview){preview.dataset.previewState='stale';preview.replaceChildren(node('p','Preview the current declarations to see the resulting source changes.','muted'));}
    }
    const selected=draft.productSourceAuthoring?.selection.registrations.find(row=>row.key===draft.productSourceAuthoring.selection.selectedKey);
    const complete=root.querySelector('[data-working-declaration-json]');
    if(complete&&selected)complete.textContent=JSON.stringify(registrationForComposer(selected),null,2);
    ctx.touch(message);
  }
  function update(label,action){
    let next=ctx.retainVersion(ctx.getDraft(),label);
    next=action(next)||next;ctx.setDraft(next);edited();ctx.render();
  }
  function textField(label,value,action,options={}){
    const control=input(label,value,next=>{action(next);edited();},options);return control;
  }
  function actions(...items){const bar=node('div',undefined,'product-actions');bar.append(...items);return bar;}
  function details(title,content){const item=node('details',undefined,'product-detail');item.append(node('summary',title),content);return item;}
  function readOnly(label,value){const control=input(label,value,()=>{});control.field.readOnly=true;return control.wrap;}
  return {node,button,input,select,edited,update,textField,actions,details,readOnly};
}
async function contextFor(draft,bundleId){
  if(contexts.has(bundleId))return contexts.get(bundleId);
  const value=await readProductAuthoringContext(draft,bundleId);
  contexts.set(bundleId,value);if(contexts.size>6)contexts.delete(contexts.keys().next().value);
  return value;
}
function chapterOptions(context,current=''){
  const rows=context.chapters.filter(row=>row.occurrences===1).map(row=>[row.heading,headingLabel(row.heading)]);
  if(current&&!rows.some(([key])=>key===current))rows.unshift([current,headingLabel(current)+' · absent or repeated']);
  return [['','Select a complete chapter'],...rows];
}
function originalIdentity(candidate,source,productId){
  const available=eligible(candidate,productId);
  return available.find(row=>row.id===source?.id)||(available.length===1?available[0]:null);
}
function sourceRows(root,ctx,ui,context,row){
  const {node,button,select,textField,actions,details,update,edited}=ui;
  const sources=Array.isArray(row.document.sources)?row.document.sources:[];
  let candidates=[];
  try{candidates=productChapterSources(context,row.document.heading);}catch{}
  const section=node('section',undefined,'product-sources');
  section.append(node('h4','Original sources'),node('p',
    'Choose the immutable source edition used by this chapter. Existing index IDs and measured file identities remain attached to their original repository and path.','muted'));
  const addSource=(candidate=null)=>{
    update('Before adding a product source',draft=>{
      const selected=draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key);
      selected.document.sources||=[];
      const indexed=candidate?originalIdentity(candidate,null,selected.document.id):null;
      const used=new Set(draft.productSourceAuthoring.selection.registrations.flatMap(item=>(item.document.sources||[]).map(source=>source.id)));
      let suffix=selected.document.sources.length+1;
      while(used.has(selected.document.id+'-'+suffix))suffix++;
      const source=candidate?sourceSpecification(candidate,indexed,{id:selected.document.id+'-'+suffix}):
        {id:selected.document.id+'-'+suffix,label:'',repository:'',kind:'blob',path:''};
      need(!used.has(source.id),'This original source ID is already in the working declarations. Select its existing row.');
      selected.document.sources.push(source);
    });
  };
  const picker=select('Add a source from the selected chapter','',
    [['','Select an original source'],...candidates.map((source,index)=>[String(index),
      source.repository+'/'+source.path+' · '+source.commit.slice(0,12)])],value=>{
      if(value!=='')ctx.work(()=>addSource(candidates[Number(value)]));
    });
  section.append(picker.wrap,actions(button('Add source fields',()=>addSource()),
    button('Add remaining chapter sources',()=>{
      need(candidates.length,'The selected chapter has no immutable Git source links. Choose another chapter or receive its complete current source edition.');
      update('Before receiving remaining chapter sources',draft=>{
        const selected=draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key);
        selected.document.sources||=[];
        const allIds=new Set(draft.productSourceAuthoring.selection.registrations.flatMap(item=>(item.document.sources||[]).map(source=>source.id)));
        let added=0;
        for(const candidate of candidates){
          if(selected.document.sources.some(source=>source.repository===candidate.repository&&source.path===candidate.path&&
            (source.kind||'blob')===candidate.kind&&source.commit===candidate.commit))continue;
          const indexed=originalIdentity(candidate,null,selected.document.id);
          if(indexed&&allIds.has(indexed.id))continue;
          let suffix=selected.document.sources.length+1;while(allIds.has(selected.document.id+'-'+suffix))suffix++;
          const source=sourceSpecification(candidate,indexed,{id:selected.document.id+'-'+suffix});
          selected.document.sources.push(source);allIds.add(source.id);added++;
        }
        need(added,'Every available chapter source is already represented in the working declarations.');
      });
    })));
  for(const [index,source]of sources.entries()){
    const card=node('article',undefined,'product-source-row');card.dataset.productSourceRow=String(index);card.dataset.sourceId=source.id||'';
    const title=node('div',undefined,'product-row-heading');
    title.append(node('h5',(index+1)+'. '+(source.label||source.id||'New source')),
      button('Remove source',()=>update('Before removing product source '+(source.id||index+1),draft=>{
        draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key).document.sources.splice(index,1);
      })));
    card.append(title);
    const fields=node('div',undefined,'product-grid');
    fields.append(textField('Source ID',source.id,value=>{source.id=value;card.dataset.sourceId=value;}).wrap,
      textField('Source label',source.label,value=>{source.label=value;}).wrap);
    const current=context.index.sources.find(item=>item.id===source.id);
    if(current)card.append(node('p','Original index record: '+current.id+' · '+current.label+'. The composer retains this original label.','muted'));
    const match=candidates.findIndex(candidate=>candidate.repository===source.repository&&candidate.path===source.path&&
      candidate.kind===(source.kind||'blob')&&candidate.commit===source.commit);
    const choose=select('Selected chapter source',match<0?'':String(match),
      [['','Use the source fields below'],...candidates.map((candidate,at)=>[String(at),candidate.repository+'/'+candidate.path+' · '+candidate.commit.slice(0,12)])],
      value=>{if(value==='')return;ctx.work(()=>update('Before choosing another original source',draft=>{
        const selected=draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key);
        const candidate=candidates[Number(value)],indexed=originalIdentity(candidate,selected.document.sources[index],selected.document.id);
        selectProductSource(selected,index,candidate,indexed?.id||null);
      }));});
    card.append(fields,choose.wrap);
    if(match>=0&&eligible(candidates[match],row.document.id).length>1){
      card.append(select('Original index identity',current?.id||'',
        [['','Keep the entered source ID'],...eligible(candidates[match],row.document.id).map(item=>[item.id,item.id+' · '+item.label])],
        value=>{if(!value)return;ctx.work(()=>update('Before selecting the original source ID',draft=>{
          const selected=draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key);
          selectProductSource(selected,index,candidates[match],value);
        }));}).wrap);
    }
    const sourceFields=node('div',undefined,'product-grid');
    function changePath(key,value){
      if(source[key]!==value){source[key]=value;delete source.editions;}
      const measurements=card.querySelector('[data-measured-editions]');
      if(measurements)measurements.replaceChildren(node('p','The working path changed. Select its original source or enter measurements for this path.','muted'),button('Edit this path’s measurements',ctx.render));
    }
    sourceFields.append(textField('Repository · owner/name',source.repository,value=>changePath('repository',value)).wrap,
      textField('Original path',source.path,value=>changePath('path',value)).wrap,
      textField('Immutable commit · optional selection',source.commit||'',value=>setOptional(source,'commit',value),{placeholder:'Full 40-character commit; empty follows the chapter'}).wrap,
      select('Source type',source.kind||'blob',[['blob','File'],['tree','Directory']],value=>ctx.work(()=>update('Before changing the source type',draft=>{
        const selected=draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key).document.sources[index];
        if(selected.kind!==value){selected.kind=value;delete selected.editions;}
      }))).wrap,
      select('Chapter receiving',source.required===false?'optional':'required',[['required','Required in this chapter'],['optional','Optional when absent']],
        value=>{source.required=value==='required';edited();}).wrap);
    card.append(sourceFields);
    if((source.kind||'blob')==='blob'){
      const editions=node('div');editions.dataset.measuredEditions='';
      editions.append(node('p','File identities belong to the exact repository, path and commit. Editing the repository or path clears its working measurements; the original file and saved versions retain their prior values.','muted'));
      for(const [editionIndex,edition]of (source.editions||[]).entries()){
        const form=node('div',undefined,'product-measurement product-grid');
        form.append(textField('Measured commit',edition.commit,value=>{edition.commit=value;}).wrap,
          textField('Git blob · optional',edition.git_blob||'',value=>setOptional(edition,'git_blob',value)).wrap,
          textField('SHA-256 · optional',edition.sha256||'',value=>setOptional(edition,'sha256',value)).wrap,
          textField('Original file bytes · optional',edition.bytes??'',value=>setOptional(edition,'bytes',value===''?'':Number(value)),{type:'number'}).wrap,
          button('Remove measurement',()=>update('Before removing a measured source edition',draft=>{
            const selected=draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key).document.sources[index];
            selected.editions.splice(editionIndex,1);if(!selected.editions.length)delete selected.editions;
          })));
        editions.append(form);
      }
      editions.append(button('Add measured file edition',()=>update('Before adding a measured source edition',draft=>{
        const selected=draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key).document.sources[index];
        selected.editions||=[];selected.editions.push({commit:selected.commit||''});
      })));
      card.append(details('Measured file editions · '+(source.editions?.length||0),editions));
    }
    section.append(card);
  }
  if(!sources.length)section.append(node('p','Add the chapter’s original sources to this declaration.','empty'));
  root.append(section);
}

function previewView(root,ctx,ui,result){
  const {node,details,actions,button}=ui;
  root.replaceChildren();root.dataset.previewState='current';
  for(const [key,value]of Object.entries(result.counts))root.dataset[key]=String(value);
  root.append(node('h3','Source changes'),node('p',
    compact(result.counts.selectedProducts)+' selected products · '+compact(result.counts.added)+' added sources · '+
    compact(result.counts.changed)+' changed · '+compact(result.counts.unchanged)+' unchanged','product-summary'));
  const products=node('table',undefined,'product-table'),head=node('thead'),body=node('tbody'),tr=node('tr');
  for(const label of ['Product','Chapter','Received sources'])tr.append(node('th',label));head.append(tr);products.append(head,body);
  for(const product of result.products){
    const line=node('tr');line.append(node('td',product.id),node('td',headingLabel(product.heading)),
      node('td',product.chapterPresent?String(product.sourceIds.length):'Chapter absent from this edition'));body.append(line);
    if(product.omittedSourceIds.length){const note=node('tr'),cell=node('td','Optional sources absent: '+product.omittedSourceIds.join(', '));cell.colSpan=3;note.append(cell);body.append(note);}
  }
  const tableWrap=node('div',undefined,'product-table-scroll');tableWrap.append(products);root.append(tableWrap);
  const sourceList=node('div');
  function rows(showAll){
    sourceList.replaceChildren();
    const selected=showAll?result.sources:result.sources.filter(source=>source.status!=='unchanged');
    if(!selected.length)sourceList.append(node('p','The selected declarations retain every source record unchanged.','muted'));
    for(const source of selected){
      const content=node('div',undefined,'product-diff');
      if(source.before)content.append(node('h5','Retained record'),node('pre',JSON.stringify(source.before,null,2),'source-text'));
      content.append(node('h5','Composed record'),node('pre',JSON.stringify(source.after,null,2),'source-text'));
      const item=details(source.status+' · '+source.id,content);item.dataset.sourceId=source.id;item.dataset.sourceChange=source.status;
      sourceList.append(item);
    }
  }
  root.append(actions(button('Show changes',()=>rows(false)),button('Show all source records',()=>rows(true)),
    button('Download complete preview index',()=>ctx.download(JSON.stringify(result.index,null,2)+'\n','scf-source-index-preview.json'))),sourceList);
  rows(false);
}

export async function renderProductSources(root,ctx){
  const sequence=++renderSequence,ui=toolkit(root,ctx);
  const {node,button,select,textField,actions,details,update,edited}=ui;
  root.dataset.productSourceAuthoring='v1';
  root.append(node('h2','Product sources'),node('p',
    'Prepare independent product declarations against a complete retained reviewer edition. Save them with the application, preview the resulting source index, and download the composer files.'));
  const current=ctx.getDraft(),bundles=current.handover?.bundles||[];
  const project=current.productSourceAuthoring;
  const top=actions(button('Save author project',ctx.save),button('Open author project',ctx.openFull),
    button('Download full author project',ctx.exportFull),button('Saved browser drafts',ctx.showSaved),
    button('Version history',ctx.showHistory));
  root.append(top);
  if(!bundles.length){
    root.append(node('p','Receive a complete reviewer source package to choose its application, companion, budget and source index.','empty'),
      button('Open source editions',ctx.showSource));return;
  }
  if(!project){
    const selected=current.handover.selection.bundleId||bundles[0].id;
    root.append(node('p',bundles.length+' complete reviewer editions are retained in this application.'),
      button('Start product source editing',()=>update('Before starting product source authoring',
        draft=>beginProductSourceAuthoring(draft,selected)),'primary'));return;
  }
  const selection=project.selection;
  const options=[['','Select a retained reviewer edition'],...bundles.map(bundle=>[
    bundle.id,bundle.body.receivedAt+' · '+bundle.id.slice(0,12)+(bundle.body.applicationSha256===current.currentSource?' · current answers':'')])];
  root.append(select('Reviewer source edition',selection.bundleId||'',options,value=>ctx.work(()=>update('Before selecting a product source edition',
    draft=>beginProductSourceAuthoring(draft,value||null)))).wrap);
  const memo=textField('Authoring notes',selection.note,value=>{selection.note=value;},{area:true});
  root.append(memo.wrap);
  if(!selection.bundleId){root.append(node('p','Select the complete source edition for this author project.','empty'));return;}
  root.dataset.productSourceBundleId=selection.bundleId;
  const loading=node('p','Reading the complete retained companion and source index…','muted');root.append(loading);
  let context;
  try{context=await contextFor(current,selection.bundleId);}
  catch(error){if(sequence===renderSequence&&root.isConnected&&root.dataset.productSourceAuthoring==='v1')loading.replaceWith(node('p',error.message,'issues'));return;}
  if(sequence!==renderSequence||!root.isConnected||root.dataset.productSourceAuthoring!=='v1'||ctx.getDraft().id!==current.id||
    ctx.getDraft().productSourceAuthoring?.selection.bundleId!==selection.bundleId)return;
  loading.remove();
  root.append(node('p',compact(context.chapters.length)+' complete chapters · '+compact(context.index.sources.length)+
    ' original source records · received '+context.receivedAt,'product-summary'));
  const identities=node('div');
  identities.append(ui.readOnly('Reviewer bundle',context.bundleId),ui.readOnly('Complete companion SHA-256',context.companion.sha256),
    ui.readOnly('Original source-index SHA-256',context.sourceIndex.sha256),
    node('p',compact(context.companion.bytes)+' companion bytes · '+compact(context.sourceIndex.bytes)+' source-index bytes','muted'));
  root.append(details('Selected original files',identities));
  const intake=node('section',undefined,'card product-intake');
  intake.append(node('h3','Working declarations'));
  const file=node('input');file.type='file';file.accept='.json,application/json';file.multiple=true;file.hidden=true;
  let replaceKey=null;
  file.addEventListener('change',()=>ctx.work(async()=>{
    const files=Array.from(file.files||[]);if(!files.length)return;
    need(replaceKey===null||files.length===1,'Choose one complete registration to replace the selected working declaration.');
    const originals=await Promise.all(files.map(value=>readProductRegistrationFile(value)));
    let next=ctx.retainVersion(ctx.getDraft(),replaceKey===null?'Before importing product declarations':'Before receiving another registration edition');
    for(const original of originals)next=receiveProductRegistration(next,original,{key:ctx.uid(),replaceKey});
    ctx.setDraft(next);edited();ctx.render();ctx.status('Received '+originals.length+' complete original registration files into this author project.');
  }));
  function chooseImport(key=null){replaceKey=key;file.multiple=key===null;file.value='';file.click();}
  const known=indexedProductRegistrations(context);
  intake.append(file,actions(button('Import registration files',()=>chooseImport()),
    button('Receive indexed product declarations',()=>{
      need(known.length,'This source edition has no independent product declarations yet. Import a registration or create one from its actual chapter.');
      update('Before receiving indexed product declarations',draft=>{
        const selected=draft.productSourceAuthoring.selection;let count=0;
        for(const document of known){
          if(selected.registrations.some(row=>row.document.id===document.id))continue;
          const row={key:ctx.uid(),name:document.id+'.json',originalSha256:null,note:'',document:clone(document)};
          selected.registrations.push(row);selected.selectedKey=row.key;count++;
        }
        need(count,'Every indexed product is already present in this author project.');
      });
    })));
  const newProduct=node('div',undefined,'product-grid');
  newProduct.append(textField('New product ID',selection.productId,value=>{selection.productId=value;},
    {placeholder:'Stable lowercase product ID'}).wrap,
    select('Original product chapter',selection.chapter,chapterOptions(context,selection.chapter),value=>{selection.chapter=value;edited();}).wrap);
  intake.append(newProduct,button('Create chapter declaration',()=>update('Before creating a product declaration',draft=>
    addProductRegistration(draft,{key:ctx.uid(),id:draft.productSourceAuthoring.selection.productId,
      heading:draft.productSourceAuthoring.selection.chapter}))));
  root.append(intake);
  if(selection.registrations.length){
    const list=node('div',undefined,'product-registration-list');list.setAttribute('aria-label','Working product declarations');
    for(const row of selection.registrations){
      const item=button((row.document.id||'Untitled product')+' · '+(row.document.sources?.length||0)+' sources',()=>{
        ctx.getDraft().productSourceAuthoring.selection.selectedKey=row.key;edited();ctx.render();
      });
      item.dataset.productRegistrationKey=row.key;item.setAttribute('aria-current',String(row.key===selection.selectedKey));list.append(item);
    }
    root.append(list);
  }
  const row=selection.registrations.find(item=>item.key===selection.selectedKey);
  if(row){
    const editor=node('section',undefined,'card product-registration-editor');editor.dataset.productRegistrationKey=row.key;
    editor.append(node('h3',row.document.id||'Product declaration'));
    const fields=node('div',undefined,'product-grid');
    fields.append(textField('Product ID',row.document.id,value=>{row.document.id=value;}).wrap,
      select('Product chapter',row.document.heading,chapterOptions(context,row.document.heading),value=>ctx.work(()=>update('Before changing the product chapter',draft=>{
        draft.productSourceAuthoring.selection.registrations.find(item=>item.key===row.key).document.heading=value;
      }))).wrap,
      textField('Working declaration notes',row.note,value=>{row.note=value;},{area:true}).wrap);
    editor.append(fields,actions(button('Replace from file',()=>chooseImport(row.key)),
      button('Download this declaration',async()=>{
        const chosen=ctx.getDraft().productSourceAuthoring.selection.registrations.find(item=>item.key===row.key);
        const received=await readProductAuthoringContext(ctx.getDraft(),ctx.getDraft().productSourceAuthoring.selection.bundleId);
        previewProductSources(received,[chosen]);
        const declaration=productDeclarationFiles([chosen])[0];ctx.download(declaration.content,declaration.path.split('/').pop());
        ctx.status('Downloaded the complete '+chosen.document.id+' composer declaration.');
      }),
      button('Remove working declaration',()=>update('Before removing product declaration '+(row.document.id||''),draft=>removeProductRegistration(draft,row.key)))));
    const selectedChapter=context.chapters.filter(chapter=>chapter.heading===row.document.heading);
    if(selectedChapter.length===1)editor.append(details('Read the complete selected chapter',
      node('pre',selectedChapter[0].markdown,'source-text product-chapter')));
    else editor.append(node('p',selectedChapter.length?'This source edition repeats the selected heading. Receive its corrected full chapter before previewing.':
      'This chapter is absent from the selected source edition. The declaration remains available for a later edition.','muted'));
    sourceRows(editor,ctx,ui,context,row);
    const complete=node('pre',JSON.stringify(registrationForComposer(row),null,2),'source-text');complete.dataset.workingDeclarationJson='';
    editor.append(details('Complete working declaration JSON',complete));root.append(editor);
  }
  if(project.imports.length){
    const originals=node('div');
    for(const original of project.imports){
      const item=node('article',undefined,'product-original');
      item.append(node('h4',original.name),node('p',compact(original.bytes)+' original bytes · '+original.receivedAt,'muted'),
        node('p',original.sha256,'code'),
        button('Download original registration',()=>ctx.download(original.text,original.name.endsWith('.json')?original.name:'original-product-registration.json')));
      originals.append(item);
    }
    root.append(details('Retained original registration files · '+project.imports.length,originals));
  }
  const preview=node('section',undefined,'card');preview.dataset.productSourcePreview='';preview.dataset.previewState='stale';
  const prior=previews.get(current.id);
  if(prior?.fingerprint===fingerprint(ctx.getDraft()))previewView(preview,ctx,ui,prior.result);
  else preview.append(node('p','Preview the current declarations to see the resulting source changes.','muted'));
  root.append(actions(button('Preview source changes',async()=>{
    const draft=ctx.getDraft(),selection=draft.productSourceAuthoring.selection;
    const verified=await readProductAuthoringContext(draft,selection.bundleId);
    const result=previewProductSources(verified,selection.registrations);
    previews.set(draft.id,{fingerprint:fingerprint(draft),result});previewView(preview,ctx,ui,result);
    ctx.status('Previewed every working product with the maintained grant composer source-selection rules.');
  },'primary'),button('Download all composer files',async()=>{
    const result=await exportProductDeclarations(ctx.getDraft());
    ctx.download(result.bytes,result.name,'application/zip');
    ctx.status('Downloaded '+result.files.length+' complete composer files with the selected source-index preview.');
  })),preview);
}
