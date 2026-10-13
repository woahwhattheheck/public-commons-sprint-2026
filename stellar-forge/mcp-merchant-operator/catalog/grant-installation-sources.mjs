// MIT. Complete original Installation Source Desk tools; no provider runtime imports.
const str=(max=12000)=>({type:'string',maxLength:max});
const text=(max=300)=>({type:'string',minLength:1,maxLength:max});
const object={type:'object',additionalProperties:true};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const id=prefix=>({type:'string',pattern:'^'+prefix+'-[a-f0-9]{32}$'});
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const revision={type:'integer',minimum:0,maximum:10000};
const edition={type:'integer',minimum:1,maximum:10000};
const requestId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const fileId={type:'string',pattern:'^input-[a-f0-9]{64}$'};
const preparationId={type:'string',pattern:'^preparation-[a-f0-9]{64}$'};
const filename={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$'};
const ws={workspace:alias},caseSelection={...ws,caseId:id('operation')},
  draft={...caseSelection,draftId:id('source-desk')};
const fileIds={type:'array',items:fileId,uniqueItems:true,maxItems:1024};
const input={type:'object',additionalProperties:false,
  properties:{hostInput:alias,snapshotId:{type:'string'},transferId:{type:'string'},sourceWorkspace:alias},
  oneOf:[{required:['hostInput']},{required:['snapshotId']},{required:['transferId']}]};
const original={input,expectedInputSha256:sha};
const context={requestId,actor:text(300),note:str(12000)};
const required=['workspace','caseId','draftId'];
const preview={expectedRevision:revision,captureFileId:fileId,fileIds};
const phase={type:'object',additionalProperties:false,
  properties:{milestoneIndex:{type:'integer',minimum:0},phaseId:text(160)},required:['milestoneIndex','phaseId']};
const body=(properties,needed=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required:needed});
function tool(name,description,properties,needed,readOnly=true,extra={}){
  return {name:'merchant_grant_source_desk_'+name,description,
    annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    inputSchema:{type:'object',properties,required:needed,additionalProperties:false,...extra}};
}
const either=key=>({oneOf:[{required:[key]},{required:['input','expectedInputSha256']}]});
export const grantInstallationSourceTools=[
  tool('profiles','Read the complete installed original source profiles, engine hashes, source formats and native capacity limits.',
    ws,['workspace']),
  tool('list','Read every original source draft in this case. The complete response is retained; use returned snapshot pointers and row paging.',
    caseSelection,['workspace','caseId']),
  tool('detail','Open the complete current or explicitly selected historical Source Desk edition, with original files, selection, preparations, attachments and history.',
    {...draft,revision:edition},required),
  tool('request','Read and verify this exact original Source Desk request journal, including complete original archive/source/Installation receipt bytes.',
    {...draft,requestId},[...required,'requestId']),
  tool('file_inspect','Inspect an original selected source at its retained edition; an optional explicit original phase amendment is a read-only preview.',
    {...draft,fileId,revision:edition,phaseIdAmendment:object},[...required,'fileId']),
  tool('file','Receive the complete SHA-bound original source file into the existing immutable file reader. Preserve historical edition when selected.',
    {...draft,fileId,revision:edition,expectedSha256:sha},[...required,'fileId','expectedSha256']),
  tool('preparation','Read the complete original retained source preparation and all native output identities.',
    {...draft,preparationId},[...required,'preparationId']),
  tool('archive_describe','Describe the exact complete original preparation ZIP, including its original byte count and SHA256 before download.',
    {...draft,preparationId},[...required,'preparationId']),
  tool('archive','Receive the complete original preparation ZIP with up to 192 MiB of original members plus its manifest and ZIP framing, using its reviewed SHA256 and complete size. Read every byte through the existing retained reader.',
    {...draft,preparationId,expectedSha256:sha},[...required,'preparationId','expectedSha256']),
  tool('output','Receive one complete original prepared output by exact native filename and SHA256.',
    {...draft,preparationId,filename,expectedSha256:sha},[...required,'preparationId','filename','expectedSha256']),
  tool('commissioning_inspect','Inspect exact uploaded commissioning capture originals and their saved project/current Installation candidates.',
    {...draft,body:body(preview)},[...required,'body']),
  tool('commissioning_preview','Review original captured project and explicit milestone-to-Workshare phase bindings at the exact current case and Installation revisions.',
    {...draft,body:body({...preview,expectedVersion:{type:'integer',minimum:0},
      projectId:text(160),installationId:id('installation'),expectedInstallationRevision:edition,
      milestonePhases:{type:'array',items:phase,maxItems:1000},includeAccountSnapshot:{type:'boolean'}},
      [...Object.keys(preview),'expectedVersion','projectId','installationId','expectedInstallationRevision','milestonePhases'])},
    [...required,'body']),
  tool('archive_inspect','Review every native handover TAR member, exact current-filename conflicts, explicit replacements and original capacity. Complete private snapshot stays outside the suggested attachment selection.',
    {...draft,body:body({expectedRevision:revision,archiveFileId:fileId,replaceFileIds:fileIds},
      ['expectedRevision','archiveFileId'])},[...required,'body']),
  tool('mapping_compare','Compare every exact source/current mapping value. Retain its complete native wire canonicalJSON and value, including original number lexemes and explicitly selected array positions.',
    {...draft,body:object},[...required,'body']),
  tool('mapping_preview','Resolve every explicit source/target/custom/absent choice into the original complete edition plan. Retain the full native wire canonicalJSON, source references and file decisions.',
    {...draft,body:object},[...required,'body']),
  tool('mapping_prepare','Retain mapping.apply from the complete native wire preview (or exact safe-number plan), preserving original canonical JSON and request identity before any native mutation.',
    {...draft,plan:object,...original,...context},[...required,'requestId','actor'],false,either('plan')),
  tool('command_prepare','Retain a complete immutable original Source Desk command before any native mutation. Covers create, file.remove, selection.save, prepare, native.receive and original case attachment; full native action data stays unchanged.',
    {...draft,body:object,...original},required,false,either('body')),
  tool('upload_prepare','Resolve one exact declared input or completed transfer, verify all original bytes, and retain its full native file.add command. The prepared operation replays saved bytes even if a host alias later changes.',
    {...draft,...original,filename,mediaType:text(200),sourceUrl:text(12000),observedAt:text(300),
      ...context,expectedRevision:revision},
    [...required,'input','expectedInputSha256','filename','mediaType','sourceUrl','observedAt','requestId','actor','expectedRevision'],false),
  tool('review_prepare','Seal a complete original archive or commissioning attachment preview into its native request. Validates every preview field/hash, normalized selection and exact case/draft identity before retaining the operation.',
    {...draft,review:object,...original,...context},[...required,'requestId','actor'],false,either('review')),
  tool('execute','Read the original native journal, verify the saved request digest and perform at most one unrecorded exact command. Use the complete prepared operation from the same configured workspace; recover uncertain replies with reconcile.',
    {...draft,operation:object,...original},required,false,either('operation')),
  tool('reconcile','Read the original request journal for one exact saved operation and verify its complete request and case/draft identity. Returns RECORDED or NOT_RECORDED without resubmission.',
    {...draft,operation:object,...original},required,true,either('operation')),
];
