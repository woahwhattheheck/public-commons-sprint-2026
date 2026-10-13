/* Original source groups and actual retained native editions, operator only. */
import {authoredText,appendDisplay,isUiText,setDisplayAttribute,uiJoin} from '/locale.mjs';
const L=(english,french)=>authoredText(english,french);
const text=(node,value)=>{node.replaceChildren();if(isUiText(value))appendDisplay(node,value);else node.textContent=value;};
const el=(tag,value,attributes={})=>{const node=document.createElement(tag);if(value!==null&&value!==undefined)text(node,value);for(const[k,v]of Object.entries(attributes))setDisplayAttribute(node,k,v);return node;};
const labelled=(label,input)=>{const wrap=el('label',label);wrap.append(input);return wrap;};
const valueText=value=>value===null||value===undefined?'Absent':String(value);
const roleText=role=>({foreign_producer:L('Foreign producers','Producteurs étrangers'),importer_purchaser:L('Importers and purchasers','Importateurs et acheteurs'),domestic_producer:L('Domestic producers','Producteurs nationaux'),producer:L('Domestic producers','Producteurs nationaux'),union:L('Unions','Syndicats'),certification:L('Certification','Attestation')}[role]||role);

export async function mountSourceFormula(container,rpc){
  container.replaceChildren();container.classList.add('source-formula');
  const style=el('style',`.source-formula{color:#202020;font:14px/1.45 system-ui,sans-serif}.source-formula h2,.source-formula h3{font-size:18px;margin:0 0 10px}.source-formula header,.source-formula section{border:1px solid #ccc;background:#fff;padding:16px;margin:0 0 12px}.source-formula .sf-controls{display:flex;flex-wrap:wrap;align-items:end;gap:12px}.source-formula label{display:grid;gap:4px;flex:1;min-width:180px}.source-formula input,.source-formula select,.source-formula button{font:inherit;color:inherit;padding:7px 9px;border:1px solid #aaa;background:#fff;max-width:100%}.source-formula button{cursor:pointer}.source-formula button:disabled{cursor:wait;color:#777}.source-formula table{border-collapse:collapse;width:100%;font-size:13px}.source-formula th,.source-formula td{border:1px solid #ddd;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}.source-formula th{background:#f3f3f3;font-weight:600}.source-formula .sf-scroll{overflow:auto}.source-formula .sf-small{color:#555;font-size:12px;overflow-wrap:anywhere}.source-formula p{overflow-wrap:anywhere}.source-formula select{width:100%;min-width:0}.source-formula label{max-width:100%}.source-formula .sf-scroll{max-width:100%;min-width:0}.source-formula .sf-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.source-formula pre{background:#f6f6f6;border:1px solid #ddd;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:520px;overflow:auto;font-size:12px}.source-formula .sf-error{border-left:3px solid #555;padding-left:9px;font-weight:600}@media(max-width:600px){.source-formula header,.source-formula section{padding:12px}.source-formula label{min-width:100%}.source-formula table{min-width:640px}}`);
  const header=el('header');header.append(el('h2',L("Original formula library","Bibliothèque des formules originales")),el('p',L("Inspect the complete original Annex formulas, shared-formula groups and actual retained native workbook outcomes.","Consultez toutes les formules originales des annexes, les groupes de formules partagées et les résultats natifs conservés des classeurs.")));
  const status=el('p',L("Opening original source collection…","Ouverture de la collection originale…"),{'role':'status'}),importButton=el('button',L("Receive original formula groups","Recevoir les groupes de formules originales"));importButton.type='button';
  const summary=el('p','',{'class':'sf-small'});header.append(status,importButton,summary);
  const filters=el('section'),controls=el('div',null,{'class':'sf-controls'}),book=el('select',null,{'aria-label':L("Original workbook","Classeur original")}),sheet=el('select',null,{'aria-label':L("Original worksheet","Feuille originale")}),search=el('input',null,{'type':'search','placeholder':L("Function, cell, group or question ID","Fonction, cellule, groupe ou identifiant de question"),'aria-label':L("Search source groups","Rechercher les groupes sources")});
  controls.append(labelled(L("Workbook","Classeur"),book),labelled(L("Worksheet","Feuille"),sheet),labelled(L("Search","Rechercher"),search));filters.append(controls);
  const listing=el('section'),count=el('p',''),scroll=el('div',null,{'class':'sf-scroll'}),table=el('table'),head=el('thead'),row=el('tr');
  for(const text of [L("Original group","Groupe original"),L("Sheets / functions","Feuilles / fonctions"),L("Members","Occurrences"),L("Native errors","Erreurs natives"),L("Questions","Questions")])row.append(el('th',text));head.append(row);const body=el('tbody');table.append(head,body);scroll.append(table);
  const actions=el('div',null,{'class':'sf-actions'}),previous=el('button',L("Previous","Précédent")),next=el('button',L("Next","Suivant"));previous.type=next.type='button';actions.append(previous,next);
  listing.append(el('h3',L("Source groups","Groupes sources")),count,scroll,actions);const detail=el('section');detail.hidden=true;container.append(style,header,filters,listing,detail);
  let collection=null,offset=0,nextOffset=null,token=0,alive=true,importRequest=null,timer=null;
  const showError=error=>{status.textContent=error?.message||String(error);status.classList.add('sf-error');};
  const sourceParams=()=>({collection_id:collection.collection_id,...(book.value?{workbook_sha256:book.value}:{}),...(sheet.value?{worksheet:sheet.value}:{}),search:search.value,offset,limit:30});
  function populateSheets(){
    const current=sheet.value;sheet.replaceChildren(el('option',L("All worksheets","Toutes les feuilles"),{'value':''}));const names=new Set();
    for(const workbook of collection.workbooks)if(!book.value||workbook.source.sha256===book.value)for(const item of workbook.sheets)names.add(item.worksheet);
    for(const name of names)sheet.append(el('option',name,{'value':name}));if(names.has(current))sheet.value=current;
  }
  async function groups(){
    if(!alive||!collection?.ready)return;const owned=++token;status.classList.remove('sf-error');text(status,L("Reading retained source groups…","Lecture des groupes sources conservés…"));
    try{const result=await rpc('source_formula_groups',sourceParams());if(!alive||owned!==token)return;body.replaceChildren();nextOffset=result.next_offset;
      text(count,uiJoin([result.total.toLocaleString(),' ',L('matching groups','groupes correspondants'),` · ${result.total?result.offset+1:0}–${Math.min(result.offset+result.groups.length,result.total)}`]));
      previous.disabled=offset===0;next.disabled=nextOffset===null;
      for(const group of result.groups){const r=el('tr'),a=el('td'),button=el('button',uiJoin([roleText(group.role),` · ${group.group_key.slice(0,12)}`]));button.type='button';button.addEventListener('click',()=>openGroup(group));a.append(button,el('div',group.sample_members.map(m=>`${m.worksheet}!${m.cell}`).join(', '),{'class':'sf-small'}));
        r.append(a,el('td',`${group.worksheets.join(', ')}\n${group.functions.join(', ')}`),el('td',group.member_count),el('td',group.native_error_members),el('td',group.question_ids.length));body.append(r);}
      text(status,L("Complete original collection is retained.","La collection originale complète est conservée."));
    }catch(error){if(owned===token)showError(error);}
  }
  async function openGroup(group){
    detail.hidden=false;detail.replaceChildren(el('h3',L("Opening source group…","Ouverture du groupe source…")));
    try{const result=await rpc('source_formula_group',{collection_id:collection.collection_id,group_key:group.group_key,workbook_sha256:group.original_workbook_sha256});if(!alive)return;
      detail.replaceChildren(el('h3',uiJoin([roleText(result.workbook.role),` · ${result.members.length} `,L('original formula occurrences','occurrences de formules originales')])),el('p',result.group.group_key,{'class':'sf-small'}));
      const edition=el('select',null,{'aria-label':L("Retained native calculation edition","Édition native de calcul conservée")});edition.append(el('option',L("Complete original workbook calculation","Calcul du classeur original complet"),{'value':''}));
      for(const job of collection.native_jobs)if(job.original_source_sha256===group.original_workbook_sha256&&!job.original_source)edition.append(el('option',`${job.created.slice(0,19)} · ${job.calculation_id.slice(0,12)} · ${job.calculated_sha256.slice(0,12)}`,{'value':job.calculation_id}));
      detail.append(labelled(L("Native edition for cell inspection","Édition native pour examiner la cellule"),edition),el('p',L("Original expressions and cached values remain separate from the selected actual native edition.","Les expressions originales et les valeurs en cache sont conservées séparément de l’édition native sélectionnée."),{'class':'sf-small'}));
      const window=el('div',null,{'class':'sf-scroll'}),members=el('table'),mh=el('tr');for(const text of [L("Source cell","Cellule source"),L("Original / inherited formula","Formule originale / héritée"),L("Original cache","Cache original"),L("Native original outcome","Résultat natif original")])mh.append(el('th',text));const mt=el('thead');mt.append(mh);const mb=el('tbody');members.append(mt,mb);window.append(members);detail.append(window);
      const page=el('div',null,{'class':'sf-actions'}),back=el('button',L("Previous occurrences","Occurrences précédentes")),forward=el('button',L("Next occurrences","Occurrences suivantes")),position=el('span','');back.type=forward.type='button';page.append(back,forward,position);detail.append(page);
      const inspect=el('div');detail.append(inspect);let start=0,selected=null;
      async function cell(record){selected=record;inspect.replaceChildren(el('p',L("Reading the exact original cell and native edition…","Lecture de la cellule originale et de son édition native…")));
        try{const value=await rpc('source_formula_cell',{collection_id:collection.collection_id,workbook_sha256:group.original_workbook_sha256,source_key:record.source_key,...(edition.value?{calculation_id:edition.value}:{})});if(!alive)return;
          const native=value.selected_native_edition||value.cell.native;inspect.replaceChildren(el('h3',`${value.cell.worksheet}!${value.cell.cell}`),el('p',uiJoin([L('Native type','Type natif'),` ${native.kind} · `,L('value','valeur'),` ${valueText(native.value)} · `,L('engine error','erreur du moteur'),` ${native.error_code}`])),el('pre',JSON.stringify(value,null,2)));}
        catch(error){inspect.replaceChildren(el('p',error?.message||String(error),{'class':'sf-error'}));}
      }
      function draw(){mb.replaceChildren();for(const record of result.members.slice(start,start+40)){const r=el('tr'),c=el('td'),button=el('button',`${record.worksheet}!${record.cell}`);button.type='button';button.addEventListener('click',()=>cell(record));c.append(button,el('div',record.sheet_state,{'class':'sf-small'}));
          r.append(c,el('td',record.original_formula||`Shared from ${record.shared_anchor}: ${record.effective_formula||record.expansion_status}`),el('td',`${record.cached_type}: ${valueText(record.cached_value)}`),el('td',`${record.native.kind}: ${valueText(record.native.value)}${record.native.error_code?` · error ${record.native.error_code}`:''}`));mb.append(r);}
        back.disabled=start===0;forward.disabled=start+40>=result.members.length;position.textContent=`${start+1}–${Math.min(start+40,result.members.length)} / ${result.members.length}`;
      }
      back.addEventListener('click',()=>{start=Math.max(0,start-40);draw();});forward.addEventListener('click',()=>{start+=40;draw();});edition.addEventListener('change',()=>{if(selected)cell(selected);});draw();
    }catch(error){detail.replaceChildren(el('p',error?.message||String(error),{'class':'sf-error'}));}
  }
  async function open(){
    collection=await rpc('source_formula_inspect',{});if(!alive)return;
    if(!collection.ready){text(status,L("Receive the retained original Annex formula collection to begin.","Recevez la collection originale des formules des annexes pour commencer."));listing.hidden=filters.hidden=true;return;}
    listing.hidden=filters.hidden=false;text(importButton,L("Refresh original source join","Actualiser la jointure de la source originale"));book.replaceChildren(el('option',L("All five original workbooks","Les cinq classeurs originaux"),{'value':''}));
    for(const workbook of collection.workbooks)book.append(el('option',uiJoin([roleText(workbook.role),` · ${workbook.formulas.toLocaleString()} `,L('formulas','formules')]),{'value':workbook.source.sha256}));populateSheets();
    const t=collection.totals;text(summary,uiJoin([`${t.formula_occurrences.toLocaleString()} `,L('original formulas','formules originales'),` · ${t.workbook_structural_groups.toLocaleString()} `,L('groups','groupes'),` · ${t.native_formula_joins.toLocaleString()} `,L('native joins','jointures natives'),` · ${collection.native_jobs.length} `,L('retained native jobs','calculs natifs conservés')]));await groups();
  }
  importButton.addEventListener('click',async()=>{importButton.disabled=true;text(status,L("Receiving the whole original formula collection and native joins…","Réception de la collection originale complète et des jointures natives…"));
    try{importRequest??='original-formula-library-'+crypto.randomUUID();await rpc('source_formula_import',{request_id:importRequest});importRequest=null;offset=0;await open();}catch(error){showError(error);}finally{importButton.disabled=false;}});
  book.addEventListener('change',()=>{populateSheets();offset=0;groups();});sheet.addEventListener('change',()=>{offset=0;groups();});search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{offset=0;groups();},250);});previous.addEventListener('click',()=>{offset=Math.max(0,offset-30);groups();});next.addEventListener('click',()=>{if(nextOffset!==null){offset=nextOffset;groups();}});
  try{await open();}catch(error){showError(error);}
  return()=>{alive=false;clearTimeout(timer);token++;container.replaceChildren();};
}
