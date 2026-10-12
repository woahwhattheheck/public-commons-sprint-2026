// MIT. Commissioning-only workbook authoring with the supported artifact-tool runtime.
// Run with CODEX_PRIMARY_RUNTIME_NODE and its original node_modules; no new dependencies.
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {FileBlob,SpreadsheetFile,Workbook} from '@oai/artifact-tool';
const hash=body=>createHash('sha256').update(body).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const need=(ok,message)=>{if(!ok)throw Error(message);};
async function read(path){try{return await fs.readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function immutable(path,body){
 const current=await read(path);if(current){need(current.equals(body),'Existing authored file differs: '+path);return;}
 await fs.mkdir(resolve(path,'..'),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';
 await fs.writeFile(temporary,body,{flag:'wx'});
 try{await fs.link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(path)).equals(body),'Concurrent authored file differs: '+path);}
 finally{await fs.rm(temporary,{force:true});}
}
export function column(index){let s='';for(let n=index;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function sourceRows(selection){
 need(selection&&selection.publication&&Array.isArray(selection.rows)&&selection.rows.length>0,'An actual complete frozen publication selection is required.');
 need(selection.rows.length<=5000,'Commissioning workbook row bound exceeded.');
 const seen=new Set();
 for(const row of selection.rows){need(row.result?.resultId&&row.result?.editionId&&!seen.has(row.result.resultId),'The selected publication must have unique original result identities.');seen.add(row.result.resultId);}
 const first=selection.rows[0].result.record,fields=first.form.definition.fields;
 need(Array.isArray(fields)&&fields.length>0&&fields.length<=100,'Use the actual retained extraction form fields.');
 for(const row of selection.rows)need(JSON.stringify(row.result.record.form.definition.fields)===JSON.stringify(fields),'This commissioning layout requires one reviewed field definition; map heterogeneous client templates explicitly.');
 return fields;
}
function plain(sheet,area){sheet.showGridLines=false;sheet.getRange(area).format={font:{name:'Arial',size:10,color:'#20252B'},verticalAlignment:'center'};}
function title(sheet,range,label,subtitleRange,subtitle){
 sheet.mergeCells(range);sheet.getRange(range.split(':')[0]).values=[[label]];
 sheet.getRange(range).format={fill:'#1F2933',font:{name:'Arial',size:18,bold:true,color:'#FFFFFF'},rowHeight:40};
 sheet.mergeCells(subtitleRange);sheet.getRange(subtitleRange.split(':')[0]).values=[[subtitle]];
 sheet.getRange(subtitleRange).format={font:{name:'Arial',size:10,color:'#52606D'},wrapText:true,rowHeight:34};
}
async function inspectAndRender(workbook,directory,views){
 workbook.recalculate();
 const inspection=await workbook.inspect({kind:'workbook,sheet,table',maxChars:9000,tableMaxRows:5,tableMaxCols:8,tableMaxCellChars:110});
 const formulas=await workbook.inspect({kind:'formula',sheetId:'Extraction',range:'A1:H6',maxChars:2500,options:{maxResults:20}});
 await immutable(join(directory,'workbook-inspection.json'),json(inspection));
 await immutable(join(directory,'formula-inspection.json'),json(formulas));
 const images=[];
 for(const view of views){
  const rendered=await workbook.render({sheetName:view.sheet,range:view.range,scale:1.5,format:'png'});
  const body=Buffer.from(await rendered.arrayBuffer()),path=join(directory,view.name+'.png');
  await immutable(path,body);images.push({path,bytes:body.length,sha256:hash(body),sheet:view.sheet,range:view.range});
 }
 return images;
}
async function publishWorkbook(workbook,directory,filename,request,extra,views){
 const requestBytes=json(request),requestSha256=hash(requestBytes),receiptPath=join(directory,'authoring-result.json'),prior=await read(receiptPath);
 if(prior){
  const receipt=JSON.parse(prior);need(receipt.requestSha256===requestSha256,'The retained authoring request differs.');
  const output=await fs.readFile(receipt.path);need(hash(output)===receipt.sha256&&output.length===receipt.bytes,'The retained authored workbook changed.');return receipt;
 }
 await fs.mkdir(directory,{recursive:true});await immutable(join(directory,'authoring-request.json'),requestBytes);
 const preparedPath=join(directory,'authoring-prepared.json'),prepared=await read(preparedPath);
 if(prepared){
  const receipt=JSON.parse(prepared);need(receipt.requestSha256===requestSha256,'Prepared authoring request differs.');
  const body=await read(receipt.path)??await fs.readFile(receipt.temporary);
  need(hash(body)===receipt.sha256&&body.length===receipt.bytes,'Prepared workbook changed.');
  await immutable(receipt.path,body);await immutable(receiptPath,json(receipt));await fs.rm(receipt.temporary,{force:true});return receipt;
 }
 const previews=await inspectAndRender(workbook,directory,views),temporary=join(directory,'.'+randomUUID()+'.xlsx');
 const exported=await SpreadsheetFile.exportXlsx(workbook);await exported.save(temporary);
 const body=await fs.readFile(temporary),reopened=await SpreadsheetFile.importXlsx(await FileBlob.load(temporary));
 const reopenedInspection=await reopened.inspect({kind:'workbook,sheet,table',maxChars:7000,tableMaxRows:4,tableMaxCols:6});
 await immutable(join(directory,'reopened-inspection.json'),json(reopenedInspection));
 const receipt={schema:'sf88-template-artifact-authoring/v1',requestSha256,path:join(directory,filename),temporary,
  sha256:hash(body),bytes:body.length,previews,...extra};
 await immutable(preparedPath,json(receipt));await immutable(receipt.path,body);await immutable(receiptPath,json(receipt));await fs.rm(temporary,{force:true});return receipt;
}
export async function createCommissioningWorkbook({selection,directory,filename='Research_Extraction_Template.xlsx'}){
 directory=resolve(directory);const fields=sourceRows(selection),lastRow=7+selection.rows.length,lastColumn=column(fields.length+3),notesColumn=column(fields.length+3);
 const request={schema:'sf88-template-authoring-request/v1',action:'create',selection,filename};
 const existing=await read(join(directory,'authoring-result.json'));if(existing){const value=JSON.parse(existing);need(value.requestSha256===hash(json(request)),'Template source selection changed.');need(hash(await fs.readFile(value.path))===value.sha256,'Saved template changed.');return value;}
 const workbook=Workbook.create(),sheet=workbook.worksheets.add('Extraction'),sources=workbook.worksheets.add('Sources');
 plain(sheet,'A1:'+lastColumn+lastRow);title(sheet,'A1:H1','RESEARCH EXTRACTION / CLIENT TEMPLATE','A2:H2','Original result IDs identify rows after sorting. Publication values are filled only by the reviewed template release.');
 sheet.getRange('A4:B5').values=[['Study',selection.sourceCase?.source?.nctId??selection.sourceCase?.nctId??selection.sourceCase?.studyId??'Retained research source'],['Publication',selection.publication.id]];
 sheet.getRange('D4:E5').values=[['Data rows',null],['Source revision',selection.revision]];
 sheet.getRange('E4').formulas=[['=ROWS(B8:B'+lastRow+')']];sheet.getRange('A4:A5').format.font={bold:true};sheet.getRange('D4:D5').format.font={bold:true};
 sheet.getRange('A7:'+lastColumn+'7').values=[['Original result ID','Result / group',...fields.map(f=>f.label??f.id),'Client note']];
 sheet.getRange('A7:'+lastColumn+'7').format={fill:'#DCE3E8',font:{bold:true,color:'#20252B'},wrapText:true,rowHeight:44,borders:{preset:'doubleBottom',color:'#7B8794',style:'thin'}};
 const values=selection.rows.map(r=>[r.result.resultId,r.result.label,...fields.map(()=>null),'']);
 sheet.getRange('A8:'+lastColumn+lastRow).values=values;
 sheet.getRange('A8:'+lastColumn+lastRow).setNumberFormat('@');
 sheet.getRange('A8:'+lastColumn+lastRow).format={wrapText:true,rowHeight:58};
 sheet.getRange('A:A').format.columnWidth=26;sheet.getRange('B:B').format.columnWidth=42;
 sheet.getRange('C:'+column(fields.length+2)).format.columnWidth=20;
 sheet.getRange(notesColumn+':'+notesColumn).format.columnWidth=38;
 sheet.getRange(notesColumn+'8:'+notesColumn+lastRow).format.fill='#FFF7D6';
 sheet.freezePanes.freezeRows(7);sheet.freezePanes.freezeColumns(2);
 for(let r=8;r<=lastRow;r++)if(r%2===0)sheet.getRange('A'+r+':'+column(fields.length+2)+r).format.fill='#F4F6F8';
 plain(sources,'A1:F23');title(sources,'A1:F1','SOURCE AND EXCHANGE NOTES','A2:F2','This commissioning layout is authored for the retained study. It is not represented as a client-supplied or Crystallise-owned workbook.');
 const notes=[
 ['Source study',selection.sourceCase?.source?.nctId??selection.sourceCase?.nctId??selection.sourceCase?.studyId??'Original retained source'],
 ['Original source SHA256',selection.sourceCase?.source?.sha256??selection.sourceCase?.sourceSha256??'See the selected dossier source case'],
 ['Dossier',selection.dossierId],['Publication',selection.publication.id],['Publication SHA256',selection.publication.sha256],
 ['Publication title',selection.publication.title],['Original data rows',String(selection.rows.length)],
 ['Release values','The template starts blank. The existing dossier fills only explicitly mapped cells from this frozen publication.'],
 ['Precision','Clinical numbers are exact source text by default. Outcome, class and category denominators remain separate fields.'],
 ['Missing and NA','Empty cells do not mean zero. The original typed value, status, source pointers and comments remain in the retained mapping and publication.'],
 ['Returning edits','Keep the original result-ID column. You may sort complete rows and add client notes. Every changed mapped value is reviewed before an original extraction draft is created.'],
 ['Formula','The data-row capacity is a simple native ROWS formula. The release engine preserves formulas and requests native recalculation; it does not execute formulas.'],
 ['Client notes','The final yellow column is not part of the source extraction mapping. Complete client returns and all such edits are retained.'],
 ['Commissioning-only changes','The receiving programme may introduce a clearly labelled proposed client value to prove review behavior. It never changes the original registry bytes.'],
 ['Original registry','https://clinicaltrials.gov/study/NCT03529110'],
 ['Layout authorship','Original Commons commissioning layout; no restricted third-party template was adapted.']
 ];
 for(let i=0;i<notes.length;i++){const r=i+4;sources.getRange('A'+r).values=[[notes[i][0]]];sources.mergeCells('B'+r+':F'+r);sources.getRange('B'+r).values=[[notes[i][1]]];sources.getRange('A'+r+':F'+r).format={wrapText:true,rowHeight:i>6?54:32};sources.getRange('A'+r).format.font={bold:true};}
 sources.getRange('A:A').format.columnWidth=27;sources.getRange('B:F').format.columnWidth=19;sources.freezePanes.freezeRows(3);
 const bindings=selection.rows.flatMap((r,index)=>fields.map((field,j)=>({id:'row-'+index+'-'+field.id,sheet:'Extraction',cell:column(j+3)+(index+8),
  resultId:r.result.resultId,editionId:r.result.editionId,fieldId:field.id,component:'value',mode:'text',rowIdentity:{column:'A',value:r.result.resultId}})));
 const views=[{name:'extraction-left',sheet:'Extraction',range:'A1:H'+Math.min(lastRow,14)},
  {name:'extraction-right',sheet:'Extraction',range:'I7:'+lastColumn+Math.min(lastRow,14)},
  {name:'sources',sheet:'Sources',range:'A1:F'+(notes.length+3)}].filter(v=>v.name!=='extraction-right'||fields.length+3>=9);
 const result=await publishWorkbook(workbook,directory,filename,request,{bindings,fields:fields.map(f=>({id:f.id,label:f.label})),firstRow:8,lastRow,notesColumn,
  source:{dossierId:selection.dossierId,revision:selection.revision,publicationId:selection.publication.id,publicationSha256:selection.publication.sha256}},views);
 await immutable(join(directory,'bindings.json'),json(bindings));return result;
}
export async function createCommissioningReturn({sourcePath,directory,layout,change,filename='Research_Client_Return.xlsx'}){
 directory=resolve(directory);const original=await fs.readFile(sourcePath),sourceSha256=hash(original);
 need(change&&typeof change.resultId==='string'&&typeof change.fieldId==='string'&&typeof change.value==='string'&&change.reason,'A labelled commissioning change is required.');
 const request={schema:'sf88-template-authoring-request/v1',action:'client-return',sourceSha256,layout,change,filename};
 const existing=await read(join(directory,'authoring-result.json'));if(existing){const receipt=JSON.parse(existing);need(receipt.requestSha256===hash(json(request)),'Client return request changed.');need(hash(await fs.readFile(receipt.path))===receipt.sha256,'Saved return changed.');return receipt;}
 const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
 const originalInspection=await workbook.inspect({kind:'workbook,sheet,table',maxChars:7000,tableMaxRows:5,tableMaxCols:7});
 await fs.mkdir(directory,{recursive:true});await immutable(join(directory,'original-inspection.json'),json(originalInspection));
 const sheet=workbook.worksheets.getItem('Extraction'),lastColumn=layout.notesColumn;
 const rows=sheet.getRange('A'+layout.firstRow+':'+lastColumn+layout.lastRow).values.map(row=>[...row]);
 const index=rows.findIndex(r=>r[0]===change.resultId);need(index>=0,'The actual released result ID is missing.');
 const fieldIndex=layout.fields.findIndex(f=>f.id===change.fieldId);need(fieldIndex>=0,'Original mapped field is missing.');
 rows[index][fieldIndex+2]=change.value;rows[index][layout.fields.length+2]=change.reason;
 // Reorder whole rows, carrying native source IDs and every client note together.
 if(rows.length>1){const other=index===0?1:0;[rows[index],rows[other]]=[rows[other],rows[index]];}
 sheet.getRange('A'+layout.firstRow+':'+lastColumn+layout.lastRow).values=rows;
 sheet.getRange('A'+layout.firstRow+':'+lastColumn+layout.lastRow).setNumberFormat('@');
 const target=rows.findIndex(r=>r[0]===change.resultId)+layout.firstRow;
 const result=await publishWorkbook(workbook,directory,filename,request,{sourceSha256,change:{...change,cell:column(fieldIndex+3)+target,row:target},
  rowOrder:rows.map(r=>r[0])},[{name:'client-return-left',sheet:'Extraction',range:'A1:H'+Math.min(layout.lastRow,14)},
   {name:'client-return-right',sheet:'Extraction',range:'I7:'+lastColumn+Math.min(layout.lastRow,14)}].filter(v=>!v.name.endsWith('right')||layout.fields.length+3>=9));
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [action,inputPath]=process.argv.slice(2);need(['create','return'].includes(action)&&inputPath,'Usage: commissioning-workbook.mjs create|return input.json');
 const input=JSON.parse(await fs.readFile(inputPath,'utf8'));
 const result=action==='create'?await createCommissioningWorkbook(input):await createCommissioningReturn(input);
 process.stdout.write(JSON.stringify(result)+'\n');
}
