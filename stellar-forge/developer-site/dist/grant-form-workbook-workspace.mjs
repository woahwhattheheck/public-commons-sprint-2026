// MIT. Complete issuer-form worksheet preparation and reviewed return.
import {createFormWorkbook,openFormWorkbook,reviewFormWorkbook,applyFormWorkbook,formWorkbookReferenceText,convertFormWorkbookSheets,MAX_FORM_WORKBOOK_BYTES} from './grant-form-workbook.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el;};
const key=draft=>draft?draft.id+'\n'+draft.createdAt:'';
const valueText=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
export function createFormWorkbookPanel(host){
  let root=null,identity='',workbook=null,profile='',fields='',separator=',',review=null,decisions=Object.create(null),epoch=0,expanded=false;
  function current(){return host.getDraft();}
  function reset(){workbook=null;profile='';fields='';separator=',';review=null;decisions=Object.create(null);epoch++;}
  function active(token,basis){return token===epoch&&key(current())===basis;}
  function changed(){host.onWorkingChange?.();review=null;decisions=Object.create(null);root?.querySelector('[data-form-workbook-review]')?.remove();}
  function button(label,action){const el=node('button',label);el.type='button';el.addEventListener('click',()=>host.work(action));return el;}
  function select(label,value,options,action){const wrap=node('label',undefined,'field'),el=node('select');for(const [id,title]of options){const option=node('option',title);option.value=id;el.append(option);}el.value=value;el.addEventListener('change',()=>action(el.value));wrap.append(node('span',label),el);return wrap;}
  async function read(file,maximum){if(!file||file.size>maximum)throw new Error('Choose a complete UTF-8 file within '+maximum+' bytes.');const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size||bytes.length>maximum)throw new Error('The selected file changed during reading.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  function choose(label,accept,maximum,receive){return button(label,()=>{
    const input=node('input');input.type='file';input.accept=accept;input.hidden=true;document.body.append(input);
    const token=epoch,basis=key(current());
    const cleanup=()=>input.remove();
    input.addEventListener('change',()=>{const file=input.files?.[0];cleanup();if(!file)return;host.work(async()=>{
      if(!active(token,basis))return;const text=await read(file,maximum);if(!active(token,basis))return;await receive(text,file,token,basis);
    });},{once:true});input.addEventListener('cancel',cleanup,{once:true});input.click();
  });}
  function save(text,name,type='application/json'){host.download(text,name,type);}
  const name=suffix=>'issuer-form-'+suffix;
  function retained(){return{...clone(workbook),sheets:{delimiter:separator,cellEncoding:'apostrophe-v1',profile,fields}};}
  async function prepare(){
    const token=++epoch,basis=key(current()),source=clone(current()),next=await createFormWorkbook(source,{delimiter:separator});
    if(!active(token,basis))return;workbook=next;profile=next.sheets.profile;fields=next.sheets.fields;changed();expanded=true;render();host.status('Prepared a workbook from the current actual form and complete answer references.');
  }
  async function open(text,file,token,basis){
    const next=await openFormWorkbook(text,current());if(!active(token,basis))return;
    workbook=next;profile=next.sheets.profile;fields=next.sheets.fields;separator=next.sheets.delimiter;changed();expanded=true;render();host.status('Opened the original workbook baseline and its retained worksheet text.');
  }
  async function inspect(){
    const token=epoch,basis=key(current()),source=clone(current()),next=await reviewFormWorkbook(source,workbook,{profile,fields,delimiter:separator},decisions);
    if(!active(token,basis))return;review=next;render();host.status(next.unresolved.length?'Choose each conflicting returned or current value.':'The complete worksheet return is ready to apply to the original form.');
  }
  async function apply(){
    if(!review)throw new Error('Review the current sheets first.');
    const token=epoch,basis=key(current()),expected=review.reviewSha256,source=clone(current());
    const result=await applyFormWorkbook(source,workbook,{profile,fields,delimiter:separator},{expectedReviewSha256:expected,decisions});
    if(!active(token,basis))return;
    // The original host owns draft replacement, dirty state and native save.
    host.onApply(result.draft,result.changed);review=null;decisions=Object.create(null);render();
    host.status(result.changed?'Applied the selected worksheet changes. The original form-map import retained the preceding version; Save keeps this draft in the existing library.':'The selected form already matches the current draft.');
  }
  function textarea(label,value,onInput){const wrap=node('label',undefined,'field'),area=node('textarea');area.value=value;area.rows=8;area.spellcheck=false;area.addEventListener('input',()=>onInput(area.value));wrap.append(node('span',label),area);return wrap;}
  function renderReview(box){
    if(!review)return;
    const section=node('section',undefined,'card');section.dataset.formWorkbookReview='';
    section.append(node('h4','Review returned form'),node('p',review.counts.changes+' changes · '+review.counts.conflicts+' conflicts · '+review.counts.alreadyCurrent+' already current'));
    for(const change of review.changes){
      const details=node('details');details.append(node('summary',change.label+' · '+change.status));
      for(const [label,value]of [['Original workbook',change.before],['Current draft',change.current],['Returned worksheet',change.incoming]])details.append(node('h5',label),node('pre',valueText(value),'source-text'));
      const options=change.status==='conflict'?[['','Choose a value'],['current','Keep current draft'],['incoming','Use returned worksheet']]:[['current','Keep current draft'],['incoming','Use returned worksheet']];
      const selected=Object.prototype.hasOwnProperty.call(decisions,change.key)?decisions[change.key]:change.status==='conflict'?'':review.decisions[change.key];
      details.append(select('Selected value',selected,options,value=>{if(value)decisions[change.key]=value;else delete decisions[change.key];host.onWorkingChange?.();}));
      section.append(details);
    }
    if(review.fields.length){
      const limits=node('details');limits.append(node('summary','Recorded field limits and source metadata · plain submission output'));
      for(const field of review.fields){const item=node('section');item.append(node('h5',field.label||field.id),node('p',field.counts.words+' words · '+field.counts.characters+' code points · '+field.counts.utf16+' UTF-16 units · '+field.counts.utf8Bytes+' UTF-8 bytes'));for(const issue of field.issues)item.append(node('p',issue));limits.append(item);}
      section.append(limits);
    }
    section.append(node('p','Compare the complete values before applying. Current-only fields and unrelated application answers remain in the original draft. A recorded limit does not truncate the returned wording.','muted'));
    const row=node('div',undefined,'row');row.append(button('Refresh selected review',inspect),button('Apply selected form changes',apply),button('Download return and decisions',()=>save(JSON.stringify({schema:'stellar-forge.grant-form-workbook-return.v1',workbook:retained(),review,decisions},null,2)+'\n',name('return.json'))));section.append(row);box.append(section);
  }
  function render(){
    if(!root)return;root.replaceChildren();
    const details=node('details');details.open=expanded;details.addEventListener('toggle',()=>{expanded=details.open;host.onWorkingChange?.();});details.dataset.formWorkbook='';
    details.append(node('summary','Issuer-form workbook'),node('p','Prepare the actual form in a spreadsheet, then compare its returned wording with this current draft. Prompts, answer mappings, source dates and recorded limits stay explicit.','muted'));
    const row=node('div',undefined,'row');row.append(button(workbook?'Prepare new baseline from current form':'Prepare workbook from current form',prepare),choose('Open workbook JSON','.json,application/json',MAX_FORM_WORKBOOK_BYTES,open));details.append(row);
    if(workbook){
      details.append(node('p','Baseline: '+workbook.baseline.title+' · '+workbook.createdAt+' · '+workbook.baseline.formMap.fields.length+' fields'));
      const downloads=node('div',undefined,'row');downloads.append(
        button('Download complete workbook JSON',()=>save(JSON.stringify(retained(),null,2)+'\n',name('workbook.json'))),
        button('Download profile sheet',()=>save(profile,name('profile.'+(separator===','?'csv':'tsv')),'text/plain;charset=utf-8')),
        button('Download fields sheet',()=>save(fields,name('fields.'+(separator===','?'csv':'tsv')),'text/plain;charset=utf-8')),
        button('Download answer reference',()=>save(formWorkbookReferenceText(workbook),name('answers.md'),'text/markdown;charset=utf-8')));
      details.append(downloads,node('p','Keep the workbook JSON with both sheets. Each field uses its original ID; upsert edits or adds it, remove explicitly deletes it. Omitting a row retains its original field. Leave unknown limits empty. answer_ids is a JSON array of the listed original IDs. Import spreadsheet columns as text and retain the reversible leading apostrophe on protected cells.','muted'));
      const convert=node('div',undefined,'row');
      for(const [value,label]of [[',','Convert complete sheets to CSV'],['\t','Convert complete sheets to TSV']])convert.append(button(label,()=>{
        const next=convertFormWorkbookSheets({profile,fields,delimiter:separator,cellEncoding:'apostrophe-v1'},value);
        profile=next.profile;fields=next.fields;separator=next.delimiter;changed();render();
      }));details.append(convert);
      details.append(select('Returned sheet separator',separator,[[',','Comma CSV'],['\t','Tab TSV']],value=>{separator=value;changed();render();}));
      const upload=node('div',undefined,'row');
      const receiveSheet=which=>async(text,file,token,basis)=>{if(!active(token,basis))return;if(which==='profile')profile=text;else fields=text;changed();render();host.status('Loaded '+file.name+'. Choose its actual delimiter and review the complete return.');};
      upload.append(choose('Open returned profile sheet','.csv,.tsv,text/csv,text/tab-separated-values,text/plain',16*1024*1024,receiveSheet('profile')),choose('Open returned fields sheet','.csv,.tsv,text/csv,text/tab-separated-values,text/plain',16*1024*1024,receiveSheet('fields')));
      details.append(upload);
      const source=node('details');source.append(node('summary','Edit or paste complete worksheet text'),textarea('Profile worksheet',profile,value=>{profile=value;changed();}),textarea('Fields worksheet',fields,value=>{fields=value;changed();}));details.append(source);
      const answers=node('details');answers.append(node('summary','Original answer IDs and complete wording'));
      for(const answer of workbook.baseline.answers)answers.append(node('h4',answer.title+' ['+answer.id+']'),node('pre',answer.text,'source-text'));
      details.append(answers,button('Review returned worksheets',inspect));renderReview(details);
    }
    root.append(details);
  }
  return{snapshot(){return workbook?clone({workbook,profile,fields,separator,decisions,expanded}):null;},
    restore(value){epoch++;identity=key(current());root=null;review=null;if(!value){reset();return;}workbook=clone(value.workbook);profile=value.profile;fields=value.fields;separator=value.separator;decisions=clone(value.decisions);expanded=value.expanded;},
    render(target){const next=key(current());if(next!==identity){reset();identity=next;expanded=false;}root=target;render();},dispose(){reset();root=null;identity='';}};
}
