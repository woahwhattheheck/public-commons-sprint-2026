// MIT. GridFabric customer procedures on the original Operating Plans history model.
import { createOperatingPlan, createOperatingStep, snapshotRegistration, inspectOperatingPlan,
  operatingPlanDraft, saveOperatingPlanRevision } from './operating-plan.mjs';

export const GRIDFABRIC_PROCEDURE_INPUT_SCHEMA = 'stellar-forge.gridfabric-procedure-input.v1';
export const GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA = 'stellar-forge.gridfabric-procedure-capture.v1';
export const GRIDFABRIC_PROCEDURE_STEPS = Object.freeze([
  'workspace','configuration','sources','mappings','callbacks','events','dispatch','reports','delivery'
]);
const TABLES = ['instances','instance_editions','sources','source_rows','source_issues','mappings',
  'callbacks','callback_deliveries','events','event_revisions','distributions','opt_decisions','device_actions',
  'reports','report_rows','management_operations','management_receipts','operations'];
const STATES = ['planned','in-progress','completed','skipped'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code,message) => { const error = new TypeError(message); error.code=code; throw error; };
const need = (value,code,message) => { if(!value)fail(code,message); };
const exact = (value,keys,label) => need(plain(value) && Object.keys(value).every(key=>keys.includes(key)),
  'GRID_PROCEDURE_FIELDS',label+' contains unsupported fields.');
const text = (value,label,max=32000,required=false) => {
  need(typeof value==='string' && value.length<=max && !value.includes('\u0000') &&
    (!required || value.trim()),'GRID_PROCEDURE_TEXT',label+' must be complete text up to '+max+' characters.');
  return value;
};
const id = (value,label) => {
  need(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value),
    'GRID_PROCEDURE_ID',label+' must be a stable 1–128 character identifier.');return value;
};
const step = value => need(GRIDFABRIC_PROCEDURE_STEPS.includes(value),'GRID_PROCEDURE_STEP','Select an original GridFabric procedure step.');
const json = value => JSON.stringify(value,null,2);
const canonical = value => plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))
  : Array.isArray(value) ? value.map(canonical) : value;
