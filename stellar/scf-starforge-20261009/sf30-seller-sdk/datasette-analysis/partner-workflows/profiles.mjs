/** Bind complete prepared tables to the maintained Datasette/Analysis worker. */
import { csv, canonical, SCHEMA } from "./preparation.mjs";
function requireValue(ok,code){if(!ok)throw new Error(code);}
export function preparedFiles(result,sha) {
  requireValue(result.schema===SCHEMA,"PREPARATION_SCHEMA_INVALID");
  const descriptors=[],files=[];
  for(const [name,rows] of Object.entries(result.tables)) {
    const columns=rows.length?Object.keys(rows[0]):
      result.kind==="odoo-contact-import-preparation"&&["companies","people"].includes(name)?result.summary.importHeaders:
      name==="exceptions"?["scope","source_id","code","detail"]:
      name==="transactions"?["source_row","transaction_id","payout_id","order_id","order_name","transaction_type","role","test","transaction_date","source_id","source_type","gross","fee","net","currency","adjustment_reason","adjustments_orders_json","review_state"]:
      name==="payouts"?["payout_id","currency","test","transaction_count","parsed_net_count","contribution_net","transfer_net","unclassified_net","source_payout_net","payout_status","payout_direction","arithmetic_difference","review_state"]:
      name==="orders"?["source_row","order_id","name","transaction_references","review_state"]:
      name==="reconciliation"?["source_id","external_id","kind","expected_parent","actual_parent","action","review_state","expected_fields_json","actual_fields_json"]:
      ["source_row","source_id","kind","external_id","parent_external_id","action",...result.summary.ownedFields,"review_state"];
    const content=csv(rows,columns),path=name+".csv";
    files.push({path,content,contentType:"text/csv; charset=utf-8"});
    descriptors.push({name,path,columns,rows:rows.length,sha256:sha(content)});
  }
  files.push({path:"preparation.json",content:canonical(result)+"\n",contentType:"application/json"});
  return {files,tables:descriptors};
}
export function nativeProfile(result,tableDescriptors,installation) {
  const {directory,analysisWorkspace,operationId,parser,sourceArchive}=installation;
  requireValue([directory,analysisWorkspace,parser,sourceArchive].every(v=>typeof v==="string"&&v.startsWith("/")&&!v.includes("\0")),"ABSOLUTE_INSTALLATION_PATHS_REQUIRED");
  requireValue(/^[a-f0-9]{32}$/.test(operationId),"ORIGINAL_ANALYSIS_OPERATION_ID_REQUIRED");
  requireValue(result.schema===SCHEMA && tableDescriptors.length>=4&&tableDescriptors.length<=5,"COMPLETE_NATIVE_PREPARATION_REQUIRED");
  const main=result.kind==="retail-payout-reconciliation"?"transactions":"mapping";
  const source=(t)=>({kind:"csv",path:directory+"/"+t.path,parser,key:[],analysisPrefix:t.name,
    metadata:{path:directory+"/original-metadata.json"},
    source:{provenance_kind:"operator-file",publisher:result.source.publisher,url:result.source.url,
      title:result.source.title+" — prepared "+t.name,
      publisherEdition:result.preparationSha256,
      capture_time_basis:"retained-original-input-transformation"}});
  const sources=Object.fromEntries(tableDescriptors.map(t=>[t.name,source(t)]));
  const queries=tableDescriptors.map(t=>({name:"prepared_"+t.name,title:t.name.replace(/_/g," "),
    sql:"SELECT * FROM {{source:"+t.name+"}}",parameterNames:[],maxRows:100000,
    note:t.name==="exceptions"?"Every exception keeps its original source identity and concrete cause.":
      "Complete prepared table; original input, field ownership, transformations and source selection travel in the publisher metadata."}));
  if(result.kind==="retail-payout-reconciliation"){
    queries.push({name:"selected_payout",title:"Selected payout review",
      sql:"SELECT * FROM {{source:transactions}} WHERE {{column:transactions:payout_id}} = ?",
      parameterNames:["payoutId"],maxRows:100000,note:"The business request selects an original payout ID. Other payout and source records remain retained in the complete result."});
  } else {
    queries.push({name:"selected_source",title:"Selected original contact review",
      sql:"SELECT * FROM {{source:mapping}} WHERE {{column:mapping:source_id}} = ?",
      parameterNames:["sourceId"],maxRows:100000,note:"Both original source IDs and their stable target External IDs stay visible. Companies are imported before people using the existing Odoo operator."});
  }
  return {schema:"stellar-forge.source-workflow-configuration.v1",profile:result.kind,
    sourceAlias:main,source:sources[main],relatedSources:Object.fromEntries(Object.entries(sources).filter(([k])=>k!==main)),
    sourceArchive,analysis:{workspace:analysisWorkspace,operationId,prefix:main,
      queries,report:{title:result.kind.replace(/-/g," "),introduction:result.source.title+"\nOriginal selection: "+result.source.selection+"\nPrepared source: "+result.preparationSha256,
      note:"Complete original input and editable transformation accompany all native source versions, queries, report and receiving archive."},waitSeconds:3600},
    delivery:{queryFormats:["csv","jsonl","sqlite"]}};
}
