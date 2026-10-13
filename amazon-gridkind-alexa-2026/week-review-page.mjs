// Standalone recipient UI. No HTTP calls or household mutation can run in this file.
import {createHash} from 'node:crypto';
import {inspectRequestPackage} from './week-review.mjs';
export const REVIEW_SOURCE_FILES=Object.freeze(['engine.mjs','weekly.mjs','exact-inputs.js','week-review.mjs']);
function safeJson(value){return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));}
const PAGE="<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'\">\n<title>GridKind — review a household week offline</title><style>__STYLE__</style></head><body><main>\n<header><div class=\"eyebrow\">GridKind / Household week review</div><h1>Review this household week</h1><span class=\"off-line-pill\">Offline · No account or connection needed</span><p class=\"dim\">Edit the proposed seven-day inputs, calculate their schedules, and return your suggestions to the household owner. This file never approves a daily plan or controls a device.</p></header>\n<div id=\"error\" class=\"warning\" role=\"alert\"></div><p id=\"review-status\" class=\"status\" role=\"status\" aria-live=\"polite\">Opening the original request and embedded planner…</p>\n<section class=\"panel\"><div class=\"eyebrow\">The owner's request</div><h2 id=\"request-title\">Opening saved week…</h2><p id=\"request-recipient\" class=\"meta\"></p><p id=\"request-message\" class=\"request-message\"></p><p id=\"request-dates\" class=\"meta\"></p>\n<details><summary>Original request and embedded calculation sources</summary><div id=\"source-details\"></div><button type=\"button\" id=\"review-download-request\" class=\"secondary\" disabled>Download original request JSON</button></details></section>\n<div class=\"layout\"><div><section class=\"panel\"><div class=\"eyebrow\">1 · Review the inputs</div><h2>Your suggested week</h2><p class=\"dim\">The first date stays fixed to the original review. Hourly prices and loads are household assumptions; dates do not provide utility rates.</p>\n<form id=\"review-form\"><fieldset id=\"review-fields\" disabled><legend class=\"sr-only\">Suggested weekly inputs</legend>\n<div class=\"settings\"><label for=\"review-week-name\">Week name<input id=\"review-week-name\" maxlength=\"100\" required></label><label for=\"review-start-date\">First date<input id=\"review-start-date\" type=\"date\" readonly></label></div>\n<div id=\"review-day-picker\" class=\"day-picker\" role=\"group\" aria-label=\"Choose a day to review\"></div>\n<h3 id=\"review-day-title\">Selected day</h3><label class=\"check\"><input id=\"review-day-enabled\" type=\"checkbox\">Schedule flexible loads this day</label><p id=\"review-rest-note\" class=\"dim only-hidden\">Rest day. The inputs are retained if you enable it again.</p>\n<fieldset id=\"custom-fields\"><legend class=\"sr-only\">Selected day's exact inputs</legend><label for=\"custom-max-kw\" class=\"custom-cap\">Shared circuit cap (kW)<input id=\"custom-max-kw\" type=\"number\" min=\"0.5\" max=\"50\" step=\"any\"></label><h3>Hourly prices</h3><p class=\"field-hint\">$/kWh at the entered local clock hours, 00 through 23.</p><div id=\"hourly-rates\" class=\"hourly-rates\"></div><div class=\"section-heading\"><h3>Flexible loads</h3><span id=\"custom-load-count\" class=\"meta\">0 of 5 loads</span></div><div id=\"custom-loads\"></div><button id=\"add-custom-load\" type=\"button\" class=\"secondary\">Add a flexible load</button></fieldset>\n<label for=\"review-day-note\">Note for this day<textarea id=\"review-day-note\" maxlength=\"2000\" rows=\"3\" placeholder=\"Explain a changed load window or household constraint.\"></textarea></label></fieldset>\n<div class=\"controls\"><button type=\"submit\" id=\"review-recalculate\" disabled>Calculate suggested week</button></div></form></section>\n<section class=\"panel\"><div class=\"eyebrow\">2 · Compare the schedules</div><h2>Original and suggested plans</h2><p id=\"review-result-status\" class=\"notice\">The original saved result will appear after the request opens.</p><div id=\"review-results\"></div></section></div>\n<aside><section class=\"panel\"><div class=\"eyebrow\">3 · Return your suggestions</div><h2>Reviewer and notes</h2><label for=\"reviewer-name\">Your name or label<input id=\"reviewer-name\" maxlength=\"100\" placeholder=\"Your name\" disabled></label><p class=\"field-hint\">This is a self-stated label, not a verified identity or approval.</p><label for=\"reviewer-notes\">Overall notes<textarea id=\"reviewer-notes\" maxlength=\"8000\" rows=\"5\" disabled></textarea></label><div class=\"controls\"><button id=\"review-download-response\" type=\"button\" disabled>Download response JSON</button></div><p class=\"dim\">Send that JSON file to the household owner through your usual channel. They will compare it with their current saved week and choose how to apply changes.</p><p id=\"review-response-status\" class=\"meta\" role=\"status\"></p></section>\n<section class=\"panel\"><h2>Pause and reopen</h2><p class=\"dim\">Save a draft file before closing this page. Reopen this HTML and choose that draft to continue exactly where you left off.</p><div class=\"controls\"><button id=\"review-save-draft\" type=\"button\" class=\"secondary\" disabled>Save review draft JSON</button></div><label for=\"review-open-draft\">Open a saved review draft or response<input id=\"review-open-draft\" class=\"file-input\" type=\"file\" accept=\".json,application/json\" disabled></label><p id=\"review-draft-status\" class=\"meta\" role=\"status\"></p></section></aside></div>\n<footer class=\"dim\"><p>Costs cover only the entered flexible loads. Each day is optimized separately with continuous run times, load windows, quiet hours and a shared circuit limit. Infeasible days are shown explicitly and excluded from planned-cost totals. The owner must plan, approve and execute any daily simulation separately.</p></footer>\n</main><script type=\"application/json\" id=\"gridkind-review-data\">__DATA__</script><script>__BOOT__</script></body></html>";
const STYLE="\n:root{font-family:Arial,Helvetica,sans-serif;color:#20272b;background:#eef1f2;line-height:1.5;font-size:16px}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:28px 24px 50px}header{margin-bottom:24px}.eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#52636c}h1{font-size:32px;line-height:1.15;margin:8px 0 16px}h2{font-size:23px;margin:0 0 14px}h3{font-size:18px;margin:18px 0 10px}p{margin:10px 0}.dim,.field-hint,.meta{color:#52616a}.field-hint,.meta{font-size:13px}.panel{padding:24px;background:#fff;border:1px solid #c5cdd1;border-radius:5px;margin-bottom:22px}.layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:22px}.controls,.section-heading{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.section-heading{justify-content:space-between}.controls{margin:16px 0}button,.file-button{font:inherit;font-weight:600;padding:10px 16px;min-height:44px;border:1px solid #253b47;border-radius:4px;background:#253b47;color:#fff;cursor:pointer}.secondary,.file-button{background:#fff;color:#253b47}button:disabled{opacity:.48;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #2a7399;outline-offset:3px}input,textarea,select{font:inherit;color:inherit;background:white;border:1px solid #929fa7;border-radius:3px;padding:10px;width:100%;min-height:42px}input[type=checkbox]{width:20px;min-height:20px;margin:0}label{display:block;font-size:14px;font-weight:600}label input,label textarea{display:block;margin-top:5px}textarea{resize:vertical;min-height:90px}fieldset{border:0;padding:0;margin:0;min-width:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.settings,.scenario-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.day-picker{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin:22px 0}.day-picker button{padding:10px 3px;display:grid;gap:4px;background:#fff;color:#253b47}.day-picker button[aria-pressed=true]{background:#253b47;color:white}.day-picker small{font-size:11px}.check{display:flex;gap:10px;align-items:center;margin:14px 0}.check input{display:inline}.hourly-rates{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.hourly-rates label{font-size:12px}.load-card{border-top:1px solid #cdd4d8;padding:18px 0}.custom-load-heading{display:flex;gap:12px;align-items:flex-end;margin-bottom:12px}.custom-load-heading label{flex:1;min-width:0}.custom-load-heading button{font-size:13px;padding:9px}.custom-cap{max-width:270px}.table-wrap{max-width:100%;overflow:auto;margin:14px 0}table{border-collapse:collapse;width:100%;min-width:430px;text-align:left}th,td{padding:11px 10px;border-bottom:1px solid #d3dadd;vertical-align:top}th{font-size:12px;color:#435863;background:#f0f3f4}td{font-size:14px}.number{font-variant-numeric:tabular-nums;white-space:nowrap}.notice{border-left:4px solid #5b7180;padding:12px 16px;background:#f0f4f6}.warning{color:#7b2717;background:#fff1eb;border:1px solid #d69987;padding:12px 16px}.warning:empty{display:none}.only-hidden{display:none!important}.source-hash{overflow-wrap:anywhere;font:12px ui-monospace,monospace}details{margin:16px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f6;padding:12px;font-size:12px}.file-input{font-size:13px}.result-card{border-top:1px solid #ccd5da;padding:12px 0}.status{min-height:24px}.request-message{white-space:pre-wrap}.off-line-pill{display:inline-block;border:1px solid #9daeb8;padding:5px 10px;background:#fff;font-size:13px;border-radius:3px}\n@media(max-width:900px){.layout{grid-template-columns:1fr}main{padding:22px 18px}.panel{padding:20px}}@media(max-width:540px){main{padding:18px 12px}h1{font-size:28px}.panel{padding:16px}.settings,.scenario-grid{grid-template-columns:1fr}.hourly-rates{grid-template-columns:repeat(3,minmax(0,1fr))}.day-picker{grid-template-columns:repeat(4,minmax(0,1fr))}.controls>*{width:100%}.custom-load-heading{align-items:stretch;flex-direction:column}.custom-load-heading button{align-self:flex-start}.source-hash{font-size:11px}}\n";
function offlineBoot(){
'use strict';
const $=id=>document.getElementById(id),clone=v=>structuredClone(v);
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const money=n=>Number.isFinite(n)?'$'+n.toFixed(4):'—',hour=n=>String(n).padStart(2,'0')+':00';
const data=JSON.parse($('gridkind-review-data').textContent);
const urls=new Map();let revoked=false;
function error(e){$('error').textContent=e.message||String(e);}
function download(value,name,type='application/json'){
  const content=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',url=URL.createObjectURL(new Blob([content],{type}));
  const a=make('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function moduleUrl(name){
  if(urls.has(name))return urls.get(name);
  if(!Object.hasOwn(data.sources,name))throw Error('The embedded source is missing '+name+'.');
  const source=data.sources[name].replace(/(\bfrom\s*['"]|\bimport\s*['"])(\.\/[^'"]+)(['"])/g,(all,start,path,end)=>start+moduleUrl(path.slice(2))+end);
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.set(name,url);return url;
}
let bundle,request,baseReport,input,reviewer='',notes='',dayNotes=Array(7).fill(''),selected=0,responseId=null,editor=null,proposed=null,busy=false,ready=false,fileVersion=0,editVersion=0,savedVersion=0;
const identity=()=>({id:request.id,sha256:request.sha256});
function uuid(){if(!crypto.randomUUID)throw Error('Use a current browser with secure random identifiers to save a response.');return crypto.randomUUID();}
function touched(){editVersion++;responseId=null;$('review-response-status').textContent='The suggested inputs or notes changed. Download a new response when ready.';}
function capture(){
  if(!ready)return;
  input.name=$('review-week-name').value;
  input.days[selected]={enabled:$('review-day-enabled').checked,scenario:editor.read()};
  reviewer=$('reviewer-name').value;notes=$('reviewer-notes').value;dayNotes[selected]=$('review-day-note').value;
}
function refresh(){
  $('review-fields').disabled=!ready||busy;editor?.refresh(!ready||busy||!input.days[selected].enabled);
  for(const id of ['review-recalculate','review-download-response','review-save-draft','review-download-request','review-open-draft','reviewer-name','reviewer-notes'])$(id).disabled=!ready||busy;
  for(const b of $('review-day-picker').querySelectorAll('button'))b.disabled=busy;
}
function picker(){
  $('review-day-picker').replaceChildren();
  input.days.forEach((d,i)=>{const b=make('button');b.type='button';b.dataset.reviewDay=String(i);b.setAttribute('aria-pressed',String(i===selected));
    b.append(make('strong',['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(baseReport.days[i].date+'T00:00:00Z').getUTCDay()]),make('span',baseReport.days[i].date.slice(5)),make('small',d.enabled?d.scenario.tasks.length+' loads':'Rest day'));
    b.onclick=()=>{try{capture();selected=i;fillDay();$('error').textContent='';}catch(e){error(e);}};$('review-day-picker').append(b);});
}
function fillDay(){
  $('review-day-title').textContent=baseReport.days[selected].date;$('review-day-enabled').checked=input.days[selected].enabled;
  $('review-day-note').value=dayNotes[selected];$('review-rest-note').classList.toggle('only-hidden',input.days[selected].enabled);
  editor.fill(input.days[selected].scenario);picker();refresh();
}
function fill(){
  $('review-week-name').value=input.name;$('review-start-date').value=input.startDate;$('reviewer-name').value=reviewer;$('reviewer-notes').value=notes;fillDay();
}
function changed(){
  if(!ready||busy)return;
  touched();proposed=null;
  try{capture();$('error').textContent='';picker();$('review-rest-note').classList.toggle('only-hidden',input.days[selected].enabled);}
  catch(e){error(e);}
  $('review-result-status').textContent='Inputs changed. Calculate the suggested week to refresh its schedule. The original saved results below are unchanged.';
  showResults();refresh();
}
function table(headers,rows){
  const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',headers.join(', '));
  const t=make('table'),head=make('thead'),tr=make('tr');for(const h of headers){const th=make('th',h);th.scope='col';tr.append(th);}head.append(tr);t.append(head);
  const body=make('tbody');for(const row of rows){const r=make('tr');for(const x of row)r.append(make('td',x));body.append(r);}t.append(body);wrap.append(t);return wrap;
}
function showResults(){
  const out=$('review-results');out.replaceChildren();if(!baseReport)return;
  out.append(table(['Date','Original status','Original cost','Suggested status','Suggested cost'],baseReport.days.map((d,i)=>[d.date,d.status,d.status==='planned'?money(d.plan.optimized.cost):'—',proposed?.days[i].status||'Not calculated',proposed?.days[i].status==='planned'?money(proposed.days[i].plan.optimized.cost):'—'])));
  const bt=baseReport.totals;out.append(make('p','Original planned days: '+bt.plannedDays+'; rest: '+bt.restDays+'; needing attention: '+bt.infeasibleDays+'. Original optimized cost: '+money(bt.optimizedCostUsd)+'.','meta'));
  if(proposed){
    const t=proposed.totals;out.append(make('p','Suggested planned days: '+t.plannedDays+'; rest: '+t.restDays+'; needing attention: '+t.infeasibleDays+'. Suggested optimized cost: '+money(t.optimizedCostUsd)+'.','notice'));
    for(const d of proposed.days){const card=make('details',undefined,'result-card');card.append(make('summary',d.date+' · '+d.status+(d.status==='planned'?' · '+money(d.plan.optimized.cost):'')));
      if(d.status==='planned')card.append(table(['Load','Start','Finish','Energy','Modeled cost'],d.plan.optimized.items.map(t=>[t.label,hour(t.start),hour(t.end),t.kwh.toFixed(2)+' kWh',money(t.cost)])));
      else card.append(make('p',d.reason||'No flexible loads scheduled.','dim'));out.append(card);}
  }
}
let core,weekly;
function response(){
  capture();const normalized=weekly.weekInputs(input);
  if(normalized.startDate!==baseReport.input.startDate)throw Error('Keep the original review start date.');
  if(!reviewer.trim())throw Error('Enter your self-stated reviewer name or label.');
  if(!responseId)responseId=uuid();
  const value={schema:'gridkind-week-review-response/v1',request:identity(),responseId,reviewer,notes,dayNotes:clone(dayNotes),input:normalized};
  return core.inspectResponse(value,request);
}
async function calculate(){
  if(!ready||busy)return;busy=true;refresh();$('error').textContent='';
  try{capture();await new Promise(r=>setTimeout(r,0));proposed=weekly.planWeek(input);input=clone(proposed.input);$('review-result-status').textContent='Suggested schedules calculated using the exact embedded planner. No device action or approval occurred.';showResults();}
  catch(e){proposed=null;showResults();error(e);$('review-result-status').textContent='The suggested schedule could not be calculated. Correct the inputs and calculate again.';}
  finally{busy=false;refresh();}
}
async function start(){
  weekly=await import(moduleUrl('weekly.mjs'));core=await import(moduleUrl('week-review.mjs'));
  const exact=await import(moduleUrl('exact-inputs.js'));
  bundle=core.inspectRequestPackage(data.bundle);request=bundle.request;baseReport=request.detail.baseRecord.detail.report;input=clone(baseReport.input);
  $('request-title').textContent=input.name;$('request-recipient').textContent='For '+(request.detail.recipient||'Household reviewer')+' · Requested '+new Date(request.createdAt).toLocaleString();
  $('request-message').textContent=request.detail.message||'The owner has not added a message.';$('request-dates').textContent=baseReport.days[0].date+' – '+baseReport.days[6].date+' · Seven independent daily scenarios';
  const src=$('source-details');src.append(make('p','Original request '+request.id),make('p','Request SHA256 '+request.sha256,'source-hash'));
  const pins=make('pre',JSON.stringify({base:request.detail.baseRecord.sourcePins,request:request.sourcePins},null,2));src.append(make('p','Original saved-source identities','meta'),pins,make('p','Sources actually embedded in this offline file','meta'),make('pre',JSON.stringify(data.sourcePins,null,2)));
  src.append(make('p','The embedded planner recalculates suggestions. Original saved results retain their own source identity; an installed-source change is visible above rather than relabeling the original.','meta'));
  editor=exact.createExactInputs({onChange:changed,isBusy:()=>!ready||busy||!input.days[selected].enabled});ready=true;fill();showResults();
  $('review-status').textContent='Original request opened. Edit any day, save a draft when pausing, and return the response JSON when finished.';
  $('review-form').addEventListener('input',changed);$('reviewer-name').oninput=changed;$('reviewer-notes').oninput=changed;
  $('review-form').onsubmit=e=>{e.preventDefault();calculate();};
  $('review-download-request').onclick=()=>download(bundle,'gridkind-week-request-'+request.id+'.json');
  $('review-save-draft').onclick=()=>{try{capture();const normalized=weekly.weekInputs(input);if(!responseId)responseId=uuid();
      download({schema:'gridkind-week-review-draft/v1',request:identity(),responseId,reviewer,notes,dayNotes:clone(dayNotes),input:normalized,selected},'gridkind-review-draft-'+request.id+'.json');
      savedVersion=editVersion;$('review-draft-status').textContent='Draft downloaded. Reopen this HTML and select that JSON to continue.';$('error').textContent='';
    }catch(e){error(e);}};
  $('review-download-response').onclick=()=>{try{const value=response();download(value,'gridkind-week-response-'+value.responseId+'.json');savedVersion=editVersion;
      $('review-response-status').textContent='Response downloaded with ID '+value.responseId+'. Send this JSON to the household owner. Repeating this download retains the same ID until you edit.';$('error').textContent='';
    }catch(e){error(e);}};
  $('review-open-draft').onchange=async()=>{
    const version=++fileVersion,file=$('review-open-draft').files?.[0],edits=editVersion;if(!file)return;
    try{if(file.size>256*1024)throw Error('Choose a GridKind review JSON file no larger than 256 KiB.');const raw=JSON.parse(await file.text());
      if(version!==fileVersion||edits!==editVersion||file!==$('review-open-draft').files?.[0])throw Error('The review changed while the file opened. Choose the file again to deliberately replace these inputs.');
      if(raw.request?.id!==request.id||raw.request?.sha256!==request.sha256)throw Error('This file belongs to another original review request.');
      if(!['gridkind-week-review-draft/v1','gridkind-week-review-response/v1'].includes(raw.schema))throw Error('Choose a saved GridKind review draft or response.');
      const value=raw.schema==='gridkind-week-review-response/v1'?core.inspectResponse(raw,request):core.inspectResponse({schema:'gridkind-week-review-response/v1',request:raw.request,responseId:raw.responseId,reviewer:raw.reviewer||'Draft reviewer',notes:raw.notes,dayNotes:raw.dayNotes,input:raw.input},request);
      input=clone(value.input);reviewer=typeof raw.reviewer==='string'?raw.reviewer:'';notes=value.notes;dayNotes=clone(value.dayNotes);responseId=value.responseId;selected=Number.isInteger(raw.selected)&&raw.selected>=0&&raw.selected<7?raw.selected:0;
      editVersion++;savedVersion=editVersion;proposed=null;fill();showResults();$('review-result-status').textContent='Saved review reopened. Calculate to inspect these exact suggested inputs.';
      $('review-draft-status').textContent='Opened '+file.name+' for this original request.';$('error').textContent='';
    }catch(e){error(e);}
  };
  addEventListener('beforeunload',e=>{if(editVersion!==savedVersion){e.preventDefault();e.returnValue='';}});
}
start().catch(e=>{error(e);$('review-status').textContent='The review could not open. Preserve this file and return the error to the owner; no inputs were sent or applied.';});
}
export function renderWeekReviewPage(bundle,sources){
  const original=inspectRequestPackage(bundle),selected={},sourcePins={};
  for(const name of REVIEW_SOURCE_FILES){
    if(typeof sources?.[name]!=='string'||!sources[name]||Buffer.byteLength(sources[name],'utf8')>262144)throw Error('Complete trusted source is required: '+name);
    selected[name]=sources[name];sourcePins[name]=createHash('sha256').update(sources[name],'utf8').digest('hex');
  }
  const payload=safeJson({bundle:original,sources:selected,sourcePins});
  const replacements={STYLE,DATA:payload,BOOT:'('+offlineBoot.toString()+')();'};
  return PAGE.replace(/__(STYLE|DATA|BOOT)__/g,(_,key)=>replacements[key]);
}
