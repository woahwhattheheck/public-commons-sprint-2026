/* Bilingual display controls. Native values and source text stay separate. */
const dictionary=await fetch('/ui-fr.json').then(async response=>{if(!response.ok)throw Error('The bilingual interface wording is unavailable.');return response.json();});
const reverse=new Map(Object.entries(dictionary).filter(([en,fr])=>en!==fr).map(([en,fr])=>[fr,en]));
const aliases=new Map([['Entreprise','Company'],['Nom de la personne-ressource','Contact name'],['Courriel','Email'],['Téléphone','Phone'],['Adresse postale','Postal address'],['Pays','Country'],['Langue','Language'],['Vos coordonnées','Your contact information'],['Votre accès au questionnaire','Your questionnaire access'],['Enregistrer les coordonnées','Save contact information'],['Coordonnées enregistrées.','Contact information saved.'],['Saisissez les coordonnées de votre entreprise. Elles seront examinées par le personnel responsable du questionnaire.','Enter your company’s contact information. Staff will review it with the original questionnaire assignment.']]);
const bindings=new WeakMap();
const attributeBindings=new WeakMap();
const editions=new Map();
let language='EN';
try{const retained=localStorage.getItem('atssc-interface-language');if(['EN','FR'].includes(retained))language=retained;}catch{}
let preference=null;
let principal=null;
let preferenceApi=null;
let session=null;

export const getLanguage=()=>language;
export const isUiText=value=>!!value&&typeof value==='object'&&value.uiDisplay===true;
function descriptor(parts){return {uiDisplay:true,parts,toString(){return renderUI(this);}};}
export function uiText(english){const value=String(english);const canonical=Object.hasOwn(dictionary,value)?value:aliases.get(value)||reverse.get(value)||value;return descriptor([{kind:'interface',value:canonical}]);}
export const uiJoin=parts=>descriptor(parts.flatMap(part=>isUiText(part)?part.parts:[{kind:'original',value:part===null||part===undefined?'':String(part)}]));
export const authoredText=(english,french)=>descriptor([{kind:'authored',value:String(english??''),french:typeof french==='string'&&french.trim()?french:null}]);
export function renderUI(value,locale=language){if(!isUiText(value))return String(value??'');return value.parts.map(part=>part.kind==='interface'&&locale==='FR'?(dictionary[part.value]??part.value):part.kind==='authored'&&locale==='FR'&&part.french?part.french:part.value).join('');}
export function appendDisplay(parent,value){const node=document.createTextNode(renderUI(value));if(isUiText(value))bindings.set(node,value);parent.append(node);return node;}
export function setDisplayAttribute(node,name,value){if(isUiText(value)){const map=attributeBindings.get(node)||new Map();map.set(name,value);attributeBindings.set(node,map);}node.setAttribute(name,renderUI(value));}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function htmlDisplay(value,tag='span'){if(!isUiText(value))return escape(value);return '<'+tag+' data-ui-parts="'+escape(JSON.stringify(value.parts))+'">'+escape(renderUI(value))+'</'+tag+'>';}
export function htmlOption(value){return isUiText(value)?' data-ui-parts="'+escape(JSON.stringify(value.parts))+'"':'';}
export function uiHTML(fragment){
  const attributed=fragment.replace(/<[^>]*>/g,tag=>{const attrs={};const changed=tag.replace(/(placeholder|aria-label|title)="([^"]*)"/g,(_,name,value)=>{attrs[name]=uiText(value).parts;return name+'="'+escape(renderUI(uiText(value)))+'"';});return Object.keys(attrs).length?changed.replace(/>$/,' data-ui-attributes="'+escape(JSON.stringify(attrs))+'">'):changed;});
  // A literal can finish an opening tag begun before an interpolated native
  // value. Keep those delimiters intact; mark only actual visible text.
  return attributed.replace(/(^|>)([^<>]+)(?=<|$)/g,(_,prefix,value)=>prefix+(/[A-Za-zÀ-ÿ]/.test(value)?htmlDisplay(uiText(value)):value));
}
function apply(root=document){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){const value=bindings.get(node);if(value&&node.nodeValue!==renderUI(value))node.nodeValue=renderUI(value);}
  const nodes=root.querySelectorAll?.('*')||[];
  for(const el of nodes){
    const attrs=attributeBindings.get(el);if(attrs)for(const[name,value]of attrs)el.setAttribute(name,renderUI(value));
    if(el.dataset.uiParts){try{const value=renderUI(descriptor(JSON.parse(el.dataset.uiParts)));if(el.textContent!==value)el.textContent=value;}catch{}}
    if(el.dataset.uiAttributes){try{for(const[name,parts]of Object.entries(JSON.parse(el.dataset.uiAttributes)))el.setAttribute(name,renderUI(descriptor(parts)));}catch{}}
    if(el.dataset.languageSelect!==undefined)el.value=language;
    if(el.matches('textarea,input[type="text"],input:not([type])')&&!el.matches('.code,[spellcheck="false"],[data-no-spellcheck]')){el.setAttribute('lang',language==='FR'?'fr-CA':'en-CA');el.spellcheck=true;}
    if(el.matches('input[type="file"]')&&el.dataset.languageFilePicker===undefined){
      el.dataset.languageFilePicker='';const holder=document.createElement('div');holder.className='native-file-picker';holder.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:100%';el.parentNode.insertBefore(holder,el);holder.append(el);el.hidden=true;
      const chooser=document.createElement('button');chooser.type='button';chooser.disabled=el.disabled;appendDisplay(chooser,uiText('Choose file'));chooser.addEventListener('click',()=>{if(!el.disabled)el.click();});
      const filename=document.createElement('span');filename.style.cssText='overflow-wrap:anywhere;min-width:0;max-width:100%;font-weight:400';const showFiles=()=>{filename.replaceChildren();appendDisplay(filename,el.files?.length?[...el.files].map(file=>file.name).join(', '):uiText('No file selected'));};el.addEventListener('change',showFiles);showFiles();holder.append(chooser,filename);
    }
  }
}
export function setLanguage(value){if(!['EN','FR'].includes(value))throw Error('Select EN or FR.');language=value;document.documentElement.lang=value==='FR'?'fr-CA':'en-CA';document.title=renderUI(uiText('Questionnaire Operations'));try{localStorage.setItem('atssc-interface-language',value);}catch{}apply();document.dispatchEvent(new CustomEvent('atssc-language-change',{detail:{language:value}}));}
new MutationObserver(records=>{for(const record of records)for(const child of record.addedNodes)if(child.nodeType===Node.ELEMENT_NODE)apply(child.parentNode||child);}).observe(document.documentElement,{childList:true,subtree:true});
setLanguage(language);

