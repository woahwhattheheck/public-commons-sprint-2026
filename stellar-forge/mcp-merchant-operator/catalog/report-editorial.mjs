// MIT. Original report-editorial host operations and bounded complete-file controls.
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
import {need,plain,REPORT_REVIEW_ID,REPORT_REVIEW_SHA,REPORT_REVIEW_ALIAS} from '../report-editorial-records.mjs';
export const PREFIX='merchant_report_editorial_';
export const HTTP_BYTES=1024*1024+65536;
const match=p=>({type:'string',pattern:p.source}),id=match(REPORT_REVIEW_ID),sha=match(REPORT_REVIEW_SHA);
const workspace={workspace:match(REPORT_REVIEW_ALIAS)},text=max=>({type:'string',maxLength:max});
const page={before:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:100}};
const object={type:'object',additionalProperties:true},issue={...workspace,issueId:id},upload={...workspace,uploadId:id};
const selected={...workspace,exportId:sha};
const rows=[
['connections','List original host-declared Analysis report-review workspaces.',{},[],true],
['state','Read the original Analysis workspace identity and current report/job selectors.',workspace,['workspace'],true],
['history','Read one compact native issue page; continue next_before.',{...workspace,...page},['workspace'],true],
['detail','Retain the full original issue and one page each of return/application history.',{...issue,returns_before:{type:'integer',minimum:1},applies_before:{type:'integer',minimum:1},limit:page.limit},['workspace','issueId'],true],
['issue','Retain the complete original request, issue the selected actual report and capture full recipient files.',{...workspace,request:object},['workspace','request'],false],
['return_begin','Retain original return upload intent for the exact issue and full file hash.',{...upload,issueId:id,issueSha256:sha,bytes:{type:'integer',minimum:1,maximum:16*1024*1024},sha256:sha},['workspace','uploadId','issueId','issueSha256','bytes','sha256'],false],
['return_status','Read the same upload intent and verified locally available byte prefix.',upload,['workspace','uploadId'],true],
['return_chunk','Retain an immutable original 64KiB return fragment; replay exact offset/hash after interruption.',{...upload,offset:{type:'integer',minimum:0},base64:text(87384),sha256:sha},['workspace','uploadId','offset','base64','sha256'],false],
['return_receive','Receive the complete verified original return through the existing native model; same identity on retry.',upload,['workspace','uploadId'],false],
['returned','Capture the complete original returned record and recipient source package.',{...workspace,returnId:id},['workspace','returnId'],true],
['preview','Capture the complete original/current/returned comparison before explicit apply.',{...workspace,returnId:id,mapping:{anyOf:[{type:'null'},{type:'array',maxItems:64,items:{anyOf:[{type:'integer',minimum:0},{type:'null'}]}}]}},['workspace','returnId'],true],
['apply','Retain exact reviewed choices then invoke the original report save. Reuse request ID after uncertain reply.',{...workspace,returnId:id,request:object},['workspace','returnId','request'],false],
['status','Capture the original native application outcome without another save.',{...workspace,applyId:id},['workspace','applyId'],true],
['export','Capture the full original package/HTML and selected retained return/application records.',{...issue,issueSha256:sha,returnId:id,applyId:id},['workspace','issueId','issueSha256'],true],
['manifest','Read a complete retained report editorial delivery, also after native Analysis closes.',selected,['workspace','exportId'],true],
['file','Read the exact retained member through EOF with original hashes and read ID.',{...selected,file:text(200),expectedManifestSha256:sha,expectedSha256:sha,readId:text(128),offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','exportId','file','expectedManifestSha256','expectedSha256'],true],
['file_release','Release this original complete-file reader.',{...selected,readId:text(128)},['workspace','exportId','readId'],false]
];
export const definitions=rows.map(([action,description,properties,required,readOnly])=>({action,name:PREFIX+action,description,properties,required,readOnly}));
function accepted(schema,value){
  if(schema.anyOf)return schema.anyOf.some(s=>accepted(s,value));
  if(schema.type==='null')return value===null;
  if(schema.type==='boolean')return typeof value==='boolean';
  if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
  if(schema.type==='integer')return Number.isSafeInteger(value)&&value>=(schema.minimum??0)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER);
  if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Infinity)&&(!schema.uniqueItems||new Set(value).size===value.length)&&value.every(v=>accepted(schema.items,v));
  if(schema.type==='object')return plain(value)&&Object.keys(value).length<=(schema.maxProperties??Infinity)&&(schema.required??[]).every(k=>Object.hasOwn(value,k))&&Object.entries(value).every(([k,v])=>
    (!schema.propertyNames||accepted({type:'string',...schema.propertyNames},k))&&(schema.properties?.[k]?accepted(schema.properties[k],v):schema.additionalProperties===false?false:plain(schema.additionalProperties)?accepted(schema.additionalProperties,v):true));
  return false;
}
export function validateReportEditorialArguments(name,args){
 const entry=definitions.find(x=>x.name===name);
 need(entry&&accepted({type:'object',properties:entry.properties,required:entry.required,additionalProperties:false},args),'Use the declared complete report editorial arguments.');
 need(Buffer.byteLength(JSON.stringify(args))<=HTTP_BYTES-1024,'Use original return fragments for large files; keep the complete bounded request.');
 return entry.action;
}
export function reportEditorialTools(tool){return definitions.map(x=>tool(x.name,x.description,x.properties,x.required,{readOnly:x.readOnly,idempotent:true,openWorld:false}));}
