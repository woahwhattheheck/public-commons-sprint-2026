// MIT. Domain tool contracts for the two maintained Carbon applications.
export const KINDS=['stellarcarbon','givecredit'];
export const ACTIONS={
 stellarcarbon:['customer','project','assignment','statement','settings','invoice'],
 givecredit:['payment-link','allocation','bridge','statement','settings','carry-payment-links']
};
export const VIEWS={
 state:{keys:[],required:[]},edition:{keys:['editionId'],required:['editionId']},
 table:{keys:['editionId','table','offset','limit'],required:['editionId','table']},
 statement:{keys:['id','version'],required:['id']},compare:{keys:['beforeId','afterId'],required:['beforeId','afterId']},
 contributions:{kind:'stellarcarbon',keys:['editionId','customerId','projectId','fromDate','beforeDate','cursor','limit'],required:['editionId']},
 contribution:{kind:'stellarcarbon',keys:['editionId','hash'],required:['editionId','hash']},
 retirements:{kind:'stellarcarbon',keys:['editionId','customerId','projectId','fromDate','beforeDate','cursor','limit'],required:['editionId']},
 retirement:{kind:'stellarcarbon',keys:['editionId','certificateId'],required:['editionId','certificateId']},
 choices:{kind:'givecredit',keys:['registryEditionId','ledgerEditionId','carbonEditionId','payoutKey'],required:[]},
 donations:{kind:'givecredit',keys:['editionId','ledgerEditionId','organizationId','initiativeId','donorAddress','fromDate','beforeDate','search','offset','limit'],required:['editionId']},
 donation:{kind:'givecredit',keys:['editionId','ledgerEditionId','id'],required:['editionId','id']},
 transfers:{kind:'givecredit',keys:['editionId','kind','address','fromDate','beforeDate','offset','limit','search'],required:['editionId']},
 transfer:{kind:'givecredit',keys:['editionId','key'],required:['editionId','key']},
 pools:{kind:'givecredit',keys:['editionId','contractId','fromDate','beforeDate'],required:['editionId']}
};
export const STATEMENT_FILES={
 stellarcarbon:['statement.json','statement.html','contributions.csv','allocations.csv','retirements.csv'],
 givecredit:['statement.json','statement.html','donations.csv','payments.csv','payout-funding.csv','carbon-contributions.csv','carbon-allocations.csv','retirement-register.csv','receipt-records.csv']
};
export const IMPORTS={
 stellarcarbon:['source','backup-files','retained'],
 givecredit:['source','registry-files','carbon-source','carbon-retained']
};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'};
const object={type:'object',additionalProperties:true};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const integer={type:'integer',minimum:0};
const source={sourceWorkspace:{...alias,description:'Open source workspace alias for a retained export; defaults to this workspace.'},sourceFile:{...alias,description:'Configured complete original JSON file alias.'},sourceExport:{...id,description:'Previously retained complete export ID in this workspace.'}};
const options={requestId:id,revision:integer,actor:{type:'string',minLength:1,maxLength:300}};
export function carbonCustomerTools(tool){
 const workspace={workspace:alias};
 return [
 tool('merchant_carbon_workspaces','List original Carbon customer desks, source-file aliases and independent receiver aliases.',{},[]),
 tool('merchant_carbon_contract','Return complete original action/preview schemas, source formats, paged view keys and export names for this application.',workspace,['workspace']),
 tool('merchant_carbon_open','Attach to the selected current Applications listener or own the original native server; return its exact instance and current revision.',workspace,['workspace']),
 tool('merchant_carbon_view','Read the original source/customer/donor/statement view. Continue native cursors or offsets until terminal; large complete results return a retained file.',{...workspace,view:{type:'string',enum:Object.keys(VIEWS)},query:object},['workspace','view']),
 tool('merchant_carbon_preview','Review a complete statement, funding allocation or payout-to-sink bridge using the existing engine before saving.',{...workspace,kind:{type:'string',enum:['statement','allocation','bridge']},value:object},['workspace','kind','value']),
 tool('merchant_carbon_save','Save a full original customer/project/assignment, donor-payment link, funding allocation, frozen bridge, statement version or service invoice. Use exact original revision and stable requestId; records being edited include id and expectedVersion.',{...workspace,action:{type:'string',enum:[...new Set(Object.values(ACTIONS).flat())]},value:object,...options},['workspace','action','value','requestId','revision','actor']),
 tool('merchant_carbon_import','Receive a complete retained source edition or original table-file envelope through the native importer. Original inputs are retained byte-for-byte before saving.',{...workspace,format:{type:'string',enum:[...new Set(Object.values(IMPORTS).flat())]},...source,label:{type:'string',minLength:1,maxLength:300},metadata:object,network:{type:'string',enum:['mainnet','testnet']},...options},['workspace','format','label','requestId','revision','actor']),
 tool('merchant_carbon_capture','Start or inspect the exact retained acquisition. Capture options can come from a configured complete private file, including the existing API key; no credential is returned in tool output. Native checkpoints preserve original selection.',{...workspace,command:{type:'string',enum:['start','status','stop']},kind:{type:'string',enum:['api','registry','ledger']},value:object,sourceFile:alias,label:{type:'string'},...options},['workspace','command','kind']),
 tool('merchant_carbon_checkpoint','Receive or export a complete native registry/ledger checkpoint. Receiving validates its original source kind before replacing the progress manifest.',{...workspace,command:{type:'string',enum:['import','export']},kind:{type:'string',enum:['registry','ledger']},...source,exportId:id,...options},['workspace','command','kind']),
 tool('merchant_carbon_receive','Receive a whole saved handover into a configured independent destination. Keep the original receive ID; reopen the returned receiver alias and edit it independently.',{...workspace,destination:alias,...source,requestId:id},['workspace','destination','requestId']),
 tool('merchant_carbon_operation','Inspect the saved agent intent, actual native operation result and retained response identities after an uncertain return.',{...workspace,requestId:id},['workspace','requestId']),
 tool('merchant_carbon_resume','Continue the exact saved agent operation. A live source capture is observed rather than restarted; a completed native mutation replays its original request ID.',{...workspace,requestId:id},['workspace','requestId']),
 tool('merchant_carbon_export','Retain complete source, original response/table, statement HTML/JSON/CSV, comparison or whole editable handover. Select one saved statement version explicitly.',{...workspace,exportId:id,kind:{type:'string',enum:['source','source-file','statement','comparison','handover']},editionId:{type:'string'},name:{type:'string'},fileIndex:integer,statementId:{type:'string'},version:{type:'integer',minimum:1},beforeId:{type:'string'},afterId:{type:'string'}},['workspace','exportId','kind']),
 tool('merchant_carbon_file_read','Read every retained byte using exact offsets and SHA256; after restart reuse exportId/SHA/offset without the previous readId.',{...workspace,exportId:id,readId:{type:'string'},expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},offset:integer,limit:{type:'integer',minimum:1,maximum:196608}},['workspace','exportId']),
 tool('merchant_carbon_file_release','Release one retained file descriptor.',{...workspace,readId:{type:'string'}},['workspace','readId']),
 tool('merchant_carbon_close','Close the exact returned instance. Managed attachments detach; an owned service drains only its original capture/workspace resources.',{...workspace,instanceId:{type:'string',pattern:'^[a-f0-9]{32}$'}},['workspace','instanceId'])
 ];
}