export async function initializeLanguage(api,record){preferenceApi=api;session=record;const key=record?.authenticated?(record.role==='respondent'?'respondent:'+record.respondent_id:'operator'):null;if(key===principal)return preference;principal=key;preference=null;if(!key)return null;preference=await api('language.get_preference',{});if(preference.version)setLanguage(preference.language);return preference;}
async function savePreference(value){if(!principal||!preferenceApi)return;const send=()=>preferenceApi('language.set_preference',{language:value,expected_version:preference?.version||0});try{preference=await send();}catch(error){if(error?.code!=='VERSION_CONFLICT')throw error;preference=await preferenceApi('language.get_preference',{});preference=await send();}}
export function mountLanguageControl(container){
  if(!container||container.querySelector(':scope > .language-control'))return;
  const holder=document.createElement('div');holder.className='language-control';holder.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:100%;margin:10px 0;font-size:14px';
  const label=document.createElement('label');const id='language-'+crypto.randomUUID();label.htmlFor=id;appendDisplay(label,uiText('Language'));
  const picker=document.createElement('select');picker.id=id;picker.dataset.languageSelect='';picker.setAttribute('aria-label','Language / Langue');picker.style.cssText='width:auto;max-width:100%;min-width:100px';for(const[key,title]of [['EN','English'],['FR','Français']]){const option=document.createElement('option');option.value=key;option.textContent=title;option.lang=key==='FR'?'fr-CA':'en-CA';picker.append(option);}picker.value=language;
  const status=document.createElement('span');status.setAttribute('role','status');status.style.cssText='font-size:12px;max-width:100%;overflow-wrap:anywhere';
  picker.addEventListener('change',async()=>{const value=picker.value;setLanguage(value);picker.disabled=true;status.replaceChildren();try{await savePreference(value);if(principal)appendDisplay(status,uiText('Language preference saved.'));}catch{appendDisplay(status,uiText('Language preference could not be saved. Your current answers are retained.'));}finally{picker.disabled=false;}});
  holder.append(label,picker,status);container.append(holder);apply();
}

