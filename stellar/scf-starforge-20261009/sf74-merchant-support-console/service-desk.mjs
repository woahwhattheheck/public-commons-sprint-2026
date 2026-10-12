// MIT. Service commitments and monthly reporting inside the original SF74 case.
import {
  createServiceRecord, validateServiceRecord, saveServiceTerms, retainServiceSnapshot,
  saveServiceExclusion, previewServiceReport, retainServiceReport,
  renderServiceReport, serviceReportCsv,
} from './service-commitments.mjs';

const DRAFT_SCHEMA='stellar-forge.merchant-service-desk-draft.v1';
const KINDS=[
  ['ENDPOINT_UNAVAILABLE','Endpoint unavailable'],['OBSERVER_INCOMPLETE','Incomplete observations'],
  ['HTTP_5XX','Server errors'],['DISCONNECTED','Interrupted connections'],
  ['DELIVERY_UNAVAILABLE','Delivery unavailable'],['DELIVERY_BACKLOG','Delivery backlog'],
  ['DELIVERY_EXHAUSTED','Delivery attempts exhausted'],
];
const DAYS=[[1,'Monday'],[2,'Tuesday'],[3,'Wednesday'],[4,'Thursday'],[5,'Friday'],[6,'Saturday'],[7,'Sunday']];
const clone=value=>structuredClone(value);
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':isObject(value)?
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const same=(a,b)=>canonical(a)===canonical(b);
const human=value=>String(value??'').replaceAll('_',' ').toLowerCase().replace(/^\w/,c=>c.toUpperCase());
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():'—';
const isoNow=()=>new Date().toISOString();
const utcInput=value=>typeof value==='string'?value.replace(/Z$/,''):'';
const inputUtc=(value,label,{optional=false}={})=>{
  if(!value&&optional)return null;
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value))
    throw new Error(label+' must be an actual UTC date and time.');
  const date=new Date(value+'Z');
  if(!Number.isFinite(date.getTime()))throw new Error(label+' is not a valid UTC date and time.');
  const result=date.toISOString(),normalized=value.length===16?value+':00.000':value.length===19?value+'.000':
    value.includes('.')?value.padEnd(value.indexOf('.')+4,'0'):value;
  if(result!==normalized+'Z')throw new Error(label+' is not a valid calendar date and time.');
  return result;
};
const add=(parent,tag,text,className='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;parent.append(node);return node;};
const option=(select,value,text)=>{const node=add(select,'option',text);node.value=value;return node;};
const action=(parent,text,handler,className='secondary')=>{const node=add(parent,'button',text,className);node.type='button';node.addEventListener('click',handler);return node;};
const field=(parent,label,id,type='text')=>{const wrap=add(parent,'label',label),node=add(wrap,type==='textarea'?'textarea':type==='select'?'select':'input');node.id=id;if(!['textarea','select'].includes(type))node.type=type;return node;};
const safeText=(value,label='unfinished field')=>{if(value==null)return '';if(typeof value!=='string')throw new Error('The saved '+label+' must be text.');return value;};
const monthRange=month=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Choose a complete reporting month.');
  const [year,m]=month.split('-').map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
  const last=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
  return {from:month+'-01',through:month+'-'+last};
};
const minutes=(value,label)=>{
  if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error(label+' must be a whole number of minutes.');
  return Number(value);
};
const parseWindows=(value,label)=>{
  if(!value.trim())return [];
  return value.split(',').map(part=>{
    const match=part.trim().match(/^(\d\d:\d\d)\s*[-–]\s*(\d\d:\d\d)$/);
    if(!match)throw new Error(label+' must use HH:MM-HH:MM, with commas between separate windows.');
    return {start:match[1],end:match[2]};
  });
};
const windowsText=windows=>(windows??[]).map(row=>row.start+'-'+row.end).join(', ');
const emptyDraft=()=>({
  schema:DRAFT_SCHEMA,sourceId:'',merchantId:'',bindingCapture:'',selectedTermsId:'',selectedTermsRevision:null,
  terms:{id:crypto.randomUUID(),expectedRevision:null,title:'',customer:'',owner:'',reference:'',status:'proposed',
    effectiveFrom:'',effectiveUntil:'',calendarMode:'always',timeZone:'UTC',
    week:DAYS.map(([day])=>({day,windows:''})),exceptions:[],
    targets:KINDS.map(([kind])=>({kind,enabled:false,responseMinutes:'',recoveryMinutes:''})),reviewedBy:'',note:''},
  exclusion:{id:crypto.randomUUID(),captureSha256:'',incidentId:'',from:'',through:'',scope:'both',reason:'',reference:'',reviewedBy:''},
  report:{termsId:'',termsRevision:null,month:isoNow().slice(0,7),asOf:utcInput(isoNow()),
    captureSha256s:[],exclusionIds:[],reviewedBy:'',note:'',selectedReportId:''},
});
function draftFrom(value) {
  const base=emptyDraft();
  if(value==null||isObject(value)&&!Object.keys(value).length)return base;
  if(!isObject(value)||value.schema!==DRAFT_SCHEMA)throw new Error('This case has a service form edition this desk cannot edit. Preserve the original case and open it with the matching desk.');
  const terms=isObject(value.terms)?value.terms:{},exclusion=isObject(value.exclusion)?value.exclusion:{},report=isObject(value.report)?value.report:{};
  const next={...base,...clone(value),terms:{...base.terms,...terms},exclusion:{...base.exclusion,...exclusion},report:{...base.report,...report}};
  for(const key of ['sourceId','merchantId','bindingCapture','selectedTermsId'])next[key]=safeText(next[key]);
  for(const key of ['id','title','customer','owner','reference','status','effectiveFrom','effectiveUntil','calendarMode','timeZone','reviewedBy','note'])next.terms[key]=safeText(next.terms[key]);
  for(const key of Object.keys(base.exclusion))next.exclusion[key]=safeText(next.exclusion[key]);
  for(const key of ['termsId','month','asOf','reviewedBy','note','selectedReportId'])next.report[key]=safeText(next.report[key]);
  if(terms.week!==undefined&&(!Array.isArray(terms.week)||terms.week.some(row=>!isObject(row)||!DAYS.some(([day])=>day===row.day))||new Set(terms.week.map(row=>row.day)).size!==terms.week.length))throw new Error('The saved unfinished service week has an unknown or repeated day.');
  next.terms.week=DAYS.map(([day])=>({day,windows:safeText(terms.week?.find(row=>row.day===day)?.windows)}));
  if(terms.exceptions!==undefined&&(!Array.isArray(terms.exceptions)||terms.exceptions.length>1000))throw new Error('The saved calendar must contain at most 1,000 complete special-date rows.');
  next.terms.exceptions=(terms.exceptions??[]).map(row=>{if(!isObject(row))throw new Error('A saved calendar exception is not a complete row.');return {...row,date:safeText(row.date),windows:safeText(row.windows)};});
  if(terms.targets!==undefined&&(!Array.isArray(terms.targets)||terms.targets.some(row=>!isObject(row)||!KINDS.some(([kind])=>kind===row.kind))||new Set(terms.targets.map(row=>row.kind)).size!==terms.targets.length))throw new Error('The saved targets contain an unknown or repeated incident condition.');
  next.terms.targets=KINDS.map(([kind])=>{const row=terms.targets?.find(item=>item.kind===kind);return {kind,enabled:row?.enabled===true,responseMinutes:safeText(row?.responseMinutes),recoveryMinutes:safeText(row?.recoveryMinutes)};});
  for(const key of ['captureSha256s','exclusionIds']){
    if(report[key]!==undefined&&(!Array.isArray(report[key])||report[key].some(x=>typeof x!=='string')))throw new Error('The saved report selection is not a complete list of original IDs.');
    next.report[key]=[...(report[key]??[])];
  }
  return next;
}
const setField=(node,value)=>{
  const original=String(value??'');delete node.dataset.retainedValue;node.value=original;
  if(original&&node.value!==original){
    const timeEquivalent=node.type==='datetime-local'&&node.value&&Number.isFinite(Date.parse(node.value+'Z'))&&Date.parse(node.value+'Z')===Date.parse(original+'Z');
    if(!timeEquivalent){node.dataset.retainedValue=original;node.title='Saved unfinished value: '+original;}
  }else node.removeAttribute('title');
};
const readField=node=>node.dataset.retainedValue??node.value;
const numberText=value=>Number.isFinite(value)?Number(value).toLocaleString(undefined,{maximumFractionDigits:2}):'—';
const wire=(node,event,handler,signal)=>node.addEventListener(event,handler,{signal});
const sizeOf=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const download=(parent,label,filename,content,type,urls)=>{
  const url=URL.createObjectURL(new Blob([content],{type}));urls.add(url);
  const link=add(parent,'a',label,'button secondary');link.href=url;link.download=filename;return link;
};