const same = (a,b) => JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function inspectGridFabricProcedureInput(value) {
  exact(value,['schema','id','title','customer','period','owner','purpose','notes','receiving','workspace',
    'expectedRevision','instanceId','records','files','stepResults'],'Procedure input');
  need(value.schema===GRIDFABRIC_PROCEDURE_INPUT_SCHEMA,'GRID_PROCEDURE_SCHEMA','Use a complete GridFabric procedure input.');
  id(value.id,'Plan ID');text(value.title,'Title',300,true);
  for(const name of ['customer','period'])text(value[name]??'',name,1000);
  text(value.owner??'','owner',300);
  for(const name of ['purpose','notes','receiving'])text(value[name]??'',name);
  exact(value.workspace,['workspace_id','workspace_directory','source_sha256'],'Original workspace');
  text(value.workspace.workspace_id,'Workspace ID',200,true);
  text(value.workspace.workspace_directory,'Workspace directory',4096,true);
  need(/^(\/|[A-Za-z]:[\\/])/.test(value.workspace.workspace_directory),'GRID_PROCEDURE_WORKSPACE',
    'Keep the absolute directory of the original workspace.');
  need(/^[a-f0-9]{64}$/.test(value.workspace.source_sha256||''),'GRID_PROCEDURE_SOURCE','Keep the original native source SHA-256.');
  need(Number.isSafeInteger(value.expectedRevision)&&value.expectedRevision>=0,
    'GRID_PROCEDURE_REVISION','Select the reviewed native workspace revision.');
  text(value.instanceId,'Plaid instance ID',500,true);
  const records=value.records??[],files=value.files??[],results=value.stepResults??[];
  need(Array.isArray(records)&&Array.isArray(files)&&records.length+files.length<=500,
    'GRID_PROCEDURE_SELECTION','Select up to 500 original record/file references.');
  const references=new Set();
  for(const selected of records) {
    exact(selected,['stepId','collection','id'],'Record selection');step(selected.stepId);
    need(TABLES.includes(selected.collection),'GRID_PROCEDURE_COLLECTION','Select an original native collection.');
    text(selected.id,'Native record ID',1000,true);
    const key=json([selected.stepId,selected.collection,selected.id]);
    need(!references.has(key),'GRID_PROCEDURE_DUPLICATE','Each record reference may occur once per step.');references.add(key);
  }
  for(const selected of files) {
    exact(selected,['stepId','fileId'],'File selection');step(selected.stepId);
    text(selected.fileId,'Native SDK file ID',1000,true);
    need(/^(file_[a-f0-9]{64}|export_[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(selected.fileId),
      'GRID_PROCEDURE_FILE','Use the original SDK file_SHA256 or export_UUID identifier.');
    const key=json([selected.stepId,selected.fileId]);
    need(!references.has(key),'GRID_PROCEDURE_DUPLICATE','Each file reference may occur once per step.');references.add(key);
  }
  need(Array.isArray(results)&&results.length<=GRIDFABRIC_PROCEDURE_STEPS.length,
    'GRID_PROCEDURE_RESULTS','Use one operator result per procedure step.');
  const statuses=new Set();
  for(const result of results) {
    exact(result,['stepId','status','note'],'Recorded operator result');step(result.stepId);
    need(STATES.includes(result.status)&&!statuses.has(result.stepId),'GRID_PROCEDURE_STATUS','Select one recorded status per step.');
    text(result.note,'Operator result note',12000,true);statuses.add(result.stepId);
  }
  return {...copy(value),customer:value.customer??'',period:value.period??'',owner:value.owner??'',
    purpose:value.purpose??'',notes:value.notes??'',receiving:value.receiving??'',
    records:copy(records),files:copy(files),stepResults:copy(results)};
}
const DEFINITIONS = [
  ['workspace','Open the original customer workspace',
    'Open GridFabric Plaid from Applications in the selected installed runtime. Match the workspace ID, directory and source SHA-256 below. Keep the original owner running while the procedure reads its authenticated SDK.',
    'The original native workspace and installed source identity are visible; current revision matches the selected revision.'],
  ['configuration','Review the Plaid configuration and deployed contract',
    'Review the selected instance and its complete configuration editions. Retain the deployed callback schema/sample as an original source. Check management listener, environment-variable credential references, device mappings and reviewed callback bindings in the original GridFabric editor.',
    'The selected instance, schema source, reviewer and exact configuration edition are retained.'],
  ['sources','Receive measurement files and corrections',
    'Retain the complete original CSV/JSON or evidence file in GridFabric. Review timestamp offsets, interval duration, kind, unit, value semantics and provenance. Resolve source issues with linked correction files while preserving every earlier source.',
    'Each selected source has its original file, profile, parsed rows, issues and correction lineage.'],
  ['mappings','Review and activate the report mapping',
    'Review original report registrations and rId/specifier source mappings. Check source precedence, units, period, time basis, rounding, quality and explicit resampling approval. Activate only the selected complete mapping with the original named reviewer.',
    'The active mapping and its reviewed original source definitions are retained.'],
  ['callbacks','Review native callbacks and responses',
    'Read original callbacks and all delivery observations. Keep the complete request, header and immutable HTTP response. Plaid controls VTN timing; return the callback response before attempting management work against the same instance.',
    'Original callback bodies, response files, delivery history and instance version observations remain available.'],
  ['events','Review event history and opt decisions',
    'Review event editions, native intervals, target bindings, distributions and opt evidence. Apply the original resource or event-wide decision explicitly. Continue a retained callback or reproject history only through the existing reviewed actions.',
    'The current event and interval identity, reviewed opt choices and retained historical observations are recorded.'],
  ['dispatch','Inspect management and device outcomes',
    'Use the original GridFabric dispatch controls for a reviewed operation. Recover its existing request or attempt after interruption. Inspect complete response/transport receipts and reconcile the same operation using actual provider evidence.',
    'The original request, attempt, native status and complete receipt history are retained. ACKNOWLEDGED describes an adapter HTTP result; PROCESSED and later VTN outcomes remain separate.'],
  ['reports','Review complete report output',
    'Read the original report and every report row. Inspect exact source segments, rational calculation, rounding, wire values and per-point issues. A NEEDS_SOURCE result calls for corrected original inputs before rebuilding through the native action.',
    'The full report and original response file are retained with source-row lineage; incomplete coverage remains visible.'],
  ['delivery','Export and receive the complete customer work',
    'Use the original GridFabric export/delivery controls to retain a complete portable workspace. Select that exact SDK export file for this capture. Keep this procedure capture, full plan history and installed source package together. Restore the portable workspace through the original GridFabric receiver and import the plan into Operating Plans.',
    'A recipient can inspect the complete native file and plan history, then reopen the original product and return a revised Operating Plan.']
];
export function prepareGridFabricProcedure({catalog,input,savedAt=new Date().toISOString()}={}) {
  const selected=inspectGridFabricProcedureInput(input);
  const registration=snapshotRegistration(catalog,'command:gridfabric-plaid');
  const steps=DEFINITIONS.map(([key,title,instruction,expectedResult])=>createOperatingStep({
    id:key,title,instruction,expectedResult,owner:selected.owner,selection:registration,argv:[],
    inputs:json({workspace:selected.workspace,instanceId:selected.instanceId,expectedRevision:selected.expectedRevision,
      recordCount:selected.records.filter(row=>row.stepId===key).length,fileCount:selected.files.filter(row=>row.stepId===key).length,
      selectionFile:'procedure-input.json'})
  }));
  return createOperatingPlan({id:selected.id,title:selected.title,customer:selected.customer,period:selected.period,
    owner:selected.owner,purpose:selected.purpose||'Operate the selected Plaid instance and transfer its complete customer history.',
    receiving:selected.receiving||'Import gridfabric-plan.json into the installed Command finder → Operating Plans. Keep capture.json and all declared complete members together. Use the original GridFabric archive receiver for native workspace restoration.',
    notes:selected.notes,steps,savedAt});
}
function member(value) {
  need(plain(value)&&typeof value.path==='string'&&value.path.length<=4096&&
    !value.path.startsWith('/')&&!value.path.includes('\\')&&
    value.path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&
    Number.isSafeInteger(value.bytes)&&value.bytes>=0&&/^[a-f0-9]{64}$/.test(value.sha256||''),
  'GRID_PROCEDURE_CAPTURE_MEMBER','Retain each complete capture member with its relative path, byte count and SHA-256.');
}
export function recordGridFabricProcedure(plan,capture,{input,savedAt=capture?.capturedAt}={}) {
  const selected=inspectGridFabricProcedureInput(input),saved=inspectOperatingPlan(plan);
  need(saved.id===selected.id,'GRID_PROCEDURE_PLAN','This capture belongs to a different plan.');
  need(capture?.schema===GRIDFABRIC_PROCEDURE_CAPTURE_SCHEMA&&same(capture.workspace,selected.workspace)&&
    capture.revision===selected.expectedRevision&&capture.instanceId===selected.instanceId&&same(capture.input,selected),
    'GRID_PROCEDURE_CAPTURE_BINDING','The capture must retain the reviewed original workspace, source and revision.');
  need(Array.isArray(capture.records)&&Array.isArray(capture.files),'GRID_PROCEDURE_CAPTURE_MEMBERS','Keep all selected capture records and files.');
  for(const item of [...capture.records,...capture.files]){step(item.stepId);member(item);}
  for(const expected of selected.records)need(capture.records.some(row=>row.stepId===expected.stepId&&
    row.collection===expected.collection&&row.id===expected.id),'GRID_PROCEDURE_RECORD_MISSING','A selected original record is missing from the capture.');
  for(const expected of selected.files)need(capture.files.some(row=>row.stepId===expected.stepId&&row.fileId===expected.fileId),
    'GRID_PROCEDURE_FILE_MISSING','A selected original native file is missing from the capture.');
  const draft=operatingPlanDraft(saved);
  for(const key of GRIDFABRIC_PROCEDURE_STEPS) {
    const target=draft.content.steps.find(row=>row.id===key);
    need(target,'GRID_PROCEDURE_STEP_MISSING','Keep each original GridFabric procedure step in this plan.');
    let binding;try{binding=JSON.parse(target.inputs);}catch{fail('GRID_PROCEDURE_INPUT_CHANGED','The procedure step no longer contains its original structured binding.');}
    need(same(binding.workspace,selected.workspace)&&binding.instanceId===selected.instanceId,
      'GRID_PROCEDURE_WORKSPACE_CHANGED','The procedure step belongs to another native workspace or Plaid instance.');
    const records=capture.records.filter(row=>row.stepId===key),files=capture.files.filter(row=>row.stepId===key);
    const result=selected.stepResults.find(row=>row.stepId===key);
    target.inputs=json({...binding,expectedRevision: selected.expectedRevision,
      recordCount:selected.records.filter(row=>row.stepId===key).length,fileCount:selected.files.filter(row=>row.stepId===key).length,
      selectionFile:'procedure-input.json'});
    const lines=['Captured at '+capture.capturedAt+'.','Original workspace '+selected.workspace.workspace_id+
      ', revision '+capture.revision+'.','Complete record responses: '+records.length+'. Complete native files: '+files.length+'.',
      'Open capture.json for the complete member list, original outcomes and SHA-256 identities.'];
    const statuses=new Map();
    for(const record of records)if(typeof record.record?.status==='string') {
      const value=record.record.status;
      if(value.length<=128)statuses.set(value,(statuses.get(value)??0)+1);
    }
    if(statuses.size)lines.push('Recorded native statuses: '+[...statuses].map(([status,count])=>status+' ('+count+')').join(', ')+'.');
    if(result) {target.status=result.status;lines.push('Operator assessment ('+result.status+'): '+result.note);}
    else lines.push('The saved operator step status is '+target.status+'.');
    target.recordedResult=lines.join('\n');
  }
  return saveOperatingPlanRevision(saved,draft,{savedAt});
}