export async function loadDisplayWording(api,params){const result=await api('language.get_translations',{language:'FR',...params});editions.set(result.questionnaire_id+':'+result.definition_version,result);return result;}
export function definitionDisplay(edition,definition){return authoredText(definition.title||'Questionnaire',edition?.translations?.title);}
export function questionDisplay(edition,question,column=null,property='label'){const wording=edition?.translations?.questions?.[question.id]||{};const field=column?wording.columns?.[column.id]||{}:wording;const original=column||question;const rowLabel=!column&&property==='label'&&question.original_context?.length?question.original_row_label:null;const sourceFrench=!column&&property==='label'?(question.original_row_french_label||(question.original_question_text?.trim()===question.label?.trim()?edition?.original_french_text?.[question.id]:null)):null;return authoredText(rowLabel||original[property]||'',field[property]||sourceFrench);}
export function choiceDisplay(edition,question,value,column=null){const wording=edition?.translations?.questions?.[question.id]||{};const original=column||question;return authoredText(original.original_choice_labels?.[value]||value,(column?wording.columns?.[column.id]:wording)?.choices?.[value]||original.original_choice_french_labels?.[value]);}

export async function renderWordingEditor({container,api,element,field,input,button,text,table,definition,questionnaireId,definitionVersion,notice}){
  if(!definitionVersion)return;
  let saved=await loadDisplayWording(api,{questionnaire_id:questionnaireId,definition_version:definitionVersion});let draft=structuredClone(saved.translations);let page=0;
  const heading=element('h2',{},uiText('French display wording'));
  const panel=element('section',{class:'panel',id:'display-wording-editor'},heading,text(uiText('Display wording is separate from the original workbook and answer values.')));container.append(panel);
  const body=element('div');panel.append(body);
  function draw(){
    body.replaceChildren();const title=input(draft.title||'');title.addEventListener('input',()=>draft.title=title.value);body.append(field(uiText('French display title'),title),text(uiJoin([uiText('Display wording version'),' ',saved.version]),'hint'));
    const rows=[];for(const question of definition.questions.slice(page*20,page*20+20)){
      const wording=draft.questions[question.id]??={};const label=input(wording.label||'');label.dataset.wordingQuestion=question.id;label.addEventListener('input',()=>wording.label=label.value);
      const controls=element('div',{},field(uiText('Question label'),label));const originalFrench=saved.original_french_text?.[question.id];if(originalFrench){controls.append(field(uiText('Original French source text'),text(originalFrench,'hint')));if(question.original_question_text?.trim()===question.label?.trim())controls.append(button(uiText('Use original French text'),async()=>{wording.label=originalFrench;label.value=originalFrench;}));}
      const addChoices=(original,target)=>{for(const value of original.choices||[]){target.choices??={};const control=input(target.choices[value]||'');control.dataset.wordingChoice=value;control.addEventListener('input',()=>target.choices[value]=control.value);controls.append(field(uiJoin([uiText('Choice display label'),' · ',value]),control));}};addChoices(question,wording);
      for(const column of question.columns||[]){wording.columns??={};const target=wording.columns[column.id]??={};const control=input(target.label||'');control.dataset.wordingColumn=column.id;control.addEventListener('input',()=>target.label=control.value);controls.append(field(uiJoin([uiText('Column label'),' · ',column.label]),control));addChoices(column,target);}
      rows.push([element('div',{},text(question.label),text(question.id,'hint')),controls]);
    }
    body.append(table([uiText('Original wording'),uiText('Authored French wording')],rows),element('div',{class:'pager'},button(uiText('Previous'),async()=>{if(page>0){page--;draw();}}),text((page*20+1)+'–'+Math.min(page*20+20,definition.questions.length)+' / '+definition.questions.length),button(uiText('Next'),async()=>{if((page+1)*20<definition.questions.length){page++;draw();}})),text(uiText('Only display labels change. Original answers, sources and published definitions stay retained.'),'hint'),element('div',{class:'actions'},button(uiText('Save display wording'),async()=>{saved={...saved,...await api('language.save_translations',{questionnaire_id:questionnaireId,definition_version:definitionVersion,language:'FR',expected_version:saved.current_version,translations:draft})};editions.set(questionnaireId+':'+definitionVersion,saved);notice(uiText('Display wording saved.'));draw();},true),button(uiText('Reload display wording'),async()=>{saved=await loadDisplayWording(api,{questionnaire_id:questionnaireId,definition_version:definitionVersion});draft=structuredClone(saved.translations);draw();})));
  }
  draw();
}
