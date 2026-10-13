"use strict";
const Sha = require("../runtime/host/connected_sha256.cjs");
const VERSION = "jsonsupport.report-handover.v1";
const API = "https://veqix61rpf.execute-api.us-east-1.amazonaws.com/dev/v1/convert";
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}
function hash(value) { return Sha.sha256Utf8(stable(value)).sha256; }
function text(value, name, max = 4000) {
  if (typeof value !== "string" || value.length > max) throw Error(name + " must be text up to " + max + " characters.");
  return value;
}
function finite(value, name) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw Error(name + " must be a nonnegative number or blank.");
  return value;
}
function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Open a valid " + name + ".");
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw Error(name + " fields changed.");
}
function now(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error("Use a valid UTC operation time.");
  return value;
}
function pointerParts(pointer) {
  text(pointer, "JSON pointer", 1000);
  if (pointer === "") return [];
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) throw Error("Use a JSON pointer such as /customer/name; escape ~ as ~0 and / as ~1.");
  return pointer.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}
function lookup(value, pointer) {
  for (const key of pointerParts(pointer)) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return {found: false};
    value = value[key];
  }
  return {found: true, value};
}
function blankConfig() {
  return {report_name:"", client:"", source_system:"", existing_process:"", operator:"", recipient:"",
    route:"browser", cadence:"", requests_per_month:null, existing_minutes:null, pilot_minutes:null,
    maintenance_minutes:null, data_notes:"", delivery_notes:""};
}
function validateConfig(config) {
  exactKeys(config, Object.keys(blankConfig()), "report configuration");
  for (const key of Object.keys(config)) {
    if (["requests_per_month","existing_minutes","pilot_minutes","maintenance_minutes"].includes(key)) finite(config[key], key);
    else text(config[key], key);
  }
  if (!["browser","api","webhook"].includes(config.route)) throw Error("Choose browser, API or webhook.");
  if (config.requests_per_month !== null && !Number.isSafeInteger(config.requests_per_month)) throw Error("Monthly requests must be a whole number.");
  return config;
}
function validateSource(source) {
  exactKeys(source, ["format","text","records_pointer"], "sample source");
  if (!["json","jsonl"].includes(source.format)) throw Error("Choose JSON or JSONL.");
  text(source.text, "Sample", 1048576);
  if (Sha.sha256Utf8(source.text).bytes > 1048576) throw Error("This preparation workspace accepts sample text up to 1 MiB.");
  pointerParts(source.records_pointer);
  if (source.format === "jsonl" && source.records_pointer !== "") throw Error("JSONL uses each nonempty line as one record; leave the records pointer blank.");
  return source;
}
function validateColumns(columns) {
  if (!Array.isArray(columns) || columns.length > 128) throw Error("Use up to 128 explicit columns.");
  const names = new Set();
  for (const column of columns) {
    exactKeys(column, ["name","pointer","type","required"], "column");
    text(column.name, "Column heading", 160);
    if (!column.name.trim() || names.has(column.name)) throw Error("Column headings must be nonempty and unique.");
    names.add(column.name); pointerParts(column.pointer);
    if (!["preserve","text","number","boolean","date","json"].includes(column.type)) throw Error("Choose an available column type.");
    if (typeof column.required !== "boolean") throw Error("Column required flag must be true or false.");
  }
  return columns;
}
function validateProposal(proposal) {
  exactKeys(proposal, ["config","source","columns"], "report proposal");
  validateConfig(proposal.config); validateSource(proposal.source); validateColumns(proposal.columns);
  return proposal;
}
function proposalOf(project) { return clone({config:project.config,source:project.source,columns:project.columns}); }
function contractHash(project) { return hash(proposalOf(project)); }
function parseData(body,label) {
 let parsed;try{parsed=JSON.parse(body);}catch{throw Error(label+" is not valid JSON.");}
 let quoted=false,escaped=false;
 const token=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
 for(let i=0;i<body.length;i++){
  const c=body[i];
  if(quoted){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;continue;}
  if(c==="-"||(c>="0"&&c<="9")){
   token.lastIndex=i;const matched=token.exec(body);if(!matched)continue;
   const value=Number(matched[0]);
   if(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))throw Error(label+" contains a number outside the exact supported integer/finite range. Quote identifiers or precise decimal values and select text; keep the original source unchanged.");
   i=token.lastIndex-1;
  }
 }
 return parsed;
}
function records(source) {
  validateSource(source);
  if (!source.text.trim()) return [];
  let value;
  if (source.format === "jsonl") {
    value = source.text.split(/\r?\n/).map((line,index) => ({line,index})).filter(x => x.line.trim())
      .map(x => { return parseData(x.line,"JSON on line "+(x.index+1));});
  } else {
    value = parseData(source.text,"The sample");
    const selected = lookup(value, source.records_pointer);
    if (!selected.found) throw Error("The records pointer does not exist in the sample.");
    value = selected.value;
    if (!Array.isArray(value)) value = [value];
  }
  if (value.length > 20000) throw Error("Prepare a representative sample of at most 20,000 records.");
  if (value.some(row => row === null || typeof row !== "object" || Array.isArray(row))) throw Error("The selected records must be JSON objects.");
  return value;
}
function convert(value, type) {
  if (value === null) return null;
  if (type === "json") return JSON.stringify(value);
  if (type === "preserve") return clone(value);
  if (type === "text") {
    if (typeof value === "object") throw Error("Choose JSON for an object or list.");
    return String(value);
  }
  if (type === "number") {
    if (typeof value === "string" && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw Error("Expected a JSON-format number.");
    const n = typeof value === "number" ? value : Number(value);
    if (!["string","number"].includes(typeof value) || !Number.isFinite(n) || (Number.isInteger(n)&&!Number.isSafeInteger(n))) throw Error("Expected a finite number within the exact supported integer range; keep identifiers or precise decimal values as text.");
    return n;
  }
  if (type === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw Error('Expected true or false.');
  }
  if (type === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)) throw Error("Expected YYYY-MM-DD.");
    const d = new Date(value + "T00:00:00Z");
    if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0,10) !== value) throw Error("The calendar date does not exist.");
    return value;
  }
  throw Error("Unknown column type.");
}
function compile(project) {
  validateProposal(proposalOf(project));
  const input = records(project.source), issues = [], rows = []; let issue_count=0;
  if(input.length*project.columns.length>200000)throw Error("Use a smaller preparation sample: at most 200,000 selected cells.");
  function issue(item){issue_count++;if(issues.length<500)issues.push(item);}
  if (!project.columns.length && input.length) issue({row:0,column:"",message:"Add explicit columns to prepare the request."});
  for (let index = 0; index < input.length; index++) {
    const row = Object.create(null);
    for (const column of project.columns) {
      const selected = lookup(input[index], column.pointer);
      if (!selected.found || selected.value === null) {
        if (column.required) issue({row:index+1,column:column.name,message:selected.found?"Required value is null.":"Required field is absent."});
        row[column.name] = null;
      } else {
        try { row[column.name] = convert(selected.value, column.type); }
        catch (error) { issue({row:index+1,column:column.name,message:error.message}); row[column.name]=null; }
      }
    }
    rows.push(row);
  }
  return {rows,input_rows:input.length,issues,issue_count,ready:input.length>0&&project.columns.length>0&&issue_count===0,
    contract_sha256:contractHash(project)};
}
function validateSeed(seed) {
  exactKeys(seed, ["edition","title","pack_id","edition_id","leads","product_sources"], "edition source");
  for (const name of ["edition","title","pack_id","edition_id"]) text(seed[name],name,500);
  if (!["sample","paid"].includes(seed.edition)||!Array.isArray(seed.leads)||seed.leads.length!==(seed.edition==="sample"?1:5)) throw Error("Open the original selected customer edition.");
  const ids=new Set();
  for(const lead of seed.leads) {
    if(!lead||typeof lead.id!=="string"||!lead.id.startsWith(seed.pack_id+":")||ids.has(lead.id)||!lead.document||typeof lead.document.organization!=="string")throw Error("Original agency selection is invalid.");
    ids.add(lead.id);
  }
  if(!Array.isArray(seed.product_sources))throw Error("Retain the complete product source notes.");
  return seed;
}
function create(seed) {
  validateSeed(seed);
  const root={version:VERSION,revision:0,seed:clone(seed),seed_sha256:hash(seed),projects:{},events:[]};
  for(const lead of seed.leads)root.projects[lead.id]={revision:0,config:blankConfig(),source:{format:"json",text:"",records_pointer:""},columns:[],runs:[],handovers:[],history:[]};
  return validate(root);
}
function verifyOperationHistory(root) {
 const replay={};
 for(const lead of root.seed.leads)replay[lead.id]={revision:0,proposal:{config:blankConfig(),source:{format:"json",text:"",records_pointer:""},columns:[]},runs:new Set(),handovers:new Set()};
 for(const event of root.events){
  const original=root.projects[event.lead_id],current=replay[event.lead_id];let input;
  if(event.kind==="save"){
   const old=original.history[current.revision],next=original.history[current.revision+1];
   if(!old||old.at!==event.at||stable(old.proposal)!==stable(current.proposal))throw Error("Saved proposal history does not match its original operation.");
   input=next?next.proposal:proposalOf(original);
   current.proposal=clone(input);current.revision++;
  }else if(event.kind==="record-run"){
   const run=original.runs.find(x=>x.id===event.id);
   if(!run||current.runs.has(event.id)||run.at!==event.at||run.contract_sha256!==hash(current.proposal)||!compile(current.proposal).ready)throw Error("Actual result does not match its original report operation.");
   input=clone(run);for(const k of ["id","at","contract_sha256"])delete input[k];current.runs.add(event.id);
  }else{
   const handover=original.handovers.find(x=>x.id===event.id);
   if(!handover||current.handovers.has(event.id)||handover.at!==event.at||handover.contract_sha256!==hash(current.proposal)||stable(handover.proposal)!==stable(current.proposal))throw Error("Handover does not match its original report operation.");
   const compiled=compile(current.proposal);if(!compiled.ready||stable(compiled.rows)!==stable(handover.rows))throw Error("Handover rows differ from their selected source.");
   input={title:handover.title};current.handovers.add(event.id);
  }
  if(event.project_revision!==current.revision||event.request_sha256!==hash({id:event.id,expected_revision:event.sequence-1,lead_id:event.lead_id,kind:event.kind,input}))throw Error("The complete saved operation content changed.");
 }
 for(const[id,current]of Object.entries(replay)){
  const original=root.projects[id];
  if(current.revision!==original.revision||stable(current.proposal)!==stable(proposalOf(original))||current.runs.size!==original.runs.length||current.handovers.size!==original.handovers.length)throw Error("Current report or result history contains an unrecorded change.");
 }
}
function validate(root, expectedSeedHash) {
  exactKeys(root,["version","revision","seed","seed_sha256","projects","events"],"working project");
  if(root.version!==VERSION||!Number.isSafeInteger(root.revision)||root.revision<0)throw Error("Working project version is invalid.");
  validateSeed(root.seed);
  if(root.seed_sha256!==hash(root.seed)||(expectedSeedHash&&root.seed_sha256!==expectedSeedHash))throw Error("This working file belongs to a different original customer edition.");
  if(!root.projects||Array.isArray(root.projects)||typeof root.projects!=="object"||!Array.isArray(root.events)||root.events.length!==root.revision)throw Error("Working project history is incomplete.");
  const ids=root.seed.leads.map(x=>x.id);
  if(Object.keys(root.projects).length!==ids.length||ids.some(id=>!Object.hasOwn(root.projects,id)))throw Error("Keep the original agency selection.");
  const operationIds=new Set();
  for(let i=0;i<root.events.length;i++) {
    const e=root.events[i];
    exactKeys(e,["id","sequence","lead_id","kind","at","request_sha256","project_revision"],"event");
    text(e.id,"operation id",200);now(e.at);
    if(!e.id||operationIds.has(e.id)||e.sequence!==i+1||!ids.includes(e.lead_id)||!["save","record-run","handover"].includes(e.kind)||typeof e.request_sha256!=="string")throw Error("Original operation history changed.");
    operationIds.add(e.id);
  }
  for(const id of ids) {
    const p=root.projects[id];
    exactKeys(p,["revision","config","source","columns","runs","handovers","history"],"agency project");
    if(!Number.isSafeInteger(p.revision)||p.revision<0||!Array.isArray(p.runs)||!Array.isArray(p.handovers)||!Array.isArray(p.history)||p.history.length!==p.revision)throw Error("Agency revision history is incomplete.");
    validateProposal(proposalOf(p));
    for(let i=0;i<p.history.length;i++){const h=p.history[i];exactKeys(h,["revision","at","proposal"],"saved proposal");if(h.revision!==i)throw Error("Saved proposal sequence changed.");now(h.at);validateProposal(h.proposal);}
    for(const run of p.runs)validateRun(run,true);
    for(const h of p.handovers){exactKeys(h,["id","at","title","contract_sha256","proposal","rows"],"handover");text(h.id,"handover id",200);now(h.at);text(h.title,"handover title",200);validateProposal(h.proposal);if(h.contract_sha256!==hash(h.proposal)||!Array.isArray(h.rows)||stable(compile(h.proposal).rows)!==stable(h.rows)||!compile(h.proposal).ready)throw Error("Saved handover content changed.");}
    if(root.events.filter(e=>e.lead_id===id&&e.kind==="save").length!==p.revision)throw Error("Project revision and event history differ.");
  }
  verifyOperationHistory(root);
  if(Sha.sha256Utf8(JSON.stringify(root,null,2)+"\n").bytes>20971520)throw Error("This change exceeds the 20 MiB complete working-file limit. Download the current copy, then open the edition’s original working.json to start another report with a smaller representative sample.");
  return root;
}
function validateRun(run,stored=false) {
  exactKeys(run,stored?["id","at","contract_sha256","status","output_name","output_rows","minutes","notes","returned_json"]:["status","output_name","output_rows","minutes","notes","returned_json"],"actual run");
  if(!["accepted","needs-work"].includes(run.status))throw Error("Choose accepted or needs work.");
  text(run.output_name,"Returned file",500);text(run.notes,"Actual result notes",8000);text(run.returned_json,"Returned JSON",1048576);if(run.returned_json.trim()) returnedRows(run.returned_json);finite(run.output_rows,"Returned rows");finite(run.minutes,"Actual minutes");
  if(run.output_rows!==null&&!Number.isSafeInteger(run.output_rows))throw Error("Returned rows must be a whole number.");
  if(!run.notes.trim())throw Error("Record what happened in the actual conversion or handover.");
  if(stored){text(run.id,"run id",200);now(run.at);if(typeof run.contract_sha256!=="string")throw Error("Run binding is missing.");}
  return run;
}
function apply(root, request, at) {
  validate(root);now(at);
  exactKeys(request,["id","expected_revision","lead_id","kind","input"],"operation");
  text(request.id,"operation id",200);
  if(!request.id)throw Error("Operation identity is required.");
  const digest=hash(request),existing=root.events.find(e=>e.id===request.id);
  if(existing){if(existing.request_sha256!==digest)throw Error("This operation identity was already used for different content.");return {root:clone(root),replayed:true};}
  if(request.expected_revision!==root.revision)throw Error("The working project changed. Reopen the current copy before saving.");
  if(!Object.hasOwn(root.projects,request.lead_id))throw Error("Select an agency in this edition.");
  const next=clone(root),p=next.projects[request.lead_id];
  if(request.kind==="save") {
    validateProposal(request.input);
    p.history.push({revision:p.revision,at,proposal:proposalOf(p)});
    Object.assign(p,clone(request.input));p.revision++;
  } else if(request.kind==="record-run") {
    validateRun(request.input);
    const result=compile(p);if(!result.ready)throw Error("Prepare a valid report request before recording its actual result.");
    p.runs.push({id:request.id,at,contract_sha256:result.contract_sha256,...clone(request.input)});
  } else if(request.kind==="handover") {
    exactKeys(request.input,["title"],"handover title");text(request.input.title,"Handover title",200);
    if(!request.input.title.trim())throw Error("Name this client handover.");
    const result=compile(p);if(!result.ready)throw Error("Resolve the report fields before preparing this handover.");
    p.handovers.push({id:request.id,at,title:request.input.title,contract_sha256:result.contract_sha256,proposal:proposalOf(p),rows:result.rows});
  } else throw Error("Unknown operation.");
  next.revision++;
  next.events.push({id:request.id,sequence:next.revision,lead_id:request.lead_id,kind:request.kind,at,request_sha256:digest,project_revision:p.revision});
  validate(next,root.seed_sha256);
  return {root:next,replayed:false};
}

