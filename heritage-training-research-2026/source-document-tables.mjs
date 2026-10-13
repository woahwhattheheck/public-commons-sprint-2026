// MIT. Complete retained document-table selection for the existing Source Tables product.
export const DOCUMENT_TABLE_SOURCE_SCHEMA = 'stellar-forge.document-table-source.v1';
export const DOCUMENT_TABLE_PROJECTION_SCHEMA = 'stellar-forge.document-table-projection.v1';
export const DOCUMENT_TABLE_LIMITS = Object.freeze({bytes:16*1024*1024,tables:256,rows:100000,columns:512,cells:2000000});
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const bytes=s=>new TextEncoder().encode(s).length;
const need=(v,code,message,details={})=>{if(!v)throw Object.assign(new Error(message),{name:'DocumentTableError',code,...details});};
async function hash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('');}
function text(v,label,max=2000){need(typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'DOCUMENT_TABLE_TEXT',label+' must be ordinary text.');return v;}
function sourceText(v){text(v,'Complete extracted source',DOCUMENT_TABLE_LIMITS.bytes);need(bytes(v)<=DOCUMENT_TABLE_LIMITS.bytes,'DOCUMENT_TABLE_SIZE','The complete extracted source exceeds 16 MiB.');need(!v.isWellFormed||v.isWellFormed(),'DOCUMENT_TABLE_UNICODE','The source contains an unpaired Unicode surrogate.');return v;}
function positive(v,label,max=Number.MAX_SAFE_INTEGER){need(Number.isSafeInteger(v)&&v>0&&v<=max,'DOCUMENT_TABLE_INDEX',label+' must be a positive whole number.');return v;}
const entities=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',ndash:'–',mdash:'—',minus:'−',plusmn:'±',times:'×',divide:'÷',deg:'°',sup2:'²',sup3:'³',micro:'µ',reg:'®',copy:'©',trade:'™',euro:'€',pound:'£',yen:'¥',hellip:'…',le:'≤',ge:'≥',bull:'•',middot:'·',thinsp:'\u2009',ensp:'\u2002',emsp:'\u2003',Tab:'\t',NewLine:'\n'});
function decoded(s,unresolved){return s.replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z][A-Za-z0-9]+);/gi,(all,key)=>{
  if(key[0]==='#'){const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));if(n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff))return String.fromCodePoint(n);}
  else if(own(entities,key))return entities[key];
  unresolved.add(all);return all;
});}
function attributes(tag){const out={};const body=tag.replace(/^<\s*[\w:-]+/,'').replace(/\/?>$/,'');const re=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;let m;
  while((m=re.exec(body))){const k=m[1].toLowerCase();need(!own(out,k),'DOCUMENT_TABLE_ATTRIBUTE','A table cell repeats an attribute.');out[k]=m[2]??m[3]??m[4]??'';}return out;}
