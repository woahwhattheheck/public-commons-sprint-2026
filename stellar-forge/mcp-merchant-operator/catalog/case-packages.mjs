// MIT. Complete case/source package tools, using the original Support owner.
const id={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const actor={type:'string',minLength:1,maxLength:200};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200},
  q:{type:'string',maxLength:240}};
const source={type:'object',properties:{kind:{enum:['input','operation']},id},required:['kind','id'],additionalProperties:false};
const fileRead={source,name:{type:'string',minLength:1,maxLength:4096},expectedManifestSha256:sha,
  expectedSha256:sha,readId:uuid,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}};
export function casePackageTools(tool) {
  const read={readOnly:true,idempotent:true},write={idempotent:true};
  return [
    tool('merchant_case_package_catalog','Inspect the original complete-package owner, configured Handoffs source aliases, source-owned byte limits and existing private case/source paths. Starts no transfer.',{},[],read),
    tool('merchant_case_package_operations','Page retained package operations and their observed lifecycle. A saved RUNNING state alone does not establish a live worker.',page,[],read),
    tool('merchant_case_package_inputs','Page original browser-received complete package inputs. Their original manifest and native member bytes remain retained.',page,[],read),
    tool('merchant_case_package_status','Read one original operation, actual ownership in this process, native receiving progress and completion.',{id},['id'],read),
    tool('merchant_case_package_prepare','Retain one complete package operation. Export selects an original saved case revision and preserves full history/all native source bundles. Inspect/receive selects an existing input or exported operation. Remote receiving uses one configured Handoffs source and original export. Keep this exact ID, actor and body after an interrupted reply.',
      {id,kind:{enum:['export','inspect','receive','remote']},actor,caseId:uuid,revision:sha,source,
        expectedManifestSha256:sha,profile:id,exportId:id},['id','kind','actor'],write),
    tool('merchant_case_package_run','Start or join the exact retained operation through the original writer lease. Completed requests retain their first native result. Inspect status after a lost reply.',{id},['id'],write),
    tool('merchant_case_package_pause','Pause the running package operation owned by this installed process and retain its native checkpoints. It cannot stop another owner.',{id},['id'],write),
    tool('merchant_case_package_inventory','Page complete files, original immutable case revisions or every native source bundle, including historical and unassigned attachments.',
      {source,expectedManifestSha256:sha,section:{enum:['files','sourceBundles','originalFiles','revisions']},bundleId:sha,manifestSha256:sha,...page},['source','expectedManifestSha256'],read),
    tool('merchant_case_package_remote_inspect','Read the exact complete package manifest from a host-configured original Handoffs source. Returns original identity and full inventory; creates no local case.',
      {profile:id,exportId:id},['profile','exportId'],{...read,openWorld:true}),
    tool('merchant_case_package_open','Resolve the completed receiving operation to its current original saved case. Preserves any later receiver edits and returns the independently usable source directory.',
      {id},['id'],read),
    tool('merchant_case_package_file','Read a bounded range of one whole-package file using the original immutable descriptor reader. Continue its readId or reopen the same expected SHA/offset after expiry. Large native source archives stay streamed.',
      fileRead,['source','name','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_case_package_original_file','Read an actual original member inside one package-declared native source bundle after that source is available in the original local source service. This includes unassigned historical attachments.',
      {source,expectedManifestSha256:sha,bundleId:sha,manifestSha256:sha,path:{type:'string',maxLength:4096},
        expectedSha256:sha,readId:uuid,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}},
      ['source','expectedManifestSha256','bundleId','manifestSha256','path','expectedSha256'],read),
    tool('merchant_case_package_file_release','Release an original immutable file reader owned by this package selection.',{source,readId:uuid},['source','readId'],write),
    tool('merchant_case_package_export_manifest','Read the original complete-export manifest descriptor for native receiving. Fetch case-source-package.json through the original leased file route; its complete inventory includes all retained native bundles.',
      {exportId:id},['exportId'],read),
    tool('merchant_case_package_export_file','Read a complete export file through the original retained-download protocol. All names and SHA identities are bound to the exact completion manifest.',
      {exportId:id,file:{type:'string',maxLength:4096},expectedManifestSha256:sha,expectedSha256:sha,
        readId:uuid,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}},
      ['exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_case_package_export_file_release','Release an original export file lease.',{exportId:id,readId:uuid},['exportId','readId'],write)
  ];
}
