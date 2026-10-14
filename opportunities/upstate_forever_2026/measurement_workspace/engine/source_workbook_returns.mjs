/** Original-workbook review copies from the existing complete native snapshot. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash,stable} from './normalise.mjs';
import {InputError,parseCSV,sourceLineEndings} from './parse.mjs';
import {originalMap,validateLineage} from './source_lineage.mjs';
import {returnedTable} from './source_handback_core.mjs';
const FORMAT='upper-savannah-original-workbook-review/v1';
const json=v=>JSON.stringify(v,null,2)+'\n';
const need=(v,m)=>{if(!v)throw new InputError(m,409);};
const copy=v=>JSON.parse(JSON.stringify(v));
const filename=value=>{
 const leaf=String(value).split(/[\\/]/).at(-1).replace(/[:\x00-\x1f\x7f]/g,'_');
 return leaf&&leaf!=='.'&&leaf!=='..'?leaf:'original.xlsx';
};
function selectedGroups(project,view){
 const packet=project.intake;
 if(!packet)return [];
 const originals=originalMap(packet.originals||[]),groups=new Map();
 for(const receipt of [...packet.receipts].sort((a,b)=>(a.id<b.id?-1:a.id>b.id?1:0)||a.revision-b.revision)){
  if(!view.sourceIds.includes(receipt.importId))continue;
  const edition=packet.editions.find(e=>e.id===receipt.id&&e.revision===receipt.revision);
  need(edition,'The original workbook preparation edition is absent.');
  const lineage=edition.value.lineage;
  if(!lineage||lineage.source_row_kind!=='worksheet-row')continue;
  const original=originals.get(lineage.original.sha256),source=project.tables.imports.find(x=>x.id===receipt.importId);
  need(original&&source&&source.sha===edition.value.sourceSha&&receipt.sourceSha===source.sha,
   'The original workbook, preparation and imported source no longer agree.');
  validateLineage(lineage,source.content,originals);
  const returned=view.sources.find(s=>s.id===receipt.importId);
  need(returned,'Keep the complete returned source for this workbook.');
  let group=groups.get(original.sha256);
  if(!group){group={original,filenames:[],bindings:[],tables:[]};groups.set(original.sha256,group);}
  if(!group.filenames.includes(lineage.original.filename))group.filenames.push(lineage.original.filename);
  const binding={preparationId:receipt.id,preparationRevision:receipt.revision,importId:receipt.importId,
   measurementRevision:view.revision,sourceCollectionId:lineage.source_collection_id,sourceId:lineage.source_id,
   inspectionId:lineage.inspection_id,originalFilename:lineage.original.filename,sourceSheet:lineage.sheet,
   reading:copy(lineage.reading),originalSha256:original.sha256,sourceSha256:source.sha,
   rowMapSha256:hash(stable(lineage)),selectedResultIds:[...view.exportIds]};
  // The same kind+bytes+mapping may reuse an import made under the other line
  // edition. Keep both stored editions; join their exact logical projected rows.
  const summary=typeof source.summary==='string'?JSON.parse(source.summary):source.summary;
  const imported=parseCSV(source.content,{lineEndings:sourceLineEndings(summary)});
  need(returned.sha256===source.sha&&imported.rejected.length===0&&
   stable(returned.headers)===stable(imported.headers)&&
   imported.rows.length===lineage.rows.length&&returned.rows.length===imported.rows.length,
   'The complete returned worksheet differs from its original imported source.');
  const table=returnedTable(returned),byLine=new Map();
  need(table.rows.length===imported.rows.length,'Keep every complete returned worksheet row.');
  for(const [index,row] of imported.rows.entries()){
   const native=returned.rows[index],values=imported.headers.map(header=>row.raw[header]);
   need(native.line===row.line&&stable(native.values)===stable(values),
    'A returned row differs from its exact original cells or stored source position.');
   byLine.set(lineage.rows[index].line,{source:native,values:table.rows[index]});
  }
  const metaHeaders=['Original workbook','Original worksheet','Original worksheet row','Original line start','Original line end',
   'Preparation','Preparation edition','Native source','Native measurements revision'];
  const originalHeaders=lineage.columns.map(c=>c.original_label);
  const headers=[...metaHeaders,...originalHeaders,...table.headers.slice(returned.headers.length)];
  const completeRows=[...lineage.rows,...lineage.excluded_rows].sort((a,b)=>a.source_row-b.source_row);
  const rows=completeRows.map(row=>{
   const lead=[lineage.original.filename,lineage.sheet,row.source_row,row.source_line_start,row.source_line_end,
    receipt.id,receipt.revision,receipt.importId,view.revision];
   const entry=row.reason?null:byLine.get(row.line);
   if(!row.reason)need(entry,'A returned native line is absent from its original worksheet row.');
   if(entry)return [...lead,...entry.values];
   const values=Array(table.headers.length).fill('');
   values[returned.headers.length]=row.line??'';
   values[returned.headers.length+1]='Original '+row.reason+' row; retained unchanged on source worksheet';
   return [...lead,...values];
  });
  need(rows.length===lineage.original_record_count,'The complete original worksheet row population changed.');
  // Split at Excel's physical row capacity only. Every part retains full source
  // identities; no source row or long cell is truncated.
  for(let offset=0;offset<rows.length;offset+=1048575){
   group.tables.push({sourceSheet:lineage.sheet,binding:{...binding,firstOriginalRow:rows[offset]?.[2],
    lastOriginalRow:rows[Math.min(offset+1048575,rows.length)-1]?.[2]},
    headers,rows:rows.slice(offset,offset+1048575)});
  }
  group.bindings.push({...binding,lineage:copy(lineage)});
 }
 return [...groups.values()].sort((a,b)=>a.original.sha256<b.original.sha256?-1:a.original.sha256>b.original.sha256?1:0);
}
function invoke(group){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'measurements-workbook-return-'));
 try{
  const original=Buffer.from(group.original.data,'base64'),input=path.join(directory,'original.zip'),
   spec=path.join(directory,'review.json'),output=path.join(directory,'reviewed.zip');
  fs.writeFileSync(input,original,{flag:'wx',mode:0o600});
  fs.writeFileSync(spec,json({format:FORMAT,originalSha256:group.original.sha256,originalBytes:original.length,tables:group.tables}),{flag:'wx',mode:0o600});
  const python=process.env.MEASUREMENTS_PYTHON||'python3';
  const run=spawnSync(python,['-B',fileURLToPath(new URL('./source_workbook_append.py',import.meta.url)),
   '--original',input,'--spec',spec,'--output',output],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,windowsHide:true});
  if(run.error)throw new InputError('The original-workbook return could not use the selected scientific Python. '
   +'Keep the original file and retry this same selection after restoring that interpreter. '+run.error.message,503);
  need(run.status===0,'The selected scientific Python could not complete the original-workbook return. '
   +(run.stderr||'').slice(-3000));
  let result;try{result=JSON.parse(run.stdout);}catch{throw new InputError('The original-workbook return did not produce its complete result.',503);}
  need(result.format===FORMAT&&result.originalSha256===group.original.sha256&&result.originalBytes===original.length&&
   ['ready','original_only'].includes(result.state),'The original-workbook return identity changed.');
  if(result.state==='original_only'){
   need(typeof result.reason==='string'&&result.reason,'The original workbook needs its complete preservation explanation.');
   return {result,data:null};
  }
  const data=fs.readFileSync(output);
  need(data.length===result.returnedBytes&&hash(data)===result.returnedSha256&&Array.isArray(result.originalParts)&&Array.isArray(result.sheets),
   'The complete reviewed workbook bytes or inventory changed.');
  return {result,data};
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
/** Called with the same immutable project/view used by the original publisher. */
export function originalWorkbookReturns(project,view){
 const members=[],workbooks=[];
 for(const group of selectedGroups(project,view)){
  const {result,data}=invoke(group),base='workbooks/'+group.original.sha256+'/',
   name=filename(group.filenames[0]),originalPath=base+'originals/'+name,
   lineagePath=base+'source-lineage.json',partsPath=base+'package-parts.json',
   returnedPath=result.state==='ready'?base+name.replace(/\.[^.]*$/,'')+'-reviewed'+result.extension:null;
  const entry={format:FORMAT,state:result.state,reason:result.reason||'',originalFilenames:group.filenames,
   originalPath,lineagePath,partsPath:result.state==='ready'?partsPath:null,returnedPath,
   originalBytes:group.original.bytes,originalSha256:group.original.sha256,
   preparationCount:group.bindings.length,bindings:group.bindings.map(({lineage,...binding})=>binding),
   ...(result.state==='ready'?{returnedBytes:result.returnedBytes,returnedSha256:result.returnedSha256,
    originalSheets:result.originalSheets,sheets:result.sheets,unchangedPartCount:result.unchangedPartCount,
    updatedCatalogs:result.updatedCatalogs,macroParts:result.macroParts}: {})};
  members.push({name:originalPath,data:Buffer.from(group.original.data,'base64')},
   {name:lineagePath,data:Buffer.from(json({format:FORMAT,originalFilenames:group.filenames,
    originalSha256:group.original.sha256,bindings:group.bindings}))});
  if(data)members.push({name:returnedPath,data},{name:partsPath,data:Buffer.from(json(result))});
  workbooks.push(entry);
 }
 return {workbooks,members};
}