function tokens(input){const out=[];let p=0;while(p<input.length){if(input[p]!=='<'){const end=input.indexOf('<',p),q=end<0?input.length:end;out.push({raw:input.slice(p,q),start:p,end:q,tag:false});p=q;continue;}
  if(!/^<(?:\/?[A-Za-z]|!|\?)/.test(input.slice(p,p+3))){out.push({raw:'<',start:p,end:p+1,tag:false});p++;continue;}
  if(input.startsWith('<!--',p)){const end=input.indexOf('-->',p+4);need(end>=0,'DOCUMENT_TABLE_HTML','The source contains an unfinished HTML comment.');out.push({raw:input.slice(p,end+3),start:p,end:end+3,comment:true});p=end+3;continue;}
  let q=p+1,quote='';for(;q<input.length;q++){const c=input[q];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
  need(q<input.length,'DOCUMENT_TABLE_HTML','The source contains an unfinished HTML tag.');out.push({raw:input.slice(p,q+1),start:p,end:q+1,tag:true});p=q+1;
}return out;}
/** Parse extraction HTML only as data. No source markup is executed or inserted into a DOM. */
export function parseDocumentTables(input){
  sourceText(input);const tables=[];let table=null,row=null,cell=null,ignored='',cellCount=0,expandedCellCount=0;
  const boundary=()=>{if(cell&&cell.parts.length&& !cell.parts[cell.parts.length-1].endsWith('\n'))cell.parts.push('\n');};
  for(const token of tokens(input)){
    if(token.comment)continue;
    if(!token.tag){if(cell&&!ignored)cell.parts.push(decoded(token.raw,table.unresolved));continue;}
    const match=/^<\s*(\/?)\s*([A-Za-z][\w:-]*)/.exec(token.raw);if(!match)continue;
    const closing=Boolean(match[1]),tag=match[2].toLowerCase();
    if(ignored){if(closing&&tag===ignored)ignored='';continue;}
    if(tag==='script'||tag==='style'){if(!closing)ignored=tag;continue;}
    if(tag==='table'){
      if(!closing){need(!table,'DOCUMENT_TABLE_NESTED','Nested tables need a separate explicit source extraction.');need(tables.length<DOCUMENT_TABLE_LIMITS.tables,'DOCUMENT_TABLE_LIMIT','The source contains too many tables.');
        table={tableIndex:tables.length+1,htmlStart:token.start,htmlEnd:null,rows:[],cells:[],grid:[],columnCount:0,unresolved:new Set()};}
      else {need(table&&!row&&!cell,'DOCUMENT_TABLE_HTML','Finish each source row and cell before closing its table.');
        table.htmlEnd=token.end;table.html=input.slice(table.htmlStart,table.htmlEnd);table.rowCount=table.rows.length;
        need(table.rowCount>0&&table.columnCount>0,'DOCUMENT_TABLE_EMPTY','Each selected HTML table must contain rows and cells.');
        for(const c of table.cells)need(c.row+c.rowspan-1<=table.rowCount,'DOCUMENT_TABLE_SPAN','A row span extends beyond the original table.',{tableIndex:table.tableIndex,row:c.row,column:c.column});
        table.unresolvedEntities=[...table.unresolved];delete table.unresolved;tables.push(table);table=null;}
      continue;
    }
    if(!table)continue;
    if(tag==='tr'){
      if(!closing){need(!row&&!cell,'DOCUMENT_TABLE_HTML','Source table rows must have explicit nonnested boundaries.');need(table.rows.length<DOCUMENT_TABLE_LIMITS.rows,'DOCUMENT_TABLE_ROWS','The table contains too many rows.');
        row={row:table.rows.length+1,htmlStart:token.start,htmlEnd:null,cells:[]};if(!table.grid[row.row-1])table.grid[row.row-1]=[];}
      else{need(row&&!cell,'DOCUMENT_TABLE_HTML','Finish each source cell before closing its row.');row.htmlEnd=token.end;table.rows.push(row);row=null;}continue;
    }
    if(tag==='td'||tag==='th'){
      if(!closing){need(row&&!cell,'DOCUMENT_TABLE_HTML','Each source cell needs an explicit original row.');const attrs=attributes(token.raw);let col=0;while(table.grid[row.row-1][col]!==undefined)col++;
        const span=(name)=>{if(!own(attrs,name))return 1;need(/^[1-9]\d*$/.test(attrs[name]),'DOCUMENT_TABLE_SPAN','Use a positive explicit '+name+' in the extracted table.');return positive(Number(attrs[name]),name,name==='colspan'?DOCUMENT_TABLE_LIMITS.columns:DOCUMENT_TABLE_LIMITS.rows);};
        cell={tableIndex:table.tableIndex,row:row.row,column:col+1,rowspan:span('rowspan'),colspan:span('colspan'),kind:tag,htmlStart:token.start,htmlEnd:null,contentStart:token.end,parts:[]};
        need(cell.column+cell.colspan-1<=DOCUMENT_TABLE_LIMITS.columns,'DOCUMENT_TABLE_COLUMNS','The table exceeds 512 columns.');}
      else{need(cell&&cell.kind===tag,'DOCUMENT_TABLE_HTML','The original cell close does not match its opening.');cell.htmlEnd=token.end;cell.html=input.slice(cell.htmlStart,cell.htmlEnd);cell.innerHTML=input.slice(cell.contentStart,token.start);cell.text=cell.parts.join('');delete cell.parts;delete cell.contentStart;
        need(++cellCount<=DOCUMENT_TABLE_LIMITS.cells,'DOCUMENT_TABLE_CELLS','The extracted source contains too many cells.');
        need(expandedCellCount+cell.rowspan*cell.colspan<=DOCUMENT_TABLE_LIMITS.cells,'DOCUMENT_TABLE_COVERAGE','The expanded source tables exceed the complete cell limit.');expandedCellCount+=cell.rowspan*cell.colspan;
        const index=table.cells.length;table.cells.push(cell);row.cells.push(index);
        for(let r=cell.row-1;r<cell.row+cell.rowspan-1;r++){if(!table.grid[r])table.grid[r]=[];for(let c=cell.column-1;c<cell.column+cell.colspan-1;c++){
          need(table.grid[r][c]===undefined,'DOCUMENT_TABLE_OVERLAP','Original merged cells overlap.',{tableIndex:table.tableIndex,row:r+1,column:c+1});table.grid[r][c]=index;}}
        table.columnCount=Math.max(table.columnCount,cell.column+cell.colspan-1);cell=null;
      }continue;
    }
    if(cell&&(tag==='br'||tag==='p'||tag==='div'||tag==='li'))boundary();
  }
  need(!table&&!row&&!cell,'DOCUMENT_TABLE_HTML','The extracted source ends inside an unfinished table.');
  need(tables.length>0,'DOCUMENT_TABLE_MISSING','The source contains no complete HTML tables. Receive the original table-preserving HTML or Markdown extraction.');
  return tables.map(t=>({...t,grid:Array.from({length:t.rowCount},(_,r)=>Array.from({length:t.columnCount},(_,c)=>t.grid[r]?.[c]??null))}));
}
function context(input){
  const document=object(input.document)?clone(input.document):{};
  for(const k of ['filename','url','title','sha256'])if(own(document,k))text(document[k],'Original document '+k,2000);
  if(own(document,'sha256'))need(/^[a-f0-9]{64}$/.test(document.sha256),'DOCUMENT_TABLE_HASH','Use the original document SHA-256.');
  for(const k of ['bytes','pageCount'])if(own(document,k))positive(document[k],'Original document '+k);
  const extraction=object(input.extraction)?clone(input.extraction):{};
  for(const k of ['provider','extractedAt','method'])if(own(extraction,k))text(extraction[k],'Extraction '+k,2000);
  const tableLocations=input.tableLocations===undefined?[]:clone(input.tableLocations);
  need(Array.isArray(tableLocations),'DOCUMENT_TABLE_LOCATION','Supply table locations as a complete array.');const seen=new Set();
  for(const loc of tableLocations){need(object(loc),'DOCUMENT_TABLE_LOCATION','Each table location needs its original table number.');positive(loc.tableIndex,'Table index');need(!seen.has(loc.tableIndex),'DOCUMENT_TABLE_LOCATION','Each table has at most one location.');seen.add(loc.tableIndex);
    if(own(loc,'page'))positive(loc.page,'Original page');if(own(loc,'label'))text(loc.label,'Table label',1000);}
  return{filename:text(input.filename,'Original extraction filename',500),sourceUrl:text(input.sourceUrl??'','Original source URL',4000),document,extraction,tableLocations};
}
export async function createDocumentTableSource(input){
  need(object(input),'DOCUMENT_TABLE_SOURCE','Supply the complete extracted document source.');const retained=context(input),value=sourceText(input.sourceText),tables=parseDocumentTables(value);
  for(const loc of retained.tableLocations)need(loc.tableIndex<=tables.length,'DOCUMENT_TABLE_LOCATION','A location names a table absent from the original extraction.');
  const body={...retained,sourceText:value,bytes:bytes(value),sha256:await hash(value)};
  return{schema:DOCUMENT_TABLE_SOURCE_SCHEMA,id:'document-'+await hash(canonical(body)),...body};
}
export async function validateDocumentTableSource(source){
  need(object(source)&&source.schema===DOCUMENT_TABLE_SOURCE_SCHEMA,'DOCUMENT_TABLE_SOURCE','Choose a complete retained document-table source.');
  const expected=await createDocumentTableSource(source);
  need(canonical(source)===canonical(expected),'DOCUMENT_TABLE_SOURCE_CHANGED','The retained document source or its identity does not reproduce.');
  return expected;
}
export async function inspectDocumentTables(source){
  const verified=await validateDocumentTableSource(source);
  return{sourceId:verified.id,filename:verified.filename,sha256:verified.sha256,bytes:verified.bytes,
    tables:parseDocumentTables(verified.sourceText).map(t=>({...t,location:verified.tableLocations.find(x=>x.tableIndex===t.tableIndex)??null}))};
}
function indices(v,label,max,{empty=false}={}){
  need(Array.isArray(v)&&(empty||v.length>0)&&v.length<=max,'DOCUMENT_TABLE_SELECTION','Choose explicit '+label+'.');
  const result=v.map(n=>positive(n,label,max));need(new Set(result).size===result.length,'DOCUMENT_TABLE_SELECTION','Each '+label+' entry must be unique.');return result;
}
function selectionFor(value,table){
  need(object(value),'DOCUMENT_TABLE_SELECTION','Choose the source table, rows, columns and text policy.');
  const headerRows=indices(value.headerRows,'header rows',table.rowCount,{empty:true}),dataRows=indices(value.dataRows,'data rows',table.rowCount),columns=indices(value.columns,'columns',table.columnCount);
  need(!headerRows.some(r=>dataRows.includes(r)),'DOCUMENT_TABLE_SELECTION','Header and data rows must be separate.');
  need(['anchor','repeat','reject'].includes(value.mergedCells),'DOCUMENT_TABLE_MERGED','Choose anchor, repeat or reject for merged cells.');
  need(['preserve','trim','collapse'].includes(value.whitespace),'DOCUMENT_TABLE_WHITESPACE','Choose preserve, trim or collapse for cell whitespace.');
  const excludedRows=value.excludedRows===undefined?[]:clone(value.excludedRows);need(Array.isArray(excludedRows),'DOCUMENT_TABLE_EXCLUSIONS','Excluded row choices must be an array.');const seen=new Set();
  for(const item of excludedRows){need(object(item),'DOCUMENT_TABLE_EXCLUSIONS','Choose an original excluded row.');positive(item.row,'Excluded row',table.rowCount);
    need(!seen.has(item.row)&&!headerRows.includes(item.row)&&!dataRows.includes(item.row),'DOCUMENT_TABLE_EXCLUSIONS','An explicit exclusion must be unique and outside selected header/data rows.');seen.add(item.row);item.reason=text(item.reason??'','Exclusion note',4000);}
  return{tableIndex:table.tableIndex,headerRows,dataRows,columns,excludedRows,mergedCells:value.mergedCells,whitespace:value.whitespace};
}
const origin=c=>({tableIndex:c.tableIndex,row:c.row,column:c.column,rowspan:c.rowspan,colspan:c.colspan,htmlStart:c.htmlStart,htmlEnd:c.htmlEnd});
const normalized=(s,policy)=>policy==='preserve'?s:policy==='trim'?s.trim():s.replace(/\s+/gu,' ').trim();
function selectedCell(table,row,column,choice){
  const index=table.grid[row-1][column-1],cell=index===null?null:table.cells[index];
  if(!cell)return{column,value:'',originalText:null,origin:null,covered:false,missing:true};
  const covered=cell.row!==row||cell.column!==column,merged=cell.rowspan>1||cell.colspan>1;
  need(choice.mergedCells!=='reject'||!merged,'DOCUMENT_TABLE_MERGED','The selection intersects a merged cell. Choose its anchor or repeated source value.',{tableIndex:table.tableIndex,row,column,origin:origin(cell)});
  const value=covered&&choice.mergedCells==='anchor'?'':normalized(cell.text,choice.whitespace);
  return{column,value,originalText:cell.text,origin:origin(cell),covered,missing:false};
}
const csvCell=value=>'"'+String(value).replace(/"/g,'""')+'"';
export async function projectDocumentTable(source,selection){
  const verified=await validateDocumentTableSource(source),tables=parseDocumentTables(verified.sourceText);
  const table=tables[positive(selection?.tableIndex,'Selected table',tables.length)-1],choice=selectionFor(selection,table);
  const headerCells=choice.headerRows.map(row=>({row,cells:choice.columns.map(column=>selectedCell(table,row,column,choice))}));
  const headings=choice.columns.map((column,index)=>{
    if(!headerCells.length)return'Column '+column;
    const parts=[],seen=new Set();
    for(const row of headerCells){const c=row.cells[index],key=c.origin?c.origin.row+':'+c.origin.column:'missing:'+row.row;if(c.value!==''&&!seen.has(key)){parts.push(c.value);seen.add(key);}}
    return parts.join(' / ');
  });
  const rows=choice.dataRows.map((row,index)=>({record:index+2,row,cells:choice.columns.map(column=>selectedCell(table,row,column,choice))}));
  const csv=[headings,...rows.map(row=>row.cells.map(c=>c.value))].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  const selected=new Set([...choice.headerRows,...choice.dataRows]),explicit=new Map(choice.excludedRows.map(r=>[r.row,r.reason]));
  const omittedRows=table.rows.filter(r=>!selected.has(r.row)).map(r=>({row:r.row,kind:explicit.has(r.row)?'excluded':'outside-selection',reason:explicit.get(r.row)??''}));
  const body={sourceId:verified.id,selection:choice,headings,headerCells,csv,bytes:bytes(csv),sha256:await hash(csv),rows,omittedRows,
    table:{tableIndex:table.tableIndex,rows:table.rowCount,columns:table.columnCount,htmlStart:table.htmlStart,htmlEnd:table.htmlEnd,location:verified.tableLocations.find(x=>x.tableIndex===table.tableIndex)??null},
    summary:{sourceRows:table.rowCount,dataRows:rows.length,headerRows:choice.headerRows.length,omittedRows:omittedRows.length,columns:choice.columns.length,coveredValues:rows.reduce((n,r)=>n+r.cells.filter(c=>c.covered&&c.value!=='').length,0),missingCells:rows.reduce((n,r)=>n+r.cells.filter(c=>c.missing).length,0),unresolvedEntities:table.unresolvedEntities}};
  return{schema:DOCUMENT_TABLE_PROJECTION_SCHEMA,id:'projection-'+await hash(canonical(body)),...body};
}
export async function validateDocumentTableProjection(input){
  need(object(input)&&object(input.projection)&&input.projection.schema===DOCUMENT_TABLE_PROJECTION_SCHEMA,'DOCUMENT_TABLE_PROJECTION','Choose a complete source and projected document table.');
  const source=await validateDocumentTableSource(input.source),projection=await projectDocumentTable(source,input.projection.selection);
  need(canonical(input.projection)===canonical(projection),'DOCUMENT_TABLE_PROJECTION_CHANGED','The retained table selection or complete projection does not reproduce from its source.');
  return{source,projection};
}
