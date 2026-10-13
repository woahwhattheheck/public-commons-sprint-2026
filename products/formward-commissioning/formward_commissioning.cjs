'use strict';
const SCHEMA='tjlabs.formward-commissioning/v1';
const TYPES=['text','email','tel','url','number','textarea','select','checkbox','hidden'];
const clone=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fail(message){throw new TypeError(message);}
function text(v,max=10000){return typeof v==='string'&&v.length<=max;}
function stamp(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function validField(f){return f&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f.name)&&text(f.label,200)&&f.label.trim()&&TYPES.includes(f.type)&&typeof f.required==='boolean'&&text(f.value??'',2000)&&Array.isArray(f.options)&&f.options.every(o=>text(o.value,200)&&o.value.trim()&&text(o.label,200)&&o.label.trim())&&new Set(f.options.map(o=>o.value)).size===f.options.length;}
function validateDraft(s){
 if(!s||!text(s.language,8)||!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(s.language)||!text(s.failure_text,1000)||!text(s.uncertain_text,1000)||!text(s.endpoint,500)||!text(s.site_origin,500)||!text(s.success_path,500)||!text(s.subject,200)||!text(s.recipient,300)||!text(s.title,200)||!text(s.introduction,2000)||!text(s.success_text,1000)||!text(s.privacy_text,4000)||!text(s.privacy_url,1000)||!text(s.button_label,100)||typeof s.require_consent!=='boolean'||!text(s.consent_text,2000)||!Array.isArray(s.fields)||s.fields.length>40||!s.fields.every(validField))fail('Keep complete readable field settings.');
 if(new Set(s.fields.map(f=>f.name)).size!==s.fields.length)fail('Each submitted field needs a unique name.');
 return s;
}
function readiness(s){
 validateDraft(s);const errors=[];
 if(!/^https:\/\/forms\.formward\.eu\/f\/[A-Za-z0-9_-]{1,128}$/.test(s.endpoint))errors.push('Enter the actual owned Formward endpoint.');
 if(!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(s.site_origin))errors.push('Enter the actual HTTPS website origin, without a trailing slash or path.');
 if(!/^\/(?!\/)[^?#\s]*$/.test(s.success_path))errors.push('Enter a same-site success path such as /thank-you.');
 if(!s.title.trim()||!s.button_label.trim())errors.push('Give the form a title and submit-button label.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.recipient))errors.push('Record the actual recipient configured in the Formward dashboard.');
 if(!s.fields.length)errors.push('Keep at least one enquiry field.');
 if(!s.fields.some(f=>f.name==='email'&&f.type==='email'))errors.push('Keep an email field named email for the normal Reply-To route.');
 if(s.fields.some(f=>f.type==='select'&&!f.options.length))errors.push('Give each choice field at least one option.');
 if(/[\r\n]/.test(s.subject))errors.push('Keep the notification subject on one line.');
 if(s.require_consent&&!s.consent_text.trim())errors.push('Write the actual displayed consent text.');
 if(s.privacy_url&&!/^https:\/\/[^\s"<>]+$/.test(s.privacy_url))errors.push('Use an HTTPS privacy-notice URL.');
 return {ready:errors.length===0,errors};
}
function validateWorking(w){
 if(!w||typeof w!=='object'||Array.isArray(w)||JSON.stringify(w).length>500000)fail('Keep a complete working form.');
 if(w.settings!==undefined){const s=w.settings;if(!s||typeof s!=='object'||Array.isArray(s))fail('Keep the complete unfinished settings.');
 const keys=['language','endpoint','site_origin','success_path','subject','recipient','title','introduction','success_text','failure_text','uncertain_text','privacy_text','privacy_url','button_label','consent_text'];
 if(keys.some(k=>!text(s[k],10000))||typeof s.require_consent!=='boolean'||!Array.isArray(s.fields)||s.fields.length>40||s.fields.some(f=>!f||typeof f!=='object'||!text(f.name,200)||!text(f.label,500)||!text(f.type,32)||!text(f.value??'',2000)||typeof f.required!=='boolean'||!(text(f.options,20000)||Array.isArray(f.options))))fail('Keep the complete editable field rows; choice JSON may remain unfinished.');
 }
 if(w.pending){const p=w.pending;if(!text(p.id,160)||!p.id||!stamp(p.at)||!text(p.case_id,160)||!text(p.endpoint,500)||!p.request_fields||typeof p.request_fields!=='object'||Array.isArray(p.request_fields))fail('Keep the original pending request.');validateDraft(p.settings);if(p.endpoint!==p.settings.endpoint)fail('The pending request must retain its dispatched settings.');}
 for(const [k,v] of Object.entries(w))if(!['settings','pending'].includes(k)&&!text(v,200000))fail('Keep complete working text.');
 return w;
}
function readState(value,configuration){
 const v=typeof value==='string'?JSON.parse(value):clone(value);
 if(!v||v.schema!==SCHEMA||v.edition_id!==configuration.edition_id||v.pack_id!==configuration.pack_id||!Number.isSafeInteger(v.revision)||v.revision<0||!Array.isArray(v.cases)||v.cases.length!==configuration.cases.length||!Array.isArray(v.history)||!text(v.selected_id,160))fail('Choose the complete saved record for this customer edition.');
 for(let i=0;i<v.cases.length;i++){const c=v.cases[i],original=configuration.cases[i];if(c.id!==original.id||JSON.stringify(c.source)!==JSON.stringify(original.source)||JSON.stringify(c.plan)!==JSON.stringify(original.plan)||!Array.isArray(c.observations))fail('The selected customer source or plan changed.');validateDraft(c.settings);if(c.working!==undefined){validateWorking(c.working);if(c.working.pending&&c.working.pending.case_id!==c.id)fail('Keep the pending request in its original case.');}for(const o of c.observations){validateObservation(o);if(o.settings)validateDraft(o.settings);}if(new Set(c.observations.map(o=>o.id)).size!==c.observations.length)fail('Keep each observation once.');}
 if(!v.cases.some(c=>c.id===v.selected_id))fail('Select a case in this edition.');
 if(v.history.some(e=>!text(e.op_id,160)||!stamp(e.at)||!text(e.actor,200)||!['settings','observation','selection','working'].includes(e.kind)))fail('Keep the complete operation history.');
 if(new Set(v.history.map(e=>e.op_id)).size!==v.history.length)fail('Repeated operation identifiers need their original saved result.');
 return v;
}
function createKit(configuration){
 if(!configuration||!text(configuration.pack_id,160)||!text(configuration.edition_id,160)||!Array.isArray(configuration.cases)||!configuration.cases.length)fail('Complete customer edition required.');
 const state={schema:SCHEMA,pack_id:configuration.pack_id,edition_id:configuration.edition_id,customer:clone(configuration.customer),revision:0,selected_id:configuration.cases[0].id,cases:configuration.cases.map(c=>({...clone(c),observations:[]})),history:[]};
 return readState(state,configuration);
}
function selectCase(state,id){const c=state.cases.find(x=>x.id===id);if(!c)fail('Select an original case in this edition.');return c;}
function mutate(state,id,kind,input,options,work){
 if(!options||!text(options.op_id,160)||!options.op_id||!stamp(options.at)||!text(options.actor,200)||!options.actor.trim())fail('Use the actual operator and original operation time.');
 const previous=state.history.find(x=>x.op_id===options.op_id),signature=JSON.stringify({id,kind,input,actor:options.actor,at:options.at});
 if(previous){if(previous.request!==signature)fail('This operation identifier already belongs to a different change.');return clone(state);}
 if(options.expected_revision!==state.revision)fail('The saved record changed. Reopen it before applying this change.');
 const next=clone(state);work(selectCase(next,id),next);next.revision++;next.history.push({op_id:options.op_id,at:options.at,actor:options.actor,kind,case_id:id,revision:next.revision,request:signature});return next;
}
function saveSettings(state,id,settings,options){validateDraft(settings);return mutate(state,id,'settings',settings,options,c=>{c.settings=clone(settings);});}
function saveWorking(state,id,working,options){validateWorking(working);if(working.pending&&working.pending.case_id!==id)fail('Keep the pending request in its original case.');return mutate(state,id,'working',working,options,c=>{c.working=clone(working);});}
function chooseCase(state,id,options){return mutate(state,id,'selection',{id},options,(c,n)=>{n.selected_id=c.id;});}
function validateObservation(o){
 if(o&&o.settings)validateDraft(o.settings);
 if(!o||!text(o.id,160)||!o.id||!stamp(o.at)||!text(o.operator,200)||!o.operator.trim()||!['endpoint_return','imported_endpoint_return','mailbox_observation','provider_inbox_observation'].includes(o.kind)||!text(o.note,10000)||!o.source||typeof o.source!=='object')fail('Retain a complete actual observation with its operator and time.');
 if(o.kind==='endpoint_return'||o.kind==='imported_endpoint_return'){
  if(!text(o.source.raw_response,200000)||!Number.isSafeInteger(o.source.http_status)||o.source.http_status<0||o.source.http_status>599||!text(o.source.endpoint,500)||!o.source.request_fields||typeof o.source.request_fields!=='object'||Array.isArray(o.source.request_fields))fail('Keep the endpoint, request fields, returned status and full response text.');
 }else if(o.kind==='provider_inbox_observation'){if(!text(o.source.request_id,160)||!text(o.source.endpoint,500)||!text(o.source.search_description,10000)||!o.source.search_description.trim()||!text(o.source.observed_result,200000)||!o.source.observed_result.trim()||o.source.finding!=='not_found')fail('Retain the actual provider inbox check and original request identity.');}else if(!text(o.source.recipient,300)||!text(o.source.provider_message_id,500)||!text(o.source.subject,1000)||!text(o.source.body,200000)||!text(o.source.submission_id,500))fail('Keep the complete mailbox observation.');
 return o;
}
function recordObservation(state,id,observation,options){
 validateObservation(observation);return mutate(state,id,'observation',observation,options,c=>{const old=c.observations.find(o=>o.id===observation.id);if(old){const comparable=clone(old);if(!observation.settings)delete comparable.settings;if(JSON.stringify(comparable)!==JSON.stringify(observation))fail('Keep the original observation under its original identifier.');}if(!old)c.observations.push({...clone(observation),settings:clone(observation.settings||c.settings)});});
}
function submissionFields(settings,values){
 const ready=readiness(settings);if(!ready.ready)fail(ready.errors.join(' '));
 if(!values||typeof values!=='object'||Array.isArray(values))fail('Enter the sample field values as a JSON object.');
 const result={};for(const field of settings.fields){
  const value=field.type==='hidden'?(field.value??''):values[field.name];if(field.type==='checkbox'){if(value===true||value==='yes'||value==='on')result[field.name]='yes';else if(field.required)fail('Complete '+field.label+'.');}
  else{if(value!==undefined&&typeof value!=='string'&&typeof value!=='number')fail('Use a simple value for '+field.label+'.');const string=String(value??'');if(field.required&&!string.trim())fail('Complete '+field.label+'.');if(string.length>10000)fail('Shorten '+field.label+'.');if(field.type==='select'&&string&&!field.options.some(o=>o.value===string))fail('Select an existing option for '+field.label+'.');if(field.type==='email'&&string&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(string))fail('Enter a valid reply address.');result[field.name]=string;}
 }
 if(settings.require_consent){if(values._consent!==true&&values._consent!=='yes')fail('Record the actual sample submitter consent.');result._consent='yes';}
 if(settings.subject)result._subject=settings.subject;result._redirect=settings.site_origin+settings.success_path;result._gotcha='';
 return result;
}
function fieldMarkup(f){
 const id='fw-'+f.name,required=f.required?' required':'',label=esc(f.label);
 if(f.type==='hidden')return '<input type="hidden" name="'+esc(f.name)+'" value="'+esc(f.value??'')+'">';
 if(f.type==='checkbox')return '<label class="fw-check"><input type="checkbox" id="'+id+'" name="'+esc(f.name)+'" value="yes"'+required+'> '+label+'</label>';
 const attrs=' id="'+id+'" name="'+esc(f.name)+'"'+required;
 const input=f.type==='textarea'?'<textarea'+attrs+' rows="5"></textarea>':f.type==='select'?'<select'+attrs+'><option value="">Choose…</option>'+f.options.map(o=>'<option value="'+esc(o.value)+'">'+esc(o.label)+'</option>').join('')+'</select>':'<input type="'+f.type+'"'+attrs+'>';
 return '<label for="'+id+'">'+label+(f.required?' <span aria-hidden="true">*</span>':'')+'</label>\n'+input;
}
function renderFragment(settings,{preview=false,enhance=true}={}){
 const ready=readiness(settings);if(!preview&&!ready.ready)fail(ready.errors.join(' '));
 return '<section class="fw-contact">\n<h2>'+esc(settings.title)+'</h2>\n'+(settings.introduction?'<p>'+esc(settings.introduction)+'</p>\n':'')+
 '<form class="fw-form" data-failure="'+esc(settings.failure_text)+'" data-success="'+esc(settings.success_text)+'" data-uncertain="'+esc(settings.uncertain_text)+'" method="POST" action="'+esc(preview?'#':settings.endpoint)+'" accept-charset="UTF-8">\n'+settings.fields.map(fieldMarkup).join('\n')+'\n'+
 (settings.privacy_text?'<p class="fw-notice">'+esc(settings.privacy_text)+(settings.privacy_url?(preview?' <span>'+esc(settings.privacy_url)+'</span>':' <a href="'+esc(settings.privacy_url)+'">Privacy notice</a>'):'')+'</p>\n':'')+
 (settings.require_consent?'<label class="fw-check"><input type="checkbox" name="_consent" value="yes" required> '+esc(settings.consent_text)+'</label>\n':'')+
 (settings.subject?'<input type="hidden" name="_subject" value="'+esc(settings.subject)+'">\n':'')+
 '<input type="hidden" name="_redirect" value="'+esc(settings.site_origin+settings.success_path)+'">\n'+
 '<label class="fw-honeypot" aria-hidden="true">Leave this field empty<input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></label>\n'+
 '<button type="submit"'+(preview?' disabled':'')+'>'+esc(settings.button_label)+'</button>\n<p class="fw-status" role="status" aria-live="polite"></p>\n</form>\n</section>'+(enhance&&!preview?'\n<style>'+FORM_CSS+'</style>\n<script>'+FORM_SCRIPT+'</script>':'');
}
const FORM_CSS='.fw-contact{max-width:42rem;margin:2rem auto;font:16px/1.5 system-ui,sans-serif;color:#171717}.fw-contact label:not(.fw-check){display:block;margin-top:1rem;font-weight:600}.fw-contact input:not([type=checkbox]):not([type=hidden]),.fw-contact textarea,.fw-contact select{box-sizing:border-box;width:100%;padding:.7rem;border:1px solid #aaa;border-radius:2px;background:white;color:inherit;font:inherit}.fw-contact button{margin-top:1rem;padding:.75rem 1rem;border:1px solid #171717;background:#171717;color:white;font:inherit;cursor:pointer}.fw-check{display:flex;align-items:flex-start;gap:.45rem;margin-top:1rem}.fw-check input{margin-top:.4rem}.fw-notice{font-size:.9rem}.fw-honeypot{position:absolute!important;left:-9999px!important;opacity:0!important}.fw-contact :focus-visible{outline:3px solid #666;outline-offset:3px}';
const FORM_SCRIPT="(()=>{const get=(node,name)=>Element.prototype.getAttribute.call(node,name),query=(node,selector)=>Element.prototype.querySelector.call(node,selector);for(const form of document.querySelectorAll('form.fw-form')){if(get(form,'data-receiving-bound'))continue;Element.prototype.setAttribute.call(form,'data-receiving-bound','true');EventTarget.prototype.addEventListener.call(form,'submit',async event=>{if(!window.fetch||!window.FormData)return;event.preventDefault();const button=query(form,'button[type=submit]'),status=query(form,'.fw-status');if(button.disabled)return;button.disabled=true;status.textContent='';let confirmed=false,uncertain=false;try{const redirect=query(form,'[name=_redirect]').value,destination=new URL(redirect,location.href);if(destination.origin!==location.origin)throw new Error('Check the configured success-page origin.');const endpoint=get(form,'action');uncertain=true;const response=await window.fetch(endpoint,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'},credentials:'omit',redirect:'error'});const body=await response.text();let result;try{result=JSON.parse(body);}catch{}uncertain=response.status>=500||(response.ok&&(!result||result.ok!==true||!result.id));if(!response.ok||!result||result.ok!==true||!result.id)throw new Error('Submission was not confirmed.');confirmed=true;Element.prototype.setAttribute.call(form,'data-submission-id',String(result.id));status.textContent=get(form,'data-success');location.assign(destination.href);}catch(error){if(!confirmed){status.textContent=get(form,uncertain?'data-uncertain':'data-failure');if(uncertain)Element.prototype.setAttribute.call(form,'data-delivery-uncertain','true');else button.disabled=false;}}});}})();";
function renderDocument(settings,options={}){return '<!doctype html>\n<html lang="'+esc(settings.language)+'"><head><meta charset="utf-8">'+(options.preview?'<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">':'')+'<meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(settings.title)+'</title><style>'+FORM_CSS+'</style></head><body>\n'+renderFragment(settings,options)+'\n</body></html>\n';}
function renderSuccessDocument(settings){const r=readiness(settings);if(!r.ready)fail(r.errors.join(' '));return '<!doctype html>\n<html lang="'+esc(settings.language)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(settings.title)+'</title><style>'+FORM_CSS+'</style></head><body><main class="fw-contact"><h1>'+esc(settings.title)+'</h1><p>'+esc(settings.success_text)+'</p><a href="'+esc(settings.site_origin)+'">'+esc(settings.site_origin)+'</a></main></body></html>\n';}
function handover(state,id){
 const c=selectCase(state,id),s=c.settings,ready=readiness(s);
 return '# '+c.plan.title+'\n\nCustomer edition: '+state.edition_id+'\n\n## Original opportunity\n\n'+c.source.url+'\n\n'+c.source.summary+'\n\n## Saved configuration\n\n'+[
 ['Endpoint',s.endpoint||'To configure'],['Website origin',s.site_origin||'To configure'],['Success page',s.site_origin+s.success_path],['Dashboard notification recipient',s.recipient||'To configure'],['Subject',s.subject||'Provider default']
 ].map(([k,v])=>k+': '+v).join('\n')+'\n\nThe recorded recipient must be configured and confirmed in the actual Formward dashboard. The public HTML does not configure notification recipients.\n\n## Fields\n\n'+s.fields.map(f=>'- '+f.name+' — '+f.label+' ('+f.type+(f.required?', required':'')+')').join('\n')+'\n\n## Commissioning\n\n'+c.plan.steps.map((x,i)=>(i+1)+'. '+x).join('\n')+'\n\n'+c.plan.demonstration+'\n\n## Actual receiving observations\n\n'+(c.observations.length?c.observations.map(o=>'- '+o.at+' — '+o.operator+' — '+o.kind+' — '+o.note).join('\n'):'Record the actual endpoint result and mailbox observation after commissioning.')+'\n\n## Current preparation\n\n'+(ready.ready?'Complete settings are ready to generate the source.':ready.errors.map(x=>'- '+x).join('\n'))+'\n\n## Sources and ownership\n\n'+c.plan.contract_urls.join('\n')+'\n\n'+c.plan.scope+'\n';
}
function exportRecord(state){return JSON.stringify(state,null,2)+'\n';}
if(typeof module!=='undefined'&&module.exports)module.exports={SCHEMA,TYPES,createKit,readState,readiness,saveSettings,saveWorking,chooseCase,recordObservation,submissionFields,renderFragment,renderDocument,renderSuccessDocument,handover,exportRecord,FORM_CSS,FORM_SCRIPT};
