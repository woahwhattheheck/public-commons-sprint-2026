// MIT. Paid PMTiles outputs on the existing merchant tool namespace.
const workspace={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const object={type:'object',additionalProperties:true};
const text={type:'string',minLength:1};
const atomic={type:'string',pattern:'^(0|[1-9][0-9]{0,38})$'};
const generation={type:'integer',minimum:0};
export function pmtilesCommerceTools(tool){
  const read={readOnly:true,idempotent:true},write={idempotent:true};
  const scoped=fields=>({workspace,...fields}),request=fields=>scoped({requestId:id,...fields});
  const row=(suffix,description,fields,required,flags=read)=>
    tool('merchant_pmtiles_'+suffix,description,fields,required,flags);
  const release={releaseId:id,releaseDigest:sha};
  const original={buyer:id,purchaseRequestId:id};
  const range={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:250}};
  return [
    row('output_status','Read the original SF82 selection/runtime, this workspace’s paid releases and host-selected runtime profiles.',scoped({}),['workspace']),
    row('output_request','Read the exact retained paid-output lifecycle request and its first completed result after an interrupted client reply.',request({}),['workspace','requestId']),
    row('output_prepare','Retain selected currently published map resources or an original completed operations package as a priced immutable merchant output. The original release, files, full SHA, fixed chunks, price and complete-download cost stay bound to requestId.',
      request({releaseId:id,releaseManifestSha256:sha,offerId:workspace,title:text,origin:text,payment:object,
        chunkBytes:{type:'integer',minimum:1,maximum:1048576},objects:{type:'array',minItems:1,maxItems:64,
          items:{type:'object',additionalProperties:false,properties:{id:workspace,resourceId:id,packageRequestId:id,
            archiveSha256:sha,amount:atomic,filename:text},required:['id','amount']}}}),
      ['workspace','requestId','releaseId','releaseManifestSha256','offerId','title','origin','payment','objects'],write),
    row('output_package','Reopen the complete immutable paid-output package and verify its selected manifest and original retained file bytes.',
      scoped({outputRequestId:id,manifestSha256:sha}),['workspace','outputRequestId','manifestSha256']),
    row('output_catalog','Read the exact public catalog and original fixed-chunk object descriptor from a retained paid-output package, with both file hashes.',
      scoped({outputRequestId:id,manifestSha256:sha}),['workspace','outputRequestId','manifestSha256']),
    row('output_stage','Stage the reviewed paid-output package through original SF82 using one host-selected runtime alias. Reuse requestId after an interrupted reply.',
      request({outputRequestId:id,manifestSha256:sha,releaseId:id,label:text,runtime:id}),
      ['workspace','requestId','outputRequestId','manifestSha256','releaseId','runtime'],write),
    row('output_release','Verify one original SF82 paid-output release and its exact digest, map selection, prices and retained source package.',
      scoped(release),['workspace','releaseId','releaseDigest']),
    row('output_compare','Compare original SF82 routes, payment terms, runtime and exact map output source before activation. Use null beforeReleaseId for an initial publication.',
      scoped({...release,beforeReleaseId:{anyOf:[id,{type:'null'}]}}),
      ['workspace','releaseId','releaseDigest','beforeReleaseId']),
    row('output_activate','Select the reviewed paid-output release under original SF82 generation comparison. The retained operation is recoverable from its exact original selection-history event.',
      request({...release,expectedGeneration:generation,reason:text}),
      ['workspace','requestId','releaseId','releaseDigest','expectedGeneration','reason'],write),
    row('output_start','Start the selected original SF82 seller or observe an already matching manager. The result reports its original instance and whether this operator owns its lifetime.',
      request({...release,expectedGeneration:generation}),
      ['workspace','requestId','releaseId','releaseDigest','expectedGeneration'],write),
    row('output_stop','Stop and drain this operator’s exact paid seller instance, preserving release selection and purchase receipts.',
      request({...release,instanceId:id}),['workspace','requestId','releaseId','releaseDigest','instanceId'],write),
    row('purchase_prepare','Prepare the original SF88 object purchase from one retained output package or an explicit complete catalog/hash. The host buyer’s origin, asset, recipient and spend cap remain authoritative; the selected exact price and total download budget are retained.',
      request({buyer:id,outputRequestId:id,manifestSha256:sha,catalog:object,catalogSha256:sha,objectId:workspace,maxTotalAtomic:atomic}),
      ['workspace','requestId','buyer','objectId','maxTotalAtomic'],write),
    row('purchase_status','Reopen the original SF88 object session, exact purchased map/package selection, native progress and retained delivery.',
      scoped(original),['workspace','buyer','purchaseRequestId']),
    row('purchase_run','Continue the original SF88 purchase and verified assembly, retaining its same chunk requests, payment receipts and complete file SHA.',
      scoped(original),['workspace','buyer','purchaseRequestId'],{...write,openWorld:true}),
    row('purchase_recover','Recover the original SF88 interrupted payment/receipt operation before continuing its same object plan. Completed purchases reopen their original assembled file.',
      scoped(original),['workspace','buyer','purchaseRequestId'],{...write,openWorld:true}),
    row('purchase_accounting','Read one original SF88/SF36 reservation and finalization range for this exact purchase, using the host-selected original operator workspace. Returns the unchanged native range and command identity.',
      scoped({...original,...range}),['workspace','buyer','purchaseRequestId']),
    row('purchase_finalize','Finalize one original SF88/SF36 accounting range. Repeated ranges use the original governor’s idempotent finalizer; nextOffset selects the next retained chunk range.',
      scoped({...original,...range}),['workspace','buyer','purchaseRequestId'],{...write,openWorld:true}),
    row('purchase_accounting_recover','Read the retained original accounting/finalization command after a lost reply. Supply commandId for one exact command, or omit it for the latest command and last complete response.',
      scoped({...original,commandId:{type:'string',pattern:'^(accounting|finalize)-[A-Za-z0-9]{6}$'}}),
      ['workspace','buyer','purchaseRequestId']),
    row('purchase_adopt','Adopt the complete purchased map/style/resource through original PMTiles ObjectDelivery with its retained rights and original payment/assembly identity.',
      request(original),['workspace','requestId','buyer','purchaseRequestId'],write),
    row('purchase_receive','Receive the complete purchased operations ZIP through the original portable receiver into a host-selected customer target. Reuses the exact archive and first receiving receipt across restarts.',
      request({...original,target:workspace}),['workspace','requestId','buyer','purchaseRequestId','target'],write)
  ];
}
