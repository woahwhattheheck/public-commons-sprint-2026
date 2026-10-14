// MIT. Read-only comparison of exact immutable customer delivery editions.
import { createHash } from 'node:crypto';
import { parseCSV, writeCSV } from './csv.mjs';
const SCHEMA = 'stellar-forge.record-mastering.v1';
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : plain(v) ? '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
function requireValue(ok,message){if(!ok){const e=new Error(message);e.code='DELIVERY_COMPARISON_INVALID';e.status=400;throw e;}}
const equal=(a,b)=>canonical(a)===canonical(b);
function decode(files,name){requireValue(typeof files[name]==='string','The complete original '+name+' is required.');const bytes=Buffer.from(files[name],'base64');requireValue(bytes.toString('base64')===files[name],'Invalid original file encoding: '+name);return bytes;}
function snapshot(delivery){
    requireValue(plain(delivery)&&typeof delivery.id==='string'&&plain(delivery.files),'Choose a saved delivery edition.');
    const files=delivery.files, csv=decode(files,'master.csv'), doc=JSON.parse(decode(files,'delivery.json').toString('utf8'));
    requireValue(doc.schema===SCHEMA+'.delivery'&&Array.isArray(doc.columns)&&new Set(doc.columns).size===doc.columns.length,'Unsupported original delivery description.');
    requireValue(sha(csv)===doc.csvSha256,'The original master CSV does not match its retained digest.');
    const table=parseCSV(csv);
    requireValue(equal(table.headers,['master_id',...doc.columns])&&table.rows.length===doc.rowCount,'The original delivery columns or row count differ.');
    requireValue(delivery.source_revision===doc.sourceRevision&&delivery.row_count===doc.rowCount&&delivery.mode===doc.mode&&delivery.conflict_count===doc.conflictCount&&delivery.title===doc.title&&delivery.created===doc.created,'The saved delivery record differs from its original file.');
    const records=new Map(), provenance=new Map();
    for(const values of table.rows){const id=values[0];requireValue(id&& !records.has(id),'Duplicate or empty original master identifier.');records.set(id,Object.fromEntries(table.headers.map((k,i)=>[k,values[i]])));}
    for(const line of decode(files,'field-provenance.jsonl').toString('utf8').split(/\r?\n/)){
        if(!line)continue;const row=JSON.parse(line);requireValue(plain(row),'Invalid original field provenance row.');const key=JSON.stringify([row.master_id,row.field]);
        requireValue(plain(row)&&records.has(row.master_id)&&doc.columns.includes(row.field)&&!provenance.has(key),'Original field provenance is missing, duplicate or outside its delivery.');
        requireValue(typeof row.value==='string'&&typeof row.status==='string'&&Array.isArray(row.sources)&&own(row,'decision')&&row.value===records.get(row.master_id)[row.field],'Original field provenance differs from its CSV cell.');
        provenance.set(key,row);
    }
    requireValue(provenance.size===doc.rowCount*doc.columns.length,'The delivery does not contain complete original field provenance.');
    const required=['master.csv','dataset.json','delivery.json','field-provenance.jsonl','conflicts.csv','READING.md'];
    const inventory=Object.keys(files).sort().map(name=>{const bytes=decode(files,name);return{name,bytes:bytes.length,sha256:sha(bytes)};});
    requireValue(required.every(name=>own(files,name)),'The complete six original delivery files are required.');
    const conflictTable=parseCSV(decode(files,'conflicts.csv'));
    requireValue(conflictTable.rows.length===doc.conflictCount,'The retained unresolved-field count differs.');
    return {value:{id:delivery.id,document:doc,inventory,files:{...files}},records,provenance};
}
const escaped=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=v=>String(v).replaceAll('_',' ');
export function compareDeliveries(workspace,beforeDelivery,afterDelivery){
    requireValue(workspace&&typeof workspace.id==='string','An original workspace identity is required.');
    requireValue(beforeDelivery.id!==afterDelivery.id,'Choose two different retained delivery editions.');
    const before=snapshot(beforeDelivery),after=snapshot(afterDelivery);
    const beforeFields=before.value.document.columns,afterFields=after.value.document.columns;
    const fields={shared:beforeFields.filter(f=>afterFields.includes(f)),added:afterFields.filter(f=>!beforeFields.includes(f)),removed:beforeFields.filter(f=>!afterFields.includes(f))};
    const allFields=[...beforeFields,...fields.added],ids=[...new Set([...before.records.keys(),...after.records.keys()])].sort();
    const summary={beforeRecords:before.records.size,afterRecords:after.records.size,addedRecords:0,removedRecords:0,changedRecords:0,unchangedRecords:0,valueChanges:0,statusChanges:0,provenanceChanges:0};
    const rows=ids.map(masterId=>{
        const hasBefore=before.records.has(masterId),hasAfter=after.records.has(masterId);
        const cells=allFields.map(field=>{
            const b=before.provenance.get(JSON.stringify([masterId,field]))??null,a=after.provenance.get(JSON.stringify([masterId,field]))??null;
            const comparable=!!b&&!!a,valueChanged=comparable&&b.value!==a.value,statusChanged=comparable&&b.status!==a.status;
            const provenanceChanged=comparable&&(!equal(b.sources,a.sources)||!equal(b.decision,a.decision));
            if(valueChanged)summary.valueChanges++;if(statusChanged)summary.statusChanges++;if(provenanceChanged)summary.provenanceChanges++;
            return{field,before:b,after:a,valueChanged,statusChanged,provenanceChanged,change:!b&&!a?'not_delivered':!b?'added':!a?'removed':valueChanged||statusChanged||provenanceChanged?'changed':'unchanged'};
        });
        const change=!hasBefore?'added':!hasAfter?'removed':cells.some(c=>c.change!=='unchanged'&&c.change!=='not_delivered')?'changed':'unchanged';
        summary[change+'Records']++;
        return{masterId,change,cells};
    });
    const value={schema:SCHEMA+'.delivery-comparison',workspace:{id:workspace.id,title:workspace.title},before:before.value,after:after.value,fields,summary,rows,
        interpretation:{alignment:'Original stable master identifiers within the same workspace.',values:'Exact text; blank values remain distinct from absent rows or fields. Resolution status is retained beside each value.',membership:'Added and removed mean present in one selected delivery. Source omission, ready-only selection, exclusions, merges and splits are not inferred from delivery membership.',provenance:'Changed source candidates or decisions are shown even when delivered text is unchanged.'}};
    return{...value,sha256:sha(canonical(value))};
}
export function comparisonCSV(value){
    const rows=[];
    for(const row of value.rows)for(const c of row.cells)rows.push({
        master_id:row.masterId,record_change:row.change,field:c.field,field_change:c.change,
        before_present:c.before!==null,after_present:c.after!==null,before_value:c.before?.value??'',after_value:c.after?.value??'',
        before_status:c.before?.status??'',after_status:c.after?.status??'',value_changed:c.valueChanged,status_changed:c.statusChanged,provenance_changed:c.provenanceChanged,
        before_sources:JSON.stringify(c.before?.sources??null),after_sources:JSON.stringify(c.after?.sources??null),
        before_decision:JSON.stringify(c.before?.decision??null),after_decision:JSON.stringify(c.after?.decision??null)
    });
    return writeCSV(['master_id','record_change','field','field_change','before_present','after_present','before_value','after_value','before_status','after_status','value_changed','status_changed','provenance_changed','before_sources','after_sources','before_decision','after_decision'],rows).toString('utf8');
}
export function comparisonHTML(value){
    const e=escaped,table=(heads,rows)=>'<div class="table"><table><thead><tr>'+heads.map(h=>'<th>'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    const docRows=['title','created','sourceRevision','mode','rowCount','omittedRecords','conflictCount'].map(k=>[e(({sourceRevision:'Saved source revision',rowCount:'Delivered records',omittedRecords:'Records omitted by selection',conflictCount:'Unresolved delivered fields'})[k]??label(k)),e(value.before.document[k]),e(value.after.document[k])]);
    const cell=v=>v===null?'<span class="muted">Absent from edition</span>':'<div class="value">'+(v.value===''?'<span class="muted">Empty text</span>':e(v.value))+'</div><div class="muted">'+e(label(v.status))+'</div>';
    const records=value.rows.map(row=>'<section><h3>'+e(label(row.change))+' · '+e(row.masterId)+'</h3>'+table(['Field','Before value / status','After value / status','Changes'],row.cells.map(c=>[e(label(c.field)),cell(c.before),cell(c.after),e([c.change==='not_delivered'?'Absent from both':c.change==='added'?'Field present only after':c.change==='removed'?'Field present only before':'',c.valueChanged?'Text':null,c.statusChanged?'Resolution':null,c.provenanceChanged?'Provenance':null].filter(Boolean).join(', ')||'Unchanged')]))+'<details><summary>Complete original field provenance</summary><pre>'+e(JSON.stringify(row.cells,null,2))+'</pre></details></section>').join('');
    const sourceRows=side=>value[side].document.sourceEditions.map(s=>[e(s.name),e(s.editionId??'No active edition'),e(s.sha256??'No active source')]);
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer delivery changes</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#171717;background:white;margin:0 auto;max-width:1100px;padding:28px}h1,h2,h3{line-height:1.25}h2{margin-top:32px}h3{overflow-wrap:anywhere}section{border-top:1px solid #aaa;margin-top:24px;padding-top:8px}.table{overflow:auto}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ccc;padding:9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}.muted{color:#555;font-size:.9em}.value{white-space:pre-wrap;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace}summary{cursor:pointer}@media(max-width:600px){body{padding:16px}th,td{padding:6px;min-width:100px}}@media print{body{max-width:none;padding:0}.table{overflow:visible}h2,h3{break-after:avoid}tr{break-inside:avoid}details{display:none}}</style><main><h1>Customer delivery changes</h1><p>'+e(value.before.document.title)+' → '+e(value.after.document.title)+'</p><p>'+e(value.workspace.title)+' · '+e(value.workspace.id)+'</p>'+table(['Edition','Before','After'],docRows)+'<h2>Change summary</h2>'+table(['Measure','Count'],Object.entries(value.summary).map(([k,v])=>[e(k.replace(/([a-z])([A-Z])/g,'$1 $2')),e(v)]))+'<p>Added fields: '+e(value.fields.added.join(', ')||'None')+'. Removed fields: '+e(value.fields.removed.join(', ')||'None')+'.</p>'+Object.values(value.interpretation).map(t=>'<p>'+e(t)+'</p>').join('')+'<h2>Original source editions</h2><h3>Before</h3>'+table(['Source','Edition','Original SHA-256'],sourceRows('before'))+'<h3>After</h3>'+table(['Source','Edition','Original SHA-256'],sourceRows('after'))+'<h2>All delivered records and fields</h2>'+records+'<footer><p>Comparison SHA-256: '+e(value.sha256)+'</p><p>The complete JSON retains both original delivery file sets. Treat CSV columns as text when opening in a spreadsheet.</p></footer></main></html>';
}
export function deliveryComparisonResult(workspace,before,after){
    const comparison=compareDeliveries(workspace,before,after);
    return{comparison,reportHtml:comparisonHTML(comparison),changesCSV:comparisonCSV(comparison)};
}
