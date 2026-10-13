// MIT. Complete agent operation over the original planner and retained table/workbook engines.
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {
  ROLES, planningBaseline, planningBookFromNative, importPlanningBook, rebasePlanningBook,
  receivePlanningEdition, addPlanningTable, receivePlanningWorkbook, changePlanningMapping,
  selectPlanningWorkbook, selectPlanningSourceEdition, retainPlanningTableReview,
  setSourceRowExclusion, sourceTableRows, sourceEditionComparison, preparePlanningImport,
  requireCurrentBaseline, completeNativePreview, acceptPlanningPreview, serializePlanningBook,
} from './source-tables-core.mjs';
import {workbookUpload, requireWorkbookProjectCapacity} from './source-workbooks.mjs';
import {
  defaultPlanningWorkbookProfile, validatePlanningWorkbookProfile,
  defaultPlanningWorkbookReturnProfile, validatePlanningWorkbookReturnProfile,
  receivePlanningWorkbookReturn, preparePlanningWorkbookHandover,
} from './source-workbook-export.mjs';
import {GRANT_MAX_BUNDLE_BYTES, GRANT_MAX_WORKBOOK_HANDOVER_BYTES} from './agent-contracts.mjs';

export const GRANT_PLANNING_SOURCE_SCHEMA = 'stellar-forge.sf47-planning-source-agent.v1';
export const GRANT_PLANNING_SOURCE_ACTIONS = Object.freeze([
  'snapshot','read','receive','receive-workbook','receive-returned-workbook',
  'configure','select','review','rebase','preview','save','handover',
]);
const MAX_JSON = 64 * 1024 * 1024;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (condition, code, message) => {
  if (!condition) throw Object.assign(new Error(message), {code});
};
const exact = (value, allowed, required = []) => {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => own(value,key)), 'GRANT_PLANNING_INPUT', 'Use the complete declared planning-source operation.');
};
const role = value => {
  need(own(ROLES,value),'GRANT_PLANNING_ROLE','Choose packages, milestones, contributors or assignments.');
  return value;
};
const selectedPlan = (body, immutable = false) => {
  need(/^plan-[a-f0-9]{32}$/.test(body.planId ?? ''),'GRANT_PLANNING_PLAN','Use the original saved plan identifier.');
  if (immutable || body.revision !== undefined)
    need(Number.isSafeInteger(body.revision) && body.revision > 0 && body.revision <= 1000000,
      'GRANT_PLANNING_REVISION','Choose the exact positive saved revision.');
  if (body.expectedContentSha256 !== undefined)
    need(/^[a-f0-9]{64}$/.test(body.expectedContentSha256),'GRANT_PLANNING_SHA','Use the exact saved-plan content SHA256.');
};
const planReference = plan => ({id:plan.id,revision:plan.revision,contentSha256:plan.contentSha256});
const response = (value, original, filename = 'planning-source-operation.json') => {
  const bytes = Buffer.from(JSON.stringify(value)+'\n');
  need(bytes.length <= MAX_JSON,'GRANT_PLANNING_RESPONSE_CAPACITY','The complete planning-source response exceeds 64 MiB.');
  return {value,bytes,sha256:sha(bytes),source:original.source,status:200,
    mediaType:'application/json; charset=utf-8',filename};
};
const bookValue = (operation, book, extra = {}) => ({
  schema:GRANT_PLANNING_SOURCE_SCHEMA,operation,book,baseline:planReference(book.baseline),
  collections:book.bindings.map(binding => {
    const document=book.project.documents.find(item=>item.id===binding.documentId);
    return {role:binding.role,documentId:document.id,selectedEditionId:document.selectedEditionId,
      selectedReviewId:document.selectedReviewId ?? null,mode:binding.mode,
      editions:document.editions.map(item=>({id:item.id,filename:item.filename,sha256:item.sha256,bytes:item.bytes})),
      selectedWorkbook:book.selectedWorkbooks?.[document.id] ?? null};
  }),...extra,
});
async function originalBaseline(client, book) {
  const result=await client.read('plan',{planId:book.baseline.id,revision:book.baseline.revision});
  requireCurrentBaseline(book,result.value);
  return result;
}
const inflated = (raw,maximum) => new Uint8Array(inflateRawSync(raw,{maxOutputLength:Math.max(1,maximum)}));
const inputBytes = (value,maximum,label) => {
  need(value instanceof Uint8Array && value.length <= maximum,'GRANT_PLANNING_FILE',label+' must retain every original byte within its native bound.');
  return value;
};
function receiveOptions(value) {
  exact(value,['filename','bytes','delimiter','header'],['filename','bytes']);
  need(typeof value.filename === 'string' && value.filename && value.filename.length <= 500 &&
    !/[\\/\u0000-\u001f\u007f]/.test(value.filename),'GRANT_PLANNING_FILE','Use the original plain filename.');
  if(value.delimiter!==undefined)need([',',';','\t','|'].includes(value.delimiter),
    'GRANT_PLANNING_DELIMITER','Select the original comma, semicolon, tab or pipe delimiter.');
  if(value.header!==undefined)need(typeof value.header==='boolean','GRANT_PLANNING_HEADER','Choose whether the original table has a heading row.');
  return value;
}
export function grantPlanningSourceProfiles() {
  return {schema:GRANT_PLANNING_SOURCE_SCHEMA,roles:clone(ROLES),
    workbookExport:defaultPlanningWorkbookProfile(),workbookReturn:defaultPlanningWorkbookReturnProfile(),
    sourceProjectSchema:'stellar-forge.planning-source-tables.v1',
    workbookMappingSchema:'stellar-forge.planning-workbook-mapping.v1',
    guides:['SOURCE_TABLES.md','WORKBOOK_HANDOVER.md','SOURCE_TABLES_AGENT.md']};
}

