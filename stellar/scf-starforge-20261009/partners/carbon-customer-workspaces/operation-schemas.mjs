// MIT. Complete operator input shapes; the native engines remain authoritative.
const str={type:'string'},amount={type:'string',pattern:'^-?[0-9]+(?:\\.[0-9]+)?$'},atoms={type:'string',pattern:'^[0-9]+$'},date={type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const revision={type:'integer',minimum:1},record={id:str,expectedVersion:revision,active:{type:'boolean'}};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const list=items=>({type:'array',items});
const statementCommon={id:str,expectedVersion:revision,title:str,fromDate:date,beforeDate:date,note:str};
const customer=object({...record,name:str,reference:str,note:str,merchantCustomerId:{type:['string','null']}},['name']);
const project=object({...record,customerId:str,name:str,reference:str,note:str},['customerId','name']);
const assignment=object({...record,kind:{enum:['TRANSACTION','RECIPIENT','FUNDER']},value:str,customerId:str,projectId:{type:['string','null']},fromDate:date,beforeDate:date,note:str},['kind','value','customerId']);
const carbonStatement=object({...statementCommon,editionId:str,customerId:{type:['string','null']},projectId:{type:['string','null']}},['title','editionId','fromDate','beforeDate']);
const donorStatement=object({...statementCommon,basis:{enum:['REGISTRY_CREATED','LEDGER_CLOSED']},registryEditionId:{type:['string','null']},ledgerEditionId:{type:['string','null']},carbonEditionId:{type:['string','null']},organizationId:{type:['string','null']},initiativeId:{type:['string','null']},donorAddress:{type:['string','null']}},['title','basis','fromDate','beforeDate']);
const payment=object({...record,registryEditionId:str,ledgerEditionId:str,donationId:str,paymentKey:str,amountAtoms:atoms,receiptId:{type:['string','null']},note:str},['registryEditionId','ledgerEditionId','donationId','paymentKey','amountAtoms','note']);
const allocation=object({...record,ledgerEditionId:str,payoutKey:str,method:{enum:['PROPORTIONAL_GROSS','FIFO_GROSS','EXPLICIT']},name:str,note:str,paymentKeys:list(str),
 parts:list(object({paymentKey:str,amountAtoms:atoms},['paymentKey','amountAtoms'])),
 capacities:list(object({paymentKey:str,amountAtoms:atoms,note:str},['paymentKey','amountAtoms'])),
 ordering:list(object({paymentKey:str,precedesPayout:{type:'boolean'},rank:{type:['integer','string']},note:str},['paymentKey','note'])),
 confirmProviderPayout:{type:'boolean'},classificationNote:str},['ledgerEditionId','payoutKey','method']);
const bridge=object({...record,ledgerEditionId:str,carbonEditionId:str,payoutKey:str,allocationId:str,sinkHash:str,paymentAtoms:atoms,carbonAmount:amount,note:str},['ledgerEditionId','carbonEditionId','payoutKey','allocationId','sinkHash','paymentAtoms','carbonAmount','note']);
const settings=object({name:str},['name']);
const invoice=object({statementId:str,statementVersion:revision,amount,currency:object({code:str,scale:{type:'integer',minimum:0}},['code','scale']),issueDate:date,dueDate:date,taxAmount:amount,note:str},['statementId','amount','currency','issueDate','dueDate']);
const carry=object({fromRegistryEditionId:str,toRegistryEditionId:str,fromLedgerEditionId:str,toLedgerEditionId:str},['fromRegistryEditionId','toRegistryEditionId','fromLedgerEditionId','toLedgerEditionId']);
export const OPERATION_SCHEMAS={stellarcarbon:{customer,project,assignment,statement:carbonStatement,settings,invoice},
 givecredit:{'payment-link':payment,allocation,bridge,statement:donorStatement,settings,'carry-payment-links':carry}};
export const PREVIEW_SCHEMAS={stellarcarbon:{statement:carbonStatement},givecredit:{statement:donorStatement,allocation,bridge}};
