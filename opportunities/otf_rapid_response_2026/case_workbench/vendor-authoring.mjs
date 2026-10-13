/* MIT. Original-preserving authoring for the maintained OTF vendor schema. */
import {check,render} from "../vendor_submission_20261011/vendor-core.mjs";
import {VENDOR_SECTIONS} from "./vendor-authoring-forms.mjs";
import {buildVendorBudget,sha256} from "./issuer-budget-browser.mjs";
import {validateVendorAttachmentsAsync} from "../vendor_submission_20261011/vendor-attachments.mjs";
const fields=VENDOR_SECTIONS.flatMap(section=>section.fields);
const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function object(value,label){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(label+" must be an object");return value;}
function copy(value){return JSON.parse(JSON.stringify(value));}
function defaultValue(field){if(field.type==="object")return Object.fromEntries(field.fields.filter(f=>!f.optional).map(f=>[f.name,defaultValue(f)]));if(field.type==="array")return [];if(field.type==="boolean")return false;if(field.type==="money")return null;return "";}
function completeField(value,field,path){
 if(value===undefined)return defaultValue(field);
 if(field.type==="object"){object(value,path);const result={...value};for(const f of field.fields){if(!has(result,f.name)&&f.optional)continue;result[f.name]=completeField(result[f.name],f,path+"."+f.name);}return result;}
 if(field.type==="array"){if(!Array.isArray(value))throw new Error(path+" must be an array");return value.map((row,i)=>completeField(row,{type:"object",fields:field.fields},path+"["+i+"]"));}
 return value;
}
export function createVendorDraft(original={}){
 const result=copy(object(original,"Vendor input"));
 for(const field of fields)result[field.name]=completeField(result[field.name],field,field.name);
 return result;
}
export function formatVendorUSD(cents){
 if(cents===null||cents===undefined)return "";
 if(!Number.isSafeInteger(cents)||cents<0)throw new Error("Imported amount must be nonnegative integer USD cents");
 return Math.floor(cents/100)+"."+String(cents%100).padStart(2,"0");
}
export function parseVendorUSD(value,{label="USD amount",optional=false,positive=false,max=Number.MAX_SAFE_INTEGER}={}){
 if(value===undefined||value===null||value==="")return optional?undefined:null;
 if(typeof value!=="string")throw new Error(label+" must be entered as USD text");
 const text=value.trim();if(!text)return optional?undefined:null;
 if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text))throw new Error(label+" must use plain USD digits with at most two decimal places");
 const [whole,fraction=""]=text.split("."),cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 if(!Number.isSafeInteger(cents)||cents<0||cents>max||(positive&&cents===0))throw new Error(label+" is outside its permitted USD range");
 return cents;
}
function editValues(value,field){
 if(field.type==="money")return formatVendorUSD(value);
 if(field.type==="object"){const result={...value};for(const f of field.fields){if(has(result,f.name))result[f.name]=editValues(result[f.name],f);}return result;}
 if(field.type==="array")return value.map(row=>editValues(row,{type:"object",fields:field.fields}));
 return value;
}
export function readVendorFields(draft){
 const result=createVendorDraft(draft);
 for(const field of fields)result[field.name]=editValues(result[field.name],field);
 return result;
}
function applyField(base,value,field,path){
 if(field.type==="object"){object(value,path);const result={...object(base??{},path),...value};for(const f of field.fields){if(!has(value,f.name))continue;const next=applyField(base?.[f.name],value[f.name],f,path+"."+f.name);if(next===undefined)delete result[f.name];else result[f.name]=next;}return result;}
 if(field.type==="array"){if(!Array.isArray(value))throw new Error(path+" must be an array");if(field.maxItems&&value.length>field.maxItems)throw new Error(field.label+" permits at most "+field.maxItems+" rows");return value.map((row,i)=>{object(row,path+"["+i+"]");for(const f of field.fields)if(!f.optional&&!has(row,f.name))throw new Error(path+"["+i+"]: repeated rows are complete replacements; missing "+f.name);return applyField({},row,{type:"object",fields:field.fields},path+"["+i+"]");});}
 if(field.type==="money")return parseVendorUSD(value,{label:field.label,optional:field.optional,positive:field.name!=="otherDirectCostsCents",max:field.name.endsWith("HourlyCents")?100000000:15000000});
 if(value===undefined&&field.optional)return undefined;
 if(field.type==="boolean"){if(typeof value!=="boolean")throw new Error(path+" must be a recorded true / false value");return value;}
 if(typeof value!=="string")throw new Error(path+" must be text");
 if(field.optional&&!value.trim())return undefined;
 if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))throw new Error(path+" contains unsupported control characters");
 if(field.type==="select"&&value&&!field.options.includes(value))throw new Error(path+" has an unsupported selection");
 return value;
}
export function applyVendorFields(draft,values){
 object(values,"Edited fields");const result=createVendorDraft(draft);
 for(const field of fields)if(has(values,field.name))result[field.name]=applyField(result[field.name],values[field.name],field,field.name);
 return copy(result);
}
export function exportVendorDraft(draft){const text=JSON.stringify(object(draft,"Vendor draft"),null,2)+"\n";if(new TextEncoder().encode(text).length>25165824)throw new Error("Complete editable vendor input exceeds the case workbook’s 24 MiB source-file capacity; reduce selected attachment bytes before exporting");return text;}
export async function reviewVendorDraft(draft){
 const input=copy(object(draft,"Vendor draft")),base=check(input);let budget=null,budgetError=null;
 try{budget=await buildVendorBudget(input);}catch(error){budgetError=error.message;}
 const quality={needs:[...new Set([...base.needs,...(budget?.mapping.missing??[])])],warnings:[...base.warnings,...(budgetError?["Original issuer workbook: "+budgetError]:[])]};
 const submissionIssues=[];let submissionMarkdown=null,attachmentResult={files:[],manifest:[]};
 try{attachmentResult=await validateVendorAttachmentsAsync(input,sha256);}catch(error){submissionIssues.push("Outgoing attachment: "+error.message);}
 const internalMarkdown=render(input,quality,{audience:"internal"});
 if(quality.needs.length||quality.warnings.length)submissionIssues.push(...quality.needs,...quality.warnings);
 else if(submissionIssues.length===0){try{submissionMarkdown=render(input,quality,{audience:"submission",attachments:attachmentResult.manifest});}catch(error){submissionIssues.push(error.message);}}
 return {quality,internalMarkdown,submissionMarkdown,submissionIssues,budget,budgetError,attachmentResult,contentComplete:quality.needs.length===0&&quality.warnings.length===0,submissionComplete:submissionMarkdown!==null};
}
export async function prepareVendorDraft(draft){
 const input=copy(object(draft,"Vendor draft")),review=await reviewVendorDraft(input),encoder=new TextEncoder();
 const textFile=(name,type,text)=>({name,media_type:type,bytes:encoder.encode(text)});
 const files=[textFile("vendor-input.json","application/json",exportVendorDraft(input)),textFile("proposal-review.md","text/markdown",review.internalMarkdown),textFile("readiness.json","application/json",JSON.stringify({schema:"commons.otf-vendor-authoring-readiness.v1",quality:review.quality,contentComplete:review.contentComplete,submissionComplete:review.submissionComplete,submissionIssues:review.submissionIssues},null,2)+"\n")];
 if(review.budget){files.push({name:review.budget.mapping.output.file,media_type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",bytes:review.budget.bytes},textFile("budget-mapping.json","application/json",JSON.stringify(review.budget.mapping,null,2)+"\n"));}
 for(const attachment of review.attachmentResult.files)files.push({name:attachment.name,media_type:attachment.media_type,bytes:attachment.bytes});
 if(review.submissionMarkdown)files.push(textFile("proposal-submission.md","text/markdown",review.submissionMarkdown));
 const submissionFiles=review.submissionComplete?files.filter(file=>file.name==="proposal-submission.md"||file.name===review.budget.mapping.output.file||review.attachmentResult.files.some(attachment=>attachment.name===file.name)):[];
 return {draft:input,review,files,submissionFiles};
}