/** The caller keeps the original GrantWorkspaceClient lifecycle and full returned files. */
export async function performGrantPlanningSourceOperation(client,action,body) {
  need(GRANT_PLANNING_SOURCE_ACTIONS.includes(action),'GRANT_PLANNING_ACTION','Choose an original planning-source operation.');
  need(client && typeof client.read==='function' && typeof client.plan==='function' &&
    typeof client.workbook==='function','GRANT_PLANNING_CLIENT','Use the existing opened grant client.');
  if(action==='snapshot') {
    exact(body,['planId','revision','expectedContentSha256'],['planId']);selectedPlan(body);
    const original=await client.read('plan',{planId:body.planId,...(body.revision===undefined?{}:{revision:body.revision})});
    const plan=original.value;
    if(body.expectedContentSha256!==undefined)need(plan.contentSha256===body.expectedContentSha256,
      'GRANT_PLANNING_SHA','The selected native revision differs from the reviewed content.');
    // A saved workbook plan already owns its original XLSX files and editions.
    const book=plan.planning.sourceTables
      ? rebasePlanningBook(await importPlanningBook(plan.planning.sourceTables),plan)
      : await planningBookFromNative(plan);
    book.settings={...book.settings,scenarioName:plan.scenario.scenario_name,
      awardRequestUsd:String(plan.scenario.award_request_usd),projectEndDay:plan.scenario.project_end_day};
    requireWorkbookProjectCapacity(book);
    return response(bookValue(action,book),original);
  }
  if(action==='handover') {
    exact(body,['planId','revision','expectedContentSha256','profile'],['planId','revision','expectedContentSha256','profile']);
    selectedPlan(body,true);
    const profile=validatePlanningWorkbookProfile(body.profile);
    const original=await client.read('plan',{planId:body.planId,revision:body.revision}),plan=original.value;
    need(plan.contentSha256===body.expectedContentSha256,'GRANT_PLANNING_SHA','The selected native revision differs from the reviewed content.');
    const exported=await client.download('plan',{planId:body.planId,revision:body.revision});
    const handover=await preparePlanningWorkbookHandover(plan,profile,{
      nativeZip:new Uint8Array(exported.bytes),inflate:inflated,
      projectWorkbook:async request=>(await client.workbook('project',request)).value,
    });
    need(handover.archive.bytes <= GRANT_MAX_WORKBOOK_HANDOVER_BYTES,'GRANT_PLANNING_HANDOVER_CAPACITY',
      'The complete workbook handover exceeds the original 128 MiB file allowance plus ZIP framing.');
    const companions=[
      {filename:'planning-source-project.json',bytes:Buffer.from(serializePlanningBook(handover.book)),mediaType:'application/json; charset=utf-8'},
      {filename:'planning.zip',bytes:exported.bytes,mediaType:'application/zip'},
      {filename:'planning.xlsx',bytes:Buffer.from(handover.workbook.data),
        mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
      {filename:'WORKBOOK_EXPORT.json',bytes:Buffer.from(handover.files.find(file=>file.path==='WORKBOOK_EXPORT.json').content),mediaType:'application/json; charset=utf-8'},
    ].map(file=>({...file,sha256:sha(file.bytes),source:original.source,status:200,
      ...(/^application\/json\b/.test(file.mediaType)?{value:JSON.parse(file.bytes)}:{})}));
    return {value:undefined,bytes:Buffer.from(handover.archive.data),sha256:handover.archive.sha256,
      mediaType:'application/zip',filename:handover.archive.filename,status:200,source:original.source,
      handover:{schema:GRANT_PLANNING_SOURCE_SCHEMA,plan:planReference(plan),manifest:handover.manifest,
        sourceProjectId:handover.book.id},companions};
  }
  if(action==='save') {
    exact(body,['preview','note','requestId'],['preview','note','requestId']);
    need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(body.requestId??''),
      'GRANT_PLANNING_REQUEST','Preserve the original native request identifier.');
    const selected=body.preview,prepared=await preparePlanningImport(selected?.book);
    need(selected?.id===prepared.id && selected.planId===prepared.planId &&
      selected.expectedRevision===prepared.expectedRevision,'GRANT_PLANNING_PREVIEW',
      'Use the complete reviewed native preview and its original source project.');
    const accepted=await acceptPlanningPreview(selected,prepared.book,{
      note:body.note,reviewedAt:selected.review.preparedAt,
    });
    // Build the same original payload before dispatch. Native request replay runs
    // before its current-revision guard, including after a later operator save.
    const payload={expectedRevision:prepared.expectedRevision,scenarioPatch:prepared.scenarioPatch,
      planning:{...prepared.planning,sourceTables:accepted.planning.sourceTables},
      note:body.note,requestId:body.requestId};
    // Return the original writer response directly: no dependent read/export can
    // turn a successful saved revision into an apparent failed mutation.
    return client.plan('save',prepared.planId,payload);
  }
  const fields={
    read:['book','role'],receive:['book','role','file'],
    'receive-workbook':['book','role','selection'],
    'receive-returned-workbook':['book','file','profile'],
    configure:['book','role','binding','tableMapping','settings','orphanPolicy','exclusions'],
    select:['book','role','editionId','workbookSelectionId'],
    review:['book','roles'],rebase:['book','planId','revision','expectedContentSha256'],preview:['book'],
  };
  exact(body,fields[action],['book']);
  let book=await importPlanningBook(body.book),original;
  requireWorkbookProjectCapacity(book);
  if(action==='rebase') {
    selectedPlan(body);
    original=await client.read('plan',{planId:body.planId,...(body.revision===undefined?{}:{revision:body.revision})});
    if(body.expectedContentSha256!==undefined)need(original.value.contentSha256===body.expectedContentSha256,
      'GRANT_PLANNING_SHA','The selected rebase revision differs from its reviewed content.');
    book=rebasePlanningBook(book,original.value);
  } else if(action==='preview') {
    original=await client.read('plan',{planId:book.baseline.id});
    requireCurrentBaseline(book,original.value);
    const prepared=await preparePlanningImport(book);
    const calculated=await client.plan('estimate',prepared.planId,{
      expectedRevision:prepared.expectedRevision,scenarioPatch:prepared.scenarioPatch,planning:prepared.planning,
    });
    return response(await completeNativePreview(prepared,calculated.value),calculated,'planning-source-preview.json');
  } else {
    original=await originalBaseline(client,book);
    if(action==='read') {
      const detail=body.role===undefined?{}:{
        role:role(body.role),table:sourceTableRows(book,body.role),comparison:sourceEditionComparison(book,body.role),
      };
      return response(bookValue(action,book,detail),original);
    }
    if(action==='receive') {
      role(body.role);const file=receiveOptions(body.file);
      const sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(inputBytes(file.bytes,16*1024*1024,'The original delimited table'));
      book=book.bindings.some(item=>item.role===body.role)
        ? await receivePlanningEdition(book,body.role,{filename:file.filename,sourceText})
        : await addPlanningTable(book,{role:body.role,filename:file.filename,sourceText,
          delimiter:file.delimiter??',',header:file.header??true});
    } else if(action==='receive-workbook') {
      role(body.role);exact(body.selection,['source','projection'],['source','projection']);
      book=await receivePlanningWorkbook(book,{role:body.role,...body.selection});
    } else if(action==='receive-returned-workbook') {
      const file=receiveOptions(body.file);
      const upload=await workbookUpload(file.filename,inputBytes(file.bytes,GRANT_MAX_BUNDLE_BYTES,'The original returned workbook'));
      const result=await receivePlanningWorkbookReturn(book,upload,validatePlanningWorkbookReturnProfile(body.profile),{
        inspectWorkbook:async request=>(await client.workbook('inspect',request)).value,
        projectWorkbook:async request=>(await client.workbook('project',request)).value,
      });
      book=result.book;
      return response(bookValue(action,book,{received:result.received,profile:result.profile,sourceId:result.source.id}),original);
    } else if(action==='configure') {
      need(['binding','tableMapping','settings','orphanPolicy','exclusions'].some(key=>own(body,key)),
        'GRANT_PLANNING_CONFIGURATION','Supply the explicit mapping, collection, source-row or planning choices.');
      if(body.settings!==undefined) {
        exact(body.settings,['scenarioName','awardRequestUsd','projectEndDay']);
        book.settings={...book.settings,...clone(body.settings)};
      }
      if(body.orphanPolicy!==undefined)book.orphanPolicy=body.orphanPolicy;
      if(['binding','tableMapping','exclusions'].some(key=>own(body,key))) {
        role(body.role);const binding=book.bindings.find(item=>item.role===body.role);
        need(binding,'GRANT_PLANNING_BINDING','Receive the complete table before configuring its planning role.');
        if(body.binding!==undefined) {
          exact(body.binding,['fields','mode','excludedRows']);
          Object.assign(binding,clone(body.binding));
        }
        if(body.tableMapping!==undefined)book=changePlanningMapping(book,body.role,body.tableMapping);
        if(body.exclusions!==undefined) {
          need(Array.isArray(body.exclusions) && body.exclusions.length<=100000,
            'GRANT_PLANNING_EXCLUSIONS','Supply explicit original source-row decisions.');
          for(const row of body.exclusions) {
            exact(row,['record','excluded','note'],['record','excluded']);
            need(typeof row.excluded==='boolean','GRANT_PLANNING_EXCLUSIONS','Choose include or exclude for the original record.');
            book=setSourceRowExclusion(book,body.role,row.record,row.excluded,row.note??'');
          }
        }
      }
      book=await importPlanningBook(book);
    } else if(action==='select') {
      need((body.workbookSelectionId!==undefined)!==(body.editionId!==undefined),
        'GRANT_PLANNING_SELECTION','Select one retained worksheet choice or an original source edition.');
      if(body.workbookSelectionId!==undefined) {
        need(body.role===undefined,'GRANT_PLANNING_SELECTION','A retained worksheet choice already selects its original document and role.');
        book=selectPlanningWorkbook(book,body.workbookSelectionId);
      } else book=selectPlanningSourceEdition(book,role(body.role),body.editionId);
      book=await importPlanningBook(book);
    } else if(action==='review') {
      need(Array.isArray(body.roles) && body.roles.length>=1 && body.roles.length<=4 &&
        new Set(body.roles).size===body.roles.length,'GRANT_PLANNING_REVIEW','Name each planning collection being reviewed exactly once.');
      for(const selected of body.roles)book=await retainPlanningTableReview(book,role(selected));
    }
  }
  requireWorkbookProjectCapacity(book);
  return response(bookValue(action,book),original);
}
