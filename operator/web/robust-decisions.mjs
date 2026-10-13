/* Complete retained robust-decision editor on the original operator transport. */
const MARKUP = "<header><div><h1>Ecosystem decision studies</h1><p>Compare complete modeled alternatives across retained parameter profiles.</p></div><span class=\"badge\">SAVED STUDIES</span></header>\n<main>\n<div class=\"toolbar\"><select id=\"studies\" aria-label=\"Saved studies\"><option value=\"\">Select a saved study</option></select><button id=\"refresh\">Refresh</button><button id=\"importToggle\">Import study or project</button></div>\n<div id=\"status\" class=\"status\" role=\"status\" aria-live=\"polite\"></div>\n<section id=\"importCard\" class=\"card\">\n<h2>Receive existing work</h2><p class=\"muted\">Open a decision-study JSON or a complete exported project. For a native experiment, select its original summary and a configuration containing the chosen candidate costs, profiles, metric scales and weights.</p>\n<div class=\"file-row\"><label>Decision study or portable project<input id=\"studyFile\" type=\"file\" accept=\".json,application/json\"></label><label>Original experiment summary<input id=\"nativeFile\" type=\"file\" accept=\".json,application/json\"></label><label>Decision configuration<input id=\"configFile\" type=\"file\" accept=\".json,application/json\"></label></div>\n<div class=\"file-row controls\"><label>Saved original experiment<select id=\"nativeExperiment\"><option value=\"\">Select a retained experiment</option></select></label></div>\n<div class=\"actions controls\"><button id=\"importStudy\">Receive study / project</button><button id=\"importNative\">Receive uploaded native results</button><button id=\"importExperiment\">Use saved experiment</button></div>\n</section>\n<div id=\"empty\" class=\"card empty\">Receive a study or open a saved decision to compare alternatives.</div>\n<div id=\"editor\" class=\"hidden\">\n<section class=\"card\">\n<div class=\"toolbar\"><h2 class=\"section-heading\">Decision inputs</h2><span id=\"revision\" class=\"badge\"></span></div>\n<div class=\"grid\"><label>Study title<input id=\"title\" type=\"text\"></label><label>Budget ceiling <small id=\"costUnits\"></small><input id=\"budget\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"No ceiling\"></label><label>Capacity ceiling<input id=\"capacity\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"No ceiling\"></label><label>Selection model<input id=\"mode\" type=\"text\" readonly></label></div>\n<p id=\"basis\" class=\"muted controls\"></p>\n<h3>Physical outcomes and decision preferences</h3><p class=\"muted\">Positive gain is lower annual export. Each target must be met in every included profile. The score is the sum of weight × gain ÷ scale; physical outcomes keep their original units.</p>\n<div class=\"scroll\"><table id=\"metrics\"><thead><tr><th>Metric / annual unit</th><th>Fixed scale</th><th>Decision weight</th><th>Guaranteed gain</th></tr></thead><tbody></tbody></table></div>\n<h3>Candidate packages / actions</h3><div class=\"scroll\"><table id=\"candidates\"><thead><tr><th>Candidate</th><th>Cost</th><th>Capacity used</th><th>Group</th><th>Selection constraints</th></tr></thead><tbody></tbody></table></div>\n<h3>Included parameter profiles</h3><div class=\"scroll\"><table id=\"profiles\"><thead><tr><th>Profile</th><th>Explicit probability (optional)</th><th>Retained source</th></tr></thead><tbody></tbody></table></div>\n<details><summary>Original input matrix and source references</summary><div id=\"matrix\" class=\"scroll\"></div></details>\n<details><summary>Advanced configuration</summary><p class=\"muted\">Edit the complete study for profile/candidate membership, group limits or source metadata. Applying it updates the form; saving creates a new revision.</p><textarea id=\"advanced\" spellcheck=\"false\" aria-label=\"Complete study JSON\"></textarea><button id=\"applyAdvanced\">Apply JSON to form</button></details>\n<div class=\"actions controls\"><button id=\"save\" class=\"primary\">Save new revision</button><button id=\"exportStudy\">Export current inputs</button><button id=\"exportProject\">Export complete project</button><span id=\"dirty\" class=\"muted\"></span></div>\n</section>\n<section class=\"card\">\n<h2>Calculate a decision</h2><div class=\"grid\"><label>Objective<select id=\"objective\"><option value=\"worst_case\">Maximize worst-profile score</option><option value=\"minimax_regret\">Minimize maximum regret</option><option value=\"expected\">Maximize expected score</option></select></label><label>Calculation time allowance (seconds)<input id=\"timeLimit\" type=\"number\" min=\"1\" max=\"3600\" value=\"60\"></label><label>Frontier budgets (comma-separated)<input id=\"budgets\" type=\"text\" placeholder=\"e.g. 10000, 25000, 50000\"></label><label>Source revision<input id=\"solveRevision\" type=\"text\" readonly></label></div>\n<p class=\"muted\">Regret compares this decision with each profile’s best plan under the same constraints. Expected values require explicit probabilities. Save changed inputs before calculating.</p>\n<div class=\"actions\"><button id=\"solve\" class=\"primary\">Calculate selection</button><button id=\"frontier\">Calculate budget frontier</button><span id=\"runStatus\" class=\"muted\"></span></div>\n</section>\n<section id=\"results\" class=\"card hidden\"><div class=\"toolbar\"><h2 class=\"section-heading\">Decision results</h2><button id=\"reportHtml\">HTML report</button><button id=\"reportCsv\">Outcome CSV</button><button id=\"exportSelection\">Implementation selection</button><button id=\"exportResult\">Export result JSON</button></div><div id=\"resultBody\"></div></section>\n<details class=\"card\"><summary>Retained calculation history</summary><div id=\"history\"></div></details>\n</div>\n<footer>Original native scenario packages remain whole. Separate additive-action studies require an explicit decomposition basis. Saved revisions and source identities travel with the complete project.</footer>\n</main>";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function buildPanel(root, transport, openTask) {

const $ = s => root.querySelector(s);
const state = {document:null, study:null, answer:null, dirty:false, busy:false};
function element(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function clear(node){node.replaceChildren();}
function status(text){$('#status').textContent=text;}
const number = x => x===null||x===undefined?'—':Number(x).toLocaleString(undefined,{maximumSignificantDigits:8});
function nullable(input){return input.value.trim()===''?null:Number(input.value);}
function requiredNumber(input){if(!input.value.trim())throw new Error('Supply '+input.getAttribute('aria-label')+'.');return Number(input.value);}
function mark(){state.dirty=true;$('#dirty').textContent='Unsaved changes';}
const api = transport;
function post(path,value,method='POST'){return api(path,{method,body:JSON.stringify(value)});}
function download(name,value,raw=false){const url=URL.createObjectURL(new Blob([raw?value:JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=element('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function runTask(fn){return async()=>{if(state.busy)return;state.busy=true;status('');root.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message);if(e.taskId){const button=element('button','Open retained task','task-link');button.onclick=()=>openTask(e.taskId);$('#status').append(button);}}finally{state.busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}};}
async function list(){const data=await api('/studies');const current=state.document?.id;clear($('#studies'));$('#studies').append(new Option('Select a saved study',''));for(const s of data.studies)$('#studies').append(new Option(s.title+' · rev '+s.head,s.id));if(current)$('#studies').value=current;}
function inputCell(row,value,options={}){const td=element('td');const input=element('input');input.type='number';input.step='any';if(options.min!==undefined)input.min=options.min;input.value=value??'';input.setAttribute('aria-label',options.label||'Value');input.addEventListener('input',mark);td.append(input);row.append(td);return input;}
function renderStudy(){const s=state.study;$('#editor').classList.remove('hidden');$('#empty').classList.add('hidden');$('#importCard').classList.add('hidden');$('#title').value=s.title;$('#budget').value=s.budget??'';$('#capacity').value=s.capacity??'';$('#costUnits').textContent=s.cost_units;$('#mode').value=s.mode==='native_packages'?'One complete native package':'Explicit additive actions';$('#basis').textContent=s.mode==='native_packages'?'Choose exactly one previously evaluated package. Scenario effects are never added together.':s.additive_basis;$('#revision').textContent='REVISION '+state.document.revision;$('#solveRevision').value=state.document.revision;
clear($('#metrics tbody'));for(const m of s.metrics){const tr=element('tr');const name=element('td',m.label||m.id);name.append(element('small',m.id+' · '+m.units));tr.append(name);inputCell(tr,m.scale,{min:0,label:m.id+' scale'});inputCell(tr,m.weight,{min:0,label:m.id+' weight'});inputCell(tr,m.guaranteed_gain,{label:m.id+' target'});$('#metrics tbody').append(tr);}
clear($('#candidates tbody'));for(const c of s.candidates){const tr=element('tr');const name=element('td',c.label||c.id);name.append(element('small',c.id));tr.append(name);inputCell(tr,c.cost,{min:0,label:c.id+' cost'});inputCell(tr,c.capacity,{min:0,label:c.id+' capacity'});tr.append(element('td',c.group||'—'));const td=element('td');const checks=element('div',undefined,'checks');for(const key of ['required','excluded']){const label=element('label');const input=element('input');input.type='checkbox';input.checked=c[key];input.setAttribute('aria-label',c.id+' '+key);input.addEventListener('change',mark);label.append(input,document.createTextNode(' '+key));checks.append(label);}td.append(checks);tr.append(td);$('#candidates tbody').append(tr);}
clear($('#profiles tbody'));for(const p of s.profiles){const tr=element('tr');const name=element('td',p.label||p.id);name.append(element('small',p.id));tr.append(name);inputCell(tr,p.probability,{min:0,label:p.id+' probability'});const cell=element('td',JSON.stringify(p.source||{}));cell.className='wrap';tr.append(cell);$('#profiles tbody').append(tr);}
clear($('#matrix'));const rows=s.cells.map(c=>[c.profile_id,c.candidate_id,...s.metrics.map(m=>number(c.gains[m.id])),c.source?.baseline_run_id||'—',c.source?.alternative_run_id||'—']);$('#matrix').append(table(['Profile','Candidate',...s.metrics.map(m=>m.id+' ['+m.units+']'),'Baseline run','Alternative run'],rows));const refs=element('pre',JSON.stringify(s.source,null,2));$('#matrix').append(refs);$('#advanced').value=JSON.stringify(s,null,2);state.dirty=false;$('#dirty').textContent='Saved inputs';}
function collect(){const s=structuredClone(state.study);s.title=$('#title').value;s.budget=nullable($('#budget'));s.capacity=nullable($('#capacity'));[...$('#metrics tbody').rows].forEach((tr,i)=>{const [scale,weight,target]=tr.querySelectorAll('input');s.metrics[i].scale=requiredNumber(scale);s.metrics[i].weight=requiredNumber(weight);s.metrics[i].guaranteed_gain=nullable(target);});[...$('#candidates tbody').rows].forEach((tr,i)=>{const [cost,capacity,required,excluded]=tr.querySelectorAll('input');Object.assign(s.candidates[i],{cost:requiredNumber(cost),capacity:requiredNumber(capacity),required:required.checked,excluded:excluded.checked});});[...$('#profiles tbody').rows].forEach((tr,i)=>s.profiles[i].probability=nullable(tr.querySelector('input')));return s;}
function table(headers,rows){const t=element('table');const head=element('thead');const tr=element('tr');headers.forEach(h=>tr.append(element('th',h)));head.append(tr);t.append(head);const body=element('tbody');for(const cells of rows){const row=element('tr');for(const value of cells)row.append(element('td',String(value??'—'),'wrap'));body.append(row);}t.append(body);return t;}
function resultTable(container,headers,rows){const div=element('div',undefined,'scroll');div.append(table(headers,rows));container.append(div);}
function renderAnswer(answer,runId=null){state.answer=answer;state.runId=runId;const box=$('#resultBody');clear(box);$('#results').classList.remove('hidden');
if(answer.schema_version==='ecosci.robust-frontier/1'){box.append(element('p','Budget comparison · each point retains its own complete input binding and profile results.','muted'));resultTable(box,['Budget','Status','Selected','Cost','Worst score','Maximum regret'],answer.points.map(p=>[number(p.budget),p.result?.status||p.status,(p.result?.selected_ids||[]).join(', '),number(p.result?.cost),number(p.result?.worst_score),number(p.result?.maximum_regret)]));}
else {const r=answer.result;box.append(element('p',answer.objective.replaceAll('_',' ')+' · '+r.status+' · '+number(answer.elapsed_seconds)+' seconds','muted'));if(r.selected_ids){const stats=element('div',undefined,'summary');for(const [label,value] of [['Selected',r.selected_ids.join(', ')],['Cost ['+r.cost_units+']',number(r.cost)],['Worst-profile score',number(r.worst_score)],['Maximum regret',number(r.maximum_regret)]]){const stat=element('div',undefined,'stat');stat.append(element('span',label),element('strong',value,'wrap'));stats.append(stat);}box.append(stats);box.append(element('h3','Performance in every included profile'));resultTable(box,['Profile','Score','Regret','Metric','Gain','Unit','Target','Shortfall'],r.profiles.flatMap(p=>p.metrics.map(m=>[p.id,number(p.score),number(p.regret),m.id,number(m.gain),m.units,number(m.guaranteed_gain),number(m.target_shortfall)])));box.append(element('h3','Constraint margins'));resultTable(box,['Constraint','Actual','Above minimum','Below maximum'],r.constraints.map(c=>[c.id,number(c.value),number(c.lower_slack),number(c.upper_slack)]));}
else{box.append(element('p',r.message||r.status));if(r.diagnostic_without_gain_targets){box.append(element('h3','Comparison with gain targets relaxed'));const d=r.diagnostic_without_gain_targets;box.append(element('p','Budget, capacity, membership and required/excluded choices are retained. This comparison identifies target shortfalls; it does not replace your constrained decision.','muted'));if(d.selected_ids){box.append(element('p','Selected: '+d.selected_ids.join(', ')));resultTable(box,['Profile','Metric','Gain','Target','Shortfall'],d.profiles.flatMap(p=>p.metrics.map(m=>[p.id,m.id,number(m.gain),number(m.guaranteed_gain),number(m.target_shortfall)])));}else box.append(element('p',d.message));}}
if(answer.profile_benchmarks?.length){box.append(element('h3','Profile-specific best plans'));resultTable(box,['Profile','Status','Best score','Selected'],answer.profile_benchmarks.map(b=>[b.profile_id,b.status,number(b.profile_optimum),(b.selected_ids||[]).join(', ')]));}if(answer.value_of_information){const v=answer.value_of_information;box.append(element('h3','Value of perfect profile information'));box.append(element('p',number(v.evpi)+' '+v.units+'. Expected score with perfect information: '+number(v.perfect_information_score)+'; best single expected plan: '+number(v.optimal_expected_score)+'.'));box.append(element('p','This diagnostic uses the supplied probabilities and the same all-profile feasibility requirements. It is an objective-score difference, not a currency valuation.','muted'));}}
const details=element('details');details.append(element('summary','Complete calculation and retained identities'),element('pre',JSON.stringify(answer,null,2)));box.append(details);}
function history(){clear($('#history'));for(const r of state.document.runs){const div=element('div',undefined,'toolbar controls');div.append(element('span',r.created+' · '+r.objective+' · '+r.status,'muted'));if(r.result){const button=element('button','View result');button.onclick=()=>renderAnswer(r.result,r.id);div.append(button);}if(r.error)div.append(element('span',r.error,'wrap'));$('#history').append(div);}}
function openDocument(d){state.document=d;state.study=structuredClone(d.study);renderStudy();history();const done=d.runs.filter(r=>r.result);if(done.length)renderAnswer(done.at(-1).result,done.at(-1).id);else{$('#results').classList.add('hidden');state.answer=null;}$('#studies').value=d.id;}
async function fileText(id){const f=$(id).files[0];if(!f)throw new Error('Select the required JSON file.');const text=await f.text();JSON.parse(text);return text;}
async function file(id){return JSON.parse(await fileText(id));}
$('#refresh').onclick=runTask(list);$('#importToggle').onclick=()=>$('#importCard').classList.toggle('hidden');
$('#studies').onchange=runTask(async()=>{if(!$('#studies').value)return;if(state.dirty&&!confirm('Discard unsaved form changes and open another study?'))return;openDocument(await api('/studies/'+encodeURIComponent($('#studies').value)));});
$('#importStudy').onclick=runTask(async()=>{const text=await fileText('#studyFile');const value=JSON.parse(text);const d=await api(value.schema_version==='ecosci.robust-project/1'?'/receive':'/studies',{method:'POST',body:text});await list();openDocument(d);status('Received into this workspace as an independently editable study.');});
$('#importNative').onclick=runTask(async()=>{const d=await api('/native',{method:'POST',body:'{\"summary\":'+await fileText('#nativeFile')+',\"configuration\":'+await fileText('#configFile')+'}'});await list();openDocument(d);status('Original paired experiment metrics received with their run and support identities.');});
$('#applyAdvanced').onclick=runTask(async()=>{const s=JSON.parse($('#advanced').value);for(const key of ['metrics','profiles','candidates','cells'])if(!Array.isArray(s[key]))throw new Error('Complete study needs '+key);state.study=s;renderStudy();mark();});
$('#save').onclick=runTask(async()=>{const d=await post('/studies/'+state.document.id,{study:collect(),expected_revision:state.document.head},'PUT');openDocument(d);await list();status('Saved revision '+d.revision+'. Earlier inputs and results are retained.');});
$('#exportStudy').onclick=()=>download('decision-study.json',collect());$('#exportProject').onclick=runTask(async()=>{downloadFile(await api('/studies/'+state.document.id+'/export'),'decision-project.json');});$('#exportResult').onclick=()=>download('decision-result.json',state.answer);
async function calculate(frontier){if(state.dirty)throw new Error('Save changed inputs before calculating.');const request={revision:state.document.revision,objective:$('#objective').value,time_limit:Number($('#timeLimit').value)};if(frontier){if(!$('#budgets').value.trim())throw new Error('Enter frontier budgets.');request.budgets=$('#budgets').value.split(',').map(x=>Number(x.trim()));if(request.budgets.some(x=>!Number.isFinite(x)||x<0))throw new Error('Budgets must be nonnegative numbers.');}$('#runStatus').textContent='Calculating…';try{const value=await post('/studies/'+state.document.id+(frontier?'/frontier':'/solve'),request);state.document=await api('/studies/'+state.document.id);history();renderAnswer(value.answer,value.run_id);$('#runStatus').textContent='Result retained';$('#results').scrollIntoView({behavior:'smooth',block:'start'});}finally{if($('#runStatus').textContent==='Calculating…')$('#runStatus').textContent='Calculation ended';}}
$('#exportSelection').onclick=runTask(async()=>{if(!state.runId)throw new Error('Select a retained calculation.');downloadFile(await api('/studies/'+state.document.id+'/selection?run_id='+encodeURIComponent(state.runId)),'implementation-selection.json');});
for(const [id,format] of [['reportHtml','html'],['reportCsv','csv']])$('#'+id).onclick=runTask(async()=>{if(!state.runId)throw Error('Select a retained calculation from history.');downloadFile(await api('/studies/'+encodeURIComponent(state.document.id)+'/report?run_id='+encodeURIComponent(state.runId)+'&format='+format),'decision-report.'+format);});
$('#solve').onclick=runTask(()=>calculate(false));$('#frontier').onclick=runTask(()=>calculate(true));for(const id of ['title','budget','capacity'])$('#'+id).addEventListener('input',mark);
function downloadFile(value, name) {
  if (!/^\/api\/file\/[A-Za-z0-9_-]+\?download=1$/.test(value.download_url || '')) {
    throw Error('Open the completed task to retrieve its original decision file.');
  }
  const link = element('a');
  link.href = value.download_url;
  link.download = name;
  link.click();
}
async function experiments() {
  const selected = $('#nativeExperiment').value;
  const catalog = await api('/experiments');
  clear($('#nativeExperiment'));
  $('#nativeExperiment').append(new Option('Select a retained experiment', ''));
  for (const item of catalog.experiments) {
    $('#nativeExperiment').append(new Option((item.title || item.id) + ' · ' + (item.state || item.status || 'saved'), item.id));
  }
  $('#nativeExperiment').value = selected;
}
$('#importExperiment').onclick = runTask(async () => {
  const experiment_id = $('#nativeExperiment').value;
  if (!experiment_id) throw Error('Select a saved original experiment.');
  const configuration = await file('#configFile');
  const result = await post('/native-existing', {experiment_id, configuration});
  await list();
  openDocument(result);
  status('The saved experiment and its original run identities are retained in this study.');
});
let refreshing = false;
async function refresh() {
  if (state.busy || refreshing) return;
  refreshing = true;
  try {
    await Promise.all([list(), experiments()]);
    if (state.document && !state.dirty) {
      const requested = state.document.id;
      const current = await api('/studies/' + encodeURIComponent(requested));
      if (!state.dirty && !state.busy && state.document?.id === requested) openDocument(current);
    }
  } finally { refreshing = false; }
}
const ready = refresh().catch(error => status(error.message));
return {ready, refresh, isDirty: () => state.dirty, isBusy: () => state.busy};

}

export function attachRobustDecisions({getState, api: hostApi, showTask}) {
  const sessions = new Map();
  const pendingMemory = new Map();
  let active = null;
  let mounted = null;
  let generation = 0;
  let lastRevision = null;
  const stored = {
    get(key) {
      try { return sessionStorage.getItem(key) || pendingMemory.get(key) || null; }
      catch { return pendingMemory.get(key) || null; }
    },
    set(key, value) {
      pendingMemory.set(key, value);
      try { sessionStorage.setItem(key, value); } catch {}
    },
    remove(key) {
      pendingMemory.delete(key);
      try { sessionStorage.removeItem(key); } catch {}
    }
  };

  function workspace() {
    const key = getState()?.workspace_key;
    if (!key) throw Error('Select an original workspace.');
    return key;
  }

  function read(key, operation, values = {}) {
    return hostApi('/api/robust-decisions?' + new URLSearchParams({
      workspace: key, operation, ...values
    }));
  }

  async function queued(key, action, payload) {
    const serialized = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(JSON.stringify({workspace:key, action, payload}));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(x => x.toString(16).padStart(2, '0')).join('');
    const storageKey = 'robust-decision-task:' + key + ':' + hash;
    let pending;
    try { pending = JSON.parse(stored.get(storageKey) || 'null'); } catch { pending = null; }
    if (!pending) {
      pending = {operation_id: crypto.randomUUID()};
      stored.set(storageKey, JSON.stringify(pending));
    }
    let task;
    if (pending.task_id) {
      task = await hostApi('/api/task?' + new URLSearchParams({workspace:key, id:pending.task_id}));
    } else {
      let originalPayload = payload;
      // Large original matrices use the host's existing byte-upload transport.
      if (bytes.byteLength > 512 * 1024) {
        if (!pending.upload_id) {
          const original = new Blob([serialized], {type:'application/json'});
          const limit = getState()?.limits?.upload_bytes;
          if (limit && original.size > limit) {
            throw Error('This decision input exceeds the original operator upload capacity.');
          }
          const upload = await hostApi('/api/upload', {
            method:'POST', raw:original, filename:'robust-decision-parameters.json'
          });
          pending.upload_id = upload.id;
          stored.set(storageKey, JSON.stringify(pending));
        }
        originalPayload = {payload_upload_id:pending.upload_id};
      }
      task = await hostApi('/api/actions', {
        method:'POST',
        body:{workspace:key, action, payload:originalPayload, operation_id:pending.operation_id}
      });
      pending.task_id = task.id;
      stored.set(storageKey, JSON.stringify(pending));
    }
    while (['queued', 'running'].includes(task.state)) {
      await wait(1200);
      task = await hostApi('/api/task?' + new URLSearchParams({workspace:key, id:task.id}));
    }
    if (task.state !== 'complete') {
      const error = Error(task.error?.message || 'The retained decision task is ' + task.state + '.');
      error.taskId = task.id;
      throw error;
    }
    task = await hostApi('/api/task?' + new URLSearchParams({workspace:key, id:task.id}));
    stored.remove(storageKey);
    return task.result;
  }

  function transport(key) {
    return async (path, options = {}) => {
      const url = new URL(path, 'https://operator.invalid');
      const method = (options.method || 'GET').toUpperCase();
      const body = options.body === undefined ? {} :
        typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      const values = Object.fromEntries(url.searchParams);
      if (url.pathname === '/experiments' && method === 'GET') return read(key, 'experiments');
      if (url.pathname === '/studies') {
        if (method === 'GET') return read(key, 'list');
        if (method === 'POST') return queued(key, 'robust.study.create', {study:body});
      }
      if (url.pathname === '/receive' && method === 'POST') {
        return queued(key, 'robust.project.receive', {project:body});
      }
      if (url.pathname === '/native' && method === 'POST') {
        return queued(key, 'robust.summary.prepare', body);
      }
      if (url.pathname === '/native-existing' && method === 'POST') {
        return queued(key, 'robust.experiment.prepare', body);
      }
      const selected = /^\/studies\/([A-Za-z0-9_-]+)(?:\/(solve|frontier|export|selection|report))?$/.exec(url.pathname);
      if (selected) {
        const [, study_id, operation] = selected;
        if (!operation) {
          if (method === 'GET') return read(key, 'study', {study_id, ...values});
          if (method === 'PUT') return queued(key, 'robust.study.revise', {study_id, ...body});
        } else if (['solve','frontier'].includes(operation) && method === 'POST') {
          return queued(key, 'robust.' + operation, {study_id, ...body});
        } else if (operation === 'export' && method === 'GET') {
          return queued(key, 'robust.project.export', {study_id});
        } else if (operation === 'selection' && method === 'GET') {
          return queued(key, 'robust.selection.export', {study_id, run_id:values.run_id});
        } else if (operation === 'report' && method === 'GET') {
          return queued(key, 'robust.report.export', {study_id, run_id:values.run_id, format:values.format || 'html'});
        }
      }
      throw Error('Choose a saved robust decision operation.');
    };
  }

  function currentPanel(key) {
    let value = sessions.get(key);
    if (value) return value;
    const node = document.createElement('section');
    node.setAttribute('aria-label', 'Robust decision studies');
    const root = node.attachShadow({mode:'open'});
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/web/robust-decisions.css';
    const content = document.createElement('div');
    content.className = 'robust-root';
    content.innerHTML = MARKUP;
    root.append(stylesheet, content);
    const controller = buildPanel(content, transport(key), id => {
      if (workspace() === key) return showTask(id);
      throw Error('Select the original workspace to open its retained task.');
    });
    value = {key, node, controller};
    sessions.set(key, value);
    return value;
  }

  async function mount(container) {
    const key = workspace(), ticket = ++generation;
    const selected = currentPanel(key);
    active = selected;
    mounted = container;
    if (selected.node.parentNode !== container) container.replaceChildren(selected.node);
    await selected.controller.ready;
    if (ticket !== generation || workspace() !== key) return;
    await selected.controller.refresh();
  }

  async function update(state = getState()) {
    if (!active || !mounted || !active.node.isConnected || workspace() !== active.key) return;
    const revision = JSON.stringify({
      workspace:active.key,
      studies:state?.data?.robust_decisions?.studies || [],
      tasks:(state?.tasks || []).filter(task => task.action?.startsWith('robust.'))
        .map(task => [task.id, task.state])
    });
    if (revision === lastRevision || active.controller.isBusy()) return;
    lastRevision = revision;
    await active.controller.refresh();
  }

  function detach() {
    generation += 1;
    if (active) active.node.remove();
    active = null;
    mounted = null;
    lastRevision = null;
  }

  const unload = event => {
    if ([...sessions.values()].some(item => item.controller.isDirty())) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', unload);
  function destroy() {
    detach();
    window.removeEventListener('beforeunload', unload);
    sessions.clear();
  }
  return {mount, update, detach, destroy};
}