const SERVICE_MARKUP="\n<div class=\"section-heading\"><div><p class=\"eyebrow\">Service operations</p><h2>Commitments and monthly reporting</h2>\n<p>Keep agreed response and recovery terms, retained incidents and each reviewed reporting period in this merchant case.</p></div><span id=\"service-record-summary\" class=\"stage-hint\">Opening case service record…</span></div>\n<p id=\"service-status\" class=\"status\" role=\"status\" aria-live=\"polite\">Opening the current service record…</p>\n<p class=\"hint\">Service changes use the original Save case action. The same saved version and portable handoff carry the complete service record.</p>\n<section class=\"service-section\" aria-labelledby=\"service-source-heading\"><h3 id=\"service-source-heading\">Retain the merchant’s incident records</h3>\n<p>Select a source already registered by this workspace, then capture its original incidents for a current or retained merchant.</p>\n<form id=\"service-source-form\" class=\"service-source-grid\">\n<label>Declared incident source<select id=\"service-source\"></select></label><label>Current or retained merchant<select id=\"service-merchant\"></select></label>\n<div class=\"actions\"><button id=\"service-source-refresh\" type=\"button\" class=\"secondary\">Refresh sources</button><button id=\"service-capture\" type=\"submit\">Retain current incidents</button></div></form>\n<p id=\"service-source-status\" class=\"hint\" role=\"status\"></p><div id=\"service-captures\" class=\"service-capture-list\"></div></section>\n<section class=\"service-section\" aria-labelledby=\"service-terms-heading\"><h3 id=\"service-terms-heading\">Service commitments</h3>\n<p>Save each agreed change as a new edition. Earlier editions and their reports stay available.</p>\n<div class=\"service-edition-picker\"><label>Saved service edition<select id=\"service-terms-edition\"></select></label>\n<div class=\"actions\"><button id=\"service-terms-open\" type=\"button\" class=\"secondary\">Open edition to revise</button><button id=\"service-terms-new\" type=\"button\" class=\"secondary\">New service agreement</button></div></div>\n<p id=\"service-terms-edition-status\" class=\"hint\"></p>\n<form id=\"service-terms-form\"><div class=\"form-grid\">\n<label>Service title<input id=\"service-terms-title\" maxlength=\"400\" required></label><label>Customer / merchant<input id=\"service-terms-customer\" maxlength=\"400\" required></label>\n<label>Service owner<input id=\"service-terms-owner\" maxlength=\"400\" required></label><label>Agreement state<select id=\"service-terms-state\"><option value=\"proposed\">Proposed</option><option value=\"active\">Active</option><option value=\"ended\">Ended</option></select></label>\n<label class=\"full\">Original agreement / acceptance reference<input id=\"service-terms-reference\" maxlength=\"4000\"><small>Retain the original document or acceptance reference for the recorded commitment.</small></label>\n<label class=\"full\">Recorded incident-source binding<select id=\"service-terms-binding\"></select><small>Choose a retained snapshot of the source and merchant covered by these terms.</small></label>\n<label>Effective from (UTC)<input id=\"service-terms-from\" type=\"datetime-local\" step=\"0.001\" required></label><label>Effective through (UTC, optional)<input id=\"service-terms-until\" type=\"datetime-local\" step=\"0.001\"></label></div>\n<fieldset class=\"service-calendar\"><legend>Service calendar</legend><div class=\"form-grid\">\n<label>Coverage calendar<select id=\"service-calendar-mode\"><option value=\"always\">24 hours, every day</option><option value=\"business\">Local business calendar</option></select></label>\n<label>Service time zone<input id=\"service-calendar-zone\" list=\"service-time-zones\" maxlength=\"100\" required><datalist id=\"service-time-zones\"></datalist><small>Reporting dates use this IANA time zone.</small></label></div>\n<div id=\"service-business-calendar\"><p class=\"hint\">Use local clock times such as 09:00-12:00, 13:00-17:00. An empty day is closed.</p><div id=\"service-week\" class=\"service-week\"></div></div>\n<h4>Holidays and special dates</h4><p class=\"hint\">An empty time window closes the selected date. A special-date window replaces that day’s normal hours.</p><div id=\"service-calendar-exceptions\"></div>\n<button id=\"service-calendar-add\" type=\"button\" class=\"secondary\">Add holiday or special date</button></fieldset>\n<fieldset><legend>Response and recovery targets</legend><p class=\"hint\">Select each covered incident kind and enter its agreed whole-minute targets in the chosen service calendar.</p>\n<div class=\"case-table-wrap\"><table class=\"case-table service-targets\"><thead><tr><th scope=\"col\">Covered incident kind</th><th scope=\"col\">Response target (minutes)</th><th scope=\"col\">Recovery target (minutes)</th></tr></thead><tbody id=\"service-targets\"></tbody></table></div></fieldset>\n<div class=\"form-grid\"><label>Terms reviewed by<input id=\"service-terms-reviewer\" maxlength=\"240\" required></label><label>Revision note<textarea id=\"service-terms-note\" maxlength=\"8000\" rows=\"2\"></textarea></label></div>\n<div class=\"actions\"><button id=\"service-terms-save\" type=\"submit\">Retain service edition</button><span id=\"service-terms-save-hint\" class=\"hint\"></span></div></form></section>\n<section class=\"service-section\" aria-labelledby=\"service-exclusions-heading\"><h3 id=\"service-exclusions-heading\">Reviewed incident exclusions</h3>\n<p>Retain the exact incident, interval, scope and original reference for each exclusion. Choose the applicable exclusions when reviewing a report.</p>\n<form id=\"service-exclusion-form\"><div class=\"form-grid\"><label>Retained incident snapshot<select id=\"service-exclusion-capture\"></select></label><label>Original incident<select id=\"service-exclusion-incident\"></select></label></div>\n<div id=\"service-exclusion-timeline\" class=\"scope\"></div><div class=\"form-grid\">\n<label>Excluded interval from (UTC)<input id=\"service-exclusion-from\" type=\"datetime-local\" step=\"0.001\" required></label><label>Excluded interval through (UTC)<input id=\"service-exclusion-through\" type=\"datetime-local\" step=\"0.001\" required></label>\n<label>Applies to<select id=\"service-exclusion-scope\"><option value=\"both\">Response and recovery</option><option value=\"response\">Response only</option><option value=\"recovery\">Recovery only</option></select></label>\n<label>Reviewed by<input id=\"service-exclusion-reviewer\" maxlength=\"240\" required></label><label class=\"full\">Original exclusion reference<input id=\"service-exclusion-reference\" maxlength=\"4000\" required></label>\n<label class=\"full\">Reviewed reason<textarea id=\"service-exclusion-reason\" maxlength=\"4000\" rows=\"3\" required></textarea></label></div><button id=\"service-exclusion-save\" type=\"submit\">Retain exclusion</button></form><div id=\"service-exclusion-list\"></div></section>\n<section class=\"service-section\" aria-labelledby=\"service-report-heading\"><h3 id=\"service-report-heading\">Monthly operating report</h3>\n<p>Select the exact service edition, incident snapshots, exclusions and cutoff for this month. Review the original timelines and outstanding work before retaining the report.</p>\n<form id=\"service-report-form\"><div class=\"form-grid\">\n<label>Service edition<select id=\"service-report-terms\" required></select></label><label>Reporting month (service-calendar dates)<input id=\"service-report-month\" type=\"month\" required></label>\n<label>Report cutoff (UTC)<input id=\"service-report-as-of\" type=\"datetime-local\" step=\"0.001\" required></label><div class=\"service-field-action\"><button id=\"service-report-now\" type=\"button\" class=\"secondary\">Use current time</button><p id=\"service-report-period\" class=\"hint\"></p></div></div>\n<fieldset><legend>Included incident snapshots</legend><div id=\"service-report-captures\"></div></fieldset><fieldset><legend>Applied reviewed exclusions</legend><div id=\"service-report-exclusions\"></div></fieldset><button id=\"service-report-preview\" type=\"submit\">Review monthly report</button></form>\n<div id=\"service-report-preview-body\" hidden></div><form id=\"service-report-retain-form\" hidden><div class=\"form-grid\">\n<label>Report reviewed by<input id=\"service-report-reviewer\" maxlength=\"240\" required></label><label>Review note<textarea id=\"service-report-note\" maxlength=\"8000\" rows=\"2\"></textarea></label></div><button id=\"service-report-retain\" type=\"submit\">Retain reviewed report in case</button></form>\n<div class=\"service-saved-reports\"><h4>Retained reports</h4><div id=\"service-report-list\"></div></div>\n<section id=\"service-saved-report\" hidden><div class=\"section-heading\"><h4 id=\"service-saved-report-title\"></h4><button id=\"service-report-close\" type=\"button\" class=\"secondary\">Close report view</button></div><div id=\"service-report-downloads\" class=\"actions\"></div><div id=\"service-saved-report-body\"></div></section>\n</section>\n";

