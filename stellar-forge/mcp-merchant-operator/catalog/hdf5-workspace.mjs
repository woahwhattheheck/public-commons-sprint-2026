// MIT. HDF5 source-owned metadata; listing tools starts no Python or HDF5 process.
const text={type:'string',minLength:1,maxLength:4096},hash={type:'string',pattern:'^[a-f0-9]{64}$'},id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'};
const page={offset:{type:'string',pattern:'^(0|[1-9][0-9]*)$'},limit:{type:'integer',minimum:1,maximum:200}};
const any={type:'object',additionalProperties:true};
export const HDF5_TOOL_ACTIONS=Object.freeze({
  merchant_hdf5_status:'status',merchant_hdf5_source:'source.get',merchant_hdf5_version:'version.get',merchant_hdf5_records:'records',
  merchant_hdf5_import:'source.import',merchant_hdf5_inspect:'inspect',merchant_hdf5_attributes:'attributes',merchant_hdf5_selection:'selection.get',
  merchant_hdf5_select:'selection.save',merchant_hdf5_extract:'selection.extract',merchant_hdf5_edition:'edition.get',
  merchant_hdf5_values:'result.page',merchant_hdf5_query:'dataset.query',merchant_hdf5_file:'artifact',merchant_hdf5_file_read:'artifact.read',
  merchant_hdf5_export:'edition.export',merchant_hdf5_receive:'edition.receive',merchant_hdf5_operation:'operation.get',
  merchant_hdf5_resume:'operation.resume',merchant_hdf5_cancel:'operation.cancel',merchant_hdf5_delivery:'delivery.artifact',
  merchant_hdf5_publisher_prepare:'publisher.prepare',merchant_hdf5_publisher:'publisher.action',
  merchant_hdf5_publisher_state:'publisher.state',merchant_hdf5_publisher_export:'publisher.export'
});
export function hdf5WorkspaceTools(tool){
  const scoped=(name,description,properties,required=[],hints={})=>tool(name,description,{workspace:id,...properties},['workspace',...required],hints);
  const read={readOnly:true,idempotent:true},write={idempotent:true};
  return [
    tool('merchant_hdf5_workspaces','List host-configured HDF5 workspaces without starting a native process.',{},[],read),
    scoped('merchant_hdf5_status','Read current original source, selection, result and operation counts.',page,[],read),
    scoped('merchant_hdf5_source','Read a retained source and its exact current version head.',{source:id},['source'],read),
    scoped('merchant_hdf5_version','Read an immutable source version and verify its original file bytes.',{ident:hash},['ident'],read),
    scoped('merchant_hdf5_records','Page original versions, saved selections, editions, operations or deliveries. Retain returned cursor offset.',{kind:{enum:['versions','selections','editions','operations','deliveries']},source:id,...page},['kind'],read),
    scoped('merchant_hdf5_import','Retain one original HDF5 file from a host-configured input root. Exact operation replay keeps the first captured bytes; source updates require their original expected head.',{operation:id,source_id:id,path:text,label:text,expected_head:{anyOf:[hash,{type:'null'}]},origin:any},['operation','source_id','path','label'],write),
    scoped('merchant_hdf5_inspect','Inspect original groups, hard/soft/external links, native datatypes, dimensions and dependency metadata. External targets are not followed.',{version:hash,path:text,...page},['version'],read),
    scoped('merchant_hdf5_attributes','Page attribute metadata or read one exact native attribute value. Scalars, null dataspaces and array-valued elements stay distinct.',{version:hash,path:text,name:text,...page},['version'],read),
    scoped('merchant_hdf5_selection','Read one original saved selection.',{ident:hash},['ident'],read),
    scoped('merchant_hdf5_select','Save a native validated multidimensional start/count/stride/block selection and original compound field names. Integers remain decimal text.',{operation:id,version:hash,selection:{type:'object',properties:{dataset:text,axes:{anyOf:[{type:'array',items:any,maxItems:32},{type:'null'}]},fields:{anyOf:[{type:'array',items:text,maxItems:64},{type:'null'}]}},required:['dataset'],additionalProperties:false}},['operation','version','selection'],write),
    scoped('merchant_hdf5_extract','Extract the saved original selection into exact typed values, coordinates, datatype metadata and the existing dataset CSV contract. Same original operation resumes retained results.',{operation:id,selection_id:hash},['operation','selection_id'],write),
    scoped('merchant_hdf5_edition','Verify and read one immutable result edition.',{ident:hash},['ident'],read),
    scoped('merchant_hdf5_values','Read a page of exact typed array elements in original C index order.',{edition:hash,...page},['edition'],read),
    scoped('merchant_hdf5_query','Use the original CSV dataset engine on the retained typed-text projection; its actual snapshot and cursor semantics are preserved.',{edition:hash,query:{type:'string',maxLength:8192}},['edition'],read),
    scoped('merchant_hdf5_file','Resolve and verify an exact edition member; returns its original byte count and SHA-256.',{edition:hash,name:{enum:['source.h5','values.jsonl','array.json','dataset.csv','dataset.json','edition.json']}},['edition','name'],read),
    scoped('merchant_hdf5_file_read','Read up to262144 bytes from an exact retained member, with whole-file verification and an independent range SHA. The full-file hash is checked on every request.',{edition:hash,name:text,offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:262144}},['edition','name'],read),
    scoped('merchant_hdf5_export','Create or reopen the complete original source/selection/result packet in this host-owned delivery directory.',{operation:id,edition:hash},['operation','edition'],write),
    scoped('merchant_hdf5_receive','Verify the selected whole packet SHA and independently reconstruct its exact native result before adopting historical source and edition records.',{operation:id,archive_path:text,expected_sha:hash},['operation','archive_path','expected_sha'],write),
    scoped('merchant_hdf5_operation','Read the original request, state, error and completion by operation ID.',{ident:id},['ident'],read),
    scoped('merchant_hdf5_resume','Resume only the exact retained original operation; no new source path, selection, destination or payment is invented.',{ident:id},['ident'],write),
    scoped('merchant_hdf5_cancel','Request cancellation before adoption begins. Committing work reports its current state and must be reconciled to its retained result.',{operation:id},['operation'],write),
    scoped('merchant_hdf5_delivery','Verify the exact complete packet produced by its original export operation.',{operation:id},['operation'],read),
    scoped('merchant_hdf5_publisher_prepare','Prepare the exact HDF5 edition in the original dataset publisher with explicitly configured payment terms. Retains complete truthful HDF5 source files; opens no seller or payer.',{edition:hash,payment:any,origin:text,path:text},['edition','payment','origin'],write),
    scoped('merchant_hdf5_publisher','Invoke the existing native dataset publisher/release/customer action with original snapshot, revision, generation, offer and session guards. Buyer workspace remains host configured.',{action:text,payload:any},['action','payload'],{openWorld:true}),
    scoped('merchant_hdf5_publisher_state','Read the original publisher, drafts, releases and customer sessions.',{},[],read),
    scoped('merchant_hdf5_publisher_export','Retain an exact original completed customer/draft export and return its checked native file identity.',{kind:{enum:['draft-csv','draft-review','buyer-config','session-manifest','session-csv','session-jsonl','session-review']},id:text},['kind','id'],write)
  ];
}
