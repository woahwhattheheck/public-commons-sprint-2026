import {authoredText,appendDisplay,setDisplayAttribute,mountLanguageControl,initializeLanguage,uiJoin,renderUI} from '/locale.mjs';
const wording={
  "Workbook Exchange": "Échange de classeurs",
  "Original cells, questionnaire mappings and editable Excel editions.": "Cellules originales, correspondances du questionnaire et éditions Excel modifiables.",
  "Questionnaire workspace": "Espace de travail du questionnaire",
  "Refresh": "Actualiser",
  "Original workbook editions": "Éditions originales des classeurs",
  "Retained workbook": "Classeur conservé",
  "Open workbook": "Ouvrir le classeur",
  "Download unchanged original": "Télécharger l’original inchangé",
  "Retain another complete XLSX edition": "Conserver une autre édition XLSX complète",
  "Workbook": "Classeur",
  "Original URL": "URL originale",
  "Retain workbook": "Conserver le classeur",
  "Choose the complete XLSX file.": "Choisissez le fichier XLSX complet.",
  "Source cells": "Cellules sources",
  "Worksheet": "Feuille",
  "Cell range": "Plage de cellules",
  "Read range": "Lire la plage",
  "Original names, styles and workbook structure": "Noms, styles et structure du classeur original",
  "Cell": "Cellule",
  "State": "État",
  "Value / cached value": "Valeur / valeur en cache",
  "Original formula": "Formule originale",
  "Edit": "Modifier",
  "Calculation cell": "Cellule de calcul",
  "Select": "Sélectionner",
  "Editable answer edition": "Édition modifiable des réponses",
  "Select original answer cells, review explicit value types, then retain and download the successor workbook.": "Sélectionnez les cellules de réponse originales, vérifiez leurs types de valeur, puis conservez et téléchargez le classeur suivant.",
  "Read cell for editing": "Lire la cellule à modifier",
  "This is an original calculation cell. Select its source answer cells.": "Il s’agit d’une cellule de calcul originale. Sélectionnez les cellules de réponse qui l’alimentent.",
  "Text": "Texte",
  "Exact decimal": "Nombre décimal exact",
  "Boolean": "Booléen",
  "ISO date": "Date ISO",
  "Blank cell": "Cellule vide",
  "Remove physical cell": "Supprimer la cellule physique",
  "New type": "Nouveau type",
  "New value": "Nouvelle valeur",
  "Use true or false for Boolean values. Blank and absent ignore this field.": "Utilisez true ou false pour les valeurs booléennes. Les états vide et absent ignorent ce champ.",
  "Add to reviewed edition": "Ajouter à l’édition vérifiée",
  "Enter true or false.": "Saisissez true ou false.",
  "Source cell": "Cellule source",
  "Type": "Type",
  "Value": "Valeur",
  "Selection": "Sélection",
  "Remove": "Supprimer",
  "Download editable change selection": "Télécharger la sélection modifiable des changements",
  "Retain and download Excel edition": "Conserver et télécharger l’édition Excel",
  "Questionnaire source mapping": "Correspondances des sources du questionnaire",
  "Save the original questionnaire definition in the main workspace to inspect and exchange its bound cells.": "Enregistrez la définition originale du questionnaire dans l’espace principal pour examiner et échanger les cellules liées.",
  "Saved definition": "Définition enregistrée",
  "Read source mapping": "Lire les correspondances sources",
  "Inspect formulas separately": "Examiner les formules séparément",
  "Use selected edition cached values": "Utiliser les valeurs en cache de l’édition sélectionnée",
  "Question": "Question",
  "Source": "Source",
  "Scale": "Échelle",
  "Access": "Accès",
  "Disclosure": "Divulgation",
  "Authored question": "Question rédigée",
  "Calculated": "Calculé",
  "Original fixed value": "Valeur originale fixe",
  "Answer input": "Saisie de réponse",
  "Original template identity": "Identité du modèle original",
  "Formula value selection": "Sélection des valeurs de formule",
  "Download editable source mapping": "Télécharger les correspondances sources modifiables",
  "Download Excel and complete source records": "Télécharger Excel et les données sources complètes",
  "Extract mapped values and source states": "Extraire les valeurs liées et les états sources",
  "Extraction review": "Vérification de l’extraction",
  "Original row": "Ligne originale",
  "Validation and source review": "Validation et vérification des sources",
  "Open the operator workspace to work with original workbooks.": "Ouvrez l’espace de l’opérateur pour travailler avec les classeurs originaux.",
  "Open operator session": "Ouvrir une session opérateur",
  "Absent cell": "Cellule absente",
  "Blank · empty value node": "Vide · nœud de valeur vide",
  "Blank · no value node": "Vide · sans nœud de valeur",
  "Text · empty string": "Texte · chaîne vide",
  "Received download length differs from the native file.": "La taille téléchargée diffère de celle du fichier natif.",
  "Received workbook hash differs from the retained native edition.": "L’empreinte du classeur reçu diffère de celle de l’édition native conservée."
};
wording['Original formula review issues']='Problèmes à examiner dans les formules originales';
wording['Reading original source mapping…']='Lecture des correspondances sources originales…';
wording['The selected original workbook changed. Read its current cell again.']='Le classeur original sélectionné a changé. Relisez sa cellule actuelle.';
wording['number']='nombre';wording['text']='texte';wording['boolean']='booléen';wording['date']='date';wording['error']='erreur';
const t=value=>authoredText(value,wording[value]);
const root = document.querySelector('#exchange');
const pendingRequests = new Map();
let activeAction = false;
function actionControls() {
  for(const control of root.querySelectorAll('button')) control.disabled=activeAction;
}
const model = {status:null, book:null, sheet:null, definition:null, template:null, formulaValues:'preserve', edits:[], cells:{}, source:null, inspectGeneration:0, rangeGeneration:0, mappingGeneration:0};
function node(tag, props={}, ...children) {
  const n=document.createElement(tag);
  for(const [key,value] of Object.entries(props)) {
    if(key.startsWith('on')) n.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='value') n.value=value;
    else if(key==='text') n.textContent=value;
    else if(value!==null && value!==undefined) setDisplayAttribute(n,key,value);
  }
  for(const child of children.flat()) if(child!==null && child!==undefined) (child instanceof Node?n.append(child):appendDisplay(n,child));
  if(activeAction && n.tagName==='BUTTON') n.disabled=true;
  return n;
}
const text=value=>node('p',{},value);
function select(items,value) {const n=node('select');for(const [key,label] of items)n.append(node('option',{value:key},label));if(value!==undefined)n.value=value;return n;}
const input=(value='',type='text')=>node('input',{type,value});
const field=(label,n,hint)=>{setDisplayAttribute(n,'aria-label',label);return node('label',{class:'field'},node('span',{},label),n,hint?node('small',{},hint):null);};
function error(err) {
  let notice=document.querySelector('#notice');
  if(!notice){notice=node('div',{id:'notice',role:'status','aria-live':'polite'});root.prepend(notice);}
  notice.replaceChildren(text(err.message||JSON.stringify(err)));
}
async function guard(fn) {try {document.querySelector('#notice')?.replaceChildren();return await fn();}catch(err){error(err);}}
const button=(label,fn)=>node('button',{type:'button',onclick:async()=>{
  if(activeAction)return;
  activeAction=true;actionControls();
  try {await guard(fn);}
  finally {activeAction=false;actionControls();}
}},label);
async function api(method,params={}) {
  const signature=JSON.stringify({method,params});
  const mutation=['import_workbook','exchange_export','exchange_export_answers'].includes(method);
  if(mutation && !pendingRequests.has(signature))pendingRequests.set(signature,crypto.randomUUID());
  const effective=mutation?{...params,request_id:pendingRequests.get(signature)}:params;
  const response=await fetch('/api/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params:effective})});
  const body=await response.json();
  if(!response.ok || body.error)throw body.error||Error(response.statusText);
  pendingRequests.delete(signature);
  return body.result;
}
function table(headers,rows) {return node('div',{class:'scroll'},node('table',{},node('thead',{},node('tr',{},headers.map(h=>node('th',{},h)))),node('tbody',{},rows.map(r=>node('tr',{},r.map(c=>node('td',{},c)))))));}
function download(name,raw,mime) {
  const url=URL.createObjectURL(new Blob([raw],{type:mime}));
  const link=node('a',{href:url,download:name});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadFile(result) {
  const raw=Uint8Array.from(atob(result.data_base64),c=>c.charCodeAt(0));
  if(raw.byteLength!==result.bytes)throw Error(renderUI(t('Received download length differs from the native file.')));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==result.sha256)throw Error(renderUI(t('Received workbook hash differs from the retained native edition.')));
  download(result.name,raw,result.mime_type);
}
const downloadJSON=(name,data)=>download(name,JSON.stringify(data,null,2)+'\n','application/json');
function encodeBase64(bytes) {let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
function stateText(cell) {
  if(!cell || !cell.present)return t('Absent cell');
  if(cell.state==='blank')return cell.value_node_present?t('Blank · empty value node'):t('Blank · no value node');
  if(cell.state==='text' && cell.value==='')return t('Text · empty string');
  if(cell.state==='formula')return uiJoin([authoredText('Formula · ','Formule · '),cell.cached?.present?uiJoin([authoredText('cached ','en cache '),cell.cached.kind]):authoredText('cache absent','cache absent')]);
  return t(cell.state);
}
async function refresh() {
  model.status=await api('status');
  if(!model.book && model.status.workbooks.length)model.book=model.status.workbooks[0].sha;
  await render();
}
async function render() {
  root.replaceChildren(node('header',{},node('div',{},node('h1',{},t('Workbook Exchange')),text(t('Original cells, questionnaire mappings and editable Excel editions.'))),node('nav',{},node('a',{href:'/operator'},t('Questionnaire workspace')),button(t('Refresh'),refresh))));
  mountLanguageControl(root.querySelector('header nav'));
  root.append(node('div',{id:'notice',role:'status','aria-live':'polite'}));
  const workbooks=select(model.status.workbooks.map(w=>[w.sha,w.name]),model.book);
  workbooks.addEventListener('change',()=>guard(async()=>{model.book=workbooks.value;model.sheet=null;model.edits=[];await inspect();}));
  const sourceFile=input('','file');sourceFile.accept='.xlsx';
  const sourceUrl=input('','url');
  const source=node('section',{class:'panel'},node('h2',{},t('Original workbook editions')),
    node('div',{class:'row'},field(t('Retained workbook'),workbooks),button(t('Open workbook'),inspect),
      button(t('Download unchanged original'),async()=>downloadFile(await api('exchange_download_original',{sha256:model.book})))),
    node('details',{},node('summary',{},t('Retain another complete XLSX edition')),
      field(t('Workbook'),sourceFile),field(t('Original URL'),sourceUrl),
      button(t('Retain workbook'),async()=>{
        const f=sourceFile.files[0];if(!f)throw Error(renderUI(t('Choose the complete XLSX file.')));
        const bytes=new Uint8Array(await f.arrayBuffer());
        const result=await api('import_workbook',{name:f.name,data_base64:encodeBase64(bytes),source_url:sourceUrl.value||null});
        model.book=result.sha256;model.edits=[];await refresh();await inspect();
      })));
  root.append(source,node('section',{class:'panel',id:'source-inspector'}),node('section',{class:'panel',id:'mapping-panel'}),node('section',{class:'panel',id:'editions-panel'}));
  actionControls();
  if(model.book)await inspect();
  await mappings();
}
async function inspect() {
  if(!model.book)return;
  const book=model.book,generation=++model.inspectGeneration;
  const received=await api('exchange_inspect',{sha256:book});
  if(book!==model.book||generation!==model.inspectGeneration)return;
  model.source=received;
  const summary=model.source;
  if(!summary.sheets.some(s=>s.name===model.sheet))model.sheet=summary.sheets[0]?.name;
  const sheet=select(summary.sheets.map(s=>[s.name,s.name+' · '+s.state]),model.sheet);
  const range=input('A1:H30');
  const grid=node('div',{id:'cell-grid'});
  const panel=document.querySelector('#source-inspector');
  panel.replaceChildren(node('h2',{},t('Source cells')),
    text(uiJoin([summary.counts.cells.toLocaleString(),authoredText(' physical cells · ',' cellules physiques · '),summary.counts.formulas.toLocaleString(),authoredText(' formulas · ',' formules · '),summary.counts.errors.toLocaleString(),authoredText(' original error cells · ',' cellules d’erreur originales · '),summary.counts.hidden_sheets,authoredText(' hidden sheets',' feuilles masquées')])),
    node('p',{class:'identity'},summary.sha256),
    node('div',{class:'row'},field(t('Worksheet'),sheet),field(t('Cell range'),range),button(t('Read range'),draw)),
    grid,node('details',{},node('summary',{},t('Original names, styles and workbook structure')),node('pre',{},JSON.stringify({date1904:summary.date1904,defined_names:summary.defined_names,styles:summary.styles,sheets:summary.sheets.map(s=>({name:s.name,state:s.state,dimension:s.dimension,counts:s.counts,structure:s.structure}))},null,2))));
  async function draw() {
    const selectedSheet=sheet.value,request=++model.rangeGeneration;
    model.sheet=sheet.value;
    const result=await api('exchange_inspect',{sha256:book,sheet:selectedSheet,range:range.value});
    if(book!==model.book||generation!==model.inspectGeneration||request!==model.rangeGeneration||!panel.isConnected)return;
    model.cells=result.sheets[0].cells;
    grid.replaceChildren(table([t('Cell'),t('State'),t('Value / cached value'),t('Original formula'),t('Edit')],Object.entries(model.cells).map(([address,cell])=>[
      address,stateText(cell),cell.value===null?'':String(cell.value),
      cell.formula?node('code',{},cell.formula.text):'',
      cell.formula?text(t('Calculation cell')):button(t('Select'),async()=>editCell(selectedSheet,address,cell,book))
    ])));
  }
  await draw();if(book===model.book&&generation===model.inspectGeneration&&panel.isConnected)editPanel();
}
function editPanel() {
  const panel=document.querySelector('#editions-panel');
  const sheet=select(model.source.sheets.map(s=>[s.name,s.name]),model.sheet);
  const address=input('');
  panel.replaceChildren(node('h2',{},t('Editable answer edition')),
    text(t('Select original answer cells, review explicit value types, then retain and download the successor workbook.')),
    node('div',{class:'row'},field(t('Worksheet'),sheet),field(t('Cell'),address),
      button(t('Read cell for editing'),async()=>{
        const book=model.book,selectedSheet=sheet.value;
        const result=await api('exchange_inspect',{sha256:book,sheet:selectedSheet,cells:[address.value.trim().toUpperCase()]});
        if(book!==model.book)return;
        const [a,c]=Object.entries(result.sheets[0].cells)[0];editCell(selectedSheet,a,c,book);
      })),
    node('div',{id:'cell-editor'}),node('div',{id:'selected-edits'}));
  selectedEdits();
}
function editCell(sheet,address,cell,book=model.book) {
  if(book!==model.book)throw Error(renderUI(t('The selected original workbook changed. Read its current cell again.')));
  if(cell.formula)throw Error(renderUI(t('This is an original calculation cell. Select its source answer cells.')));
  const kind=select([['text',t('Text')],['number',t('Exact decimal')],['boolean',t('Boolean')],['date',t('ISO date')],['blank',t('Blank cell')],['absent',t('Remove physical cell')]],['text','number','boolean','date','blank','absent'].includes(cell.state)?cell.state:'text');
  const value=input(cell.value===null?'':String(cell.value));
  const editor=document.querySelector('#cell-editor');
  editor.replaceChildren(node('h3',{},sheet+'!'+address),text(uiJoin([authoredText('Original state: ','État original : '),stateText(cell)])),
    node('div',{class:'row'},field(t('New type'),kind),field(t('New value'),value,t('Use true or false for Boolean values. Blank and absent ignore this field.'))),
    button(t('Add to reviewed edition'),async()=>{
      if(book!==model.book)throw Error(renderUI(t('The selected original workbook changed. Read its current cell again.')));
      let scalar=value.value;
      if(kind.value==='boolean'){if(!['true','false'].includes(scalar))throw Error(renderUI(t('Enter true or false.')));scalar=scalar==='true';}
      if(['blank','absent'].includes(kind.value))scalar=null;
      const edit={sheet,cell:address,kind:kind.value,value:scalar,expected_cell_identity:cell.identity};
      const index=model.edits.findIndex(x=>x.sheet===sheet&&x.cell===address);
      if(index<0)model.edits.push(edit);else model.edits[index]=edit;
      selectedEdits();
    }));
}
function selectedEdits() {
  const holder=document.querySelector('#selected-edits');if(!holder)return;
  holder.replaceChildren(table([t('Source cell'),t('Type'),t('Value'),t('Selection')],model.edits.map((e,index)=>[
    e.sheet+'!'+e.cell,e.kind,e.value===null?'':String(e.value),
    button(t('Remove'),async()=>{model.edits.splice(index,1);selectedEdits();})
  ])),node('div',{class:'actions'},
    button(t('Download editable change selection'),async()=>downloadJSON('workbook-cell-selection.json',{sha256:model.book,changes:model.edits})),
    button(t('Retain and download Excel edition'),async()=>{
      const book=model.book,changes=structuredClone(model.edits);
      const result=await api('exchange_export',{sha256:book,changes,retain:true});
      await downloadFile(result);downloadJSON('workbook-exchange-manifest.json',result.metadata);
      if(book===model.book&&JSON.stringify(changes)===JSON.stringify(model.edits)){model.edits=[];model.book=result.sha256;await refresh();}
      document.querySelector('#notice').replaceChildren(text(uiJoin([authoredText('Retained Excel edition ','Édition Excel conservée '),result.sha256,authoredText('. The original workbook remains available above.','. Le classeur original reste disponible ci-dessus.')])));
    })));
}
async function mappings() {
  const panel=document.querySelector('#mapping-panel');
  const defined=model.status.questionnaires.filter(q=>q.version>0);
  if(!defined.length){panel.replaceChildren(node('h2',{},t('Questionnaire source mapping')),text(t('Save the original questionnaire definition in the main workspace to inspect and exchange its bound cells.')));return;}
  if(!defined.some(q=>q.id===model.definition))model.definition=defined[0].id;
  const questionnaire=select(defined.map(q=>[q.id,q.name+' · edition '+q.version]),model.definition);
  const holder=node('div');
  panel.replaceChildren(node('h2',{},t('Questionnaire source mapping')),
    field(t('Saved definition'),questionnaire),button(t('Read source mapping'),draw),holder);
  async function draw() {
    const generation=++model.mappingGeneration;
    holder.replaceChildren(text(t('Reading original source mapping…')));
    const selected=defined.find(q=>q.id===questionnaire.value);
    model.definition=selected.id;
    const params={questionnaire_id:selected.id,version:selected.version};
    const mapping=await api('exchange_mapping',params);
    if(generation!==model.mappingGeneration||!panel.isConnected)return;
    if(!mapping.source_workbooks.includes(model.template))model.template=mapping.source_workbooks[0];
    const templates=select(mapping.source_workbooks.map(sha=>[sha,model.status.workbooks.find(w=>w.sha===sha)?.name||sha]),model.template);
    templates.addEventListener('change',()=>{model.template=templates.value;});
    const formula=select([['preserve',t('Inspect formulas separately')],['cached',t('Use selected edition cached values')]],model.formulaValues);
    formula.addEventListener('change',()=>{model.formulaValues=formula.value;});
    holder.replaceChildren(table([t('Question'),t('Type'),t('Source'),t('Scale'),t('Access'),t('Disclosure')],mapping.questions.map(q=>[
      sourceLabel(q),t(q.kind),q.binding?(q.binding.sheet+'!'+(q.binding.cell||(q.source_rows.length<=16?q.source_rows.join(', '):q.source_rows.length+' selected rows'))):t('Authored question'),
      q.workbook_scale,q.calculated?t('Calculated'):q.source_readonly?t('Original fixed value'):t('Answer input'),q.disclosure||'protected'
    ])),field(t('Original template identity'),templates),
    field(t('Formula value selection'),formula),
    node('div',{class:'actions'},
      button(t('Download editable source mapping'),async()=>downloadJSON('questionnaire-source-mapping.json',mapping)),
      button(t('Download Excel and complete source records'),async()=>downloadFile(await api('exchange_extract_package',{...params,sha256:model.book,template_sha256:templates.value,formula_values:formula.value}))),
      button(t('Extract mapped values and source states'),async()=>{
        const book=model.book,template=templates.value;
        const extracted=await api('exchange_extract',{...params,sha256:book,template_sha256:template,formula_values:formula.value});
        downloadJSON('workbook-source-extraction.json',extracted);
        if(generation!==model.mappingGeneration||book!==model.book||template!==model.template||!holder.isConnected)return;
        const result=node('section',{class:'panel'},node('h3',{},t('Extraction review')),
          text(uiJoin([extracted.cells.length,authoredText(' source cells · ',' cellules sources · '),extracted.validation.issues.length,authoredText(' answer validation issues · ',' problèmes de validation des réponses · '),extracted.validation.formula_issues.length,authoredText(' original formula review issues',' problèmes à examiner dans les formules originales')])),
          table([t('Question'),t('Original row'),t('Cell'),t('State'),t('Value')],extracted.cells.map(c=>[c.label,c.source_row??'',c.source.sheet+'!'+c.source.cell,stateText(c.cell),c.cell.value??''])),
          node('details',{},node('summary',{},t('Validation and source review')),node('pre',{},JSON.stringify(extracted.validation,null,2))));
        document.querySelector('#extraction-review')?.remove();result.id='extraction-review';holder.append(result);
      })));
  }
  questionnaire.addEventListener('change',()=>guard(draw));
  await draw();
}
function sourceLabel(question){const context=(question.original_context||[]).map(x=>x.french_text||x.text).filter(Boolean);const row=question.original_row_french_label||question.original_french_text;return authoredText(question.label,row?[...context,row].join(' — '):question.label);}
async function start() {
  const session=await fetch('/api/session').then(r=>r.json());
  if(!session.authenticated || session.role!=='operator'){
    root.replaceChildren(node('h1',{},t('Workbook Exchange')),text(t('Open the operator workspace to work with original workbooks.')),node('a',{href:'/operator'},t('Open operator session')));return;
  }
  await initializeLanguage(api,session);
  await refresh();
}
start().catch(err=>{root.replaceChildren(node('h1',{},t('Workbook Exchange')),node('div',{id:'notice'}));error(err);});