export function mountServiceDesk({root,readRecord=()=>null,writeRecord,onError=()=>{}}) {
  if(!root||typeof writeRecord!=='function')throw new TypeError('Service desk needs its original case root and writer.');
  const abort=new AbortController(),downloads=new Set();
  let record=createServiceRecord(),draft=emptyDraft(),enabled=true,loading=true,busy=false,destroyed=false;
  let epoch=0,change=0,profileSequence=0,sourceSequence=0,preview=null,previewSelection=null,loadedSource=null;
  let profiles=[],activeReport=null,sourceLoading=false,loadFailed=false;
  root.id='service-operations';root.className='card service-desk';root.innerHTML=SERVICE_MARKUP;
  const $=id=>root.querySelector('#'+id);
  const termsFields={title:$('service-terms-title'),customer:$('service-terms-customer'),owner:$('service-terms-owner'),
    reference:$('service-terms-reference'),status:$('service-terms-state'),effectiveFrom:$('service-terms-from'),
    effectiveUntil:$('service-terms-until'),calendarMode:$('service-calendar-mode'),timeZone:$('service-calendar-zone'),
    reviewedBy:$('service-terms-reviewer'),note:$('service-terms-note')};
  const exclusionFields={captureSha256:$('service-exclusion-capture'),incidentId:$('service-exclusion-incident'),
    from:$('service-exclusion-from'),through:$('service-exclusion-through'),scope:$('service-exclusion-scope'),
    reason:$('service-exclusion-reason'),reference:$('service-exclusion-reference'),reviewedBy:$('service-exclusion-reviewer')};
  const weekFields=new Map(),targetFields=new Map();
  for(const [day,name] of DAYS){const input=field($('service-week'),name,'service-day-'+day);input.maxLength=1000;input.placeholder='Closed, or HH:MM-HH:MM';weekFields.set(day,input);}
  for(const [kind,label] of KINDS){
    const row=add($('service-targets'),'tr'),cell=add(row,'td'),wrap=add(cell,'label',undefined,'service-kind');
    const check=add(wrap,'input');check.type='checkbox';check.dataset.serviceKind=kind;add(wrap,'span',label);
    const response=add(add(row,'td'),'input');response.type='number';response.min='1';response.max='527040';response.step='1';response.inputMode='numeric';response.setAttribute('aria-label',label+' response target in minutes');
    const recovery=add(add(row,'td'),'input');recovery.type='number';recovery.min='1';recovery.max='527040';recovery.step='1';recovery.inputMode='numeric';recovery.setAttribute('aria-label',label+' recovery target in minutes');
    targetFields.set(kind,{check,response,recovery});
  }
  let zones=['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London'];
  try{zones=[...new Set([...zones,...Intl.supportedValuesOf('timeZone')])];}catch{}
  for(const zone of zones)option($('service-time-zones'),zone,zone);
  const say=(text,error=false)=>{$('service-status').textContent=text;$('service-status').className=error?'status error':'status';if(error)onError(text);};
  const termsBy=(id,revision)=>record.terms.find(row=>row.id===id&&row.revision===Number(revision));
  const termsKey=row=>row.id+':'+row.revision;
  const readTermsKey=value=>{const at=value.lastIndexOf(':');return at<0?{id:'',revision:null}:{id:value.slice(0,at),revision:Number(value.slice(at+1))};};
  const captureBy=sha=>record.captures.find(row=>row.sha256===sha);
  const captureSource=capture=>capture?.snapshot?.source?.id;
  const captureMerchant=capture=>capture?.snapshot?.merchant?.id;
  const captureTime=capture=>capture?.snapshot?.capturedAt;
  const captureTitle=capture=>(capture.snapshot.merchant.label||captureMerchant(capture))+' · '+captureSource(capture)+' · '+time(captureTime(capture));
  const captureMatches=(capture,terms)=>terms&&captureSource(capture)===terms.incidentSourceId&&captureMerchant(capture)===terms.merchantId&&(same(capture.snapshot.merchant.binding,terms.merchantBinding)||capture.snapshot.incidents.some(row=>row.merchantId===terms.merchantId&&row.binding===terms.merchantBinding));
  function choose(select,value){select.value=value??'';if(value&&select.value!==String(value))option(select,String(value),'Saved selection · '+String(value)).selected=true;}
  function clearPreview(){preview=null;previewSelection=null;$('service-report-preview-body').hidden=true;$('service-report-preview-body').replaceChildren();$('service-report-retain-form').hidden=true;}
  function revokeDownloads(){for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();}
  function controls(){
    const locked=!enabled||loading||busy||destroyed||loadFailed;
    root.setAttribute('aria-busy',String(loading||busy||sourceLoading));root.dataset.ready=String(!loading&&!destroyed&&!loadFailed);
    for(const element of root.querySelectorAll('input,select,textarea,button'))element.disabled=locked||element.dataset.disabledAtRest==='true';
    $('service-source-refresh').disabled=locked||sourceLoading;
    $('service-source').disabled=locked||sourceLoading;$('service-merchant').disabled=locked||sourceLoading;
    $('service-capture').disabled=locked||sourceLoading||!loadedSource||!loadedSource.merchants?.some(row=>row.id===$('service-merchant').value);
    $('service-terms-open').disabled=locked||!$('service-terms-edition').value;
    $('service-terms-binding').disabled=locked||!record.captures.length&&!draft.selectedTermsId;
    $('service-exclusion-save').disabled=locked||!$('service-exclusion-incident').value;
    $('service-report-preview').disabled=locked||!$('service-report-terms').value;
    $('service-report-retain').disabled=locked||!preview;
    $('service-business-calendar').hidden=$('service-calendar-mode').value!=='business';
    for(const {check,response,recovery} of targetFields.values()){response.disabled=locked||!check.checked;recovery.disabled=locked||!check.checked;}
    for(const input of root.querySelectorAll('[data-incompatible=true]'))input.disabled=true;
    $('service-record-summary').textContent=record.terms.length+' service editions · '+record.captures.length+' snapshots · '+record.reports.length+' reports';
  }

  let baseBytes=sizeOf({...record,draft:{}})-2;
  const on=(node,type,handler)=>wire(node,type,handler,abort.signal);
  const guarded=handler=>(...args)=>{try{const result=handler(...args);if(result?.catch)result.catch(error=>{if(!destroyed)say(error.message??String(error),true);});}catch(error){if(!destroyed)say(error.message??String(error),true);}};
  function checkedRecord(next,nextDraft=next.draft){
    const draftBytes=sizeOf(nextDraft);
    if(draftBytes>160000)throw new Error('The unfinished service form exceeds 160 KB. Shorten the current draft before saving more fields.');
    const body=next===record?baseBytes:sizeOf({...next,draft:{}})-2;
    if(body+draftBytes>8_000_000)throw new Error('The complete service record exceeds 8 MB. Preserve its original case handoff before continuing in another service case.');
    return {...next,draft:clone(nextDraft)};
  }
  function readDraft(){
    const next=clone(draft);
    next.sourceId=$('service-source').value;next.merchantId=$('service-merchant').value;
    next.bindingCapture=$('service-terms-binding').value;next.editionChoice=$('service-terms-edition').value;
    for(const [key,node] of Object.entries(termsFields))next.terms[key]=readField(node);
    next.terms.week=DAYS.map(([day])=>({day,windows:readField(weekFields.get(day))}));
    next.terms.exceptions=[...$('service-calendar-exceptions').children].map(row=>({
      date:readField(row.querySelector('[data-calendar-date]')),windows:readField(row.querySelector('[data-calendar-windows]')),
    }));
    next.terms.targets=KINDS.map(([kind])=>{const f=targetFields.get(kind);return {kind,enabled:f.check.checked,responseMinutes:readField(f.response),recoveryMinutes:readField(f.recovery)};});
    for(const [key,node]of Object.entries(exclusionFields))next.exclusion[key]=readField(node);
    const terms=readTermsKey($('service-report-terms').value);
    next.report.termsId=terms.id;next.report.termsRevision=terms.revision;
    next.report.month=readField($('service-report-month'));next.report.asOf=readField($('service-report-as-of'));
    next.report.reviewedBy=readField($('service-report-reviewer'));next.report.note=readField($('service-report-note'));
    next.report.captureSha256s=[...$('service-report-captures').querySelectorAll('[data-service-capture]:checked')].map(node=>node.dataset.serviceCapture);
    next.report.exclusionIds=[...$('service-report-exclusions').querySelectorAll('[data-service-exclusion]:checked')].map(node=>node.dataset.serviceExclusion);
    return next;
  }
  function persistDraft({invalidate=false}={}){
    if(loading||busy||destroyed||loadFailed)return;
    const next=readDraft(),updated=checkedRecord(record,next);
    if(!same(next,record.draft)){writeRecord(clone(updated));record=updated;draft=next;change++;}
    if(invalidate)clearPreview();controls();
  }
  function commit(next,nextDraft,message){
    const updated=checkedRecord(next,nextDraft);
    writeRecord(clone(updated));record=updated;draft=clone(nextDraft);baseBytes=sizeOf({...record,draft:{}})-2;change++;
    clearPreview();renderAll();if(message)say(message);
  }
  async function run(label,operation,accept){
    if(!enabled||loading||busy||destroyed||loadFailed)throw new Error('Finish the current case operation before changing its service record.');
    persistDraft();const token={epoch,change,external:clone(readRecord())},snapshot=checkedRecord(record,readDraft());
    busy=true;controls();say(label);
    try{
      const result=await operation(snapshot);
      if(destroyed||token.epoch!==epoch)return;
      if(token.change!==change||!same(token.external,readRecord()))throw new Error('The current case changed during this operation. Reopen its service record before applying the result.');
      accept(result,snapshot);
    }catch(error){if(!destroyed&&token.epoch===epoch)say(error.message??String(error),true);}
    finally{if(token.epoch===epoch&&!destroyed){busy=false;controls();}}
  }
  function renderExceptions(){
    const list=$('service-calendar-exceptions');list.replaceChildren();
    for(const [index,row] of draft.terms.exceptions.entries()){
      const wrap=add(list,'div',undefined,'service-exception-row'),key=crypto.randomUUID();
      const date=field(wrap,'Special date','service-exception-date-'+key,'date');date.dataset.calendarDate='true';setField(date,row.date);
      const windows=field(wrap,'Local service windows (blank closes the date)','service-exception-windows-'+key);windows.dataset.calendarWindows='true';windows.maxLength=1000;windows.placeholder='Closed, or 09:00-17:00';setField(windows,row.windows);
      action(wrap,'Remove date',guarded(()=>{persistDraft();draft.terms.exceptions.splice(index,1);renderExceptions();persistDraft({invalidate:true});}),'secondary');
    }
  }
  function renderTermsSelectors(){
    const saved=$('service-terms-edition'),report=$('service-report-terms');
    saved.replaceChildren();report.replaceChildren();
    option(saved,'','Select a retained service edition');option(report,'','Select the reporting service edition');
    for(const terms of [...record.terms].reverse()){
      const label=terms.title+' · edition '+terms.revision+' · '+human(terms.status)+' · '+terms.customer;
      option(saved,termsKey(terms),label);option(report,termsKey(terms),label);
    }
    choose(saved,draft.editionChoice??(draft.selectedTermsId?draft.selectedTermsId+':'+draft.selectedTermsRevision:''));
    choose(report,draft.report.termsId?draft.report.termsId+':'+draft.report.termsRevision:'');
    const current=termsBy(draft.terms.id,draft.terms.expectedRevision),latest=record.terms.filter(t=>t.id===draft.terms.id).at(-1);
    $('service-terms-edition-status').textContent=current?
      'Editing retained edition '+current.revision+'. The next save creates edition '+(current.revision+1)+'.'+(latest?.revision>current.revision?' A later edition '+latest.revision+' is already present; open that edition before saving.':''):
      'New service agreement. Its first edition is retained in this case.';
    $('service-terms-save-hint').textContent=current?'Original service '+current.id:'';
    $('service-terms-save').textContent=current?'Retain revised service edition':'Retain first service edition';
    const binding=$('service-terms-binding');binding.replaceChildren();option(binding,'','Choose the original source and merchant binding');
    if(current)option(binding,'terms:'+termsKey(current),'Original edition binding · '+current.incidentSourceId+' / '+current.merchantId);
    for(const capture of [...record.captures].reverse())option(binding,capture.sha256,captureTitle(capture));
    choose(binding,draft.bindingCapture);
  }
  function fillTerms(){
    for(const [key,node]of Object.entries(termsFields)){
      if(node.tagName==='SELECT')choose(node,draft.terms[key]);else setField(node,draft.terms[key]);
    }
    for(const [day,node]of weekFields)setField(node,draft.terms.week.find(row=>row.day===day)?.windows??'');
    for(const [kind,f]of targetFields){const row=draft.terms.targets.find(t=>t.kind===kind);f.check.checked=row?.enabled===true;setField(f.response,row?.responseMinutes??'');setField(f.recovery,row?.recoveryMinutes??'');}
    renderExceptions();
  }
  function editTerms(terms){
    const current=record.terms.filter(t=>t.id===terms.id).at(-1);
    draft.selectedTermsId=terms.id;draft.selectedTermsRevision=terms.revision;draft.editionChoice=termsKey(terms);
    draft.bindingCapture='terms:'+termsKey(terms);
    draft.terms={
      ...draft.terms,id:terms.id,expectedRevision:terms.revision,title:terms.title,customer:terms.customer,owner:terms.owner,
      reference:terms.reference,status:terms.status,effectiveFrom:utcInput(terms.effectiveFrom),effectiveUntil:utcInput(terms.effectiveUntil??''),
      calendarMode:terms.calendar.mode,timeZone:terms.calendar.timeZone,
      week:DAYS.map(([day])=>({day,windows:windowsText(terms.calendar.week.find(row=>row.day===day)?.windows)})),
      exceptions:terms.calendar.exceptions.map(row=>({date:row.date,windows:windowsText(row.windows)})),
      targets:KINDS.map(([kind])=>{const row=terms.targets.find(t=>t.kind===kind);return {kind,enabled:Boolean(row),responseMinutes:row?String(row.responseMinutes):'',recoveryMinutes:row?String(row.recoveryMinutes):''};}),
      reviewedBy:terms.reviewedBy,note:'',
    };
    renderTermsSelectors();fillTerms();persistDraft();
    say(current?.revision>terms.revision?'Opened historical edition '+terms.revision+'. The current edition is '+current.revision+'.':'Opened service edition '+terms.revision+' for a new revision.');
  }
  function termsInput(){
    const form=readDraft(),t=form.terms;
    let binding;
    if(form.bindingCapture.startsWith('terms:')){
      const key=readTermsKey(form.bindingCapture.slice(6)),original=termsBy(key.id,key.revision);
      if(!original||original.id!==t.id||original.revision!==t.expectedRevision)throw new Error('Choose the original binding for this service edition or a retained current capture.');
      binding={incidentSourceId:original.incidentSourceId,merchantId:original.merchantId,merchantBinding:original.merchantBinding};
    }else{
      const capture=captureBy(form.bindingCapture);
      if(!capture)throw new Error('Retain and select the original merchant incident snapshot before saving service terms.');
      binding={incidentSourceId:captureSource(capture),merchantId:captureMerchant(capture),merchantBinding:capture.snapshot.merchant.binding};
    }
    return {id:t.id,expectedRevision:t.expectedRevision,...binding,title:t.title,customer:t.customer,owner:t.owner,reference:t.reference,status:t.status,
      effectiveFrom:inputUtc(t.effectiveFrom,'Service start'),effectiveUntil:inputUtc(t.effectiveUntil,'Service end',{optional:true}),
      calendar:{mode:t.calendarMode,timeZone:t.timeZone,week:t.week.map(row=>({day:row.day,windows:parseWindows(row.windows,DAYS.find(([day])=>day===row.day)[1])})),
        exceptions:t.exceptions.map(row=>({date:row.date,windows:parseWindows(row.windows,'Special date '+(row.date||'(date required)'))}))},
      targets:t.targets.filter(row=>row.enabled).map(row=>({kind:row.kind,responseMinutes:minutes(row.responseMinutes,human(row.kind)+' response target'),recoveryMinutes:minutes(row.recoveryMinutes,human(row.kind)+' recovery target')})),
      reviewedBy:t.reviewedBy,note:t.note,
    };
  }
  function renderSources(){
    const select=$('service-source');select.replaceChildren();option(select,'','Select a declared incident source');
    for(const source of profiles)option(select,source.id,source.label+' · '+source.id);
    choose(select,draft.sourceId);renderMerchants();
  }
  function renderMerchants(){
    const select=$('service-merchant');select.replaceChildren();option(select,'','Select the registered merchant');
    if(loadedSource?.source===draft.sourceId)for(const merchant of loadedSource.merchants??[])option(select,merchant.id,(merchant.label||merchant.id)+' · '+merchant.id+(merchant.registered===false?' · retained incident history':''));
    choose(select,draft.merchantId);controls();
  }
  async function getJSON(path){
    const response=await fetch(path,{method:'GET',credentials:'same-origin',headers:{accept:'application/json'},signal:abort.signal});
    let body;try{body=await response.json();}catch{throw new Error('The original support service did not return a complete JSON response (HTTP '+response.status+').');}
    if(!response.ok)throw Object.assign(new Error(body.detail||body.message||body.error||'The original source request failed (HTTP '+response.status+').'),{status:response.status,code:body.error});
    return body;
  }
  async function refreshMerchants(){
    const requested=draft.sourceId,selectedEpoch=epoch,sequence=++sourceSequence;
    loadedSource=null;sourceLoading=Boolean(requested);renderMerchants();
    if(!requested){$('service-source-status').textContent='Select an original incident source to inspect its current merchant registrations.';return;}
    $('service-source-status').textContent='Reading the selected original source…';controls();
    try{
      const result=await getJSON('/api/incidents/'+encodeURIComponent(requested));
      if(destroyed||epoch!==selectedEpoch||sourceSequence!==sequence||draft.sourceId!==requested)return;
      const merchants=result.serviceMerchants??result.merchants;
      if(!Array.isArray(merchants))throw new Error('The selected source did not return its original merchant registrations and retained history.');
      loadedSource={...result,merchants,source:requested};
      const historical=merchants.filter(row=>row.registered===false).length;
      $('service-source-status').textContent=(merchants.length-historical)+' current registrations'+(historical?' · '+historical+' merchants in retained incident history':'')+' · configuration revision '+result.configRevision+'.';
      renderMerchants();
    }catch(error){if(!destroyed&&epoch===selectedEpoch&&sourceSequence===sequence)$('service-source-status').textContent=error.message;}
    finally{if(!destroyed&&epoch===selectedEpoch&&sourceSequence===sequence){sourceLoading=false;controls();}}
  }
  async function refreshProfiles(){
    const selectedEpoch=epoch,sequence=++profileSequence;
    sourceLoading=true;controls();$('service-source-status').textContent='Reading the workspace’s declared incident sources…';
    try{
      const result=await getJSON('/api/incidents/profiles');
      if(destroyed||epoch!==selectedEpoch||profileSequence!==sequence)return;
      if(!Array.isArray(result.sources))throw new Error('The original support service did not return its configured source list.');
      profiles=result.sources;renderSources();
      if(result.enabled===false||!profiles.length){loadedSource=null;$('service-source-status').textContent='This workspace has no configured incident sources. Its retained case snapshots and reports remain available.';return;}
      if(draft.sourceId&&!profiles.some(row=>row.id===draft.sourceId)){loadedSource=null;$('service-source-status').textContent='The saved source is not configured on this host. Select a current declared source to retain more incidents.';return;}
      await refreshMerchants();
    }catch(error){if(!destroyed&&epoch===selectedEpoch&&profileSequence===sequence)$('service-source-status').textContent=error.message;}
    finally{if(!destroyed&&epoch===selectedEpoch&&profileSequence===sequence){sourceLoading=false;controls();}}
  }

  function exportFile(filename,content,type){
    const holder=document.createElement('span'),link=download(holder,'Download',filename,content,type,downloads);
    link.click();setTimeout(()=>{URL.revokeObjectURL(link.href);downloads.delete(link.href);},60000);
  }
  function detailsJSON(parent,label,value){
    const details=add(parent,'details',undefined,'service-original'),summary=add(details,'summary',label);
    details.addEventListener('toggle',()=>{if(details.open&&!details.querySelector('pre'))add(details,'pre',JSON.stringify(value,null,2));},{signal:abort.signal});return details;
  }
  function facts(parent,values){
    const dl=add(parent,'dl',undefined,'service-facts');
    for(const [label,value]of values){add(dl,'dt',label);add(dl,'dd',value??'—');}return dl;
  }
  function renderCaptures(){
    const list=$('service-captures');list.replaceChildren();
    if(!record.captures.length){add(list,'p','Retained incident snapshots appear here.','hint');return;}
    for(const capture of [...record.captures].reverse()){
      const card=add(list,'details',undefined,'service-record'),s=capture.snapshot;
      add(card,'summary',captureTitle(capture)+' · '+s.incidents.length+' original incidents');
      facts(card,[['Source revision',s.revision],['Configuration revision',s.configRevision],['Merchant binding',s.merchant.binding],['Capture SHA-256',capture.sha256]]);
      const actions=add(card,'div',undefined,'actions');
      action(actions,'Use for service binding',guarded(()=>{persistDraft();draft.bindingCapture=capture.sha256;renderTermsSelectors();persistDraft({invalidate:true});say('Selected the exact retained merchant binding for the service form.');}));
      action(actions,'Review incident exclusions',guarded(()=>{persistDraft();draft.exclusion.captureSha256=capture.sha256;draft.exclusion.incidentId='';draft.exclusion.id=crypto.randomUUID();renderExclusionForm();persistDraft();$('service-exclusion-incident').focus();}));
      action(actions,'Download original snapshot',guarded(()=>exportFile('incident-snapshot-'+capture.sha256.slice(0,12)+'.json',JSON.stringify(capture,null,2)+'\n','application/json;charset=utf-8')));
      detailsJSON(card,'Complete original retained snapshot',s);
    }
  }
  function renderExclusionForm(){
    const select=exclusionFields.captureSha256;select.replaceChildren();option(select,'','Select a retained incident snapshot');
    for(const capture of [...record.captures].reverse())option(select,capture.sha256,captureTitle(capture));
    choose(select,draft.exclusion.captureSha256);renderExclusionIncidents();
    for(const [key,node]of Object.entries(exclusionFields)){
      if(['captureSha256','incidentId'].includes(key))continue;
      if(node.tagName==='SELECT')choose(node,draft.exclusion[key]);else setField(node,draft.exclusion[key]);
    }
  }
  function renderExclusionIncidents(){
    const select=exclusionFields.incidentId,capture=captureBy(draft.exclusion.captureSha256);
    select.replaceChildren();option(select,'','Select the original incident');
    for(const incident of [...(capture?.snapshot.incidents??[])].sort((a,b)=>b.openedAt.localeCompare(a.openedAt)))option(select,incident.id,human(incident.kind)+' · '+human(incident.status)+' · '+time(incident.openedAt)+' · '+incident.id);
    choose(select,draft.exclusion.incidentId);renderExclusionTimeline();
  }
  function renderExclusionTimeline(){
    const holder=$('service-exclusion-timeline');holder.replaceChildren();
    const capture=captureBy(exclusionFields.captureSha256.value),incident=capture?.snapshot.incidents.find(row=>row.id===exclusionFields.incidentId.value);
    if(!incident){add(holder,'p','Choose an incident to review its original timeline before recording an exclusion.','hint');return;}
    facts(holder,[['Original incident',incident.id],['Condition / current state',human(incident.kind)+' / '+human(incident.status)],
      ['Opened (UTC)',time(incident.openedAt)],['Human acknowledgment',incident.acknowledgment?time(incident.acknowledgment.at)+' · '+incident.acknowledgment.by:'No recorded acknowledgment'],
      [incident.status==='RETIRED'?'Registration retired (UTC)':'Recovered (UTC)',time(incident.closedAt)],
      ['Snapshot captured (UTC)',time(captureTime(capture))],['Original incident revision',incident.revision]]);
    detailsJSON(holder,'Complete original incident',incident);
  }
  function renderExclusions(){
    const holder=$('service-exclusion-list');holder.replaceChildren();
    if(!record.exclusions.length){add(holder,'p','Each retained reviewed exclusion stays available for explicit report selection.','hint');return;}
    for(const exclusion of [...record.exclusions].reverse()){
      const card=add(holder,'details',undefined,'service-record');add(card,'summary',exclusion.incidentId+' · '+human(exclusion.scope)+' · '+time(exclusion.from)+' through '+time(exclusion.through));
      facts(card,[['Reviewed reason',exclusion.reason],['Original reference',exclusion.reference],['Reviewer',exclusion.reviewedBy],['Original capture',exclusion.captureSha256],['Exclusion ID',exclusion.id]]);
      action(card,'Use as a new reviewed choice',guarded(()=>{
        persistDraft();draft.exclusion={id:crypto.randomUUID(),captureSha256:exclusion.captureSha256,incidentId:exclusion.incidentId,
          from:utcInput(exclusion.from),through:utcInput(exclusion.through),scope:exclusion.scope,reason:exclusion.reason,reference:exclusion.reference,reviewedBy:exclusion.reviewedBy};
        renderExclusionForm();persistDraft();say('Opened a new exclusion review. The original exclusion and its retained reports stay available.');$('service-exclusion-reason').focus();
      }));
    }
  }
  function selectedHistory(){
    const t=termsBy(draft.report.termsId,draft.report.termsRevision);
    return t?record.terms.filter(row=>row.id===t.id&&row.revision<=t.revision):[];
  }
  function compatibleCapture(capture){return selectedHistory().some(t=>captureMatches(capture,t));}
  function compatibleExclusion(exclusion){
    return selectedHistory().some(t=>t.incidentSourceId===exclusion.incidentSourceId&&t.merchantId===exclusion.merchantId&&t.merchantBinding===exclusion.merchantBinding);
  }
  function renderReportSelections(){
    const captures=$('service-report-captures'),exclusions=$('service-report-exclusions');captures.replaceChildren();exclusions.replaceChildren();
    const selectedCaptures=new Set(draft.report.captureSha256s),selectedExclusions=new Set(draft.report.exclusionIds);
    for(const capture of [...record.captures].reverse()){
      const match=compatibleCapture(capture),label=add(captures,'label',undefined,'service-choice');
      const check=add(label,'input');check.type='checkbox';check.dataset.serviceCapture=capture.sha256;check.checked=selectedCaptures.has(capture.sha256);
      add(label,'span',captureTitle(capture)+' · '+capture.snapshot.incidents.length+' retained incidents'+(match?'':' · outside this terms history'));
      check.dataset.incompatible=String(!match&&!check.checked);
    }
    for(const sha of selectedCaptures)if(!captureBy(sha)){
      const label=add(captures,'label',undefined,'service-choice'),check=add(label,'input');check.type='checkbox';check.dataset.serviceCapture=sha;check.checked=true;add(label,'span','Saved capture is unavailable · '+sha+'. Clear it or reopen the complete original case.');
    }
    if(!record.captures.length)add(captures,'p','Retain the original incident snapshots before selecting the reporting sources.','hint');
    for(const exclusion of record.exclusions){
      const match=compatibleExclusion(exclusion),label=add(exclusions,'label',undefined,'service-choice');
      const check=add(label,'input');check.type='checkbox';check.dataset.serviceExclusion=exclusion.id;check.checked=selectedExclusions.has(exclusion.id);check.dataset.incompatible=String(!match&&!check.checked);
      const text=add(label,'span');add(text,'strong',exclusion.incidentId+' · '+human(exclusion.scope));
      add(text,'span',time(exclusion.from)+' through '+time(exclusion.through)+' · '+exclusion.reason+(match?'':' · outside this terms history'));
      add(text,'small',exclusion.reference+' · reviewed by '+exclusion.reviewedBy);
    }
    for(const id of selectedExclusions)if(!record.exclusions.some(row=>row.id===id)){
      const label=add(exclusions,'label',undefined,'service-choice'),check=add(label,'input');check.type='checkbox';check.dataset.serviceExclusion=id;check.checked=true;add(label,'span','Saved exclusion is unavailable · '+id+'. Clear it or reopen the complete original case.');
    }
    if(!record.exclusions.length)add(exclusions,'p','Retained exclusions are applied only when selected here.','hint');
    updatePeriod();controls();
  }
  function updatePeriod(){
    const terms=termsBy(draft.report.termsId,draft.report.termsRevision);
    try{const range=monthRange(readField($('service-report-month')));$('service-report-period').textContent=range.from+' through '+range.through+' inclusive'+(terms?' in '+terms.calendar.timeZone:'')+'.';}
    catch{$('service-report-period').textContent='Select the complete month in the service time zone.';}
  }
  function fillReport(){
    setField($('service-report-month'),draft.report.month);setField($('service-report-as-of'),draft.report.asOf);
    setField($('service-report-reviewer'),draft.report.reviewedBy);setField($('service-report-note'),draft.report.note);renderReportSelections();
  }
  function reportSelection(){
    const d=readDraft().report;return {termsId:d.termsId,termsRevision:d.termsRevision,...monthRange(d.month),
      asOf:inputUtc(d.asOf,'Report cutoff'),captureSha256s:d.captureSha256s,exclusionIds:d.exclusionIds};
  }
  function newReportSelection(terms){
    draft.report.termsId=terms.id;draft.report.termsRevision=terms.revision;
    draft.report.captureSha256s=record.captures.filter(compatibleCapture).map(row=>row.sha256);
    draft.report.exclusionIds=[];
    const latest=record.captures.filter(row=>draft.report.captureSha256s.includes(row.sha256)).map(captureTime).sort().at(-1);
    if(latest)draft.report.asOf=utcInput(latest);
  }
  function summaryTable(parent,p){
    const wrap=add(parent,'div',undefined,'case-table-wrap'),table=add(wrap,'table',undefined,'case-table');
    const thead=add(table,'thead'),head=add(thead,'tr');
    for(const title of ['Clock','Met','Missed','Open within target','Retired','Recovered without acknowledgment'])add(head,'th',title).scope='col';
    const tbody=add(table,'tbody');
    for(const [kind,label]of [['response','Response'],['recovery','Recovery']]){
      const row=add(tbody,'tr');add(row,'th',label).scope='row';for(const state of ['MET','MISSED','OPEN','RETIRED','UNACKNOWLEDGED'])add(row,'td',p.summary[kind]?.[state]??0);
    }
  }
  function renderReport(parent,p){
    parent.replaceChildren();add(parent,'h4',p.terms.title+' · '+p.selection.from.slice(0,7));
    facts(parent,[['Customer',p.terms.customer],['Selected service edition',p.terms.revision+' · '+human(p.terms.status)],['Responsible owner',p.terms.owner],
      ['Reporting dates',p.selection.from+' through '+p.selection.through+' · '+p.period.timeZone],['Explicit report cutoff (UTC)',p.selection.asOf],
      ['Covered retained incidents',p.summary.incidents],['Open follow-up',p.summary.open],['Recovered / retired',p.summary.recovered+' / '+p.summary.retired],
      ['Proposed terms applied',p.summary.proposed],['Additional incidents outside coverage',p.summary.uncovered]]);
    summaryTable(parent,p);add(parent,'p',p.basis,'hint');
    const nav=add(parent,'div',undefined,'service-report-navigation');
    const search=field(nav,'Find incident, source, owner or condition','service-find-'+crypto.randomUUID(),'search');
    const filter=field(nav,'Incident state','service-state-'+crypto.randomUUID(),'select');
    option(filter,'','All incidents');for(const state of ['OPEN','ACKNOWLEDGED','RECOVERED','RETIRED'])option(filter,state,human(state));
    const wrap=add(parent,'div',undefined,'case-table-wrap'),table=add(wrap,'table',undefined,'case-table service-incident-table'),head=add(add(table,'thead'),'tr');
    for(const title of ['Original incident','Original timeline (UTC)','Response','Recovery','Owner and follow-up'])add(head,'th',title).scope='col';
    const body=add(table,'tbody'),footer=add(parent,'div',undefined,'service-report-pages'),position=add(footer,'span','', 'hint');
    let offset=0;const previous=action(footer,'Previous',()=>{offset=Math.max(0,offset-25);draw();}),next=action(footer,'Next',()=>{offset+=25;draw();});
    const metricCell=(row,m)=>{
      const cell=add(row,'td');add(cell,'strong',human(m.state));add(cell,'div',numberText(m.serviceMinutes)+' / '+m.targetMinutes+' service min');
      add(cell,'small','Calendar '+numberText(m.calendarMinutes)+' min · excluded '+numberText(m.excludedMinutes)+' min · actual elapsed '+numberText(m.elapsedMinutes)+' min');
      add(cell,'small','Deadline '+time(m.deadline));add(cell,'small','Measured through '+time(m.through));return cell;
    };
    function draw(){
      const q=search.value.trim().toLowerCase(),rows=p.incidents.filter(i=>(!filter.value||i.status===filter.value)&&(!q||[i.id,i.kind,i.sourceId,i.merchantId,i.owner,i.followUp].join(' ').toLowerCase().includes(q)));
      if(offset>=rows.length)offset=Math.max(0,Math.floor(Math.max(0,rows.length-1)/25)*25);
      body.replaceChildren();
      for(const incident of rows.slice(offset,offset+25)){
        const row=add(body,'tr'),identity=add(row,'td');add(identity,'strong',human(incident.kind));add(identity,'div',human(incident.status));add(identity,'small',incident.id);
        add(identity,'small',incident.sourceId+' / '+incident.merchantId+' · terms edition '+incident.termsRevision+' ('+human(incident.termsStatus)+')');
        detailsJSON(identity,'Original incident record',incident.original);
        const timeline=add(row,'td');
        for(const [label,value]of [['Opened',incident.openedAt],['Acknowledged',incident.acknowledgedAt],['Recovered',incident.recoveredAt],['Retired',incident.retiredAt]])add(timeline,'div',label+': '+time(value));
        if(incident.acknowledgedBy)add(timeline,'small','Acknowledged by '+incident.acknowledgedBy);
        if(incident.retiredReason)add(timeline,'small',human(incident.retiredReason));
        add(timeline,'small','Actual selected capture '+time(incident.capturedAt));add(timeline,'small','Evaluated cutoff '+time(incident.evaluatedAsOf));
        metricCell(row,incident.response);metricCell(row,incident.recovery);
        const follow=add(row,'td');add(follow,'strong',incident.owner);add(follow,'div',incident.followUp);
        if(incident.exclusionIds.length)add(follow,'small',incident.exclusionIds.length+' selected reviewed exclusions');
      }
      if(!rows.length){const row=add(body,'tr');add(row,'td','No original incidents match this view.').colSpan=5;}
      position.textContent=rows.length?'Showing '+(offset+1)+'–'+Math.min(offset+25,rows.length)+' of '+rows.length:'0 incidents';
      previous.dataset.disabledAtRest=String(offset===0);next.dataset.disabledAtRest=String(offset+25>=rows.length);
      previous.disabled=offset===0;next.disabled=offset+25>=rows.length;
    }
    search.addEventListener('input',()=>{offset=0;draw();},{signal:abort.signal});filter.addEventListener('change',()=>{offset=0;draw();},{signal:abort.signal});draw();
    if(p.uncovered.length){
      const details=add(parent,'details',undefined,'service-original');add(details,'summary',p.uncovered.length+' additional source incidents outside the selected coverage');
      const list=add(details,'div');for(const incident of p.uncovered){const row=add(list,'details',undefined,'service-record');add(row,'summary',human(incident.kind)+' · '+incident.id+' · '+human(incident.reason));
        const original=captureBy(incident.captureSha256)?.snapshot.incidents.find(i=>i.id===incident.id);if(original)detailsJSON(row,'Complete original incident',original);
        facts(row,[['Source / merchant',incident.sourceId+' / '+incident.merchantId],['Original capture',incident.captureSha256],['Selection result',human(incident.reason)]]);
      }
    }
    const terms=add(parent,'details',undefined,'service-original');add(terms,'summary','Original agreement and calendar editions ('+p.termsEditions.length+')');
    for(const edition of p.termsEditions){const card=add(terms,'details',undefined,'service-record');add(card,'summary','Edition '+edition.revision+' · '+human(edition.status)+' · '+edition.effectiveFrom);
      facts(card,[['Original reference',edition.reference||'Proposed service terms'],['Owner',edition.owner],['Effective end',edition.effectiveUntil??'Open-ended'],['Reviewer',edition.reviewedBy],['Time zone',edition.calendar.timeZone]]);
      detailsJSON(card,'Complete original service edition',edition);
    }
    const sources=add(parent,'details',undefined,'service-original');add(sources,'summary','Retained source snapshots ('+p.sourceCaptures.length+')');
    for(const capture of p.sourceCaptures)facts(sources,[['Original source / merchant',capture.source.label+' / '+capture.merchant.label],['Captured at',capture.capturedAt],['Source / configuration revision',capture.revision+' / '+capture.configRevision],['Original capture SHA-256',capture.sha256],['Retained incident count',capture.incidentCount]]);
    const exclusions=add(parent,'details',undefined,'service-original');add(exclusions,'summary','Selected reviewed exclusions ('+p.exclusions.length+')');
    for(const exclusion of p.exclusions)facts(exclusions,[['Incident',exclusion.incidentId],['Interval / scope',exclusion.from+' through '+exclusion.through+' · '+human(exclusion.scope)],['Reason',exclusion.reason],['Reference / reviewer',exclusion.reference+' · '+exclusion.reviewedBy]]);
    if(p.unusedExclusionIds.length)add(parent,'p',p.unusedExclusionIds.length+' selected exclusions do not apply to the incidents in this report. Review the selected IDs: '+p.unusedExclusionIds.join(', '),'hint');
  }

  function renderReports(){
    const list=$('service-report-list');list.replaceChildren();
    if(!record.reports.length)add(list,'p','Reviewed monthly reports retained in this case appear here.','hint');
    for(const report of [...record.reports].reverse()){
      const row=add(list,'div',undefined,'service-report-entry'),p=report.preview;
      const body=add(row,'div');add(body,'strong',p.terms.title+' · '+p.selection.from.slice(0,7));add(body,'small',report.reviewedBy+' · '+time(report.createdAt)+' · '+p.summary.incidents+' covered incidents · '+p.summary.open+' open follow-up');
      const open=action(row,'Open retained report',guarded(()=>openReport(report.id)));open.dataset.serviceReportId=report.id;
    }
  }
  function openReport(id,{persist=true}={}){
    const report=record.reports.find(row=>row.id===id);
    if(!report)throw new Error('The selected retained report is not in the current case.');
    activeReport=report.id;draft.report.selectedReportId=report.id;
    const section=$('service-saved-report');section.hidden=false;
    $('service-saved-report-title').textContent=report.preview.terms.title+' · '+report.preview.selection.from.slice(0,7)+' · saved review';
    const links=$('service-report-downloads');links.replaceChildren();
    const prefix='service-report-'+report.preview.selection.from.slice(0,7)+'-'+report.id;
    const json=action(links,'Download report JSON',guarded(()=>exportFile(prefix+'.json',JSON.stringify(report,null,2)+'\n','application/json;charset=utf-8')));json.id='service-report-json';
    const csv=action(links,'Download incident CSV',guarded(()=>exportFile(prefix+'.csv',serviceReportCsv(report),'text/csv;charset=utf-8')));csv.id='service-report-csv';
    const html=action(links,'Download printable report',guarded(()=>exportFile(prefix+'.html',renderServiceReport(report),'text/html;charset=utf-8')));html.id='service-report-html';
    const complete=action(links,'Download complete service record',guarded(()=>exportFile('service-record-'+report.id+'.json',JSON.stringify(read(),null,2)+'\n','application/json;charset=utf-8')));complete.id='service-record-json';
    const holder=$('service-saved-report-body');renderReport(holder,report.preview);
    facts(holder,[['Review author',report.reviewedBy],['Review note',report.note||'—'],['Retained at',report.createdAt],['Original report ID',report.id],['Report SHA-256',report.sha256]]);
    if(persist)persistDraft();controls();
  }
  function closeReport(){
    activeReport=null;draft.report.selectedReportId='';$('service-saved-report').hidden=true;$('service-saved-report-body').replaceChildren();$('service-report-downloads').replaceChildren();persistDraft();
  }
  function renderAll(){
    revokeDownloads();renderSources();renderTermsSelectors();fillTerms();renderCaptures();renderExclusionForm();renderExclusions();fillReport();renderReports();
    const selected=draft.report.selectedReportId;
    if(selected&&record.reports.some(row=>row.id===selected))openReport(selected,{persist:false});
    else{activeReport=null;$('service-saved-report').hidden=true;$('service-saved-report-body').replaceChildren();$('service-report-downloads').replaceChildren();}
    controls();
  }
  function handleDraftInput(event){
    const target=event.target;
    if(!(target instanceof Element)||!target.closest('form')||loading||busy||destroyed||loadFailed)return;
    if(target.dataset.retainedValue!==undefined){delete target.dataset.retainedValue;target.removeAttribute('title');}
    const special=new Set(['service-source','service-merchant','service-exclusion-capture','service-exclusion-incident','service-report-terms']);
    if(special.has(target.id))return;
    const invalidates=target.closest('#service-report-form')!==null;
    persistDraft({invalidate:invalidates});
    if(target.id==='service-report-month')updatePeriod();
    if(target.id==='service-calendar-mode'||target.matches('[data-service-kind]'))controls();
  }
  on(root,'input',guarded(handleDraftInput));on(root,'change',guarded(handleDraftInput));
  on($('service-source-refresh'),'click',guarded(()=>refreshProfiles()));
  on($('service-source'),'change',guarded(()=>{
    persistDraft();draft.sourceId=$('service-source').value;draft.merchantId='';loadedSource=null;renderMerchants();persistDraft();return refreshMerchants();
  }));
  on($('service-merchant'),'change',guarded(()=>persistDraft()));
  on($('service-source-form'),'submit',guarded(event=>{
    event.preventDefault();const sourceId=$('service-source').value,merchantId=$('service-merchant').value;
    if(!sourceId||!merchantId||!loadedSource?.merchants?.some(row=>row.id===merchantId))throw new Error('Select the declared source and an original current or retained merchant.');
    return run('Retaining the current original incident snapshot…',async snapshot=>{
      const response=await getJSON('/api/services/incident-snapshot?source='+encodeURIComponent(sourceId)+'&merchant='+encodeURIComponent(merchantId));
      if(response.snapshot?.source?.id!==sourceId||response.snapshot?.merchant?.id!==merchantId)throw new Error('The returned source snapshot belongs to another source or merchant.');
      return retainServiceSnapshot(snapshot,response.snapshot);
    },result=>{
      const next=clone(draft),capture=result.capture;
      next.sourceId=sourceId;next.merchantId=merchantId;
      if(!next.bindingCapture)next.bindingCapture=capture.sha256;
      if(!next.terms.customer)next.terms.customer=capture.snapshot.merchant.label;
      if(!next.exclusion.captureSha256)next.exclusion.captureSha256=capture.sha256;
      const selected=termsBy(next.report.termsId,next.report.termsRevision),matches=!selected||record.terms.filter(t=>t.id===selected.id&&t.revision<=selected.revision).some(t=>captureMatches(capture,t));
      if(matches){if(!next.report.captureSha256s.includes(capture.sha256))next.report.captureSha256s.push(capture.sha256);next.report.asOf=utcInput(captureTime(capture));}
      commit(result.record,next,'Retained '+capture.snapshot.incidents.length+' original incidents at '+time(captureTime(capture))+'. Save the original case to preserve this snapshot.');
    });
  }));
  on($('service-terms-edition'),'change',guarded(()=>persistDraft()));
  on($('service-terms-open'),'click',guarded(()=>{
    persistDraft();const key=readTermsKey($('service-terms-edition').value),terms=termsBy(key.id,key.revision);
    if(!terms)throw new Error('Choose an original retained service edition.');editTerms(terms);controls();
  }));
  on($('service-terms-new'),'click',guarded(()=>{
    persistDraft();const empty=emptyDraft();
    draft.terms=empty.terms;draft.selectedTermsId='';draft.selectedTermsRevision=null;draft.editionChoice='';
    draft.bindingCapture=captureBy(draft.bindingCapture)?draft.bindingCapture:'';
    renderTermsSelectors();fillTerms();persistDraft();say('Prepared a new service agreement in this case.');$('service-terms-title').focus();
  }));
  on($('service-calendar-add'),'click',guarded(()=>{
    persistDraft();if(draft.terms.exceptions.length>=1000)throw new Error('This calendar already contains 1,000 special dates.');
    draft.terms.exceptions.push({date:'',windows:''});renderExceptions();persistDraft();controls();
    $('service-calendar-exceptions').lastElementChild?.querySelector('input')?.focus();
  }));
  on($('service-terms-form'),'submit',guarded(event=>{
    event.preventDefault();const input=termsInput();
    return run('Retaining the reviewed service edition…',snapshot=>saveServiceTerms(snapshot,input),result=>{
      const next=clone(draft),terms=result.terms;
      next.selectedTermsId=terms.id;next.selectedTermsRevision=terms.revision;next.editionChoice=termsKey(terms);
      next.terms.expectedRevision=terms.revision;next.bindingCapture='terms:'+termsKey(terms);next.terms.note='';
      if(!next.report.termsId||next.report.termsId===terms.id){
        next.report.termsId=terms.id;next.report.termsRevision=terms.revision;
        const history=result.record.terms.filter(t=>t.id===terms.id&&t.revision<=terms.revision);
        if(!next.report.captureSha256s.length)next.report.captureSha256s=result.record.captures.filter(c=>history.some(t=>captureMatches(c,t))).map(c=>c.sha256);
        if(!next.report.reviewedBy)next.report.reviewedBy=terms.reviewedBy;
      }
      commit(result.record,next,'Retained service edition '+terms.revision+'. Its original targets and calendar are saved with the case.');
    });
  }));
  on(exclusionFields.captureSha256,'change',guarded(()=>{
    persistDraft();draft.exclusion.captureSha256=exclusionFields.captureSha256.value;draft.exclusion.incidentId='';draft.exclusion.id=crypto.randomUUID();draft.exclusion.from='';draft.exclusion.through='';
    renderExclusionForm();persistDraft();controls();
  }));
  on(exclusionFields.incidentId,'change',guarded(()=>{
    persistDraft();draft.exclusion.incidentId=exclusionFields.incidentId.value;draft.exclusion.id=crypto.randomUUID();draft.exclusion.from='';draft.exclusion.through='';
    setField(exclusionFields.from,'');setField(exclusionFields.through,'');renderExclusionTimeline();persistDraft();controls();
  }));
  on($('service-exclusion-form'),'submit',guarded(event=>{
    event.preventDefault();const d=readDraft().exclusion,input={...d,from:inputUtc(d.from,'Exclusion start'),through:inputUtc(d.through,'Exclusion end')};
    return run('Retaining the reviewed original incident exclusion…',snapshot=>saveServiceExclusion(snapshot,input),result=>{
      const next=clone(draft);next.exclusion.id=crypto.randomUUID();
      commit(result.record,next,'Retained the reviewed exclusion. Select it explicitly in the monthly report when it applies.');
    });
  }));
  on($('service-report-terms'),'change',guarded(()=>{
    persistDraft();const key=readTermsKey($('service-report-terms').value),terms=termsBy(key.id,key.revision);
    if(terms)newReportSelection(terms);
    else{draft.report.termsId='';draft.report.termsRevision=null;draft.report.captureSha256s=[];draft.report.exclusionIds=[];}
    fillReport();persistDraft({invalidate:true});say('Selected the report terms history and its retained captures. Review the exact capture and exclusion choices below.');
  }));
  on($('service-report-now'),'click',guarded(()=>{setField($('service-report-as-of'),utcInput(isoNow()));persistDraft({invalidate:true});}));
  on($('service-report-form'),'submit',guarded(event=>{
    event.preventDefault();const selection=reportSelection();
    return run('Calculating the report from the selected original terms, captures and exclusions…',snapshot=>previewServiceReport(snapshot,selection),result=>{
      preview=result;previewSelection=clone(selection);
      renderReport($('service-report-preview-body'),result);$('service-report-preview-body').hidden=false;$('service-report-retain-form').hidden=false;
      say('Review the complete month and its '+result.summary.incidents+' covered incidents before retaining this report.');
    });
  }));
  on($('service-report-retain-form'),'submit',guarded(event=>{
    event.preventDefault();if(!preview||!previewSelection)throw new Error('Review the current monthly report first.');
    const selection=reportSelection();
    if(!same(selection,previewSelection))throw new Error('The report selection changed. Review the complete current selection before retaining it.');
    const reportPreview=preview,input={...selection,expectedPreviewSha256:preview.previewSha256,reviewedBy:readField($('service-report-reviewer')),note:readField($('service-report-note'))};
    return run('Retaining the complete reviewed monthly report…',snapshot=>retainServiceReport(snapshot,input),result=>{
      if(result.report.preview.previewSha256!==reportPreview.previewSha256)throw new Error('The retained report differs from the reviewed source selection.');
      const next=clone(draft);next.report.selectedReportId=result.report.id;
      commit(result.record,next,'Retained the reviewed monthly report. Save the original case to preserve its complete report and source records.');
      openReport(result.report.id,{persist:false});
    });
  }));
  on($('service-report-close'),'click',guarded(closeReport));
  async function load(value=readRecord(),{canReplace=()=>true}={}){
    const previousValid=!loading&&!loadFailed,previousSource=loadedSource;
    const selectedEpoch=++epoch;change++;sourceSequence++;profileSequence++;busy=false;sourceLoading=false;loading=true;loadFailed=false;
    clearPreview();revokeDownloads();loadedSource=null;controls();say('Opening the current service record…');
    try{
      const normalized=await validateServiceRecord(value),nextDraft=draftFrom(normalized.draft);
      checkedRecord(normalized,nextDraft);
      if(destroyed||epoch!==selectedEpoch)throw new Error('This service record load was superseded by another case.');
      if(!canReplace())throw new Error('The current case changed while its service record was opening.');
      record=normalized;draft=nextDraft;baseBytes=sizeOf({...record,draft:{}})-2;activeReport=null;
      renderAll();loading=false;controls();say('Service record opened. Changes are retained with the original Save case action.');
      void refreshProfiles();
      return clone(record);
    }catch(error){
      if(!destroyed&&epoch===selectedEpoch){
        loading=false;loadFailed=!previousValid;loadedSource=previousSource;
        if(previousValid)renderAll();controls();say(error.message??String(error),true);
      }
      throw error;
    }
  }
  function read(){
    if(destroyed||loading||loadFailed)throw new Error('Open the complete service record before saving this case.');
    if(busy)throw new Error('Finish the current service operation before saving or exporting its case.');
    return clone(checkedRecord(record,readDraft()));
  }
  function setEnabled(value){enabled=Boolean(value);controls();}
  function destroy(){destroyed=true;epoch++;abort.abort();revokeDownloads();controls();}
  void load(readRecord()).catch(()=>{});
  return {load,read,setEnabled,destroy};
}
