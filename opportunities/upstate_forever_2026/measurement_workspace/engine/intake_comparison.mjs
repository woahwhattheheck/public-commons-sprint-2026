/** Same-original-file interpretation comparison. Scientific parsing stays in normalise.mjs. */
import {hash,stable,parseSource} from './normalise.mjs';
import {InputError,parseCSV,SOURCE_LINE_EDITION} from './parse.mjs';
export const COMPARISON_FORMAT='upper-savannah-intake-comparison/v1';
export const MAX_COMPARISON_BYTES=128*1024*1024;
const fail=s=>{throw new InputError(s);};
const cell=(o,k)=>Object.hasOwn(o,k)?{present:true,value:o[k]}:{present:false};
function changes(a,b){return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().filter(k=>stable(cell(a,k))!==stable(cell(b,k))).map(field=>({field,before:cell(a,field),after:cell(b,field)}));}
function parsed(value,text,lineEndings){
 try{
  const p=parseSource({kind:value.kind,text,mapping:value.mapping,lineEndings}),rows=new Map();
  for(const x of p.rows){if(rows.has(x.line))fail('Original parser returned two occurrences on one source line.');rows.set(x.line,{status:'accepted',row:x.row});}
  for(const x of p.rejected){if(rows.has(x.line))fail('Original parser returned two outcomes on one source line.');const {line,...details}=x;rows.set(line,{status:'rejected',...details});}
  return {mapping:p.mapping,headers:p.headers,accepted:p.rows.length,rejected:p.rejected.length,error:null,rows};
 }catch(e){if(!(e instanceof InputError))throw e;return {mapping:null,headers:[],accepted:0,rejected:0,error:e.message,rows:null};}
}
function originalRows(kind,text){
 if(kind==='usgs-daily'){const d=JSON.parse(text);return Array.isArray(d?.features)?d.features.map((raw,i)=>({line:i+1,raw})):[];}
 // Parse through the original scientific source projection where possible. On a
 // whole-preparation error, raw row enumeration is supplied by the original CSV reader.
 return null;
}
export function buildIntakeComparison(project,beforeRevision,afterRevision,{lineEndings='physical'}={}){
 if(!['physical','legacy'].includes(lineEndings))fail('Unknown CSV source-line interpretation');
 if(!project||!Array.isArray(project.editions)||!Array.isArray(project.sources))fail('Use the complete original preparation history.');
 const ids=[...new Set(project.editions.map(e=>e.id))];
 if(ids.length!==1)fail('Select one complete preparation history.');
 if(!Number.isSafeInteger(beforeRevision)||!Number.isSafeInteger(afterRevision)||beforeRevision<1||afterRevision<1||beforeRevision===afterRevision)fail('Choose two different saved preparation revisions.');
 const before=project.editions.find(e=>e.revision===beforeRevision),after=project.editions.find(e=>e.revision===afterRevision);
 if(!before||!after)fail('A selected saved preparation revision is absent.');
 if(before.value.kind!==after.value.kind||before.value.sourceSha!==after.value.sourceSha)fail('Compare interpretations of the SAME original file and source type. Different source bytes are not aligned by row number.');
 const file=project.sources.find(x=>x.sha===before.value.sourceSha);
 if(!file||typeof file.text!=='string'||hash(file.text)!==file.sha)fail('The complete original file differs from its saved identity.');
 const a=parsed(before.value,file.text,lineEndings),b=parsed(after.value,file.text,lineEndings);
 let raw;
 const available=a.rows||b.rows;
 try{if(available){raw=[...available].map(([line,outcome])=>outcome.status==='accepted'?{line,raw:outcome.row.raw}:{line,...Object.fromEntries(Object.entries(outcome).filter(([key])=>key!=='status'))});}
 else{raw=originalRows(before.value.kind,file.text);if(raw===null){const p=parseCSV(file.text,{lineEndings});raw=[...p.rows,...p.rejected].sort((x,y)=>x.line-y.line);}}}
 catch(e){if(!(e instanceof InputError)&&!(e instanceof SyntaxError))throw e;raw=[];}
 const originals=new Map(raw.map(x=>[x.line,x]));
 const lines=[...new Set([...originals.keys(),...(a.rows?.keys()||[]),...(b.rows?.keys()||[])])].sort((x,y)=>x-y);
 const summary={original_occurrences:lines.length,unchanged:0,changed:0,became_accepted:0,became_rejected:0,unavailable:0};
 const fieldChanges=changes(before.value,after.value);
 let retainedBytes=Buffer.byteLength(JSON.stringify({project,preparation_changes:fieldChanges,before:before.value,after:after.value}))+4096;
 const rows=lines.map(line=>{
  const missing=p=>p.error?{status:'unavailable',reason:p.error}:{status:'absent'};
  const left=a.rows?.get(line)||missing(a),right=b.rows?.get(line)||missing(b);
  const same=stable(left)===stable(right);let disposition=same?'unchanged':'changed';
  if(left.status==='unavailable'||right.status==='unavailable'){summary.unavailable++;disposition='unavailable';}
  else if(left.status!=='accepted'&&right.status==='accepted'){summary.became_accepted++;disposition='became_accepted';}
  else if(left.status==='accepted'&&right.status!=='accepted'){summary.became_rejected++;disposition='became_rejected';}
  if(same)summary.unchanged++;else summary.changed++;
  const item={line,original:originals.get(line)||null,before:left,after:right,disposition,changes:same?[]:changes(left.status==='accepted'?left.row:left,right.status==='accepted'?right.row:right)};
  retainedBytes+=Buffer.byteLength(JSON.stringify(item))+1;
  if(retainedBytes>MAX_COMPARISON_BYTES)throw new InputError('The complete comparison exceeds the existing 128 MiB route. Original history stays unchanged; no partial comparison was published.',413);
  return item;
 });
 const side=(e,p)=>({id:e.id,revision:e.revision,digest:e.digest,createdAt:e.createdAt,label:e.value.label,reviewer:e.value.reviewer,sourceName:e.value.sourceName,sourceSha:e.value.sourceSha,mapping:e.value.mapping,resolvedMapping:p.mapping,accepted:p.accepted,rejected:p.rejected,error:p.error,receipt:project.receipts.find(r=>r.id===e.id&&r.revision===e.revision)||null});
 const result={format:COMPARISON_FORMAT,...(before.value.kind!=='usgs-daily'&&lineEndings==='physical'?{sourceLineEdition:SOURCE_LINE_EDITION}:{}),workspaceId:project.workspaceId,project,before:side(before,a),after:side(after,b),preparation_changes:fieldChanges,summary,rows,meaning:'The same complete original file is interpreted by the unchanged current normaliser under two explicit saved mappings. Accepted means parsed, not quality approved, matched to a native reach, independently observed, or admitted to calibration. This comparison imports nothing.'};
 result.sha256=hash(stable(result));
 if(Buffer.byteLength(JSON.stringify(result))>MAX_COMPARISON_BYTES)throw new InputError('The complete comparison exceeds the existing 128 MiB route. Both complete preparation histories remain unchanged; no rows were truncated.',413);
 return result;
}
export function compareIntakeIdentity(report){
 if(!report||report.format!==COMPARISON_FORMAT||!report.sha256)fail('Open a complete saved interpretation comparison.');
 const {sha256,...body}=report;if(hash(stable(body))!==sha256)fail('Saved comparison bytes or identity changed.');
 return report;
}