function returnedRows(body) {
  text(body,"Returned JSON",1048576);
  const parsed=parseData(body,"Returned JSON");
  const rows=Array.isArray(parsed)?parsed:parsed&&parsed.data;
  if(!Array.isArray(rows)||rows.length>20000||rows.some(row=>!row||typeof row!=="object"||Array.isArray(row)))throw Error("Open an array of returned records or the vendor's {data:[…]} response.");
  return rows;
}
function compareReturned(project,body) {
  const expected=compile(project);
  if(!expected.ready)throw Error("Prepare the selected report before comparing a returned file.");
  const actual=returnedRows(body),differences=[];
  let changed_rows=0;
  for(let i=0;i<Math.max(expected.rows.length,actual.length);i++){
    const a=expected.rows[i],b=actual[i];
    if(stable(a)!==stable(b)){changed_rows++;if(differences.length<50)differences.push({row:i+1,expected:a===undefined?null:a,actual:b===undefined?null:b});}
  }
  return {expected_rows:expected.rows.length,returned_rows:actual.length,changed_rows,equal:changed_rows===0,differences,contract_sha256:expected.contract_sha256};
}

function csvValue(value) {
  let str=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);
  if(typeof value==="string"&&/^[\s]*[=+\-@\t\r]/.test(str))str="'"+str;
  return '"'+str.replace(/"/g,'""')+'"';
}
function previewCsv(project) {
  const result=compile(project);
  return [project.columns.map(c=>c.name),...result.rows.map(row=>project.columns.map(c=>row[c.name]))].map(row=>row.map(csvValue).join(",")).join("\r\n")+"\r\n";
}
function estimate(project) {
  const c=project.config;
  if([c.requests_per_month,c.existing_minutes,c.pilot_minutes,c.maintenance_minutes].some(v=>v===null))return null;
  return {existing_monthly_minutes:c.requests_per_month*c.existing_minutes,
    proposed_monthly_minutes:c.requests_per_month*c.pilot_minutes+c.maintenance_minutes,
    difference_minutes:c.requests_per_month*(c.existing_minutes-c.pilot_minutes)-c.maintenance_minutes};
}
function requestBody(project) {
  const result=compile(project);
  if(!result.ready)throw Error("Resolve the sample and explicit fields before downloading the API request.");
  return JSON.stringify({data:result.rows},null,2)+"\n";
}
function exportWorking(root) { validate(root);return JSON.stringify(root,null,2)+"\n"; }
function receiveWorking(textBody,seedHash) {
  text(textBody,"Working file",20971520);
  let root;try{root=JSON.parse(textBody);}catch{throw Error("The working file is not valid JSON.");}
  return clone(validate(root,seedHash));
}
module.exports={VERSION,API,hash,clone,create,validate,apply,compile,records,lookup,pointerParts,proposalOf,contractHash,requestBody,previewCsv,estimate,exportWorking,receiveWorking,returnedRows,compareReturned};
