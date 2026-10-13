// MIT. Source-owned operations over the original webhook store and customer snapshot.
import {PREFIX,ID,SHA,plain,need,exact} from './contracts.mjs';
const alias={type:'string',pattern:ID.source},sha={type:'string',pattern:SHA.source};
const workspace={workspace:alias},snapshot={...workspace,exportId:alias};
const revision={type:['string','null'],pattern:SHA.source};
const definitions=[
 ['workspaces','List configured original webhook workspaces and receiving destinations.',{},[],true],
 ['state','Read original source, feed, merchant, event and active listener state.',workspace,['workspace'],true],
 ['source_save','Save the complete signed-source definition against its reviewed revision.',{...workspace,definition:{type:'object'},expectedRevision:revision},['workspace','definition'],false],
 ['feed_save','Save the complete feed projection and filters against its reviewed revision.',{...workspace,definition:{type:'object'},expectedRevision:revision},['workspace','definition'],false],
 ['events','Page the original accepted event identities and delivery-attempt history.',{...workspace,after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200},sourceId:alias},['workspace'],true],
 ['event','Inspect one original accepted body, exact source hash and delivery identity.',{...workspace,sequence:{type:'integer',minimum:1}},['workspace','sequence'],true],
 ['preview','Read a reviewed feed using its original authenticated high-water cursor.',{...workspace,feedId:alias,cursor:{type:'string',maxLength:4096},limit:{type:'integer',minimum:1,maximum:200}},['workspace','feedId'],true],
 ['plan_save','Save exact original SF30 merchant terms after native service compilation.',{...workspace,plan:{type:'object'},expectedRevision:revision},['workspace','plan'],false],
 ['release','Prepare the original SF30 seller service, handlers and customer release files.',{...workspace,name:alias},['workspace','name'],false],
 ['snapshot','Capture the original consistent SQLite backup with event, retry and cursor identities.',{...workspace,name:alias},['workspace','name'],false],
 ['manifest','Read complete customer download metadata and the original snapshot identities.',snapshot,['workspace','exportId'],true],
 ['file','Read an exact immutable original customer file range for complete receiving.',{...snapshot,file:{type:'string',enum:['download.json','snapshot.json','events.sqlite']},expectedManifestSha256:sha,expectedSha256:sha,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608},readId:{type:'string',maxLength:64}},['workspace','exportId','file','expectedManifestSha256','expectedSha256'],true],
 ['file_release','Release the native retained file descriptor for this customer download.',{...snapshot,readId:{type:'string',maxLength:64}},['workspace','exportId','readId'],false],
 ['receive','Restore the full original snapshot into a configured receiving workspace and preserve later customer edits on replay.',{...snapshot,receiver:alias,expectedManifestSha256:sha},['workspace','exportId','receiver','expectedManifestSha256'],false],
 ['retention','Apply the reviewed original event-body boundary using its current high-water guard.',{...workspace,throughSequence:{type:'integer',minimum:0},expectedHighWatermark:{type:'integer',minimum:0}},['workspace','throughSequence','expectedHighWatermark'],false]
];
export const webhookFeedDefinitions=Object.freeze(definitions.map(([action,description,properties,required,readOnly])=>Object.freeze({name:PREFIX+action,action,description,properties,required,readOnly})));
function valid(schema,value){
 if(Array.isArray(schema.type))return schema.type.some(type=>valid({...schema,type},value));
 if(schema.type==='null')return value===null;
 if(schema.type==='object')return plain(value);
 if(schema.type==='integer')return Number.isSafeInteger(value)&&(schema.minimum===undefined||value>=schema.minimum)&&(schema.maximum===undefined||value<=schema.maximum);
 if(schema.type==='string')return typeof value==='string'&&value.length>0&&(schema.maxLength===undefined||value.length<=schema.maxLength)&&(!schema.pattern||new RegExp(schema.pattern).test(value))&&(!schema.enum||schema.enum.includes(value));
 return false;
}
export function validateWebhookArguments(name,args={}){
 need(typeof name==='string','WEBHOOK_OPERATIONS_UNKNOWN_TOOL');const action=name.startsWith(PREFIX)?name.slice(PREFIX.length):name,definition=webhookFeedDefinitions.find(item=>item.action===action);
 need(definition,'WEBHOOK_OPERATIONS_UNKNOWN_TOOL');exact(args,Object.keys(definition.properties),definition.required);
 for(const [key,value]of Object.entries(args))need(valid(definition.properties[key],value),'WEBHOOK_OPERATIONS_INVALID_INPUT','Invalid '+key+' for '+action+'.');
 need(Buffer.byteLength(JSON.stringify(args))<=1024*1024,'WEBHOOK_OPERATIONS_REQUEST_TOO_LARGE');return action;
}
export function webhookFeedTools(tool){return webhookFeedDefinitions.map(item=>tool(item.name,item.description,item.properties,item.required,{readOnly:item.readOnly,idempotent:item.readOnly||['receive','file_release'].includes(item.action),openWorld:false}));}
