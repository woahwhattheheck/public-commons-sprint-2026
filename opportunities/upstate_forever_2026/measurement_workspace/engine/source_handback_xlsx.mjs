/** Spreadsheet return: inline text cells preserve IDs, date strings and literal formula text. */
import {zipMembers} from './collection_zip.mjs';
import {InputError} from './parse.mjs';
const xml=value=>String(value??'').replace(/_x[0-9a-fA-F]{4}_/g,s=>'_x005F_'+s.slice(1))
 .replace(/[\x00-\x08\x0B-\x1F\uFFFE\uFFFF]/g,c=>'_x'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')+'_')
 .replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export function textWorkbook(tables){
 const sheets=[];for(const table of tables){if(table.headers.length>16384)throw new InputError('The source exceeds Excel column capacity; use its complete CSV and JSON.');
  for(let start=0;start<Math.max(1,table.rows.length);start+=50000)sheets.push({name:'Source '+(sheets.length+1),label:table.label,headers:table.headers,rows:table.rows.slice(start,start+50000)});}
 const members=[],decl=[],relationships=[],sheetTags=[];
 for(let i=0;i<sheets.length;i++){const s=sheets[i],data=[s.headers,...s.rows],name='xl/worksheets/sheet'+(i+1)+'.xml';
  const rows=data.map((row,y)=>'<row r="'+(y+1)+'">'+row.map((v,x)=>{const text=String(v??'');if(text.length>32767)throw new InputError('A returned cell exceeds Excel capacity. Complete values remain in the CSV and row JSON.');
   return '<c r="'+col(x)+(y+1)+'" t="inlineStr"'+(y===0?' s="1"':'')+'><is><t xml:space="preserve">'+xml(text)+'</t></is></c>';}).join('')+'</row>').join('');
  members.push({name,data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="'+s.headers.length+'" width="23" customWidth="1"/></cols><sheetData>'+rows+'</sheetData><autoFilter ref="A1:'+col(s.headers.length-1)+data.length+'"/></worksheet>'});
  decl.push('<Override PartName="/'+name+'" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  relationships.push('<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>');
  sheetTags.push('<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>');
 }
 members.push({name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+decl.join('')+'</Types>'});
 members.push({name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'});
 members.push({name:'xl/workbook.xml',data:'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheetTags.join('')+'</sheets></workbook>'});
 members.push({name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+relationships.join('')+'<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'});
 members.push({name:'xl/styles.xml',data:'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>'});
 return {data:zipMembers(members),sheets:sheets.map((s,i)=>({name:s.name,sourceLabel:s.label,dataRows:s.rows.length,columns:s.headers.length,index:i+1}))};
}
