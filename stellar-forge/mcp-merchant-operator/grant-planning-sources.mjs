// MIT. Merchant source references compose the existing grant client and retained files.
import {createHash} from 'node:crypto';
import {grantPlanningSourceTools} from './catalog/grant-planning-sources.mjs';
import {grantPlanningSourceProfiles} from '../../stellar/scf_2026/sf47_budget_model/workspace/source-tables-agent.mjs';
import {workbookUpload} from '../../stellar/scf_2026/sf47_budget_model/workspace/source-workbooks.mjs';
import {validatePlanningWorkbookProfile} from '../../stellar/scf_2026/sf47_budget_model/workspace/source-workbook-export.mjs';
import {GRANT_MAX_BUNDLE_BYTES} from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-contracts.mjs';

export const grantPlanningSourceVerbs=new Set(grantPlanningSourceTools.map(tool=>tool.name.slice('merchant_grant_'.length)));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(value,code,message)=>{if(!value)throw Object.assign(new Error(message),{code});};
const exact=(value,keys,required=[])=>{
  need(plain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
    'GRANT_PLANNING_REFERENCE','Use the complete original input reference and its exact SHA256.');
};
function atPointer(value,selection='') {
  need(typeof selection==='string'&&selection.length<=4000&&(selection===''||selection.startsWith('/')),
    'GRANT_POINTER_INVALID','Use a complete original JSON pointer.');
  if(!selection)return value;
  for(const part of selection.slice(1).split('/')) {
    need(!/~(?![01])/u.test(part),'GRANT_POINTER_INVALID','Retain the original JSON pointer escapes.');
    const key=part.replace(/~1/g,'/').replace(/~0/g,'~');
    if(Array.isArray(value))need(/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<value.length,
      'GRANT_POINTER_NOT_FOUND','Select an original zero-based array record.');
    need(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),
      'GRANT_POINTER_NOT_FOUND','The selected value is absent from the complete original file.');
    value=value[key];
  }
  return value;
}
const mappingHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function executeGrantPlanningSourceTool(verb,args,{client,load,retain,cachedHandover}) {
  need(grantPlanningSourceVerbs.has(verb),'GRANT_PLANNING_TOOL','Choose an original planning-source tool.');
  if(verb==='source_profiles')return {workspace:args.workspace,...grantPlanningSourceProfiles()};
  const file=async reference=>{
    exact(reference,['input','expectedInputSha256'],['input','expectedInputSha256']);
    const result=await load(reference.input,reference.expectedInputSha256);
    need(result.bytes.length<=GRANT_MAX_BUNDLE_BYTES,'GRANT_PLANNING_FILE_CAPACITY',
      'The original workbook or source table must fit its native 32 MiB input bound.');
    return {filename:result.metadata.name,bytes:new Uint8Array(result.bytes)};
  };
  const json=async(reference,maximum=64*1024*1024)=>{
    exact(reference,['input','expectedInputSha256','inputPointer'],['input','expectedInputSha256']);
    const result=await load(reference.input,reference.expectedInputSha256);
    need(result.bytes.length<=maximum,'GRANT_PLANNING_JSON_CAPACITY','Retain the complete original JSON within its source-operation bound.');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.bytes).replace(/^\uFEFF/,''));
    return atPointer(value,reference.inputPointer??'');
  };
  const selection={tool:'merchant_grant_'+verb,...Object.fromEntries(Object.entries(args).filter(([key])=>
    ['project','file','selection','preview','planId','revision','expectedContentSha256','requestId','role','roles',
      'editionId','workbookSelectionId','mappingInput'].includes(key)))};
  let original;
  if(verb==='workbook_inspect'||verb==='workbook_project') {
    const input=await file(args.file),source=await workbookUpload(input.filename,input.bytes);
    if(verb==='workbook_inspect')original=await client.workbook('inspect',{source,
      ...(args.preview===undefined?{}:{preview:args.preview}),...(args.headerRow===undefined?{}:{headerRow:args.headerRow})});
    else {
      need((args.mapping!==undefined)!==(args.mappingInput!==undefined),'GRANT_PLANNING_MAPPING',
        'Supply one complete mapping inline or as a verified JSON reference.');
      const mapping=args.mapping??await json(args.mappingInput);
      selection.mappingSha256=mappingHash(mapping);
      original=await client.workbook('project',{source,mapping});
    }
  } else if(verb==='source_snapshot') {
    original=await client.planningSources('snapshot',Object.fromEntries(Object.entries(args).filter(([key])=>key!=='workspace')));
  } else if(verb==='source_save') {
    original=await client.planningSources('save',{preview:await json(args.preview,64*1024*1024),note:args.note,requestId:args.requestId});
  } else if(verb==='workbook_handover') {
    const body={planId:args.planId,revision:args.revision,expectedContentSha256:args.expectedContentSha256,
      profile:validatePlanningWorkbookProfile(args.profile)};
    return cachedHandover({requestId:args.requestId,...body},async()=>{
      const output=await client.planningSources('handover',body);
      const archive=await retain(output,selection),files=[];
      for(const companion of output.companions)
        files.push({name:companion.filename,...await retain(companion,{...selection,member:companion.filename})});
      const complete=archive.retention?.state==='COMPLETE'&&files.every(item=>item.retention?.state==='COMPLETE');
      const manifest=output.handover.manifest;
      return {workspace:args.workspace,requestId:args.requestId,schema:output.handover.schema,
        plan:output.handover.plan,sourceProjectId:output.handover.sourceProjectId,profile:manifest.profile,
        tables:manifest.tables,workbook:manifest.workbook,originalMemberCount:manifest.files.length+1,
        numericDecisions:manifest.numericCells.length,archive,files,
        retention:{state:complete?'COMPLETE':'PARTIAL',
          ...(!complete?{recovery:'Preserve the returned files and repeat this original handover request after retained storage is available.'}:{})}};
    });
  } else {
    const action={
      source_read:'read',source_receive:'receive',source_workbook_receive:'receive-workbook',
      source_workbook_return:'receive-returned-workbook',source_configure:'configure',source_select:'select',
      source_review:'review',source_rebase:'rebase',source_preview:'preview',
    }[verb];
    const body={book:await json(args.project)};
    if(verb==='source_receive')Object.assign(body,{role:args.role,file:{...await file(args.file),
      ...(args.delimiter===undefined?{}:{delimiter:args.delimiter}),...(args.header===undefined?{}:{header:args.header})}});
    else if(verb==='source_workbook_receive')Object.assign(body,{role:args.role,selection:await json(args.selection,64*1024*1024)});
    else if(verb==='source_workbook_return')Object.assign(body,{file:await file(args.file),profile:args.profile});
    else for(const [key,value]of Object.entries(args))
      if(!['workspace','project'].includes(key))body[key]=value;
    original=await client.planningSources(action,body);
  }
  return retain(original,selection);
}
